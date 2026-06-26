import {
  defaultProviderModels,
  imageObjectPathForProvider,
  imageUrlForProvider,
  normalizeProviderId,
  providerModelConfig,
  providerDisplayNames,
  providerLabels,
  providerRoles,
  visionProviderIds
} from "./provider-contract.mjs";
import { ProviderError, providerInputUnsupported, providerUnavailable } from "./provider-errors.mjs";

function envFlag(env, key, fallback = true) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function numberFromEnv(env, key, fallback = 0) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function providerCatalog(env = process.env) {
  const openAiModel = providerModelConfig(visionProviderIds.OPENAI_LEGACY, env.OPENAI_LISTING_MODEL);
  const openAiEnabled = envFlag(env, "ENABLE_GPT41_PROVIDER", envFlag(env, "ENABLE_GPT41_EMERGENCY_PROVIDER", true));
  const openAiExplicitRetryAllowed = envFlag(env, "ALLOW_EXPLICIT_GPT41_RETRY", true);
  const openAiConcurrency = Math.max(1, numberFromEnv(env, "OPENAI_PROVIDER_UI_CONCURRENCY", 4));

  return {
    [visionProviderIds.OPENAI_LEGACY]: {
      id: visionProviderIds.OPENAI_LEGACY,
      role: providerRoles.PRIMARY,
      roles: [providerRoles.PRIMARY],
      display_name: providerDisplayNames[visionProviderIds.OPENAI_LEGACY],
      label: providerLabels[visionProviderIds.OPENAI_LEGACY],
      model_id: openAiModel.model_id || defaultProviderModels[visionProviderIds.OPENAI_LEGACY],
      recommended_concurrency: openAiConcurrency,
      enabled: openAiEnabled,
      visible: openAiEnabled,
      configured: Boolean(env.OPENAI_API_KEY && openAiModel.allowed),
      requires_explicit_retry: false,
      explicit_retry_allowed: openAiExplicitRetryAllowed,
      disabled_reason: !openAiEnabled
        ? "disabled_by_env"
        : !openAiModel.allowed
          ? "model_not_allowed"
        : !env.OPENAI_API_KEY
          ? "missing_openai_api_key"
          : null
    }
  };
}

export function listAvailableVisionProviders(env = process.env) {
  return Object.values(providerCatalog(env)).filter((provider) => {
    return provider.enabled
      && provider.configured
      && provider.visible !== false
      && provider.disabled_reason !== "emergency_retry_disabled";
  });
}

export function providerSupportsImages(providerId, images = []) {
  const normalized = normalizeProviderId(providerId);
  if (normalized === visionProviderIds.OPENAI_LEGACY) {
    return images.every((image) => Boolean(image?.dataUrl || imageUrlForProvider(image) || imageObjectPathForProvider(image)));
  }

  return false;
}

export function selectVisionProvider({
  requestedProvider = "",
  explicitEmergency = false,
  images = [],
  env = process.env
} = {}) {
  const catalog = providerCatalog(env);
  const normalizedRequested = normalizeProviderId(requestedProvider);
  const envDefault = normalizeProviderId(env.DEFAULT_VISION_PROVIDER);
  const defaultId = envDefault || visionProviderIds.OPENAI_LEGACY;
  const selectedId = normalizedRequested || defaultId;
  const provider = catalog[selectedId];

  if (!provider) {
    throw new ProviderError(`Unknown vision provider: ${selectedId || "(empty)"}`, {
      provider: selectedId || null,
      code: "unknown_provider"
    });
  }

  if (!provider.enabled || !provider.configured) {
    throw providerUnavailable(provider.id, `${provider.display_name} is unavailable: ${provider.disabled_reason || "not_configured"}.`);
  }

  if (!providerSupportsImages(provider.id, images)) {
    throw providerInputUnsupported(
      provider.id,
      "Selected provider does not support the provided image inputs."
    );
  }

  return {
    provider,
    provider_id: provider.id,
    model_id: provider.model_id,
    explicit_emergency: explicitEmergency,
    shadow_compare_rate: numberFromEnv(env, "PROVIDER_SHADOW_COMPARE_RATE", 0)
  };
}
