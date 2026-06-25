import { visionProviderIds } from "./provider-contract.mjs";

const costEnvKeys = Object.freeze({
  [visionProviderIds.GEMINI]: {
    input: ["GEMINI_INPUT_TOKEN_COST_PER_1M"],
    output: ["GEMINI_OUTPUT_TOKEN_COST_PER_1M"],
    image: ["GEMINI_IMAGE_COST_USD"]
  },
  [visionProviderIds.OPENAI_LEGACY]: {
    input: ["OPENAI_LISTING_INPUT_TOKEN_COST_PER_1M", "OPENAI_INPUT_TOKEN_COST_PER_1M"],
    output: ["OPENAI_LISTING_OUTPUT_TOKEN_COST_PER_1M", "OPENAI_OUTPUT_TOKEN_COST_PER_1M"],
    image: ["OPENAI_LISTING_IMAGE_COST_USD", "OPENAI_IMAGE_COST_USD"]
  }
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value, fallback = 0) {
  const number = finiteNumber(value);
  return number === null ? fallback : Math.max(0, number);
}

function usageNumber(rawUsage = {}, keys = []) {
  for (const key of keys) {
    const number = finiteNumber(rawUsage?.[key]);
    if (number !== null) return Math.max(0, number);
  }
  return null;
}

function firstEnvNumber(env = {}, keys = []) {
  for (const key of keys) {
    const number = finiteNumber(env[key]);
    if (number !== null && number >= 0) return number;
  }
  return null;
}

function estimateCostUsd({
  provider,
  inputTokens = 0,
  outputTokens = 0,
  imageCount = 0,
  env = process.env
} = {}) {
  const keys = costEnvKeys[provider] || {};
  const inputRate = firstEnvNumber(env, keys.input || []);
  const outputRate = firstEnvNumber(env, keys.output || []);
  const imageRate = firstEnvNumber(env, keys.image || []);
  const tokenCost = ((inputRate || 0) * inputTokens / 1_000_000)
    + ((outputRate || 0) * outputTokens / 1_000_000);
  const imageCost = (imageRate || 0) * imageCount;

  return {
    estimated_cost_usd: Number((tokenCost + imageCost).toFixed(6)),
    cost_configured: inputRate !== null || outputRate !== null || imageRate !== null
  };
}

export function normalizeProviderUsage({
  provider,
  modelId = null,
  rawUsage = null,
  latencyMs = 0,
  imageCount = 0,
  providerCalls = 1,
  env = process.env
} = {}) {
  const usage = rawUsage && typeof rawUsage === "object" && !Array.isArray(rawUsage)
    ? rawUsage
    : {};
  const inputTokens = usageNumber(usage, ["input_tokens", "prompt_tokens", "total_input_tokens"]);
  const outputTokens = usageNumber(usage, ["output_tokens", "completion_tokens", "total_output_tokens"]);
  const totalTokens = usageNumber(usage, ["total_tokens"]);
  const resolvedInputTokens = inputTokens || 0;
  const resolvedOutputTokens = outputTokens || 0;
  const resolvedTotalTokens = totalTokens ?? (inputTokens !== null || outputTokens !== null
    ? resolvedInputTokens + resolvedOutputTokens
    : null);
  const resolvedImageCount = Math.trunc(nonNegativeNumber(imageCount, 0));
  const cost = estimateCostUsd({
    provider,
    inputTokens: resolvedInputTokens,
    outputTokens: resolvedOutputTokens,
    imageCount: resolvedImageCount,
    env
  });

  return {
    provider_calls: Math.max(0, Math.trunc(nonNegativeNumber(providerCalls, 1))),
    retrieval_calls: 0,
    latency_ms: Math.trunc(nonNegativeNumber(latencyMs, 0)),
    estimated_cost_usd: cost.estimated_cost_usd,
    cost_configured: cost.cost_configured,
    model_id: modelId || null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    prompt_tokens: usageNumber(usage, ["prompt_tokens", "total_input_tokens"]),
    completion_tokens: usageNumber(usage, ["completion_tokens", "total_output_tokens"]),
    total_tokens: resolvedTotalTokens,
    image_count: resolvedImageCount
  };
}
