import crypto from "node:crypto";
import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { buildFeedbackLoopEvent } from "./feedback_loop.mjs";
import { buildFieldGraph } from "./field_graph.mjs";

export const reviewOutcomes = Object.freeze({
  ACCEPTED_UNCHANGED: "ACCEPTED_UNCHANGED",
  CORRECTED_FIELDS: "CORRECTED_FIELDS",
  TITLE_ONLY_OVERRIDE: "TITLE_ONLY_OVERRIDE",
  TARGETED_RESCAN_RECOVERED: "TARGETED_RESCAN_RECOVERED",
  NON_STANDARD_MANUAL: "NON_STANDARD_MANUAL",
  REJECTED: "REJECTED",
  TECHNICAL_FAILURE: "TECHNICAL_FAILURE"
});

const criticalFieldNames = Object.freeze([
  "players",
  "character",
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "card_type",
  "insert",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);
const sha256HexPattern = /^[0-9a-f]{64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) return value.map(normalizeComparableValue);
  if (value === undefined) return null;
  if (typeof value === "string") return normalizeTitle(value) || null;
  return value;
}

function valuesEqual(a, b) {
  return JSON.stringify(normalizeComparableValue(a)) === JSON.stringify(normalizeComparableValue(b));
}

function sanitizeJson(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return value;
  return fallback;
}

function idWithPrefix(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function rawImageObjectPath(image = {}) {
  if (typeof image === "string") return image;
  return image.objectPath || image.object_path || image.storagePath || image.storage_path || "";
}

function sanitizeSha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return sha256HexPattern.test(normalized) ? normalized : "";
}

function rawImageContentSha256(image = {}) {
  if (!isPlainObject(image)) return "";
  return sanitizeSha256(image.contentSha256 || image.content_sha256 || image.sha256 || image.image_sha256);
}

export function sanitizeStorageObjectPath(value) {
  const objectPath = String(value || "").trim();
  if (!objectPath) return "";
  if (objectPath.length > 1024) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(objectPath)) return "";
  if (objectPath.includes("?") || objectPath.includes("#") || objectPath.includes("\\") || objectPath.startsWith("/")) return "";
  if (objectPath.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return objectPath;
}

function imageObjectPath(image = {}) {
  return sanitizeStorageObjectPath(rawImageObjectPath(image));
}

function imageRole(image = {}, index) {
  return image.storageRole || image.storage_role || image.role || (
    index === 0 ? "front_original" : index === 1 ? "back_original" : "additional"
  );
}

function additionalImagePathRecord(image = {}, index = 0) {
  if (typeof image === "string") {
    const objectPath = sanitizeStorageObjectPath(image);
    return objectPath
      ? {
        role: "additional",
        object_path: objectPath,
        content_sha256: null,
        image_id: null,
        derived: false,
        source_region: null
      }
      : null;
  }

  if (!isPlainObject(image)) return null;
  const objectPath = imageObjectPath(image);
  if (!objectPath) return null;

  return {
    role: imageRole(image, index),
    object_path: objectPath,
    content_sha256: rawImageContentSha256(image) || null,
    image_id: image.id || image.image_id || null,
    derived: image.derived === true,
    source_region: image.sourceRegion || image.source_region || null
  };
}

function pushAdditionalImagePath(paths, imageRecord) {
  if (!imageRecord?.object_path) return;
  if (imageRecord.object_path === paths.front_object_path || imageRecord.object_path === paths.back_object_path) return;
  if (paths.additional_image_paths.some((existing) => existing.object_path === imageRecord.object_path)) return;
  paths.additional_image_paths.push(imageRecord);
}

function removeAdditionalImagePath(paths, objectPath) {
  if (!objectPath) return;
  paths.additional_image_paths = paths.additional_image_paths.filter((image) => image.object_path !== objectPath);
}

export function extractAssetImagePaths(images = [], directPaths = {}) {
  const paths = {
    front_object_path: sanitizeStorageObjectPath(directPaths.front_object_path || directPaths.frontObjectPath) || null,
    back_object_path: sanitizeStorageObjectPath(directPaths.back_object_path || directPaths.backObjectPath) || null,
    front_content_sha256: sanitizeSha256(directPaths.front_content_sha256 || directPaths.frontContentSha256) || null,
    back_content_sha256: sanitizeSha256(directPaths.back_content_sha256 || directPaths.backContentSha256) || null,
    additional_image_paths: []
  };

  const directAdditional = directPaths.additional_image_paths || directPaths.additionalImagePaths;
  if (Array.isArray(directAdditional)) {
    directAdditional.forEach((image, index) => {
      pushAdditionalImagePath(paths, additionalImagePathRecord(image, index));
    });
  }

  images.forEach((image, index) => {
    const objectPath = imageObjectPath(image);
    if (!objectPath) return;
    const role = imageRole(image, index);

    if (role === "front_original" && !paths.front_object_path) {
      paths.front_object_path = objectPath;
      paths.front_content_sha256 = rawImageContentSha256(image) || paths.front_content_sha256;
      removeAdditionalImagePath(paths, objectPath);
      return;
    }

    if (role === "back_original" && !paths.back_object_path) {
      paths.back_object_path = objectPath;
      paths.back_content_sha256 = rawImageContentSha256(image) || paths.back_content_sha256;
      removeAdditionalImagePath(paths, objectPath);
      return;
    }

    pushAdditionalImagePath(paths, additionalImagePathRecord(image, index));
  });

  return paths;
}

export function buildAssetFingerprint(imagePaths = {}) {
  const parts = [
    imagePaths.front_content_sha256 || imagePaths.front_object_path,
    imagePaths.back_content_sha256 || imagePaths.back_object_path,
    ...(Array.isArray(imagePaths.additional_image_paths)
      ? imagePaths.additional_image_paths.map((image) => image.content_sha256 || image.object_path)
      : [])
  ].filter(Boolean);

  if (!parts.length) return null;
  return crypto.createHash("sha256")
    .update(parts.sort().join("|"))
    .digest("hex");
}

export function diffResolvedFields(generatedResolved = {}, correctedResolved = {}) {
  const before = normalizeResolvedFields(generatedResolved);
  const after = normalizeResolvedFields(correctedResolved);

  return criticalFieldNames
    .filter((field) => !valuesEqual(before[field], after[field]))
    .map((field) => ({
      field,
      from: before[field] ?? null,
      to: after[field] ?? null,
      change_type: "OPERATOR_CORRECTION"
    }));
}

export function deriveReviewOutcome({
  generatedTitle = "",
  correctedTitle = "",
  fieldChanges = [],
  route = "",
  explicitOutcome = "",
  titleOverride = null,
  recovery = {},
  targetedRescanRecovered = false
} = {}) {
  const normalizedExplicit = String(explicitOutcome || "").toUpperCase();
  const normalizedRoute = String(route || "").toUpperCase();
  const recoveryInfo = isPlainObject(recovery) ? recovery : {};
  const rescanRecovered = targetedRescanRecovered === true
    || recoveryInfo.targeted_rescan_recovered === true
    || recoveryInfo.targetedRescanRecovered === true;

  if (Object.values(reviewOutcomes).includes(normalizedExplicit)) {
    if (normalizedExplicit !== reviewOutcomes.TARGETED_RESCAN_RECOVERED) return normalizedExplicit;
    if (normalizedRoute !== "TARGETED_RESCAN_REQUIRED" && rescanRecovered) {
      return reviewOutcomes.TARGETED_RESCAN_RECOVERED;
    }
  }

  if (normalizedRoute === "FAILED_TECHNICAL") return reviewOutcomes.TECHNICAL_FAILURE;
  if (normalizedRoute === "NON_STANDARD_MANUAL") return reviewOutcomes.NON_STANDARD_MANUAL;
  if (normalizedRoute === "TARGETED_RESCAN_REQUIRED") return reviewOutcomes.REJECTED;
  if (rescanRecovered) return reviewOutcomes.TARGETED_RESCAN_RECOVERED;

  if (fieldChanges.length > 0) return reviewOutcomes.CORRECTED_FIELDS;

  const titleChanged = normalizeTitle(generatedTitle) !== normalizeTitle(correctedTitle);
  if (titleChanged || titleOverride) return reviewOutcomes.TITLE_ONLY_OVERRIDE;

  return reviewOutcomes.ACCEPTED_UNCHANGED;
}

export function buildListingReviewRecords({
  payload = {},
  operatorId = "internal-operator",
  now = new Date()
} = {}) {
  const generatedTitle = normalizeTitle(payload.generated_title || payload.generatedTitle || payload.rendered_title || payload.title);
  const correctedTitle = normalizeTitle(payload.corrected_title || payload.correctedTitle || generatedTitle);
  const assetId = normalizeTitle(payload.asset_id || payload.assetId) || idWithPrefix("asset");
  const analysisRunId = normalizeTitle(payload.analysis_run_id || payload.analysisRunId || payload.provider_response_id) || idWithPrefix("analysis");
  const reviewId = normalizeTitle(payload.review_id || payload.reviewId) || idWithPrefix("review");
  const generatedResolved = normalizeResolvedFields(payload.generated_resolved_fields || payload.generatedResolvedFields || payload.resolved || payload.generated_resolved || {});
  const correctedResolved = normalizeResolvedFields(payload.corrected_resolved_fields || payload.correctedResolvedFields || payload.corrected_resolved || generatedResolved);
  const fieldChanges = diffResolvedFields(generatedResolved, correctedResolved);
  const titleOverride = normalizeTitle(payload.title_override || payload.titleOverride) || null;
  const route = normalizeTitle(payload.route);
  const createdAt = now.toISOString();
  const imagePaths = extractAssetImagePaths(payload.images || payload.asset_images || [], payload);
  const assetFingerprint = buildAssetFingerprint(imagePaths);
  const reviewOutcome = deriveReviewOutcome({
    generatedTitle,
    correctedTitle,
    fieldChanges,
    route,
    explicitOutcome: payload.review_outcome || payload.reviewOutcome,
    titleOverride,
    recovery: payload.recovery || {},
    targetedRescanRecovered: payload.targeted_rescan_recovered === true || payload.targetedRescanRecovered === true
  });
  const stableTrainingSample = [
    reviewOutcomes.ACCEPTED_UNCHANGED,
    reviewOutcomes.CORRECTED_FIELDS,
    reviewOutcomes.TITLE_ONLY_OVERRIDE,
    reviewOutcomes.TARGETED_RESCAN_RECOVERED
  ].includes(reviewOutcome);
  const trainingStatus = reviewOutcome === reviewOutcomes.ACCEPTED_UNCHANGED
    ? "approved_clean"
    : stableTrainingSample
      ? "reviewed_correction"
      : reviewOutcome === reviewOutcomes.NON_STANDARD_MANUAL
        ? "manual_non_standard"
        : "not_eligible";
  const openSetReadiness = sanitizeJson(payload.open_set_readiness || payload.openSetReadiness, {});
  const workflowSummary = sanitizeJson(payload.workflow_summary || payload.workflowSummary, {});
  const workflowSidecars = sanitizeJson(payload.workflow_sidecars || payload.workflowSidecars, {});
  const workflowActionPlan = sanitizeJson(
    payload.workflow_action_plan || payload.workflowActionPlan || payload.action_plan || payload.actionPlan,
    {}
  );
  const retrievalTrace = sanitizeJson(payload.retrieval_trace || payload.retrievalTrace || payload.retrieval, {});
  const generatedEvidence = sanitizeJson(payload.generated_evidence || payload.generatedEvidence || payload.evidence, {});
  const generatedFieldGraph = buildFieldGraph({
    resolved: generatedResolved,
    evidence: generatedEvidence,
    retrievalTrace,
    openSetReadiness,
    workflowSidecars
  });
  const correctedFieldGraph = buildFieldGraph({
    resolved: correctedResolved,
    evidence: generatedEvidence,
    retrievalTrace,
    openSetReadiness,
    workflowSidecars
  });
  const feedbackTrainingEvent = buildFeedbackLoopEvent({
    queryCardId: assetId,
    assetFingerprint,
    generatedTitle,
    correctedTitle,
    generatedFieldGraph,
    correctedFieldGraph,
    fieldChanges,
    payload: {
      ...payload,
      retrieval_trace: retrievalTrace,
      open_set_readiness: openSetReadiness
    },
    reviewOutcome,
    stableTrainingSample,
    createdAt
  });

  const asset = {
    id: assetId,
    capture_profile_id: normalizeTitle(payload.capture_profile_id || payload.captureProfileId) || null,
    category: normalizeTitle(payload.category) || null,
    asset_fingerprint: assetFingerprint,
    ...imagePaths,
    created_at: createdAt
  };

  const analysisRun = {
    id: analysisRunId,
    asset_id: assetId,
    provider: normalizeTitle(payload.provider) || null,
    model_id: normalizeTitle(payload.model_id || payload.modelId) || null,
    prompt_version: normalizeTitle(payload.prompt_version || payload.promptVersion) || null,
    schema_version: normalizeTitle(payload.schema_version || payload.evidence_schema_version || payload.schemaVersion) || null,
    resolver_version: normalizeTitle(payload.resolver_version || payload.resolverVersion) || null,
    registry_version: normalizeTitle(payload.registry_version || payload.registryVersion) || null,
    route: route || null,
    capture_quality: sanitizeJson(payload.capture_quality || payload.captureQuality, {}),
    generated_evidence: generatedEvidence,
    generated_resolved_fields: generatedResolved,
    generated_modules: sanitizeJson(payload.generated_modules || payload.generatedModules || payload.modules, {}),
    retrieval_trace: retrievalTrace,
    resolution_trace: sanitizeJson(payload.resolution_trace || payload.resolutionTrace, []),
    open_set_readiness: openSetReadiness,
    workflow_summary: workflowSummary,
    workflow_sidecars: workflowSidecars,
    workflow_action_plan: workflowActionPlan,
    field_graph: generatedFieldGraph,
    rendered_title: normalizeTitle(payload.rendered_title || payload.renderedTitle || generatedTitle),
    model_title_suggestion: normalizeTitle(payload.model_title_suggestion || payload.modelTitleSuggestion) || null,
    usage: sanitizeJson(payload.usage, {}),
    created_at: createdAt
  };

  const review = {
    id: reviewId,
    asset_id: assetId,
    analysis_run_id: analysisRunId,
    generated_resolved_fields: generatedResolved,
    corrected_resolved_fields: correctedResolved,
    generated_modules: sanitizeJson(payload.generated_modules || payload.generatedModules || payload.modules, {}),
    corrected_modules: sanitizeJson(payload.corrected_modules || payload.correctedModules || payload.modules, {}),
    workflow_summary: workflowSummary,
    field_graph: correctedFieldGraph,
    feedback_training_event: feedbackTrainingEvent,
    candidate_reranker_dataset: feedbackTrainingEvent.datasets.candidate_reranker_dataset,
    field_level_ground_truth: feedbackTrainingEvent.datasets.field_level_ground_truth,
    hard_negative_samples: feedbackTrainingEvent.datasets.hard_negative_samples,
    field_changes: fieldChanges,
    rendered_title: normalizeTitle(payload.rendered_title || payload.renderedTitle || generatedTitle),
    corrected_title: correctedTitle,
    title_override: titleOverride,
    review_outcome: reviewOutcome,
    stable_training_sample: stableTrainingSample,
    training_status: trainingStatus,
    reusable_approved_title: stableTrainingSample,
    asset_fingerprint: assetFingerprint,
    operator_id: operatorId,
    review_duration_ms: Number.isFinite(Number(payload.review_duration_ms || payload.reviewDurationMs))
      ? Math.max(0, Math.round(Number(payload.review_duration_ms || payload.reviewDurationMs)))
      : null,
    approved_at: [
      reviewOutcomes.ACCEPTED_UNCHANGED,
      reviewOutcomes.CORRECTED_FIELDS,
      reviewOutcomes.TITLE_ONLY_OVERRIDE,
      reviewOutcomes.TARGETED_RESCAN_RECOVERED
    ].includes(reviewOutcome)
      ? createdAt
      : null,
    created_at: createdAt
  };

  return {
    asset,
    analysisRun,
    review,
    legacyFeedback: normalizeTitle(generatedTitle) !== normalizeTitle(correctedTitle)
      ? {
        generatedTitle,
        correctedTitle,
        operatorId,
        frontImageUrl: imagePaths.front_object_path,
        backImageUrl: imagePaths.back_object_path
      }
      : null
  };
}
