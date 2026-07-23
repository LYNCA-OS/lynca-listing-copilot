import assert from "node:assert/strict";
import {
  DEFAULT_PREPARATION_CONCURRENCY,
  MAX_PREPARATION_CONCURRENCY,
  datasetItems,
  percentile,
  preparationConcurrency
} from "./prepare-v4-verified-assets.mjs";

assert.equal(DEFAULT_PREPARATION_CONCURRENCY, 2);
assert.equal(MAX_PREPARATION_CONCURRENCY, 2);
assert.equal(preparationConcurrency(undefined), 2);
assert.equal(preparationConcurrency("1"), 1);
assert.equal(
  preparationConcurrency("4"),
  2,
  "storage verification must not exceed its measured stable concurrency"
);
assert.deepEqual(datasetItems([{ id: 1 }]), [{ id: 1 }]);
assert.deepEqual(datasetItems({ cards: [{ id: 2 }] }), [{ id: 2 }]);
assert.equal(percentile([30, 10, 20], 0.5), 20);
assert.equal(percentile([30, 10, 20], 0.95), 30);
assert.equal(percentile([], 0.95), null);

console.log("prepare v4 verified assets tests passed");
