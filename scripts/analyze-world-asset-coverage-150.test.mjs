import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCombinedPrecisionLoss } from "./analyze-combined-precision-loss-150.mjs";
import { analyzeWorldAssetCoverage } from "./analyze-world-asset-coverage-150.mjs";

test("precision ledger separates contradiction from reference absence", () => {
  const report = analyzeCombinedPrecisionLoss();
  const classified = Object.values(report.breakdown.by_primary_classification)
    .reduce((sum, row) => sum + row.occurrences, 0);
  assert.equal(report.summary.cards, 150);
  assert.equal(report.summary.reference_absent_token_occurrences, 285);
  assert.equal(classified, 285);
  assert.deepEqual(report.breakdown.by_primary_classification.obvious_factual_error, { occurrences: 33, cards: 26 });
  assert.deepEqual(report.breakdown.by_primary_classification.possibly_useful_writer_omitted, { occurrences: 86, cards: 57 });
  assert.equal(report.breakdown.by_primary_classification.grammar_should_suppress.occurrences, 0);
  assert.equal(report.precision_heads.finish_competes_with_specific_reference_value.token_occurrences, 63);
  assert.equal(report.correctors.world_typed_year.cards, 1);
  assert.equal(report.correctors.release_graph.precision_correction_token_occurrences, 0);
  for (const card of report.cards) {
    for (const entry of card.reference_absent_tokens.filter((row) => row.classification.primary === "obvious_factual_error")) {
      assert.equal(entry.classification.reasons.includes("review_title_absence_only"), false);
      assert.equal(entry.classification.truth === "reference_same_role_contradiction"
        || entry.classification.truth === "reference_and_world_supported_alternative", true);
    }
  }
});

test("world assets remain advisory and fail the current accuracy gate", () => {
  const report = analyzeWorldAssetCoverage();
  assert.equal(report.provider_calls, 0);
  assert.equal(report.runtime_changes, 0);
  assert.equal(report.production_promoted, false);
  assert.equal(report.invariants.hard_rejection_allowed, false);
  assert.equal(report.relation_coverage.release_product_set_parallel.record_product_parallel_pairs, 0);
  assert.equal(report.relation_coverage.release_product_set_parallel.exact_supported_finish_candidate_cards, 0);
  assert.equal(report.target_delta_analysis.current_verified_final_title_world_delta, 0.00060606060606061);
  assert.equal(report.target_delta_analysis.all_clear_precision_errors_can_reach_target, false);
  assert.equal(report.decision.current_world_assets, "STOP_INSUFFICIENT_FINAL_TITLE_CORRECTION");
  assert.equal(report.decision.production, "STOP_UNTIL_FULL_150_RESOLVER_COMPOSER_REPLAY_PASSES");
});
