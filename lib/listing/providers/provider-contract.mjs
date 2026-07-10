export const visionProviderIds = Object.freeze({
  OPENAI_LEGACY: "openai_legacy"
});

export const providerRoles = Object.freeze({
  PRIMARY: "primary",
  EMERGENCY: "emergency"
});

export const defaultProviderModels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "gpt-5-mini"
});

export const allowedProviderModels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: Object.freeze([
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5-mini-2025-08-07"
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
