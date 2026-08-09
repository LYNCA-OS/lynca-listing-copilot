import { CANONICAL_IMAGE_DETAILS } from "./canonical-fields.mjs";
import {
  CSM_LUNA_OPTIMIZATION_PACK,
  sha256OptimizationPack,
  validateCsmModelOptimizationPack
} from "./csm-model-optimization-pack.mjs";
import {
  CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  resolveCsmPromptAsset
} from "./csm-prompt-assets.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Replaceable paid-model policy.
 *
 * CSM/SEM admission, the 80-character Composer and Storage durability are not
 * model preferences and deliberately live outside this profile. A future
 * provider/model replaces this data plus its adapter; it does not fork the
 * semantic or transport pipeline.
 */
export function buildCsmModelProfile({
  id,
  provider,
  accountScope,
  model,
  promptStyleVersion,
  capabilities,
  optimizationPack = null,
  reasoningEffort = optimizationPack?.request_defaults?.reasoning_effort,
  imageDetail = optimizationPack?.request_defaults?.image_detail,
  maxOutputTokens = optimizationPack?.request_defaults?.max_output_tokens,
  estimatedTokensPerAttempt = optimizationPack?.resource_hints?.estimated_tokens_per_attempt,
  providerTimeoutMs = optimizationPack?.resource_hints?.provider_timeout_ms
} = {}) {
  resolveCsmPromptAsset(promptStyleVersion);
  const pack = optimizationPack === null
    ? null
    : validateCsmModelOptimizationPack(optimizationPack);
  if (pack && (provider !== pack.provider || model !== pack.model)) {
    throw new TypeError("model_optimization_pack_profile_mismatch");
  }
  if (pack && (
    reasoningEffort !== pack.request_defaults.reasoning_effort
    || imageDetail !== pack.request_defaults.image_detail
    || maxOutputTokens !== pack.request_defaults.max_output_tokens
    || estimatedTokensPerAttempt !== pack.resource_hints.estimated_tokens_per_attempt
    || providerTimeoutMs !== pack.resource_hints.provider_timeout_ms
  )) {
    throw new TypeError("model_optimization_pack_defaults_mismatch");
  }
  return deepFreeze({
    id,
    provider,
    account_scope: accountScope,
    model,
    reasoning_effort: reasoningEffort,
    image_detail: imageDetail,
    max_output_tokens: maxOutputTokens,
    prompt_style_version: promptStyleVersion,
    estimated_tokens_per_attempt: estimatedTokensPerAttempt,
    provider_timeout_ms: providerTimeoutMs,
    capabilities,
    optimization_pack_id: pack?.id || null,
    optimization_pack_sha256: pack ? sha256OptimizationPack(pack) : null
  });
}

export const CSM_LUNA_MODEL_PROFILE = buildCsmModelProfile({
  id: "openai-gpt-5.6-luna-csm-v1",
  provider: "openai",
  accountScope: "lynca-primary",
  model: "gpt-5.6-luna",
  // No Luna-specific prompt bytes have passed an accuracy gate. Keep the
  // semantic prompt neutral; Luna-specific proven knobs live in the removable
  // optimization pack instead of a cosmetic prompt alias.
  promptStyleVersion: CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  optimizationPack: CSM_LUNA_OPTIMIZATION_PACK,
  capabilities: {
    structured_output: "json_schema_strict",
    image_input: "url",
    image_detail: [...CANONICAL_IMAGE_DETAILS],
    sampling_parameters: "unsupported"
  }
});

export const CSM_ACTIVE_MODEL_PROFILE = CSM_LUNA_MODEL_PROFILE;
