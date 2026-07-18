#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildShadowRecognitionPolicyAudit } from "../lib/listing/v4/policy/recognition-policy-observer.mjs";
import { allHardInvariantsPassSnapshot, recognitionPolicyActions } from "../lib/listing/v4/policy/optimal-recognition-policy.mjs";

const unknown = buildShadowRecognitionPolicyAudit({
  payload: {},
  result: { resolved_fields: { year: "2024", product: "Topps Chrome", players: ["A Player"] } }
});
assert.equal(unknown.state.invariants.feasible, false);
assert.equal(unknown.decision.next_action, recognitionPolicyActions.REJECT_INVALID_INPUT);

const safe = buildShadowRecognitionPolicyAudit({
  payload: {
    v4_hard_invariant_snapshot: allHardInvariantsPassSnapshot(),
    preingestion_bundle_id: "bundle-1",
    v4_anchor_probe: { finalized: true, metrics: { direct_anchor_count: 1, anchor_count: 1 } }
  },
  result: {
    provider: "v4_anchor_router",
    exact_anchor_finalize: { used: true },
    resolved_fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["A Player"],
      collector_number: "136"
    },
    field_states: {
      year: { display_status: "NORMAL", field_value: "2024", resolution_confidence: 0.99 },
      product: { display_status: "NORMAL", field_value: "Topps Chrome", resolution_confidence: 0.99 },
      subject: { display_status: "NORMAL", field_value: ["A Player"], resolution_confidence: 0.99 },
      card_number: { display_status: "NORMAL", field_value: "136", resolution_confidence: 0.99 }
    },
    catalog_activation_funnel: { query_attempted: true, raw_candidate_count: 1 }
  }
});
assert.equal(safe.state.invariants.feasible, true);
assert.equal(safe.state.evidence.catalog.unique_exact_match, true);
assert.equal(safe.decision.next_action, recognitionPolicyActions.STOP_AND_RENDER);
assert.equal(safe.can_execute, false);

const ambiguous = buildShadowRecognitionPolicyAudit({
  payload: { v4_hard_invariant_snapshot: allHardInvariantsPassSnapshot() },
  result: {
    provider: "openai_legacy",
    resolved_fields: { year: "2024", product: "Topps Chrome", players: ["A Player"] },
    catalog_activation_funnel: { query_attempted: true, raw_candidate_count: 3 },
    selected_candidate_decision: { selection_margin: 0.02 }
  }
});
assert.equal(ambiguous.state.evidence.catalog.candidate_count, 3);
assert.equal(ambiguous.decision.feasible_actions.includes(recognitionPolicyActions.RUN_VECTOR_RETRIEVAL), true);

console.log("Recognition policy observer tests passed");
