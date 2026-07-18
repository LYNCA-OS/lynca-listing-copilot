#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildFullInformationReplay,
  evaluateFullInformationReplay,
  fitRecognitionTransitionModelFromReplay,
  normalizeSemFields,
  selectFeasibleLaunchPolicies
} from "../lib/listing/v4/policy/full-information-replay.mjs";
import { buildReplayFromSourceDocuments } from "../lib/listing/v4/policy/replay-source-adapters.mjs";
import {
  allHardInvariantsPassSnapshot,
  feasibleRecognitionActions,
  normalizeRecognitionPolicyState,
  recognitionPolicyActions,
  solveOptimalRecognitionPolicy
} from "../lib/listing/v4/policy/optimal-recognition-policy.mjs";
import { normalizeHardInvariantSnapshot } from "../lib/listing/v4/policy/hard-invariant-spec.mjs";
import { evaluateShadowPolicy } from "./evaluate-optimal-recognition-policy.mjs";

const passInvariants = allHardInvariantsPassSnapshot();

const invalidState = normalizeRecognitionPolicyState({ invariants: {} });
assert.deepEqual(feasibleRecognitionActions(invalidState), [recognitionPolicyActions.REJECT_INVALID_INPUT]);
assert.equal(solveOptimalRecognitionPolicy({ state: invalidState }).next_action, recognitionPolicyActions.REJECT_INVALID_INPUT);

const safeState = normalizeRecognitionPolicyState({
  invariants: passInvariants,
  evidence: {
    global_risk: 0.02,
    critical_field_risk: 0.01,
    direct_conflict_count: 0,
    field_states: { year: { confidence: 0.99 }, subject: { confidence: 0.99 } },
    cheap_evidence_ready: true,
    catalog: { attempted: true, candidate_count: 1, unique_exact_match: true, top_margin: 1 },
    vector: { attempted: true },
    gpt: { attempted: true },
    focused_verifier: { attempted: true },
    external_retrieval: { attempted: true }
  }
});

const unknownRiskState = normalizeRecognitionPolicyState({
  invariants: passInvariants,
  evidence: {
    global_risk: null,
    critical_field_risk: null,
    field_states: {}
  }
});
assert.equal(unknownRiskState.evidence.global_risk, 1, "missing global risk must remain fail-closed");
assert.equal(unknownRiskState.evidence.critical_field_risk, 1, "missing critical risk must remain fail-closed");
assert.ok(feasibleRecognitionActions(safeState).includes(recognitionPolicyActions.STOP_AND_RENDER));
assert.equal(solveOptimalRecognitionPolicy({ state: safeState }).next_action, recognitionPolicyActions.STOP_AND_RENDER);

const ambiguousCatalogState = normalizeRecognitionPolicyState({
  invariants: passInvariants,
  evidence: {
    global_risk: 0.4,
    critical_field_risk: 0.3,
    cheap_evidence_ready: true,
    exact_anchor_count: 1,
    catalog: { attempted: true, candidate_count: 3, top_margin: 0.04, unique_exact_match: false },
    gpt: { attempted: true }
  }
});
assert.ok(feasibleRecognitionActions(ambiguousCatalogState).includes(recognitionPolicyActions.RUN_VECTOR_RETRIEVAL));

const exactCatalogState = normalizeRecognitionPolicyState({
  invariants: passInvariants,
  evidence: {
    global_risk: 0.2,
    critical_field_risk: 0.1,
    cheap_evidence_ready: true,
    exact_anchor_count: 1,
    catalog: { attempted: true, candidate_count: 1, top_margin: 1, unique_exact_match: true },
    gpt: { attempted: true }
  }
});
assert.equal(feasibleRecognitionActions(exactCatalogState).includes(recognitionPolicyActions.RUN_VECTOR_RETRIEVAL), false);

const conflictState = normalizeRecognitionPolicyState({
  invariants: passInvariants,
  evidence: {
    global_risk: 0.3,
    critical_field_risk: 0.4,
    direct_conflict_count: 1,
    cheap_evidence_ready: true,
    catalog: { attempted: true, candidate_count: 1 },
    gpt: { attempted: true }
  }
});
assert.ok(feasibleRecognitionActions(conflictState).includes(recognitionPolicyActions.RUN_FOCUSED_VERIFIER));

assert.deepEqual(normalizeSemFields({ players: ["Michael Jordan"], subjects: ["Scottie Pippen"] }).subject, [
  "michael jordan",
  "scottie pippen"
]);

const expectedActions = [
  recognitionPolicyActions.RUN_CHEAP_EVIDENCE,
  recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP,
  recognitionPolicyActions.RUN_GPT_OBSERVATION
];
const cards = [
  {
    query_card_id: "card-1",
    truth: {
      provenance: "REVIEWED_FIELD_GT",
      fields: {
        year: "2024-25",
        manufacturer: "Panini",
        product: "Immaculate",
        subject: ["Anthony Edwards"],
        numerical_rarity: "2/3",
        grade: "BGS 8.5/10"
      },
      critical_fields: ["year", "product", "subject", "numerical_rarity", "grade"]
    },
    expected_actions: expectedActions,
    action_observations: [
      {
        action: recognitionPolicyActions.RUN_CHEAP_EVIDENCE,
        technical_success: true,
        latency_ms: 600,
        field_predictions: { year: "2024-25", subject: ["Anthony Edwards"], numerical_rarity: "2/3" }
      },
      {
        action: recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP,
        technical_success: true,
        latency_ms: 300,
        field_predictions: { manufacturer: "Panini", product: "Immaculate", subject: ["Anthony Edwards"] }
      },
      {
        action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
        technical_success: true,
        latency_ms: 20_000,
        field_predictions: { grade: "BGS 8.5/10", numerical_rarity: "2/3" }
      }
    ]
  },
  {
    query_card_id: "card-2",
    truth: {
      provenance: "REVIEWED_FIELD_GT",
      fields: { year: "2023", product: "Pokemon 151", subject: ["Charizard ex"], card_number: "201/165" }
    },
    expected_actions: expectedActions,
    action_observations: [
      {
        action: recognitionPolicyActions.RUN_CHEAP_EVIDENCE,
        technical_success: true,
        latency_ms: 500,
        field_predictions: { year: "2023", card_number: "201/165" }
      },
      {
        action: recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP,
        technical_success: true,
        latency_ms: 250,
        field_predictions: { product: "Pokemon 151", subject: ["Charizard ex"], card_number: "201/165" }
      },
      {
        action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
        technical_success: true,
        latency_ms: 18_000,
        field_predictions: { subject: ["Charizard ex"] }
      }
    ]
  }
];

const replay = buildFullInformationReplay({ cards });
const evaluation = evaluateFullInformationReplay(replay);
assert.equal(evaluation.data_quality.full_information_oracle_evaluable_count, 2);
assert.equal(evaluation.chain_oracle.sem_exact_count, 2);
assert.equal(evaluation.chain_oracle.sem_accuracy_upper_bound, 1);
assert.equal(evaluation.per_card[0].minimum_actions.minimum_latency.actions.length, 3);
assert.equal(evaluation.target_frontier.find((row) => row.target === 0.87).minimum_latency_policy.sem_accuracy, 1);
assert.equal(evaluation.launch_policy_candidates.some((policy) => policy.launch_feasible), true);

const singleSlotLaunchPolicies = selectFeasibleLaunchPolicies(evaluation, {
  effectiveCapacitySlots: 1
});
assert.equal(singleSlotLaunchPolicies.some((policy) => policy.launch_feasible), false);
assert.equal(singleSlotLaunchPolicies.some((policy) => policy.launch_blockers.includes("THROUGHPUT_BELOW_GATE")), true);

const unreliableLaunchPolicies = selectFeasibleLaunchPolicies({
  pareto_frontier: [{
    actions: [recognitionPolicyActions.RUN_GPT_OBSERVATION],
    sem_accuracy: 0.95,
    critical_field_accuracy: 0.99,
    technical_failure_rate: 0.02,
    cards_per_minute_per_capacity_slot: 6
  }]
});
assert.deepEqual(unreliableLaunchPolicies[0].launch_blockers, ["TECHNICAL_FAILURE_ABOVE_GATE"]);

const proxyReplay = buildFullInformationReplay({
  cards: [{
    query_card_id: "proxy-only",
    truth: { provenance: "TITLE_PROXY_ONLY", fields: { year: "2024" } },
    expected_actions: [recognitionPolicyActions.RUN_GPT_OBSERVATION],
    action_observations: [{
      action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
      technical_success: true,
      field_predictions: { year: "2024" }
    }]
  }]
});
const proxyEvaluation = evaluateFullInformationReplay(proxyReplay);
assert.equal(proxyEvaluation.data_quality.full_information_oracle_evaluable_count, 0);
assert.equal(proxyEvaluation.data_quality.oracle_claim_blocked, true);
assert.equal(proxyEvaluation.chain_oracle.sem_accuracy_upper_bound, null);

const adapted = buildReplayFromSourceDocuments([{
  path: "legacy-report.json",
  document: {
    schema_version: "v4-ebay-smoke-v1",
    results: [{
      asset_id: "legacy-1",
      ok: true,
      seller_title: "2024 Topps Chrome Example",
      provider_latency_ms: 12_000,
      l2_candidate_debug: {
        catalog_activation_funnel: { query_attempted: true, raw_candidate_count: 5 }
      },
      v4_pipeline_contract: {
        shadow_recognition_policy: {
          observation_point: "TERMINAL_PIPELINE_STATE",
          state: safeState
        }
      }
    }]
  }
}]);
assert.equal(adapted.cards.length, 1);
assert.equal(adapted.cards[0].truth.oracle_evaluable, false);
assert.equal(adapted.cards[0].policy_state_snapshots.length, 1);
assert.equal(evaluateFullInformationReplay(adapted).data_quality.oracle_claim_blocked, true);

const riskCards = Array.from({ length: 5 }, (_, index) => ({
  query_card_id: `risk-${index}`,
  truth: { provenance: "REVIEWED_FIELD_GT", fields: { year: "2024" } },
  expected_actions: [recognitionPolicyActions.RUN_CHEAP_EVIDENCE],
  action_observations: [{
    action: recognitionPolicyActions.RUN_CHEAP_EVIDENCE,
    technical_success: true,
    latency_ms: 500 + index,
    state_before: { evidence: { global_risk: 0.5, critical_field_risk: 0.4 } },
    state_after: { evidence: { global_risk: 0.25, critical_field_risk: 0.2 } },
    field_predictions: { year: "2024" }
  }]
}));
const fitted = fitRecognitionTransitionModelFromReplay(buildFullInformationReplay({ cards: riskCards }));
assert.equal(fitted.fitted_from_replay, true);
assert.equal(fitted.fit_quality.RUN_CHEAP_EVIDENCE.outcomes_fitted, true);
assert.equal(fitted.action_models.RUN_CHEAP_EVIDENCE.latency_ms, 502);

const shadowReplay = buildFullInformationReplay({
  cards: [{
    query_card_id: "shadow-1",
    truth: { provenance: "REVIEWED_FIELD_GT", fields: { year: "2024" } },
    expected_actions: [recognitionPolicyActions.RUN_GPT_OBSERVATION],
    action_observations: [{
      action: recognitionPolicyActions.RUN_GPT_OBSERVATION,
      technical_success: true,
      state_before: {
        invariants: passInvariants,
        evidence: {
          global_risk: 0.02,
          critical_field_risk: 0.01,
          cheap_evidence_ready: true,
          catalog: { attempted: true, candidate_count: 1, unique_exact_match: true, top_margin: 1 },
          vector: { attempted: true },
          gpt: { attempted: true },
          focused_verifier: { attempted: true },
          external_retrieval: { attempted: true }
        }
      },
      field_predictions: { year: "2024" }
    }]
  }]
});
const shadow = evaluateShadowPolicy({ replay: shadowReplay, transitionModel: fitted });
assert.equal(shadow.state_snapshot_count, 1);
assert.equal(shadow.decisions[0].shadow_next_action, recognitionPolicyActions.STOP_AND_RENDER);
assert.equal(shadow.promotion_eligible, false);

const failedInvariantSnapshot = normalizeHardInvariantSnapshot({
  checks: {
    DURABLE_ASSET_ID: false,
    TENANT_ASSET_OWNERSHIP: true,
    IMMUTABLE_IMAGE_GENERATION: true,
    VERIFIED_CANONICAL_IMAGE_SET: true,
    CANONICAL_STORAGE_SCOPE: true,
    SINGLE_EXECUTION_IDENTITY: true
  }
});
assert.equal(failedInvariantSnapshot.feasible, false);

console.log("Optimal recognition policy tests passed");
