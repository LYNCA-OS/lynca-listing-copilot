export const visionProviderIds = Object.freeze({
  OPENAI_LEGACY: "openai_legacy"
});

export const providerRoles = Object.freeze({
  PRIMARY: "primary",
  EMERGENCY: "emergency"
});

export const defaultProviderModels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "gpt-4.1-mini-2025-04-14"
});

export const allowedProviderModels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: Object.freeze(["gpt-4.1-mini-2025-04-14", "gpt-4.1-mini", "gpt-4.1"])
});

export const providerDisplayNames = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "GPT-4.1"
});

export const providerLabels = Object.freeze({
  [visionProviderIds.OPENAI_LEGACY]: "GPT-4.1 mini · 生产主路径"
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
