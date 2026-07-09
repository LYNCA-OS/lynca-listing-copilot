import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { buildV4FeedbackArtifacts } from "../../lib/listing/v4/feedback/feedback-loop.mjs";
import { normalizeGrader } from "../../lib/listing/v4/anchors/anchor-classifier.mjs";
import { upsertCertRegistryEntry } from "../../lib/listing/v4/anchors/cert-lookup.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  persistV4FeedbackEvent,
  persistV4LearningEvent,
  updateV4RecognitionSession
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

  const artifacts = buildV4FeedbackArtifacts({
    sessionId,
    action: payload.action,
    aiTitle: payload.ai_generated_title || payload.generated_title || payload.ai_title,
    writerTitle: payload.writer_final_title || payload.corrected_title || payload.final_title,
    resultPayload: payload.result_payload || payload.v4_result || payload,
    operatorId: operatorIdFromRequest(req)
  });
  const feedback = await persistV4FeedbackEvent({ event: artifacts.feedbackEvent });
  const learning = await persistV4LearningEvent({ event: artifacts.learningEvent });
  const session = await updateV4RecognitionSession({
    sessionId,
    patch: {
      status: artifacts.status,
      writer_final_title: artifacts.feedbackEvent.writer_final_title,
      writer_feedback_event_id: artifacts.feedbackEvent.id,
      learning_event_id: artifacts.learningEvent.id
    }
  });

  // Cert registry flywheel: a writer-confirmed recognition that carries a
  // grading cert number becomes an identity record, so the next time this
  // slab (or a relisting of it) appears, identity is a sub-second registry
  // lookup instead of a full model pass. Identity fields only; instance
  // fields of future copies still come from their own images.
  const resolvedForCert = payload.result_payload?.resolved_fields
    || payload.result_payload?.resolved
    || payload.resolved_fields
    || {};
  const certNumber = String(resolvedForCert.cert_number || "").trim();
  const grader = normalizeGrader(resolvedForCert.grade_company || "");
  const confirmedTitle = String(artifacts.feedbackEvent.writer_final_title || "").trim();
  if (certNumber && grader && confirmedTitle && artifacts.status !== "REJECTED") {
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
    }).catch(() => {}));
  }

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
    v4_persistence: { feedback, learning, session }
  }));
}
