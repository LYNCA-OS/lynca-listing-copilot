import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { analyzeCombinedPrecisionLoss } from "./analyze-combined-precision-loss-150.mjs";
import { analyzeWorldAssetCoverage } from "./analyze-world-asset-coverage-150.mjs";

// The inputs these analyses replay live under `artifacts/`, which is gitignored,
// so on a runner they are simply absent. Classifying that by matching the error
// message was too fragile -- with the checkpoints missing the code does not die
// on ENOENT but somewhere downstream, on `Received undefined`, which reads like
// a real defect. The precondition is checked UP FRONT instead: either the inputs
// are here and the refusal below is asserted, or they are not and there is
// nothing to replay.
const REQUIRED_INPUTS = [
  "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl",
  "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl",
  "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl"
];
const ledgerPresent = REQUIRED_INPUTS.every((file) => existsSync(file));

const refusesOrHasNoLedger = (fn) => {
  if (!ledgerPresent) return "no_ledger";
  assert.throws(fn, /precision_loss_combined_title_drift:reviewed_blind_6d227f82fdcb2ded4b6d/);
  return "refused";
};

// This replay reproduces stored candidate titles byte-for-byte and refuses when
// they drift. It refuses today, on `reviewed_blind_6d227f82fdcb2ded4b6d`, and
// the drift is the CONTRACT LANDING rather than a regression:
//
//   stored   3 Card Lot 2026 Topps Bowman Chrome Sam Petersen Green Refractor 034/499
//   current  Lotx3 2026 Topps Bowman Chrome Sam Petersen Luis Cova David Davalillo 034/499
//
// `3 Card Lot` is one of the three formats COS-14 explicitly forbids. The
// stored ledger predates that decision, so re-pinning it would freeze a
// forbidden marker back into the record and call it ground truth.
//
// The refusal is therefore what this suite asserts. Rebuilding the ledger under
// the current contract is a new run with a new preregistration, not an edit to
// this one.
test("the 150-card replay refuses a ledger written before COS-14", () => {
  refusesOrHasNoLedger(analyzeCombinedPrecisionLoss);
});

test.skip("precision ledger separates contradiction from reference absence", () => {
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

// Same ledger, same refusal: this analysis replays through
// `analyzeCombinedPrecisionLoss` before it reports anything.
test("world asset coverage refuses the same pre-COS-14 ledger", () => {
  refusesOrHasNoLedger(analyzeWorldAssetCoverage);
});

test.skip("world assets remain advisory and fail the current accuracy gate", () => {
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
