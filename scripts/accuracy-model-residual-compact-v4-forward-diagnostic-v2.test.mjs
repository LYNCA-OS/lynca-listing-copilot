#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP,
  buildCompactV4ForwardDiagnosticV2,
  classifyCompactV4ResolverOutcomeV2,
  projectCompactV4CurrentCanonicalFields
} from "../lib/listing/evaluation/model-residual-compact-v4-forward-diagnostic-v2.mjs";

const baseFields = {
  year: "2025", ip: "", language: "", manufacturer: "Topps",
  product: "Chrome", set: "Kaiju", subjects: ["Caleb Williams"], team: "Bears",
  card_name: "", card_number: "KAI-5", descriptive_rarity: "", serial: "05/10",
  release_variant: "", print_finish: "Gold Refractor", special_stamp: "",
  grading_info: { company: "PSA", card_grade: "9", auto_grade: "", grade_type: "CARD_ONLY" },
  description: "", components: ["RC"], lot_count: "", attributes: ["RC"]
};
const projected = projectCompactV4CurrentCanonicalFields(baseFields);
assert.deepEqual(projected, {
  year: "2025", ip_sport: "", language: "", manufacturer: "Topps",
  product: "Chrome", set: "Kaiju", subject: ["Caleb Williams"], card_name: "",
  card_number: "KAI-5", descriptive_rarity: "", numerical_rarity: "05/10",
  release_variant: "", print_finish: "Gold Refractor", special_stamp: "",
  grading_info: { auto_grade: "", card_grade: "9", company: "PSA", grade_type: "CARD_ONLY" },
  description: "", search_optimization: ["RC", "Bears"], lot_quantity: ""
});
assert.deepEqual(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP.subject, ["subjects"]);
assert.deepEqual(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP.numerical_rarity, ["serial"]);
assert.deepEqual(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP.grading_info, ["grading_info"]);
assert.equal(JSON.stringify(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP).includes("players"), false);
assert.equal(JSON.stringify(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP).includes("serial_number"), false);
assert.equal(JSON.stringify(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP).includes("grade_company"), false);
assert.equal(JSON.stringify(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP).includes("cert_number"), false);

const canonicalTitle = "2025 Topps Chrome Kaiju Caleb Williams Gold Refractor 05/10 RC PSA 9";
const safeRejection = classifyCompactV4ResolverOutcomeV2({
  canonicalFields: baseFields,
  canonicalTitle,
  resolved: { accepted: false, defects: [], fields: baseFields, title: canonicalTitle }
});
assert.equal(safeRejection.classification, "SAFE_GUARD_REJECTION_NO_OUTPUT_CHANGE");
assert.equal(safeRejection.safe_guard_rejection_no_output_change, true);
assert.equal(safeRejection.output_field_disagreement, false);
assert.equal(safeRejection.field_regression, null);
assert.equal(safeRejection.factual_regression, null);

const reorderedFields = Object.fromEntries(Object.entries(baseFields).reverse());
const reorderedRejection = classifyCompactV4ResolverOutcomeV2({
  canonicalFields: baseFields,
  canonicalTitle,
  resolved: { accepted: false, defects: [], fields: reorderedFields, title: canonicalTitle }
});
assert.equal(reorderedRejection.safe_guard_rejection_no_output_change, false,
  "the guard rollback invariant is byte equality, not merely semantic equality");
assert.equal(reorderedRejection.classification, "GUARD_REJECTION_WITH_OUTPUT_DISAGREEMENT");
assert.equal(reorderedRejection.field_regression, null,
  "even an output disagreement is not factual regression without typed gold");

const treatmentFields = { ...baseFields, product: "Topps Chrome", subjects: ["C. Williams"],
  serial: "", grading_info: { ...baseFields.grading_info, card_grade: "10" } };
const secondFields = { ...baseFields, product: "A Product Name With Seven Printed Words" };
const checkpoint = {
  schema_version: "cloud-residual-compact-v4-run-contract-v1",
  state: "COMPLETE",
  jobs: {
    "a:control": { asset_id: "a", arm: "control", result: {
      canonical_fields: baseFields, canonical_title: canonicalTitle,
      canonical_field_defects: []
    } },
    "a:treatment": { asset_id: "a", arm: "treatment", result: {
      canonical_fields: treatmentFields, canonical_title: canonicalTitle,
      canonical_field_defects: [], resolved: { accepted: false, defects: [],
        fields: treatmentFields, title: canonicalTitle }
    } },
    "b:treatment": { asset_id: "b", arm: "treatment", result: {
      canonical_fields: secondFields, canonical_title: "second",
      canonical_field_defects: ["product_looks_like_a_title"],
      resolved: { accepted: true, defects: [], fields: secondFields, title: "second" }
    } }
  }
};
const analysis = {
  schema_version: "model-residual-compact-v4-cloud-analysis-v1",
  gate: { decision: "STOP_HARD_REGRESSION" },
  treatment_rows: [
    { asset_id: "a", resolved_field_regression: true,
      canonical_critical_field_regression: true, invalid_compact_value: false,
      title_over_80: false },
    { asset_id: "b", resolved_field_regression: false,
      canonical_critical_field_regression: false, invalid_compact_value: true,
      title_over_80: false }
  ],
  control_rows: [{ asset_id: "a" }]
};
const diagnostic = buildCompactV4ForwardDiagnosticV2({ checkpoint, analysis });
assert.equal(diagnostic.source.frozen_gate_decision, "STOP_HARD_REGRESSION");
assert.equal(diagnostic.source.frozen_gate_result_unchanged, true);
assert.equal(diagnostic.summary.safe_guard_rejection_no_output_change_cards, 1,
  "the frozen analyzer's accepted=false row is correctly reclassified as a safe rollback");
assert.equal(diagnostic.summary.resolver_output_field_disagreement_cards, 0);
assert.equal(diagnostic.summary.paired_canonical_disagreement_cards, 1);
assert.equal(diagnostic.summary.schema_policy_heuristic_rows, 1);
assert.equal(diagnostic.summary.invalid_compact_value_cards, 1);
const pair = diagnostic.paired_canonical_comparisons[0];
assert.equal(pair.classification, "PAIRED_MODEL_OUTPUT_DISAGREEMENT_NO_TRUTH_AUTHORITY");
assert.deepEqual(pair.changed_fields.map((row) => row.canonical_field),
  ["product", "subject", "numerical_rarity", "grading_info"]);
assert.equal(pair.factual_regression, null);
assert.equal(pair.critical_factual_regression, null);
assert.deepEqual(diagnostic.shape_heuristic_findings, [{
  asset_id: "b", arm: "treatment", classification: "SCHEMA_POLICY_HEURISTIC",
  heuristics: ["product_looks_like_a_title"], factual_truth: false, factual_error: null
}]);
assert.deepEqual(diagnostic.factual_metrics, {
  availability: "UNAVAILABLE_WITHOUT_INDEPENDENT_TYPED_GOLD",
  independent_typed_gold_cards: 0,
  factual_regression_cards: null,
  critical_factual_regression_cards: null,
  resolver_factual_regression_cards: null,
  paired_canonical_factual_regression_cards: null,
  shape_factual_error_cards: null
});
assert.equal(diagnostic.interpretation.diagnostic_decision,
  "NO_PROMOTION_DECISION_SUPPLEMENT_ONLY");
assert.equal(diagnostic.production_authorized, false);
assert.throws(() => buildCompactV4ForwardDiagnosticV2({ checkpoint, analysis,
  independentTypedGoldCards: 1 }), /typed_gold_not_supported/);

process.stdout.write("model residual compact v4 forward diagnostic v2: ok\n");
