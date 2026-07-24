import assert from "node:assert/strict";
import { buildStageTraceGapDataset } from "./build-stage-trace-gap-dataset.mjs";

const output = buildStageTraceGapDataset(
  { dataset_id: "test", items: [{ item_id: "a" }, { item_id: "b" }, { item_id: "c" }] },
  { cards: [{ query_card_id: "a", complete: true }, { query_card_id: "b", complete: false }] }
);
assert.equal(output.item_count, 1);
assert.equal(output.items[0].item_id, "b");
assert.equal(output.evaluation_sample_policy.mode, "FIXED_REGRESSION");
assert.equal(output.evaluation_sample_policy.reuse_policy_complete, true);
const violationOutput = buildStageTraceGapDataset(
  { items: [{ item_id: "a" }, { item_id: "b" }] },
  { cards: [{ query_card_id: "a", complete: true, source_contract_violations: [{ code: "DEGRADED" }] }] },
  { includeSourceContractViolations: true }
);
assert.equal(violationOutput.item_count, 1);
assert.equal(violationOutput.items[0].item_id, "a");
assert.throws(() => buildStageTraceGapDataset({ items: [] }, { cards: [{ query_card_id: "missing", complete: false }] }));

console.log("build stage trace gap dataset tests passed");
