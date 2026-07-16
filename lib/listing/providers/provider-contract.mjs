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
    "gpt-5-mini"
  ])
});

export const providerModelOverrideOptionKeys = Object.freeze([
  "openai_listing_model_override",
  "openaiListingModelOverride",
  "openai_model_override",
  "openAiModelOverride",
  "model_override",
  "modelOverride"
]);

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

export function providerModelOverrideFromOptions(options = {}, {
  trustedServerEval = false
} = {}) {
  if (trustedServerEval !== true) return "";
  if (!options || typeof options !== "object" || Array.isArray(options)) return "";

  const requestedModels = [...new Set(providerModelOverrideOptionKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(options, key))
    .map((key) => String(options[key] || "").trim())
    .filter(Boolean))];
  if (!requestedModels.length) return "";
  if (requestedModels.length !== 1) {
    throw new TypeError("Trusted server eval must provide one GPT-5-mini model override.");
  }

  const model = providerModelConfig(visionProviderIds.OPENAI_LEGACY, requestedModels[0]);
  if (!model.allowed) {
    throw new TypeError("Trusted server eval model override must use GPT-5-mini.");
  }
  return model.model_id;
}

export function sanitizeProviderModelOverrides(options = {}, context = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const sanitized = { ...source };
  providerModelOverrideOptionKeys.forEach((key) => delete sanitized[key]);

  const modelOverride = providerModelOverrideFromOptions(source, context);
  if (modelOverride) sanitized.openai_listing_model_override = modelOverride;
  return sanitized;
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
