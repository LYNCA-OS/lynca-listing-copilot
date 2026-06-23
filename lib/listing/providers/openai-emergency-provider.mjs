import { defaultProviderModels, providerModelConfig, visionProviderIds } from "./provider-contract.mjs";
import { ProviderError, providerHttpError, providerInputUnsupported, providerUnavailable, safeProviderErrorMessage } from "./provider-errors.mjs";
import { parseProviderMessagePayload, validateProviderEvidencePayload } from "./provider-response-normalizer.mjs";
import { normalizeProviderUsage } from "./provider-usage.mjs";

const provider = visionProviderIds.OPENAI_LEGACY;
const endpoint = "https://api.openai.com/v1/responses";

function numberFromEnv(env, key, fallback = undefined) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function openAiEmergencyConfigFromEnv(env = process.env) {
  const model = providerModelConfig(provider, env.OPENAI_LISTING_MODEL);

  return {
    apiKey: env.OPENAI_API_KEY || "",
    model: model.model_id || defaultProviderModels[provider],
    modelAllowed: model.allowed,
    timeoutMs: numberFromEnv(env, "OPENAI_LISTING_TIMEOUT_MS", 45000),
    maxOutputTokens: numberFromEnv(env, "OPENAI_LISTING_MAX_OUTPUT_TOKENS", 900)
  };
}

function validateOpenAiImages(images = []) {
  if (!Array.isArray(images) || images.length < 1) {
    throw providerInputUnsupported(provider, "OpenAI emergency provider requires at least one image.");
  }

  return images.map((image, index) => {
    const imageUrl = image.dataUrl || image.signedUrl || image.signed_url || image.url || image.imageUrl;
    if (!imageUrl) {
      throw providerInputUnsupported(provider, `OpenAI emergency image ${index + 1} has no data URL or image URL.`);
    }

    return {
      type: "input_image",
      image_url: imageUrl,
      detail: index === 0 ? "high" : "low"
    };
  });
}

function parseResponsesText(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

export async function analyzeCardEvidenceWithOpenAiEmergency({
  images,
  prompt,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const config = openAiEmergencyConfigFromEnv(env);
  if (!config.apiKey) {
    throw providerUnavailable(provider, "OPENAI_API_KEY is not configured.");
  }

  if (!config.modelAllowed) {
    throw providerUnavailable(provider, "OPENAI_LISTING_MODEL is not in the provider model whitelist.");
  }

  if (typeof fetchImpl !== "function") {
    throw providerUnavailable(provider, "fetch is not available for OpenAI emergency provider calls.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              },
              ...validateOpenAiImages(images)
            ]
          }
        ],
        max_output_tokens: config.maxOutputTokens
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const message = await response.text();
      throw providerHttpError(provider, response.status, message.slice(0, 180));
    }

    const data = await response.json();
    const text = parseResponsesText(data);
    const { parsed, parse_source } = parseProviderMessagePayload({ content: text });
    const latencyMs = Date.now() - startedAt;
    const modelId = data.model || config.model;

    return {
      provider,
      model_id: modelId,
      response_id: data.id || null,
      finish_reason: null,
      usage: normalizeProviderUsage({
        provider,
        modelId,
        rawUsage: data.usage,
        latencyMs,
        imageCount: images.length,
        env
      }),
      latency_ms: latencyMs,
      parse_source,
      content: text,
      tool_calls: [],
      parsed: validateProviderEvidencePayload(provider, parsed)
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error?.name === "AbortError") {
      throw new ProviderError("OpenAI emergency request timed out.", {
        provider,
        code: "timeout",
        retryable: false
      });
    }

    if (error instanceof ProviderError) throw error;
    throw new ProviderError(safeProviderErrorMessage(error), {
      provider,
      code: "network_error",
      retryable: false
    });
  }
}
