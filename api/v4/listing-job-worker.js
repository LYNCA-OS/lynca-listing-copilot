import { waitUntil } from "@vercel/functions";
import v4ListingHandler from "./listing-copilot-title.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest, persistErrorLog, persistProductionEvent, sanitizeOperationalText } from "../../lib/observability/production-events.mjs";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  failV4RecognitionJob,
  heartbeatV4RecognitionJob,
  releaseV4ProviderCapacityForJob,
  releasePairedV4FinalJob,
  tryAcquireV4QueueKick,
  v4JobLeaseHeartbeatEnabled,
  v4JobLeaseHeartbeatIntervalMs,
  v4JobLanes,
  v4JobStatuses,
  v4JobTypes,
  v4QueueConfigured,
  v4WorkerClaimLimit,
  v4WorkerLeaseSeconds,
  v4WorkerMaxWaitMs,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { isV4WorkerRequest, workerSecretHeader } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { scheduleTrustedV4QueuePump } from "../../lib/listing/v4/jobs/internal-queue-wake.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeError(error) {
  return sanitizeOperationalText(error?.message || error || "unknown_error", 500);
}

function operationalContextForJob(job = {}) {
  return {
    tenantId: job.tenant_id || null,
    userId: job.created_by_user_id || job.assigned_to_user_id || job.operator_id || null
  };
}

async function recordJobProductionEvent(job, eventType, input = {}) {
  try {
    return await persistProductionEvent({
      eventType,
      context: operationalContextForJob(job),
      batchId: job.batch_id || null,
      jobId: job.id || null,
      sessionId: job.recognition_session_id || null,
      ...input
    });
  } catch {
    return { saved: false, error: "production_event_write_failed" };
  }
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonNegativeNumberOrNull(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstNumber(sources = [], keys = []) {
  for (const source of sources) {
    for (const key of keys) {
      const number = nonNegativeNumberOrNull(source?.[key]);
      if (number !== null) return number;
    }
  }
  return null;
}

export function v4ResponseUsage(response = {}) {
  const responseObject = objectOrEmpty(response);
  const summary = {
    ...objectOrEmpty(responseObject.provider_result_summary),
    ...objectOrEmpty(responseObject.provider_result)
  };
  const legacy = objectOrEmpty(responseObject.legacy_v2_result);
  const usageSources = [
    objectOrEmpty(summary.usage),
    objectOrEmpty(responseObject.usage),
    objectOrEmpty(legacy.usage),
    objectOrEmpty(summary.provider_usage)
  ];
  const tokenSources = [
    ...usageSources,
    objectOrEmpty(summary.provider_token_diagnostics),
    objectOrEmpty(summary.token_diagnostics),
    objectOrEmpty(legacy.provider_token_diagnostics),
    summary,
    responseObject
  ];
  const providerCalls = firstNumber(
    [summary, ...usageSources, responseObject, legacy],
    ["provider_calls", "provider_call_count"]
  );
  const providerCallsKnown = providerCalls !== null;
  const provider = summary.provider || responseObject.provider || legacy.provider || null;
  const modelVersion = summary.model || summary.model_id || responseObject.model || responseObject.model_id || legacy.model || legacy.model_id || null;
  const inferredProviderCall = !providerCallsKnown
    && Boolean(provider || modelVersion);
  const resolvedProviderCalls = providerCallsKnown
    ? Math.trunc(providerCalls)
    : inferredProviderCall
      ? 1
      : 0;
  const inputTokens = firstNumber(tokenSources, ["input_tokens", "prompt_tokens", "total_input_tokens"]);
  const outputTokens = firstNumber(tokenSources, ["output_tokens", "completion_tokens", "total_output_tokens"]);
  const rawEstimatedCostUsd = firstNumber(
    [summary, ...usageSources, responseObject, legacy],
    ["estimated_cost_usd", "cost_usd"]
  );
  const costConfiguredFlag = [summary, ...usageSources, responseObject, legacy]
    .map((source) => source?.cost_configured)
    .find((value) => typeof value === "boolean");
  const estimatedCostUsd = costConfiguredFlag === true && rawEstimatedCostUsd !== null
    ? rawEstimatedCostUsd
    : costConfiguredFlag === undefined && rawEstimatedCostUsd !== null && rawEstimatedCostUsd > 0
      ? rawEstimatedCostUsd
      : null;
  const costConfigured = typeof costConfiguredFlag === "boolean"
    ? costConfiguredFlag
    : estimatedCostUsd !== null
      ? true
      : null;
  return {
    provider,
    modelVersion,
    promptVersion: summary.prompt_version || responseObject.prompt_version || legacy.prompt_version || null,
    route: responseObject.route || responseObject.route_plan?.route || summary.route || legacy.route || null,
    providerCalls: resolvedProviderCalls,
    providerCallsKnown,
    providerCallsSource: providerCallsKnown ? "reported" : inferredProviderCall ? "inferred" : "none",
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    costConfigured,
    pricingCoverage: estimatedCostUsd !== null
      ? "PRICED"
      : resolvedProviderCalls > 0
        ? "UNPRICED"
        : "NO_PROVIDER_CALL",
    observed: providerCallsKnown
      || inferredProviderCall
      || inputTokens !== null
      || outputTokens !== null
      || estimatedCostUsd !== null
  };
}

function providerEventMetadata(usage = {}, metadata = {}) {
  return {
    provider: usage.provider || null,
    provider_calls_source: usage.providerCallsSource || "none",
    cost_configured: usage.costConfigured,
    pricing_coverage: usage.pricingCoverage || "UNPRICED",
    ...metadata
  };
}

function normalizedFailureToken(value) {
  const token = String(value || "").trim();
  if (!token || token.length > 80 || !/^[a-z0-9_.:-]+$/i.test(token)) return "";
  return token.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

export function v4JobFailureCode(response = {}) {
  const body = response.body && typeof response.body === "object" ? response.body : {};
  const providerResult = body.provider_result && typeof body.provider_result === "object"
    ? body.provider_result
    : {};
  const explicitCode = [
    body.error_code,
    body.provider_error_code,
    body.provider_error_type,
    providerResult.error_code,
    providerResult.provider_error_code,
    providerResult.provider_error_type
  ].map(normalizedFailureToken).find(Boolean);
  if (explicitCode) return explicitCode;

  const reason = [
    body.message,
    body.failure_reason,
    providerResult.failure_reason,
    providerResult.reason
  ].filter(Boolean).join(" ").toLowerCase();
  if (reason.includes("schema validation")) return "SCHEMA_VALIDATION_FAILED";
  if (reason.includes("response format") || reason.includes("invalid json") || reason.includes("json syntax")) {
    return "RESPONSE_FORMAT_INVALID";
  }
  if (reason.includes("image input") && reason.includes("unsupported")) return "IMAGE_INPUT_UNSUPPORTED";
  if (reason.includes("empty") || reason.includes("blocked")) return "EMPTY_OR_BLOCKED";
  if (reason.includes("rate limit") || reason.includes("too many requests")) return "PROVIDER_RATE_LIMITED";
  if (reason.includes("timeout") || reason.includes("timed out")) return "PROVIDER_TIMEOUT";
  if (reason.includes("network")) return "PROVIDER_NETWORK_ERROR";

  const httpStatus = Number(response.statusCode || 0);
  if (httpStatus < 200 || httpStatus >= 300) return `HTTP_${httpStatus || "UNKNOWN"}`;
  return "V4_RESULT_NOT_OK";
}

function workerIdFrom(req, payload = {}) {
  return String(
    payload.worker_id ||
      payload.workerId ||
      req.headers["x-vercel-id"] ||
      req.headers["x-forwarded-for"] ||
      "v4-worker"
  ).slice(0, 120);
}

function normalizedJobType(job = {}) {
  const raw = String(job.job_type || job.payload?.job_type || "").trim().toUpperCase();
  return raw === v4JobTypes.FAST_SCOUT_DRAFT ? v4JobTypes.FAST_SCOUT_DRAFT : v4JobTypes.FINAL_ASSISTED_TITLE;
}

function laneLeaseSeconds(lane, payload = {}) {
  if (payload.lease_seconds || payload.leaseSeconds) {
    return positiveInteger(payload.lease_seconds ?? payload.leaseSeconds, v4WorkerLeaseSeconds(process.env), { min: 30, max: 900 });
  }
  const laneKey = lane === v4JobLanes.INTERACTIVE ? "V4_JOB_LEASE_SECONDS_INTERACTIVE" : "V4_JOB_LEASE_SECONDS_BACKGROUND";
  const fallback = lane === v4JobLanes.INTERACTIVE ? 120 : 300;
  return positiveInteger(process.env[laneKey], fallback, { min: 30, max: 900 });
}

function laneProcessConcurrency(lane, payload = {}) {
  const globalFallback = v4WorkerProcessConcurrency(process.env);
  const laneKey = lane === v4JobLanes.INTERACTIVE
    ? "V4_JOB_WORKER_PROCESS_CONCURRENCY_INTERACTIVE"
    : "V4_JOB_WORKER_PROCESS_CONCURRENCY_BACKGROUND";
  const requested = positiveInteger(
    payload.process_concurrency ?? payload.processConcurrency ?? process.env[laneKey],
    positiveInteger(process.env[laneKey], globalFallback, { min: 1, max: 96 }),
    { min: 1, max: 96 }
  );
  const hardMax = positiveInteger(process.env.V4_JOB_WORKER_PROCESS_CONCURRENCY_MAX, 4, { min: 1, max: 96 });
  return Math.min(requested, hardMax, globalFallback);
}

function shouldDrainLoop(payload = {}) {
  const raw = payload.drain_loop_enabled ?? payload.drainLoopEnabled ?? process.env.V4_JOB_WORKER_DRAIN_LOOP_ENABLED;
  if (raw === undefined || raw === null || raw === "") return true;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

export function payloadForV4ProductionJob(job = {}) {
  const jobType = normalizedJobType(job);
  const fastScoutDraft = jobType === v4JobTypes.FAST_SCOUT_DRAFT;
  const basePayload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? { ...job.payload }
    : {};
  const leasedKeySlot = Number(job.queue_tags?.provider_key_slot || 0) || null;
  return {
    ...basePayload,
    recognition_session_id: job.recognition_session_id || basePayload.recognition_session_id,
    asset_id: job.asset_id || basePayload.asset_id || basePayload.assetId || undefined,
    tenant_id: job.tenant_id || undefined,
    v4_origin_tenant_id: job.tenant_id || undefined,
    v4_origin_operator_id: job.operator_id || undefined,
    provider: basePayload.provider || job.provider_id || "openai_legacy",
    provider_id: basePayload.provider_id || job.provider_id || "openai_legacy",
    vision_provider: basePayload.vision_provider || job.provider_id || "openai_legacy",
    v4_queue_job_id: job.id || undefined,
    v4_queue_worker_id: job.lease_owner || undefined,
    v4_queue_job_type: jobType,
    v4_queue_lane: job.lane || basePayload.lane || (fastScoutDraft ? v4JobLanes.INTERACTIVE : v4JobLanes.BACKGROUND),
    openai_preferred_key_slot: leasedKeySlot || basePayload.openai_preferred_key_slot || null,
    provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
    ...(fastScoutDraft
      ? {
        v4_worker_synchronous: false,
        v4_force_l2_direct: false,
        disable_fast_scout_l1: false,
        v4_queue_l1_only: true
      }
      : {
        v4_worker_synchronous: true,
        v4_force_l2_direct: true,
        disable_fast_scout_l1: true
      })
  };
}

function completionStatusForJob(job = {}) {
  return normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT ? v4JobStatuses.L1_READY : v4JobStatuses.L2_READY;
}

export function triggerV4BackgroundWorkerAfterL1Release(_req, {
  job = {},
  pairedRelease = {},
  reason = "l1_released_paired_l2",
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil
} = {}) {
  if (pairedRelease.saved !== true) return { triggered: false, reason: "paired_l2_not_released" };
  const processConcurrency = positiveInteger(env.V4_L2_WAKE_BACKGROUND_CONCURRENCY, v4WorkerProcessConcurrency(env), { min: 1, max: 96 });
  const tenantId = job.tenant_id || job.payload?.tenant_id || null;
  return scheduleTrustedV4QueuePump({
    payload: {
      tenant_id: tenantId,
      background_only: true,
      limit: processConcurrency,
      process_concurrency: processConcurrency,
      cycles: 2,
      max_runtime_ms: 240_000,
      lease_seconds: 240,
      idle_cycles_before_stop: 1,
      background_idle_cycles: 1,
      continuation_cycles: 2,
      max_continuation_depth: 20
    },
    reason,
    dedupScope: `l2-release:${tenantId || "global"}`,
    dedupOwner: `l2-release-${String(job.id || "job").slice(0, 96)}`,
    dedupLeaseMs: 1_200,
    acquireKick: tryAcquireV4QueueKick,
    env,
    fetchImpl,
    defer
  });
}

export function triggerV4RetryWake({
  job = {},
  failure = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil,
  acquireKick = tryAcquireV4QueueKick,
  sleep
} = {}) {
  const retryPlan = failure.retry_plan || {};
  if (failure.saved !== true || retryPlan.shouldRetry !== true) {
    return { triggered: false, reason: failure.saved === true ? "retry_not_planned" : "retry_state_not_saved" };
  }
  const retryDelaySeconds = positiveInteger(retryPlan.retryDelaySeconds, 10, { min: 1, max: 900 });
  const processConcurrency = v4WorkerProcessConcurrency(env);
  const lane = job.lane === v4JobLanes.INTERACTIVE ? v4JobLanes.INTERACTIVE : v4JobLanes.BACKGROUND;
  const scheduled = scheduleTrustedV4QueuePump({
    payload: {
      tenant_id: null,
      limit: processConcurrency,
      process_concurrency: processConcurrency,
      interactive_only: lane === v4JobLanes.INTERACTIVE,
      background_only: lane === v4JobLanes.BACKGROUND,
      cycles: 2,
      max_runtime_ms: 240_000,
      lease_seconds: 240,
      idle_cycles_before_stop: 1,
      background_idle_cycles: 1,
      continuation_cycles: 2,
      max_continuation_depth: 20,
      retry_job_id: job.id || null
    },
    reason: "retry_not_before_reached",
    delayMs: retryDelaySeconds * 1000 + 100,
    dedupScope: `retry:${lane}`,
    dedupOwner: `retry-${String(job.id || "job").slice(0, 96)}`,
    dedupLeaseMs: 1_200,
    acquireKick,
    env,
    fetchImpl,
    defer,
    ...(typeof sleep === "function" ? { sleep } : {})
  });
  return {
    triggered: scheduled.triggered,
    reason: scheduled.reason,
    retry_delay_seconds: retryDelaySeconds,
    completion: scheduled.completion
  };
}

export async function handlePairedV4FinalAfterL1Failure(req, {
  job = {},
  failure = {},
  error = null,
  releasePaired = releasePairedV4FinalJob,
  wakePaired = triggerV4BackgroundWorkerAfterL1Release
} = {}) {
  const hiddenL1Job = normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT;
  const leaseLost = error?.code === "QUEUE_LEASE_LOST" || failure?.error === "row_not_matched";
  if (!hiddenL1Job) {
    return {
      pairedRelease: { saved: false, skipped: true },
      pairedWake: { triggered: false, reason: "not_l1_job" },
      leaseLost
    };
  }
  if (failure?.saved !== true || leaseLost) {
    const reason = leaseLost ? "parent_lease_lost" : "parent_failure_not_saved";
    return {
      pairedRelease: { saved: false, skipped: true, error: reason },
      pairedWake: { triggered: false, reason },
      leaseLost
    };
  }
  const pairedRelease = await releasePaired({ job, reason: "l1_failed_release_final" });
  const pairedWake = wakePaired(req, { job, pairedRelease, reason: "l1_failed_wake_l2" });
  return { pairedRelease, pairedWake, leaseLost };
}

async function mapWithConcurrency(items = [], concurrency = 1, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runWithV4JobLeaseHeartbeat({
  job = {},
  leaseSeconds = 300,
  task,
  heartbeat = heartbeatV4RecognitionJob,
  intervalMs = v4JobLeaseHeartbeatIntervalMs({ leaseSeconds, env: process.env }),
  enabled = v4JobLeaseHeartbeatEnabled(process.env)
} = {}) {
  if (typeof task !== "function") throw new TypeError("task must be a function");
  const stats = {
    enabled: Boolean(enabled),
    interval_ms: enabled ? intervalMs : null,
    attempts: 0,
    success_count: 0,
    failure_count: 0,
    lost_ownership_count: 0,
    last_error: null,
    aborted: false,
    abort_reason: null
  };
  const taskAbort = new AbortController();
  if (!enabled || !job.id || !job.lease_owner) {
    return { value: await task(stats, taskAbort.signal), heartbeat: stats };
  }

  let stopped = false;
  let timer = null;
  let inFlight = Promise.resolve();
  const abortTask = (reason, cause = null) => {
    if (taskAbort.signal.aborted) return;
    stopped = true;
    stats.aborted = true;
    stats.abort_reason = reason;
    const error = Object.assign(new Error(reason), {
      name: "AbortError",
      code: reason === "lease_ownership_lost"
        ? "QUEUE_LEASE_LOST"
        : "QUEUE_LEASE_RENEWAL_FAILED",
      retryable: reason !== "lease_ownership_lost",
      cause: cause || undefined
    });
    taskAbort.abort(error);
  };
  const pulse = async () => {
    stats.attempts += 1;
    let result;
    try {
      result = await heartbeat({
        jobId: job.id,
        workerId: job.lease_owner,
        leaseSeconds
      });
    } catch (error) {
      stats.failure_count += 1;
      stats.last_error = safeError(error);
      abortTask("lease_renewal_failed", error);
      return;
    }
    if (result?.extended) {
      stats.success_count += 1;
    } else if (result?.error) {
      stats.failure_count += 1;
      stats.last_error = safeError(result.error);
      abortTask("lease_renewal_failed", result.error);
    } else if (result?.skipped) {
      stats.failure_count += 1;
      stats.last_error = "lease_renewal_skipped";
      abortTask("lease_renewal_failed");
    } else {
      stats.lost_ownership_count += 1;
      stats.last_error = "lease_ownership_lost";
      abortTask("lease_ownership_lost");
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = pulse()
        .catch((error) => {
          stats.failure_count += 1;
          stats.last_error = safeError(error);
          abortTask("lease_renewal_failed", error);
        })
        .finally(schedule);
    }, intervalMs);
    timer.unref?.();
  };
  schedule();
  try {
    return { value: await task(stats, taskAbort.signal), heartbeat: stats };
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight.catch(() => null);
  }
}

async function runJob(job, req, signal = null) {
  const started = Date.now();
  const payload = payloadForV4ProductionJob(job);
  const response = await callJsonHandler(v4ListingHandler, {
    method: "POST",
    headers: {
      [workerSecretHeader]: req.headers[workerSecretHeader] || req.headers[workerSecretHeader.toLowerCase()] || "",
      "user-agent": "lynca-v4-production-worker",
      "x-forwarded-for": "v4-production-worker"
    },
    payload,
    signal
  });
  const latencyMs = Date.now() - started;
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.body?.ok) {
    const failureReason = response.body?.message
      || response.body?.failure_reason
      || response.body?.provider_result?.failure_reason
      || response.body?.provider_result?.provider_error_type
      || `v4_handler_failed_${response.statusCode}`;
    throw Object.assign(new Error(failureReason), {
      code: v4JobFailureCode(response),
      http_status: response.statusCode,
      body: response.body,
      latency_ms: latencyMs
    });
  }
  return {
    latency_ms: latencyMs,
    response: response.body
  };
}

async function releaseProviderCapacity(job = {}) {
  const release = await releaseV4ProviderCapacityForJob({
    jobId: job.id,
    workerId: job.lease_owner || null
  });
  if (release.error) {
    console.error("[v4_provider_capacity_release_failed]", JSON.stringify({
      job_id: job.id || null,
      worker_id: job.lease_owner || null,
      error: release.error
    }));
  }
  return release;
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-worker" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!isV4WorkerRequest(req, process.env)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized worker" }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_worker",
    limit: 240,
    windowMs: 60_000,
    identifier: "v4-production-worker",
    message: "Too many V4 worker drain requests. Please try again shortly."
  })) return;

  if (!v4QueueConfigured(process.env)) {
    sendJson(res, 503, withV4Version({ ok: false, message: "V4 production queue is not configured." }));
    return;
  }

  let payload = {};
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const lane = payload.lane || payload.queue_lane || payload.queueLane || null;
  const tenantId = payload.tenant_id || payload.tenantId || null;
  if (tenantId) bindProductionRequestContext(res, { tenantId, actorType: "WORKER" });
  const workerId = workerIdFrom(req, payload);
  const limit = positiveInteger(payload.limit, v4WorkerClaimLimit(process.env), { min: 1, max: 96 });
  const processBatch = async (rows = [], concurrency = 1, leaseSeconds = 300) => mapWithConcurrency(rows, concurrency, async (job) => {
    const wrapped = await runWithV4JobLeaseHeartbeat({
      job,
      leaseSeconds,
      task: async (leaseHeartbeat, signal) => {
        let capacityRelease = null;
        let completion = null;
        let attemptUsage = v4ResponseUsage();
        let providerCallEventAttempted = false;
        try {
          await recordJobProductionEvent(job, "recognition_started", {
            success: null,
            metadata: { lane: job.lane || null, attempt: Number(job.attempt_count || 0) + 1 }
          });
          const result = await runJob(job, req, signal);
          attemptUsage = v4ResponseUsage(result.response);
          if (attemptUsage.providerCalls > 0) {
            providerCallEventAttempted = true;
            await recordJobProductionEvent(job, "provider_called", {
              ...attemptUsage,
              durationMs: result.latency_ms,
              success: true,
              metadata: providerEventMetadata(attemptUsage)
            });
          }
          const jobStatus = completionStatusForJob(job);
          const writerReadyCapacityRelease = result.response.v4_persistence?.writer_ready_provider_capacity_release || null;
          const writerReadyCapacityRefill = result.response.v4_persistence?.writer_ready_provider_capacity_refill || null;
          const tailStartedAt = Date.now();
          let capacityReleaseMs = 0;
          let completionWriteMs = 0;
          const capacityReleasePromise = writerReadyCapacityRelease?.released === true
            ? Promise.resolve({
              ...writerReadyCapacityRelease,
              released: true,
              already_released_at_writer_ready: true
            })
            : (async () => {
              const startedAt = Date.now();
              const released = await releaseProviderCapacity(job);
              capacityReleaseMs = Date.now() - startedAt;
              return released;
            })();
          const completionPromise = (async () => {
            const startedAt = Date.now();
            const completed = await completeV4RecognitionJob({
              jobId: job.id,
              workerId: job.lease_owner || null,
              status: jobStatus,
              result: {
                ok: true,
                lane: job.lane || null,
                job_type: normalizedJobType(job),
                recognition_session_id: result.response.recognition_session_id || job.recognition_session_id,
                final_title: result.response.final_title || result.response.title || result.response.writer_safe_draft || null,
                title_stage: result.response.title_stage || null,
                assisted_draft_status: result.response.assisted_draft_status || null,
                route: result.response.route || result.response.route_plan?.route || null
              },
              timing: {
                worker_total_ms: result.latency_ms,
                response_timing: result.response.provider_result?.timing || result.response.module_speed_metrics || null,
                writer_ready_capacity_release: writerReadyCapacityRelease,
                writer_ready_capacity_refill: writerReadyCapacityRefill,
                lease_heartbeat: { ...leaseHeartbeat }
              },
              previousError: job.error || null
            });
            completionWriteMs = Date.now() - startedAt;
            return completed;
          })();
          [capacityRelease, completion] = await Promise.all([capacityReleasePromise, completionPromise]);
          const postHandlerTailMs = Date.now() - tailStartedAt;
          console.log("[v4_worker_post_handler_tail]", JSON.stringify({
            job_id: job.id || null,
            writer_ready_capacity_release_mode: writerReadyCapacityRelease?.release_boundary || "worker_tail",
            provider_capacity_released_at_writer_ready: writerReadyCapacityRelease?.released === true,
            writer_ready_capacity_refill_triggered: writerReadyCapacityRefill?.triggered === true,
            capacity_release_ms: capacityReleaseMs,
            completion_write_ms: completionWriteMs,
            post_handler_tail_ms: postHandlerTailMs
          }));
          if (completion.saved !== true) {
            const leaseLost = completion.error === "row_not_matched";
            throw Object.assign(new Error(`${leaseLost ? "queue_lease_lost" : "queue_completion_write_failed"}:${completion.error || "unknown_error"}`), {
              code: leaseLost ? "QUEUE_LEASE_LOST" : "QUEUE_COMPLETION_WRITE_FAILED",
              retryable: leaseLost ? false : undefined,
              latency_ms: result.latency_ms
            });
          }
          await recordJobProductionEvent(job, "recognition_completed", {
            ...attemptUsage,
            durationMs: result.latency_ms,
            success: true,
            metadata: providerEventMetadata(attemptUsage, { completion_status: jobStatus })
          });
          const pairedRelease = normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT
            ? await releasePairedV4FinalJob({ job, reason: "l1_ready" })
            : { saved: false, skipped: true };
          const pairedWake = normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT
            ? triggerV4BackgroundWorkerAfterL1Release(req, { job, pairedRelease, reason: "l1_ready_wake_l2" })
            : { triggered: false, reason: "not_l1_job" };
          return {
            job_id: job.id,
            lane: job.lane || null,
            job_type: normalizedJobType(job),
            status: jobStatus,
            recognition_session_id: result.response.recognition_session_id || job.recognition_session_id,
            latency_ms: result.latency_ms,
            saved: completion.saved,
            completion_write_attempts: completion.write_attempts || 1,
            capacity_release_ms: capacityReleaseMs,
            completion_write_ms: completionWriteMs,
            post_handler_tail_ms: postHandlerTailMs,
            provider_capacity_released_at_writer_ready: writerReadyCapacityRelease?.released === true,
            provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
            provider_key_slot: Number(job.queue_tags?.provider_key_slot || 0) || null,
            provider_capacity_released: capacityRelease.released === true,
            paired_final_released: pairedRelease.saved === true,
            paired_final_wake_triggered: pairedWake.triggered === true,
            error: completion.error || null
          };
        } catch (error) {
          const hiddenL1Job = normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT;
          console.error("[v4_job_attempt_failed]", JSON.stringify({
            job_id: job.id || null,
            job_type: normalizedJobType(job),
            lane: job.lane || null,
            attempt_count: Number(job.attempt_count || 0),
            code: error?.code || error?.status || null,
            message: safeError(error),
            latency_ms: error?.latency_ms || null
          }));
          const failureResponseUsage = v4ResponseUsage(error?.body || {});
          if (failureResponseUsage.observed) attemptUsage = failureResponseUsage;
          if (!providerCallEventAttempted && attemptUsage.providerCalls > 0) {
            providerCallEventAttempted = true;
            await recordJobProductionEvent(job, "provider_called", {
              ...attemptUsage,
              durationMs: error?.latency_ms || null,
              success: false,
              metadata: providerEventMetadata(attemptUsage, {
                error_type: error?.code || "V4_JOB_FAILED"
              })
            });
          }
          const failure = await failV4RecognitionJob({
            job,
            error: {
              message: safeError(error),
              code: error?.code || null,
              http_status: error?.http_status || error?.status || null,
              retryable: error?.retryable,
              body: error?.body ? {
                message: error.body.message ? sanitizeOperationalText(error.body.message, 500) : null,
                ok: error.body.ok || false
              } : null
            },
            forceFinalFailure: hiddenL1Job
          });
          await recordJobProductionEvent(job, "recognition_failed", {
            ...attemptUsage,
            durationMs: error?.latency_ms || null,
            success: false,
            metadata: providerEventMetadata(attemptUsage, {
              error_type: error?.code || "V4_JOB_FAILED",
              recoverable: failure.row?.status === v4JobStatuses.RETRYING
            })
          });
          await persistErrorLog({
            error,
            errorType: error?.code || "V4_JOB_FAILED",
            recoverable: failure.row?.status === v4JobStatuses.RETRYING,
            context: operationalContextForJob(job),
            sessionId: job.recognition_session_id || null,
            jobId: job.id || null
          });
          capacityRelease = failure.capacity_release_handled === true
            ? {
              released: true,
              released_count: null,
              release_boundary: "atomic_failure_transition",
              transition_mode: failure.transition_mode
            }
            : (capacityRelease || await releaseProviderCapacity(job));
          const retryWake = hiddenL1Job
            ? { triggered: false, reason: "hidden_l1_final_failure" }
            : triggerV4RetryWake({ job, failure });
          const { pairedRelease, pairedWake, leaseLost } = await handlePairedV4FinalAfterL1Failure(req, {
            job,
            failure,
            error
          });
          return {
            job_id: job.id,
            lane: job.lane || null,
            job_type: normalizedJobType(job),
            status: failure.row?.status || (leaseLost ? "LEASE_LOST" : "FAILED"),
            recognition_session_id: job.recognition_session_id,
            latency_ms: error?.latency_ms || null,
            saved: failure.saved,
            provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
            provider_key_slot: Number(job.queue_tags?.provider_key_slot || 0) || null,
            provider_capacity_released: capacityRelease.released === true,
            retry_planned: failure.retry_plan?.shouldRetry === true,
            retry_delay_seconds: failure.retry_plan?.retryDelaySeconds ?? null,
            retry_wake_triggered: retryWake.triggered === true,
            retry_wake_reason: retryWake.reason || null,
            paired_final_released: pairedRelease.saved === true,
            paired_final_wake_triggered: pairedWake.triggered === true,
            error: failure.error || safeError(error)
          };
        }
      }
    });
    const heartbeat = wrapped.heartbeat;
    if (heartbeat.failure_count > 0 || heartbeat.lost_ownership_count > 0) {
      console.warn("[v4_job_lease_heartbeat_degraded]", JSON.stringify({
        job_id: job.id || null,
        worker_id: job.lease_owner || null,
        ...heartbeat
      }));
    }
    return {
      ...wrapped.value,
      lease_heartbeat: heartbeat
    };
  });

  const startedAt = Date.now();
  const maxWaitMs = positiveInteger(payload.max_wait_ms ?? payload.maxWaitMs, v4WorkerMaxWaitMs(process.env), { min: 5_000, max: 240_000 });
  const maxBatches = shouldDrainLoop(payload)
    ? positiveInteger(payload.max_batches_per_invocation ?? payload.maxBatchesPerInvocation ?? process.env.V4_JOB_WORKER_MAX_BATCHES_PER_INVOCATION, 3, { min: 1, max: 10 })
    : 1;
  const emptyClaimStop = String(payload.empty_claim_stop ?? payload.emptyClaimStop ?? process.env.V4_JOB_WORKER_EMPTY_CLAIM_STOP ?? "true").toLowerCase() !== "false";
  const batches = [];
  let processed = [];
  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    if (Date.now() - startedAt > maxWaitMs - 2_000) break;
    const claimStarted = Date.now();
    const leaseSeconds = laneLeaseSeconds(lane, payload);
    const claim = await claimV4RecognitionJobs({
      limit,
      workerId: `${workerId}-b${batchIndex + 1}`,
      leaseSeconds,
      lane,
      tenantId
    });
    if (!claim.ok) {
      sendJson(res, 500, withV4Version({ ok: false, message: "Unable to claim V4 jobs.", error: claim.error }));
      return;
    }
    const concurrency = laneProcessConcurrency(lane, payload);
    const batchRows = Array.isArray(claim.rows) ? claim.rows : [];
    const batchProcessed = await processBatch(batchRows, concurrency, leaseSeconds);
    processed = processed.concat(batchProcessed);
    batches.push({
      batch_index: batchIndex + 1,
      lane: lane || null,
      claimed_count: batchRows.length,
      processed_count: batchProcessed.length,
      process_concurrency: concurrency,
      lease_seconds: leaseSeconds,
      worker_claim_latency_ms: Date.now() - claimStarted
    });
    if (!batchRows.length && emptyClaimStop) break;
  }

  sendJson(res, 200, withV4Version({
    ok: true,
    worker_id: workerId,
    lane: lane || null,
    tenant_id: tenantId || null,
    process_concurrency: batches[0]?.process_concurrency || laneProcessConcurrency(lane, payload),
    claimed_count: batches.reduce((sum, batch) => sum + Number(batch.claimed_count || 0), 0),
    processed_count: processed.length,
    batches_claimed: batches.filter((batch) => Number(batch.claimed_count || 0) > 0).length,
    batches_run: batches.length,
    jobs_processed_per_invocation: processed.length,
    worker_elapsed_ms: Date.now() - startedAt,
    batches,
    jobs: processed
  }));
}
