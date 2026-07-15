import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest, tenantIdFromRequest } from "../../lib/listing-session.mjs";
import {
  buildAuthoritativeRecognitionResult,
  createFeedbackSubmissionId,
  normalizeFeedbackSubmissionId
} from "../../lib/listing/feedback/feedback-capture.mjs";
import { buildV4FeedbackArtifacts } from "../../lib/listing/v4/feedback/feedback-loop.mjs";
import { normalizeGrader } from "../../lib/listing/v4/anchors/anchor-classifier.mjs";
import { upsertCertRegistryEntry } from "../../lib/listing/v4/anchors/cert-lookup.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  persistV4WriterFeedbackTransaction,
  readV4SessionStatus,
} from "../../lib/listing/v4/session/session-store.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

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

  const operatorId = operatorIdFromRequest(req);
  const tenantId = tenantIdFromRequest(req);
  const ownedSession = await readV4SessionStatus({ sessionId });
  if (!ownedSession.ok) {
    sendJson(res, 503, withV4Version({ ok: false, retryable: true, message: "Unable to verify recognition session ownership." }));
    return;
  }
  const ownedTenantId = String(ownedSession.session?.tenant_id || "").trim();
  if (!ownedSession.session
      || String(ownedSession.session.operator_id || "") !== operatorId
      || (ownedTenantId && ownedTenantId !== tenantId)) {
    sendJson(res, 404, withV4Version({ ok: false, retryable: false, message: "Recognition session not found." }));
    return;
  }

  const action = String(payload.action || "").trim().toUpperCase();
  if (!["ACCEPT", "EDIT", "REJECT"].includes(action)) {
    sendJson(res, 400, withV4Version({ ok: false, message: "action must be ACCEPT, EDIT, or REJECT." }));
    return;
  }

  let submissionId;
  try {
    const requestedSubmissionId = payload.feedback_submission_id
      || payload.submission_id
      || req.headers?.["idempotency-key"]
      || req.headers?.["x-feedback-submission-id"];
    submissionId = normalizeFeedbackSubmissionId(requestedSubmissionId) || createFeedbackSubmissionId();
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "feedback_submission_id is invalid." }));
    return;
  }

  const recognitionResult = buildAuthoritativeRecognitionResult(ownedSession.session);
  const providerSummary = ownedSession.session.provider_result_summary || {};
  const authoritativeResultPayload = {
    final_title: recognitionResult.ai_title || "",
    title: recognitionResult.ai_title || "",
    resolved_fields: recognitionResult.ai_sem || {},
    fields: recognitionResult.ai_sem || {},
    field_states: ownedSession.session.field_states || {},
    candidate_control_plane_trace: ownedSession.session.candidate_control_plane_trace || {},
    retrieval_trace: ownedSession.session.candidate_control_plane_trace || {},
    provider_result: providerSummary,
    model_version: recognitionResult.model_version,
    title_length_policy: providerSummary.title_length_policy || {},
    max_title_length: providerSummary.title_length_policy?.max_length || null
  };

  let artifacts;
  try {
    artifacts = buildV4FeedbackArtifacts({
      sessionId,
      action,
      aiTitle: recognitionResult.ai_title,
      writerTitle: payload.writer_final_title || payload.corrected_title || payload.final_title,
      resultPayload: authoritativeResultPayload,
      recognitionResult,
      operatorId,
      submissionId,
      clientOccurredAt: payload.client_occurred_at || payload.occurred_at || null,
      // Public writer feedback is commercial feedback. Field-level semantic
      // truth requires a separate reviewed admin workflow.
      reviewedSemanticFields: false
    });
  } catch (error) {
    sendJson(res, 400, withV4Version({
      ok: false,
      message: "Writer feedback payload is invalid.",
      error: String(error?.message || error || "invalid_feedback_payload")
    }));
    return;
  }
  const transaction = await persistV4WriterFeedbackTransaction({
    sessionId,
    operatorId,
    status: artifacts.status,
    feedbackEvent: artifacts.feedbackEvent,
    learningEvent: artifacts.learningEvent
  });
  if (!transaction.saved) {
    if (transaction.transaction?.conflict === true) {
      sendJson(res, 409, withV4Version({
        ok: false,
        retryable: false,
        message: "feedback_submission_id was already used with a different payload.",
        feedback_submission_id: submissionId
      }));
      return;
    }
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      message: "Unable to save writer feedback transaction.",
      error: transaction.error || "feedback_transaction_not_saved"
    }));
    return;
  }

  // Cert registry flywheel: a writer-confirmed recognition that carries a
  // grading cert number becomes an identity record, so the next time this
  // slab (or a relisting of it) appears, identity is a sub-second registry
  // lookup instead of a full model pass. Identity fields only; instance
  // fields of future copies still come from their own images.
  const resolvedForCert = artifacts.correctedResolved
    || payload.result_payload?.resolved_fields
    || payload.result_payload?.resolved
    || payload.resolved_fields
    || {};
  const certNumber = String(resolvedForCert.cert_number || "").trim();
  const grader = normalizeGrader(resolvedForCert.grade_company || "");
  const confirmedTitle = String(artifacts.feedbackEvent.writer_final_title || "").trim();
  const reviewedPromotionEnabled = String(process.env.ENABLE_REVIEWED_WRITER_FEEDBACK_CERT_PROMOTION || "false").toLowerCase() === "true"
    && artifacts.learningEvent.semantic_truth === true
    && artifacts.learningEvent.training_eligible === true;
  if (reviewedPromotionEnabled && certNumber && grader && confirmedTitle && artifacts.status !== "REJECTED") {
    waitUntil(upsertCertRegistryEntry({
      grader,
      certNumber,
      identity: {
        category: resolvedForCert.category || resolvedForCert.sport || null,
        year: resolvedForCert.year || null,
        manufacturer: resolvedForCert.manufacturer || null,
        brand: resolvedForCert.brand || null,
        product: resolvedForCert.product || null,
        set: resolvedForCert.set || null,
        subset: resolvedForCert.subset || null,
        players: resolvedForCert.players || (resolvedForCert.subject ? [resolvedForCert.subject] : null),
        team: resolvedForCert.team || null,
        collector_number: resolvedForCert.collector_number || resolvedForCert.card_number || null,
        checklist_code: resolvedForCert.checklist_code || null
      },
      grade: resolvedForCert.card_grade || resolvedForCert.grade || "",
      autoGrade: resolvedForCert.auto_grade || "",
      canonicalTitle: confirmedTitle,
      source: "writer_feedback",
      reviewStatus: "REVIEWED_INTERNAL",
      sessionId,
      metadata: { feedback_event_id: artifacts.feedbackEvent.id, action: payload.action || null }
    }).catch((error) => {
      console.warn("[v4_writer_cert_registry_promotion_failed]", JSON.stringify({
        recognition_session_id: sessionId,
        feedback_event_id: artifacts.feedbackEvent.id,
        grader,
        error: String(error?.message || error || "cert_registry_promotion_failed").slice(0, 240)
      }));
    }));
  }

  sendJson(res, 200, withV4Version({
    ok: true,
    recognition_session_id: sessionId,
    status: artifacts.status,
    feedback_submission_id: submissionId,
    feedback_event_id: artifacts.feedbackEvent.id,
    learning_event_id: artifacts.learningEvent.id,
    writer_final_title: artifacts.feedbackEvent.writer_final_title,
    writer_raw_title: artifacts.rawWriterTitle,
    csm_normalization: artifacts.csmNormalization,
    title_diff: artifacts.feedbackEvent.title_diff,
    training_eligible: artifacts.learningEvent.training_eligible,
    dataset_disposition: artifacts.learningEvent.dataset_disposition,
    sem_extraction_status: artifacts.semExtraction.status,
    production_promotion_eligible: reviewedPromotionEnabled,
    v4_persistence: { transaction }
  }));
}
