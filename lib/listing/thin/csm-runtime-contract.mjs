export const CSM_RETIRED_RUNTIME_FLAGS = Object.freeze([
  "ENABLE_RECOGNITION_WORKER",
  "ENABLE_PADDLE_OCR_FIELD_VERIFIER",
  "ENABLE_VECTOR_RETRIEVAL",
  "ENABLE_VISUAL_VECTOR_RETRIEVAL",
  "ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT",
  "ENABLE_STORED_VISUAL_FEATURE_LOOKUP",
  "DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED",
  "DATA_LOOP_SIDECARS_ENABLED"
]);

// These flags use inverse semantics: the retired worker is stopped only when
// the flag is explicitly true. Keep them separate from ENABLE_* flags so a
// missing production value fails closed instead of silently starting V4 work.
export const CSM_RETIRED_RUNTIME_DISABLE_FLAGS = Object.freeze([
  "V4_QUEUE_PUMP_DISABLED"
]);

export const CSM_THIN_RUNTIME_CONTRACT = Object.freeze({
  route: "CSM_THIN_DIRECT",
  endpoint: "/api/csm-listing-title",
  model: "gpt-5.6-luna",
  reasoningEffort: "none",
  promptVersion: "csm-canonical-fields-v1",
  estimatedTokensPerAttempt: 5_300,
  localFallbackConcurrency: 6,
  maximumAttempts: 3,
  claimPollMs: 1_000,
  claimTimeoutMs: 145_000,
  providerTimeoutMs: 120_000,
  browserTimeoutMs: 290_000,
  vercelFunctionTimeoutSeconds: 300
});

export function enabledExactly(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function csmRetiredCapabilitiesDisabled(env = process.env) {
  return CSM_RETIRED_RUNTIME_FLAGS.every((name) => !enabledExactly(env[name]))
    && CSM_RETIRED_RUNTIME_DISABLE_FLAGS.every((name) => enabledExactly(env[name]));
}
