import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest
} from "../../lib/observability/production-events.mjs";
import { assignV4RecognitionJob } from "../../lib/listing/v4/jobs/job-assignment.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  readJsonPayload,
  requestPayloadErrorStatus,
  sendJson
} from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
import {
  isTenantMemberServiceError,
  requireActiveTenantMember
} from "../../lib/tenant/members.mjs";

const forbiddenIdentityFields = new Set([
  "tenant_id",
  "tenantId",
  "workspace_id",
  "workspaceId",
  "operator_id",
  "operatorId",
  "created_by_user_id",
  "createdByUserId"
]);
const safeIdentifierPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;

function hasForbiddenIdentityField(payload) {
  return payload && typeof payload === "object"
    && [...forbiddenIdentityFields].some((field) => Object.hasOwn(payload, field));
}

function statusForAssignmentFailure(result = {}) {
  if (result.error_code === "V4_JOB_ASSIGN_INVALID_REQUEST") return 400;
  if (result.error_code === "V4_JOB_ASSIGN_NOT_FOUND") return 404;
  if (result.error_code === "V4_JOB_ASSIGN_ASSIGNEE_NOT_ACTIVE") return 404;
  if (result.error_code === "V4_JOB_ASSIGN_RELATED_RECORD_MISSING") return 409;
  if (result.error_code === "V4_JOB_ASSIGN_STATE_CHANGED") return 409;
  return 503;
}

function publicAssignmentFailure(result = {}) {
  const status = statusForAssignmentFailure(result);
  return {
    ok: false,
    retryable: result.retryable === true,
    error_code: result.error_code || "V4_JOB_ASSIGN_FAILED",
    message: status === 404
      ? "Job or active assignee was not found."
      : status === 409
        ? "Job assignment changed; refresh and try again."
        : "Job assignment is temporarily unavailable."
  };
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-assign" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, retryable: false, message: "Method not allowed" }));
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.ASSIGN_TASK });
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version({
      ...publicTenantAuthError(error),
      retryable: false
    }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_assign",
    limit: 120,
    windowMs: 60_000,
    message: "Too many assignment requests. Please wait briefly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req, { maxBytes: 32_000 });
  } catch (error) {
    sendJson(res, requestPayloadErrorStatus(error), withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_ASSIGN_INVALID_REQUEST",
      message: "Invalid job assignment request."
    }));
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || hasForbiddenIdentityField(payload)) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_ASSIGN_INVALID_REQUEST",
      message: "Invalid job assignment request."
    }));
    return;
  }

  const jobId = String(payload.job_id || payload.jobId || "").trim();
  const assignedToUserId = String(payload.assigned_to_user_id || payload.assignedToUserId || "").trim();
  if (!safeIdentifierPattern.test(jobId) || !safeIdentifierPattern.test(assignedToUserId)) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_ASSIGN_INVALID_REQUEST",
      message: "job_id and assigned_to_user_id are required."
    }));
    return;
  }

  try {
    await requireActiveTenantMember({
      tenantId: context.tenantId,
      userId: assignedToUserId
    });
  } catch (error) {
    const unavailable = !isTenantMemberServiceError(error)
      || Number(error.statusCode || 503) >= 500;
    const failure = unavailable
      ? {
        saved: false,
        retryable: true,
        error_code: "V4_JOB_ASSIGN_BACKEND_UNAVAILABLE"
      }
      : {
        saved: false,
        retryable: false,
        error_code: "V4_JOB_ASSIGN_ASSIGNEE_NOT_ACTIVE"
      };
    sendJson(res, statusForAssignmentFailure(failure), withV4Version(publicAssignmentFailure(failure)));
    return;
  }

  const result = await assignV4RecognitionJob({
    jobId,
    tenantId: context.tenantId,
    assignedToUserId
  });
  if (!result.saved) {
    sendJson(res, statusForAssignmentFailure(result), withV4Version(publicAssignmentFailure(result)));
    return;
  }

  sendJson(res, 200, withV4Version({
    ok: true,
    retryable: false,
    assignment: result.assignment
  }));
}
