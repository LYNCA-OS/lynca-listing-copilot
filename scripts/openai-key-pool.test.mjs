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
assert.equal(openAiProviderGlobalConcurrency({ ...single, OPENAI_PROVIDER_SERVER_CONCURRENCY: "3" }), 2);

const pool = {
  OPENAI_API_KEY_POOL: "sk-a, sk-b\nsk-c",
  OPENAI_API_KEY: "sk-a",
  OPENAI_PER_KEY_STABLE_CONCURRENCY: "2"
};
assert.deepEqual(openAiApiKeyPool(pool), ["sk-a", "sk-b", "sk-c"]);
assert.equal(openAiKeyPoolSize(pool), 3);
assert.equal(openAiPerKeyStableConcurrency(pool), 2);
assert.equal(openAiProviderGlobalConcurrency(pool), 2, "extra keys must add resilience without silently raising the measured global knee");
assert.equal(openAiProviderGlobalConcurrency({ ...pool, OPENAI_PROVIDER_MAX_TOTAL_CONCURRENCY: "4" }), 2);
assert.equal(openAiProviderGlobalConcurrency({ ...pool, OPENAI_PROVIDER_MAX_TOTAL_CONCURRENCY: "20" }), 2);

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

const leasedSelection = selectOpenAiApiKey({
  env: pool,
  shardKey: "asset-123",
  preferredKeySlot: 3
});
assert.equal(leasedSelection.apiKey, "sk-c");
assert.equal(leasedSelection.keySlot, 3);
assert.equal(leasedSelection.source, "capacity_lease");

const invalidLeaseFallsBack = selectOpenAiApiKey({
  env: pool,
  shardKey: "asset-123",
  preferredKeySlot: 99
});
assert.equal(invalidLeaseFallsBack.apiKey, firstSelection.apiKey);
assert.equal(invalidLeaseFallsBack.source, "pool");

console.log("openai key pool tests passed");
