import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import {
  readV4RecognitionJobs,
  requestV4RecognitionJobRecovery,
  tryAcquireV4QueueKick,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { scheduleTrustedV4QueuePump } from "../../lib/listing/v4/jobs/internal-queue-wake.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  readJsonPayload,
  requestPayloadErrorStatus,
  sendJson
} from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

const safeIdentifierPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const forbiddenIdentityFields = new Set([
  "tenant_id", "tenantId", "workspace_id", "workspaceId",
  "operator_id", "operatorId", "created_by_user_id", "createdByUserId"
]);

function invalidPayload(payload) {
  return !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || [...forbiddenIdentityFields].some((field) => Object.hasOwn(payload, field));
}

function triggerRecoveryPump(context, action) {
  if (!["REPRIORITIZED", "REQUEUED_EXPIRED_LEASE"].includes(action)) {
    return { triggered: false, reason: "recovery_did_not_make_work_claimable" };
  }
  const processConcurrency = v4WorkerProcessConcurrency(process.env);
  return scheduleTrustedV4QueuePump({
    payload: {
      tenant_id: context.tenantId,
      limit: processConcurrency,
      process_concurrency: processConcurrency,
      cycles: 1,
      max_runtime_ms: 120_000,
      lease_seconds: 120,
      parallel_lanes: true,
      idle_delay_ms: 0,
      idle_cycles_before_stop: 1
    },
    reason: "writer_requested_job_recovery",
    dedupScope: "global",
    dedupOwner: `recovery:${context.tenantId}`,
    acquireKick: tryAcquireV4QueueKick,
    defer: waitUntil
  });
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
    message: "Too many recovery requests. Please wait briefly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req, { maxBytes: 8_000 });
  } catch (error) {
    sendJson(res, requestPayloadErrorStatus(error), withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_RECOVERY_INVALID_REQUEST",
      message: "Invalid job recovery request."
    }));
    return;
  }
  if (invalidPayload(payload)) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_RECOVERY_INVALID_REQUEST",
      message: "Invalid job recovery request."
    }));
    return;
  }

  const jobId = String(payload.job_id || payload.jobId || "").trim();
  if (!safeIdentifierPattern.test(jobId)) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_RECOVERY_INVALID_REQUEST",
      message: "job_id is required."
    }));
    return;
  }

  const owned = await readV4RecognitionJobs({
    jobIds: [jobId],
    tenantId: context.tenantId,
    limit: 1,
    select: "id,tenant_id,operator_id,assigned_to_user_id,status,lease_expires_at"
  });
  const job = owned.rows?.[0] || null;
  if (!owned.ok || !job) {
    sendJson(res, owned.ok ? 404 : 503, withV4Version({
      ok: false,
      retryable: !owned.ok,
      error_code: owned.ok ? "V4_JOB_RECOVERY_NOT_FOUND" : "V4_JOB_RECOVERY_READ_FAILED",
      message: owned.ok ? "Job was not found." : "Job recovery is temporarily unavailable."
    }));
    return;
  }

  try {
    requirePermission(context, TENANT_PERMISSIONS.RETRY_JOB, {
      assignedUserId: job.assigned_to_user_id || job.operator_id
    });
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 403), withV4Version({
      ...publicTenantAuthError(error),
      retryable: false
    }));
    return;
  }

  const recovery = await requestV4RecognitionJobRecovery({
    jobId,
    tenantId: context.tenantId,
    requestedByUserId: context.userId
  });
  if (!recovery.ok) {
    sendJson(res, recovery.action === "NOT_FOUND" ? 404 : 503, withV4Version({
      ok: false,
      retryable: recovery.action !== "NOT_FOUND",
      error_code: recovery.action === "NOT_FOUND" ? "V4_JOB_RECOVERY_NOT_FOUND" : "V4_JOB_RECOVERY_FAILED",
      message: recovery.action === "NOT_FOUND" ? "Job was not found." : "Job recovery is temporarily unavailable."
    }));
    return;
  }

  const action = recovery.action;
  const pump = triggerRecoveryPump(context, action);
  sendJson(res, 200, withV4Version({
    ok: true,
    retryable: action === "TERMINAL_REQUIRES_FRESH_ENQUEUE",
    action,
    job_id: recovery.job?.job_id || jobId,
    job_status: recovery.job?.job_status || job.status,
    priority: recovery.job?.priority ?? null,
    queue_wake_triggered: pump.triggered === true,
    message: action === "ALREADY_RUNNING"
      ? "The original job is still running."
      : action === "TERMINAL_REQUIRES_FRESH_ENQUEUE"
        ? "The original job is terminal; create a fresh verified enqueue."
        : "The original job was safely recovered without cloning its payload."
  }));
}
