import { callV4Rpc } from "../session/supabase-rest.mjs";

const safeIdentifierPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;

function normalizedIdentifier(value) {
  const normalized = String(value ?? "").trim();
  return safeIdentifierPattern.test(normalized) ? normalized : "";
}

function assignmentFailure(reason) {
  const normalized = String(reason || "").trim().toLowerCase();
  if (normalized.includes("assignee") && (normalized.includes("active") || normalized.includes("member"))) {
    return {
      error_code: "V4_JOB_ASSIGN_ASSIGNEE_NOT_ACTIVE",
      error: "assignee_not_active",
      retryable: false
    };
  }
  if (normalized.includes("related") || normalized.includes("session") || normalized.includes("batch")) {
    return {
      error_code: "V4_JOB_ASSIGN_RELATED_RECORD_MISSING",
      error: "related_record_missing",
      retryable: false
    };
  }
  if (normalized.includes("state") || normalized.includes("changed") || normalized.includes("conflict")) {
    return {
      error_code: "V4_JOB_ASSIGN_STATE_CHANGED",
      error: "assignment_state_changed",
      retryable: false
    };
  }
  if (normalized.includes("not_found") || normalized.includes("not found") || normalized.includes("owned")) {
    return {
      error_code: "V4_JOB_ASSIGN_NOT_FOUND",
      error: "job_not_found",
      retryable: false
    };
  }
  return {
    error_code: "V4_JOB_ASSIGN_WRITE_FAILED",
    error: normalized || "assignment_not_saved",
    retryable: true
  };
}

export async function assignV4RecognitionJob({
  jobId,
  tenantId,
  assignedToUserId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedJobId = normalizedIdentifier(jobId);
  const normalizedTenantId = normalizedIdentifier(tenantId);
  const normalizedAssigneeId = normalizedIdentifier(assignedToUserId);
  if (!normalizedJobId || !normalizedTenantId || !normalizedAssigneeId) {
    return {
      saved: false,
      retryable: false,
      error_code: "V4_JOB_ASSIGN_INVALID_REQUEST",
      error: "job_id_tenant_id_and_assignee_required"
    };
  }

  const result = await callV4Rpc({
    fn: "assign_v4_recognition_job",
    payload: {
      p_tenant_id: normalizedTenantId,
      p_job_id: normalizedJobId,
      p_assigned_to_user_id: normalizedAssigneeId
    },
    env,
    fetchImpl
  });
  if (!result.ok) {
    return {
      saved: false,
      retryable: true,
      error_code: "V4_JOB_ASSIGN_BACKEND_UNAVAILABLE",
      error: result.error || "assignment_rpc_failed"
    };
  }

  const transaction = result.rows?.[0] && typeof result.rows[0] === "object"
    ? result.rows[0]
    : null;
  if (transaction?.saved !== true) {
    return {
      saved: false,
      transaction,
      ...assignmentFailure(transaction?.reason || transaction?.error)
    };
  }

  const assignment = Object.freeze({
    job_id: String(transaction.job_id || normalizedJobId),
    batch_id: transaction.batch_id || null,
    recognition_session_id: transaction.recognition_session_id || transaction.session_id || null,
    tenant_id: normalizedTenantId,
    assigned_to_user_id: String(transaction.assigned_to_user_id || normalizedAssigneeId)
  });
  if (
    assignment.job_id !== normalizedJobId
    || assignment.tenant_id !== normalizedTenantId
    || assignment.assigned_to_user_id !== normalizedAssigneeId
  ) {
    return {
      saved: false,
      retryable: true,
      error_code: "V4_JOB_ASSIGN_BACKEND_UNAVAILABLE",
      error: "assignment_rpc_identity_mismatch",
      transaction
    };
  }

  return {
    saved: true,
    retryable: false,
    error_code: null,
    error: null,
    assignment,
    transaction
  };
}
