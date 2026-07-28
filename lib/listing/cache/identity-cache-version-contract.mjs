import crypto from "node:crypto";
import { identityResolverPolicyVersion } from "../../identity-resolution/listing-resolution-gate.mjs";
import { candidateSelectionHeuristicVersion } from "../candidates/candidate-selection-pass.mjs";
import {
  cardCodeResolutionMapContractVersion,
  cardCodeResolutionMapRevision
} from "../catalog/card-code-resolution-map.mjs";
import { retrievalApplicationSchemaVersion } from "../candidates/retrieval-application-layer.mjs";
import { SEM_STANDARD_VERSION } from "../csm/sem-definition.mjs";
import { evidenceSchemaVersion } from "../evidence/evidence-schema.mjs";
import { providerEvidenceNormalizationVersion } from "../evidence/provider-evidence-normalizer.mjs";
import { fieldCropTransformVersion } from "../image-quality/crop-planner.mjs";
import { imageQualityPolicyVersion } from "../image-quality/quality-gate.mjs";
import { fieldNormalizationPolicyVersion } from "../pipeline/field-normalization.mjs";
import {
  candidateApplicationPolicyVersion,
  serialTriStatePropagationPolicyVersion
} from "../pipeline/decision-owner-versions.mjs";
import { preingestionBundleVersion, preingestionOcrJobVersion } from "../preingestion/preingestion-bundle.mjs";
import { rendererVersion } from "../renderer/module-renderer.mjs";
import {
  defaultProviderModels,
  providerModelOverrideFromOptions,
  providerPromptVersion,
  providerSchemaVersion,
  visionProviderIds
} from "../providers/provider-contract.mjs";
import { recognitionPipelineVersion } from "../recognition/recognition-contract.mjs";
import { recognitionWorkerConfig } from "../recognition/recognition-feature-flags.mjs";
import { vectorRetrievalConfig } from "../retrieval/vector-feature-flags.mjs";
import { exactAnchorPolicyVersion } from "../v4/fast-scout/exact-anchor-finalize.mjs";
import { catalogSourceAuthorityPolicyVersion } from "../v4/policy/catalog-source-authority-policy.mjs";
import { providerTerminalPathPolicy } from "../v4/policy/provider-terminal-path-policy.mjs";
import { recognitionRoutePlannerPolicyVersion } from "../v4/route-planner/route-planner.mjs";
import { nativeRecognitionStageContractVersion } from "../v4/pipeline/native-recognition-stage-contract.mjs";
import { recognitionProfileAdapterVersion } from "../v4/application/recognition-profile-adapter.mjs";
import { recognitionRequestContractVersion } from "../v4/contracts/recognition-request.mjs";
import {
  recognitionOwnerSourceManifestHash,
  recognitionOwnerSourceManifestVersion
} from "./recognition-owner-source-manifest.mjs";

export const identityCacheContractVersion = "identity-result-cache-v4-pipeline-fingerprint";
export const recognitionPipelineFingerprintContractVersion = "recognition-pipeline-fingerprint-v2";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function providerOptions(payload = {}) {
  const options = payload.provider_options || payload.providerOptions || {};
  return options && typeof options === "object" && !Array.isArray(options) ? options : {};
}

function decisionOptionFingerprint(payload = {}) {
  const ignored = new Set([
    "disable_identity_result_cache",
    "disable_identity_result_cache_read",
    "disable_identity_result_cache_write",
    "disable_approved_identity_memory",
    "disable_writer_final_replay",
    "disable_identity_inflight_replay",
    "recognition_benchmark_profile",
    "recognition_benchmark_phase"
  ]);
  const options = providerOptions(payload);
  const decisionOptions = Object.fromEntries(
    Object.entries(options)
      .filter(([key]) => !ignored.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return Object.freeze({
    option_keys: Object.freeze(Object.keys(decisionOptions)),
    fingerprint: sha256(decisionOptions)
  });
}

function modelId(payload = {}, env = process.env) {
  const options = providerOptions(payload);
  return providerModelOverrideFromOptions(options)
    || clean(payload.openai_listing_model_override)
    || clean(payload.openaiListingModelOverride)
    || clean(payload.openai_model_override)
    || clean(payload.model_override)
    || clean(payload.modelOverride)
    || clean(payload.model)
    || clean(env.OPENAI_LISTING_MODEL)
    || defaultProviderModels[visionProviderIds.OPENAI_LEGACY];
}

function modelRevision(payload = {}, env = process.env) {
  const id = modelId(payload, env);
  // Dated OpenAI snapshot IDs are already immutable revisions. Moving aliases
  // such as `gpt-5-mini` are not safe cache-version inputs on their own. A
  // descriptive env revision is deliberately insufficient: the fingerprint
  // must name the exact model ID that the provider request will send.
  return /(?:^|-)\d{4}-\d{2}-\d{2}$/.test(id) ? id : "provider-model-revision-missing";
}

function catalogSnapshotVersion(payload = {}, env = process.env) {
  const activeRevision = clean(
    payload.active_catalog_snapshot_revision
    || payload.activeCatalogSnapshotRevision
    || payload.catalog_snapshot_version
    || payload.catalogSnapshotVersion
  );
  if (activeRevision) return activeRevision;
  return "catalog-revision-missing";
}

function recognitionWorkerRevision(payload = {}, env = process.env) {
  const config = recognitionWorkerConfig(env);
  if (!config.enabled) return `disabled@${recognitionPipelineVersion}`;
  return clean(payload.recognition_worker_revision || env.RECOGNITION_WORKER_REVISION)
    || "recognition-worker-revision-missing";
}

function enabledByEnv(value) {
  if (value === undefined || value === null || value === "") return false;
  return !["0", "false", "no", "off", "disabled"].includes(clean(value).toLowerCase());
}

function ocrWorkerRevision(_payload = {}, env = process.env) {
  const enabled = enabledByEnv(
    env.ENABLE_PADDLE_OCR_FIELD_VERIFIER ?? env.ENABLE_PADDLEOCR_FIELD_VERIFIER
  );
  if (!enabled) return `disabled@${preingestionOcrJobVersion}`;
  // The cache key is computed before pre-ingestion evidence is attached. Only
  // deployment configuration may version the OCR owner here; observed patch
  // provenance is response data and would make pre/post-bundle keys diverge.
  return clean(env.OCR_WORKER_REVISION)
    || "ocr-worker-revision-missing";
}

export function recognitionCacheRevisionReadiness(payload = {}, env = process.env) {
  if (catalogSnapshotVersion(payload, env) === "catalog-revision-missing") {
    return Object.freeze({ ok: false, reason: "active_catalog_snapshot_revision_required" });
  }
  const config = recognitionWorkerConfig(env);
  if (config.enabled && !config.configured) {
    return Object.freeze({ ok: false, reason: "recognition_worker_configuration_incomplete" });
  }
  if (recognitionWorkerRevision(payload, env) === "recognition-worker-revision-missing") {
    return Object.freeze({ ok: false, reason: "recognition_worker_revision_required" });
  }
  if (ocrWorkerRevision(payload, env) === "ocr-worker-revision-missing") {
    return Object.freeze({ ok: false, reason: "ocr_worker_revision_required" });
  }
  if (modelRevision(payload, env) === "provider-model-revision-missing") {
    return Object.freeze({ ok: false, reason: "provider_model_revision_required" });
  }
  return Object.freeze({ ok: true, reason: null });
}

function titleProfile(payload = {}, env = process.env) {
  const options = providerOptions(payload);
  return Object.freeze({
    tenant_title_profile: clean(payload.tenant_title_profile || payload.tenantTitleProfile || options.tenant_title_profile || env.LISTING_TITLE_PROFILE) || "writer-assisted-v1",
    max_length: Number(payload.maxTitleLength || payload.max_title_length || options.max_title_length || 80),
    language: clean(payload.title_language || payload.language || options.title_language || env.LISTING_TITLE_LANGUAGE) || "en",
    marketplace: clean(payload.marketplace_profile || payload.marketplace || options.marketplace_profile || env.LISTING_MARKETPLACE_PROFILE) || "ebay"
  });
}

function ocrOwnerVersion(_payload = {}, env = process.env) {
  return Object.freeze({
    provider: clean(env.OCR_BACKEND) || "google_vision",
    model: clean(env.OCR_MODEL_REVISION) || "provider-managed",
    prompt_revision: clean(env.OCR_PROMPT_REVISION) || "none",
    feature_type: clean(env.VISION_FEATURE_TYPE) || "DOCUMENT_TEXT_DETECTION",
    service_revision: ocrWorkerRevision({}, env),
    job_version: preingestionOcrJobVersion
  });
}

export function buildRecognitionPipelineFingerprint(payload = {}, env = process.env) {
  const vectorConfig = vectorRetrievalConfig(env, providerOptions(payload));
  const ownerVersions = Object.freeze({
    provider: Object.freeze({
      model_id: modelId(payload, env),
      model_revision: modelRevision(payload, env),
      prompt_revision: providerPromptVersion,
      schema_version: providerSchemaVersion,
      decision_options: decisionOptionFingerprint(payload)
    }),
    ocr: ocrOwnerVersion(payload, env),
    evidence: Object.freeze({
      schema_version: evidenceSchemaVersion,
      normalization_version: providerEvidenceNormalizationVersion
    }),
    field_normalization: fieldNormalizationPolicyVersion,
    resolver: identityResolverPolicyVersion,
    route_planner: recognitionRoutePlannerPolicyVersion,
    recognition_request: Object.freeze({
      contract_version: recognitionRequestContractVersion,
      profile_adapter_version: recognitionProfileAdapterVersion
    }),
    request_context: Object.freeze({
      mode: clean(payload.mode).toLowerCase() || "pair",
      category: clean(payload.category).toLowerCase() || "collectible_card",
      capture_profile: clean(
        payload.effective_capture_quality?.capture_profile_id
        || payload.effectiveCaptureQuality?.capture_profile_id
      ) || "standard-card-v1",
      capture_quality_policy_version: imageQualityPolicyVersion
    }),
    native_stage_orchestration: nativeRecognitionStageContractVersion,
    exact_anchor: exactAnchorPolicyVersion,
    image_preprocessing: Object.freeze({
      bundle_version: preingestionBundleVersion,
      crop_policy_version: fieldCropTransformVersion
    }),
    vector_embedding: Object.freeze({
      model_id: vectorConfig.modelId,
      model_revision: vectorConfig.modelRevision,
      preprocessing_version: vectorConfig.preprocessingVersion
    }),
    recognition_worker: Object.freeze({
      contract_version: recognitionPipelineVersion,
      revision: recognitionWorkerRevision(payload, env)
    }),
    sem: SEM_STANDARD_VERSION,
    candidate: Object.freeze({
      selection: candidateSelectionHeuristicVersion,
      application: retrievalApplicationSchemaVersion,
      application_policy: candidateApplicationPolicyVersion,
      source_authority: catalogSourceAuthorityPolicyVersion,
      terminal_path: providerTerminalPathPolicy.policy_version
    }),
    adapters: Object.freeze({
      serial_tri_state: serialTriStatePropagationPolicyVersion
    }),
    card_code_resolution_map: Object.freeze({
      contract_version: cardCodeResolutionMapContractVersion,
      content_revision: cardCodeResolutionMapRevision
    }),
    catalog: catalogSnapshotVersion(payload, env),
    renderer: rendererVersion,
    title_profile: titleProfile(payload, env)
  });
  const vector = Object.freeze({
    fingerprint_contract_version: recognitionPipelineFingerprintContractVersion,
    cache_contract_version: identityCacheContractVersion,
    owner_source_manifest: Object.freeze({
      version: recognitionOwnerSourceManifestVersion,
      hash: recognitionOwnerSourceManifestHash
    }),
    owner_versions: ownerVersions
  });
  return Object.freeze({
    vector,
    recognition_pipeline_fingerprint: sha256(vector),
    fingerprint: sha256(vector)
  });
}

export const buildIdentityCacheVersionVector = buildRecognitionPipelineFingerprint;

export function identityCacheVersionMatches(record = {}, expected = {}) {
  const expectedFingerprint = clean(expected.recognition_pipeline_fingerprint || expected.fingerprint || expected.version_fingerprint);
  const recordFingerprint = clean(record.recognition_pipeline_fingerprint || record.version_fingerprint);
  if (!expectedFingerprint || !recordFingerprint) return false;
  return expectedFingerprint === recordFingerprint;
}

export const __identityCacheVersionContractTestHooks = Object.freeze({
  stableJson,
  catalogSnapshotVersion,
  modelId,
  modelRevision,
  recognitionWorkerRevision
});
