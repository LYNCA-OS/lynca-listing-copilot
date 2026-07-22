#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  assertHistoricalRecognitionChampionContract,
  historicalRecognitionChampionContract
} from "../lib/listing/evaluation/historical-recognition-champion-contract.mjs";

assert.equal(assertHistoricalRecognitionChampionContract(), true);
assert.equal(historicalRecognitionChampionContract.champions.targeted_8.token_recall, 0.909821);
assert.equal(historicalRecognitionChampionContract.champions.formal_30.token_recall, 0.903653);
assert.equal(historicalRecognitionChampionContract.champions.stable_30.token_recall, 0.89818);
assert.equal(historicalRecognitionChampionContract.exclusions.proxy_selected_096_to_098.eligible, false);
assert.equal(historicalRecognitionChampionContract.exclusions.legacy_0912_waterline.eligible_as_replacement, false);
assert.equal(Object.isFrozen(historicalRecognitionChampionContract.champions), true);
assert.throws(() => {
  historicalRecognitionChampionContract.champions.targeted_8.token_recall = 1;
}, TypeError);

console.log("Historical recognition champion contract tests passed");
