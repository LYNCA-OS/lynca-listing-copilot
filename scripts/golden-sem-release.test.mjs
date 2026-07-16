import assert from "node:assert/strict";
import {
  buildGoldenSemReviewPacket,
  freezeGoldenSemReleaseSets,
  goldenSemLaunchFields,
  goldenSemPartitionSchemaVersion,
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
const missingTruthPolicyAccuracy = evaluateGoldenSemAccuracy({
  dataset: bundle.holdout_release_set,
  predictions: holdoutPredictions
});
assert.equal(missingTruthPolicyAccuracy.status, "COMPLETED_DIAGNOSTIC");
assert.equal(missingTruthPolicyAccuracy.scope.formal_golden_sem, false);
assert.equal(missingTruthPolicyAccuracy.formal_launch_gate_eligible, false);
assert.equal(missingTruthPolicyAccuracy.scope.formal_launch_gate_eligible, false);
assert.equal(missingTruthPolicyAccuracy.source.truth_policy_explicit, false);

bundle.holdout_release_set.evaluation_truth_policy = {
  field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH",
  launch_gate_eligible: true
};
const accuracy = evaluateGoldenSemAccuracy({
  dataset: bundle.holdout_release_set,
  predictions: holdoutPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(accuracy.status, "COMPLETED");
assert.equal(accuracy.formal_launch_gate_eligible, true);
assert.equal(accuracy.scope.formal_launch_gate_eligible, true);
assert.equal(accuracy.validation.formal_launch_ground_truth.review_metadata.ok, true);
assert.equal(accuracy.source.partition, "holdout");
assert.equal(accuracy.summary.evaluated_card_count, 3);
assert.equal(accuracy.metrics.sem_card_exact_accuracy.correct, 2);
assert.equal(accuracy.metrics.per_field_exact_accuracy.numerical_rarity.correct, 2);
assert.equal(accuracy.cards[0].fields.numerical_rarity.is_correct, false);
assert.equal(accuracy.cards[0].fields.numerical_rarity.normalized_prediction, "#/3");
assert.equal(accuracy.cards[0].fields.numerical_rarity.normalized_ground_truth, "2/3");
assert.equal(accuracy.metrics.critical_field_evaluable_coverage.dimensions.grade.evaluated_cards, 3);

const singleFieldAccuracy = evaluateGoldenSemAccuracy({
  dataset: {
    schema_version: goldenSemPartitionSchemaVersion,
    dataset_id: "single-field-diagnostic",
    partition: "development",
    data_policy: { frozen_holdout: false },
    evaluation_truth_policy: {
      field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH",
      launch_gate_eligible: true
    },
    items: [{
      item_id: "single-field-1",
      reviewed_ground_truth: {
        fields: { year: "2024" },
        field_statuses: { year: "CONFIRMED" },
        evidence_sources: { year: ["CARD_IMAGE_REVIEW"] },
        reviewed_by: "reviewer-1",
        reviewed_at: "2026-07-14T01:00:00.000Z"
      }
    }]
  },
  predictions: {
    results: [{ asset_id: "single-field-1", resolved_fields: { year: "2024" } }]
  }
});
assert.equal(singleFieldAccuracy.status, "INCONCLUSIVE");
assert.equal(singleFieldAccuracy.metrics.sem_card_exact_accuracy.total, 0);
assert.equal(singleFieldAccuracy.cards[0].card_exact, null);
assert.equal(singleFieldAccuracy.cards[0].card_exact_eligible, false);
assert.equal(singleFieldAccuracy.metrics.card_exact_evaluable_coverage.single_field_card_count, 1);

const leakedPacket = structuredClone(packet);
leakedPacket.items[0].reviewed_ground_truth.fields.year.evidence_sources = [];
assert.equal(validateGoldenSemReviewPacket(leakedPacket, { requireApproved: true }).ok, false);

console.log("golden SEM release tests passed");
