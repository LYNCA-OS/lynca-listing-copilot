import assert from "node:assert/strict";
import { buildAccuracyStageTrace } from "./build-accuracy-stage-trace.mjs";

const stages = ["observation", "preingestion_evidence", "retrieval", "candidate_decision", "field_resolution", "renderer"]
  .map((stage_id) => ({ stage_id, owner: `${stage_id}_owner`, status: "COMPLETED", execution_mode: "test-v1" }));
const trace = buildAccuracyStageTrace([{ results: [{
  source_feedback_id: "Card-1",
  ok: true,
  v4_pipeline_contract: { schema_version: "pipeline-v1", strategy_profile: { policy_version: "strategy-v1" }, stages },
  pipeline_node_ledger: { sensor_evidence: [{ fields: { year: "2025" } }], field_flow: { fields: [] } },
  l2_candidate_debug: { candidate_application_trace: [], selected_candidate_decision: {}, retrieval_application: { decisions: [] } },
  resolved_fields: {}
}] }]);
assert.equal(trace.cards.length, 1);
assert.equal(trace.cards[0].query_card_id, "card-1");
assert.equal(trace.cards[0].stage_trace.length, 7);
assert.equal(trace.cards[0].stage_trace.every((stage) => stage.status === "COMPLETED"), true);
assert.equal(trace.cards[0].stage_trace[0].input_version, "pipeline-v1:strategy-v1:test-v1");
assert.equal(trace.cards[0].stage_trace.at(-1).final_decision_owner, "renderer_owner");

const replaced = buildAccuracyStageTrace([
  { results: [{ ...trace.cards[0], source_feedback_id: "same", ok: true, v4_pipeline_contract: { violations: [{ code: "OLD" }] } }] },
  { results: [{ ...trace.cards[0], source_feedback_id: "same", ok: true, v4_pipeline_contract: { violations: [] } }] }
]);
assert.deepEqual(replaced.cards[0].instrumentation.pipeline_contract_violations, []);

console.log("build accuracy stage trace tests passed");
