import { compactFieldGraph, fieldGraphKeysForTraining } from "./field_graph.mjs";
import {
  SEM_STANDARD_VERSION,
  classifyWriterFeedbackForSemanticLearning
} from "../csm/sem-definition.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "";
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9#/]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return new Set(normalizeComparable(value).split(" ").filter(Boolean));
}

function tokenOverlap(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let hit = 0;
  left.forEach((token) => {
    if (right.has(token)) hit += 1;
  });
  return hit / Math.max(left.size, right.size);
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function candidateId(candidate = {}, fallbackIndex = 0) {
  return normalizeText(
    candidate.candidate_id
    || candidate.candidateIdentityId
    || candidate.card_identity_id
    || candidate.identity_id
    || candidate.id
    || candidate.reference_identity_id
    || `candidate-${fallbackIndex + 1}`
  );
}

function candidateTitle(candidate = {}) {
  return normalizeText(
    candidate.title
    || candidate.canonical_title
    || candidate.corrected_title
    || candidate.rendered_title
    || candidate.name
    || candidate.identity_title
  );
}

function candidateSourceType(candidate = {}) {
  return normalizeText(candidate.candidate_source_type || candidate.source_type || candidate.source || candidate.provider || "UNKNOWN").toUpperCase();
}

function conflictFields(candidate = {}) {
  const fields = [];
  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (isPlainObject(value)) {
      push(value.field || value.field_name || value.name);
      return;
    }
    const normalized = normalizeText(value);
    if (normalized && !fields.includes(normalized)) fields.push(normalized);
  };

  push(candidate.conflicting_fields);
  push(candidate.direct_evidence_conflicts);
  push(candidate.conflicts);
  return fields;
}

function candidateScore(candidate = {}) {
  return numberOrNull(
    candidate.match_score
    ?? candidate.normalized_score
    ?? candidate.score
    ?? candidate.rank_fusion_score
    ?? candidate.similarity
    ?? candidate.raw_score
  );
}

function selectedCandidateIds(payload = {}) {
  return new Set([
    payload.selected_candidate_id,
    payload.selected_catalog_candidate_id,
    payload.selected_vector_candidate_id,
    payload.catalog_selected_candidate_id,
    payload.vector_selected_candidate_id,
    payload.open_set_readiness?.selected_candidate_id,
    payload.open_set_readiness?.catalog?.selected_candidate_id,
    payload.open_set_readiness?.vector?.selected_candidate_id,
    payload.retrieval_trace?.selected_candidate_id,
    payload.retrieval_trace?.catalog_selected_candidate_id,
    payload.retrieval_trace?.vector_selected_candidate_id
  ].map(normalizeText).filter(Boolean));
}

function selectedBySystem(candidate = {}, payload = {}, candidateKey = "") {
  if (candidate.selected === true || candidate.__title_assist_selected_candidate === true) return true;
  const ids = selectedCandidateIds(payload);
  return Boolean(candidateKey && ids.has(candidateKey));
}

function sourceFlags(candidate = {}) {
  const source = candidateSourceType(candidate);
  const text = JSON.stringify(candidate || {}).toLowerCase();
  return {
    catalog_match: /catalog|checklist|registry|official|approved|internal/.test(source.toLowerCase()) || /catalog|checklist|registry|approved_reference/.test(text),
    vector_match: /vector|embedding|visual/.test(source.toLowerCase()) || /vector|embedding|similarity|siglip/.test(text),
    OCR_support: /ocr|paddle|text/.test(source.toLowerCase()) || /ocr|paddle|text_patch|crop_text/.test(text)
  };
}

function collectCandidatesFrom(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidatesFrom(item, out));
    return out;
  }
  if (!isPlainObject(value)) return out;

  const looksLikeCandidate = Boolean(
    value.candidate_id
    || value.card_identity_id
    || value.identity_id
    || value.reference_identity_id
    || value.canonical_title
    || value.match_score !== undefined
    || value.similarity !== undefined
  );
  if (looksLikeCandidate) {
    out.push(value);
    return out;
  }

  [
    "candidates",
    "catalog_candidates",
    "vector_candidates",
    "prompt_candidates",
    "raw_candidates",
    "approved_candidates",
    "sources",
    "results",
    "top_candidates"
  ].forEach((key) => collectCandidatesFrom(value[key], out));
  return out;
}

export function collectTrainingCandidates(payload = {}) {
  const candidates = [];
  collectCandidatesFrom(payload.retrieval_trace || payload.retrievalTrace || payload.retrieval, candidates);
  collectCandidatesFrom(payload.open_set_readiness || payload.openSetReadiness, candidates);
  collectCandidatesFrom(payload.candidate_packet || payload.candidatePacket, candidates);
  collectCandidatesFrom(payload.catalog_candidates || payload.catalogCandidates, candidates);
  collectCandidatesFrom(payload.vector_candidates || payload.vectorCandidates, candidates);

  const byId = new Map();
  candidates.forEach((candidate, index) => {
    const id = candidateId(candidate, index);
    if (!byId.has(id)) byId.set(id, candidate);
  });
  return [...byId.entries()].map(([id, candidate]) => ({ id, candidate }));
}

function writerSelected(candidate = {}, {
  correctedTitle = "",
  reviewOutcome = "",
  systemSelected = false
} = {}) {
  if (reviewOutcome === "ACCEPTED_UNCHANGED" && systemSelected) return true;
  const title = candidateTitle(candidate);
  if (!title || !correctedTitle) return false;
  return tokenOverlap(title, correctedTitle) >= 0.82;
}

export function buildCandidateRerankerDataset({
  queryCardId = "",
  payload = {},
  correctedTitle = "",
  reviewOutcome = "",
  trainingEligible = false
} = {}) {
  return collectTrainingCandidates(payload).map(({ id, candidate }, index) => {
    const flags = sourceFlags(candidate);
    const systemSelected = selectedBySystem(candidate, payload, id);
    return {
      query_card_id: queryCardId,
      candidate_id: id,
      match_score: candidateScore(candidate),
      catalog_match: flags.catalog_match,
      vector_match: flags.vector_match,
      OCR_support: flags.OCR_support,
      conflict_fields: conflictFields(candidate),
      selected_by_system: systemSelected,
      selected_by_writer: writerSelected(candidate, { correctedTitle, reviewOutcome, systemSelected }),
      candidate_rank: numberOrNull(candidate.rank ?? candidate.candidate_rank) ?? index + 1,
      candidate_source_type: candidateSourceType(candidate),
      sem_standard_version: SEM_STANDARD_VERSION,
      training_eligible: trainingEligible === true,
      training_use: "candidate_reranker"
    };
  });
}

export function buildFieldLevelGroundTruth({
  queryCardId = "",
  correctedFieldGraph = {},
  reviewOutcome = "",
  stableTrainingSample = false,
  semanticTruth = false
} = {}) {
  const compact = compactFieldGraph(correctedFieldGraph);
  return fieldGraphKeysForTraining().map((field) => ({
    query_card_id: queryCardId,
    field,
    value: compact[field] || null,
    label_source: semanticTruth ? "reviewed_semantic_field_truth" : stableTrainingSample ? "commercial_writer_title_candidate" : "writer_rejected_or_unstable",
    correction_type: reviewOutcome || "UNKNOWN",
    sem_standard_version: SEM_STANDARD_VERSION,
    feedback_layer: semanticTruth ? "REVIEWED_SEMANTIC_TRUTH" : "COMMERCIAL_FEEDBACK",
    semantic_truth: semanticTruth === true,
    training_eligible: stableTrainingSample && Boolean(compact[field]),
    training_use: "field_level_ground_truth"
  }));
}

export function buildHardNegativeSamples({
  queryCardId = "",
  candidateRows = [],
  fieldChanges = [],
  reviewOutcome = "",
  correctedTitle = "",
  trainingEligible = false
} = {}) {
  const fieldChangeNames = arrayFrom(fieldChanges).map((change) => change?.field).filter(Boolean);
  return candidateRows
    .filter((row) => row.selected_by_system && !row.selected_by_writer || row.conflict_fields.length > 0)
    .map((row) => ({
      query_card_id: queryCardId,
      correct_identity_id: null,
      wrong_candidate_id: row.candidate_id,
      error_type: row.conflict_fields.length ? "DIRECT_FIELD_CONFLICT" : "WRITER_DID_NOT_SELECT_SYSTEM_CANDIDATE",
      matched_fields: [],
      conflicting_fields: row.conflict_fields.length ? row.conflict_fields : fieldChangeNames,
      writer_resolution: correctedTitle,
      correction_type: reviewOutcome,
      training_eligible: trainingEligible === true,
      training_use: "hard_negative_sample"
    }));
}

function candidateChangeSummary(rows = []) {
  const system = rows.find((row) => row.selected_by_system)?.candidate_id || null;
  const writer = rows.find((row) => row.selected_by_writer)?.candidate_id || null;
  return {
    selected_by_system: system,
    selected_by_writer: writer,
    changed_by_writer: Boolean(system && writer && system !== writer),
    candidate_count: rows.length,
    conflict_candidate_count: rows.filter((row) => row.conflict_fields.length > 0).length
  };
}

export function buildFeedbackLoopEvent({
  queryCardId = "",
  assetFingerprint = null,
  generatedTitle = "",
  correctedTitle = "",
  generatedFieldGraph = {},
  correctedFieldGraph = {},
  fieldChanges = [],
  payload = {},
  reviewOutcome = "",
  stableTrainingSample = false,
  reviewedSemanticFields = false,
  createdAt = new Date().toISOString()
} = {}) {
  const semanticLearning = classifyWriterFeedbackForSemanticLearning({
    action: reviewOutcome,
    stableTrainingSample,
    reviewedSemanticFields
  });
  const candidateRows = buildCandidateRerankerDataset({
    queryCardId,
    payload,
    correctedTitle,
    reviewOutcome,
    trainingEligible: semanticLearning.training_eligible === true
  });
  const fieldGroundTruthRows = semanticLearning.semantic_truth === true
    ? buildFieldLevelGroundTruth({
      queryCardId,
      correctedFieldGraph,
      reviewOutcome,
      stableTrainingSample,
      semanticTruth: true
    })
    : [];
  const hardNegativeRows = buildHardNegativeSamples({
    queryCardId,
    candidateRows,
    fieldChanges,
    reviewOutcome,
    correctedTitle,
    trainingEligible: semanticLearning.training_eligible === true
  });

  return {
    schema_version: "listing-feedback-loop-training-v1",
    sem_standard_version: SEM_STANDARD_VERSION,
    query_card_id: queryCardId,
    asset_fingerprint: assetFingerprint,
    ai_generated_title: generatedTitle,
    writer_final_title: correctedTitle,
    correction_type: reviewOutcome || "UNKNOWN",
    feedback_layer: semanticLearning.feedback_layer,
    semantic_learning_status: semanticLearning.semantic_learning_status,
    writer_semantic_label_required: semanticLearning.semantic_truth !== true && reviewOutcome !== "REJECTED",
    semantic_truth: semanticLearning.semantic_truth,
    field_level_diff: arrayFrom(fieldChanges),
    candidate_changes: candidateChangeSummary(candidateRows),
    generated_field_graph: generatedFieldGraph,
    corrected_field_graph: correctedFieldGraph,
    datasets: {
      candidate_reranker_dataset: candidateRows,
      field_level_ground_truth: fieldGroundTruthRows,
      hard_negative_samples: hardNegativeRows
    },
    training_ready: semanticLearning.training_eligible === true,
    created_at: createdAt
  };
}
