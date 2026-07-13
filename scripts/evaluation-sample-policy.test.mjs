import assert from "node:assert/strict";
import {
  assertEvaluationSampleProvenance,
  buildEvaluationSamplePolicy,
  evaluationItemSetSha256,
  normalizeEvaluationSampleMode
} from "../lib/listing/evaluation/sample-policy.mjs";

const fresh = buildEvaluationSamplePolicy({
  mode: "fresh_generalization",
  excludedItemIds: ["old-2", "old-1", "old-1"],
  selectedItemIds: ["new-2", "new-1"],
  exclusionSourceCount: 2
});
assert.equal(fresh.mode, "FRESH_GENERALIZATION");
assert.equal(fresh.novelty_verified, true);
assert.equal(fresh.prior_history_overlap_count, 0);
assert.equal(fresh.selected_item_count, 2);
assert.equal(fresh.excluded_item_count, 2);
assert.equal(fresh.selected_item_ids_sha256, evaluationItemSetSha256(["new-1", "new-2"]));
assert.deepEqual(assertEvaluationSampleProvenance({ requestedMode: "FRESH_GENERALIZATION", datasetPolicy: fresh }), {
  mode: "FRESH_GENERALIZATION",
  verified: true,
  required: true
});

const overlap = buildEvaluationSamplePolicy({
  mode: "CONCURRENCY_FRESH",
  excludedItemIds: ["old-1"],
  selectedItemIds: ["old-1"],
  exclusionSourceCount: 1
});
assert.equal(overlap.novelty_verified, false);
assert.equal(overlap.prior_history_overlap_count, 1);
assert.equal(overlap.same_sample_required, true);
assert.equal(overlap.sample_reuse_permitted, true);
assert.throws(() => assertEvaluationSampleProvenance({
  requestedMode: "CONCURRENCY_FRESH",
  datasetPolicy: overlap
}), /novelty_verified=true/);

const unprovenFresh = buildEvaluationSamplePolicy({
  mode: "FRESH_GENERALIZATION",
  selectedItemIds: ["new-1"]
});
assert.equal(unprovenFresh.novelty_verified, false);
assert.throws(() => assertEvaluationSampleProvenance({
  requestedMode: "FRESH_GENERALIZATION",
  datasetPolicy: unprovenFresh
}), /novelty_verified=true/);

assert.deepEqual(assertEvaluationSampleProvenance({ requestedMode: "FIXED_REGRESSION" }), {
  mode: "FIXED_REGRESSION",
  verified: false,
  required: false
});
assert.equal(normalizeEvaluationSampleMode("paired_ablation"), "PAIRED_ABLATION");
assert.throws(() => normalizeEvaluationSampleMode("fresh-ish"), /Unsupported evaluation sample mode/);

console.log("evaluation sample policy tests passed");
