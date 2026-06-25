export const visionProviderIds = Object.freeze({
  GEMINI: "gemini",
  AGNES: "agnes",
  OPENAI_LEGACY: "openai_legacy",
  CASCADE_FAST: "cascade_fast"
});

export const providerRoles = Object.freeze({
  PRIMARY: "primary",
  SECONDARY_VERIFIER: "secondary_verifier",
  EMERGENCY: "emergency",
  CASCADE: "cascade",
  FAILURE_FALLBACK: "failure_fallback",
  CRITICAL_VERIFIER: "critical_verifier",
  MANUAL_OR_EXPERIMENTAL: "manual_or_experimental"
});

export const defaultProviderModels = Object.freeze({
  [visionProviderIds.GEMINI]: "gemini-3.1-flash-lite",
  [visionProviderIds.AGNES]: "agnes-2.0-flash",
  [visionProviderIds.OPENAI_LEGACY]: "gpt-4.1-mini-2025-04-14",
  [visionProviderIds.CASCADE_FAST]: "gpt-4.1-mini-2025-04-14 + agnes-2.0-flash"
});

export const allowedProviderModels = Object.freeze({
  [visionProviderIds.GEMINI]: Object.freeze(["gemini-3.1-flash-lite"]),
  [visionProviderIds.AGNES]: Object.freeze(["agnes-2.0-flash"]),
  [visionProviderIds.OPENAI_LEGACY]: Object.freeze(["gpt-4.1-mini-2025-04-14", "gpt-4.1-mini", "gpt-4.1"])
});

export const providerDisplayNames = Object.freeze({
  [visionProviderIds.GEMINI]: "Gemini",
  [visionProviderIds.AGNES]: "Agnes",
  [visionProviderIds.OPENAI_LEGACY]: "GPT-4.1",
  [visionProviderIds.CASCADE_FAST]: "Experimental GPT + Agnes Cascade"
});

export const providerLabels = Object.freeze({
  [visionProviderIds.GEMINI]: "Gemini · 主路径识别",
  [visionProviderIds.CASCADE_FAST]: "实验级 Cascade · GPT + Agnes",
  [visionProviderIds.AGNES]: "Agnes · 手动/离线评测",
  [visionProviderIds.OPENAI_LEGACY]: "GPT-4.1 mini · 兜底/关键复核"
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
  const allowed = provider === visionProviderIds.GEMINI
    ? /^gemini-[a-z0-9][a-z0-9_.-]*$/i.test(model)
    : Boolean(model && allowedModels.includes(model));

  return {
    model_id: allowed ? model : "",
    requested_model_id: model,
    allowed_models: provider === visionProviderIds.GEMINI && model && !allowedModels.includes(model)
      ? [...allowedModels, model]
      : [...allowedModels],
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

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
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
