import {
  defaultVisualEmbeddingModelId,
  defaultVisualEmbeddingModelRevision,
  defaultVisualEmbeddingPreprocessingVersion
} from "./vector-model-defaults.mjs";

export const vectorRetrievalModes = Object.freeze({
  OFF: "off",
  SHADOW: "shadow",
  ASSIST: "assist"
});

const defaultEnabledVectorRoles = Object.freeze(["front_global", "back_global"]);

function cleanText(value) {
  return String(value || "").trim();
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function optionHas(options = {}, key) {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function optionBool(options = {}, key, fallback) {
  return optionHas(options, key) ? boolValue(options[key], fallback) : fallback;
}

function firstOptionBool(options = {}, keys = [], fallback = false) {
  for (const key of keys) {
    if (optionHas(options, key)) return boolValue(options[key], fallback);
  }
  return fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function optionInteger(options = {}, keys = [], fallback) {
  for (const key of keys) {
    if (!optionHas(options, key)) continue;
    return positiveInteger(options[key], fallback);
  }
  return fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeMode(value) {
  const normalized = cleanText(value).toLowerCase();
  return Object.values(vectorRetrievalModes).includes(normalized)
    ? normalized
    : vectorRetrievalModes.OFF;
}

function explicitModeFromOptions(options = {}) {
  if (optionHas(options, "vector_retrieval_mode")) return normalizeMode(options.vector_retrieval_mode);
  if (optionHas(options, "vectorRetrievalMode")) return normalizeMode(options.vectorRetrievalMode);
  return "";
}

function enabledByOptions(options = {}) {
  if (optionHas(options, "enable_vector_retrieval")) return optionBool(options, "enable_vector_retrieval", false);
  if (optionHas(options, "enableVectorRetrieval")) return optionBool(options, "enableVectorRetrieval", false);
  return null;
}

export function vectorRetrievalConfig(env = process.env, options = {}) {
  const optionMode = explicitModeFromOptions(options);
  const envMode = normalizeMode(env.VECTOR_RETRIEVAL_MODE || vectorRetrievalModes.OFF);
  const mode = optionMode || envMode;
  const optionEnabled = enabledByOptions(options);
  const enabled = optionEnabled === null
    ? boolValue(env.ENABLE_VECTOR_RETRIEVAL, false)
    : optionEnabled;

  const advancedRetrievalEnabled = optionBool(options, "enable_advanced_retrieval", boolValue(env.ENABLE_ADVANCED_RETRIEVAL, false));
  const hybridRetrievalEnabled = optionBool(options, "enable_hybrid_retrieval", boolValue(env.ENABLE_HYBRID_RETRIEVAL, advancedRetrievalEnabled));
  const correctedTitleAsTemporaryGt = firstOptionBool(options, [
    "corrected_title_as_temporary_gt",
    "correctedTitleAsTemporaryGt",
    "vector_corrected_title_as_temporary_gt",
    "vectorCorrectedTitleAsTemporaryGt"
  ], boolValue(env.VECTOR_CORRECTED_TITLE_AS_TEMPORARY_GT || env.VECTOR_EVAL_CORRECTED_TITLE_AS_GT, false));
  const enabledVectorRoles = [
    ...defaultEnabledVectorRoles,
    ...(boolValue(env.ENABLE_VECTOR_ROLE_SUBJECT_LAYOUT, false) ? ["subject_layout"] : []),
    ...(boolValue(env.ENABLE_VECTOR_ROLE_CARD_DESIGN, false) ? ["card_design"] : []),
    ...(boolValue(env.ENABLE_VECTOR_ROLE_PARALLEL_SURFACE, false) ? ["parallel_surface"] : []),
    ...(boolValue(env.ENABLE_VECTOR_ROLE_IDENTITY_TEXT, false) ? ["identity_text"] : [])
  ];

  return {
    enabled: enabled && mode !== vectorRetrievalModes.OFF,
    mode: enabled ? mode : vectorRetrievalModes.OFF,
    workerUrl: cleanText(env.VECTOR_WORKER_URL || env.RECOGNITION_WORKER_URL).replace(/\/+$/, ""),
    workerToken: cleanText(env.VECTOR_WORKER_TOKEN || env.RECOGNITION_WORKER_TOKEN),
    modelId: cleanText(env.VECTOR_EMBEDDING_MODEL || env.VISUAL_VECTOR_MODEL_ID || env.VISUAL_EMBEDDING_MODEL_ID) || defaultVisualEmbeddingModelId,
    modelRevision: cleanText(env.VECTOR_EMBEDDING_MODEL_REVISION || env.VISUAL_VECTOR_MODEL_REVISION || env.VISUAL_EMBEDDING_MODEL_REVISION) || defaultVisualEmbeddingModelRevision,
    preprocessingVersion: cleanText(env.VECTOR_PREPROCESSING_VERSION || env.VISUAL_VECTOR_PREPROCESSING_VERSION || env.VISUAL_EMBEDDING_PREPROCESSING_VERSION) || defaultVisualEmbeddingPreprocessingVersion,
    topK: optionInteger(options, ["vector_retrieval_top_k", "vectorRetrievalTopK"], positiveInteger(env.VECTOR_RETRIEVAL_TOP_K, 10)),
    internalTopN: optionInteger(options, ["vector_retrieval_internal_top_n", "vectorRetrievalInternalTopN"], positiveInteger(env.VECTOR_RETRIEVAL_INTERNAL_TOP_N, 30)),
    gptCandidateLimit: positiveInteger(env.VECTOR_GPT_CANDIDATE_LIMIT, 5),
    queryTimeoutMs: optionInteger(options, ["vector_query_timeout_ms", "vectorQueryTimeoutMs"], positiveInteger(env.VECTOR_QUERY_TIMEOUT_MS || env.VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS, 30000)),
    cacheEnabled: boolValue(env.VECTOR_CACHE_ENABLED, true),
    referenceWriteEnabled: boolValue(env.VECTOR_REFERENCE_WRITE_ENABLED, false),
    referenceMinQualityScore: cleanText(env.VECTOR_REFERENCE_MIN_QUALITY_SCORE),
    advancedRetrievalEnabled,
    hybridRetrievalEnabled,
    advancedRetrievalMode: normalizeMode(env.ADVANCED_RETRIEVAL_MODE || mode),
    advancedStage1TopN: positiveInteger(env.ADVANCED_RETRIEVAL_STAGE1_TOP_N, 30),
    rrfK: positiveInteger(env.ADVANCED_RETRIEVAL_RRF_K, 60),
    lowMarginThreshold: positiveNumber(env.ADVANCED_RETRIEVAL_LOW_MARGIN, 0.03),
    correctedTitleAsTemporaryGt,
    multiVectorRoles: [...new Set(enabledVectorRoles)]
  };
}

export function vectorRetrievalActive(env = process.env, options = {}) {
  return vectorRetrievalConfig(env, options).enabled;
}

export function vectorRetrievalAssistEnabled(env = process.env, options = {}) {
  const config = vectorRetrievalConfig(env, options);
  return config.enabled && config.mode === vectorRetrievalModes.ASSIST;
}

export function vectorRetrievalShadowEnabled(env = process.env, options = {}) {
  const config = vectorRetrievalConfig(env, options);
  return config.enabled && config.mode === vectorRetrievalModes.SHADOW;
}
