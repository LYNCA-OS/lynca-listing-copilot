import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import {
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  v4QueueConfigured
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function jobsFromPayload(payload = {}) {
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (payload.payload && typeof payload.payload === "object") return [{ payload: payload.payload }];
  return [payload];
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

  const batchId = payload.batch_id || payload.batchId;
  const operatorId = operatorIdFromRequest(req);
  const tenantId = payload.tenant_id || payload.tenantId || null;
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

  sendJson(res, 200, withV4Version({
    ok: result.queued_count > 0,
    batch_id: result.batchId,
    queued_count: result.queued_count,
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
