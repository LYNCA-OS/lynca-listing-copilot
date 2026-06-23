import {
  recognitionDatasetStats,
  recognitionMetricFields,
  stableManifestHash,
  validateRecognitionDataset
} from "./recognition-dataset.mjs";

export const commercialReviewPacketSchemaVersion = "commercial-review-packet-v1";
export const reviewedRecognitionExportSchemaVersion = "recognition-candidate-export-v1";

const reviewedStatuses = new Set(["SINGLE_REVIEWED", "DOUBLE_REVIEWED", "ARBITRATED"]);
const allowedGroundTruthSourceTypes = new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OCR_REVIEW",
  "OPERATOR",
  "OFFICIAL_CHECKLIST",
  "INTERNAL_REGISTRY",
  "APPROVED_HISTORY",
  "UNKNOWN"
]);
const defaultRequiredCriticalFields = Object.freeze(["year", "product", "players"]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function normalizeBoolean(value) {
  return value === true;
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function readItems(input = {}) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.items)) return input.items;
  return [];
}

export function emptyRecognitionGroundTruth() {
  return {
    year: null,
    manufacturer: null,
    product: null,
    set: null,
    players: [],
    card_type: null,
    insert: null,
    parallel: null,
    variation: null,
    serial_number: null,
    collector_number: null,
    checklist_code: null,
    attributes: [],
    rc: false,
    first_bowman: false,
    auto: false,
    patch: false,
    relic: false,
    ssp: false,
    case_hit: false,
    one_of_one: false,
    grade_company: null,
    card_grade: null,
    auto_grade: null,
    grade_type: "UNKNOWN"
  };
}

export function normalizeRecognitionGroundTruth(fields = {}) {
  const base = emptyRecognitionGroundTruth();
  return {
    ...base,
    year: normalizeText(fields.year) || null,
    manufacturer: normalizeText(fields.manufacturer) || null,
    product: normalizeText(fields.product) || null,
    set: normalizeText(fields.set) || null,
    players: normalizeArray(fields.players ?? fields.player),
    card_type: normalizeText(fields.card_type) || null,
    insert: normalizeText(fields.insert) || null,
    parallel: normalizeText(fields.parallel) || null,
    variation: normalizeText(fields.variation) || null,
    serial_number: normalizeText(fields.serial_number) || null,
    collector_number: normalizeText(fields.collector_number) || null,
    checklist_code: normalizeText(fields.checklist_code) || null,
    attributes: normalizeArray(fields.attributes),
    rc: normalizeBoolean(fields.rc),
    first_bowman: normalizeBoolean(fields.first_bowman),
    auto: normalizeBoolean(fields.auto),
    patch: normalizeBoolean(fields.patch),
    relic: normalizeBoolean(fields.relic),
    ssp: normalizeBoolean(fields.ssp),
    case_hit: normalizeBoolean(fields.case_hit),
    one_of_one: normalizeBoolean(fields.one_of_one),
    grade_company: normalizeText(fields.grade_company) || null,
    card_grade: normalizeText(fields.card_grade) || null,
    auto_grade: normalizeText(fields.auto_grade) || null,
    grade_type: ["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN"].includes(fields.grade_type)
      ? fields.grade_type
      : "UNKNOWN"
  };
}

function normalizedSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source) => ({
      field: normalizeText(source?.field),
      source_type: allowedGroundTruthSourceTypes.has(source?.source_type) ? source.source_type : "UNKNOWN",
      source_ref: normalizeText(source?.source_ref) || null,
      confidence: Number.isFinite(Number(source?.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : null,
      notes: normalizeText(source?.notes) || null
    }))
    .filter((source) => source.field);
}

function criticalFieldsFromGroundTruth(groundTruth = {}, requiredFields = defaultRequiredCriticalFields) {
  return [...new Set([
    ...requiredFields,
    ...recognitionMetricFields.filter((field) => valuePresent(groundTruth[field]))
  ])].filter((field) => recognitionMetricFields.includes(field));
}

function taskSourceTitles(item = {}) {
  const sourceTitles = item.source_titles && typeof item.source_titles === "object" ? item.source_titles : {};
  return {
    generated_title: normalizeText(sourceTitles.generated_title) || null,
    corrected_title: normalizeText(sourceTitles.corrected_title) || null
  };
}

export function createCommercialReviewPacket(candidateManifest = {}, {
  now = () => new Date(),
  limit = 0,
  requiredCriticalFields = defaultRequiredCriticalFields
} = {}) {
  const sourceItems = readItems(candidateManifest);
  const selectedItems = limit > 0 ? sourceItems.slice(0, limit) : sourceItems;
  const tasks = selectedItems.map((item) => {
    const sourceTitles = taskSourceTitles(item);
    return {
      asset_id: item.asset_id,
      source_feedback_id: item.source_feedback_id || null,
      physical_card_id: item.physical_card_id || null,
      capture_session_id: item.capture_session_id || null,
      category: item.category || "sports_card",
      images: Array.isArray(item.images) ? item.images : [],
      source_titles: sourceTitles,
      corrected_title_hint: sourceTitles.corrected_title,
      generated_title_hint: sourceTitles.generated_title,
      corrected_title_used_as_ground_truth: false,
      required_critical_fields: [...requiredCriticalFields],
      reviewed_ground_truth: emptyRecognitionGroundTruth(),
      critical_fields: [...requiredCriticalFields],
      ground_truth_sources: [],
      reviewed_by: [],
      review_status: "NEEDS_REVIEW",
      difficulty_tags: Array.isArray(item.difficulty_tags) ? item.difficulty_tags : [],
      review_notes: "Fill reviewed_ground_truth from image/card/official evidence. Do not copy corrected_title as truth without evidence."
    };
  });

  return {
    schema_version: commercialReviewPacketSchemaVersion,
    generated_at: now().toISOString(),
    source: {
      provider: "recognition_candidate_manifest",
      manifest_hash: candidateManifest.manifest_hash || candidateManifest.summary?.manifest_hash || null,
      source_item_count: sourceItems.length
    },
    summary: {
      task_count: tasks.length,
      corrected_title_hint_count: tasks.filter((task) => task.corrected_title_hint).length,
      corrected_title_used_as_ground_truth: false,
      required_critical_fields: [...requiredCriticalFields]
    },
    tasks
  };
}

function reject(index, task, reasons) {
  return {
    index,
    asset_id: task?.asset_id || null,
    source_feedback_id: task?.source_feedback_id || null,
    reasons
  };
}

function validateReviewedTask(task = {}, index = 0, {
  requireDoubleReview = false,
  requiredCriticalFields = defaultRequiredCriticalFields
} = {}) {
  const reasons = [];
  const status = normalizeText(task.review_status).toUpperCase();
  const reviewers = normalizeArray(task.reviewed_by);
  const groundTruth = normalizeRecognitionGroundTruth(task.reviewed_ground_truth || task.ground_truth || {});
  const criticalFields = normalizeArray(task.critical_fields).length
    ? normalizeArray(task.critical_fields)
    : criticalFieldsFromGroundTruth(groundTruth, requiredCriticalFields);
  const sources = normalizedSources(task.ground_truth_sources);

  if (!normalizeText(task.asset_id)) reasons.push("missing asset_id");
  if (!Array.isArray(task.images) || task.images.length < 1) reasons.push("missing images");
  if (!reviewedStatuses.has(status)) reasons.push("review_status must be SINGLE_REVIEWED, DOUBLE_REVIEWED, or ARBITRATED");
  if (reviewers.length < 1) reasons.push("reviewed_by is required");
  if ((status === "DOUBLE_REVIEWED" || requireDoubleReview) && reviewers.length < 2) {
    reasons.push("double review requires at least two reviewers");
  }
  if (task.corrected_title_used_as_ground_truth === true) {
    reasons.push("corrected_title cannot be used as field-level ground truth");
  }

  requiredCriticalFields.forEach((field) => {
    if (!valuePresent(groundTruth[field])) reasons.push(`missing required ground_truth.${field}`);
    if (!criticalFields.includes(field)) reasons.push(`critical_fields must include ${field}`);
  });

  criticalFields.forEach((field) => {
    if (!recognitionMetricFields.includes(field)) reasons.push(`unknown critical field ${field}`);
    if (!valuePresent(groundTruth[field])) reasons.push(`critical field ${field} lacks reviewed ground truth`);
    if (!sources.some((source) => source.field === field)) {
      reasons.push(`critical field ${field} lacks ground_truth_sources evidence`);
    }
  });

  return {
    ok: reasons.length === 0,
    rejected: reject(index, task, reasons),
    normalized: {
      ...task,
      review_status: status,
      reviewed_by: reviewers,
      reviewed_ground_truth: groundTruth,
      critical_fields: criticalFields,
      ground_truth_sources: sources
    }
  };
}

export function reviewPacketToRecognitionDataset(reviewPacket = {}, {
  split = "held_out_commercial",
  requireDoubleReview = false,
  requiredCriticalFields = defaultRequiredCriticalFields
} = {}) {
  const tasks = Array.isArray(reviewPacket.tasks) ? reviewPacket.tasks : [];
  const items = [];
  const rejected_tasks = [];

  tasks.forEach((task, index) => {
    const validation = validateReviewedTask(task, index, {
      requireDoubleReview,
      requiredCriticalFields
    });

    if (!validation.ok) {
      rejected_tasks.push(validation.rejected);
      return;
    }

    const normalized = validation.normalized;
    items.push({
      asset_id: normalized.asset_id,
      physical_card_id: normalized.physical_card_id || `reviewed_${normalized.asset_id}`,
      capture_session_id: normalized.capture_session_id || `reviewed_${normalized.asset_id}`,
      source_feedback_id: normalized.source_feedback_id || null,
      split,
      images: normalized.images,
      category: normalized.category || "sports_card",
      ground_truth: normalized.reviewed_ground_truth,
      critical_fields: normalized.critical_fields,
      difficulty_tags: [...new Set([...(Array.isArray(normalized.difficulty_tags) ? normalized.difficulty_tags : []), "commercial_reviewed"])],
      ground_truth_sources: normalized.ground_truth_sources,
      reviewed_by: normalized.reviewed_by,
      review_status: normalized.review_status,
      notes: normalizeText(normalized.review_notes) || "Imported from commercial field-level review packet.",
      source_titles: taskSourceTitles(normalized),
      created_at: normalized.created_at || reviewPacket.generated_at || null,
      updated_at: normalized.updated_at || reviewPacket.generated_at || null
    });
  });

  const validationErrors = validateRecognitionDataset(items);
  return {
    items,
    rejected_tasks,
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors
    },
    dataset_stats: recognitionDatasetStats(items)
  };
}

export function reviewedRecognitionExportPayload({
  items = [],
  rejectedTasks = [],
  sourcePacket = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const validationErrors = validateRecognitionDataset(items);
  return {
    schema_version: reviewedRecognitionExportSchemaVersion,
    source: {
      provider: "commercial_review_packet",
      packet_schema_version: sourcePacket.schema_version || null,
      packet_generated_at: sourcePacket.generated_at || null,
      source_task_count: Array.isArray(sourcePacket.tasks) ? sourcePacket.tasks.length : 0
    },
    generated_at: generatedAt,
    manifest_hash: stableManifestHash(items),
    summary: {
      item_count: items.length,
      rejected_task_count: rejectedTasks.length,
      review_status: "FIELD_REVIEWED",
      corrected_title_used_as_ground_truth: false,
      validation_error_count: validationErrors.length
    },
    items
  };
}
