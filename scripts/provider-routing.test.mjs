import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analyzeCardEvidenceWithOpenAiEmergency,
  openAiEmergencyConfigFromEnv
} from "../lib/listing/providers/openai-emergency-provider.mjs";
import {
  clearProviderConcurrencyForTests,
  providerServerConcurrencyLimit,
  runWithProviderConcurrency
} from "../lib/listing/providers/provider-concurrency.mjs";
import { openAiResponsesModelControls, openAiResponsesTextOptions } from "../lib/listing/providers/openai-responses-request.mjs";
import { parseProviderMessagePayload } from "../lib/listing/providers/provider-response-normalizer.mjs";
import { listAvailableVisionProviders, selectVisionProvider } from "../lib/listing/providers/provider-registry.mjs";
import { __listingCopilotTitleTestHooks } from "../api/listing-copilot-title.js";

const providerRegistrySource = await readFile("lib/listing/providers/provider-registry.mjs", "utf8");
const providerContractSource = await readFile("lib/listing/providers/provider-contract.mjs", "utf8");
const titleApiSource = await readFile("api/listing-copilot-title.js", "utf8");

assert.doesNotMatch(providerRegistrySource, /cascade_fast|ENABLE_FAST_CASCADE_PROVIDER/i, "provider registry must not expose cascade providers");
assert.doesNotMatch(providerContractSource, /cascade_fast/i, "provider contract must only keep active providers");
assert.doesNotMatch(titleApiSource, /createCascadeFastTitle|model_to_model/i, "title API must not retain automatic mixed-model provider paths");

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
  () => selectVisionProvider({ requestedProvider: "removed_legacy_provider", images: remoteImages, env }),
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

const vectorDefaultEnv = {
  ...env,
  ENABLE_VECTOR_ASSIST_DEFAULT: "true",
  ENABLE_VECTOR_RETRIEVAL: "true",
  VECTOR_RETRIEVAL_MODE: "assist"
};
const fastPathOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: { single_model_fast: true }
}, vectorDefaultEnv);
assert.equal(fastPathOptions.enable_vector_retrieval, false, "single-model fast path must not inherit blocking vector retrieval defaults");
assert.equal(fastPathOptions.vector_retrieval_mode, "off");
assert.equal(fastPathOptions.enable_query_visual_embeddings, false);

const explicitVectorOffOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: { enable_vector_assist: false }
}, vectorDefaultEnv);
assert.equal(explicitVectorOffOptions.enable_vector_retrieval, false, "explicit vector assist off must also disable query embedding");
assert.equal(explicitVectorOffOptions.enable_stored_visual_features, false);
assert.equal(explicitVectorOffOptions.enable_query_visual_embeddings, false);

const explicitVectorOnOptions = __listingCopilotTitleTestHooks.providerOptionsFromPayload({
  provider_options: {
    enable_vector_assist: false,
    enable_vector_retrieval: true,
    vector_retrieval_mode: "assist"
  }
}, vectorDefaultEnv);
assert.equal(explicitVectorOnOptions.enable_vector_retrieval, true, "explicit retrieval config can still force vector experiments");
assert.equal(explicitVectorOnOptions.vector_retrieval_mode, "assist");

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
      headers: new Headers({
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999",
        "x-ratelimit-limit-tokens": "800000",
        "x-ratelimit-remaining-tokens": "799000",
        "x-ratelimit-reset-requests": "12ms",
        "x-ratelimit-reset-tokens": "40ms"
      }),
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
assert.equal(openAiBody.temperature, 0);
assert.equal(openAiBody.reasoning, undefined);
assert.equal(openAiBody.text.verbosity, undefined);
assert.equal(openAiBody.text.format.type, "json_schema");
assert.equal(openAiBody.text.format.strict, true);
assert.equal(openAiBody.input[0].content[1].type, "input_image");
assert.equal(openAiResult.parsed.fields.player, "Emergency");
assert.equal(openAiResult.usage.provider_calls, 1);
assert.equal(openAiResult.usage.input_tokens, 11);
assert.equal(openAiResult.usage.output_tokens, 9);
assert.equal(openAiResult.usage.total_tokens, 20);
assert.equal(openAiResult.usage.image_count, 1);
assert.equal(openAiResult.provider_key_pool_size, 1);
assert.equal(openAiResult.provider_key_slot, 1);
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-limit-requests"], "5000");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-remaining-requests"], "4999");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-limit-tokens"], "800000");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-remaining-tokens"], "799000");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-reset-requests"], "12ms");
assert.equal(openAiResult.rate_limit_diagnostics["x-ratelimit-reset-tokens"], "40ms");
assert.equal(openAiResult.provider_request_diagnostics.input_tokens, 11);
assert.equal(openAiResult.provider_request_diagnostics.output_tokens, 9);
assert.ok(openAiResult.provider_request_diagnostics.provider_latency_ms >= 0);

const gpt5Controls = openAiResponsesModelControls("gpt-5-mini", { env: {} });
assert.deepEqual(gpt5Controls, { reasoning: { effort: "minimal" } });
const gpt5Text = openAiResponsesTextOptions({
  model: "gpt-5-mini",
  name: "test_schema",
  schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  env: {}
});
assert.equal(gpt5Text.verbosity, "medium");
assert.equal(gpt5Text.format.type, "json_schema");

assert.deepEqual(openAiResponsesModelControls("gpt-5-mini", {
  env: { OPENAI_GPT5_REASONING_EFFORT: "low" }
}), { reasoning: { effort: "low" } });
assert.equal(openAiResponsesTextOptions({
  model: "gpt-5-mini",
  name: "test_schema",
  schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  env: { OPENAI_GPT5_TEXT_VERBOSITY: "low" }
}).verbosity, "low");

let gpt5OpenAiRequest;
const gpt5OpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini"
  },
  fetchImpl: async (url, init) => {
    gpt5OpenAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "resp_gpt5_test",
        model: "gpt-5-mini",
        output_text: "{\"title\":\"GPT-5 Test\",\"fields\":{\"player\":\"Five\"},\"field_evidence\":[],\"unresolved\":[],\"vector_candidate_decision\":{\"selected_candidate_id\":null,\"decision\":\"NOT_AVAILABLE\",\"supported_fields\":[],\"rejected_fields\":[],\"conflicts\":[]}}",
        usage: {
          input_tokens: 13,
          output_tokens: 7,
          total_tokens: 20
        }
      })
    };
  }
});
const gpt5Body = JSON.parse(gpt5OpenAiRequest.init.body);
assert.equal(gpt5Body.model, "gpt-5-mini");
assert.equal(gpt5Body.max_output_tokens, 128000);
assert.equal(gpt5Body.temperature, undefined);
assert.deepEqual(gpt5Body.reasoning, { effort: "minimal" });
assert.equal(gpt5Body.text.verbosity, "medium");
assert.match(gpt5Body.input[0].content[0].text, /GPT-5 mini main-path extraction profile/);
assert.match(gpt5Body.input[0].content[0].text, /Never leave product, set, players, card_name, print_run_number/);
assert.equal(gpt5OpenAiResult.parsed.fields.player, "Five");

const gpt5DefaultConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-5-mini"
});
assert.equal(gpt5DefaultConfig.requestedMaxOutputTokens, 128000);
assert.equal(gpt5DefaultConfig.maxOutputTokens, 128000);
assert.equal(gpt5DefaultConfig.truncationRetryMaxOutputTokens, 128000);

const gpt41DefaultExpandedConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-4.1-mini-2025-04-14"
});
assert.equal(gpt41DefaultExpandedConfig.maxOutputTokens, 32768);
assert.equal(gpt41DefaultExpandedConfig.truncationRetryMaxOutputTokens, 32768);

const gpt41ExpandedCapOverrideConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-4.1-mini-2025-04-14",
  OPENAI_GPT41_MAX_OUTPUT_TOKEN_CAP: "40960"
});
assert.equal(gpt41ExpandedCapOverrideConfig.maxOutputTokens, 40960);
assert.equal(gpt41ExpandedCapOverrideConfig.truncationRetryMaxOutputTokens, 40960);

let gpt5OutputCapFallbackCalls = 0;
const gpt5OutputCapFallbackCaps = [];
const gpt5OutputCapFallbackResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini",
    // Force an out-of-spec request so the output-cap downgrade safety net
    // still gets exercised now that defaults are within model spec.
    OPENAI_GPT5_MAX_OUTPUT_TOKEN_CAP: "1280000",
    OPENAI_GPT5_MAX_OUTPUT_TOKENS: "1280000"
  },
  fetchImpl: async (url, init) => {
    gpt5OutputCapFallbackCalls += 1;
    const body = JSON.parse(init.body);
    gpt5OutputCapFallbackCaps.push(body.max_output_tokens);
    if (body.max_output_tokens > 128000) {
      return {
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () => "max_output_tokens exceeds the maximum allowed output tokens for this model"
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: "resp_gpt5_cap_fallback",
        model: "gpt-5-mini",
        output_text: "{\"title\":\"GPT-5 Fallback Test\",\"fields\":{\"player\":\"Fallback\"},\"field_evidence\":[],\"unresolved\":[],\"vector_candidate_decision\":{\"selected_candidate_id\":null,\"decision\":\"NOT_AVAILABLE\",\"supported_fields\":[],\"rejected_fields\":[],\"conflicts\":[]}}",
        usage: {
          input_tokens: 17,
          output_tokens: 9,
          total_tokens: 26
        }
      })
    };
  }
});
assert.equal(gpt5OutputCapFallbackCalls, 2);
assert.deepEqual(gpt5OutputCapFallbackCaps, [1280000, 128000]);
assert.equal(gpt5OutputCapFallbackResult.output_cap_downgrade_attempted, true);
assert.equal(gpt5OutputCapFallbackResult.output_cap_downgrade_attempts, 1);
assert.equal(gpt5OutputCapFallbackResult.token_diagnostics.requested_output_cap, 1280000);
assert.equal(gpt5OutputCapFallbackResult.token_diagnostics.model_output_token_cap, 1280000);
assert.equal(gpt5OutputCapFallbackResult.token_diagnostics.output_cap, 128000);
assert.equal(gpt5OutputCapFallbackResult.parsed.fields.player, "Fallback");

const gpt5OverrideConfig = openAiEmergencyConfigFromEnv({
  ...env,
  OPENAI_LISTING_MODEL: "gpt-5-mini",
  OPENAI_GPT5_MAX_OUTPUT_TOKENS: "50000",
  OPENAI_GPT5_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS: "90000"
});
assert.equal(gpt5OverrideConfig.maxOutputTokens, 50000);
assert.equal(gpt5OverrideConfig.truncationRetryMaxOutputTokens, 90000);

let gpt5TruncationCalls = 0;
const gpt5TruncationCaps = [];
const gpt5TruncationResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_MODEL: "gpt-5-mini",
    OPENAI_GPT5_MAX_OUTPUT_TOKENS: "50000",
    OPENAI_GPT5_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS: "90000"
  },
  fetchImpl: async (url, init) => {
    gpt5TruncationCalls += 1;
    const body = JSON.parse(init.body);
    gpt5TruncationCaps.push(body.max_output_tokens);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => gpt5TruncationCalls === 1
        ? {
            id: "resp_gpt5_truncated",
            model: "gpt-5-mini",
            status: "incomplete",
            output_text: "{\"recognition_status\":\"CONFIRMED\"",
            usage: {
              input_tokens: 21,
              output_tokens: 50000,
              total_tokens: 50021
            }
          }
        : {
            id: "resp_gpt5_retry_ok",
            model: "gpt-5-mini",
            status: "completed",
            output_text: "{\"title\":\"GPT-5 Retry Test\",\"fields\":{\"player\":\"Retry\"},\"field_evidence\":[],\"unresolved\":[],\"vector_candidate_decision\":{\"selected_candidate_id\":null,\"decision\":\"NOT_AVAILABLE\",\"supported_fields\":[],\"rejected_fields\":[],\"conflicts\":[]}}",
            usage: {
              input_tokens: 21,
              output_tokens: 100,
              total_tokens: 121
            }
          }
    };
  }
});
assert.equal(gpt5TruncationCalls, 2);
assert.deepEqual(gpt5TruncationCaps, [50000, 90000]);
assert.equal(gpt5TruncationResult.parsed.fields.player, "Retry");
assert.equal(gpt5TruncationResult.truncation_retry_attempted, true);
assert.equal(gpt5TruncationResult.truncation_retry_attempts, 1);
assert.equal(gpt5TruncationResult.initial_token_diagnostics.output_utilization, 1);

let pooledOpenAiRequest;
const pooledOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  shardKey: "asset-pool-test",
  env: {
    ...env,
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_POOL: "sk-pool-a,sk-pool-b,sk-pool-c"
  },
  fetchImpl: async (url, init) => {
    pooledOpenAiRequest = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_pool_test",
        output_text: "{\"title\":\"OpenAI Pool Test\",\"fields\":{\"player\":\"Pool\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 5,
          output_tokens: 5,
          total_tokens: 10
        }
      })
    };
  }
});
assert.match(pooledOpenAiRequest.init.headers.authorization, /^Bearer sk-pool-/);
assert.equal(pooledOpenAiResult.provider_key_pool_size, 3);
assert.ok(pooledOpenAiResult.provider_key_slot >= 1 && pooledOpenAiResult.provider_key_slot <= 3);

let rotatedOpenAiCalls = 0;
const rotatedAuthorizations = [];
const rotatedOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  shardKey: "asset-rotation-test",
  env: {
    ...env,
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_POOL: "sk-rotate-a,sk-rotate-b,sk-rotate-c",
    OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS: "0"
  },
  fetchImpl: async (url, init) => {
    rotatedOpenAiCalls += 1;
    rotatedAuthorizations.push(init.headers.authorization);
    if (rotatedOpenAiCalls === 1) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({
          "x-ratelimit-limit-requests": "1",
          "x-ratelimit-remaining-requests": "0",
          "x-ratelimit-reset-requests": "250ms"
        }),
        text: async () => "{\"error\":\"rate_limited\"}"
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999"
      }),
      json: async () => ({
        id: "resp_rotated_pool_test",
        output_text: "{\"title\":\"OpenAI Rotated Pool Test\",\"fields\":{\"player\":\"Rotated\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 6,
          output_tokens: 4,
          total_tokens: 10
        }
      })
    };
  }
});
assert.equal(rotatedOpenAiCalls, 2);
assert.equal(new Set(rotatedAuthorizations).size, 2, "retryable rate limits should rotate to the next OpenAI key slot before retrying");
assert.equal(rotatedOpenAiResult.parsed.fields.player, "Rotated");
assert.equal(rotatedOpenAiResult.provider_key_pool_size, 3);
assert.equal(rotatedOpenAiResult.provider_key_rotation_attempted, true);
assert.equal(rotatedOpenAiResult.provider_key_rotation_attempts, 1);
assert.equal(rotatedOpenAiResult.transient_retry_attempted, true);
assert.equal(rotatedOpenAiResult.transient_retry_attempts, 1);
assert.equal(rotatedOpenAiResult.provider_request_diagnostics.provider_key_slot, rotatedOpenAiResult.provider_key_slot);

let transientOpenAiCalls = 0;
const transientOpenAiResult = await analyzeCardEvidenceWithOpenAiEmergency({
  images: dataUrlImages,
  prompt: "Return JSON.",
  env: {
    ...env,
    OPENAI_LISTING_TRANSIENT_RETRIES: "1",
    OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS: "0"
  },
  fetchImpl: async () => {
    transientOpenAiCalls += 1;
    if (transientOpenAiCalls === 1) {
      return {
        ok: false,
        status: 520,
        text: async () => "<!DOCTYPE html><html><body>Cloudflare 520</body></html>"
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_retry_test",
        output_text: "{\"title\":\"OpenAI Retry Test\",\"fields\":{\"player\":\"Recovered\"},\"unresolved\":[]}",
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20
        }
      })
    };
  }
});
assert.equal(transientOpenAiCalls, 2);
assert.equal(transientOpenAiResult.parsed.fields.player, "Recovered");
assert.equal(transientOpenAiResult.transient_retry_attempted, true);
assert.equal(transientOpenAiResult.transient_retry_attempts, 1);

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

assert.equal(providerServerConcurrencyLimit("openai_legacy", {}), 2);
assert.equal(providerServerConcurrencyLimit("openai_legacy", { OPENAI_PROVIDER_SERVER_CONCURRENCY: "2" }), 2);
assert.equal(providerServerConcurrencyLimit("openai_legacy", {
  OPENAI_API_KEY_POOL: "sk-a,sk-b,sk-c",
  OPENAI_PER_KEY_STABLE_CONCURRENCY: "2"
}), 6);
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
