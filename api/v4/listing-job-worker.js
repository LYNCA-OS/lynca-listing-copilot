import { waitUntil } from "@vercel/functions";
import v4ListingHandler from "./listing-copilot-title.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  failV4RecognitionJob,
  heartbeatV4RecognitionJob,
  releaseV4ProviderCapacityForJob,
  releasePairedV4FinalJob,
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
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 500);
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

function headerValue(req, name) {
  const lower = String(name || "").toLowerCase();
  const value = req?.headers?.[lower] ?? req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function requestOrigin(req) {
  const host = headerValue(req, "x-forwarded-host") || headerValue(req, "host");
  if (!host) return "";
  const proto = headerValue(req, "x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

function workerSecretFromRequest(req) {
  return headerValue(req, workerSecretHeader);
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
    provider: basePayload.provider || job.provider_id || "openai_legacy",
    provider_id: basePayload.provider_id || job.provider_id || "openai_legacy",
    vision_provider: basePayload.vision_provider || job.provider_id || "openai_legacy",
    v4_queue_job_id: job.id || basePayload.v4_queue_job_id || basePayload.job_id || undefined,
    v4_queue_worker_id: job.lease_owner || basePayload.v4_queue_worker_id || undefined,
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

function triggerV4BackgroundWorkerAfterL1Release(req, {
  job = {},
  pairedRelease = {},
  reason = "l1_released_paired_l2"
} = {}) {
  if (pairedRelease.saved !== true) return { triggered: false, reason: "paired_l2_not_released" };
  const origin = requestOrigin(req);
  const secret = workerSecretFromRequest(req);
  if (!secret) return { triggered: false, reason: "wake_secret_missing" };
  const processConcurrency = positiveInteger(process.env.V4_L2_WAKE_BACKGROUND_CONCURRENCY, v4WorkerProcessConcurrency(process.env), { min: 1, max: 96 });
  const body = {
    lane: v4JobLanes.BACKGROUND,
    tenant_id: job.tenant_id || job.payload?.tenant_id || null,
    limit: processConcurrency,
    process_concurrency: processConcurrency,
    retry_delay_seconds: 8,
    worker_id: `v4-l2-wake-${String(job.id || "job").slice(0, 96)}`,
    reason
  };
  const headers = {
    "content-type": "application/json",
    [workerSecretHeader]: secret,
    "user-agent": "lynca-v4-l1-l2-wake",
    "x-forwarded-for": "v4-l1-l2-wake"
  };
  const wakePromise = origin
    ? fetch(`${origin}/api/v4/listing-job-worker`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }).catch(() => null)
    : callJsonHandler(handler, {
      method: "POST",
      headers,
      payload: body
    }).catch(() => null);
  waitUntil(wakePromise);
  return { triggered: true, reason };
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
    last_error: null
  };
  if (!enabled || !job.id || !job.lease_owner) {
    return { value: await task(stats), heartbeat: stats };
  }

  let stopped = false;
  let timer = null;
  let inFlight = Promise.resolve();
  const pulse = async () => {
    stats.attempts += 1;
    const result = await heartbeat({
      jobId: job.id,
      workerId: job.lease_owner,
      leaseSeconds
    });
    if (result.extended) {
      stats.success_count += 1;
    } else if (!result.skipped && result.error) {
      stats.failure_count += 1;
      stats.last_error = safeError(result.error);
    } else if (!result.skipped) {
      stats.lost_ownership_count += 1;
      stats.last_error = "lease_ownership_lost";
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = pulse()
        .catch((error) => {
          stats.failure_count += 1;
          stats.last_error = safeError(error);
        })
        .finally(schedule);
    }, intervalMs);
    timer.unref?.();
  };
  schedule();
  try {
    return { value: await task(stats), heartbeat: stats };
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight.catch(() => null);
  }
}

async function runJob(job, req) {
  const started = Date.now();
  const payload = payloadForV4ProductionJob(job);
  const response = await callJsonHandler(v4ListingHandler, {
    method: "POST",
    headers: {
      [workerSecretHeader]: req.headers[workerSecretHeader] || req.headers[workerSecretHeader.toLowerCase()] || "",
      "user-agent": "lynca-v4-production-worker",
      "x-forwarded-for": "v4-production-worker"
    },
    payload
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
  const workerId = workerIdFrom(req, payload);
  const limit = positiveInteger(payload.limit, v4WorkerClaimLimit(process.env), { min: 1, max: 96 });
  const processBatch = async (rows = [], concurrency = 1, leaseSeconds = 300) => mapWithConcurrency(rows, concurrency, async (job) => {
    const wrapped = await runWithV4JobLeaseHeartbeat({
      job,
      leaseSeconds,
      task: async (leaseHeartbeat) => {
        let capacityRelease = null;
        let completion = null;
        try {
          const result = await runJob(job, req);
          const jobStatus = completionStatusForJob(job);
          const writerReadyCapacityRelease = result.response.v4_persistence?.writer_ready_provider_capacity_release || null;
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
          capacityRelease = capacityRelease || await releaseProviderCapacity(job);
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
          const failure = await failV4RecognitionJob({
            job,
            error: {
              message: safeError(error),
              code: error?.code || null,
              http_status: error?.http_status || error?.status || null,
              retryable: error?.retryable,
              body: error?.body ? { message: error.body.message || null, ok: error.body.ok || false } : null
            },
            forceFinalFailure: hiddenL1Job,
            retryDelaySeconds: positiveInteger(payload.retry_delay_seconds, 15, { min: 1, max: 900 })
          });
          const pairedRelease = hiddenL1Job
            ? await releasePairedV4FinalJob({ job, reason: "l1_failed_release_final" })
            : { saved: false, skipped: true };
          const pairedWake = hiddenL1Job
            ? triggerV4BackgroundWorkerAfterL1Release(req, { job, pairedRelease, reason: "l1_failed_wake_l2" })
            : { triggered: false, reason: "not_l1_job" };
          const leaseLost = error?.code === "QUEUE_LEASE_LOST" || failure.error === "row_not_matched";
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
