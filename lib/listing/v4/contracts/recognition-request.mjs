import {
  captureSurfaceTypes,
  criticalRegionStatus,
  defaultCaptureProfileId,
  glareRoutes
} from "../../image-quality/quality-gate.mjs";

export const recognitionRequestContractVersion = "recognition-request-v3";

export const recognitionProfileIds = Object.freeze({
  WRITER_ASSISTED: "writer-assisted-v1",
  EVALUATION: "evaluation-v1"
});

export const recognitionEvaluationAssistProfiles = Object.freeze({
  FULL: "full",
  CATALOG_ONLY: "catalog_only",
  VECTOR_ONLY: "vector_only",
  NONE: "none"
});

export const defaultRecognitionProfileId = recognitionProfileIds.WRITER_ASSISTED;

export const clientForbiddenAlgorithmControlKeys = Object.freeze([
  "provider", "provider_id", "providerId",
  "vision_provider", "visionProvider",
  "provider_options", "providerOptions",
  "explicit_emergency", "explicitEmergency",
  "model", "model_id", "modelId",
  "force_l2_only", "forceL2Only",
  "create_l1_job", "createL1Job",
  "create_l2_job", "createL2Job",
  "disable_fast_scout_l1", "disableFastScoutL1",
  "v4_force_l2_direct", "v4ForceL2Direct",
  "v4_queue_l1_only", "v4QueueL1Only",
  "recognition_benchmark_profile", "recognitionBenchmarkProfile",
  "benchmark_profile", "benchmarkProfile",
  "recognition_benchmark_phase", "recognitionBenchmarkPhase",
  "benchmark_phase", "benchmarkPhase",
  "evaluation_assist_profile", "evaluationAssistProfile",
  "evaluation_cold_start_blind", "evaluationColdStartBlind",
  "trace_level", "traceLevel",
  "product_schema_shadow_enabled", "productSchemaShadowEnabled",
  "product_schema_shadow_profile", "productSchemaShadowProfile",
  "enable_anchor_route_late_shadow", "enableAnchorRouteLateShadow",
  "disable_exact_anchor_finalize", "disableExactAnchorFinalize",
  "exact_anchor_fast_final_shadow_only", "exactAnchorFastFinalShadowOnly",
  "v4_l2_exact_anchor_allow_blocking_scout", "v4L2ExactAnchorAllowBlockingScout",
  "l2_exact_anchor_allow_blocking_scout", "l2ExactAnchorAllowBlockingScout",
  "v4_defer_noncritical_persistence", "v4DeferNoncriticalPersistence",
  "defer_noncritical_persistence", "deferNoncriticalPersistence",
  "v4_atomic_writer_ready_capacity_release", "v4AtomicWriterReadyCapacityRelease",
  "v4_force_fast_scout_l1", "v4ForceFastScoutL1",
  "serial_numerator_verified", "serialNumeratorVerified",
  "active_catalog_snapshot_revision", "activeCatalogSnapshotRevision",
  "catalog_snapshot_version", "catalogSnapshotVersion",
  "recognition_worker_revision", "recognitionWorkerRevision",
  "resolution_map", "resolutionMap", "resolution_map_revision", "resolutionMapRevision",
  "category", "idempotency_key", "idempotencyKey"
]);

// Browser-to-Queue is an intent contract, not a generic pipeline-state
// transport. Only writer-authored business inputs cross this boundary. All
// evidence, candidates, resolved state, execution controls and worker state
// must be rebuilt by their server-side owners.
const clientRecognitionBusinessIntentKeys = Object.freeze(new Set([
  "asset_id", "assetId",
  "image_generation_id", "imageGenerationId",
  "client_asset_ref", "clientAssetRef",
  "recognition_profile", "recognitionProfile",
  "mode",
  "capture_profile_id", "captureProfileId",
  "capture_quality", "captureQuality",
  "client_timing", "clientTiming",
  "deferred_image_count", "deferredImageCount",
  "manual_retry", "manualRetry",
  "retry_of_job_id", "retryOfJobId"
]));

const clientRecognitionEvaluationIntentKeys = Object.freeze(new Set([
  "recognition_benchmark_profile", "recognitionBenchmarkProfile",
  "benchmark_profile", "benchmarkProfile",
  "recognition_benchmark_phase", "recognitionBenchmarkPhase",
  "benchmark_phase", "benchmarkPhase",
  "evaluation_assist_profile", "evaluationAssistProfile",
  "evaluation_cold_start_blind", "evaluationColdStartBlind",
  "physical_card_id", "physicalCardId",
  "physical_instance_group_id", "physicalInstanceGroupId",
  "source_feedback_id", "sourceFeedbackId"
]));

const knownRecognitionProfiles = new Set(Object.values(recognitionProfileIds));

function cleanText(value) {
  return String(value ?? "").trim();
}

export class RecognitionRequestContractError extends Error {
  constructor(code, { statusCode = 400 } = {}) {
    super(code);
    this.name = "RecognitionRequestContractError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function recognitionProfileIdFromPayload(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return cleanText(
    value.recognition_profile
    || value.recognitionProfile
  );
}

export function recognitionEvaluationIntentFromPayload(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze({
    benchmark_profile: cleanText(
      value.recognition_benchmark_profile
      || value.recognitionBenchmarkProfile
      || value.benchmark_profile
      || value.benchmarkProfile
    ).toLowerCase() || null,
    benchmark_phase: cleanText(
      value.recognition_benchmark_phase
      || value.recognitionBenchmarkPhase
      || value.benchmark_phase
      || value.benchmarkPhase
    ).toLowerCase() || null,
    assist_profile: cleanText(
      value.evaluation_assist_profile
      || value.evaluationAssistProfile
    ).toLowerCase() || recognitionEvaluationAssistProfiles.FULL,
    cold_start_blind: value.evaluation_cold_start_blind === true
      || value.evaluationColdStartBlind === true
  });
}

export function normalizeRecognitionProfileId(value, fallback = defaultRecognitionProfileId) {
  const profileId = cleanText(value || fallback).toLowerCase();
  if (!knownRecognitionProfiles.has(profileId)) {
    throw new RecognitionRequestContractError("unsupported_recognition_profile");
  }
  return profileId;
}

export function stripClientAlgorithmControls(value = {}) {
  const scoped = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
  for (const key of clientForbiddenAlgorithmControlKeys) delete scoped[key];
  return scoped;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedText(value, max = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedNumber(value, { min = 0, max = 86_400_000, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const bounded = Math.max(min, Math.min(max, number));
  return integer ? Math.round(bounded) : bounded;
}

function sanitizeClientTiming(value = {}) {
  const source = plainObject(value);
  const numericKeys = [
    "client_image_prepare_ms", "client_upload_ms",
    "client_storage_sign_ms", "client_storage_put_ms", "client_storage_verify_ms",
    "client_storage_image_count", "client_storage_sign_attempts", "client_storage_put_attempts",
    "client_storage_verify_attempts", "client_network_retry_count",
    "client_storage_recovered_upload_count", "client_preingestion_request_ms",
    "client_preingestion_request_attempts", "client_request_prepare_ms", "client_api_roundtrip_ms",
    "client_background_prepare_ms", "client_background_prepare_wait_ms",
    "client_fast_scout_prewarm_wait_ms", "client_speculative_ms", "client_speculative_wait_ms"
  ];
  const output = {};
  for (const key of numericKeys) {
    const number = boundedNumber(source[key], { integer: true });
    if (number !== null) output[key] = number;
  }
  if (source.client_preingestion_bundle_reused === true) output.client_preingestion_bundle_reused = true;
  if (source.client_speculative_used === true) output.client_speculative_used = true;
  for (const key of ["client_network_error_stage", "client_network_error_code"]) {
    const text = boundedText(source[key], 80);
    if (text) output[key] = text;
  }
  return output;
}

function sanitizeQualityRegion(value = {}) {
  const source = plainObject(value);
  const output = {};
  const status = boundedText(source.status, 40).toUpperCase();
  if (Object.values(criticalRegionStatus).includes(status)) output.status = status;
  const recoveryMethod = boundedText(source.recovery_method, 40).toLowerCase();
  if (["alternate_view", "focused_crop", "manual_rescan"].includes(recoveryMethod)) {
    output.recovery_method = recoveryMethod;
  }
  for (const key of ["recovered", "crop_complete", "resolution_sufficient", "image_quality_degraded"]) {
    if (typeof source[key] === "boolean") output[key] = source[key];
  }
  for (const key of [
    "image_index", "clear_image_index", "glare_score", "readability_score", "brightness", "contrast",
    "blur_score", "perspective_score"
  ]) {
    const number = boundedNumber(source[key], { min: 0, max: 1_000 });
    if (number !== null) output[key] = number;
  }
  for (const key of ["occluded_image_indices"]) {
    if (Array.isArray(source[key])) {
      output[key] = source[key].slice(0, 8)
        .map((item) => boundedNumber(item, { min: 0, max: 7, integer: true }))
        .filter((item) => item !== null);
    }
  }
  return output;
}

export function sanitizeClientCaptureQualityObservation(value = {}, { includeImages = true } = {}) {
  const source = plainObject(value);
  const output = {};
  const captureProfileId = boundedText(source.capture_profile_id, 120);
  if (captureProfileId) output.capture_profile_id = captureProfileId;
  const surfaceType = boundedText(source.capture_surface_type, 40).toUpperCase();
  if (Object.values(captureSurfaceTypes).includes(surfaceType)) output.capture_surface_type = surfaceType;
  for (const key of ["route", "glare_route"]) {
    const route = boundedText(source[key], 80).toUpperCase();
    if (Object.values(glareRoutes).includes(route)) output[key] = route;
  }
  for (const key of ["image_quality_degraded", "crop_complete", "resolution_sufficient"]) {
    if (typeof source[key] === "boolean") output[key] = source[key];
  }
  for (const key of ["image_count", "blur_score", "glare_score", "perspective_score", "text_readability_score"]) {
    const number = boundedNumber(source[key], { min: 0, max: key === "image_count" ? 8 : 1_000 });
    if (number !== null) output[key] = key === "image_count" ? Math.round(number) : number;
  }
  for (const key of ["recovered_regions", "unresolved_regions"]) {
    if (Array.isArray(source[key])) {
      output[key] = source[key].slice(0, 16).map((item) => boundedText(item, 80)).filter(Boolean);
    }
  }
  const regions = Object.entries(plainObject(source.critical_region_occlusion)).slice(0, 16)
    .map(([key, detail]) => [boundedText(key, 80), sanitizeQualityRegion(detail)])
    .filter(([key]) => key);
  if (regions.length) output.critical_region_occlusion = Object.fromEntries(regions);
  if (includeImages && Array.isArray(source.images)) {
    output.images = source.images.slice(0, 8)
      .map((item) => sanitizeClientCaptureQualityObservation(item, { includeImages: false }));
  }
  return output;
}

export function sanitizeClientRecognitionIntent(value = {}, {
  allowEvaluationIntent = false
} = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = allowEvaluationIntent
    ? new Set([...clientRecognitionBusinessIntentKeys, ...clientRecognitionEvaluationIntentKeys])
    : clientRecognitionBusinessIntentKeys;
  const selected = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
  const output = {
    asset_id: boundedText(selected.asset_id || selected.assetId, 200),
    image_generation_id: boundedText(selected.image_generation_id || selected.imageGenerationId, 200),
    client_asset_ref: boundedText(selected.client_asset_ref || selected.clientAssetRef, 160),
    recognition_profile: boundedText(selected.recognition_profile || selected.recognitionProfile, 80),
    mode: ["pair", "single"].includes(boundedText(selected.mode, 20).toLowerCase())
      ? boundedText(selected.mode, 20).toLowerCase()
      : "pair",
    captureProfileId: defaultCaptureProfileId,
    client_capture_quality: sanitizeClientCaptureQualityObservation(
      selected.capture_quality || selected.captureQuality
    ),
    clientTiming: sanitizeClientTiming(selected.client_timing || selected.clientTiming),
    deferred_image_count: boundedNumber(selected.deferred_image_count ?? selected.deferredImageCount, {
      min: 0,
      max: 1_000,
      integer: true
    }),
    idempotency_key: boundedText(selected.idempotency_key || selected.idempotencyKey, 160),
    manual_retry: selected.manual_retry === true || selected.manualRetry === true,
    retry_of_job_id: boundedText(selected.retry_of_job_id || selected.retryOfJobId, 200)
  };
  if (allowEvaluationIntent) {
    Object.assign(output, {
      recognition_benchmark_profile: boundedText(
        selected.recognition_benchmark_profile || selected.recognitionBenchmarkProfile
          || selected.benchmark_profile || selected.benchmarkProfile,
        80
      ),
      recognition_benchmark_phase: boundedText(
        selected.recognition_benchmark_phase || selected.recognitionBenchmarkPhase
          || selected.benchmark_phase || selected.benchmarkPhase,
        40
      ),
      evaluation_assist_profile: boundedText(
        selected.evaluation_assist_profile || selected.evaluationAssistProfile,
        40
      ),
      evaluation_cold_start_blind: selected.evaluation_cold_start_blind === true
        || selected.evaluationColdStartBlind === true,
      physical_card_id: boundedText(selected.physical_card_id || selected.physicalCardId, 200),
      physical_instance_group_id: boundedText(
        selected.physical_instance_group_id || selected.physicalInstanceGroupId,
        200
      ),
      source_feedback_id: boundedText(selected.source_feedback_id || selected.sourceFeedbackId, 200)
    });
  }
  const compact = Object.fromEntries(Object.entries(output).filter(([, item]) => (
    item !== "" && item !== null && item !== undefined
      && (!Array.isArray(item) || item.length > 0)
      && (typeof item !== "object" || Array.isArray(item) || Object.keys(item).length > 0)
  )));
  if (JSON.stringify(compact).length > 64 * 1024) {
    throw new RecognitionRequestContractError("client_recognition_intent_too_large", { statusCode: 413 });
  }
  return compact;
}

export function withRecognitionRequestIntent(value = {}, {
  profileId = recognitionProfileIdFromPayload(value) || defaultRecognitionProfileId
} = {}) {
  const scoped = stripClientAlgorithmControls(value);
  return {
    ...scoped,
    recognition_contract_version: recognitionRequestContractVersion,
    recognition_profile: normalizeRecognitionProfileId(profileId)
  };
}
