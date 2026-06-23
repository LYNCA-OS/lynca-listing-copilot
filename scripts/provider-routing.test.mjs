import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { parseProviderMessagePayload } from "../lib/listing/providers/provider-response-normalizer.mjs";
import { listAvailableVisionProviders, selectVisionProvider } from "../lib/listing/providers/provider-registry.mjs";

const providerRegistrySource = await readFile("lib/listing/providers/provider-registry.mjs", "utf8");
const titleApiSource = await readFile("api/listing-copilot-title.js", "utf8");

assert.doesNotMatch(providerRegistrySource, /allowLegacyDefault/, "provider registry must not retain a legacy GPT default escape hatch");
assert.doesNotMatch(titleApiSource, /allowLegacyDefault/, "title API must not request legacy GPT default fallback");
assert.doesNotMatch(titleApiSource, /Fallback result from filename because OPENAI_API_KEY is not configured/, "local fallback should not be framed as an OpenAI-only condition");

const remoteImages = [{ url: "https://example.com/front.jpg" }];
const dataUrlImages = [{ dataUrl: "data:image/jpeg;base64,AAAA" }];
const storedImages = [{ objectPath: "listing-assets/2026-06-22/asset/front_original-image.jpg" }];

const env = {
  DEFAULT_VISION_PROVIDER: "agnes",
  EMERGENCY_VISION_PROVIDER: "openai_legacy",
  ENABLE_AGNES_PROVIDER: "true",
  ENABLE_GPT41_EMERGENCY_PROVIDER: "true",
  ALLOW_EXPLICIT_GPT41_RETRY: "true",
  AGNES_API_KEY: "test-agnes-key",
  AGNES_BASE_URL: "https://apihub.agnes-ai.com/v1",
  AGNES_MODEL: "agnes-2.0-flash",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_LISTING_MODEL: "gpt-4.1-mini"
};

const defaultSelection = selectVisionProvider({ images: remoteImages, env });
assert.equal(defaultSelection.provider_id, "agnes");
assert.equal(defaultSelection.model_id, "agnes-2.0-flash");

const storedSelection = selectVisionProvider({ images: storedImages, env });
assert.equal(storedSelection.provider_id, "agnes");

assert.throws(
  () => selectVisionProvider({
    requestedProvider: "openai_legacy",
    explicitEmergency: false,
    images: dataUrlImages,
    env
  }),
  /explicit emergency/i,
  "GPT-4.1 legacy should require explicit emergency retry"
);

const emergencySelection = selectVisionProvider({
  requestedProvider: "openai_legacy",
  explicitEmergency: true,
  images: dataUrlImages,
  env
});
assert.equal(emergencySelection.provider_id, "openai_legacy");
assert.equal(emergencySelection.model_id, "gpt-4.1-mini");

assert.throws(
  () => selectVisionProvider({ images: dataUrlImages, env }),
  /Base64 data URLs are not used for Agnes/i,
  "Agnes should not silently accept data URLs or fall back to GPT"
);

assert.throws(
  () => selectVisionProvider({
    images: remoteImages,
    env: {
      ...env,
      DEFAULT_VISION_PROVIDER: "",
      AGNES_API_KEY: "",
      OPENAI_API_KEY: "test-openai-key"
    }
  }),
  (error) => error.provider === "agnes" && error.code === "provider_unavailable",
  "OpenAI legacy must not become the implicit default when Agnes is unavailable"
);

assert.throws(
  () => selectVisionProvider({
    images: dataUrlImages,
    env: {
      ...env,
      DEFAULT_VISION_PROVIDER: "openai_legacy"
    }
  }),
  /explicit emergency/i,
  "OpenAI legacy must not be usable as an env-selected default without an explicit emergency request"
);

assert.throws(
  () => selectVisionProvider({ requestedProvider: "not_real", images: remoteImages, env }),
  /Unknown vision provider/i,
  "illegal provider ids should be rejected"
);

assert.throws(
  () => selectVisionProvider({
    images: remoteImages,
    env: {
      ...env,
      AGNES_MODEL: "agnes-experimental"
    }
  }),
  /model_not_allowed/i,
  "Agnes model ids should be restricted to the provider whitelist"
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
  /model_not_allowed/i,
  "GPT-4.1 emergency model ids should be restricted to the provider whitelist"
);

const disabledProviders = listAvailableVisionProviders({
  ...env,
  ENABLE_GPT41_EMERGENCY_PROVIDER: "false"
});
assert.deepEqual(disabledProviders.map((provider) => provider.id), ["agnes"]);

const retryDisabledProviders = listAvailableVisionProviders({
  ...env,
  ALLOW_EXPLICIT_GPT41_RETRY: "false"
});
assert.deepEqual(retryDisabledProviders.map((provider) => provider.id), ["agnes"]);

assert.throws(
  () => selectVisionProvider({
    requestedProvider: "openai_legacy",
    explicitEmergency: true,
    images: dataUrlImages,
    env: {
      ...env,
      ALLOW_EXPLICIT_GPT41_RETRY: "false"
    }
  }),
  /emergency retry is disabled/i,
  "GPT-4.1 emergency should be unavailable when the explicit retry flag is disabled"
);

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

let agnesRequest;
const agnesResult = await analyzeCardEvidenceWithAgnes({
  images: remoteImages,
  prompt: "Return JSON.",
  env,
  fetchImpl: async (url, init) => {
    agnesRequest = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "chatcmpl_test",
        model: "agnes-2.0-flash",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "{\"title\":\"Agnes Test\",\"fields\":{\"player\":\"Tester\"},\"unresolved\":[]}"
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18
        }
      })
    };
  }
});

assert.equal(agnesRequest.url, "https://apihub.agnes-ai.com/v1/chat/completions");
assert.equal(agnesRequest.init.headers.authorization, "Bearer test-agnes-key");
const agnesBody = JSON.parse(agnesRequest.init.body);
assert.equal(agnesBody.model, "agnes-2.0-flash");
assert.equal(agnesBody.messages[0].content[1].type, "image_url");
assert.equal(agnesBody.messages[0].content[1].image_url.url, remoteImages[0].url);
assert.equal(agnesResult.parsed.fields.player, "Tester");
assert.equal(agnesResult.usage.provider_calls, 1);
assert.equal(agnesResult.usage.total_tokens, 18);
assert.equal(agnesResult.usage.input_tokens, 10);
assert.equal(agnesResult.usage.output_tokens, 8);
assert.equal(agnesResult.usage.image_count, 1);
assert.equal(agnesResult.usage.estimated_cost_usd, 0);

let repairCalls = 0;
const repairedAgnesResult = await analyzeCardEvidenceWithAgnes({
  images: remoteImages,
  prompt: "Return JSON.",
  env,
  fetchImpl: async (url, init) => {
    repairCalls += 1;
    const body = JSON.parse(init.body);
    if (repairCalls === 1) {
      assert.doesNotMatch(body.messages[0].content[0].text, /FORMAT REPAIR RETRY/);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: "agnes-2.0-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: "{\"title\":"
              },
              finish_reason: "stop"
            }
          ]
        })
      };
    }

    assert.match(body.messages[0].content[0].text, /FORMAT REPAIR RETRY/);
    assert.match(body.messages[0].content[0].text, /Return only a single valid JSON object/);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: "agnes-2.0-flash",
        choices: [
          {
            message: {
              role: "assistant",
              content: "{\"title\":\"Repair Test\",\"fields\":{\"player\":\"Fixed\"},\"unresolved\":[]}"
            },
            finish_reason: "stop"
          }
        ]
      })
    };
  }
});
assert.equal(repairCalls, 2);
assert.equal(repairedAgnesResult.format_repair_attempted, true);
assert.equal(repairedAgnesResult.parsed.fields.player, "Fixed");
assert.equal(repairedAgnesResult.usage.provider_calls, 2);

let schemaFailureCalls = 0;
await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: remoteImages,
    prompt: "Return JSON.",
    env,
    fetchImpl: async () => {
      schemaFailureCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: "agnes-2.0-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: "{\"not_evidence\":true}"
              },
              finish_reason: "stop"
            }
          ]
        })
      };
    }
  }),
  (error) => error.code === "schema_validation_failed"
);
assert.equal(schemaFailureCalls, 1, "schema-invalid JSON should not trigger a format repair retry");

let unrepairedCalls = 0;
await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: remoteImages,
    prompt: "Return JSON.",
    env,
    fetchImpl: async () => {
      unrepairedCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: "agnes-2.0-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: "{\"title\":"
              },
              finish_reason: "stop"
            }
          ]
        })
      };
    }
  }),
  (error) => error.code === "response_format_invalid"
);
assert.equal(unrepairedCalls, 2, "Agnes format repair should run at most once");

let invalidAgnesModelFetchCalled = false;
await assert.rejects(
  analyzeCardEvidenceWithAgnes({
    images: remoteImages,
    prompt: "Return JSON.",
    env: {
      ...env,
      AGNES_MODEL: "agnes-experimental"
    },
    fetchImpl: async () => {
      invalidAgnesModelFetchCalled = true;
    }
  }),
  (error) => error.provider === "agnes" && error.code === "provider_unavailable"
);
assert.equal(invalidAgnesModelFetchCalled, false, "invalid Agnes model env should fail before fetch");

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
assert.equal(openAiBody.model, "gpt-4.1-mini");
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
assert.equal(invalidOpenAiModelFetchCalled, false, "invalid OpenAI emergency model env should fail before fetch");

console.log("provider routing tests passed");
