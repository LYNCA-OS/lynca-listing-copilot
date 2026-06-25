import assert from "node:assert/strict";
import { visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { normalizeProviderUsage } from "../lib/listing/providers/provider-usage.mjs";

const openAiUsage = normalizeProviderUsage({
  provider: visionProviderIds.OPENAI_LEGACY,
  modelId: "gpt-4.1-mini",
  rawUsage: {
    input_tokens: 2_000_000,
    output_tokens: 100_000
  },
  latencyMs: 999.2,
  imageCount: 1,
  providerCalls: 2,
  env: {
    OPENAI_LISTING_INPUT_TOKEN_COST_PER_1M: "0.4",
    OPENAI_LISTING_OUTPUT_TOKEN_COST_PER_1M: "1.6",
    OPENAI_LISTING_IMAGE_COST_USD: "0.02"
  }
});
assert.equal(openAiUsage.provider_calls, 2);
assert.equal(openAiUsage.input_tokens, 2_000_000);
assert.equal(openAiUsage.output_tokens, 100_000);
assert.equal(openAiUsage.prompt_tokens, null);
assert.equal(openAiUsage.completion_tokens, null);
assert.equal(openAiUsage.total_tokens, 2_100_000);
assert.equal(openAiUsage.estimated_cost_usd, 0.98);

const geminiUsage = normalizeProviderUsage({
  provider: visionProviderIds.GEMINI,
  modelId: "gemini-3.1-flash-lite",
  rawUsage: {
    total_input_tokens: 1_500_000,
    total_output_tokens: 250_000,
    total_tokens: 1_750_000
  },
  latencyMs: 2500.7,
  imageCount: 2,
  providerCalls: 1,
  env: {
    GEMINI_INPUT_TOKEN_COST_PER_1M: "0.1",
    GEMINI_OUTPUT_TOKEN_COST_PER_1M: "0.4",
    GEMINI_IMAGE_COST_USD: "0.002"
  }
});
assert.equal(geminiUsage.provider_calls, 1);
assert.equal(geminiUsage.latency_ms, 2500);
assert.equal(geminiUsage.input_tokens, 1_500_000);
assert.equal(geminiUsage.output_tokens, 250_000);
assert.equal(geminiUsage.prompt_tokens, 1_500_000);
assert.equal(geminiUsage.completion_tokens, 250_000);
assert.equal(geminiUsage.total_tokens, 1_750_000);
assert.equal(geminiUsage.image_count, 2);
assert.equal(geminiUsage.cost_configured, true);
assert.equal(geminiUsage.estimated_cost_usd, 0.254);

const unpricedUsage = normalizeProviderUsage({
  provider: "unknown_provider",
  modelId: "unknown",
  rawUsage: null,
  latencyMs: -10,
  imageCount: -1,
  providerCalls: 0,
  env: {}
});
assert.equal(unpricedUsage.provider_calls, 0);
assert.equal(unpricedUsage.latency_ms, 0);
assert.equal(unpricedUsage.image_count, 0);
assert.equal(unpricedUsage.total_tokens, null);
assert.equal(unpricedUsage.cost_configured, false);
assert.equal(unpricedUsage.estimated_cost_usd, 0);

assert.equal(JSON.stringify(openAiUsage).includes("sk-"), false);
assert.equal(JSON.stringify(geminiUsage).includes("AIza"), false);

console.log("provider usage tests passed");
