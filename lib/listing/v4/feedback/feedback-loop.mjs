import { buildFeedbackLoopEvent } from "../../feedback/feedback_loop.mjs";
import { buildFieldGraph, compactFieldGraph } from "../../feedback/field_graph.mjs";
import {
  FEEDBACK_CAPTURE_SCHEMA_VERSION,
  FEEDBACK_DATASET_DISPOSITION,
  createFeedbackSubmissionId,
  feedbackEventIdentity,
  feedbackPayloadSha256,
  normalizeClientOccurredAt
} from "../../feedback/feedback-capture.mjs";
import { buildTitleDiff, TITLE_DIFF_ALGORITHM_VERSION } from "../../feedback/title-diff.mjs";
import { SEM_STANDARD_VERSION } from "../../csm/sem-definition.mjs";
import { buildWriterTitleSemCandidate } from "../../csm/title-derived-sem.mjs";
import { buildErrorDatasetCandidate } from "../../evaluation/data-asset-projections.mjs";
import { parseReviewedTitleFields } from "../../memory/title-field-parser.mjs";
import { renderListingPresentation } from "../../renderer/listing-renderer.mjs";
import { v4SessionStatuses } from "../session/status.mjs";

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function mergeResolvedForPresentation(generatedResolved = {}, parsedCorrected = {}, action = "", rawWriterTitle = "") {
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
      csm_title: "",
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
  operatorId = "",
  submissionId = "",
  clientOccurredAt = null,
  recognitionResult = null,
  reviewedSemanticFields = false
} = {}) {
  const normalizedAction = normalizeV4FeedbackAction(action);
  const authoritativeRecognition = recognitionResult && typeof recognitionResult === "object"
    ? recognitionResult
    : {};
  const generated = normalizeTitle(
    authoritativeRecognition.ai_title
    || aiTitle
    || resultPayload.final_title
    || resultPayload.title
  );
  const submittedWriterTitle = normalizeTitle(writerTitle);
  const rawWriterTitle = submittedWriterTitle || (normalizedAction === "REJECT" ? "" : generated);
  const writerFinalTitle = normalizedAction === "REJECT" ? "" : rawWriterTitle;
  const reviewOutcome = normalizedAction === "ACCEPT"
    ? "ACCEPTED_UNCHANGED"
    : normalizedAction === "REJECT"
      ? "REJECTED"
      : "CORRECTED_TITLE";
  const generatedResolved = authoritativeRecognition.ai_sem
    || resultPayload.resolved_fields
    || resultPayload.fields
    || {};
  const generatedFieldGraph = buildFieldGraph({
    resolved: generatedResolved,
    evidence: resultPayload.provider_evidence || {},
    retrievalTrace: resultPayload.retrieval_trace || {},
    openSetReadiness: resultPayload.open_set_readiness || {},
    workflowSidecars: resultPayload.workflow_sidecars || {}
  });
  const parsedCorrected = parsedWriterTitleFields(writerFinalTitle);
  const presentationResolved = mergeResolvedForPresentation(
    generatedResolved,
    parsedCorrected,
    normalizedAction,
    writerFinalTitle
  );
  const correctedResolved = parsedCorrected;
  const csmWriterTitle = buildCsmWriterTitle({
    rawWriterTitle,
    generatedTitle: generated,
    correctedResolved: presentationResolved,
    normalizedAction,
    resultPayload
  });
  const finalTitle = csmWriterTitle.csm_title;
  const titleDiff = {
    ...buildTitleDiff(generated, writerFinalTitle),
    raw_writer_title: rawWriterTitle,
    csm_normalized_title: finalTitle,
    csm_normalization_applied: csmWriterTitle.csm_normalization.applied === true,
    normalization_diff: buildTitleDiff(writerFinalTitle, finalTitle)
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
    correctedTitle: writerFinalTitle,
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
    stableTrainingSample: reviewedSemanticFields === true,
    reviewedSemanticFields: reviewedSemanticFields === true
  });
  feedbackTrainingEvent.writer_raw_title = rawWriterTitle;
  feedbackTrainingEvent.writer_csm_title = finalTitle;
  feedbackTrainingEvent.csm_normalization = csmWriterTitle.csm_normalization;

  const identity = feedbackEventIdentity({
    sessionId,
    submissionId: submissionId || createFeedbackSubmissionId()
  });
  const semExtraction = buildWriterTitleSemCandidate(writerFinalTitle, { action: normalizedAction });
  const recognitionSnapshot = Object.keys(authoritativeRecognition).length
    ? authoritativeRecognition
    : {
        schema_version: FEEDBACK_CAPTURE_SCHEMA_VERSION,
        result_id: sessionId || null,
        recognition_session_id: sessionId || null,
        sem_standard_version: SEM_STANDARD_VERSION,
        ai_title: generated || null,
        ai_sem: generatedResolved,
        model_version: resultPayload.model_version || resultPayload.model_id || resultPayload.model || null,
        generation_manifest: {
          provider: resultPayload.provider || resultPayload.provider_id || null,
          model: resultPayload.model_version || resultPayload.model_id || resultPayload.model || null,
          sem_standard_version: SEM_STANDARD_VERSION
        }
      };
  const writerFeedback = {
    schema_version: FEEDBACK_CAPTURE_SCHEMA_VERSION,
    submission_id: identity.submission_id,
    tenant_id: authoritativeRecognition.tenant_id || null,
    user_id: authoritativeRecognition.user_id || operatorId || null,
    asset_id: authoritativeRecognition.asset_id || null,
    action: normalizedAction,
    final_title: writerFinalTitle || null,
    raw_input_title: rawWriterTitle || null,
    normalized_title: finalTitle || null,
    operator_id: operatorId || null,
    client_occurred_at: normalizeClientOccurredAt(clientOccurredAt)
  };
  const payloadSha256 = feedbackPayloadSha256({
    recognition_session_id: sessionId,
    recognition_result: recognitionSnapshot,
    writer_feedback: writerFeedback,
    title_diff: titleDiff,
    sem_extraction: semExtraction
  });
  const feedbackEvent = {
    id: identity.feedback_event_id,
    submission_id: identity.submission_id,
    payload_sha256: payloadSha256,
    sem_standard_version: SEM_STANDARD_VERSION,
    recognition_session_id: sessionId,
    tenant_id: authoritativeRecognition.tenant_id || null,
    user_id: authoritativeRecognition.user_id || operatorId || null,
    asset_id: authoritativeRecognition.asset_id || null,
    client_asset_ref: authoritativeRecognition.client_asset_ref || null,
    asset_fingerprint: authoritativeRecognition.asset_fingerprint || null,
    model_version: authoritativeRecognition.model_version || null,
    prompt_version: authoritativeRecognition.prompt_version || null,
    action: normalizedAction,
    generated_title: generated,
    writer_final_title: writerFinalTitle,
    writer_raw_title: rawWriterTitle || null,
    writer_normalized_title: finalTitle || null,
    recognition_result: recognitionSnapshot,
    writer_feedback: writerFeedback,
    title_diff: titleDiff,
    diff_algorithm_version: TITLE_DIFF_ALGORITHM_VERSION,
    field_graph: correctedFieldGraph,
    operator_id: operatorId || null,
    correction_type: normalizedAction === "ACCEPT" ? "NO_CHANGE" : normalizedAction,
    client_occurred_at: writerFeedback.client_occurred_at,
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION
  };
  const errorCandidate = buildErrorDatasetCandidate({
    feedbackEvent,
    semExtraction
  });

  const learningEvent = {
    id: identity.learning_event_id,
    feedback_event_id: identity.feedback_event_id,
    sem_standard_version: SEM_STANDARD_VERSION,
    recognition_session_id: sessionId,
    event_type: `WRITER_${normalizedAction}`,
    generated_title: generated,
    writer_final_title: writerFinalTitle,
    field_level_ground_truth: feedbackTrainingEvent.datasets.field_level_ground_truth,
    candidate_reranker_dataset: feedbackTrainingEvent.datasets.candidate_reranker_dataset,
    hard_negative_samples: feedbackTrainingEvent.datasets.hard_negative_samples,
    feedback_training_event: feedbackTrainingEvent,
    feedback_layer: feedbackTrainingEvent.feedback_layer,
    semantic_learning_status: feedbackTrainingEvent.semantic_learning_status,
    semantic_truth: feedbackTrainingEvent.semantic_truth,
    writer_semantic_label_required: feedbackTrainingEvent.writer_semantic_label_required,
    sem_extraction: semExtraction,
    sem_validation: semExtraction.validation,
    error_candidates: errorCandidate ? [errorCandidate] : [],
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
    field_level_diff: feedbackTrainingEvent.field_level_diff,
    candidate_changes: feedbackTrainingEvent.candidate_changes,
    training_eligible: feedbackTrainingEvent.training_ready === true && reviewedSemanticFields === true
  };

  return {
    feedbackEvent,
    learningEvent,
    status: statusForFeedbackAction(normalizedAction),
    rawWriterTitle,
    csmTitle: finalTitle,
    csmNormalization: csmWriterTitle.csm_normalization,
    csmPresentation: csmWriterTitle.presentation,
    correctedResolved,
    recognitionResult: recognitionSnapshot,
    writerFeedback,
    semExtraction,
    submissionId: identity.submission_id,
    payloadSha256
  };
}
