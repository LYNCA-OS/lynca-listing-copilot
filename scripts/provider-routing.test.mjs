import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../lib/listing/providers/openai-emergency-provider.mjs";
import {
  clearProviderConcurrencyForTests,
  providerServerConcurrencyLimit,
  runWithProviderConcurrency
} from "../lib/listing/providers/provider-concurrency.mjs";
import { parseProviderMessagePayload } from "../lib/listing/providers/provider-response-normalizer.mjs";
import { listAvailableVisionProviders, selectVisionProvider } from "../lib/listing/providers/provider-registry.mjs";

const providerRegistrySource = await readFile("lib/listing/providers/provider-registry.mjs", "utf8");
const providerContractSource = await readFile("lib/listing/providers/provider-contract.mjs", "utf8");
const titleApiSource = await readFile("api/listing-copilot-title.js", "utf8");

assert.doesNotMatch(providerRegistrySource, /cascade_fast|ENABLE_AGNES|AGNES/i, "provider registry must not expose Agnes or cascade providers");
assert.doesNotMatch(providerContractSource, /cascade_fast|AGNES/i, "provider contract must only keep active providers");
assert.doesNotMatch(titleApiSource, /createAgnesTitle|createCascadeFastTitle|analyzeCardEvidenceWithAgnes|model_to_model/i, "title API must not retain automatic mixed-model provider paths");

const remoteImages = [{ url: "https://example.com/front.jpg" }];
const dataUrlImages = [{ dataUrl: "data:image/jpeg;base64,AAAA" }];
const storedImages = [{ objectPath: "listing-assets/2026-06-22/asset/front_original-image.jpg" }];

const env = {
  DEFAULT_VISION_PROVIDER: "",
  ENABLE_GPT41_EMERGENCY_PROVIDER: "true",
  ALLOW_EXPLICIT_GPT41_RETRY: "true",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_LISTING_MODEL: "gpt-4.1-mini-2025-04-14"
};

assert.equal(selectVisionProvider({ images: remoteImages, env }).provider_id, "openai_legacy");
assert.equal(selectVisionProvider({ images: storedImages, env }).provider_id, "openai_legacy");
assert.equal(selectVisionProvider({ images: dataUrlImages, env }).provider_id, "openai_legacy");

assert.throws(
  () => selectVisionProvider({ requestedProvider: "cascade_fast", images: remoteImages, env }),
  /Unknown vision provider/i
);
assert.throws(
  () => selectVisionProvider({ requestedProvider: "agnes", images: remoteImages, env }),
  /Unknown vision provider/i
);

assert.equal(selectVisionProvider({
  requestedProvider: "openai_legacy",
  explicitEmergency: false,
  images: dataUrlImages,
  env
}).provider_id, "openai_legacy", "GPT is now the production primary provider and should not require emergency mode");

const emergencySelection = selectVisionProvider({
  requestedProvider: "openai_legacy",
  explicitEmergency: true,
  images: dataUrlImages,
  env
});
assert.equal(emergencySelection.provider_id, "openai_legacy");
assert.equal(emergencySelection.model_id, "gpt-4.1-mini-2025-04-14");
assert.equal(emergencySelection.provider.role, "primary");

assert.equal(selectVisionProvider({
  images: dataUrlImages,
  env: {
    ...env,
    DEFAULT_VISION_PROVIDER: "openai_legacy"
  }
}).provider_id, "openai_legacy", "OpenAI should be usable as the production env default");

assert.throws(
  () => selectVisionProvider({
    requestedProvider: "removed_provider",
    images: remoteImages,
    env
  }),
  /Unknown vision provider/i
);
assert.throws(
  () => selectVisionProvider({
    requestedProvider: "openai_legacy",
    explicitEmergency: true,
    images: dataUrlImages,
    env: {
      ...env,
      OPENAI_LISTING_MODEL: "gpt-5"
    }
  }),
  /model_not_allowed/i
);

assert.deepEqual(listAvailableVisionProviders(env).map((provider) => provider.id), ["openai_legacy"]);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ENABLE_EXPERIMENTAL_PROVIDER_UI: "true"
}).map((provider) => provider.id), ["openai_legacy"]);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ENABLE_GPT41_EMERGENCY_PROVIDER: "false"
}).map((provider) => provider.id), []);
assert.deepEqual(listAvailableVisionProviders({
  ...env,
  ALLOW_EXPLICIT_GPT41_RETRY: "false"
}).map((provider) => provider.id), ["openai_legacy"]);

const parsedContent = parseProviderMessagePayload({
  content: "```json\n{\"title\":\"Test\",\"fields\":{\"player\":\"A\"},\"unresolved\":[]}\n```"
});
assert.equal(parsedContent.parse_source, "content");
assert.equal(parsedContent.parsed.fields.player, "A");

const parsedTool = parseProviderMessagePayload({
  tool_calls: [
    {
      type: "function",
      function: {
        name: "submit_card_evidence",
        arguments: "{\"evidence\":{\"player\":{\"value\":\"B\"}},\"unresolved\":[]}"
      }
    }
  ]
});
assert.equal(parsedTool.parse_source, "tool_call");
assert.equal(parsedTool.parsed.evidence.player.value, "B");

let openAiRequest;
const openAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env,
  fetchImpl: async (url, init) => {
    openAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_test",
        output_text: "{\"title\":\"OpenAI Test\",\"fields\":{\"player\":\"Emergency\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 11,
          output_tokens: 9,
          total_tokens: 20
        }
      })
    };
  }
});

assert.equal(openAiRequest.url, "https://api.openai.com/v1/responses");
assert.equal(openAiRequest.init.headers.authorization, "Bearer test-openai-key");
const openAiBody = JSON.parse(openAiRequest.init.body);
assert.equal(openAiBody.model, "gpt-4.1-mini-2025-04-14");
assert.equal(openAiBody.text.format.type, "json_schema");
assert.equal(openAiBody.text.format.strict, true);
assert.equal(openAiBody.input[0].content[1].type, "input_image");
assert.equal(openAiResult.parsed.fields.player, "Emergency");
assert.equal(openAiResult.usage.provider_calls, 1);
assert.equal(openAiResult.usage.input_tokens, 11);
assert.equal(openAiResult.usage.output_tokens, 9);
assert.equal(openAiResult.usage.total_tokens, 20);
assert.equal(openAiResult.usage.image_count, 1);

let invalidOpenAiModelFetchCalled = false;
await assert.rejects(
  analyzeCardEvidenceWithOpenAiEmergency({
    images: dataUrlImages,
    prompt: "Return JSON.",
    env: {
      ...env,
      OPENAI_LISTING_MODEL: "gpt-5"
    },
    fetchImpl: async () => {
      invalidOpenAiModelFetchCalled = true;
    }
  }),
  (error) => error.provider === "openai_legacy" && error.code === "provider_unavailable"
);
assert.equal(invalidOpenAiModelFetchCalled, false);

assert.equal(providerServerConcurrencyLimit("openai_legacy", {}), 6);
assert.equal(providerServerConcurrencyLimit("unknown", { LISTING_PROVIDER_SERVER_CONCURRENCY: "3" }), 3);

clearProviderConcurrencyForTests();
let activeProviderWork = 0;
let maxActiveProviderWork = 0;
await Promise.all(Array.from({ length: 4 }, (_, index) => runWithProviderConcurrency({
  providerId: "openai_legacy",
  env: { OPENAI_PROVIDER_SERVER_CONCURRENCY: "2" },
  work: async () => {
    activeProviderWork += 1;
    maxActiveProviderWork = Math.max(maxActiveProviderWork, activeProviderWork);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeProviderWork -= 1;
    return index;
  }
})));
assert.equal(maxActiveProviderWork, 2);
clearProviderConcurrencyForTests();

console.log("provider routing tests passed");
