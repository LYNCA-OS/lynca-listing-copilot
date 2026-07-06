import { buildCandidateRerankerDataset } from "../../feedback/feedback_loop.mjs";
import { buildFieldGraph, compactFieldGraph } from "../../feedback/field_graph.mjs";
import { v4SessionStatuses } from "../session/status.mjs";

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function comparable(value) {
  return normalizeTitle(value).toLowerCase();
}

function diffWords(before, after) {
  const left = new Set(comparable(before).split(/\s+/).filter(Boolean));
  const right = new Set(comparable(after).split(/\s+/).filter(Boolean));
  return {
    added: [...right].filter((token) => !left.has(token)),
    removed: [...left].filter((token) => !right.has(token))
  };
}

export function normalizeV4FeedbackAction(action) {
  const normalized = String(action || "").trim().toUpperCase();
  return ["ACCEPT", "EDIT", "REJECT"].includes(normalized) ? normalized : "EDIT";
}

export function statusForFeedbackAction(action) {
  const normalized = normalizeV4FeedbackAction(action);
  if (normalized === "ACCEPT") return v4SessionStatuses.ACCEPTED;
  if (normalized === "REJECT") return v4SessionStatuses.REJECTED;
  return v4SessionStatuses.EDITED;
}

export function buildV4FeedbackArtifacts({
  sessionId,
  action,
  aiTitle = "",
  writerTitle = "",
  resultPayload = {},
  operatorId = ""
} = {}) {
  const normalizedAction = normalizeV4FeedbackAction(action);
  const generated = normalizeTitle(aiTitle || resultPayload.final_title || resultPayload.title);
  const finalTitle = normalizeTitle(writerTitle || generated);
  const reviewOutcome = normalizedAction === "ACCEPT"
    ? "ACCEPTED_UNCHANGED"
    : normalizedAction === "REJECT"
      ? "REJECTED_BY_WRITER"
      : "CORRECTED_TITLE";
  const titleDiff = diffWords(generated, finalTitle);
  const fieldGraph = buildFieldGraph({
    resolved: resultPayload.resolved_fields || resultPayload.fields || {},
    evidence: resultPayload.provider_evidence || {},
    retrievalTrace: resultPayload.retrieval_trace || {},
    openSetReadiness: resultPayload.open_set_readiness || {}
  });
  const compactFields = compactFieldGraph(fieldGraph);
  const candidateRows = buildCandidateRerankerDataset({
    queryCardId: sessionId,
    payload: resultPayload,
    correctedTitle: finalTitle,
    reviewOutcome
  });

  const feedbackEvent = {
    id: `${sessionId}_${normalizedAction.toLowerCase()}`,
    recognition_session_id: sessionId,
    action: normalizedAction,
    generated_title: generated,
    writer_final_title: finalTitle,
    title_diff: titleDiff,
    field_graph: fieldGraph,
    operator_id: operatorId || null,
    correction_type: normalizedAction === "ACCEPT" ? "NO_CHANGE" : normalizedAction
  };

  const learningEvent = {
    id: `${sessionId}_${normalizedAction.toLowerCase()}_learning`,
    recognition_session_id: sessionId,
    event_type: `WRITER_${normalizedAction}`,
    generated_title: generated,
    writer_final_title: finalTitle,
    field_level_ground_truth: compactFields,
    candidate_reranker_dataset: candidateRows,
    hard_negative_samples: candidateRows
      .filter((row) => row.selected_by_system && !row.selected_by_writer)
      .map((row) => ({
        query_card_id: row.query_card_id,
        wrong_candidate_id: row.candidate_id,
        conflicting_fields: row.conflict_fields,
        error_type: "WRITER_REJECTED_SYSTEM_SELECTION",
        training_eligible: true
      })),
    training_eligible: normalizedAction !== "REJECT"
  };

  return { feedbackEvent, learningEvent, status: statusForFeedbackAction(normalizedAction) };
}
