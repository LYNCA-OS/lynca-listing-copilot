import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { buildV4FeedbackArtifacts } from "../../lib/listing/v4/feedback/feedback-loop.mjs";
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

  sendJson(res, 200, withV4Version({
    ok: true,
    recognition_session_id: sessionId,
    status: artifacts.status,
    feedback_event_id: artifacts.feedbackEvent.id,
    learning_event_id: artifacts.learningEvent.id,
    title_diff: artifacts.feedbackEvent.title_diff,
    training_eligible: artifacts.learningEvent.training_eligible,
    v4_persistence: { feedback, learning, session }
  }));
}
