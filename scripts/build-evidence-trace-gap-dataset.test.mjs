import assert from "node:assert/strict";
import { buildEvidenceTraceGapDataset } from "./build-evidence-trace-gap-dataset.mjs";

const output = buildEvidenceTraceGapDataset({ items: [
  { item_id: "one", images: [{ image_id: "front" }] },
  { item_id: "two", images: [{ image_id: "front" }] }
] }, { failures: [
  { query_card_id: "one", category: "TRACE_MISSING" },
  { query_card_id: "two", category: "OCR_MISSED" }
] });

assert.equal(output.item_count, 1);
assert.equal(output.items[0].item_id, "one");
assert.equal(output.evaluation_sample_policy.reuse_policy_complete, true);
assert.deepEqual(output.evidence_trace_gap.categories, ["TRACE_MISSING"]);

const sampled = buildEvidenceTraceGapDataset({ items: [
  { item_id: "dev-a", partition: "development" },
  { item_id: "dev-b", partition: "development" },
  { item_id: "dev-c", partition: "development" },
  { item_id: "val-a", partition: "validation" },
  { item_id: "val-b", partition: "validation" }
] }, { failures: [
  { item_id: "dev-a", category: "TRACE_MISSING" },
  { item_id: "dev-b", category: "TRACE_MISSING" },
  { item_id: "dev-c", category: "TRACE_MISSING" },
  { item_id: "val-a", category: "TRACE_MISSING" },
  { item_id: "val-b", category: "TRACE_MISSING" }
] }, { sampleSize: 4, validationSize: 1, seed: "fixed-20", titleIsReviewedGroundTruth: true });
assert.equal(sampled.items.length, 4);
assert.equal(sampled.items.filter((item) => item.partition === "validation").length, 1);
assert.equal(sampled.evaluation_sample_policy.randomized_selection, true);
assert.equal(sampled.evaluation_sample_policy.deterministic_seed, "fixed-20");
assert.equal(sampled.items.every((item) => item.policy.reviewed_title_is_ground_truth === true), true);
assert.equal(sampled.items.every((item) => item.policy.model_prompt_visible === false), true);

console.log("build evidence trace gap dataset tests passed");
