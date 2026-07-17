import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import listingJobWorkerHandler from "./listing-job-worker.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import {
  v4JobLanes,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import {
  configuredWorkerSecret,
  isV4CronRequest,
  isV4WorkerRequest,
  workerSecretHeader
} from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { scheduleTrustedV4QueuePump } from "../../lib/listing/v4/jobs/internal-queue-wake.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function headerValue(req, name) {
  const lower = String(name || "").toLowerCase();
  const value = req?.headers?.[lower] ?? req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function urlFromRequest(req) {
  const host = headerValue(req, "host") || "localhost";
  return new URL(req.url || "/", `https://${host}`);
}

function payloadFromQuery(req) {
  const url = urlFromRequest(req);
  return Object.fromEntries(url.searchParams.entries());
}

function boolFlag(value) {
  return /^(?:1|true|yes)$/i.test(String(value || ""));
}

function falseFlag(value) {
  return /^(?:0|false|no)$/i.test(String(value || ""));
}

function zeroBasedInteger(value, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, parsed));
}

function lanePlanFromPayload(payload = {}) {
  if (boolFlag(payload.interactive_only)) return [v4JobLanes.INTERACTIVE];
  if (boolFlag(payload.background_only)) return [v4JobLanes.BACKGROUND];
  return [v4JobLanes.INTERACTIVE, v4JobLanes.BACKGROUND];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function defaultInvokeWorker(payload, { workerSecret }) {
  return callJsonHandler(listingJobWorkerHandler, {
    method: "POST",
    headers: {
      [workerSecretHeader]: workerSecret,
      "user-agent": "lynca-v4-job-pump",
      "x-forwarded-for": "v4-job-pump"
    },
    payload
  });
}

async function invokeWorkerWithTransientRetry(
  invokeWorker,
  workerPayload,
  context,
  { maxAttempts = 2, retryDelayMs = 120 } = {}
) {
  let response = null;
  let lastError = null;
  let attempts = 0;
  let transientFailureCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    lastError = null;
    try {
      response = await invokeWorker(workerPayload, context);
    } catch (error) {
      lastError = error;
      response = {
        statusCode: 0,
        body: {
          ok: false,
          message: String(error?.message || "V4 worker invocation failed.").slice(0, 240)
        }
      };
    }

    const statusCode = Number(response?.statusCode || 0);
    const retryable = statusCode === 0 || statusCode >= 500;
    if (!retryable || attempt >= maxAttempts) break;
    transientFailureCount += 1;
    await delay(retryDelayMs * attempt);
  }

  const statusCode = Number(response?.statusCode || 0);
  const finalOk = statusCode >= 200
    && statusCode < 300
    && response?.body?.ok !== false;
  return {
    response,
    attempts,
    retryCount: Math.max(0, attempts - 1),
    transientFailureCount,
    recoveredAfterRetry: attempts > 1 && finalOk,
    lastError: lastError ? String(lastError?.message || lastError).slice(0, 240) : null
  };
}

export async function runV4QueuePump({
  payload = {},
  env = process.env,
  invokeWorker = defaultInvokeWorker,
  now = () => Date.now()
} = {}) {
  const workerSecret = configuredWorkerSecret(env);
  if (!workerSecret) {
    return {
      ok: false,
      message: "V4 worker secret is not configured.",
      cycles_run: 0,
      calls: []
    };
  }

  const started = now();
  const pumpRunId = String(payload.pump_run_id || payload.pumpRunId || crypto.randomUUID()).slice(0, 96);
  const maxCycles = positiveInteger(payload.cycles ?? payload.max_cycles, 1, { min: 1, max: 30 });
  const limit = positiveInteger(payload.limit, v4WorkerProcessConcurrency(env), { min: 1, max: 96 });
  const processConcurrency = positiveInteger(
    payload.process_concurrency ?? payload.processConcurrency,
    v4WorkerProcessConcurrency(env),
    { min: 1, max: 96 }
  );
  const interactiveLimit = positiveInteger(
    payload.interactive_limit ?? payload.interactiveLimit,
    limit,
    { min: 1, max: 96 }
  );
  const backgroundLimit = positiveInteger(
    payload.background_limit ?? payload.backgroundLimit,
    limit,
    { min: 1, max: 96 }
  );
  const interactiveProcessConcurrency = positiveInteger(
    payload.interactive_process_concurrency ?? payload.interactiveProcessConcurrency,
    processConcurrency,
    { min: 1, max: 96 }
  );
  const backgroundProcessConcurrency = positiveInteger(
    payload.background_process_concurrency ?? payload.backgroundProcessConcurrency,
    processConcurrency,
    { min: 1, max: 96 }
  );
  const maxRuntimeMs = positiveInteger(payload.max_runtime_ms ?? payload.maxRuntimeMs, 120_000, { min: 5_000, max: 290_000 });
  const leaseSeconds = positiveInteger(payload.lease_seconds ?? payload.leaseSeconds, 120, { min: 30, max: 900 });
  const tenantId = payload.tenant_id || payload.tenantId || null;
  const lanes = lanePlanFromPayload(payload);
  const parallelLanes = lanes.length > 1 && !falseFlag(payload.parallel_lanes ?? payload.parallelLanes);
  const idleDelayMs = positiveInteger(payload.idle_delay_ms ?? payload.idleDelayMs, 0, { min: 0, max: 30_000 });
  const defaultIdleCycles = positiveInteger(payload.idle_cycles_before_stop ?? payload.idleCyclesBeforeStop, 1, { min: 1, max: 60 });
  const backgroundIdleCycles = positiveInteger(
    payload.background_idle_cycles ?? payload.backgroundIdleCycles,
    defaultIdleCycles,
    { min: 1, max: 120 }
  );
  const calls = [];
  let totalClaimed = 0;
  let totalProcessed = 0;
  let workerInvocationRetryCount = 0;
  let workerInvocationRecoveryCount = 0;
  let transientWorkerFailureCount = 0;
  const laneSummaries = [];

  async function runLane(lane) {
    const stopAfterIdle = lane === v4JobLanes.BACKGROUND ? backgroundIdleCycles : defaultIdleCycles;
    let laneCycles = 0;
    let idleCycles = 0;
    let laneClaimed = 0;
    let laneProcessed = 0;
    let lastClaimed = 0;
    let stopReason = "max_cycles";
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      if (now() - started >= maxRuntimeMs) {
        stopReason = "runtime_budget";
        break;
      }
      laneCycles += 1;
      const callStarted = now();
      const laneLimit = lane === v4JobLanes.BACKGROUND ? backgroundLimit : interactiveLimit;
      const laneProcessConcurrency = lane === v4JobLanes.BACKGROUND ? backgroundProcessConcurrency : interactiveProcessConcurrency;
      const workerPayload = {
        lane,
        tenant_id: tenantId,
        limit: laneLimit,
        process_concurrency: laneProcessConcurrency,
        lease_seconds: leaseSeconds,
        max_batches_per_invocation: 1,
        worker_id: `v4-pump-${pumpRunId}-${lane}-${cycle + 1}`.slice(0, 120)
      };
      const invocation = await invokeWorkerWithTransientRetry(
        invokeWorker,
        workerPayload,
        { workerSecret, env }
      );
      const response = invocation.response;
      workerInvocationRetryCount += invocation.retryCount;
      transientWorkerFailureCount += invocation.transientFailureCount;
      if (invocation.recoveredAfterRetry) workerInvocationRecoveryCount += 1;
      const body = response?.body || {};
      const claimed = positiveInteger(body.claimed_count, 0, { min: 0, max: 10_000 });
      const processed = positiveInteger(body.processed_count, 0, { min: 0, max: 10_000 });
      totalClaimed += claimed;
      totalProcessed += processed;
      laneClaimed += claimed;
      laneProcessed += processed;
      lastClaimed = claimed;
      calls.push({
        cycle: cycle + 1,
        lane,
        status_code: response?.statusCode || 0,
        ok: response?.statusCode >= 200 && response?.statusCode < 300 && body.ok !== false,
        claimed_count: claimed,
        processed_count: processed,
        invocation_attempt_count: invocation.attempts,
        invocation_retry_count: invocation.retryCount,
        invocation_recovered_after_retry: invocation.recoveredAfterRetry,
        invocation_error: invocation.lastError,
        latency_ms: now() - callStarted,
        message: body.message || null
      });

      if (!claimed) {
        idleCycles += 1;
        if (idleCycles >= stopAfterIdle) {
          stopReason = "idle_observed";
          break;
        }
        if (idleDelayMs > 0) await delay(idleDelayMs);
      } else {
        idleCycles = 0;
      }
    }
    return {
      lane,
      cycles_run: laneCycles,
      claimed_count: laneClaimed,
      processed_count: laneProcessed,
      last_claimed_count: lastClaimed,
      stop_reason: stopReason,
      continuation_needed: lastClaimed > 0 && ["max_cycles", "runtime_budget"].includes(stopReason)
    };
  }

  if (parallelLanes) {
    laneSummaries.push(...await Promise.all(lanes.map((lane) => runLane(lane))));
  } else {
    for (const lane of lanes) {
      laneSummaries.push(await runLane(lane));
    }
  }

  const failedCalls = calls.filter((call) => call.ok !== true);
  const continuationNeeded = failedCalls.length === 0
    && laneSummaries.some((summary) => summary.continuation_needed === true);

  return {
    ok: failedCalls.length === 0,
    pump_run_id: pumpRunId,
    tenant_id: tenantId,
    cycles_run: Math.max(0, ...laneSummaries.map((summary) => summary.cycles_run || 0)),
    lanes,
    parallel_lanes: parallelLanes,
    limit,
    process_concurrency: processConcurrency,
    lease_seconds: leaseSeconds,
    interactive_limit: interactiveLimit,
    background_limit: backgroundLimit,
    interactive_process_concurrency: interactiveProcessConcurrency,
    background_process_concurrency: backgroundProcessConcurrency,
    idle_delay_ms: idleDelayMs,
    idle_cycles_before_stop: defaultIdleCycles,
    background_idle_cycles: backgroundIdleCycles,
    claimed_count: totalClaimed,
    processed_count: totalProcessed,
    worker_invocation_retry_count: workerInvocationRetryCount,
    worker_invocation_recovery_count: workerInvocationRecoveryCount,
    transient_worker_failure_count: transientWorkerFailureCount,
    failed_call_count: failedCalls.length,
    failed_calls: failedCalls.slice(0, 8),
    continuation_needed: continuationNeeded,
    elapsed_ms: now() - started,
    lane_summaries: laneSummaries,
    calls
  };
}

export function triggerV4QueuePumpContinuation(
  _req,
  payload = {},
  result = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil
) {
  if (falseFlag(payload.enable_continuation ?? payload.enableContinuation ?? "true")) {
    return { triggered: false, reason: "disabled" };
  }
  if (Number(result.claimed_count || 0) <= 0) {
    return { triggered: false, reason: "no_claimed_jobs" };
  }
  if (result.continuation_needed === false) {
    return { triggered: false, reason: "idle_observed_after_work" };
  }
  const depth = zeroBasedInteger(payload.continuation_depth ?? payload.continuationDepth, 0, { max: 100 });
  const maxDepth = zeroBasedInteger(payload.max_continuation_depth ?? payload.maxContinuationDepth, 100, { max: 100 });
  if (depth >= maxDepth) {
    return { triggered: false, reason: "max_continuation_depth_reached", depth, max_depth: maxDepth };
  }
  const secret = configuredWorkerSecret(env);
  if (!secret) return { triggered: false, reason: "worker_secret_missing" };

  const body = {
    ...payload,
    cycles: positiveInteger(payload.continuation_cycles ?? payload.continuationCycles, 1, { min: 1, max: 4 }),
    max_runtime_ms: positiveInteger(
      payload.continuation_max_runtime_ms ?? payload.continuationMaxRuntimeMs ?? payload.max_runtime_ms ?? payload.maxRuntimeMs,
      120_000,
      { min: 5_000, max: 240_000 }
    ),
    idle_delay_ms: 0,
    idle_cycles_before_stop: 1,
    background_idle_cycles: 1,
    detached: true,
    continuation_depth: depth + 1,
    max_continuation_depth: maxDepth,
    reason: "pump_continuation"
  };
  const scheduled = scheduleTrustedV4QueuePump({
    payload: body,
    reason: "pump_continuation",
    env,
    fetchImpl,
    defer
  });
  return {
    triggered: scheduled.triggered,
    reason: scheduled.triggered ? "claimed_jobs_remaining_possible" : scheduled.reason,
    depth: depth + 1,
    max_depth: maxDepth,
    completion: scheduled.completion
  };
}

function logPumpFailure(result = {}) {
  if (result.ok) return;
  console.error(JSON.stringify({
    level: "error",
    message: "v4_queue_pump_worker_failure",
    pump_run_id: result.pump_run_id || null,
    failed_call_count: result.failed_call_count || 0,
    failed_calls: result.failed_calls || []
  }));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-pump" });
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!isV4WorkerRequest(req, process.env) && !isV4CronRequest(req, process.env)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized pump" }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_pump",
    limit: 120,
    windowMs: 60_000,
    identifier: "v4-production-pump",
    message: "Too many V4 queue pump requests. Please try again shortly."
  })) return;

  let payload = payloadFromQuery(req);
  if (req.method === "POST") {
    try {
      payload = { ...payload, ...(await readJsonPayload(req)) };
    } catch {
      sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
      return;
    }
  }
  if (payload.tenant_id || payload.tenantId) {
    bindProductionRequestContext(res, { tenantId: payload.tenant_id || payload.tenantId, actorType: "WORKER" });
  }

  if (boolFlag(payload.detached)) {
    const completion = (async () => {
      const result = await runV4QueuePump({ payload, env: process.env });
      logPumpFailure(result);
      if (result.ok) {
        const continuation = triggerV4QueuePumpContinuation(
          req,
          payload,
          result,
          process.env,
          globalThis.fetch,
          (promise) => promise
        );
        if (continuation.completion) await continuation.completion;
      }
      return result;
    })();
    waitUntil(completion);
    sendJson(res, 202, withV4Version({
      ok: true,
      accepted: true,
      detached: true,
      reason: payload.reason || "queue_pump_detached"
    }));
    return;
  }

  const result = await runV4QueuePump({ payload, env: process.env });
  logPumpFailure(result);
  const continuation = result.ok
    ? triggerV4QueuePumpContinuation(req, payload, result, process.env)
    : { triggered: false, reason: "pump_failed" };
  sendJson(res, result.ok ? 200 : 503, withV4Version({
    ...result,
    continuation_triggered: continuation.triggered,
    continuation_reason: continuation.reason,
    continuation_depth: continuation.depth ?? null,
    max_continuation_depth: continuation.max_depth ?? null
  }));
}
