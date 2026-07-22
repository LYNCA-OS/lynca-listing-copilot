import assert from "node:assert/strict";
import { buildV4ChainOracleTraceFromSmoke } from "./build-v4-chain-oracle-trace-from-smoke.mjs";

const trace = buildV4ChainOracleTraceFromSmoke([{ results: [{
  source_feedback_id: "card-1",
  ok: true,
  resolved_fields: { year: "2024" },
  pipeline_node_ledger: {
    sensor_evidence: [{ source: "GPT_5_MINI_OBSERVATION", fields: { year: "2024" } }],
    field_flow: { fields: [{ field_group: "year", rendered_values: ["2024"] }] },
    coverage: { missing_required_node_count: 0 }
  },
  l2_candidate_debug: {
    selected_candidate_id: "candidate-a",
    candidate_application_trace: [
      { candidate_id: "candidate-a", candidate_identity_id: "identity-a", candidate_lane: "catalog", retrieval_rank: 1 },
      { candidate_id: "candidate-b", candidate_identity_id: "identity-b", candidate_lane: "vector", retrieval_rank: 1 }
    ],
    retrieval_application: { decisions: [{
      candidate_id: "candidate-a",
      field: "year",
      resolver_field: "year",
      candidate_value: "2024",
      resolver_value: "2024",
      decision: "APPLY",
      applied_to_final: true
    }] }
  }
}] }], {
  cards: [{
    query_card_id: "card-1",
    observations: [{ source: "GOOGLE_VISION_OCR", raw_text: "2024 TEST PLAYER" }]
  }]
});

assert.equal(trace.cards.length, 1);
assert.equal(trace.cards[0].evidence_observations[0].fields.year, "2024");
assert.equal(trace.cards[0].evidence_observations[1].source, "GOOGLE_VISION_OCR");
assert.equal(trace.cards[0].retrieval_candidates.length, 2);
assert.equal(trace.cards[0].retrieval_candidates[0].rank, 1);
assert.equal(trace.cards[0].application_decisions[0].applied, true);
assert.equal(trace.cards[0].renderer_fields.year, "2024");
assert.equal(trace.cards[0].instrumentation.sensor_evidence_instrumented, true);

console.log("v4 chain oracle trace adapter tests passed");
