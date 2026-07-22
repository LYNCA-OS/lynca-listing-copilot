import assert from "node:assert/strict";
import {
  buildGoldenSemReviewPacket,
  buildGoldenSemReviewWorklist,
  freezeGoldenSemReleaseSets,
  goldenSemLaunchFields,
  planGoldenSemReviewSplits,
  validateGoldenSemReviewPacket
} from "../lib/listing/evaluation/golden-sem-release.mjs";
import { evaluateGoldenSemAccuracy } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";

const source = {
  schema_version: "recognition-candidate-export-v1",
  source: { table: "listing_title_feedback" },
  items: Array.from({ length: 20 }, (_, index) => ({
    asset_id: `asset-${index + 1}`,
    source_feedback_id: `feedback-${index + 1}`,
    card_identity_id: `identity-${index + 1}`,
    images: [{
      image_id: `image-${index + 1}`,
      bucket: "listing-feedback-images",
      object_path: `reviewed/${index + 1}.jpg`
    }],
    source_titles: {
      corrected_title: `2024 Topps Chrome Test Player ${index + 1} Gold 2/3 PSA 10`
    }
  }))
};

const packet = buildGoldenSemReviewPacket(source, {
  datasetId: "golden-sem-test",
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
assert.equal(packet.items.length, 20);
assert.equal(packet.summary.with_writer_reviewed_title_count, 20);
assert.equal(packet.items[0].reviewed_ground_truth.fields.year.reviewed_value, "");
assert.equal(packet.items[0].reviewed_ground_truth.fields.year.parser_suggestion, "2024");
assert.equal(packet.items[0].sealed_reference.title_visible_to_recognition, false);
assert.equal(packet.items[0].recognition_input.corrected_title, undefined);
assert.equal(validateGoldenSemReviewPacket(packet).ok, true);
assert.equal(validateGoldenSemReviewPacket(packet, { requireApproved: true }).ok, false);
const worklist = buildGoldenSemReviewWorklist(packet);
assert.equal(worklist.summary.item_count, 20);
assert.equal(worklist.items[0].fields.some((field) => field.field === "year"), true);
const splitPlan = planGoldenSemReviewSplits(packet, { minimumHoldout: 0, seed: "test-seed" });
assert.equal(Object.values(splitPlan.actual_counts).reduce((sum, count) => sum + count, 0), 20);
assert.equal(splitPlan.status, "SEALED_ASSIGNMENT_PENDING_FIELD_REVIEW");

for (const [index, item] of packet.items.entries()) {
  item.reviewed_ground_truth.review_status = "APPROVED";
  item.reviewed_ground_truth.reviewed_by = "reviewer-1";
  item.reviewed_ground_truth.reviewed_at = "2026-07-14T01:00:00.000Z";
  const confirmed = {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Chrome",
    subject: [`Test Player ${index + 1}`],
    card_name: "Base",
    numerical_rarity: "2/3",
    print_finish: "Gold",
    grading_info: { company: "PSA", card_grade: "10" }
  };
  for (const field of goldenSemLaunchFields) {
    const row = item.reviewed_ground_truth.fields[field];
    if (Object.hasOwn(confirmed, field)) {
      row.reviewed_status = "CONFIRMED";
      row.reviewed_value = confirmed[field];
      row.evidence_sources = ["WRITER_REVIEWED_CARD"];
    } else {
      row.reviewed_status = "NOT_APPLICABLE";
      row.reviewed_value = Array.isArray(row.reviewed_value) ? [] : "";
    }
  }
}

const ready = validateGoldenSemReviewPacket(packet, { requireApproved: true });
assert.equal(ready.ok, true, ready.errors.join("; "));
const bundle = freezeGoldenSemReleaseSets(packet, {
  version: "v1",
  seed: "test-seed",
  minimumHoldout: 0,
  now: () => new Date("2026-07-14T02:00:00.000Z")
});
assert.deepEqual(bundle.split_policy.actual_counts, {
  development: 14,
  validation: 3,
  holdout: 3
});
assert.equal(bundle.split_policy.cross_split_identity_overlap_count, 0);
assert.equal(bundle.holdout_release_set.leakage_policy.exclude_from_training, true);
assert.equal(bundle.holdout_release_set.leakage_policy.exclude_from_threshold_tuning, true);
assert.equal(bundle.validation.holdout_release_set.ok, true);

const holdoutPredictions = {
  schema_version: "prediction-report-v1",
  provider: "openai",
  results: bundle.holdout_release_set.items.map((item, index) => ({
    asset_id: item.item_id,
    resolved_fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: item.reviewed_ground_truth.fields.subject,
      card_name: "Base",
      print_run_number: index === 0 ? "#/3" : "2/3",
      parallel: "Gold",
      grade_company: "PSA",
      card_grade: "10"
    }
  }))
};
const accuracy = evaluateGoldenSemAccuracy({
  dataset: bundle.holdout_release_set,
  predictions: holdoutPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(accuracy.status, "COMPLETED");
assert.equal(accuracy.source.partition, "holdout");
assert.equal(accuracy.summary.evaluated_card_count, 3);
assert.equal(accuracy.metrics.sem_card_exact_accuracy.correct, 3);
assert.equal(accuracy.metrics.per_field_exact_accuracy.numerical_rarity.correct, 3);
assert.equal(accuracy.cards[0].fields.numerical_rarity.is_correct, true);
assert.equal(accuracy.cards[0].fields.numerical_rarity.normalized_prediction, "#/3");
assert.equal(accuracy.cards[0].fields.numerical_rarity.normalized_ground_truth, "#/3");

const leakedPacket = structuredClone(packet);
leakedPacket.items[0].reviewed_ground_truth.fields.year.evidence_sources = [];
assert.equal(validateGoldenSemReviewPacket(leakedPacket, { requireApproved: true }).ok, false);

console.log("golden SEM release tests passed");
