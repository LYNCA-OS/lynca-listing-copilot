import { buildFeedbackLoopEvent } from "../../feedback/feedback_loop.mjs";
import { buildFieldGraph, compactFieldGraph } from "../../feedback/field_graph.mjs";
import { SEM_STANDARD_VERSION } from "../../csm/sem-definition.mjs";
import { parseReviewedTitleFields } from "../../memory/title-field-parser.mjs";
import { renderListingPresentation } from "../../renderer/listing-renderer.mjs";
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

function searchableText(value) {
  return normalizeTitle(Array.isArray(value) ? value.join(" ") : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rawTitleContainsValue(rawTitle = "", value) {
  const raw = ` ${searchableText(rawTitle)} `;
  if (!raw.trim()) return false;
  if (Array.isArray(value)) {
    return value.filter(Boolean).every((item) => rawTitleContainsValue(rawTitle, item));
  }
  const needle = searchableText(value);
  return Boolean(needle) && raw.includes(` ${needle} `);
}

function shouldKeepGeneratedField({ field, generatedValue, parsedValue, rawWriterTitle }) {
  if (!isMeaningfulValue(generatedValue) || !isMeaningfulValue(parsedValue)) return false;
  if (!rawTitleContainsValue(rawWriterTitle, generatedValue)) return false;
  const generatedText = searchableText(generatedValue);
  const parsedText = searchableText(parsedValue);
  if (!generatedText || !parsedText || generatedText === parsedText) return false;

  if (["product", "set", "card_name", "players", "player", "subject"].includes(field)) {
    return generatedText.includes(parsedText) || !rawTitleContainsValue(rawWriterTitle, parsedValue);
  }
  return false;
}

function mergeResolvedForTraining(generatedResolved = {}, parsedCorrected = {}, action = "", rawWriterTitle = "") {
  if (normalizeV4FeedbackAction(action) === "REJECT") return parsedCorrected;
  const merged = { ...generatedResolved };
  for (const [field, value] of Object.entries(parsedCorrected || {})) {
    if (shouldKeepGeneratedField({
      field,
      generatedValue: generatedResolved?.[field],
      parsedValue: value,
      rawWriterTitle
    })) continue;
    merged[field] = value;
  }
  return merged;
}

function maxTitleLengthFromPayload(payload = {}) {
  const candidates = [
    payload.max_title_length,
    payload.maxTitleLength,
    payload.title_length_policy?.max_length,
    payload.renderer?.max_title_length
  ];
  const value = candidates
    .map((candidate) => Number(candidate))
    .find((candidate) => Number.isFinite(candidate) && candidate > 0);
  return value || 80;
}

function buildCsmWriterTitle({
  rawWriterTitle = "",
  generatedTitle = "",
  correctedResolved = {},
  normalizedAction = "",
  resultPayload = {}
} = {}) {
  if (normalizedAction === "REJECT") {
    return {
      raw_writer_title: rawWriterTitle,
      csm_title: rawWriterTitle,
      csm_normalization: {
        applied: false,
        skipped_reason: "REJECTED_FEEDBACK"
      },
      presentation: null
    };
  }

  const hasResolvedField = Object.values(correctedResolved || {}).some(isMeaningfulValue);
  if (!hasResolvedField) {
    return {
      raw_writer_title: rawWriterTitle,
      csm_title: rawWriterTitle || generatedTitle,
      csm_normalization: {
        applied: false,
        skipped_reason: "NO_STRUCTURED_FIELDS"
      },
      presentation: null
    };
  }

  const presentation = renderListingPresentation({
    resolved: correctedResolved,
    evidence: {},
    maxLength: maxTitleLengthFromPayload(resultPayload),
    trustResolvedPrintRunWithoutEvidence: true
  });
  const csmTitle = normalizeTitle(presentation.final_title || presentation.rendered_title);
  if (!csmTitle) {
    return {
      raw_writer_title: rawWriterTitle,
      csm_title: rawWriterTitle || generatedTitle,
      csm_normalization: {
        applied: false,
        skipped_reason: "EMPTY_CSM_RENDER"
      },
      presentation
    };
  }

  return {
    raw_writer_title: rawWriterTitle,
    csm_title: csmTitle,
    csm_normalization: {
      applied: csmTitle !== rawWriterTitle,
      skipped_reason: null,
      source: "WRITER_TITLE_PARSED_THEN_CSM_RENDERED",
      max_length: maxTitleLengthFromPayload(resultPayload)
    },
    presentation
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
  const rawWriterTitle = normalizeTitle(writerTitle || generated);
  const reviewOutcome = normalizedAction === "ACCEPT"
    ? "ACCEPTED_UNCHANGED"
    : normalizedAction === "REJECT"
      ? "REJECTED"
      : "CORRECTED_TITLE";
  const generatedResolved = resultPayload.resolved_fields || resultPayload.fields || {};
  const generatedFieldGraph = buildFieldGraph({
    resolved: generatedResolved,
    evidence: resultPayload.provider_evidence || {},
    retrievalTrace: resultPayload.retrieval_trace || {},
    openSetReadiness: resultPayload.open_set_readiness || {},
    workflowSidecars: resultPayload.workflow_sidecars || {}
  });
  const parsedCorrected = parsedWriterTitleFields(rawWriterTitle);
  const correctedResolved = mergeResolvedForTraining(generatedResolved, parsedCorrected, normalizedAction, rawWriterTitle);
  const csmWriterTitle = buildCsmWriterTitle({
    rawWriterTitle,
    generatedTitle: generated,
    correctedResolved,
    normalizedAction,
    resultPayload
  });
  const finalTitle = csmWriterTitle.csm_title;
  const titleDiff = {
    ...diffWords(generated, finalTitle),
    raw_writer_title: rawWriterTitle,
    csm_normalized_title: finalTitle,
    csm_normalization_applied: csmWriterTitle.csm_normalization.applied === true
  };
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
    payload: {
      ...resultPayload,
      writer_raw_title: rawWriterTitle,
      writer_csm_title: finalTitle,
      csm_normalization: csmWriterTitle.csm_normalization
    },
    reviewOutcome,
    stableTrainingSample: normalizedAction !== "REJECT"
  });
  feedbackTrainingEvent.writer_raw_title = rawWriterTitle;
  feedbackTrainingEvent.writer_csm_title = finalTitle;
  feedbackTrainingEvent.csm_normalization = csmWriterTitle.csm_normalization;

  const feedbackEvent = {
    id: `${sessionId}_${normalizedAction.toLowerCase()}`,
    sem_standard_version: SEM_STANDARD_VERSION,
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
    sem_standard_version: SEM_STANDARD_VERSION,
    recognition_session_id: sessionId,
    event_type: `WRITER_${normalizedAction}`,
    generated_title: generated,
    writer_final_title: finalTitle,
    field_level_ground_truth: feedbackTrainingEvent.datasets.field_level_ground_truth,
    candidate_reranker_dataset: feedbackTrainingEvent.datasets.candidate_reranker_dataset,
    hard_negative_samples: feedbackTrainingEvent.datasets.hard_negative_samples,
    feedback_training_event: feedbackTrainingEvent,
    feedback_layer: feedbackTrainingEvent.feedback_layer,
    semantic_learning_status: feedbackTrainingEvent.semantic_learning_status,
    semantic_truth: feedbackTrainingEvent.semantic_truth,
    writer_semantic_label_required: feedbackTrainingEvent.writer_semantic_label_required,
    field_level_diff: feedbackTrainingEvent.field_level_diff,
    candidate_changes: feedbackTrainingEvent.candidate_changes,
    training_eligible: normalizedAction !== "REJECT"
  };

  return {
    feedbackEvent,
    learningEvent,
    status: statusForFeedbackAction(normalizedAction),
    rawWriterTitle,
    csmTitle: finalTitle,
    csmNormalization: csmWriterTitle.csm_normalization,
    csmPresentation: csmWriterTitle.presentation
  };
}
