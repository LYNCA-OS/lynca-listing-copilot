import { defaultProviderModels, imageUrlForProvider, isHttpUrl, providerModelConfig, visionProviderIds } from "./provider-contract.mjs";
import { ProviderError, isProviderResponseFormatError, providerHttpError, providerInputUnsupported, providerUnavailable, safeProviderErrorMessage } from "./provider-errors.mjs";
import { normalizeChatCompletionResponse } from "./provider-response-normalizer.mjs";
import { normalizeProviderUsage } from "./provider-usage.mjs";

const provider = visionProviderIds.AGNES;
const defaultBaseUrl = "https://apihub.agnes-ai.com/v1";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function numberFromEnv(env, key, fallback = undefined) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFromEnv(env, key, fallback = false) {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function agnesConfigFromEnv(env = process.env) {
  const model = providerModelConfig(provider, env.AGNES_MODEL);

  return {
    apiKey: env.AGNES_API_KEY || "",
    baseUrl: trimTrailingSlash(env.AGNES_BASE_URL || defaultBaseUrl),
    model: model.model_id || defaultProviderModels[provider],
    modelAllowed: model.allowed,
    temperature: numberFromEnv(env, "AGNES_TEMPERATURE", 0),
    maxTokens: numberFromEnv(env, "AGNES_MAX_TOKENS", undefined),
    timeoutMs: numberFromEnv(env, "AGNES_TIMEOUT_MS", 45000),
    maxRetries: numberFromEnv(env, "AGNES_MAX_RETRIES", 0),
    enableThinking: booleanFromEnv(env, "AGNES_ENABLE_THINKING", false)
  };
}

function validateAgnesImages(images = []) {
  if (!Array.isArray(images) || images.length < 1) {
    throw providerInputUnsupported(provider, "Agnes requires at least one image URL.");
  }

  return images.map((image, index) => {
    const url = imageUrlForProvider(image);
    if (!isHttpUrl(url)) {
      throw providerInputUnsupported(provider, `Agnes image ${index + 1} is missing an HTTP(S) URL.`);
    }
    return {
      type: "image_url",
      image_url: { url }
    };
  });
}

function buildAgnesRequestBody({
  prompt,
  images,
  model,
  temperature,
  maxTokens,
  tools,
  toolChoice,
  enableThinking,
  formatRepair = false
}) {
  const promptText = formatRepair
    ? [
      prompt,
      "",
      "FORMAT REPAIR RETRY:",
      "Your previous response was not valid JSON.",
      "Return only a single valid JSON object matching the requested evidence schema.",
      "Do not include Markdown fences, prose, comments, or any non-JSON text."
    ].join("\n")
    : prompt;
  const userContent = [
    {
      type: "text",
      text: promptText
    },
    ...validateAgnesImages(images)
  ];

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: userContent
      }
    ],
    temperature
  };

  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (Array.isArray(tools) && tools.length) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (enableThinking) {
    body.chat_template_kwargs = { enable_thinking: true };
  }

  return body;
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) {
    throw new ProviderError("Agnes returned an empty response.", {
      provider,
      status: response.status,
      code: "empty_response",
      retryable: response.status >= 500
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("Agnes returned a non-JSON response.", {
      provider,
      status: response.status,
      code: "non_json_response",
      retryable: response.status >= 500
    });
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function analyzeCardEvidenceWithAgnes({
  images,
  prompt,
  tools = null,
  toolChoice = null,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const config = agnesConfigFromEnv(env);
  if (!config.apiKey) {
    throw providerUnavailable(provider, "AGNES_API_KEY is not configured.");
  }

  if (!config.modelAllowed) {
    throw providerUnavailable(provider, "AGNES_MODEL is not in the provider model whitelist.");
  }

  if (typeof fetchImpl !== "function") {
    throw providerUnavailable(provider, "fetch is not available for Agnes provider calls.");
  }

  const body = buildAgnesRequestBody({
    prompt,
    images,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    tools,
    toolChoice,
    enableThinking: config.enableThinking
  });
  const endpoint = `${config.baseUrl}/chat/completions`;
  const startedAt = Date.now();
  let attempt = 0;
  let formatRepairAttempted = false;
  let providerCallCount = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const requestBody = formatRepairAttempted
        ? buildAgnesRequestBody({
          prompt,
          images,
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          tools,
          toolChoice,
          enableThinking: config.enableThinking,
          formatRepair: true
        })
        : body;
      providerCallCount += 1;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const payload = await response.text();
        const error = providerHttpError(provider, response.status, payload.slice(0, 180));
        if (error.retryable && attempt < config.maxRetries) {
          attempt += 1;
          await wait(250 * attempt);
          continue;
        }
        throw error;
      }

      const data = await readResponsePayload(response);
      const normalized = normalizeChatCompletionResponse(data, {
        provider,
        requestedModel: config.model,
        latencyMs: Date.now() - startedAt
      });
      normalized.usage = normalizeProviderUsage({
        provider,
        modelId: normalized.model_id,
        rawUsage: normalized.usage,
        latencyMs: normalized.latency_ms,
        imageCount: images.length,
        providerCalls: providerCallCount,
        env
      });
      if (formatRepairAttempted) {
        normalized.format_repair_attempted = true;
      }
      return normalized;
    } catch (error) {
      clearTimeout(timeout);

      if (isProviderResponseFormatError(error) && !formatRepairAttempted) {
        formatRepairAttempted = true;
        continue;
      }

      if (error?.name === "AbortError") {
        const timeoutError = new ProviderError("Agnes request timed out.", {
          provider,
          code: "timeout",
          retryable: attempt < config.maxRetries
        });
        if (timeoutError.retryable) {
          attempt += 1;
          await wait(250 * attempt);
          continue;
        }
        throw timeoutError;
      }

      if (error instanceof ProviderError) throw error;
      throw new ProviderError(safeProviderErrorMessage(error), {
        provider,
        code: "network_error",
        retryable: false
      });
    }
  }
}
