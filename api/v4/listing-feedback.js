import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest, persistProductionEvent } from "../../lib/observability/production-events.mjs";
import { buildV4FeedbackArtifacts } from "../../lib/listing/v4/feedback/feedback-loop.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  persistV4WriterFeedbackTransaction,
  readV4SessionStatus,
} from "../../lib/listing/v4/session/session-store.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-feedback" });
  if (req.method !== "POST") {
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
    scope: "v4_listing_feedback",
    limit: 180,
    windowMs: 60_000,
    message: "Too many V4 feedback requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const sessionId = String(payload.recognition_session_id || payload.session_id || "").trim();
  if (!sessionId) {
    sendJson(res, 400, withV4Version({ ok: false, message: "recognition_session_id is required." }));
    return;
  }

  const operatorId = context.userId;
  const ownedSession = await readV4SessionStatus({
    sessionId,
    tenantId: context.tenantId
  });
  if (!ownedSession.ok) {
    sendJson(res, 503, withV4Version({ ok: false, retryable: true, message: "Unable to verify recognition session ownership." }));
    return;
  }
  if (!ownedSession.session) {
    sendJson(res, 404, withV4Version({ ok: false, retryable: false, message: "Recognition session not found." }));
    return;
  }
  try {
    requirePermission(context, TENANT_PERMISSIONS.SUBMIT_FEEDBACK, {
      assignedUserId: ownedSession.session.assigned_to_user_id
    });
  } catch {
    // Assignment is persisted server-side; a client-supplied operator or
    // assignee cannot turn another writer's task into an authorized one.
    sendJson(res, 404, withV4Version({ ok: false, retryable: false, message: "Recognition session not found." }));
    return;
  }

  const artifacts = buildV4FeedbackArtifacts({
    sessionId,
    action: payload.action,
    aiTitle: payload.ai_generated_title || payload.generated_title || payload.ai_title,
    writerTitle: payload.writer_final_title || payload.corrected_title || payload.final_title,
    resultPayload: payload.result_payload || payload.v4_result || payload,
    operatorId
  });
  const transaction = await persistV4WriterFeedbackTransaction({
    sessionId,
    operatorId,
    tenantId: context.tenantId,
    status: artifacts.status,
    feedbackEvent: { ...artifacts.feedbackEvent, tenant_id: context.tenantId },
    learningEvent: { ...artifacts.learningEvent, tenant_id: context.tenantId },
    sharedPromotion: false
  });
  if (!transaction.saved) {
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      message: "Unable to save writer feedback transaction.",
      error: transaction.error || "feedback_transaction_not_saved"
    }));
    return;
  }

  await persistProductionEvent({
    eventType: "feedback_saved",
    requestId: context.requestId,
    context,
    sessionId,
    success: true,
    metadata: { action: payload.action || null, feedback_status: artifacts.status }
  });

  sendJson(res, 200, withV4Version({
    ok: true,
    recognition_session_id: sessionId,
    status: artifacts.status,
    feedback_event_id: artifacts.feedbackEvent.id,
    learning_event_id: artifacts.learningEvent.id,
    writer_final_title: artifacts.feedbackEvent.writer_final_title,
    writer_raw_title: artifacts.rawWriterTitle,
    csm_normalization: artifacts.csmNormalization,
    title_diff: artifacts.feedbackEvent.title_diff,
    training_eligible: artifacts.learningEvent.training_eligible,
    shared_promotion: {
      attempted: false,
      reason: "tenant_data_requires_platform_approval"
    },
    v4_persistence: { transaction }
  }));
}
