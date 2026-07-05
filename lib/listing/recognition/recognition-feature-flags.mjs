function boolFromEnv(env, key, fallback = false) {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function numberFromEnv(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function recognitionWorkerConfig(env = process.env) {
  const enabled = boolFromEnv(env, "ENABLE_RECOGNITION_WORKER", false);
  const url = trimTrailingSlash(env.RECOGNITION_WORKER_URL || "");
  const token = env.RECOGNITION_WORKER_TOKEN || "";

  return {
    enabled,
    configured: Boolean(enabled && url && token),
    url,
    token,
    timeout_ms: numberFromEnv(env, "RECOGNITION_WORKER_TIMEOUT_MS", 30000),
    run_ocr_default: boolFromEnv(env, "RECOGNITION_WORKER_RUN_OCR", true),
    run_visual_embeddings_default: boolFromEnv(env, "RECOGNITION_WORKER_RUN_VISUAL_EMBEDDINGS", false),
    run_candidate_verification_default: boolFromEnv(env, "RECOGNITION_WORKER_RUN_CANDIDATE_VERIFICATION", false),
    reason: !enabled
      ? "feature_disabled"
      : !url
        ? "missing_recognition_worker_url"
        : !token
          ? "missing_recognition_worker_token"
          : null
  };
}
