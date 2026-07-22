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
  enable_pre_provider_rescue_shadow: true,
  v4_provider_service_tier: "priority",
  v4_provider_done_capacity_handoff: true,
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

// Chain-only canary frozen from the best observed six-card throughput run.
// It changes transport latency controls, never candidate/SEM/Resolver policy.
const writerAssistedFastV5ProviderOverrides = Object.freeze({
  ...writerAssistedProviderOverrides,
  v4_ultra_fast_l2: true,
  v4_ultra_fast_image_detail: "auto",
  v4_ultra_fast_text_verbosity: "medium",
  v4_ultra_fast_service_tier: "priority",
  v4_provider_done_capacity_handoff: true
});

// Evaluation-only profile: maximize observability and retrieval coverage while
// leaving candidate application, Resolver, and Renderer policy untouched.
const accuracyCeilingOracleProviderOverrides = Object.freeze({
  ...writerAssistedProviderOverrides,
  evaluation_profile: "v4_accuracy_ceiling_oracle_v1",
  enable_vector_lazy_mode: false,
  force_vector_assist: true,
  vector_index_ready: true,
  vector_retrieval_internal_top_n: 20,
  disable_identity_result_cache: true,
  disable_approved_identity_memory: true
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
  if (normalized === recognitionProfileIds.WRITER_ASSISTED_FAST_V5) {
    return {
      profile_id: normalized,
      contract_version: recognitionRequestContractVersion,
      execution: { ...writerAssistedExecution },
      provider_options: {
        ...defaultProviderOptionsFromEnv(env),
        ...writerAssistedFastV5ProviderOverrides
      }
    };
  }
  if (normalized === recognitionProfileIds.ACCURACY_CEILING_ORACLE) {
    return {
      profile_id: normalized,
      contract_version: recognitionRequestContractVersion,
      execution: { ...writerAssistedExecution },
      provider_options: {
        ...defaultProviderOptionsFromEnv(env),
        ...accuracyCeilingOracleProviderOverrides
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
