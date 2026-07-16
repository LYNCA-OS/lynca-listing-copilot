import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readV4Rows, isV4SupabaseConfigured } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { readV4SessionStatus } from "../../lib/listing/v4/session/session-store.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  hasTenantPermission,
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

function queryParam(req, name) {
  const url = new URL(req.url || "/", "https://local.test");
  return String(url.searchParams.get(name) || "").trim();
}

function sessionPresentation(session = null) {
  if (!session || typeof session !== "object") return {};
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : {};
  const l2Ready = session.status !== "FAILED" && session.l2_status === "READY" && Boolean(session.l2_title || session.final_title);
  const writerReviewRequired = session.status !== "FAILED"
    && session.l2_status === "READY"
    && (
      session.status === "WRITER_REVIEW"
      || summary.writer_review_required === true
      || summary.assisted_draft_status === "REVIEW_REQUIRED"
    );
  return {
    writer_status: l2Ready ? "ASSISTED_READY" : writerReviewRequired ? "REVIEW_REQUIRED" : (session.failure_reason ? "FAILED" : "GENERATING"),
    writer_display_title: l2Ready ? (session.l2_title || session.final_title || "") : null,
    current_best_title: l2Ready ? (session.l2_title || session.final_title || "") : "",
    can_writer_start: Boolean(l2Ready || writerReviewRequired),
    writer_review_required: writerReviewRequired,
    writer_review_reason: writerReviewRequired ? summary.writer_review_reason || null : null,
    is_final: Boolean(l2Ready || writerReviewRequired),
    title_stage: l2Ready || writerReviewRequired ? "L2_ASSISTED_DRAFT" : "PENDING"
  };
}

function operationalSessionStatus(session = null) {
  if (!session || typeof session !== "object") return session;
  const presentation = sessionPresentation(session);
  return {
    ...session,
    l1_title: "",
    final_title: session.l2_status === "READY" ? (session.final_title || session.l2_title || "") : "",
    ...presentation
  };
}

function writerSessionStatus(session = null) {
  if (!session || typeof session !== "object") return session;
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : {};
  const presentation = sessionPresentation(session);
  const finalTitle = session.l2_status === "READY" ? (session.final_title || session.l2_title || "") : "";
  const assistedDraftStatus = summary.assisted_draft_status
    || (presentation.writer_review_required ? "REVIEW_REQUIRED" : finalTitle ? "READY" : session.failure_reason ? "FAILED" : "PENDING");
  return {
    id: session.id || null,
    status: session.status || null,
    final_title: finalTitle,
    l2_status: session.l2_status || "PENDING",
    l2_title: finalTitle,
    l2_ready_at: session.l2_ready_at || null,
    provider_result_summary: {
      assisted_draft_status: assistedDraftStatus,
      writer_review_required: presentation.writer_review_required,
      writer_review_reason: presentation.writer_review_reason,
      recognition_clock_started_at: summary.recognition_clock_started_at || null,
      recognition_clock_source: summary.recognition_clock_source || null
    },
    resolved_fields: session.resolved_fields && typeof session.resolved_fields === "object" ? session.resolved_fields : {},
    field_states: session.field_states && typeof session.field_states === "object" ? session.field_states : {},
    updated_at: session.updated_at || null,
    failure_reason: session.failure_reason ? "Recognition failed." : null,
    ...presentation
  };
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-session-status" });
  if (req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_session_status",
    limit: 2400,
    windowMs: 60_000,
    message: "Too many V4 session status requests. Please try again shortly."
  })) return;

  const sessionId = queryParam(req, "recognition_session_id") || queryParam(req, "session_id");
  if (!sessionId) {
    sendJson(res, 400, withV4Version({ ok: false, message: "recognition_session_id is required." }));
    return;
  }
  const status = await readV4SessionStatus({ sessionId, tenantId: context.tenantId });
  const canViewOperations = hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_TEAM);
  if (!status.ok) {
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      recognition_session_id: sessionId,
      message: "Recognition session status is temporarily unavailable.",
      ...(canViewOperations ? { diagnostic: status.error || null } : {})
    }));
    return;
  }
  if (!status.session) {
    sendJson(res, 404, withV4Version({ ok: false, message: "Recognition session not found." }));
    return;
  }
  if (!hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_ALL_WORK)) {
    try {
      requirePermission(context, TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK, {
        assignedUserId: status.session.assigned_to_user_id
      });
    } catch {
      // Do not reveal whether an unassigned/cross-assignment session exists.
      sendJson(res, 404, withV4Version({ ok: false, message: "Recognition session not found." }));
      return;
    }
  }
  const counts = {};
  const includeRelatedCounts = canViewOperations
    && ["1", "true", "yes"].includes(queryParam(req, "include_related_counts").toLowerCase());
  if (includeRelatedCounts && isV4SupabaseConfigured(process.env)) {
    const tables = {
      field_evidence: "v4_field_evidence",
      candidate_traces: "v4_candidate_traces",
      feedback_events: "v4_writer_feedback_events",
      learning_events: "v4_learning_events",
      quality_ledger: "v4_production_quality_ledger"
    };
    const results = await Promise.all(Object.entries(tables).map(async ([key, table]) => {
      const rows = await readV4Rows({
        table,
        select: "id",
        search: {
          tenant_id: `eq.${context.tenantId}`,
          recognition_session_id: `eq.${sessionId}`
        }
      });
      return [key, rows.ok ? rows.rows.length : null];
    }));
    Object.assign(counts, Object.fromEntries(results));
  }
  sendJson(res, 200, withV4Version({
    ok: true,
    recognition_session_id: sessionId,
    session: canViewOperations
      ? operationalSessionStatus(status.session)
      : writerSessionStatus(status.session),
    related_counts: counts,
    related_counts_included: includeRelatedCounts,
    error: null
  }));
}
