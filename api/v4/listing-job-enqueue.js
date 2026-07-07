import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import {
  createV4BatchId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  v4QueueConfigured
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function jobsFromPayload(payload = {}) {
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (payload.payload && typeof payload.payload === "object") return [{ payload: payload.payload }];
  return [payload];
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

function triggerV4QueuePumpAfterEnqueue(req, {
  tenantId,
  batchId,
  queuedCount
} = {}) {
  if (!queuedCount) return { triggered: false, reason: "no_jobs_queued" };
  const secret = configuredWorkerSecret(process.env);
  if (!secret) return { triggered: false, reason: "worker_secret_missing" };
  const origin = requestOrigin(req);
  if (!origin) return { triggered: false, reason: "request_origin_missing" };

  const body = {
    tenant_id: tenantId || batchId || null,
    limit: 2,
    process_concurrency: 2,
    cycles: 6,
    max_runtime_ms: 250_000,
    retry_delay_seconds: 8,
    reason: "post_enqueue"
  };
  waitUntil(
    fetch(`${origin}/api/v4/listing-job-pump`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [workerSecretHeader]: secret
      },
      body: JSON.stringify(body)
    }).catch(() => null)
  );
  return { triggered: true, reason: "post_enqueue", tenant_id: body.tenant_id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_enqueue",
    limit: 600,
    windowMs: 60_000,
    message: "Too many V4 job enqueue requests. Please try again shortly."
  })) return;

  if (!v4QueueConfigured(process.env)) {
    sendJson(res, 503, withV4Version({ ok: false, message: "V4 production queue is not configured." }));
    return;
  }

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const batchId = payload.batch_id || payload.batchId || createV4BatchId("v4batch");
  const operatorId = operatorIdFromRequest(req);
  const tenantId = payload.tenant_id || payload.tenantId || batchId;
  const sourceJobs = jobsFromPayload(payload);
  const stageJobs = expandV4RecognitionStageJobs({
    jobs: sourceJobs,
    batchId,
    operatorId,
    tenantId,
    priority: payload.priority || 100
  });
  const result = await enqueueV4RecognitionJobs({
    jobs: stageJobs,
    batchId,
    operatorId,
    tenantId,
    priority: payload.priority || 100
  });
  const pump = triggerV4QueuePumpAfterEnqueue(req, {
    tenantId,
    batchId: result.batchId,
    queuedCount: result.queued_count
  });

  sendJson(res, 200, withV4Version({
    ok: result.queued_count > 0,
    batch_id: result.batchId,
    tenant_id: tenantId,
    queued_count: result.queued_count,
    pump_triggered: pump.triggered,
    pump_reason: pump.reason,
    jobs: result.jobs.map((entry) => ({
      ok: entry.saved,
      job_id: entry.row?.id || null,
      lane: entry.row?.lane || null,
      job_type: entry.row?.job_type || null,
      parent_job_id: entry.row?.parent_job_id || null,
      paired_job_id: entry.row?.paired_job_id || null,
      recognition_session_id: entry.row?.recognition_session_id || null,
      asset_id: entry.row?.asset_id || null,
      status: entry.row?.status || null,
      error: entry.error || null
    }))
  }));
}
