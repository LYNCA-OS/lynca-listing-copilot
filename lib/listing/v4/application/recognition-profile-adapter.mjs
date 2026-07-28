import { optionFlag } from "../../pipeline/flags.mjs";
import { attachServerOwnedCardCodeResolutionMap } from "../../catalog/card-code-resolution-map.mjs";
import { defaultCaptureProfileId } from "../../image-quality/quality-gate.mjs";
import {
  defaultProviderOptionsFromEnv,
  providerOptionsFromPayload
} from "../../pipeline/provider-options.mjs";
import {
  applyRecognitionBenchmarkProfile,
  exactReplayPhases,
  recognitionBenchmarkProfileIds
} from "../../evaluation/recognition-benchmark-profile.mjs";
import {
  defaultProviderModels,
  providerModelConfig,
  visionProviderIds
} from "../../providers/provider-contract.mjs";
import {
  RecognitionRequestContractError,
  defaultRecognitionProfileId,
  normalizeRecognitionProfileId,
  recognitionEvaluationAssistProfiles,
  recognitionEvaluationIntentFromPayload,
  recognitionProfileIds,
  recognitionRequestContractVersion,
  stripClientAlgorithmControls
} from "../contracts/recognition-request.mjs";

export const recognitionProfileAdapterVersion = "recognition-profile-adapter-v3-pinned-model-shadow-anchor";

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
  enable_gpt_critical_verifier: false,
  exact_anchor_fast_final_shadow_only: true
});

const writerAssistedExecution = Object.freeze({
  force_l2_only: true,
  create_l1_job: false,
  create_l2_job: true,
  disable_fast_scout_l1: true,
  v4_force_l2_direct: true
});

function evaluationAssists(profile = recognitionEvaluationAssistProfiles.FULL) {
  const known = new Set(Object.values(recognitionEvaluationAssistProfiles));
  if (!known.has(profile)) throw new RecognitionRequestContractError("unsupported_evaluation_assist_profile");
  const catalog = [
    recognitionEvaluationAssistProfiles.FULL,
    recognitionEvaluationAssistProfiles.CATALOG_ONLY
  ].includes(profile);
  const vector = [
    recognitionEvaluationAssistProfiles.FULL,
    recognitionEvaluationAssistProfiles.VECTOR_ONLY
  ].includes(profile);
  return {
    enable_catalog_assist: catalog,
    enable_vector_assist: vector,
    enable_stored_visual_features: vector,
    enable_query_visual_embeddings: vector,
    enable_vector_retrieval: vector,
    vector_retrieval_mode: vector ? "assist" : "off",
    enable_advanced_retrieval: vector,
    enable_hybrid_retrieval: catalog && vector
  };
}

export function resolveRecognitionProfile(profileId = defaultRecognitionProfileId, env = process.env, {
  evaluationIntent = {}
} = {}) {
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
  if (normalized === recognitionProfileIds.EVALUATION) {
    const benchmarkProfile = evaluationIntent.benchmark_profile;
    if (![
      recognitionBenchmarkProfileIds.COLD_ALGORITHM,
      recognitionBenchmarkProfileIds.EXACT_REPLAY,
      recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD
    ].includes(benchmarkProfile)) {
      throw new RecognitionRequestContractError("unsupported_evaluation_benchmark_profile");
    }
    if (benchmarkProfile === recognitionBenchmarkProfileIds.EXACT_REPLAY
      && !Object.values(exactReplayPhases).includes(evaluationIntent.benchmark_phase)) {
      throw new RecognitionRequestContractError("unsupported_evaluation_benchmark_phase");
    }
    const productionWorkload = benchmarkProfile === recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD;
    const assistProfile = productionWorkload
      ? null
      : evaluationIntent.assist_profile || recognitionEvaluationAssistProfiles.FULL;
    const providerOptions = applyRecognitionBenchmarkProfile({
      ...defaultProviderOptionsFromEnv(env),
      ...writerAssistedProviderOverrides,
      ...(productionWorkload ? {} : {
        ...evaluationAssists(assistProfile),
        evaluation_assist_profile: assistProfile,
        openai_listing_model_override: pinnedModelRevision || "gpt-5-mini",
        v4_compact_l2_prompt: true,
        v4_ultra_fast_l2: false,
        v4_ultra_fast_image_detail: "high",
        enable_fast_initial_provider_prompt: false,
        cold_start_blind: evaluationIntent.cold_start_blind === true,
        enable_cold_start_blind: evaluationIntent.cold_start_blind === true
      }),
      ...(pinnedModelRevision ? {
        openai_listing_model_override: pinnedModelRevision,
        openai_listing_model_revision: pinnedModelRevision
      } : {})
    }, {
      profile: benchmarkProfile,
      phase: evaluationIntent.benchmark_phase || null
    });
    return {
      profile_id: normalized,
      contract_version: recognitionRequestContractVersion,
      execution: { ...writerAssistedExecution },
      provider_options: providerOptions
    };
  }
  throw new Error(`recognition_profile_not_implemented:${normalized}`);
}

export function bindRecognitionProfileToPayload(payload = {}, {
  profileId = defaultRecognitionProfileId,
  env = process.env
} = {}) {
  const evaluationIntent = recognitionEvaluationIntentFromPayload(payload);
  const profile = resolveRecognitionProfile(profileId, env, { evaluationIntent });
  const clientIntent = stripClientAlgorithmControls(payload);
  return attachServerOwnedCardCodeResolutionMap({
    ...clientIntent,
    // Category has no browser-facing decision owner. Keep one server-owned
    // neutral value until a dedicated taxonomy owner is introduced.
    category: "collectible_card",
    recognition_contract_version: profile.contract_version,
    recognition_profile: profile.profile_id,
    // The public SEM/title contract is frozen at 80 characters. Client input
    // cannot widen or shrink it and thereby fork Prompt/Renderer/cache policy.
    maxTitleLength: 80,
    max_title_length: 80,
    captureProfileId: defaultCaptureProfileId,
    capture_profile_id: defaultCaptureProfileId,
    ...profile.execution,
    provider_options: { ...profile.provider_options }
  });
}

export function buildRecognitionEffectiveConfiguration(payload = {}, env = process.env) {
  const options = providerOptionsFromPayload(payload, env);
  const benchmarkProfile = String(options.recognition_benchmark_profile || "").trim() || null;
  if (!benchmarkProfile) return null;
  return Object.freeze({
    schema_version: "recognition-effective-configuration-v1",
    recognition_profile: String(payload.recognition_profile || "").trim() || null,
    benchmark_profile: benchmarkProfile,
    benchmark_phase: String(options.recognition_benchmark_phase || "").trim() || null,
    evaluation_assist_profile: String(options.evaluation_assist_profile || "").trim() || null,
    provider_options: Object.freeze({
      enable_catalog_assist: optionFlag(options, "enable_catalog_assist", false),
      enable_vector_assist: optionFlag(options, "enable_vector_assist", false),
      enable_vector_retrieval: optionFlag(options, "enable_vector_retrieval", false),
      vector_retrieval_mode: String(options.vector_retrieval_mode || "off").trim().toLowerCase(),
      disable_identity_result_cache_read: optionFlag(options, "disable_identity_result_cache_read", false),
      disable_identity_result_cache_write: optionFlag(options, "disable_identity_result_cache_write", false),
      disable_approved_identity_memory: optionFlag(options, "disable_approved_identity_memory", false),
      disable_writer_final_replay: optionFlag(options, "disable_writer_final_replay", false),
      disable_identity_inflight_replay: optionFlag(options, "disable_identity_inflight_replay", false),
      disable_recognition_worker_fast_final: optionFlag(options, "disable_recognition_worker_fast_final", false),
      exact_anchor_fast_final_shadow_only: optionFlag(options, "exact_anchor_fast_final_shadow_only", false),
      openai_listing_model_override: String(options.openai_listing_model_override || "").trim() || null,
      v4_compact_l2_prompt: optionFlag(options, "v4_compact_l2_prompt", false),
      v4_ultra_fast_l2: optionFlag(options, "v4_ultra_fast_l2", false),
      v4_ultra_fast_image_detail: String(options.v4_ultra_fast_image_detail || "auto").trim().toLowerCase(),
      enable_fast_initial_provider_prompt: optionFlag(options, "enable_fast_initial_provider_prompt", false),
      cold_start_blind: optionFlag(options, "cold_start_blind", false)
    }),
    execution: Object.freeze({
      force_l2_only: payload.force_l2_only === true,
      create_l1_job: payload.create_l1_job === true,
      create_l2_job: payload.create_l2_job === true,
      disable_fast_scout_l1: payload.disable_fast_scout_l1 === true,
      v4_force_l2_direct: payload.v4_force_l2_direct === true
    })
  });
}
