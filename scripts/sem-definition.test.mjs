import assert from "node:assert/strict";

import {
  SEM_FEEDBACK_LAYER,
  SEM_LINEAR_ISSUES,
  SEM_STANDARD_VERSION,
  classifySemNumberBoundary,
  classifyWriterFeedbackForSemanticLearning,
  semCatalogTrustVerdict,
  semDefinition,
  semIssueCoverage,
  semLotTitleOrder,
  semStandardTitleOrder,
  semTcgTitleOrder
} from "../lib/listing/csm/sem-definition.mjs";

assert.equal(SEM_STANDARD_VERSION, "linear-cos-10-14-v1");
assert.equal(semIssueCoverage(SEM_LINEAR_ISSUES), true);
assert.equal(semDefinition.marketplace_title_limit, 80);

assert.deepEqual(semStandardTitleOrder.slice(0, 6), [
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name"
]);
assert.deepEqual(semTcgTitleOrder.slice(0, 9), [
  "year",
  "ip",
  "language",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number"
]);
assert.deepEqual(semLotTitleOrder.slice(0, 4), [
  "lot_quantity",
  "year",
  "manufacturer_product_set",
  "subjects_max_3"
]);

assert.deepEqual(classifySemNumberBoundary("04/10"), {
  boundary: "NUMERICAL_RARITY",
  csm_field: "numerical_rarity",
  reason: "current_card_print_limit"
});
assert.deepEqual(classifySemNumberBoundary("SWS-LBJ"), {
  boundary: "CARD_NUMBER",
  csm_field: "card_number",
  reason: "printed_design_or_checklist_identifier"
});
assert.deepEqual(classifySemNumberBoundary("139/205", {
  grammar: "TCG",
  field: "card_number"
}), {
  boundary: "CARD_NUMBER",
  csm_field: "card_number",
  reason: "tcg_checklist_number_context"
});

const trustedCatalog = semCatalogTrustVerdict({
  sourceTrust: "APPROVED_REFERENCE",
  anchorAgreement: {
    exact_code_match: true,
    agreed: ["year", "subjects", "product_hierarchy"],
    contradicted: [],
    prompt_hard_filter_pass: true
  }
});
assert.equal(trustedCatalog.allowed, true);
assert.equal(trustedCatalog.reason, "trusted_catalog_with_observation_anchor_agreement");

const marketplaceCatalog = semCatalogTrustVerdict({
  sourceTrust: "MARKETPLACE",
  anchorAgreement: {
    exact_code_match: true,
    agreed: ["year", "subjects"],
    contradicted: [],
    prompt_hard_filter_pass: true
  }
});
assert.equal(marketplaceCatalog.allowed, false);
assert.equal(marketplaceCatalog.reason, "untrusted_catalog_source");

const conflictedCatalog = semCatalogTrustVerdict({
  sourceTrust: "APPROVED_REFERENCE",
  anchorAgreement: {
    agreed: ["year", "subjects"],
    contradicted: ["product_hierarchy"],
    prompt_hard_filter_pass: false
  },
  directConflicts: ["collector_number"]
});
assert.equal(conflictedCatalog.allowed, false);
assert.equal(conflictedCatalog.reason, "direct_or_anchor_conflict");
assert.deepEqual(conflictedCatalog.conflicts.sort(), ["collector_number", "product_hierarchy"]);

const commercialFeedback = classifyWriterFeedbackForSemanticLearning({
  action: "ACCEPTED_UNCHANGED",
  stableTrainingSample: true
});
assert.equal(commercialFeedback.feedback_layer, SEM_FEEDBACK_LAYER.COMMERCIAL_FEEDBACK);
assert.equal(commercialFeedback.semantic_truth, false);
assert.equal(commercialFeedback.training_eligible, true);

const semanticTruth = classifyWriterFeedbackForSemanticLearning({
  action: "EDIT",
  stableTrainingSample: true,
  reviewedSemanticFields: true
});
assert.equal(semanticTruth.feedback_layer, SEM_FEEDBACK_LAYER.REVIEWED_SEMANTIC_TRUTH);
assert.equal(semanticTruth.semantic_truth, true);

console.log("sem-definition tests passed");
