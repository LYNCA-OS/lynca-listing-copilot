#!/usr/bin/env node

import assert from "node:assert/strict";

import { foldFor } from "../lib/listing/evaluation/kfold-few-shot.mjs";
import { distillWriterTitleEvidenceV1 } from
  "../lib/listing/evaluation/writer-title-evidence-distillation-v1.mjs";
import {
  buildHeldoutProductPhraseBankV1,
  computePhraseBankExecutableBoundsV1,
  computeWriterTitlePhraseParetoV1,
  evaluateKfoldProductPhraseExtensionV1,
  proposeHeldoutProductPhraseExtensionV1
} from "../lib/listing/evaluation/writer-title-product-phrase-pareto-v1.mjs";
import { writeWriterTitleProductPhraseParetoV1 } from
  "./run-writer-title-product-phrase-pareto-v1.mjs";

const fields = ({ product = "Topps Chrome", subject = "Player", lot = "" } = {}) => ({
  year: "2024", manufacturer: "Topps", product, set: "", subjects: [subject],
  team: "", card_name: "", release_variant: "", surface_color: "",
  parallel_family: "", parallel_exact: "", print_finish: "",
  descriptive_rarity: "", card_number: "", serial: "", attributes: [], grade: "",
  grammar: lot ? "lot" : "standard", lot_count: lot, unreadable: [],
  low_confidence: [], ip: "", language: "", components: []
});

function assetForFold(wanted, prefix) {
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (foldFor(candidate) === wanted) return candidate;
  }
  throw new Error("test_asset_fold_not_found");
}

const trainingRows = [
  { asset_id: "train_a", writer_title: "2024 Topps Chrome Platinum Alice",
    candidate_fields: fields({ subject: "Alice" }),
    source_backing: [{ source: "exhaustive_model_observation",
      value: "TOPPS CHROME PLATINUM Alice" }] },
  { asset_id: "train_b", writer_title: "2023 Topps Chrome Platinum Bob",
    candidate_fields: fields({ subject: "Bob" }),
    source_backing: [{ source: "exhaustive_model_observation",
      value: "Topps Chrome Platinum Bob" }] }
];
const bank = buildHeldoutProductPhraseBankV1(trainingRows);
assert.deepEqual(bank.map((entry) => [entry.value, entry.support_cards]),
  [["Chrome Platinum", 2]]);

const heldout = {
  candidateFields: fields({ subject: "Heldout" }),
  sourceBacking: [{ source: "exhaustive_model_observation",
    value: "2024 TOPPS CHROME PLATINUM Heldout" }],
  phraseBank: bank
};
const proposal = proposeHeldoutProductPhraseExtensionV1(heldout);
assert.equal(proposal.changed, true);
assert.equal(proposal.after, "Topps Chrome Platinum");
assert.deepEqual(proposal.added_product_tokens, ["platinum"]);
// An unexpected held-out label property cannot influence an API that never
// accepts or reads it.
assert.deepEqual(proposeHeldoutProductPhraseExtensionV1({ ...heldout,
  writerTitle: "completely different label" }), proposal);
assert.equal(proposeHeldoutProductPhraseExtensionV1({ ...heldout,
  sourceBacking: [{ source: "exhaustive_model_observation", value: "Topps Chrome" }] }).changed,
false);
assert.equal(proposeHeldoutProductPhraseExtensionV1({ ...heldout,
  candidateFields: fields({ lot: "3" }) }).reason, "lot_product_extension_disallowed");
assert.equal(proposeHeldoutProductPhraseExtensionV1({ ...heldout,
  phraseBank: [{ value: "Chrome Series 2", token_key: "chrome series 2",
    token_count: 3, support_cards: 99 }] }).changed, false);
assert.throws(() => proposeHeldoutProductPhraseExtensionV1({ ...heldout,
  sourceBacking: [{ source: "canonical_model_fields",
    value: { reviewed_title: "label leak" } }] }), /label_leak_in_source/);

const heldoutAsset = assetForFold(0, "heldout");
const trainAssetA = assetForFold(1, "train_a");
const trainAssetB = assetForFold(1, "train_b");
const rows = [{
  asset_id: heldoutAsset,
  writer_title: "2024 Topps Chrome Platinum Heldout",
  candidate_title: "2024 Topps Chrome Heldout",
  candidate_fields: fields({ subject: "Heldout" }),
  source_backing: heldout.sourceBacking
}, ...trainingRows.map((row, index) => ({
  ...row,
  asset_id: index ? trainAssetB : trainAssetA,
  candidate_title: row.writer_title.replace(" Platinum", "")
}))];
const screen = evaluateKfoldProductPhraseExtensionV1(rows);
const heldoutCard = screen.cards.find((card) => card.asset_id === heldoutAsset);
assert.equal(heldoutCard.proposal.after, "Topps Chrome Platinum");
assert.equal(heldoutCard.composer_guard.accepted, true);
assert.ok(heldoutCard.writer_title_proxy_score.delta_f1 > 0);
assert.equal(screen.preregistered_method.heldout_writer_title_visible_to_candidate_selection,
  false);
assert.equal(screen.summary.accepted_lost_title_token_occurrences, 0);
assert.equal(screen.factual_metrics.typed_field_precision, null);
assert.equal(screen.factual_metrics.factual_regression_cards, null);

const distillation = distillWriterTitleEvidenceV1(rows, { minimumWriterTitles: 3 });
const pareto = computeWriterTitlePhraseParetoV1(distillation);
assert.equal(pareto.selected_next_step, "product");
assert.ok(pareto.pareto_frontier.includes("product"));
assert.deepEqual(pareto.ineligible, [{ arm: "compact_residual_schema_retry", status: "STOP",
  reason: "previously_stopped_schema_cannot_be_revived_by_writer_title_proxy" }]);
assert.equal(pareto.factual_metrics.factual_precision, null);
const bounds = computePhraseBankExecutableBoundsV1(rows, distillation, screen);
assert.ok(bounds.bounds.product.label_blind_crossfold_executable_cards >= 1);
assert.equal(bounds.bounds.set.label_blind_crossfold_executable_cards, 0);
assert.equal(bounds.canonical_field_mapping.slab,
  "candidate_fields.grading_info_or_grade");
assert.equal(bounds.recommendation, "CONTINUE_SELECTED_EVALUATION_ONLY_SCREEN");
assert.equal(bounds.factual_metrics.factual_regression_cards, null);

await assert.rejects(writeWriterTitleProductPhraseParetoV1({}),
  /requires_label_aware_development_only/);

process.stdout.write("writer-title product phrase Pareto v1: ok\n");
