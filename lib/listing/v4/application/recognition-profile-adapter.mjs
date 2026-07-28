import { defaultProviderOptionsFromEnv } from "../../pipeline/provider-options.mjs";
import { defaultCaptureProfileId } from "../../image-quality/quality-gate.mjs";
import {
  defaultProviderModels,
  providerModelConfig,
  visionProviderIds
} from "../../providers/provider-contract.mjs";
import {
  defaultRecognitionProfileId,
  normalizeRecognitionProfileId,
  recognitionProfileIds,
  recognitionRequestContractVersion,
  stripClientAlgorithmControls
} from "../contracts/recognition-request.mjs";

export const recognitionProfileAdapterVersion = "recognition-profile-adapter-v2-pinned-model-title-contract";

function immutableProviderModelRevisionFromEnv(env = process.env) {
  const revision = String(env.OPENAI_LISTING_MODEL_REVISION || "").trim();
  if (!/(?:^|-)\d{4}-\d{2}-\d{2}$/.test(revision)) return "";
  const requested = String(
    env.OPENAI_LISTING_MODEL || defaultProviderModels[visionProviderIds.OPENAI_LEGACY] || ""
  ).trim();
  const family = (value) => String(value || "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (family(revision) !== family(requested)) return "";
  const config = providerModelConfig(visionProviderIds.OPENAI_LEGACY, revision);
  return config.allowed ? revision : "";
}

const writerAssistedProviderOverrides = Object.freeze({
  single_model_fast: false,
  v4_title_stage_target: "L2_ASSISTED_DRAFT",
  v4_compact_l2_prompt: true,
  v4_ultra_fast_l2: false,
  v4_ultra_sparse_transport: false,
  enable_fast_initial_provider_prompt: false,
  enable_evidence_completion: true,
  enable_catalog_assist: true,
  enable_vector_assist: true,
  enable_stored_visual_features: true,
  enable_query_visual_embeddings: true,
  enable_vector_retrieval: true,
  vector_retrieval_mode: "assist",
  vector_query_timeout_ms: 8000,
  enable_advanced_retrieval: true,
  enable_hybrid_retrieval: true,
  enable_gpt_failure_fallback: false,
  enable_gpt_provider_failure_fallback: false,
  enable_gpt_critical_verifier: false
});

const writerAssistedExecution = Object.freeze({
  force_l2_only: true,
  create_l1_job: false,
  create_l2_job: true,
  disable_fast_scout_l1: true,
  v4_force_l2_direct: true
});

export function resolveRecognitionProfile(profileId = defaultRecognitionProfileId, env = process.env) {
  const normalized = normalizeRecognitionProfileId(profileId);
  const pinnedModelRevision = immutableProviderModelRevisionFromEnv(env);
  if (normalized === recognitionProfileIds.WRITER_ASSISTED) {
    return {
      profile_id: normalized,
      contract_version: recognitionRequestContractVersion,
      execution: { ...writerAssistedExecution },
      provider_options: {
        ...defaultProviderOptionsFromEnv(env),
        ...writerAssistedProviderOverrides,
        ...(pinnedModelRevision ? {
          openai_listing_model_override: pinnedModelRevision,
          openai_listing_model_revision: pinnedModelRevision
        } : {})
      }
    };
  }
  throw new Error(`recognition_profile_not_implemented:${normalized}`);
}

export function bindRecognitionProfileToPayload(payload = {}, {
  profileId = defaultRecognitionProfileId,
  env = process.env
} = {}) {
  const profile = resolveRecognitionProfile(profileId, env);
  const clientIntent = stripClientAlgorithmControls(payload);
  return {
    ...clientIntent,
    category: "collectible_card",
    recognition_contract_version: profile.contract_version,
    recognition_profile: profile.profile_id,
    maxTitleLength: 80,
    max_title_length: 80,
    captureProfileId: defaultCaptureProfileId,
    capture_profile_id: defaultCaptureProfileId,
    ...profile.execution,
    provider_options: { ...profile.provider_options }
  };
}
