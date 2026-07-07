import v4ListingHandler from "./listing-copilot-title.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  failV4RecognitionJob,
  v4QueueConfigured,
  v4WorkerClaimLimit,
  v4WorkerLeaseSeconds
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

function workerIdFrom(req, payload = {}) {
  return String(
    payload.worker_id ||
      payload.workerId ||
      req.headers["x-vercel-id"] ||
      req.headers["x-forwarded-for"] ||
      "v4-worker"
  ).slice(0, 120);
}

async function runJob(job, req) {
  const started = Date.now();
  const payload = {
    ...(job.payload || {}),
    recognition_session_id: job.recognition_session_id || job.payload?.recognition_session_id,
    asset_id: job.asset_id || job.payload?.asset_id || job.payload?.assetId || undefined,
    provider: job.payload?.provider || job.provider_id || "openai_legacy",
    provider_id: job.payload?.provider_id || job.provider_id || "openai_legacy",
    vision_provider: job.payload?.vision_provider || job.provider_id || "openai_legacy",
    v4_worker_synchronous: true,
    v4_force_l2_direct: true,
    disable_fast_scout_l1: true
  };
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
  const workerId = workerIdFrom(req, payload);
  const claim = await claimV4RecognitionJobs({
    limit,
    workerId,
    leaseSeconds: positiveInteger(payload.lease_seconds, v4WorkerLeaseSeconds(process.env), { min: 30, max: 900 })
  });
  if (!claim.ok) {
    sendJson(res, 500, withV4Version({ ok: false, message: "Unable to claim V4 jobs.", error: claim.error }));
    return;
  }

  const processed = [];
  for (const job of claim.rows) {
    try {
      const result = await runJob(job, req);
      const completion = await completeV4RecognitionJob({
        jobId: job.id,
        result: {
          ok: true,
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
      processed.push({
        job_id: job.id,
        status: "L2_READY",
        recognition_session_id: result.response.recognition_session_id || job.recognition_session_id,
        latency_ms: result.latency_ms,
        saved: completion.saved,
        error: completion.error || null
      });
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
      processed.push({
        job_id: job.id,
        status: failure.row?.status || "FAILED",
        recognition_session_id: job.recognition_session_id,
        latency_ms: error?.latency_ms || null,
        saved: failure.saved,
        error: failure.error || safeError(error)
      });
    }
  }

  sendJson(res, 200, withV4Version({
    ok: true,
    worker_id: workerId,
    claimed_count: claim.rows.length,
    processed_count: processed.length,
    jobs: processed
  }));
}
