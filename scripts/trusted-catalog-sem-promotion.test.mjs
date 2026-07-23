import assert from "node:assert/strict";
import { promoteGoldenSemWithTrustedCatalog } from "../lib/listing/evaluation/trusted-catalog-sem-promotion.mjs";

const fields = {
  year: "2025",
  ip_sport: "basketball",
  language: "",
  manufacturer: "Topps",
  product: "Topps Chrome",
  set: "",
  subject: ["Jane Doe"],
  card_name: "",
  card_number: "",
  descriptive_rarity: "",
  numerical_rarity: "2/25",
  release_variant: "",
  print_finish: "Gold Refractor",
  special_stamp: [],
  grading_info: "PSA 10"
};

const packet = {
  dataset_id: "test",
  summary: {},
  items: [{
    item_id: "feedback-1",
    source_feedback_id: "feedback-1",
    recognition_input: { images: [{ object_path: "front.jpg" }] },
    sealed_reference: { writer_reviewed_title: "2025 Topps Chrome Jane Doe Gold Refractor 2/25 PSA 10" },
    parser_suggestion: { fields }
  }]
};

function catalogCard(sourceFeedbackId = "writer-title:batch:1", surfaceColor = "Gold Refractor", {
  reviewStatus = "",
  serialDenominator = "25"
} = {}) {
  return {
    id: `card-${sourceFeedbackId}`,
    sport: "basketball",
    season_year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Jane Doe"],
    surface_color: surfaceColor,
    serial_denominator: serialDenominator,
    review_status: reviewStatus,
    metadata: {},
    source: {
      source_type: "INTERNAL_CORRECTED_TITLE",
      source_metadata: { writer_title_batch_id: "batch", source_feedback_id: sourceFeedbackId }
    }
  };
}

const promoted = promoteGoldenSemWithTrustedCatalog(packet, { cards: [catalogCard()] }, {
  now: () => new Date("2026-07-22T00:00:00.000Z")
});
assert.equal(promoted.report.approved_item_count, 1);
assert.equal(promoted.audit_packet.evaluation_truth_policy.formal_oracle_eligible, true);
assert.equal(promoted.audit_packet.evaluation_truth_policy.field_ground_truth_class, "TRUSTED_CATALOG_PROMOTED_FIELD_GROUND_TRUTH");
assert.equal(promoted.packet.items[0].reviewed_ground_truth.fields.product.reviewed_status, "CONFIRMED");
assert.equal(promoted.packet.items[0].reviewed_ground_truth.fields.numerical_rarity.reviewed_status, "CONFIRMED");
assert.equal(promoted.packet.items[0].reviewed_ground_truth.fields.grading_info.reviewed_status, "CONFIRMED");
assert.deepEqual(promoted.packet.items[0].retrieval_ground_truth.accepted_candidate_ids, ["card-writer-title:batch:1"]);
assert.deepEqual(promoted.packet.items[0].retrieval_ground_truth.sealed_source_candidate_ids, []);
assert.equal(promoted.packet.items[0].retrieval_ground_truth.retrieval_evaluable, true);
assert.equal(promoted.report.independently_field_matched_item_count, 1);
assert.equal(promoted.report.exact_identity_matched_item_count, 1);

const selfOnly = promoteGoldenSemWithTrustedCatalog(packet, {
  cards: [catalogCard("feedback-1", "Gold Refractor", { reviewStatus: "REVIEWED_INTERNAL" })]
});
assert.equal(selfOnly.report.approved_item_count, 0);
assert.equal(selfOnly.packet.items[0].reviewed_ground_truth.fields.product.reviewed_status, "UNREVIEWED");
assert.deepEqual(selfOnly.packet.items[0].retrieval_ground_truth.accepted_candidate_ids, []);
assert.deepEqual(selfOnly.packet.items[0].retrieval_ground_truth.sealed_source_candidate_ids, ["card-feedback-1"]);
assert.equal(selfOnly.packet.items[0].retrieval_ground_truth.retrieval_evaluable, false);
assert.equal(selfOnly.report.retrieval_evaluable_item_count, 0);
assert.equal(selfOnly.report.self_only_retrieval_truth_item_count, 1);

const selfAndIndependent = promoteGoldenSemWithTrustedCatalog(packet, {
  cards: [
    catalogCard("feedback-1", "Gold Refractor", { reviewStatus: "REVIEWED_INTERNAL" }),
    catalogCard("writer-title:batch:1")
  ]
});
assert.deepEqual(selfAndIndependent.packet.items[0].retrieval_ground_truth.accepted_candidate_ids, ["card-writer-title:batch:1"]);
assert.deepEqual(selfAndIndependent.packet.items[0].retrieval_ground_truth.sealed_source_candidate_ids, ["card-feedback-1"]);
assert.equal(selfAndIndependent.packet.items[0].retrieval_ground_truth.retrieval_evaluable, true);
assert.equal(selfAndIndependent.report.self_only_retrieval_truth_item_count, 0);
assert.equal(selfAndIndependent.audit_packet.promotion_contract.same_feedback_catalog_ids_are_provenance_only, true);

const conflicting = promoteGoldenSemWithTrustedCatalog(packet, {
  cards: [catalogCard(), catalogCard("writer-title:batch:2", "Red Refractor")]
});
assert.equal(conflicting.packet.items[0].reviewed_ground_truth.fields.print_finish.reviewed_status, "CONFIRMED");

console.log("trusted catalog SEM promotion tests passed");
