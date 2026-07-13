// Provider options stage — extracted from the v2 monolith (R1).
// Copied verbatim; behavior must stay bit-identical.
import { envFlag, optionFlag } from "./flags.mjs";

export function normalizePositiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function positiveIntegerFromEnv(env, key, fallback) {
  const value = normalizePositiveIntegerOrNull(env?.[key]);
  return value === null ? fallback : value;
}

export function defaultProviderOptionsFromEnv(env = process.env) {
  const vectorAssistDefault = envFlag(env, "ENABLE_VECTOR_ASSIST_DEFAULT", true);
  const catalogAssistDefault = envFlag(env, "ENABLE_CATALOG_ASSIST_DEFAULT", true);
  return {
    single_model_fast: envFlag(env, "ENABLE_SINGLE_MODEL_FAST_PATH", false),
    enable_evidence_completion: envFlag(env, "ENABLE_EVIDENCE_COMPLETION", true),
    enable_catalog_assist: catalogAssistDefault,
    enable_vector_assist: vectorAssistDefault,
    enable_stored_visual_features: vectorAssistDefault,
    enable_query_visual_embeddings: vectorAssistDefault,
    enable_vector_retrieval: vectorAssistDefault,
    vector_retrieval_mode: vectorAssistDefault ? "assist" : "off",
    vector_query_timeout_ms: 20000,
    enable_advanced_retrieval: vectorAssistDefault,
    enable_hybrid_retrieval: vectorAssistDefault,
    cold_start_blind: envFlag(env, "ENABLE_COLD_START_BLIND_DEFAULT", false),
    enable_ephemeral_external_retrieval: envFlag(env, "ENABLE_EPHEMERAL_EXTERNAL_RETRIEVAL_DEFAULT", false),
    enable_gpt_failure_fallback: false,
    enable_gpt_provider_failure_fallback: false,
    enable_gpt_critical_verifier: false,
    v4_ultra_fast_l2: envFlag(env, "ENABLE_V4_ULTRA_FAST_L2", false),
    v4_ultra_sparse_transport: envFlag(env, "ENABLE_V4_ULTRA_SPARSE_TRANSPORT", false),
    v4_ultra_fast_image_detail: String(env.V4_ULTRA_FAST_IMAGE_DETAIL || "auto").trim().toLowerCase(),
    v4_ultra_fast_service_tier: String(env.V4_ULTRA_FAST_SERVICE_TIER || "").trim().toLowerCase()
  };
}

export function vectorEmbeddingWarmupTimeoutMs(env = process.env, providerOptions = {}) {
  const configured = normalizePositiveIntegerOrNull(
    providerOptions.vector_embedding_warmup_timeout_ms
    ?? providerOptions.vectorEmbeddingWarmupTimeoutMs
    ?? env.VECTOR_EMBEDDING_WARMUP_TIMEOUT_MS
  );
  const requested = configured !== null
    ? configured
    : Math.max(
      20000,
      normalizePositiveIntegerOrNull(providerOptions.vector_query_timeout_ms ?? providerOptions.vectorQueryTimeoutMs) || 0,
      positiveIntegerFromEnv(env, "VECTOR_QUERY_TIMEOUT_MS", 0),
      positiveIntegerFromEnv(env, "VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS", 0)
    );
  const hardCap = normalizePositiveIntegerOrNull(
    providerOptions.vector_embedding_max_blocking_timeout_ms
    ?? providerOptions.vectorEmbeddingMaxBlockingTimeoutMs
    ?? env.VECTOR_EMBEDDING_MAX_BLOCKING_TIMEOUT_MS
  ) || 20000;
  return Math.max(250, Math.min(requested, hardCap));
}

export function postObservationCatalogVectorHedgeMs(env = process.env, providerOptions = {}) {
  const configured = normalizePositiveIntegerOrNull(
    providerOptions.post_observation_catalog_vector_hedge_ms
    ?? providerOptions.postObservationCatalogVectorHedgeMs
    ?? env.POST_OBSERVATION_CATALOG_VECTOR_HEDGE_MS
  );
  const ultraFast = optionFlag(providerOptions, "v4_ultra_fast_l2", envFlag(env, "ENABLE_V4_ULTRA_FAST_L2", false));
  const fallback = ultraFast ? 100 : 900;
  return Math.max(100, Math.min(configured ?? fallback, 5000));
}

export function postObservationRetrievalDeadlineEnabled(env = process.env, providerOptions = {}) {
  return optionFlag(
    providerOptions,
    "enable_post_observation_retrieval_deadline",
    envFlag(env, "ENABLE_POST_OBSERVATION_RETRIEVAL_DEADLINE", true)
  );
}

export function postObservationRetrievalCriticalPathBudgetMs(env = process.env, providerOptions = {}) {
  const configured = normalizePositiveIntegerOrNull(
    providerOptions.post_observation_retrieval_critical_path_budget_ms
    ?? providerOptions.postObservationRetrievalCriticalPathBudgetMs
    ?? env.POST_OBSERVATION_RETRIEVAL_CRITICAL_PATH_BUDGET_MS
  );
  const ultraFast = optionFlag(providerOptions, "v4_ultra_fast_l2", envFlag(env, "ENABLE_V4_ULTRA_FAST_L2", false));
  const fallback = ultraFast ? 250 : 1800;
  return Math.max(250, Math.min(configured ?? fallback, 10000));
}

export function postObservationExactAnchorCatalogBudgetMs(env = process.env, providerOptions = {}) {
  const configured = normalizePositiveIntegerOrNull(
    providerOptions.post_observation_exact_anchor_catalog_budget_ms
    ?? providerOptions.postObservationExactAnchorCatalogBudgetMs
    ?? env.POST_OBSERVATION_EXACT_ANCHOR_CATALOG_BUDGET_MS
  );
  const ultraFast = optionFlag(providerOptions, "v4_ultra_fast_l2", envFlag(env, "ENABLE_V4_ULTRA_FAST_L2", false));
  const fallback = ultraFast ? 1_200 : 1_800;
  return Math.max(250, Math.min(configured ?? fallback, 5_000));
}

export function postObservationStructuredAnchorCatalogBudgetMs(env = process.env, providerOptions = {}) {
  const configured = normalizePositiveIntegerOrNull(
    providerOptions.post_observation_structured_anchor_catalog_budget_ms
    ?? providerOptions.postObservationStructuredAnchorCatalogBudgetMs
    ?? env.POST_OBSERVATION_STRUCTURED_ANCHOR_CATALOG_BUDGET_MS
  );
  const ultraFast = optionFlag(providerOptions, "v4_ultra_fast_l2", envFlag(env, "ENABLE_V4_ULTRA_FAST_L2", false));
  const fallback = ultraFast ? 1_200 : 1_800;
  return Math.max(250, Math.min(configured ?? fallback, 5_000));
}

export function ultraFastImageDetail(providerOptions = {}) {
  const requested = String(
    providerOptions.v4_ultra_fast_image_detail
    ?? providerOptions.v4UltraFastImageDetail
    ?? "auto"
  ).trim().toLowerCase();
  return ["low", "auto", "high"].includes(requested) ? requested : "auto";
}

export function ultraFastServiceTier(providerOptions = {}) {
  const requested = String(
    providerOptions.v4_ultra_fast_service_tier
    ?? providerOptions.v4UltraFastServiceTier
    ?? ""
  ).trim().toLowerCase();
  return ["auto", "default", "flex", "priority"].includes(requested) ? requested : null;
}

export function vectorEmbeddingWarmupOptions(providerOptions = {}, env = process.env) {
  return {
    ...providerOptions,
    // This promise exists only to overlap image embedding/vector lookup with
    // the provider call. Catalog retrieval has its own capacity pool and
    // post-observation lookup; coupling it here makes a completed embedding
    // look unavailable whenever a catalog RPC is slow.
    enable_vector_assist: true,
    enable_vector_retrieval: true,
    enable_catalog_assist: false,
    enable_hybrid_retrieval: false,
    enable_advanced_retrieval: false,
    vector_query_timeout_ms: vectorEmbeddingWarmupTimeoutMs(env, providerOptions)
  };
}

export function providerOptionsFromPayload(payload = {}, env = process.env) {
  const options = payload.provider_options || payload.providerOptions || {};
  const explicitOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const merged = {
    ...defaultProviderOptionsFromEnv(env),
    ...explicitOptions
  };

  const explicitlyDisablesVectorAssist = Object.prototype.hasOwnProperty.call(explicitOptions, "enable_vector_assist")
    && optionFlag(explicitOptions, "enable_vector_assist", true) !== true;
  const explicitlyConfiguresVectorRetrieval = Object.prototype.hasOwnProperty.call(explicitOptions, "enable_vector_retrieval")
    || Object.prototype.hasOwnProperty.call(explicitOptions, "enableVectorRetrieval")
    || Object.prototype.hasOwnProperty.call(explicitOptions, "vector_retrieval_mode")
    || Object.prototype.hasOwnProperty.call(explicitOptions, "vectorRetrievalMode")
    || optionFlag(explicitOptions, "force_vector_assist", false) === true;
  const fastPathWithoutExplicitVector = singleModelFastPathEnabled(env, merged)
    && !explicitlyConfiguresVectorRetrieval
    && optionFlag(explicitOptions, "force_vector_assist", false) !== true;

  if ((explicitlyDisablesVectorAssist && !explicitlyConfiguresVectorRetrieval) || fastPathWithoutExplicitVector) {
    merged.enable_vector_assist = false;
    merged.enable_stored_visual_features = false;
    merged.enable_query_visual_embeddings = false;
    merged.enable_vector_retrieval = false;
    merged.vector_retrieval_mode = "off";
    merged.enable_advanced_retrieval = false;
    merged.enable_hybrid_retrieval = false;
  }

  return merged;
}

export function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).replace(/\s+/g, " ").trim() !== "" && value !== "UNKNOWN";
}

function meaningfulObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.values(value).some(valuePresent);
}

function evalCatalogObservationHint(payload = {}, providerOptions = {}) {
  const evalMode = String(payload.provider_eval_mode || payload.providerEvalMode || "").trim();
  if (!evalMode) return {};
  if (optionFlag(providerOptions, "corrected_title_as_temporary_gt", false) !== true) return {};
  const hint = payload.catalog_observation_hint || payload.catalogObservationHint;
  return meaningfulObject(hint) ? hint : {};
}

export function resolvedForRetrievalFromPayload(payload = {}, providerOptions = {}, recognitionEvidenceDocument = null) {
  const candidates = [
    recognitionEvidenceDocument?.resolved,
    evalCatalogObservationHint(payload, providerOptions),
    payload.resolved,
    payload.resolvedHint,
    payload.resolved_hint
  ];
  return candidates.find(meaningfulObject) || {};
}

export function singleModelFastPathEnabled(env = process.env, options = {}) {
  return optionFlag(options, "single_model_fast", envFlag(env, "ENABLE_SINGLE_MODEL_FAST_PATH", false));
}

export function evidenceCompletionEnabled(env = process.env, options = {}) {
  if (singleModelFastPathEnabled(env, options)) return false;
  return optionFlag(options, "enable_evidence_completion", envFlag(env, "ENABLE_EVIDENCE_COMPLETION", true));
}
