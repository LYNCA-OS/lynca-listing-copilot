import assert from "node:assert/strict";
import { auditStageTraceCoverage, requiredTraceStages } from "../lib/listing/evaluation/stage-trace-coverage.mjs";

const completeTrace = requiredTraceStages.map((stage) => ({
  stage,
  status: "COMPLETED",
  input_version: "v1",
  output_produced: true,
  output_persisted: true,
  final_decision_owner: stage === "renderer" ? "renderer" : undefined
}));
const passed = auditStageTraceCoverage({
  dataset: { items: [{ item_id: "a" }] },
  trace: { items: [{ query_card_id: "a", stage_trace: completeTrace }] }
});
assert.equal(passed.gate.coverage, 1);
assert.equal(passed.gate.passed, true);
assert.equal(passed.gate.experiment_eligible, true);
const failed = auditStageTraceCoverage({
  dataset: { items: [{ item_id: "a" }] },
  trace: { items: [{ query_card_id: "a", stage_trace: [{ stage: "observation", status: "SKIPPED" }] }] }
});
assert.equal(failed.gate.passed, false);
assert.equal(failed.failures_by_reason.REASON_CODE_MISSING, 1);
assert.equal(failed.failures_by_reason.STAGE_TRACE_MISSING, 6);
const legacy = auditStageTraceCoverage({
  dataset: { items: [{ item_id: "a" }] },
  trace: { items: [{ query_card_id: "a", recognition_ok: true, retrieval_candidates: [] }] }
});
assert.equal(legacy.gate.coverage, 0);
assert.equal(legacy.gate.legacy_signal_stage_slots, 2);
const violated = auditStageTraceCoverage({
  dataset: { items: [{ item_id: "a" }] },
  trace: { items: [{
    query_card_id: "a",
    stage_trace: completeTrace,
    instrumentation: { pipeline_contract_violations: [{ code: "BROKEN", severity: "ERROR" }] }
  }] }
});
assert.equal(violated.gate.passed, true);
assert.equal(violated.gate.experiment_eligible, false);
console.log("stage trace coverage tests passed");
