import { defaultProviderOptionsFromEnv } from "../../pipeline/provider-options.mjs";
import {
  defaultRecognitionProfileId,
  normalizeRecognitionProfileId,
  recognitionProfileIds,
  recognitionRequestContractVersion,
  stripClientAlgorithmControls
} from "../contracts/recognition-request.mjs";

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
  if (normalized === recognitionProfileIds.WRITER_ASSISTED) {
    return {
      profile_id: normalized,
      contract_version: recognitionRequestContractVersion,
      execution: { ...writerAssistedExecution },
      provider_options: {
        ...defaultProviderOptionsFromEnv(env),
        ...writerAssistedProviderOverrides
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
    recognition_contract_version: profile.contract_version,
    recognition_profile: profile.profile_id,
    ...profile.execution,
    provider_options: { ...profile.provider_options }
  };
}
