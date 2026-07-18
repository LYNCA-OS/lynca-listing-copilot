import assert from "node:assert/strict";

import {
  SEM_CANDIDATE_PARTICIPATION_LEVELS,
  SEM_FEEDBACK_LAYER,
  SEM_FIELD_PERMISSIONS,
  SEM_LINEAR_ISSUES,
  SEM_STANDARD_VERSION,
  SEM_TERM_CLASSIFICATION,
  classifySemNumberBoundary,
  classifySemTerm,
  classifyWriterFeedbackForSemanticLearning,
  semCanonicalEditableFields,
  semCatalogTrustVerdict,
  semDefinition,
  semGrammarForResolved,
  semIssueCoverage,
  semLotTitleOrder,
  semReleaseVariantText,
  semStandardTitleOrder,
  semTcgIpLabel,
  semTcgTitleOrder
} from "../lib/listing/csm/sem-definition.mjs";

assert.equal(SEM_STANDARD_VERSION, "linear-cos-10-23-v25");
assert.equal(semIssueCoverage(SEM_LINEAR_ISSUES), true);
assert.ok(SEM_LINEAR_ISSUES.includes("COS-20"));
assert.ok(SEM_LINEAR_ISSUES.includes("COS-21"));
assert.ok(SEM_LINEAR_ISSUES.includes("COS-22"));
assert.ok(SEM_LINEAR_ISSUES.includes("COS-23"));
assert.equal(semDefinition.marketplace_title_limit, 80);
assert.equal(semDefinition.source, "LINEAR_COS_10_TO_COS_23");
assert.equal(SEM_CANDIDATE_PARTICIPATION_LEVELS.FIELD_APPLICATION, "LEVEL_3_FIELD_APPLICATION");
assert.equal(SEM_FIELD_PERMISSIONS.CAN_APPLY, "can_apply");
assert.ok(semCanonicalEditableFields.includes("numerical_rarity"));
assert.ok(!semCanonicalEditableFields.includes("serial_number"));
assert.ok(!semCanonicalEditableFields.includes("print_run_number"));

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

assert.equal(semTcgIpLabel({ product: "Disney Lorcana Special PR Pack" }), "Disney Lorcana");
assert.equal(semGrammarForResolved({ product: "Disney Lorcana Special PR Pack" }), "TCG");
assert.equal(semGrammarForResolved({ product: "Topps Chrome Basketball" }), "STANDARD");
assert.equal(semReleaseVariantText("Variation-Gold"), "Variation");
assert.equal(semReleaseVariantText("Photo Variation / Horizontal"), "Photo Variation Horizontal");
assert.equal(semReleaseVariantText("JA 9"), "");

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

assert.deepEqual(classifySemTerm("serial_number"), {
  term: "serial_number",
  classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
  canonical_field: "numerical_rarity",
  promotion_allowed: false,
  reason: "current-copy numbering evidence; not a canonical editable CSM field"
});
assert.deepEqual(classifySemTerm("print_run_denominator"), {
  term: "print_run_denominator",
  classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
  canonical_field: "numerical_rarity",
  promotion_allowed: false,
  reason: "denominator or production quantity support for Numerical Rarity"
});
assert.equal(classifySemTerm("provider_slot").classification, SEM_TERM_CLASSIFICATION.WORKFLOW_QUEUE_BEHAVIOR);
assert.equal(classifySemTerm("card_name").promotion_allowed, true);
assert.equal(classifySemTerm("new_possible_field").classification, SEM_TERM_CLASSIFICATION.CSM_DEFINITION_PROPOSAL);

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
assert.equal(commercialFeedback.semantic_learning_status, "OBSERVE_ONLY_WRITER_TITLE_CANDIDATE");
assert.equal(commercialFeedback.training_eligible, false);

const semanticTruth = classifyWriterFeedbackForSemanticLearning({
  action: "EDIT",
  stableTrainingSample: true,
  reviewedSemanticFields: true
});
assert.equal(semanticTruth.feedback_layer, SEM_FEEDBACK_LAYER.REVIEWED_SEMANTIC_TRUTH);
assert.equal(semanticTruth.semantic_truth, true);
assert.equal(semanticTruth.training_eligible, false);

console.log("sem-definition tests passed");
