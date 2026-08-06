const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

export class TenantTokenPoolError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TenantTokenPoolError";
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`invalid_${name}`);
  return number;
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`invalid_${name}`);
  return number;
}

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`missing_${name}`);
  return text;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function numericStatus(error) {
  for (const value of [error?.status, error?.statusCode, error?.response?.status]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function defaultTransientFailure(error) {
  return error?.retryable === true || TRANSIENT_STATUSES.has(numericStatus(error));
}

function normalizeJob(input, maximumTokens) {
  const job = {
    tenantId: requiredText(input?.tenantId, "tenant_id"),
    jobId: requiredText(input?.jobId, "job_id"),
    operationKey: requiredText(input?.operationKey, "operation_key"),
    tokenWeight: positiveInteger(input?.tokenWeight, "token_weight"),
    payload: input?.payload
  };
  if (job.tokenWeight > maximumTokens) {
    throw new TenantTokenPoolError(
      "TENANT_TOKEN_JOB_TOO_LARGE",
      `token_weight_exceeds_maximum:${job.tokenWeight}:${maximumTokens}`
    );
  }
  return job;
}

/**
 * Process-local, token-weighted scheduling primitive. Global admission/backlog
 * may contain thousands of operations; targetInflightTokens limits only the
 * smaller provider execution window. Cross-process admission control and
 * durable operation idempotency must remain an external boundary.
 */
export function createTenantTokenPool({
  execute,
  targetInflightTokens,
  deriveTargetInflightTokens,
  maximumInflightTokens,
  minimumInflightTokens,
  maximumActiveJobs = Number.POSITIVE_INFINITY,
  tenantPolicies = {},
  maxAttempts = 3,
  retryTokenFraction = 0.25,
  maxFreshBeforeRetry = 4,
  maximumHeadBypasses = 8,
  isTransientFailure = defaultTransientFailure,
  retryDelayMs = ({ attempt }) => Math.min(30_000, 250 * (2 ** Math.max(0, attempt - 1))),
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  aimdDecreaseFactor = 0.5,
  aimdIncreaseTokens,
  aimdDecreaseCooldownMs = 1_000,
  now = Date.now,
  onCapacityChange = () => {}
} = {}) {
  if (typeof execute !== "function") throw new TypeError("missing_execute");
  const derived = targetInflightTokens ?? deriveTargetInflightTokens?.();
  let targetTokens = positiveInteger(derived, "target_inflight_tokens");
  const maxTokens = positiveInteger(maximumInflightTokens ?? targetTokens, "maximum_inflight_tokens");
  const minTokens = positiveInteger(
    minimumInflightTokens ?? Math.max(1, Math.floor(targetTokens / 4)),
    "minimum_inflight_tokens"
  );
  if (minTokens > targetTokens || targetTokens > maxTokens) {
    throw new TypeError("invalid_inflight_token_bounds");
  }
  const maxActive = maximumActiveJobs === Number.POSITIVE_INFINITY
    ? maximumActiveJobs
    : positiveInteger(maximumActiveJobs, "maximum_active_jobs");
  const attemptsLimit = positiveInteger(maxAttempts, "max_attempts");
  const retryFraction = Number(retryTokenFraction);
  if (!Number.isFinite(retryFraction) || retryFraction <= 0 || retryFraction > 1) {
    throw new TypeError("invalid_retry_token_fraction");
  }
  const freshBurstLimit = positiveInteger(maxFreshBeforeRetry, "max_fresh_before_retry");
  const headBypassLimit = positiveInteger(maximumHeadBypasses, "maximum_head_bypasses");
  const decreaseFactor = Number(aimdDecreaseFactor);
  if (!Number.isFinite(decreaseFactor) || decreaseFactor <= 0 || decreaseFactor >= 1) {
    throw new TypeError("invalid_aimd_decrease_factor");
  }
  const increaseTokens = positiveInteger(
    aimdIncreaseTokens ?? Math.max(1, Math.floor(targetTokens / 20)),
    "aimd_increase_tokens"
  );

  const tenants = new Map();
  const tenantOrder = [];
  const jobs = new Map();
  const operations = new Map();
  const idleWaiters = new Set();
  let cursor = 0;
  let drainScheduled = false;
  let draining = false;
  let activeJobs = 0;
  let activeTokens = 0;
  let activeRetryJobs = 0;
  let activeRetryTokens = 0;
  let waitingRetries = 0;
  let freshDispatchesSinceRetry = 0;
  let lastDecreaseAt = Number.NEGATIVE_INFINITY;
  let virtualTime = 0;
  let schedulingEpoch = 0;
  const totals = { completed: 0, failed: 0, cancelled: 0 };

  function normalizedPolicy(policy = {}) {
    const weight = finitePositive(policy.weight ?? 1, "tenant_weight");
    const maxActiveJobs = policy.maxActiveJobs == null
      ? Number.POSITIVE_INFINITY
      : positiveInteger(policy.maxActiveJobs, "tenant_max_active_jobs");
    return { weight, maxActiveJobs };
  }

  function tenantFor(tenantId) {
    let tenant = tenants.get(tenantId);
    if (tenant) return tenant;
    tenant = {
      id: tenantId,
      ...normalizedPolicy(tenantPolicies[tenantId]),
      lastFinishTag: 0,
      activeJobs: 0,
      fresh: [],
      retry: []
    };
    tenants.set(tenantId, tenant);
    tenantOrder.push(tenantId);
    return tenant;
  }

  for (const tenantId of Object.keys(tenantPolicies)) tenantFor(tenantId);

  function queuedCount() {
    let count = 0;
    for (const tenant of tenants.values()) count += tenant.fresh.length + tenant.retry.length;
    return count;
  }

  function isIdle() {
    return activeJobs === 0 && queuedCount() === 0 && waitingRetries === 0;
  }

  function notifyIdle() {
    if (!isIdle()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function requestDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      drain();
    });
  }

  function retryTokenLimit() {
    return Math.max(1, Math.floor(targetTokens * retryFraction));
  }

  function hasFreshBacklog() {
    for (const tenant of tenants.values()) {
      if (tenant.fresh.length > 0) return true;
    }
    return false;
  }

  function fitsGlobal(record) {
    if (activeJobs >= maxActive) return false;
    if (activeTokens + record.job.tokenWeight <= targetTokens) return true;
    return activeJobs === 0 && record.job.tokenWeight <= maxTokens;
  }

  function fitsRetry(record) {
    if (!record.isRetry) return true;
    if (!hasFreshBacklog()) return true;
    if (activeRetryTokens + record.job.tokenWeight <= retryTokenLimit()) return true;
    return activeRetryJobs === 0;
  }

  function physicallyFits(record, tenant) {
    return tenant.activeJobs < tenant.maxActiveJobs && fitsGlobal(record) && fitsRetry(record);
  }

  function hasFitting(queueName) {
    for (const tenant of tenants.values()) {
      const record = tenant[queueName][0];
      if (record && physicallyFits(record, tenant)) return true;
    }
    return false;
  }

  function assignFinishTag(record, tenant) {
    const dominantCost = Math.max(
      Number.isFinite(maxActive) ? 1 / maxActive : 0,
      record.job.tokenWeight / maxTokens
    );
    record.startTag = Math.max(virtualTime, tenant.lastFinishTag);
    record.finishTag = record.startTag + (dominantCost / tenant.weight);
    record.bypasses = 0;
    record.epoch = schedulingEpoch;
    tenant.lastFinishTag = record.finishTag;
  }

  function reservableFragmentation(record, tenant) {
    return tenant.activeJobs < tenant.maxActiveJobs
      && activeJobs < maxActive
      && record.job.tokenWeight <= maxTokens
      && activeJobs > 0
      && activeTokens + record.job.tokenWeight > targetTokens;
  }

  // Packetized dominant-resource WFQ charges max(1/C, tokens/B) and compares
  // tenant heads only. Looking deeper lets cheap later packets starve an
  // earlier expensive packet. A bounded bypass reservation drains fragmented
  // active tokens before admitting more lower-priority work.
  function nextFairCandidate(queueName) {
    const candidates = [];
    for (let visited = 0; visited < tenantOrder.length; visited += 1) {
      const index = (cursor + visited) % tenantOrder.length;
      const tenant = tenants.get(tenantOrder[index]);
      const record = tenant[queueName][0];
      if (record) candidates.push({ index, tenant, record });
    }
    candidates.sort((left, right) => left.record.finishTag - right.record.finishTag || left.index - right.index);
    const fairHead = candidates[0];
    if (!fairHead) return null;
    if (physicallyFits(fairHead.record, fairHead.tenant)) {
      cursor = (fairHead.index + 1) % tenantOrder.length;
      return fairHead;
    }
    if (
      fairHead.record.bypasses >= headBypassLimit
      && reservableFragmentation(fairHead.record, fairHead.tenant)
    ) return null;

    const selected = candidates.find(({ record, tenant }) => physicallyFits(record, tenant));
    if (!selected) return null;
    if (selected !== fairHead && reservableFragmentation(fairHead.record, fairHead.tenant)) {
      fairHead.record.bypasses += 1;
    }
    cursor = (selected.index + 1) % tenantOrder.length;
    return selected;
  }

  function preferredQueue() {
    const freshFits = hasFitting("fresh");
    const retryFits = hasFitting("retry");
    if (!freshFits) return retryFits ? "retry" : null;
    if (retryFits && freshDispatchesSinceRetry >= freshBurstLimit) return "retry";
    return "fresh";
  }

  function settle(record, state, value) {
    if (["succeeded", "failed", "cancelled"].includes(record.state)) return;
    record.state = state;
    if (state === "succeeded") {
      totals.completed += 1;
      record.result = value;
      record.resolve(value);
    } else {
      if (state === "failed") totals.failed += 1;
      else totals.cancelled += 1;
      record.error = value;
      record.reject(value);
    }
  }

  function changeTarget(next, reason) {
    const previous = targetTokens;
    targetTokens = Math.max(minTokens, Math.min(maxTokens, Math.trunc(next)));
    if (targetTokens !== previous) {
      onCapacityChange({ reason, previousTargetTokens: previous, targetTokens });
      requestDrain();
    }
    return targetTokens;
  }

  function reportRateLimit() {
    const timestamp = Number(now());
    if (timestamp - lastDecreaseAt < aimdDecreaseCooldownMs) return targetTokens;
    lastDecreaseAt = timestamp;
    return changeTarget(Math.floor(targetTokens * decreaseFactor), "rate_limit");
  }

  function reportStableWindow() {
    return changeTarget(targetTokens + increaseTokens, "stable_window");
  }

  function releaseActive(record) {
    const tenant = tenants.get(record.job.tenantId);
    activeJobs -= 1;
    activeTokens -= record.job.tokenWeight;
    tenant.activeJobs -= 1;
    if (record.isRetry) {
      activeRetryJobs -= 1;
      activeRetryTokens -= record.job.tokenWeight;
    }
  }

  function queueRetry(record, error) {
    record.state = "retry_wait";
    record.isRetry = true;
    waitingRetries += 1;
    const delay = Math.max(0, Number(retryDelayMs({
      error,
      attempt: record.attempts,
      job: record.job
    })) || 0);
    Promise.resolve()
      .then(() => sleep(delay))
      .then(() => {
        if (record.state !== "retry_wait") return;
        waitingRetries -= 1;
        record.state = "queued";
        const tenant = tenantFor(record.job.tenantId);
        assignFinishTag(record, tenant);
        tenant.retry.push(record);
        requestDrain();
        notifyIdle();
      })
      .catch((waitError) => {
        if (record.state !== "retry_wait") return;
        waitingRetries -= 1;
        settle(record, "failed", waitError);
        notifyIdle();
      });
  }

  function run(record) {
    const tenant = tenants.get(record.job.tenantId);
    record.state = "running";
    record.attempts += 1;
    activeJobs += 1;
    activeTokens += record.job.tokenWeight;
    tenant.activeJobs += 1;
    if (record.isRetry) {
      activeRetryJobs += 1;
      activeRetryTokens += record.job.tokenWeight;
      freshDispatchesSinceRetry = 0;
    } else {
      freshDispatchesSinceRetry += 1;
    }

    Promise.resolve()
      .then(() => execute({
        ...record.job,
        attempt: record.attempts,
        retry: record.isRetry
      }))
      .then((result) => {
        releaseActive(record);
        settle(record, "succeeded", result);
        requestDrain();
        notifyIdle();
      })
      .catch((error) => {
        releaseActive(record);
        if (numericStatus(error) === 429) reportRateLimit();
        if (record.attempts < attemptsLimit && isTransientFailure(error) === true) {
          queueRetry(record, error);
        } else {
          settle(record, "failed", error);
        }
        requestDrain();
        notifyIdle();
      });
  }

  function drain() {
    if (draining) return;
    draining = true;
    try {
      while (activeJobs < maxActive) {
        const queueName = preferredQueue();
        if (!queueName || tenantOrder.length === 0) break;
        const selected = nextFairCandidate(queueName);
        if (!selected) break;
        const [record] = selected.tenant[queueName].splice(0, 1);
        virtualTime = Math.max(virtualTime, record.startTag);
        run(record);
      }
    } finally {
      draining = false;
      notifyIdle();
    }
  }

  function enqueue(input) {
    const job = normalizeJob(input, maxTokens);
    const jobMatch = jobs.get(job.jobId);
    if (jobMatch) {
      if (
        jobMatch.job.operationKey !== job.operationKey
        || jobMatch.job.tenantId !== job.tenantId
        || jobMatch.job.tokenWeight !== job.tokenWeight
      ) {
        throw new TenantTokenPoolError("TENANT_TOKEN_JOB_CONFLICT", "job_id_reused_for_another_operation");
      }
      return jobMatch.promise;
    }
    const operationMatch = operations.get(job.operationKey);
    if (operationMatch) {
      if (operationMatch.job.tenantId !== job.tenantId || operationMatch.job.tokenWeight !== job.tokenWeight) {
        throw new TenantTokenPoolError("TENANT_TOKEN_OPERATION_CONFLICT", "operation_key_reused_with_different_admission_identity");
      }
      jobs.set(job.jobId, operationMatch);
      return operationMatch.promise;
    }

    if (isIdle()) {
      schedulingEpoch += 1;
      virtualTime = 0;
      for (const tenant of tenants.values()) tenant.lastFinishTag = 0;
    }

    const pending = deferred();
    const record = {
      job,
      state: "queued",
      attempts: 0,
      isRetry: false,
      ...pending
    };
    jobs.set(job.jobId, record);
    operations.set(job.operationKey, record);
    const tenant = tenantFor(job.tenantId);
    assignFinishTag(record, tenant);
    tenant.fresh.push(record);
    requestDrain();
    return record.promise;
  }

  function cancelQueued(identifier, reason = "cancelled_by_caller") {
    const key = String(identifier ?? "").trim();
    const record = jobs.get(key) || operations.get(key);
    if (!record || !["queued", "retry_wait"].includes(record.state)) return false;
    if (record.state === "queued") {
      const tenant = tenants.get(record.job.tenantId);
      for (const queue of [tenant.fresh, tenant.retry]) {
        const index = queue.indexOf(record);
        if (index >= 0) queue.splice(index, 1);
      }
    } else {
      waitingRetries -= 1;
    }
    settle(record, "cancelled", new TenantTokenPoolError(
      "TENANT_TOKEN_JOB_CANCELLED",
      String(reason || "cancelled_by_caller")
    ));
    requestDrain();
    notifyIdle();
    return true;
  }

  function setTenantPolicy(tenantId, policy) {
    const tenant = tenantFor(requiredText(tenantId, "tenant_id"));
    Object.assign(tenant, normalizedPolicy({
      weight: policy?.weight ?? tenant.weight,
      maxActiveJobs: policy?.maxActiveJobs ?? tenant.maxActiveJobs
    }));
    requestDrain();
  }

  function snapshot() {
    let queuedFresh = 0;
    let queuedRetry = 0;
    let reservedHeadJobs = 0;
    let reservedHeadTokens = 0;
    let minimumFreshHeadTokens = Number.POSITIVE_INFINITY;
    for (const tenant of tenants.values()) {
      queuedFresh += tenant.fresh.length;
      queuedRetry += tenant.retry.length;
      if (tenant.fresh[0]) {
        minimumFreshHeadTokens = Math.min(minimumFreshHeadTokens, tenant.fresh[0].job.tokenWeight);
      }
      for (const queue of [tenant.fresh, tenant.retry]) {
        const head = queue[0];
        if (
          head?.bypasses >= headBypassLimit
          && reservableFragmentation(head, tenant)
        ) {
          reservedHeadJobs += 1;
          reservedHeadTokens += head.job.tokenWeight;
        }
      }
    }
    return {
      global_admitted_operations: operations.size,
      global_backlog_jobs: queuedFresh + queuedRetry + waitingRetries,
      provider_window_target_tokens: targetTokens,
      provider_window_max_active_jobs: Number.isFinite(maxActive) ? maxActive : null,
      provider_window_active_jobs: activeJobs,
      provider_window_active_tokens: activeTokens,
      provider_window_reserved_head_jobs: reservedHeadJobs,
      provider_window_reserved_head_tokens: reservedHeadTokens,
      provider_window_minimum_fresh_head_tokens: Number.isFinite(minimumFreshHeadTokens)
        ? minimumFreshHeadTokens
        : null,
      target_inflight_tokens: targetTokens,
      maximum_inflight_tokens: maxTokens,
      active_jobs: activeJobs,
      active_tokens: activeTokens,
      active_retry_jobs: activeRetryJobs,
      active_retry_tokens: activeRetryTokens,
      queued_jobs: queuedFresh + queuedRetry,
      queued_fresh_jobs: queuedFresh,
      queued_retry_jobs: queuedRetry,
      waiting_retries: waitingRetries,
      tenants: tenants.size,
      operations: operations.size,
      ...totals
    };
  }

  function whenIdle() {
    if (isIdle()) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  return {
    enqueue,
    cancelQueued,
    setTenantPolicy,
    reportRateLimit,
    reportStableWindow,
    snapshot,
    whenIdle
  };
}
