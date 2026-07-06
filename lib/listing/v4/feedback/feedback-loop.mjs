import { buildFeedbackLoopEvent } from "../../feedback/feedback_loop.mjs";
import { buildFieldGraph, compactFieldGraph } from "../../feedback/field_graph.mjs";
import { parseReviewedTitleFields } from "../../memory/title-field-parser.mjs";
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

function isMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "UNKNOWN";
}

function parsedWriterTitleFields(title = "") {
  const parsed = parseReviewedTitleFields(title);
  const compact = {};
  for (const [field, value] of Object.entries(parsed || {})) {
    if (!isMeaningfulValue(value)) continue;
    if (field === "product" && String(value).trim() === "Other Collectibles") continue;
    compact[field] = value;
  }
  return compact;
}

function mergeResolvedForTraining(generatedResolved = {}, parsedCorrected = {}, action = "") {
  if (normalizeV4FeedbackAction(action) === "REJECT") return parsedCorrected;
  return {
    ...generatedResolved,
    ...parsedCorrected
  };
}

function fieldChangesFromParsedCorrection(generatedFieldGraph = {}, correctedFieldGraph = {}, parsedCorrected = {}) {
  const generated = compactFieldGraph(generatedFieldGraph);
  const corrected = compactFieldGraph(correctedFieldGraph);
  const parsedGraph = compactFieldGraph(buildFieldGraph({ resolved: parsedCorrected }));
  return Object.keys(parsedGraph)
    .filter((field) => generated[field] !== corrected[field])
    .map((field) => ({
      field,
      from: generated[field] || null,
      to: corrected[field] || null,
      change_type: "WRITER_TITLE_CORRECTION"
    }));
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
      ? "REJECTED"
      : "CORRECTED_TITLE";
  const titleDiff = diffWords(generated, finalTitle);
  const generatedResolved = resultPayload.resolved_fields || resultPayload.fields || {};
  const generatedFieldGraph = buildFieldGraph({
    resolved: generatedResolved,
    evidence: resultPayload.provider_evidence || {},
    retrievalTrace: resultPayload.retrieval_trace || {},
    openSetReadiness: resultPayload.open_set_readiness || {},
    workflowSidecars: resultPayload.workflow_sidecars || {}
  });
  const parsedCorrected = parsedWriterTitleFields(finalTitle);
  const correctedResolved = mergeResolvedForTraining(generatedResolved, parsedCorrected, normalizedAction);
  const correctedFieldGraph = buildFieldGraph({
    resolved: correctedResolved,
    evidence: resultPayload.provider_evidence || {},
    retrievalTrace: resultPayload.retrieval_trace || {},
    openSetReadiness: resultPayload.open_set_readiness || {},
    workflowSidecars: resultPayload.workflow_sidecars || {}
  });
  const fieldChanges = normalizedAction === "ACCEPT"
    ? []
    : fieldChangesFromParsedCorrection(generatedFieldGraph, correctedFieldGraph, parsedCorrected);
  const feedbackTrainingEvent = buildFeedbackLoopEvent({
    queryCardId: sessionId,
    generatedTitle: generated,
    correctedTitle: finalTitle,
    generatedFieldGraph,
    correctedFieldGraph,
    fieldChanges,
    payload: resultPayload,
    reviewOutcome,
    stableTrainingSample: normalizedAction !== "REJECT"
  });

  const feedbackEvent = {
    id: `${sessionId}_${normalizedAction.toLowerCase()}`,
    recognition_session_id: sessionId,
    action: normalizedAction,
    generated_title: generated,
    writer_final_title: finalTitle,
    title_diff: titleDiff,
    field_graph: correctedFieldGraph,
    operator_id: operatorId || null,
    correction_type: normalizedAction === "ACCEPT" ? "NO_CHANGE" : normalizedAction
  };

  const learningEvent = {
    id: `${sessionId}_${normalizedAction.toLowerCase()}_learning`,
    recognition_session_id: sessionId,
    event_type: `WRITER_${normalizedAction}`,
    generated_title: generated,
    writer_final_title: finalTitle,
    field_level_ground_truth: feedbackTrainingEvent.datasets.field_level_ground_truth,
    candidate_reranker_dataset: feedbackTrainingEvent.datasets.candidate_reranker_dataset,
    hard_negative_samples: feedbackTrainingEvent.datasets.hard_negative_samples,
    feedback_training_event: feedbackTrainingEvent,
    field_level_diff: feedbackTrainingEvent.field_level_diff,
    candidate_changes: feedbackTrainingEvent.candidate_changes,
    training_eligible: normalizedAction !== "REJECT"
  };

  return { feedbackEvent, learningEvent, status: statusForFeedbackAction(normalizedAction) };
}
