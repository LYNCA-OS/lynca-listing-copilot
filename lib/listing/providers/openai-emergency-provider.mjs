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
import { orderedOpenAiApiKeySelections, selectOpenAiApiKey } from "./openai-key-pool.mjs";
import {
  logOpenAiProviderRequestDiagnostics,
  openAiProviderRequestDiagnostics,
  openAiRateLimitDiagnostics
} from "./openai-request-diagnostics.mjs";
import {
  isGpt5ResponsesModel,
  openAiResponsesModelControls,
  openAiResponsesTextOptions
} from "./openai-responses-request.mjs";

const provider = visionProviderIds.OPENAI_LEGACY;
const endpoint = "https://api.openai.com/v1/responses";
const gpt5MaxOutputTokenCap = 128000;
const gpt41MaxOutputTokenCap = 32768;
const defaultOpenAiMaxOutputTokens = 4096000;
const defaultOpenAiTruncationRetryMaxOutputTokens = 8192000;
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
  "language",
  "players",
  "card_name",
  "team",
  "card_type",
  "official_card_type",
  "observable_components",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "numerical_rarity",
  "card_number",
  "tcg_card_number",
  "collector_number",
  "checklist_code",
  "attributes",
  "grade_company",
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
  "jersey",
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
  "jersey",
  "sketch",
  "redemption",
  "one_of_one"
]);

function openAiScalarFieldSchema(fieldName) {
  if (openAiBooleanFieldNames.has(fieldName)) return { type: ["boolean", "null"] };
  if (fieldName === "card_count") return { type: ["number", "null"] };
  if (fieldName === "players" || fieldName === "attributes" || fieldName === "observable_components") {
    return {
      type: "array",
      items: fieldName === "observable_components"
        ? { type: "string", enum: ["auto", "patch", "relic", "jersey", "rc", "sketch", "redemption", ""] }
        : { type: "string" }
    };
  }
  return { type: ["string", "null"] };
}

export function openAiProviderResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      recognition_status: { type: "string", enum: ["CONFIRMED", "RESOLVED", "ABSTAIN"] },
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
      },
      vector_candidate_decision: {
        type: "object",
        additionalProperties: false,
        properties: {
          selected_candidate_id: { type: ["string", "null"] },
          decision: {
            type: "string",
            enum: ["SELECTED", "PARTIAL_SUPPORT", "REJECTED_ALL", "NOT_AVAILABLE"]
          },
          supported_fields: {
            type: "array",
            items: { type: "string" }
          },
          rejected_fields: {
            type: "array",
            items: { type: "string" }
          },
          conflicts: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: [
          "selected_candidate_id",
          "decision",
          "supported_fields",
          "rejected_fields",
          "conflicts"
        ]
      }
    },
    required: ["recognition_status", "fields", "field_evidence", "unresolved", "vector_candidate_decision"]
  };
}

function numberFromEnv(env, key, fallback = undefined) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function positiveNumberFromEnv(env, key, fallback = undefined) {
  const value = numberFromEnv(env, key, fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function modelMaxOutputTokenCap(modelId = "", env = process.env) {
  if (isGpt5ResponsesModel(modelId)) return gpt5MaxOutputTokenCap;
  if (/^gpt-4\.1(?:$|-)/i.test(String(modelId || "").trim())) {
    return positiveNumberFromEnv(env, "OPENAI_GPT41_MAX_OUTPUT_TOKEN_CAP", gpt41MaxOutputTokenCap);
  }
  return positiveNumberFromEnv(env, "OPENAI_LISTING_MAX_OUTPUT_TOKEN_CAP", defaultOpenAiMaxOutputTokens);
}

function effectiveOutputTokens(requested, cap) {
  const requestedNumber = Number(requested);
  const capNumber = Number(cap);
  if (!Number.isFinite(requestedNumber) || requestedNumber <= 0) return capNumber;
  if (!Number.isFinite(capNumber) || capNumber <= 0) return requestedNumber;
  return Math.min(requestedNumber, capNumber);
}

export function openAiEmergencyConfigFromEnv(env = process.env, { shardKey = "", modelOverride = "" } = {}) {
  const model = providerModelConfig(provider, modelOverride || env.OPENAI_LISTING_MODEL);
  const keySelection = selectOpenAiApiKey({ env, shardKey });
  const keySelections = orderedOpenAiApiKeySelections({ env, shardKey });
  const modelId = model.model_id || defaultProviderModels[provider];
  const isGpt5 = isGpt5ResponsesModel(modelId);
  const outputTokenCap = modelMaxOutputTokenCap(modelId, env);
  const defaultMaxOutputTokens = positiveNumberFromEnv(env, "OPENAI_LISTING_MAX_OUTPUT_TOKENS", defaultOpenAiMaxOutputTokens);
  const defaultTruncationRetryMaxOutputTokens = positiveNumberFromEnv(env, "OPENAI_LISTING_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS", defaultOpenAiTruncationRetryMaxOutputTokens);
  const gpt5MaxOutputTokens = positiveNumberFromEnv(
    env,
    "OPENAI_GPT5_MAX_OUTPUT_TOKENS",
    Math.max(8192000, defaultMaxOutputTokens)
  );
  const gpt5TruncationRetryMaxOutputTokens = positiveNumberFromEnv(
    env,
    "OPENAI_GPT5_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS",
    Math.max(12800000, gpt5MaxOutputTokens, defaultTruncationRetryMaxOutputTokens)
  );
  const requestedMaxOutputTokens = isGpt5 ? gpt5MaxOutputTokens : defaultMaxOutputTokens;
  const requestedTruncationRetryMaxOutputTokens = isGpt5 ? gpt5TruncationRetryMaxOutputTokens : defaultTruncationRetryMaxOutputTokens;

  return {
    apiKey: keySelection.apiKey,
    keySlot: keySelection.keySlot,
    keyPoolSize: keySelection.poolSize,
    keySource: keySelection.source,
    keySelections,
    model: modelId,
    modelAllowed: model.allowed,
    timeoutMs: numberFromEnv(env, "OPENAI_LISTING_TIMEOUT_MS", 75000),
    outputTokenCap,
    requestedMaxOutputTokens,
    requestedTruncationRetryMaxOutputTokens,
    maxOutputTokens: effectiveOutputTokens(requestedMaxOutputTokens, outputTokenCap),
    truncationRetryMaxOutputTokens: effectiveOutputTokens(requestedTruncationRetryMaxOutputTokens, outputTokenCap),
    transientRetries: Math.max(0, Math.trunc(numberFromEnv(env, "OPENAI_LISTING_TRANSIENT_RETRIES", 1))),
    transientRetryDelayMs: Math.max(0, Math.trunc(numberFromEnv(env, "OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS", 600)))
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

function openAiModelProfilePrompt(model = "") {
  if (!isGpt5ResponsesModel(model)) return "";
  return [
    "",
    "GPT-5 mini main-path extraction profile:",
    "This is a production primary path, not an experimental fallback. Be concise, but do not compress away identity facts.",
    "Match the GPT-4.1-mini production extraction contract: same fields, same evidence discipline, same abstention rules, and same renderer expectations.",
    "Prioritize literal extraction over summarization. The final title is rendered by code, so spend output only on fields and short evidence.",
    "Never leave product, set, players, card_name, print_run_number, collector/card code, or slab grade empty when the uploaded card/slab visibly shows them.",
    "If a slab label or card text line contains both product identity and a card code, keep both; do not choose one at the expense of the other.",
    "If visible text contains a limited-numbering value like 12/25, 02/10, 20/99, 1/1, or #/50, fill print_run_number, print_run_numerator when visible, print_run_denominator, numbered_to, and serial_number compatibility fields.",
    "If a slab label contains PSA/BGS/SGC/CGC plus a card grade and a separate AUTO/AUTOGRAPH grade, fill grade_company, card_grade, auto_grade, and grade_type. Do not output grade_company alone.",
    "Card-name discipline: card_name must not include the subject/player name. If text reads 'Yamamoto Patch Auto', output players ['Yoshinobu Yamamoto'] and card_name 'Patch Auto'.",
    "Code discipline: code-like shorthand such as BWM, PROS, MEGA, AU-BLACK, SIG-GOLD, PAU, NB-TYG, RA-PM, or #83T-6 is evidence for collector_number/checklist_code/card_number or short card-name components, not product/set prose. Do not leak raw internal shorthand into product or card_name when a human-readable title phrase is available.",
    "English output discipline: normalize common country/team words into English marketplace spelling, e.g. Brazil not Brasil.",
    "Do not use unresolved or ABSTAIN because one optional field is uncertain. Use unresolved only for that field while preserving all visible safe fields.",
    "Keep odd but printed card names/codes literally when readable: Downtown, College Ticket, Dynastic Deed, Survivor Series Autographs, 1983 Topps, #83T-6, PAU, NB-TYG, RA-PM."
  ].join("\n");
}

function openAiStrictSchemaPrompt(prompt = "", {
  model = ""
} = {}) {
  return [
    prompt,
    openAiModelProfilePrompt(model),
    "",
    "OpenAI strict response schema note:",
    "Apply the same extraction semantics for every OpenAI model. GPT-5 mini is a production main path and must not use a looser or more compressed schema than GPT-4.1 mini.",
    "Return field_evidence as an array, not an object. Each entry must include field, value, source_type, source_image_id, source_region, raw_text, visible_text, evidence_kind, confidence, review_required, directly_observed, and direct_observation.",
    "Return only recognition_status, fields, field_evidence, unresolved, and vector_candidate_decision. Do not return title, model_title_suggestion, route, or reason.",
    "Use canonical fields only: players not player, collector_number/checklist_code not card_number, card_grade not grade.",
    "Year discipline: put the issued product/season year in year only when it is printed on the slab/card/product line or otherwise directly tied to the card identity. Do not use stats/context sentences such as 'in 2024/25' or copyright-only text as the product year. Preserve season strings like 2025-26; do not collapse them to 2025 or 2026.",
    "Set/insert discipline: named identity text such as Gusto, All Kings, Club Legends, Canvas Creations, Rookie Ticket, First Day Issue, Metallic Marks, Historic Ties, Next Stop Signatures, and similar printed/slab text must be captured in set or insert. If product repeats brand, still return the visible set/insert instead of leaving it empty.",
    "Leave official_card_type empty unless printed/slab/catalog wording supports it. Put only visible components in observable_components: auto, patch, relic, jersey, rc, sketch, redemption.",
    "Autograph discipline: if a signature, autograph sticker, certified autograph wording, Signatures insert, Rookie Ticket Auto, or slab autograph wording is visible, set auto true and include auto in observable_components. Still keep the official insert name separately in insert.",
    "Card name discipline: printed named card titles such as Best Performance, Club Legends, Gusto, Power Partnership, Canvas Creations, Rookie Ticket, Next Stop Signatures, and similar uploaded-image identity text should be returned in card_name when it is the literal card name; use insert for formal insert/set identity when appropriate.",
    "Card name must not repeat the subject/player. Remove player names from card_name while preserving the actual card-name component such as Patch Auto, Spotlight Signatures, Rookie Ticket, or Dynastic Deed.",
    "Do not output raw catalog shorthand as card_name/product text when it is only a code. Put code-like values in collector_number/checklist_code/card_number and keep product/card_name human-readable.",
    "Grade discipline: fill grade_company and card_grade from slab label only. Fill auto_grade only when a separate autograph grade is visibly printed; never copy card_grade into auto_grade as a scaffold value.",
    "Use surface_color for visual Gold/Purple/Red/Blue/Green/Silver/Black/Orange. Do not infer exact optical parallels such as Gold Refractor, Wave, Shimmer, Mojo, Prizm, Sparkle, or Holo from appearance alone.",
    "Use empty strings, null confidence, and false booleans for unknown evidence scaffold values. Do not invent identity values to fill the schema.",
    "If no vector candidates were provided, set vector_candidate_decision.decision to NOT_AVAILABLE with null selected_candidate_id and empty arrays."
  ].join("\n");
}

function outputTokenCount(usage = {}) {
  const value = Number(usage?.output_tokens ?? usage?.completion_tokens ?? usage?.total_output_tokens);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function totalTokenCount(usage = {}) {
  const value = Number(usage?.total_tokens);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function openAiResponseDiagnostics(data = {}, outputCap = 0, {
  requestedOutputCap = outputCap,
  modelOutputTokenCap = outputCap
} = {}) {
  const usage = data.usage || {};
  const outputTokens = outputTokenCount(usage);
  const cap = Number(outputCap);
  const requestedCap = Number(requestedOutputCap);
  const modelCap = Number(modelOutputTokenCap);
  return {
    input_tokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.total_input_tokens ?? 0) || 0,
    output_tokens: outputTokens ?? 0,
    total_tokens: totalTokenCount(usage) ?? null,
    response_status: String(data.status || "").trim(),
    incomplete_reason: String(data.incomplete_details?.reason || data.incomplete_reason || "").trim(),
    requested_output_cap: Number.isFinite(requestedCap) && requestedCap > 0 ? requestedCap : null,
    model_output_token_cap: Number.isFinite(modelCap) && modelCap > 0 ? modelCap : null,
    output_cap: Number.isFinite(cap) && cap > 0 ? cap : null,
    output_cap_clamped: Number.isFinite(requestedCap) && Number.isFinite(cap) && requestedCap > cap,
    output_utilization: outputTokens !== null && Number.isFinite(cap) && cap > 0
      ? Number((outputTokens / cap).toFixed(6))
      : null
  };
}

function incompleteReasonIsTokenLimit(reason = "") {
  return /max[_\s-]*output[_\s-]*tokens?|token[_\s-]*limit|length/i.test(String(reason || ""));
}

function responseLooksTokenTruncated(data = {}, text = "", outputCap = 0) {
  const diagnostics = openAiResponseDiagnostics(data, outputCap);
  if (!/incomplete/i.test(diagnostics.response_status)) return false;
  if (incompleteReasonIsTokenLimit(diagnostics.incomplete_reason)) return true;
  const utilization = Number(diagnostics.output_utilization);
  if (Number.isFinite(utilization) && utilization >= 0.98) return true;
  const outputTokens = Number(diagnostics.output_tokens);
  const cap = Number(diagnostics.output_cap);
  return Number.isFinite(outputTokens) && Number.isFinite(cap) && cap > 0 && outputTokens >= cap;
}

function providerErrorAllowsKeyRotation(error) {
  if (!(error instanceof ProviderError) || error.retryable !== true) return false;
  return ["rate_limited", "upstream_error", "timeout", "network_error"].includes(error.code);
}

function sumNullableNumbers(values = []) {
  let seen = false;
  const total = values.reduce((sum, value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return sum;
    seen = true;
    return sum + number;
  }, 0);
  return seen ? total : null;
}

function mergeOpenAiUsages(usages = []) {
  const valid = usages.filter(Boolean);
  if (!valid.length) return null;
  return {
    ...valid[0],
    provider_calls: valid.reduce((sum, usage) => sum + Number(usage.provider_calls || 0), 0),
    retrieval_calls: valid.reduce((sum, usage) => sum + Number(usage.retrieval_calls || 0), 0),
    latency_ms: valid.reduce((sum, usage) => sum + Number(usage.latency_ms || 0), 0),
    estimated_cost_usd: Number(valid.reduce((sum, usage) => sum + Number(usage.estimated_cost_usd || 0), 0).toFixed(6)),
    cost_configured: valid.some((usage) => usage.cost_configured === true),
    input_tokens: sumNullableNumbers(valid.map((usage) => usage.input_tokens)),
    output_tokens: sumNullableNumbers(valid.map((usage) => usage.output_tokens)),
    prompt_tokens: sumNullableNumbers(valid.map((usage) => usage.prompt_tokens)),
    completion_tokens: sumNullableNumbers(valid.map((usage) => usage.completion_tokens)),
    total_tokens: sumNullableNumbers(valid.map((usage) => usage.total_tokens)),
    image_count: valid.reduce((sum, usage) => sum + Number(usage.image_count || 0), 0)
  };
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

function delay(ms = 0) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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
  shardKey = "",
  env = process.env,
  signal = null,
  fetchImpl = globalThis.fetch,
  modelOverride = "",
  requestContext = {}
}) {
  const config = openAiEmergencyConfigFromEnv(env, { shardKey, modelOverride });
  if (!config.apiKey) {
    throw providerUnavailable(provider, "OPENAI_API_KEY is not configured.");
  }

  if (!config.modelAllowed) {
    throw providerUnavailable(provider, "OPENAI_LISTING_MODEL/model override is not in the provider model whitelist.");
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
    let transientRetryAttempts = 0;
    let providerRequestCount = 0;
    let keyRotationAttempts = 0;
    const keySelections = Array.isArray(config.keySelections) && config.keySelections.length
      ? config.keySelections
      : [{
        apiKey: config.apiKey,
        keySlot: config.keySlot,
        poolSize: config.keyPoolSize,
        source: config.keySource
      }];
    let keyCursor = 0;

    const activeKeySelection = () => keySelections[keyCursor] || keySelections[0] || {};
    const rotateOpenAiKey = () => {
      if (keyCursor + 1 >= keySelections.length) return false;
      keyCursor += 1;
      keyRotationAttempts += 1;
      return true;
    };

    const callOpenAi = async (maxOutputTokens, requestedOutputTokens = maxOutputTokens) => {
      providerRequestCount += 1;
      const attempt = providerRequestCount;
      const requestStartedAt = Date.now();
      const keySelection = activeKeySelection();
      let response;
      try {
        response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${keySelection.apiKey}`,
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
                text: openAiStrictSchemaPrompt(prompt, { model: config.model })
              },
              ...validateOpenAiImages(images)
            ]
          }
        ],
        max_output_tokens: maxOutputTokens,
        ...openAiResponsesModelControls(config.model, { env }),
        text: openAiResponsesTextOptions({
          model: config.model,
          name: "listing_provider_evidence",
          strict: true,
          schema: openAiProviderResponseSchema(),
          env
        })
      }),
      signal: requestAbort.signal
    });
      } catch (error) {
        const requestLatencyMs = Date.now() - requestStartedAt;
        if (error?.name === "AbortError") throw error;
        logOpenAiProviderRequestDiagnostics({
          provider,
          modelId: config.model,
          phase: "listing_full_provider",
          attempt,
          responseStatus: "network_error",
          tokenDiagnostics: { input_tokens: null, output_tokens: null },
          rateLimitDiagnostics: {},
          providerLatencyMs: requestLatencyMs,
          keyPoolSize: keySelection.poolSize ?? config.keyPoolSize,
          keySlot: keySelection.keySlot ?? config.keySlot,
          requestContext
        });
        throw new ProviderError(safeProviderErrorMessage(error), {
          provider,
          code: "network_error",
          retryable: true,
          details: {
            provider_key_pool_size: keySelection.poolSize ?? config.keyPoolSize,
            provider_key_slot: keySelection.keySlot ?? config.keySlot
          }
        });
      }
      const requestLatencyMs = Date.now() - requestStartedAt;
      const rateLimitDiagnostics = openAiRateLimitDiagnostics(response.headers);

      if (!response.ok) {
        logOpenAiProviderRequestDiagnostics({
          provider,
          modelId: config.model,
          phase: "listing_full_provider",
          attempt,
          responseStatus: `http_${response.status}`,
          tokenDiagnostics: { input_tokens: null, output_tokens: null },
          rateLimitDiagnostics,
          providerLatencyMs: requestLatencyMs,
          keyPoolSize: keySelection.poolSize ?? config.keyPoolSize,
          keySlot: keySelection.keySlot ?? config.keySlot,
          requestContext
        });
        const message = await response.text();
        const httpError = providerHttpError(provider, response.status, message.slice(0, 180));
        httpError.details = {
          ...(httpError.details || {}),
          provider_key_pool_size: keySelection.poolSize ?? config.keyPoolSize,
          provider_key_slot: keySelection.keySlot ?? config.keySlot,
          rate_limit_diagnostics: rateLimitDiagnostics
        };
        throw httpError;
      }

      const data = await response.json();
      const text = parseResponsesText(data);
      const diagnostics = openAiResponseDiagnostics(data, maxOutputTokens, {
        requestedOutputCap: requestedOutputTokens,
        modelOutputTokenCap: config.outputTokenCap
      });
      const requestDiagnostics = openAiProviderRequestDiagnostics({
        provider,
        modelId: data.model || config.model,
        phase: "listing_full_provider",
        attempt,
        responseStatus: diagnostics.response_status || "ok",
        tokenDiagnostics: diagnostics,
        rateLimitDiagnostics,
        providerLatencyMs: requestLatencyMs,
        keyPoolSize: keySelection.poolSize ?? config.keyPoolSize,
        keySlot: keySelection.keySlot ?? config.keySlot,
        requestContext
      });
      logOpenAiProviderRequestDiagnostics(requestDiagnostics);
      return {
        data,
        text,
        diagnostics,
        rate_limit_diagnostics: rateLimitDiagnostics,
        request_diagnostics: requestDiagnostics,
        truncated: responseLooksTokenTruncated(data, text, maxOutputTokens)
      };
    };

    const callOpenAiWithTransientRetry = async (maxOutputTokens, requestedOutputTokens = maxOutputTokens) => {
      let attempt = 0;
      for (;;) {
        try {
          return await callOpenAi(maxOutputTokens, requestedOutputTokens);
        } catch (error) {
          if (providerErrorAllowsKeyRotation(error) && rotateOpenAiKey()) {
            transientRetryAttempts += 1;
            continue;
          }
          if (!(error instanceof ProviderError) || error.retryable !== true || attempt >= config.transientRetries) {
            throw error;
          }
          attempt += 1;
          transientRetryAttempts += 1;
          await delay(config.transientRetryDelayMs);
        }
      }
    };

    const initial = await callOpenAiWithTransientRetry(config.maxOutputTokens, config.requestedMaxOutputTokens);
    const usages = [
      normalizeProviderUsage({
        provider,
        modelId: initial.data.model || config.model,
        rawUsage: initial.data.usage,
        latencyMs: Date.now() - startedAt,
        imageCount: images.length,
        env
      })
    ];
    let active = initial;
    let truncationRetryAttempted = false;
    let truncationRetryAttempts = 0;

    if (initial.truncated) {
      const retryCap = Math.max(Number(config.truncationRetryMaxOutputTokens || 0), Number(config.maxOutputTokens || 0));
      if (retryCap <= Number(config.maxOutputTokens || 0)) {
        throw new ProviderError("OpenAI response was truncated at the configured output cap.", {
          provider,
          code: "response_truncated",
          retryable: false,
          details: {
            token_diagnostics: initial.diagnostics,
            rate_limit_diagnostics: initial.rate_limit_diagnostics,
            truncation_retry_attempted: false,
            truncation_retry_attempts: 0
          }
        });
      }
      truncationRetryAttempted = true;
      truncationRetryAttempts = 1;
      const retryStartedAt = Date.now();
      active = await callOpenAiWithTransientRetry(retryCap, config.requestedTruncationRetryMaxOutputTokens);
      usages.push(normalizeProviderUsage({
        provider,
        modelId: active.data.model || config.model,
        rawUsage: active.data.usage,
        latencyMs: Date.now() - retryStartedAt,
        imageCount: images.length,
        env
      }));
      if (active.truncated) {
        throw new ProviderError("OpenAI response was still truncated after one higher-cap retry.", {
          provider,
          code: "response_truncated",
          retryable: false,
          details: {
            token_diagnostics: active.diagnostics,
            initial_token_diagnostics: initial.diagnostics,
            rate_limit_diagnostics: active.rate_limit_diagnostics,
            initial_rate_limit_diagnostics: initial.rate_limit_diagnostics,
            truncation_retry_attempted: true,
            truncation_retry_attempts: truncationRetryAttempts
          }
        });
      }
    }

    requestAbort.cleanup();

    const data = active.data;
    const text = active.text;
    if (responseLooksTokenTruncated(data, text, active.diagnostics.output_cap)) {
      throw new ProviderError("OpenAI response looked truncated before JSON parsing.", {
        provider,
        code: "response_truncated",
        retryable: false,
        details: {
          token_diagnostics: active.diagnostics,
          initial_token_diagnostics: truncationRetryAttempted ? initial.diagnostics : null,
          rate_limit_diagnostics: active.rate_limit_diagnostics,
          initial_rate_limit_diagnostics: truncationRetryAttempted ? initial.rate_limit_diagnostics : null,
          truncation_retry_attempted: truncationRetryAttempted,
          truncation_retry_attempts: truncationRetryAttempts
        }
      });
    }
    const parsedMessage = parseOpenAiProviderPayload(text);
    const { parsed, parse_source } = parsedMessage;
    const latencyMs = Date.now() - startedAt;
    const modelId = data.model || config.model;

    return {
      provider,
      model_id: modelId,
      provider_key_pool_size: activeKeySelection().poolSize ?? config.keyPoolSize,
      provider_key_slot: activeKeySelection().keySlot ?? config.keySlot,
      provider_key_source: activeKeySelection().source ?? config.keySource,
      provider_key_rotation_attempted: keyRotationAttempts > 0,
      provider_key_rotation_attempts: keyRotationAttempts,
      response_id: data.id || null,
      finish_reason: active.diagnostics.response_status || null,
      usage: mergeOpenAiUsages(usages),
      latency_ms: latencyMs,
      parse_source,
      format_error_type: parsedMessage.format_error_type,
      format_repair_attempted: parsedMessage.format_repair_attempted,
      local_json_repair_success: parsedMessage.local_json_repair_success,
      text_repair_success: false,
      native_schema_valid: parsedMessage.native_schema_valid,
      token_diagnostics: active.diagnostics,
      initial_token_diagnostics: truncationRetryAttempted ? initial.diagnostics : null,
      rate_limit_diagnostics: active.rate_limit_diagnostics,
      initial_rate_limit_diagnostics: truncationRetryAttempted ? initial.rate_limit_diagnostics : null,
      provider_request_diagnostics: active.request_diagnostics || null,
      provider_initial_request_diagnostics: truncationRetryAttempted ? initial.request_diagnostics : null,
      transient_retry_attempted: transientRetryAttempts > 0,
      transient_retry_attempts: transientRetryAttempts,
      truncation_retry_attempted: truncationRetryAttempted,
      truncation_retry_attempts: truncationRetryAttempts,
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
