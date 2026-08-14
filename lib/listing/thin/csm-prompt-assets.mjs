import {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_VERSION,
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_PROMPT_VERSION
} from "./canonical-fields.mjs";

export const CSM_NEUTRAL_PROMPT_STYLE_VERSION = "canonical-direct-v1";

const capturedCanonicalAsset = Object.freeze({
  semantic_prompt_version: CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_VERSION,
  rendered_prompt: CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT
});
const futureCanonicalAsset = Object.freeze({
  semantic_prompt_version: CANONICAL_FIELDS_PROMPT_VERSION,
  rendered_prompt: CANONICAL_FIELDS_PROMPT
});

const promptAssets = Object.freeze({
  [CSM_NEUTRAL_PROMPT_STYLE_VERSION]: Object.freeze({
    [CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_VERSION]: capturedCanonicalAsset,
    [CANONICAL_FIELDS_PROMPT_VERSION]: futureCanonicalAsset
  })
});

/** A prompt style is an executable asset selector, never a cosmetic label. */
export function resolveCsmPromptAsset(promptStyleVersion, {
  semanticPromptVersion = CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_VERSION
} = {}) {
  if (typeof promptStyleVersion !== "string") {
    throw new TypeError("invalid_prompt_style_version");
  }
  const style = promptStyleVersion.trim();
  if (!style) throw new TypeError("missing_prompt_style_version");
  if (style !== promptStyleVersion) throw new TypeError("noncanonical_prompt_style_version");
  const asset = promptAssets[style]?.[semanticPromptVersion];
  if (!asset) throw new TypeError(`unsupported_prompt_style_version:${style}`);
  return asset;
}
