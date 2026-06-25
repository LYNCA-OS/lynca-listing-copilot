import {
  defaultProviderModels,
  imageObjectPathForProvider,
  imageUrlForProvider,
  isHttpUrl,
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
  const geminiModel = providerModelConfig(visionProviderIds.GEMINI, env.GEMINI_MODEL);
  const agnesModel = providerModelConfig(visionProviderIds.AGNES, env.AGNES_MODEL);
  const openAiModel = providerModelConfig(visionProviderIds.OPENAI_LEGACY, env.OPENAI_LISTING_MODEL);
  const geminiEnabled = envFlag(env, "ENABLE_GEMINI_PROVIDER", true);
  const agnesEnabled = envFlag(env, "ENABLE_AGNES_PROVIDER", true);
  const openAiEnabled = envFlag(env, "ENABLE_GPT41_EMERGENCY_PROVIDER", true);
  const agnesAutoVerifierEnabled = envFlag(env, "ENABLE_AGNES_AUTO_VERIFIER", false);
  const cascadeEnabled = envFlag(env, "ENABLE_FAST_CASCADE_PROVIDER", false) && agnesAutoVerifierEnabled;
  const openAiExplicitRetryAllowed = envFlag(env, "ALLOW_EXPLICIT_GPT41_RETRY", true);
  const geminiConcurrency = Math.max(1, numberFromEnv(env, "GEMINI_PROVIDER_UI_CONCURRENCY", 4));
  const agnesConcurrency = Math.max(1, numberFromEnv(env, "AGNES_PROVIDER_UI_CONCURRENCY", 3));
  const openAiConcurrency = Math.max(1, numberFromEnv(env, "OPENAI_PROVIDER_UI_CONCURRENCY", 4));
  const cascadeConcurrency = Math.max(1, numberFromEnv(env, "CASCADE_PROVIDER_UI_CONCURRENCY", openAiConcurrency));
  const agnesSecondaryConfigured = Boolean(agnesEnabled && env.AGNES_API_KEY && agnesModel.allowed);
  const agnesSecondaryDisabledReason = agnesSecondaryConfigured
    ? null
    : !agnesEnabled
      ? "agnes_disabled_by_env"
    : !agnesModel.allowed
      ? "agnes_model_not_allowed"
    : !env.AGNES_API_KEY
      ? "missing_agnes_api_key"
    : "agnes_not_configured";

  return {
    [visionProviderIds.GEMINI]: {
      id: visionProviderIds.GEMINI,
      role: providerRoles.PRIMARY,
      roles: [providerRoles.PRIMARY],
      display_name: providerDisplayNames[visionProviderIds.GEMINI],
      label: providerLabels[visionProviderIds.GEMINI],
      model_id: geminiModel.model_id || defaultProviderModels[visionProviderIds.GEMINI],
      recommended_concurrency: geminiConcurrency,
      enabled: geminiEnabled,
      visible: geminiEnabled,
      configured: Boolean(env.GEMINI_API_KEY && geminiModel.allowed),
      requires_remote_image_url: false,
      disabled_reason: !geminiEnabled
        ? "disabled_by_env"
        : !geminiModel.allowed
          ? "model_not_allowed"
        : !env.GEMINI_API_KEY
          ? "missing_gemini_api_key"
          : null
    },
    [visionProviderIds.CASCADE_FAST]: {
      id: visionProviderIds.CASCADE_FAST,
      role: providerRoles.CASCADE,
      roles: [providerRoles.CASCADE],
      display_name: providerDisplayNames[visionProviderIds.CASCADE_FAST],
      label: providerLabels[visionProviderIds.CASCADE_FAST],
      model_id: defaultProviderModels[visionProviderIds.CASCADE_FAST],
      primary_provider_id: visionProviderIds.OPENAI_LEGACY,
      secondary_provider_id: visionProviderIds.AGNES,
      secondary_role: providerRoles.SECONDARY_VERIFIER,
      secondary_configured: agnesSecondaryConfigured,
      secondary_disabled_reason: agnesSecondaryDisabledReason,
      recommended_concurrency: cascadeConcurrency,
      enabled: cascadeEnabled,
      visible: cascadeEnabled,
      configured: Boolean(env.OPENAI_API_KEY && openAiModel.allowed),
      requires_remote_image_url: true,
      requires_storage: true,
      disabled_reason: !cascadeEnabled
        ? agnesAutoVerifierEnabled ? "disabled_by_env" : "agnes_auto_verifier_disabled"
        : !openAiModel.allowed
          ? "openai_model_not_allowed"
        : !env.OPENAI_API_KEY
          ? "missing_openai_api_key"
        : null
    },
    [visionProviderIds.AGNES]: {
      id: visionProviderIds.AGNES,
      role: providerRoles.MANUAL_OR_EXPERIMENTAL,
      roles: [providerRoles.MANUAL_OR_EXPERIMENTAL],
      display_name: providerDisplayNames[visionProviderIds.AGNES],
      label: providerLabels[visionProviderIds.AGNES],
      model_id: agnesModel.model_id || defaultProviderModels[visionProviderIds.AGNES],
      recommended_concurrency: agnesConcurrency,
      enabled: agnesEnabled,
      visible: agnesEnabled,
      configured: Boolean(env.AGNES_API_KEY && agnesModel.allowed),
      requires_remote_image_url: true,
      disabled_reason: !agnesEnabled
        ? "disabled_by_env"
        : !agnesModel.allowed
          ? "model_not_allowed"
        : !env.AGNES_API_KEY
          ? "missing_agnes_api_key"
          : null
    },
    [visionProviderIds.OPENAI_LEGACY]: {
      id: visionProviderIds.OPENAI_LEGACY,
      role: providerRoles.FAILURE_FALLBACK,
      roles: [providerRoles.FAILURE_FALLBACK, providerRoles.CRITICAL_VERIFIER],
      display_name: providerDisplayNames[visionProviderIds.OPENAI_LEGACY],
      label: providerLabels[visionProviderIds.OPENAI_LEGACY],
      model_id: openAiModel.model_id || defaultProviderModels[visionProviderIds.OPENAI_LEGACY],
      recommended_concurrency: openAiConcurrency,
      enabled: openAiEnabled,
      visible: openAiEnabled,
      configured: Boolean(env.OPENAI_API_KEY && openAiModel.allowed),
      requires_explicit_retry: true,
      explicit_retry_allowed: openAiExplicitRetryAllowed,
      disabled_reason: !openAiEnabled
        ? "disabled_by_env"
        : !openAiExplicitRetryAllowed
          ? "emergency_retry_disabled"
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
  if (normalized === visionProviderIds.CASCADE_FAST) {
    return images.every((image) => Boolean(image?.dataUrl || imageUrlForProvider(image) || imageObjectPathForProvider(image)));
  }

  if (normalized === visionProviderIds.GEMINI) {
    return images.every((image) => Boolean(image?.dataUrl || imageUrlForProvider(image) || imageObjectPathForProvider(image)));
  }

  if (normalized === visionProviderIds.AGNES) {
    return images.every((image) => isHttpUrl(imageUrlForProvider(image)) || Boolean(imageObjectPathForProvider(image)));
  }

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
  const defaultId = envDefault || visionProviderIds.GEMINI;
  const selectedId = normalizedRequested || defaultId;
  const provider = catalog[selectedId];

  if (!provider) {
    throw new ProviderError(`Unknown vision provider: ${selectedId || "(empty)"}`, {
      provider: selectedId || null,
      code: "unknown_provider"
    });
  }

  if (provider.id === visionProviderIds.OPENAI_LEGACY) {
    if (provider.explicit_retry_allowed === false) {
      throw providerUnavailable(provider.id, "GPT-4.1 manual single-provider retry is disabled by env.");
    }

    if (!normalizedRequested || !explicitEmergency) {
      throw new ProviderError("GPT-4.1 single-provider mode may only be used through an explicit manual retry.", {
        provider: provider.id,
        code: "explicit_emergency_required"
      });
    }
  }

  if (!provider.enabled || !provider.configured) {
    throw providerUnavailable(provider.id, `${provider.display_name} is unavailable: ${provider.disabled_reason || "not_configured"}.`);
  }

  if (!providerSupportsImages(provider.id, images)) {
    throw providerInputUnsupported(
      provider.id,
      provider.id === visionProviderIds.AGNES
        ? "Agnes requires one or more HTTP(S) image URLs. Base64 data URLs are not used for Agnes."
        : provider.id === visionProviderIds.GEMINI
          ? "Gemini requires one or more data URLs, HTTP(S) image URLs, or verified storage object paths."
        : "Selected provider does not support the provided image inputs."
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
