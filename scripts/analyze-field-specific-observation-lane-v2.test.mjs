#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyzeObservationLaneV2 } from "./analyze-field-specific-observation-lane-v2.mjs";

const ledger = JSON.parse(readFileSync(
  "docs/evaluation/bare-canonical-complementarity-150-2026-08-02.json", "utf8"));
const hypotheses = readFileSync(
  "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl", "utf8")
  .split("\n").filter(Boolean).map(JSON.parse);

const result = analyzeObservationLaneV2(ledger, hypotheses);
assert.deepEqual(result.decomposition_85.mutually_exclusive_role_occurrences, {
  downstream_existing: 38,
  identity_phrase: 30,
  finish_phrase: 10,
  commercial_marker: 6,
  exact_code: 1
});
assert.equal(result.decomposition_85.capture_target.token_occurrences, 47);
assert.equal(result.decomposition_85.capture_target.complete_phrases, 39);
assert.equal(result.decomposition_85.capture_target.cards, 30);
assert.equal(result.decomposition_85.capture_target.max_phrases_on_one_card, 2);
assert.deepEqual(result.decomposition_85.capture_target.cap_coverage[2], {
  covered_phrases: 39,
  total_phrases: 39
});
assert.equal(result.theoretical_value.canonical_macro_f1, 0.767764);
assert.equal(result.theoretical_value.all_capture_targets_label_oracle.delta, 0.019718);
assert.equal(result.theoretical_value.all_capture_targets_label_oracle.under_80_phrase_subset_delta, 0.015374);
assert.equal(result.v1_audit.prompt_addressable_tokens, 30);
assert.equal(result.request_cost.literal_v2_vs_control.delta.request_bytes
  < result.request_cost.v1_vs_control.delta.request_bytes, true);
assert.equal(result.product_set_parallel_hypothesis.strict_85_ledger_target.unique_tokens_beyond_literal_v2, 0);
assert.equal(result.product_set_parallel_hypothesis.status, "HOLD_SEPARATE_ARM_NOT_DEFAULT");
assert.equal(result.slab_anchor.status, "DEFER_NO_VERIFIED_REGISTRY_COVERAGE");
assert.equal(result.slab_anchor.independent_from_literal_v2, true);
assert.equal(result.slab_anchor.literal_v2_rows_consumed, 0);
assert.equal(result.slab_anchor.literal_v2_max_rows_unchanged, 2);
assert.equal(result.slab_anchor.default_schema_enabled, false);
assert.equal(result.slab_anchor.paid_arm_enabled, false);
assert.equal(result.slab_anchor.registry_evidence.live_row_coverage_verified, false);
assert.equal(result.slab_anchor.observed_opportunity.exact_single_cert_cards, 37);
assert.equal(result.slab_anchor.observed_opportunity.conflicting_cert_cards, 0);
// Renamed with the invariant it checks. The old field asked whether the
// EVALUATION HARNESS imports the experimental lane, and the harness does --
// `thin_canonical_field_observation_v2_high` is a declared arm whose job is to
// measure it, so the assertion forbade the one place the import belongs. The
// boundary that matters is the shipped path, and it is clean.
assert.equal(result.boundaries.shipped_path_imports_v2_or_hypothesis, false);
assert.deepEqual(result.boundaries.shipped_path_leaks, []);
assert.equal(result.boundaries.provider_calls, 0);
assert.equal(result.decision.literal_v2, "GO_TO_PAIRED_FRESH150_EXPERIMENT_ONLY");
assert.equal(result.decision.literal_v2_production, "STOP");
assert.equal(result.minimum_fresh150_experiment.calls_if_literal_only, 300);
assert.equal(result.minimum_fresh150_experiment.calls_if_shared_control_plus_both_separate_treatments, 450);

console.log("field-specific observation lane v2 analysis tests passed");
