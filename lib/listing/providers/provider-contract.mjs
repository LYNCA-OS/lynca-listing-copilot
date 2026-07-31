export const visionProviderIds = Object.freeze({
  OPENAI_LEGACY: "openai_legacy"
});

export const providerRoles = Object.freeze({
  PRIMARY: "primary",
  EMERGENCY: "emergency"
});

export const defaultProviderModels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "gpt-5.6-luna"
});

// The whitelist is fail-closed on purpose: a model id that is not listed here
// makes the provider unavailable rather than silently falling back, so a typo
// surfaces as a hard error instead of a quiet accuracy change nobody attributes.
// Keep that property when adding to it.
//
// Extra ids may be admitted at runtime through OPENAI_ALLOWED_LISTING_MODELS,
// comma-separated. That exists because this machine cannot currently reach
// api.openai.com to confirm an exact id -- DNS for that host resolves to an
// unrelated address here -- and guessing an id would take the main recognition
// path down silently. Set the variable to the exact id the API reports, and the
// whitelist admits it without a code change.
const extraAllowedModels = String(process.env.OPENAI_ALLOWED_LISTING_MODELS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const allowedProviderModels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: Object.freeze([
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5-mini-2025-08-07",
    // The current main-path model. gpt-5-mini stays listed so a rollback is a
    // one-variable change rather than a deploy.
    "gpt-5.6-luna",
    ...extraAllowedModels
  ])
});

export const providerDisplayNames = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "GPT"
});

export const providerLabels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "GPT · 生产主路径"
});

export const providerPromptVersion = "listing-intelligence-v1";
export const providerSchemaVersion = "provider-evidence-v1";

export function normalizeProviderId(value) {
  return String(value || "").trim().toLowerCase();
}

export function isKnownVisionProvider(value) {
  return Object.values(visionProviderIds).includes(normalizeProviderId(value));
}

export function providerModelConfig(provider, requestedModel) {
  const model = String(requestedModel || defaultProviderModels[provider] || "").trim();
  const allowedModels = allowedProviderModels[provider] || [];
  const allowed = Boolean(model && allowedModels.includes(model));

  return {
    model_id: allowed ? model : "",
    requested_model_id: model,
    allowed_models: [...allowedModels],
    allowed
  };
}

/**
 * Whether the environment is pinning a model other than the one this file says
 * is the main path, and how to tell.
 *
 * `defaultProviderModels` reads like the decision about which model runs. It is
 * not: `OPENAI_LISTING_MODEL` is consulted first everywhere it matters, so a
 * deployment carrying that variable ignores this file entirely. Changing the
 * constant here and shipping it therefore does nothing, silently, and the next
 * measurement is attributed to a switch that never happened -- which is exactly
 * what happened when the main path was "moved" to gpt-5.6-luna while every
 * deployed environment stayed pinned to gpt-5-mini-2025-08-07.
 *
 * Readiness reporting calls this so the disagreement is visible before a run
 * rather than inferred from a token ledger afterwards.
 */
export function providerModelPinning(provider, env = process.env) {
  const codeDefault = defaultProviderModels[provider] || "";
  const envPinned = String(env.OPENAI_LISTING_MODEL || "").trim();
  const effective = envPinned || codeDefault;
  return Object.freeze({
    provider,
    code_default: codeDefault,
    env_pinned: envPinned || null,
    effective_model: effective,
    // The dangerous state: the source says one thing, the deployment does
    // another, and nothing errors.
    code_default_is_inert: Boolean(envPinned && codeDefault && envPinned !== codeDefault),
    remedy: envPinned && codeDefault && envPinned !== codeDefault
      ? `OPENAI_LISTING_MODEL=${envPinned} overrides the source default ${codeDefault}. `
        + "Change the environment variable, or clear it to let the source default apply."
      : null
  });
}

export function providerModelOverrideFromOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return "";
  const raw = options.openai_listing_model_override
    || options.openaiListingModelOverride
    || options.openai_model_override
    || options.openAiModelOverride
    || options.model_override
    || options.modelOverride;
  return String(raw || "").trim();
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function imageUrlForProvider(image = {}) {
  const directUrl = image.signedUrl || image.signed_url || image.url || image.imageUrl;
  if (directUrl) return String(directUrl);

  const nestedUrl = image.image_url?.url;
  if (nestedUrl) return String(nestedUrl);

  return "";
}

export function imageObjectPathForProvider(image = {}) {
  return String(image.objectPath || image.object_path || image.storagePath || image.storage_path || "").trim();
}

export function providerMetadata({
  provider,
  modelId,
  promptVersion = providerPromptVersion,
  schemaVersion = providerSchemaVersion,
  resolverVersion = null,
  registryVersion = null
}) {
  return {
    provider,
    provider_label: providerLabels[provider] || provider,
    model_id: modelId || defaultProviderModels[provider] || null,
    prompt_version: promptVersion,
    schema_version: schemaVersion,
    resolver_version: resolverVersion,
    registry_version: registryVersion
  };
}

// Which side of a provider call may be compressed, and which may not.
//
// This is a measured boundary, not a style preference. Task A cut request-side
// fields and lost 6.91pp on familiar products and 7.74pp on unseen. The cause
// was not the fields it removed: fields that STAYED in the schema got worse --
// surface_color absent 12 more times, manufacturer 9, set 8, card_name
// mismatched 11 -- which no derivation-gap explanation covers. The long field
// list was doing work as a checklist, keeping the model looking.
//
// The response side is different and was never falsified. Latency tracks output
// at roughly 11ms per token, while a twelvefold change in input moves it almost
// not at all (within-band correlations 0.134, 0.076, -0.050, 0.005 over 4,785
// production calls). So compressing what comes back is nearly free of accuracy
// risk and buys real time; compressing what goes out buys almost nothing and
// has already cost fourteen points across two scoreboards.
//
// Cost does not change this. At $0.2/M in and $1.2/M out, a call costs $0.00247
// and the whole month costs $12.67 at current volume. Nothing here is worth an
// accuracy point.
export const compressionPolicy = Object.freeze({
  REQUEST: Object.freeze({
    compressible: false,
    reason: "task_a_measured_-6.91pp_familiar_-7.74pp_unseen",
    evidence: "fields left in the schema degraded when others were removed"
  }),
  RESPONSE: Object.freeze({
    compressible: true,
    reason: "latency tracks output at ~11ms/token and no accuracy loss is measured",
    guidance: "omit empty values from the response; never remove a field from the request"
  })
});

/**
 * Refuses a plan that shrinks the request. Call this from anything that builds
 * or edits a provider prompt so the boundary is enforced rather than remembered.
 */
export function assertCompressionAllowed(side) {
  const policy = compressionPolicy[String(side || "").toUpperCase()];
  if (!policy) throw new Error(`unknown compression side: ${side}`);
  if (!policy.compressible) {
    throw new Error(
      `refusing to compress the ${side} side: ${policy.reason}. `
      + "Compress the response instead -- see compressionPolicy in provider-contract.mjs."
    );
  }
  return policy;
}
