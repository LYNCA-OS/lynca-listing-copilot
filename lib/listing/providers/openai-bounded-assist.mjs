import crypto from "node:crypto";

import {
  defaultProviderModels,
  providerModelConfig,
  visionProviderIds
} from "./provider-contract.mjs";
import {
  ProviderError,
  providerHttpError,
  providerInputUnsupported,
  providerSchemaError,
  providerUnavailable,
  safeProviderErrorMessage
} from "./provider-errors.mjs";
import { selectOpenAiApiKey } from "./openai-key-pool.mjs";
import {
  openAiResponsesModelControls,
  openAiResponsesTextOptions
} from "./openai-responses-request.mjs";
import { normalizeProviderUsage } from "./provider-usage.mjs";

const provider = visionProviderIds.OPENAI_LEGACY;
const endpoint = "https://api.openai.com/v1/responses";

export const boundedOpenAiAssistContract = Object.freeze({
  owner: "OPENAI_BOUNDED_ASSIST",
  transport_version: "openai-bounded-assist-v1",
  retry_policy: "NO_AUTOMATIC_RETRY",
  raw_response_persistence: "FORBIDDEN"
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function imageUrl(image = {}) {
  return image.dataUrl
    || image.signedUrl
    || image.signed_url
    || image.url
    || image.imageUrl
    || image.image_url?.url
    || "";
}

function imageInput(image = {}, detail = "auto") {
  const url = imageUrl(image);
  if (!url) throw providerInputUnsupported(provider, "Bounded assist image is missing a readable URL.");
  return {
    type: "input_image",
    image_url: url,
    detail: ["low", "high", "auto"].includes(String(detail || "").toLowerCase())
      ? String(detail).toLowerCase()
      : "auto"
  };
}

function responseText(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;
  return (Array.isArray(data.output) ? data.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((content) => content?.text || "")
    .filter(Boolean)
    .join("\n");
}

function responseHash(text = "") {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function requestAbort({ timeoutMs, signal = null } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("bounded_assist_timeout")), timeoutMs);
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abortFromParent);
    }
  };
}

function parsedJson(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("response_not_object");
    }
    return parsed;
  } catch (error) {
    throw providerSchemaError(provider, "Bounded assist returned invalid structured JSON.", {
      parse_error: safeProviderErrorMessage(error)
    });
  }
}

/**
 * One bounded Responses API call for a narrow, server-owned schema.
 *
 * This transport intentionally has no key rotation, transient retry, output
 * repair, or truncation retry. The route owner decides whether a failed assist
 * should abstain or fall back to the full Provider; the transport never grows
 * a writer-visible long tail by itself.
 */
export async function runBoundedOpenAiAssist({
  prompt,
  schema,
  schemaName = "listing_bounded_assist",
  images = [],
  allowTextOnly = false,
  shardKey = "",
  preferredKeySlot = null,
  modelOverride = "",
  maxOutputTokens = 384,
  timeoutMs = 3_500,
  imageDetail = "auto",
  textVerbosity = "low",
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal = null,
  requestContext = {}
} = {}) {
  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) throw providerInputUnsupported(provider, "Bounded assist prompt is required.");
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw providerInputUnsupported(provider, "Bounded assist JSON schema is required.");
  }
  const normalizedImages = Array.isArray(images) ? images : [];
  if (!allowTextOnly && normalizedImages.length < 1) {
    throw providerInputUnsupported(provider, "Bounded visual assist requires at least one image.");
  }
  if (typeof fetchImpl !== "function") throw providerUnavailable(provider, "fetch is unavailable.");

  const modelConfig = providerModelConfig(
    provider,
    modelOverride || env.OPENAI_LISTING_MODEL || defaultProviderModels[provider]
  );
  if (!modelConfig.allowed) {
    throw providerUnavailable(provider, "Bounded assist model is not in the provider whitelist.");
  }
  const key = selectOpenAiApiKey({ env, shardKey, preferredKeySlot });
  if (!key.apiKey) throw providerUnavailable(provider, "OPENAI_API_KEY is not configured.");

  const boundedOutputTokens = positiveInteger(maxOutputTokens, 384, { min: 64, max: 2_048 });
  const boundedTimeoutMs = positiveInteger(timeoutMs, 3_500, { min: 250, max: 15_000 });
  const abort = requestAbort({ timeoutMs: boundedTimeoutMs, signal });
  const startedAt = Date.now();
  let providerCallAttempted = false;
  try {
    let response;
    try {
      providerCallAttempted = true;
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: modelConfig.model_id,
          store: false,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: normalizedPrompt },
              ...normalizedImages.map((image) => imageInput(image, imageDetail))
            ]
          }],
          max_output_tokens: boundedOutputTokens,
          ...openAiResponsesModelControls(modelConfig.model_id, { env }),
          text: openAiResponsesTextOptions({
            model: modelConfig.model_id,
            name: cleanText(schemaName).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64) || "listing_bounded_assist",
            strict: true,
            schema,
            env,
            verbosity: textVerbosity
          })
        }),
        signal: abort.signal
      });
    } catch (error) {
      if (error?.name === "AbortError" || abort.signal.aborted) {
        throw new ProviderError("Bounded assist timed out.", {
          provider,
          code: "PROVIDER_TIMEOUT",
          retryable: true,
          details: { timeout_ms: boundedTimeoutMs }
        });
      }
      throw new ProviderError(safeProviderErrorMessage(error), {
        provider,
        code: "NETWORK_ERROR",
        retryable: true
      });
    }

    if (!response.ok) {
      const message = await response.text();
      throw providerHttpError(provider, response.status, String(message || "").slice(0, 180));
    }

    const data = await response.json();
    const text = responseText(data);
    if (!String(text || "").trim()) {
      throw new ProviderError("Bounded assist returned no structured content.", {
        provider,
        code: "empty_response",
        retryable: true
      });
    }
    const parsed = parsedJson(text);
    const latencyMs = Date.now() - startedAt;
    return {
      ...boundedOpenAiAssistContract,
      provider,
      model_id: data.model || modelConfig.model_id,
      response_id: data.id || null,
      finish_reason: data.status || null,
      response_hash: responseHash(text),
      response_schema_name: cleanText(schemaName) || "listing_bounded_assist",
      response_profile: cleanText(schemaName) || "listing_bounded_assist",
      image_detail: imageDetail,
      text_verbosity: textVerbosity,
      provider_key_pool_size: key.poolSize,
      provider_key_slot: key.keySlot,
      provider_key_source: key.source,
      latency_ms: latencyMs,
      token_diagnostics: {
        input_tokens: Number.isFinite(Number(data.usage?.input_tokens)) ? Number(data.usage.input_tokens) : null,
        output_tokens: Number.isFinite(Number(data.usage?.output_tokens)) ? Number(data.usage.output_tokens) : null,
        total_tokens: Number.isFinite(Number(data.usage?.total_tokens)) ? Number(data.usage.total_tokens) : null,
        requested_output_cap: boundedOutputTokens,
        response_status: data.status || null
      },
      usage: normalizeProviderUsage({
        provider,
        modelId: data.model || modelConfig.model_id,
        rawUsage: data.usage,
        latencyMs,
        imageCount: normalizedImages.length,
        providerCalls: 1,
        env
      }),
      request_context: requestContext && typeof requestContext === "object"
        ? {
            provider_call_purpose: cleanText(requestContext.provider_call_purpose) || null,
            job_id: cleanText(requestContext.job_id) || null,
            asset_id: cleanText(requestContext.asset_id) || null
          }
        : null,
      native_schema_valid: true,
      transient_retry_attempted: false,
      transient_retry_attempts: 0,
      truncation_retry_attempted: false,
      truncation_retry_attempts: 0,
      output_cap_downgrade_attempted: false,
      output_cap_downgrade_attempts: 0,
      parsed
    };
  } catch (error) {
    if (error && typeof error === "object") {
      error.provider_call_attempted = providerCallAttempted;
    }
    throw error;
  } finally {
    abort.cleanup();
  }
}

export const __boundedOpenAiAssistTestHooks = Object.freeze({
  imageUrl,
  parsedJson,
  responseText
});
