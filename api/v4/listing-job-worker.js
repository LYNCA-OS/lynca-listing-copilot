import { waitUntil } from "@vercel/functions";
import v4ListingHandler from "./listing-copilot-title.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  failV4RecognitionJob,
  releasePairedV4FinalJob,
  v4JobLanes,
  v4JobStatuses,
  v4JobTypes,
  v4QueueConfigured,
  v4WorkerClaimLimit,
  v4WorkerLeaseSeconds,
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

export function payloadForV4ProductionJob(job = {}) {
  const jobType = normalizedJobType(job);
  const fastScoutDraft = jobType === v4JobTypes.FAST_SCOUT_DRAFT;
  const basePayload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? { ...job.payload }
    : {};
  return {
    ...basePayload,
    recognition_session_id: job.recognition_session_id || basePayload.recognition_session_id,
    asset_id: job.asset_id || basePayload.asset_id || basePayload.assetId || undefined,
    provider: basePayload.provider || job.provider_id || "openai_legacy",
    provider_id: basePayload.provider_id || job.provider_id || "openai_legacy",
    vision_provider: basePayload.vision_provider || job.provider_id || "openai_legacy",
    v4_queue_job_type: jobType,
    v4_queue_lane: job.lane || basePayload.lane || (fastScoutDraft ? v4JobLanes.INTERACTIVE : v4JobLanes.BACKGROUND),
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
  const processConcurrency = positiveInteger(process.env.V4_L2_WAKE_BACKGROUND_CONCURRENCY, 2, { min: 1, max: 4 });
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
    throw Object.assign(new Error(response.body?.message || `v4_handler_failed_${response.statusCode}`), {
      status: response.statusCode,
      body: response.body,
      latency_ms: latencyMs
    });
  }
  return {
    latency_ms: latencyMs,
    response: response.body
  };
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

  const limit = positiveInteger(payload.limit, v4WorkerClaimLimit(process.env), { min: 1, max: 12 });
  const lane = payload.lane || payload.queue_lane || payload.queueLane || null;
  const tenantId = payload.tenant_id || payload.tenantId || null;
  const workerId = workerIdFrom(req, payload);
  const claim = await claimV4RecognitionJobs({
    limit,
    workerId,
    leaseSeconds: positiveInteger(payload.lease_seconds, v4WorkerLeaseSeconds(process.env), { min: 30, max: 900 }),
    lane,
    tenantId
  });
  if (!claim.ok) {
    sendJson(res, 500, withV4Version({ ok: false, message: "Unable to claim V4 jobs.", error: claim.error }));
    return;
  }

  const concurrency = positiveInteger(payload.process_concurrency, v4WorkerProcessConcurrency(process.env), { min: 1, max: 8 });
  const processed = await mapWithConcurrency(claim.rows, concurrency, async (job) => {
    try {
      const result = await runJob(job, req);
      const jobStatus = completionStatusForJob(job);
      const completion = await completeV4RecognitionJob({
        jobId: job.id,
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
          response_timing: result.response.provider_result?.timing || result.response.module_speed_metrics || null
        }
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
        paired_final_released: pairedRelease.saved === true,
        paired_final_wake_triggered: pairedWake.triggered === true,
        error: completion.error || null
      };
    } catch (error) {
      const failure = await failV4RecognitionJob({
        job,
        error: {
          message: safeError(error),
          status: error?.status || null,
          body: error?.body ? { message: error.body.message || null, ok: error.body.ok || false } : null
        },
        retryDelaySeconds: positiveInteger(payload.retry_delay_seconds, 15, { min: 1, max: 900 })
      });
      const pairedRelease = normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT
        ? await releasePairedV4FinalJob({ job, reason: "l1_failed_release_final" })
        : { saved: false, skipped: true };
      const pairedWake = normalizedJobType(job) === v4JobTypes.FAST_SCOUT_DRAFT
        ? triggerV4BackgroundWorkerAfterL1Release(req, { job, pairedRelease, reason: "l1_failed_wake_l2" })
        : { triggered: false, reason: "not_l1_job" };
      return {
        job_id: job.id,
        lane: job.lane || null,
        job_type: normalizedJobType(job),
        status: failure.row?.status || "FAILED",
        recognition_session_id: job.recognition_session_id,
        latency_ms: error?.latency_ms || null,
        saved: failure.saved,
        paired_final_released: pairedRelease.saved === true,
        paired_final_wake_triggered: pairedWake.triggered === true,
        error: failure.error || safeError(error)
      };
    }
  });

  sendJson(res, 200, withV4Version({
    ok: true,
    worker_id: workerId,
    lane: lane || null,
    tenant_id: tenantId || null,
    process_concurrency: concurrency,
    claimed_count: claim.rows.length,
    processed_count: processed.length,
    jobs: processed
  }));
}
