import { feedbackPayloadSha256 } from "../feedback/feedback-capture.mjs";
import { resolvedFieldsToSemSuggestion } from "../csm/title-derived-sem.mjs";
import { SEM_STANDARD_VERSION } from "../csm/sem-definition.mjs";

export const GOLDEN_TITLE_CANDIDATE_SCHEMA_VERSION = "golden-title-v1";
export const GOLDEN_SEM_CANDIDATE_SCHEMA_VERSION = "golden-sem-candidate-v1";
export const ERROR_DATASET_CANDIDATE_SCHEMA_VERSION = "error-dataset-candidate-v1";
export const DATA_FLYWHEEL_ERROR_TYPES = Object.freeze([
  "WRONG_PRODUCT",
  "WRONG_SUBJECT",
  "WRONG_PARALLEL",
  "MISSING_NUMBERED",
  "WRONG_CARD_NUMBER",
  "WRONG_GRADE",
  "MISSING_FIELD"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function comparable(value) {
  if (Array.isArray(value)) return [...value].map(comparable).filter(Boolean).sort().join("|");
  if (value && typeof value === "object") {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${comparable(child)}`).join("|");
  }
  return cleanText(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9/.-]+/g, " ").trim();
}

function valuesDiffer(left, right) {
  return comparable(left) !== comparable(right);
}

function hasValue(value) {
  return comparable(value) !== "";
}

function safeImages(images = []) {
  return (Array.isArray(images) ? images : []).map((image = {}, index) => ({
    image_id: cleanText(image.image_id || image.id || `image-${index + 1}`),
    bucket: cleanText(image.bucket) || null,
    object_path: cleanText(image.object_path || image.path) || null,
    content_sha256: cleanText(image.content_sha256) || null,
    image_role: cleanText(image.image_role || image.role) || null
  })).filter((image) => image.object_path || image.content_sha256);
}

function errorTypesFromSemDiff(aiSem = {}, writerSem = {}) {
  const types = new Set();
  const compareFields = (fields, type) => {
    if (fields.some((field) => hasValue(writerSem[field]) && valuesDiffer(aiSem[field], writerSem[field]))) {
      types.add(type);
    }
  };
  compareFields(["manufacturer", "product", "set"], "WRONG_PRODUCT");
  compareFields(["subject"], "WRONG_SUBJECT");
  const finishFields = ["print_finish", "release_variant", "descriptive_rarity"];
  if (finishFields.some((field) => hasValue(writerSem[field]) && valuesDiffer(aiSem[field], writerSem[field]))) {
    types.add("WRONG_PARALLEL");
  }
  compareFields(["numerical_rarity"], "MISSING_NUMBERED");
  compareFields(["card_number"], "WRONG_CARD_NUMBER");
  compareFields(["grading_info"], "WRONG_GRADE");
  const missingGenericField = Object.entries(writerSem)
    .some(([field, value]) => hasValue(value) && !hasValue(aiSem[field]));
  if (missingGenericField) types.add("MISSING_FIELD");
  return DATA_FLYWHEEL_ERROR_TYPES.filter((type) => types.has(type));
}

export function buildGoldenTitleCandidate({ feedbackEvent = {}, semExtraction = null, images = [] } = {}) {
  const writerFeedback = plainObject(feedbackEvent.writer_feedback);
  const finalTitle = cleanText(writerFeedback.final_title || feedbackEvent.writer_raw_title);
  if (!finalTitle || String(feedbackEvent.action || "").toUpperCase() === "REJECT") return null;
  const recognition = plainObject(feedbackEvent.recognition_result);
  const safeImageRecords = safeImages(images);
  const extraction = plainObject(semExtraction || feedbackEvent.sem_extraction);
  const imageReferenceAvailable = safeImageRecords.length > 0;
  const imageContentPinned = imageReferenceAvailable
    && safeImageRecords.every((image) => /^[0-9a-f]{64}$/i.test(cleanText(image.content_sha256)));
  const freezeBlockers = imageReferenceAvailable
    ? imageContentPinned ? [] : ["IMAGE_CONTENT_SHA256_REQUIRED"]
    : ["IMAGE_REFERENCE_REQUIRED"];
  const item = {
    schema_version: GOLDEN_TITLE_CANDIDATE_SCHEMA_VERSION,
    candidate_id: `golden-title:${cleanText(feedbackEvent.id)}`,
    source_feedback_event_id: cleanText(feedbackEvent.id),
    recognition_result_id: cleanText(recognition.result_id) || null,
    asset_id: cleanText(recognition.asset_id) || null,
    images: safeImageRecords,
    writer_verified_title: finalTitle,
    title_label_scope: "TITLE_VERIFIED",
    validation_status: "VALIDATED",
    confidence: 1,
    title_truth: true,
    human_sem: null,
    sem_candidate: plainObject(extraction.candidate_sem),
    sem_validation_status: cleanText(extraction.validation_status || extraction.status) || "PENDING",
    source: "writer_verified",
    freeze_scope: "TITLE_ONLY",
    image_reference_available: imageReferenceAvailable,
    image_content_pinned: imageContentPinned,
    freeze_eligible: freezeBlockers.length === 0,
    freeze_blockers: freezeBlockers,
    training_eligible: false
  };
  return { ...item, content_sha256: feedbackPayloadSha256(item) };
}

export function buildGoldenSemCandidate({
  feedbackEvent = {},
  reviewedSem = {},
  review = {},
  images = [],
  identityGroupId = ""
} = {}) {
  const titleCandidate = buildGoldenTitleCandidate({ feedbackEvent, images });
  const reviewStatus = String(review.status || review.review_status || "").toUpperCase();
  const approved = ["APPROVED", "VALIDATED"].includes(reviewStatus);
  const reviewer = cleanText(review.reviewed_by);
  const reviewedAt = cleanText(review.reviewed_at);
  const humanSem = plainObject(reviewedSem);
  const contentFixedImages = (titleCandidate?.images || []).filter((image) => /^[0-9a-f]{64}$/i.test(cleanText(image.content_sha256)));
  if (!titleCandidate
      || !titleCandidate.freeze_eligible
      || !contentFixedImages.length
      || !approved
      || !reviewer
      || !reviewedAt
      || !Object.keys(humanSem).length
      || !cleanText(identityGroupId)) {
    return null;
  }
  const item = {
    schema_version: GOLDEN_SEM_CANDIDATE_SCHEMA_VERSION,
    candidate_id: `golden-sem:${cleanText(feedbackEvent.id)}`,
    source_feedback_event_id: cleanText(feedbackEvent.id),
    recognition_result_id: titleCandidate.recognition_result_id,
    asset_id: titleCandidate.asset_id,
    identity_group_id: cleanText(identityGroupId),
    images: titleCandidate.images,
    writer_verified_title: titleCandidate.writer_verified_title,
    human_sem: humanSem,
    sem_standard_version: SEM_STANDARD_VERSION,
    source: "writer_verified_and_field_reviewed",
    validation_status: "VALIDATED",
    confidence: Number.isFinite(Number(review.confidence)) ? Number(review.confidence) : 1,
    review: {
      status: "APPROVED",
      reviewed_by: reviewer,
      reviewed_at: reviewedAt,
      evidence_sources: Array.isArray(review.evidence_sources)
        ? review.evidence_sources
        : plainObject(review.evidence_sources)
    },
    freeze_scope: "IMAGE_AND_VALIDATED_SEM",
    freeze_eligible: true,
    freeze_blockers: [],
    training_eligible: false
  };
  return { ...item, content_sha256: feedbackPayloadSha256(item) };
}

export function buildErrorDatasetCandidate({ feedbackEvent = {}, semExtraction = null } = {}) {
  const recognition = plainObject(feedbackEvent.recognition_result);
  const writerFeedback = plainObject(feedbackEvent.writer_feedback);
  const extraction = plainObject(semExtraction || feedbackEvent.sem_extraction);
  const aiSem = resolvedFieldsToSemSuggestion(plainObject(recognition.ai_sem));
  const writerSem = plainObject(extraction.candidate_sem);
  const errorTypes = errorTypesFromSemDiff(aiSem, writerSem);
  const action = String(feedbackEvent.action || writerFeedback.action || "").toUpperCase();
  if (!errorTypes.length && action !== "EDIT" && action !== "REJECT") return null;
  const item = {
    schema_version: ERROR_DATASET_CANDIDATE_SCHEMA_VERSION,
    candidate_id: `error:${cleanText(feedbackEvent.id)}`,
    source_feedback_event_id: cleanText(feedbackEvent.id),
    recognition_result_id: cleanText(recognition.result_id) || null,
    asset_id: cleanText(recognition.asset_id) || null,
    ai_output: {
      title: cleanText(recognition.ai_title || feedbackEvent.generated_title) || null,
      sem: aiSem,
      model_version: cleanText(recognition.model_version) || null
    },
    human_output: {
      title: cleanText(writerFeedback.final_title || feedbackEvent.writer_raw_title) || null,
      sem_candidate: writerSem
    },
    error_types: errorTypes,
    error_type_taxonomy_version: "data-flywheel-errors-v1",
    classification_status: errorTypes.length ? "CANDIDATE" : "PENDING",
    label_status: "CANDIDATE",
    label_source: "AUTO_SEM_DIFF",
    human_verified: false,
    semantic_truth: false,
    training_eligible: false
  };
  return { ...item, content_sha256: feedbackPayloadSha256(item) };
}
