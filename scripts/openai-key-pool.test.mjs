import assert from "node:assert/strict";
import {
  openAiApiKeyPool,
  openAiKeyPoolSize,
  openAiPerKeyStableConcurrency,
  openAiProviderGlobalConcurrency,
  selectOpenAiApiKey
} from "../lib/listing/providers/openai-key-pool.mjs";

assert.deepEqual(openAiApiKeyPool({}), []);
assert.equal(openAiKeyPoolSize({}), 0);

const single = {
  OPENAI_API_KEY: "sk-single"
};
assert.deepEqual(openAiApiKeyPool(single), ["sk-single"]);
assert.equal(openAiProviderGlobalConcurrency(single), 2);
assert.equal(openAiProviderGlobalConcurrency({ ...single, OPENAI_PROVIDER_SERVER_CONCURRENCY: "3" }), 3);

const pool = {
  OPENAI_API_KEY_POOL: "sk-a, sk-b\nsk-c",
  OPENAI_API_KEY: "sk-a",
  OPENAI_PER_KEY_STABLE_CONCURRENCY: "2"
};
assert.deepEqual(openAiApiKeyPool(pool), ["sk-a", "sk-b", "sk-c"]);
assert.equal(openAiKeyPoolSize(pool), 3);
assert.equal(openAiPerKeyStableConcurrency(pool), 2);
assert.equal(openAiProviderGlobalConcurrency(pool), 6);
assert.equal(openAiProviderGlobalConcurrency({ ...pool, OPENAI_PROVIDER_MAX_TOTAL_CONCURRENCY: "4" }), 4);

const indexed = {
  OPENAI_API_KEY_2: "sk-two",
  OPENAI_API_KEY_1: "sk-one",
  OPENAI_API_KEYS: "[\"sk-three\",\"sk-two\"]"
};
assert.deepEqual(openAiApiKeyPool(indexed), ["sk-three", "sk-two", "sk-one"]);

const firstSelection = selectOpenAiApiKey({ env: pool, shardKey: "asset-123" });
const secondSelection = selectOpenAiApiKey({ env: pool, shardKey: "asset-123" });
assert.equal(firstSelection.apiKey, secondSelection.apiKey);
assert.equal(firstSelection.keySlot, secondSelection.keySlot);
assert.equal(firstSelection.poolSize, 3);
assert.equal(firstSelection.source, "pool");
assert.ok(firstSelection.keySlot >= 1 && firstSelection.keySlot <= 3);

const missing = selectOpenAiApiKey({ env: {}, shardKey: "asset-123" });
assert.equal(missing.apiKey, "");
assert.equal(missing.keySlot, null);
assert.equal(missing.poolSize, 0);

console.log("openai key pool tests passed");
