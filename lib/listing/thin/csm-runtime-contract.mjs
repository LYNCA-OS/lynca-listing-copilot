import { CANONICAL_FIELDS_PROMPT_VERSION } from "./canonical-fields.mjs";
import { CSM_ACTIVE_MODEL_PROFILE } from "./csm-model-profile.mjs";

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
  modelProfileId: CSM_ACTIVE_MODEL_PROFILE.id,
  provider: CSM_ACTIVE_MODEL_PROFILE.provider,
  model: CSM_ACTIVE_MODEL_PROFILE.model,
  // `low`, not `none`, since 2026-08-03. Paired on the 105-card holdout, on
  // cards never used for anything before: F1 0.8149 -> 0.8339, +0.019042,
  // 42 wins to 18, p=0.0027, replicating +0.014190 on a separate 150. Almost
  // all of the gain is precision (+0.034982, p=0.0015) -- the tier mostly stops
  // the model saying wrong things rather than helping it see more. Costs ~3.6s
  // (7.4s -> 11.1s), accepted by the founder.
  //
  // The active optimization pack is the single source for these request and
  // resource defaults; runtime only projects the already-validated profile.
  reasoningEffort: CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
  imageDetail: CSM_ACTIVE_MODEL_PROFILE.image_detail,
  maxOutputTokens: CSM_ACTIVE_MODEL_PROFILE.max_output_tokens,
  promptVersion: CANONICAL_FIELDS_PROMPT_VERSION,
  estimatedTokensPerAttempt: CSM_ACTIVE_MODEL_PROFILE.estimated_tokens_per_attempt,
  localFallbackConcurrency: 6,
  maximumAttempts: 1,
  claimPollMs: 1_000,
  claimTimeoutMs: 145_000,
  providerTimeoutMs: CSM_ACTIVE_MODEL_PROFILE.provider_timeout_ms,
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
