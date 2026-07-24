import assert from "node:assert/strict";
import { buildV4ChainOracleTraceFromSmoke } from "./build-v4-chain-oracle-trace-from-smoke.mjs";

const trace = buildV4ChainOracleTraceFromSmoke([{ results: [{
  source_feedback_id: "card-1",
  ok: true,
  v4_pipeline_contract: {
    schema_version: "v4-native-pipeline-contract-v2",
    strategy_profile: { policy_version: "test-v1" },
    owners: { renderer: "DETERMINISTIC_RENDERER" },
    stages: [
      { stage_id: "preingestion_evidence", owner: "PREINGESTION_EVIDENCE", status: "COMPLETED" },
      { stage_id: "observation", owner: "PROVIDER_OBSERVATION", status: "COMPLETED" },
      { stage_id: "retrieval", owner: "RETRIEVAL_ORCHESTRATOR", status: "COMPLETED" },
      { stage_id: "candidate_decision", owner: "CANDIDATE_CONTROL_PLANE", status: "COMPLETED" },
      { stage_id: "field_resolution", owner: "IDENTITY_RESOLUTION", status: "COMPLETED" },
      { stage_id: "renderer", owner: "DETERMINISTIC_RENDERER", status: "COMPLETED" }
    ]
  },
  resolved_fields: { year: "2024" },
  l2_status: {
    preingestion_ocr_rendezvous: {
      raw_ocr_observations: [{ model_id: "google-cloud-vision", raw_text: "TEST PLAYER CARD 17" }]
    }
  },
  pipeline_node_ledger: {
    sensor_evidence: [{ source: "GPT_5_MINI_OBSERVATION", fields: { year: "2024" } }],
    field_flow: { fields: [{ field_group: "year", rendered_values: ["2024"] }] },
    coverage: { missing_required_node_count: 0 }
  },
  l2_candidate_debug: {
    selected_candidate_id: "candidate-a",
    selected_candidate_safe_field_application: {
      field_reasons: { year: "trusted_reviewed_current_source_semantic_fill" }
    },
    selected_candidate_decision: {
      selected_candidate_id: "candidate-a",
      selected_candidate_group_ids: ["candidate-a", "candidate-a-sibling"]
    },
    candidate_application_trace: [
      { candidate_id: "candidate-a", candidate_identity_id: "identity-a", candidate_lane: "catalog", retrieval_rank: 1, anchor_agreement: { agreed: ["year"] }, source_trust: "OFFICIAL" },
      { candidate_id: "candidate-b", candidate_identity_id: "identity-b", candidate_lane: "vector", retrieval_rank: 1 }
    ],
    retrieval_application: { decisions: [{
      candidate_id: "candidate-a",
      field: "year",
      resolver_field: "year",
      candidate_value: "2024",
      resolver_value: "2024",
      old_value: null,
      final_value: "2024",
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
assert.equal(trace.cards[0].evidence_observations[1].raw_text, "TEST PLAYER CARD 17");
assert.equal(trace.cards[0].evidence_observations[2].source, "GOOGLE_VISION_OCR");
assert.equal(trace.cards[0].retrieval_candidates.length, 2);
assert.equal(trace.cards[0].retrieval_candidates[0].rank, 1);
assert.deepEqual(trace.cards[0].retrieval_candidates[0].anchor_agreement, { agreed: ["year"] });
assert.equal(trace.cards[0].retrieval_candidates[0].source_trust, "OFFICIAL");
assert.equal(trace.cards[0].application_decisions[0].applied, true);
assert.equal(trace.cards[0].application_decisions[0].old_value, null);
assert.equal(trace.cards[0].application_decisions[0].final_value, "2024");
assert.equal(trace.cards[0].application_decisions[0].source_field, "year");
assert.equal(trace.cards[0].application_decisions[0].application_plan_reason, "trusted_reviewed_current_source_semantic_fill");
assert.deepEqual(trace.cards[0].selected_candidate_group_ids, ["candidate-a", "candidate-a-sibling"]);
assert.equal(trace.cards[0].renderer_fields.year, "2024");
assert.equal(trace.cards[0].instrumentation.sensor_evidence_instrumented, true);
assert.equal(trace.cards[0].stage_trace.length, 7);
assert.equal(trace.cards[0].stage_trace[0].input_version, "v4-native-pipeline-contract-v2:test-v1");
assert.equal(trace.cards[0].stage_trace[6].final_decision_owner, "DETERMINISTIC_RENDERER");
assert.deepEqual(trace.cards[0].instrumentation.pipeline_contract_violations, []);

const fieldFlowFallback = buildV4ChainOracleTraceFromSmoke([{ results: [{
  source_feedback_id: "card-2",
  ok: true,
  pipeline_node_ledger: {
    field_flow: {
      fields: [{
        field_group: "subject",
        raw_provider_present: true,
        raw_values: ["Test Player"],
        rendered_values: ["Test Player"]
      }]
    }
  }
}] }]);
assert.equal(fieldFlowFallback.cards[0].evidence_observations[0].source, "GPT_5_MINI_PROVIDER_FIELD_FLOW");
assert.deepEqual(fieldFlowFallback.cards[0].evidence_observations[0].fields.players, ["Test Player"]);
assert.equal(fieldFlowFallback.cards[0].instrumentation.sensor_evidence_mode, "provider_field_flow_fallback");

const recoveredDuplicate = buildV4ChainOracleTraceFromSmoke([
  { results: [{ source_feedback_id: "card-recovered", ok: false, error: "first attempt failed" }] },
  { results: [{
    source_feedback_id: "card-recovered",
    ok: true,
    resolved_fields: { year: "2025" },
    pipeline_node_ledger: { sensor_evidence: [{ fields: { year: "2025" } }] }
  }] }
]);
assert.equal(recoveredDuplicate.cards.length, 1);
assert.equal(recoveredDuplicate.cards[0].recognition_ok, true);
assert.equal(recoveredDuplicate.cards[0].resolver_fields.year, "2025");

const laterEquivalentWins = buildV4ChainOracleTraceFromSmoke([
  { results: [{ source_feedback_id: "same-score", ok: true, resolved_fields: { year: "2024" } }] },
  { results: [{ source_feedback_id: "same-score", ok: true, resolved_fields: { year: "2025" } }] }
]);
assert.equal(laterEquivalentWins.cards[0].resolver_fields.year, "2025");

console.log("v4 chain oracle trace adapter tests passed");
