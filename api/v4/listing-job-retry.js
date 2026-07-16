import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { retryV4RecognitionJob } from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
import { triggerV4QueuePumpAfterEnqueue } from "./listing-job-enqueue.js";

function statusForRetryFailure(result = {}) {
  if (result.error_code === "V4_JOB_RETRY_NOT_FOUND") return 404;
  if (result.error_code === "V4_JOB_RETRY_NOT_ALLOWED") return 409;
  if (result.error_code === "V4_JOB_RETRY_STATE_CHANGED") return 409;
  if (result.error_code === "V4_JOB_RETRY_JOB_ID_REQUIRED") return 400;
  if (result.error_code === "V4_JOB_RETRY_OPERATOR_REQUIRED") return 401;
  return 503;
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-retry" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, retryable: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    requirePermission(context, TENANT_PERMISSIONS.RETRY_JOB);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version({
      ...publicTenantAuthError(error),
      retryable: false
    }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_retry",
    limit: 120,
    windowMs: 60_000,
    message: "Too many retry requests. Please wait briefly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_RETRY_INVALID_REQUEST",
      message: "Invalid request."
    }));
    return;
  }

  const jobId = String(payload.job_id || payload.jobId || "").trim();
  if (!jobId) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_RETRY_JOB_ID_REQUIRED",
      message: "job_id is required."
    }));
    return;
  }

  const result = await retryV4RecognitionJob({
    jobId,
    operatorId: context.userId,
    tenantId: context.tenantId
  });
  if (!result.saved) {
    sendJson(res, statusForRetryFailure(result), withV4Version({
      ok: false,
      retryable: result.retryable === true,
      error_code: result.error_code || "V4_JOB_RETRY_FAILED",
      message: result.error || "Unable to retry recognition job."
    }));
    return;
  }

  const row = result.row || {};
  const pump = triggerV4QueuePumpAfterEnqueue(req, {
    tenantId: context.tenantId,
    batchId: row.batch_id || null,
    // Re-kick even when a repeated writer click finds the job already queued.
    // The kick lease coalesces duplicates, while a transiently missed pump can
    // no longer leave that writer waiting until the cron tick.
    queuedCount: 1
  });
  sendJson(res, 200, withV4Version({
    ok: true,
    retryable: false,
    already_active: result.already_active === true,
    queue_policy: "interactive_priority_zero",
    queue_position: "ahead_of_waiting_background_jobs",
    job: {
      job_id: row.id || jobId,
      batch_id: row.batch_id || null,
      tenant_id: context.tenantId,
      asset_id: row.asset_id || null,
      recognition_session_id: row.recognition_session_id || null,
      status: row.status || "RETRYING",
      lane: row.lane || "interactive",
      priority: Number(row.priority ?? 0)
    },
    pump_triggered: pump.triggered,
    pump_reason: pump.reason
  }));
}
