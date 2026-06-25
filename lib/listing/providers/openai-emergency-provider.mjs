import { jsonrepair } from "jsonrepair";
import { defaultProviderModels, providerModelConfig, visionProviderIds } from "./provider-contract.mjs";
import {
  ProviderError,
  isProviderResponseFormatError,
  providerHttpError,
  providerInputUnsupported,
  providerUnavailable,
  safeProviderErrorMessage
} from "./provider-errors.mjs";
import { parseProviderMessagePayload, validateProviderEvidencePayload } from "./provider-response-normalizer.mjs";
import { normalizeProviderUsage } from "./provider-usage.mjs";

const provider = visionProviderIds.OPENAI_LEGACY;
const endpoint = "https://api.openai.com/v1/responses";
const openAiFieldNames = Object.freeze([
  "multi_card",
  "card_count",
  "lot_type",
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "players",
  "player",
  "team",
  "card_type",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "card_number",
  "checklist_code",
  "attributes",
  "grade_company",
  "grade",
  "card_grade",
  "auto_grade",
  "grade_type",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one"
]);
const openAiBooleanFieldNames = new Set([
  "multi_card",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one"
]);

function openAiScalarFieldSchema(fieldName) {
  if (openAiBooleanFieldNames.has(fieldName)) return { type: ["boolean", "null"] };
  if (fieldName === "card_count") return { type: ["number", "null"] };
  if (fieldName === "players" || fieldName === "attributes") {
    return {
      type: "array",
      items: { type: "string" }
    };
  }
  return { type: ["string", "null"] };
}

export function openAiProviderResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "FAILED"] },
      recognition_status: { type: "string", enum: ["CONFIRMED", "RESOLVED", "ABSTAIN"] },
      route: { type: "string" },
      reason: { type: "string" },
      fields: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(openAiFieldNames.map((fieldName) => [
          fieldName,
          openAiScalarFieldSchema(fieldName)
        ])),
        required: [...openAiFieldNames]
      },
      field_evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            value: { type: ["string", "number", "boolean", "null"] },
            source_type: { type: "string" },
            source_image_id: { type: "string" },
            source_region: { type: "string" },
            raw_text: { type: "string" },
            visible_text: { type: "string" },
            evidence_kind: { type: "string" },
            confidence: { type: ["number", "null"] },
            review_required: { type: "boolean" },
            directly_observed: { type: "boolean" },
            direct_observation: { type: "boolean" }
          },
          required: [
            "field",
            "value",
            "source_type",
            "source_image_id",
            "source_region",
            "raw_text",
            "visible_text",
            "evidence_kind",
            "confidence",
            "review_required",
            "directly_observed",
            "direct_observation"
          ]
        }
      },
      unresolved: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["title", "confidence", "recognition_status", "route", "reason", "fields", "field_evidence", "unresolved"]
  };
}

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
    timeoutMs: numberFromEnv(env, "OPENAI_LISTING_TIMEOUT_MS", 75000),
    maxOutputTokens: numberFromEnv(env, "OPENAI_LISTING_MAX_OUTPUT_TOKENS", 550)
  };
}

function validateOpenAiImages(images = []) {
  if (!Array.isArray(images) || images.length < 1) {
    throw providerInputUnsupported(provider, "OpenAI single-provider mode requires at least one image.");
  }

  return images.map((image, index) => {
    const imageUrl = image.dataUrl || image.signedUrl || image.signed_url || image.url || image.imageUrl;
    if (!imageUrl) {
      throw providerInputUnsupported(provider, `OpenAI single-provider image ${index + 1} has no data URL or image URL.`);
    }

    return {
      type: "input_image",
      image_url: imageUrl,
      detail: "high"
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

function openAiStrictSchemaPrompt(prompt = "") {
  return [
    prompt,
    "",
    "OpenAI strict response schema note:",
    "Return field_evidence as an array, not an object. Each entry must include field, value, source_type, source_image_id, source_region, raw_text, visible_text, evidence_kind, confidence, review_required, directly_observed, and direct_observation.",
    "Use empty strings, null confidence, and false booleans for unknown evidence scaffold values. Do not invent identity values to fill the schema."
  ].join("\n");
}

function createRequestAbort({ timeoutMs, signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort(signal.reason);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abortFromParent);
    }
  };
}

function extractJsonCandidateForRepair(content = "") {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

function parseOpenAiProviderPayload(text) {
  try {
    const parsedMessage = parseProviderMessagePayload({ content: text });
    return {
      ...parsedMessage,
      native_schema_valid: true,
      format_repair_attempted: false,
      local_json_repair_success: false,
      format_error_type: null
    };
  } catch (error) {
    if (!isProviderResponseFormatError(error)) throw error;

    try {
      const repaired = JSON.parse(jsonrepair(extractJsonCandidateForRepair(text)));
      return {
        parsed: repaired,
        parse_source: "jsonrepair",
        tool_calls: [],
        content: text,
        native_schema_valid: false,
        format_repair_attempted: true,
        local_json_repair_success: true,
        format_error_type: "JSON_SYNTAX_INVALID"
      };
    } catch (repairError) {
      error.details = {
        ...(error.details || {}),
        format_error_type: "JSON_SYNTAX_INVALID",
        format_repair_attempted: true,
        local_json_repair_success: false,
        local_json_repair_error: safeProviderErrorMessage(repairError)
      };
      throw error;
    }
  }
}

export async function analyzeCardEvidenceWithOpenAiEmergency({
  images,
  prompt,
  env = process.env,
  signal = null,
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
    throw providerUnavailable(provider, "fetch is not available for OpenAI single-provider calls.");
  }

  const requestAbort = createRequestAbort({
    timeoutMs: config.timeoutMs,
    signal
  });
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
                text: openAiStrictSchemaPrompt(prompt)
              },
              ...validateOpenAiImages(images)
            ]
          }
        ],
        max_output_tokens: config.maxOutputTokens,
        temperature: 0,
        text: {
          format: {
            type: "json_schema",
            name: "listing_provider_evidence",
            strict: true,
            schema: openAiProviderResponseSchema()
          }
        }
      }),
      signal: requestAbort.signal
    });

    requestAbort.cleanup();

    if (!response.ok) {
      const message = await response.text();
      throw providerHttpError(provider, response.status, message.slice(0, 180));
    }

    const data = await response.json();
    const text = parseResponsesText(data);
    const parsedMessage = parseOpenAiProviderPayload(text);
    const { parsed, parse_source } = parsedMessage;
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
      format_error_type: parsedMessage.format_error_type,
      format_repair_attempted: parsedMessage.format_repair_attempted,
      local_json_repair_success: parsedMessage.local_json_repair_success,
      text_repair_success: false,
      native_schema_valid: parsedMessage.native_schema_valid,
      content: text,
      tool_calls: [],
      parsed: validateProviderEvidencePayload(provider, parsed)
    };
  } catch (error) {
    requestAbort.cleanup();

    if (error?.name === "AbortError") {
      throw new ProviderError("OpenAI single-provider request timed out.", {
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
