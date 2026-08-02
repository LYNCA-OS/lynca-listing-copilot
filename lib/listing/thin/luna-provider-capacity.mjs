export const LUNA_PROVIDER_CAPACITY_POLICY = Object.freeze({
  namespace: "csm_luna_thin_v1",
  active_attempt_soft_ceiling: 120,
  retry_token_fraction: 0.2,
  retry_owner: "luna_direct_dispatcher",
  admission_unit: "physical_provider_attempt",
  authority_scope: "durable_global"
});

const REQUIRED_CAPABILITIES = Object.freeze([
  "atomic_active_attempts_tokens_retry",
  "durable_global_attempt_queue",
  "weighted_fair_queue",
  "work_conserving",
  "fenced_expiring_leases",
  "global_aimd"
]);

export class LunaProviderCapacityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "LunaProviderCapacityError";
    this.code = code;
    this.statusCode = Number(options.statusCode || 503);
    this.retryable = options.retryable === true;
    this.provider_attempt_started = false;
  }
}

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`missing_${name}`);
  return text;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`invalid_${name}`);
  return number;
}

function numericStatus(error) {
  for (const value of [error?.status, error?.statusCode, error?.response?.status]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function capacityUnavailable(message, cause) {
  return new LunaProviderCapacityError(
    "LUNA_GLOBAL_CAPACITY_AUTHORITY_UNAVAILABLE",
    message,
    { cause, statusCode: 503, retryable: false }
  );
}

export function assertLunaGlobalCapacityAuthority(authority) {
  if (!authority || authority.scope !== "durable_global") {
    throw capacityUnavailable("luna_global_capacity_requires_durable_authority");
  }
  for (const method of ["enqueue", "claim", "heartbeat", "settle"]) {
    if (typeof authority[method] !== "function") {
      throw capacityUnavailable(`luna_global_capacity_authority_missing_${method}`);
    }
  }
  const capabilities = new Set(Array.from(authority.capabilities || []));
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.has(capability));
  if (missing.length > 0) {
    throw capacityUnavailable(`luna_global_capacity_authority_missing_capability:${missing.join(",")}`);
  }
  return authority;
}

function validateLease(lease) {
  if (
    lease?.granted !== true
    || !String(lease.lease_id || "").trim()
    || !String(lease.fencing_token || "").trim()
    || !Number.isFinite(Date.parse(String(lease.expires_at || "")))
  ) {
    throw capacityUnavailable("luna_global_capacity_invalid_lease");
  }
  return lease;
}

function validateQueueEntry(entry) {
  if (!String(entry?.attempt_id || "").trim()) {
    throw capacityUnavailable("luna_global_capacity_invalid_queue_entry");
  }
  return entry;
}

function actualTokens(result) {
  for (const value of [
    result?.usage?.total_tokens,
    result?.usage?.totalTokens,
    result?.response?.usage?.total_tokens
  ]) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 0) return number;
  }
  return null;
}

function retryAfterMilliseconds(error) {
  const headers = error?.response?.headers || error?.headers;
  const raw = typeof headers?.get === "function"
    ? String(headers.get("retry-after") || "").trim()
    : String(Object.entries(headers || {}).find(([key]) => key.toLowerCase() === "retry-after")?.[1] || "").trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000));
  const dateDelay = Date.parse(raw) - Date.now();
  return Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : null;
}

/**
 * enqueueAttempt runs at intake so the durable authority sees the global
 * backlog. runAttempt later claims the lowest eligible weighted finish tag and
 * atomically checks count, tokens, retry share, and AIMD. Settle CASes the
 * fencing token before the dispatcher begins any retry backoff.
 */
export function createLunaGlobalAttemptAdmission({
  authority,
  maximumInflightTokens,
  heartbeatIntervalMs = 30_000,
  onAuthorityError = () => {}
} = {}) {
  const globalAuthority = assertLunaGlobalCapacityAuthority(authority);
  const tokenCeiling = positiveInteger(maximumInflightTokens, "maximum_inflight_tokens");
  const heartbeatEvery = positiveInteger(heartbeatIntervalMs, "heartbeat_interval_ms");
  if (typeof onAuthorityError !== "function") throw new TypeError("invalid_on_authority_error");

  const policy = Object.freeze({
    ...LUNA_PROVIDER_CAPACITY_POLICY,
    maximum_inflight_tokens: tokenCeiling
  });

  async function reportAuthorityError(error, phase, context) {
    try {
      await onAuthorityError({ error, phase, ...context });
    } catch {
      // Capacity telemetry must never turn one provider outcome into another.
    }
  }

  return Object.freeze({
    policy,
    globallyEnforced: true,
    enqueueAttempt: async ({
      tenantId,
      operationKey,
      payloadHash,
      attempt,
      attemptClass,
      estimatedTokens,
      notBeforeMs = null
    } = {}) => {
      const normalizedClass = String(attemptClass || "").trim().toLowerCase();
      if (!new Set(["fresh", "retry"]).has(normalizedClass)) {
        throw new TypeError("invalid_attempt_class");
      }
      const admission = {
        namespace: policy.namespace,
        tenant_id: requiredText(tenantId, "tenant_id"),
        operation_key: requiredText(operationKey, "operation_key"),
        payload_hash: requiredText(payloadHash, "payload_hash"),
        attempt: positiveInteger(attempt, "attempt"),
        attempt_class: normalizedClass,
        estimated_tokens: positiveInteger(estimatedTokens, "estimated_tokens"),
        policy
      };
      if (notBeforeMs !== null) {
        const timestamp = Number(notBeforeMs);
        if (!Number.isFinite(timestamp)) throw new TypeError("invalid_not_before_ms");
        admission.not_before = new Date(timestamp).toISOString();
      }
      if (admission.estimated_tokens > tokenCeiling) {
        throw new LunaProviderCapacityError(
          "LUNA_PROVIDER_ATTEMPT_TOO_LARGE",
          `estimated_tokens_exceed_global_ceiling:${admission.estimated_tokens}:${tokenCeiling}`,
          { statusCode: 422, retryable: false }
        );
      }

      let entry;
      try {
        entry = validateQueueEntry(await globalAuthority.enqueue(admission));
      } catch (error) {
        if (error instanceof LunaProviderCapacityError) throw error;
        throw capacityUnavailable("luna_global_capacity_enqueue_failed", error);
      }
      return Object.freeze({ entry, admission });
    },

    runAttempt: async ({ queuedAttempt, execute } = {}) => {
      if (typeof execute !== "function") throw new TypeError("missing_execute");
      const prepared = await queuedAttempt;
      const entry = validateQueueEntry(prepared?.entry);
      const admission = prepared?.admission;
      if (!admission || admission.namespace !== policy.namespace) {
        throw capacityUnavailable("luna_global_capacity_invalid_prepared_attempt");
      }

      let lease;
      try {
        lease = validateLease(await globalAuthority.claim({
          namespace: policy.namespace,
          attempt_id: entry.attempt_id,
          policy
        }));
      } catch (error) {
        if (error instanceof LunaProviderCapacityError) throw error;
        throw capacityUnavailable("luna_global_capacity_claim_failed", error);
      }

      let result;
      let providerError;
      let heartbeatInFlight = false;
      const heartbeatTimer = setInterval(() => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;
        Promise.resolve(globalAuthority.heartbeat({
          namespace: policy.namespace,
          lease_id: lease.lease_id,
          fencing_token: lease.fencing_token
        }))
          .catch((error) => reportAuthorityError(error, "heartbeat", { admission, lease }))
          .finally(() => { heartbeatInFlight = false; });
      }, heartbeatEvery);
      heartbeatTimer.unref?.();
      try {
        result = await execute({ lease, admission });
      } catch (error) {
        providerError = error;
      } finally {
        clearInterval(heartbeatTimer);
      }

      try {
        await globalAuthority.settle({
          namespace: policy.namespace,
          attempt_id: entry.attempt_id,
          lease_id: lease.lease_id,
          fencing_token: lease.fencing_token,
          outcome: providerError ? "failed" : "succeeded",
          status: numericStatus(providerError) ?? (providerError ? null : 200),
          actual_tokens: actualTokens(result),
          retry_after_ms: retryAfterMilliseconds(providerError)
        });
      } catch (error) {
        await reportAuthorityError(error, "settle", { admission, lease });
      }

      if (providerError) throw providerError;
      return result;
    }
  });
}
