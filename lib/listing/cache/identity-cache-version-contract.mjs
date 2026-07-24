import crypto from "node:crypto";
import { identityResolverPolicyVersion } from "../../identity-resolution/listing-resolution-gate.mjs";
import { candidateSelectionHeuristicVersion } from "../candidates/candidate-selection-pass.mjs";
import { retrievalApplicationSchemaVersion } from "../candidates/retrieval-application-layer.mjs";
import { SEM_STANDARD_VERSION } from "../csm/sem-definition.mjs";
import { evidenceSchemaVersion } from "../evidence/evidence-schema.mjs";
import { providerEvidenceNormalizationVersion } from "../evidence/provider-evidence-normalizer.mjs";
import { fieldCropTransformVersion } from "../image-quality/crop-planner.mjs";
import { fieldNormalizationPolicyVersion } from "../pipeline/field-normalization.mjs";
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
import { vectorRetrievalConfig } from "../retrieval/vector-feature-flags.mjs";
import { exactAnchorPolicyVersion } from "../v4/fast-scout/exact-anchor-finalize.mjs";
import { catalogSourceAuthorityPolicyVersion } from "../v4/policy/catalog-source-authority-policy.mjs";
import { providerTerminalPathPolicy } from "../v4/policy/provider-terminal-path-policy.mjs";
import { recognitionRoutePlannerPolicyVersion } from "../v4/route-planner/route-planner.mjs";

export const identityCacheContractVersion = "identity-result-cache-v4-pipeline-fingerprint";
export const recognitionPipelineFingerprintContractVersion = "recognition-pipeline-fingerprint-v1";

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

function modelRevision(payload = {}, env = process.env) {
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

function catalogSnapshotVersion(payload = {}, env = process.env) {
  const activeRevision = clean(
    payload.active_catalog_snapshot_revision
    || payload.activeCatalogSnapshotRevision
    || payload.catalog_snapshot_version
    || payload.catalogSnapshotVersion
  );
  if (activeRevision) return activeRevision;
  const deploymentRevision = clean(env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA) || "local-development";
  return `catalog-revision-unavailable:${deploymentRevision}`;
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

function ocrOwnerVersion(payload = {}, env = process.env) {
  const processing = payload.preingestion_summary?.ocr_stage_execution || payload.recognition_processing || {};
  const patchModels = [...new Set(
    (Array.isArray(payload.preingestion_evidence_patches)
      ? payload.preingestion_evidence_patches
      : [])
      .map((patch) => [
        clean(patch?.provenance?.model_id),
        clean(patch?.provenance?.model_revision)
      ].filter(Boolean).join("@"))
      .filter(Boolean)
  )].sort();
  return Object.freeze({
    provider: clean(processing.ocr_backend || payload.ocr_backend || env.OCR_BACKEND) || "google_vision",
    model: clean(processing.ocr_model || payload.ocr_model || env.OCR_MODEL_REVISION) || "provider-managed",
    prompt_revision: clean(processing.ocr_prompt_revision || payload.ocr_prompt_revision || env.OCR_PROMPT_REVISION) || "none",
    feature_type: clean(processing.vision_feature_type || env.VISION_FEATURE_TYPE) || "DOCUMENT_TEXT_DETECTION",
    job_version: preingestionOcrJobVersion,
    observed_model_revisions: Object.freeze(patchModels)
  });
}

export function buildRecognitionPipelineFingerprint(payload = {}, env = process.env) {
  const vectorConfig = vectorRetrievalConfig(env, providerOptions(payload));
  const deploymentRevision = clean(env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA) || "local-development";
  const ownerVersions = Object.freeze({
    provider: Object.freeze({
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
      revision: clean(
        payload.recognition_worker_revision
        || env.RECOGNITION_WORKER_REVISION
        || env.K_REVISION
        || deploymentRevision
      ) || "unversioned-worker"
    }),
    sem: SEM_STANDARD_VERSION,
    candidate: Object.freeze({
      selection: candidateSelectionHeuristicVersion,
      application: retrievalApplicationSchemaVersion,
      source_authority: catalogSourceAuthorityPolicyVersion,
      terminal_path: providerTerminalPathPolicy.policy_version
    }),
    catalog: catalogSnapshotVersion(payload, env),
    renderer: rendererVersion,
    title_profile: titleProfile(payload, env)
  });
  const vector = Object.freeze({
    fingerprint_contract_version: recognitionPipelineFingerprintContractVersion,
    cache_contract_version: identityCacheContractVersion,
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
  modelRevision
});
