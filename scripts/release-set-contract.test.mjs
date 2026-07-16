import assert from "node:assert/strict";
import {
  assertReleaseSetManifest,
  humanReviewedFieldGroundTruthClass,
  releaseMetricIds,
  releaseSetItemSetSha256,
  summarizeReleaseMetrics,
  validateFormalLaunchGroundTruth,
  validateReleaseSetManifest
} from "../lib/listing/evaluation/release-set-contract.mjs";

function reviewedGroundTruth(fields) {
  return {
    fields,
    field_statuses: Object.fromEntries(Object.keys(fields).map((field) => [field, "CONFIRMED"])),
    evidence_sources: Object.fromEntries(Object.keys(fields).map((field) => [field, ["CARD_IMAGE_REVIEW"]])),
    reviewed_by: "reviewer-1",
    reviewed_at: "2026-07-14T00:00:00.000Z"
  };
}

function manifest(overrides = {}) {
  const items = overrides.items || [{
    item_id: "core-1",
    recognition_input: { images: [{ image_url: "https://images.test/core-1-front.jpg" }] },
    reviewed_ground_truth: reviewedGroundTruth({
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"]
    })
  }];
  return {
    schema_version: "release-set-v1",
    set_id: "core-holdout-v1",
    set_type: "CORE_HOLDOUT",
    version: "1",
    frozen_at: "2026-07-14T00:00:00.000Z",
    item_set_sha256: releaseSetItemSetSha256(items),
    evaluation_truth_policy: {
      field_ground_truth_class: humanReviewedFieldGroundTruthClass,
      launch_gate_eligible: true
    },
    leakage_policy: {
      exclude_from_training: true,
      exclude_query_images_from_reference_index: true,
      exclude_from_catalog_promotion: true
    },
    items,
    ...overrides
  };
}

const valid = assertReleaseSetManifest(manifest());
assert.equal(valid.ok, true);
assert.equal(valid.item_count, 1);
assert.equal(valid.formal_launch_gate_eligible, true);

const missingTruthPolicy = manifest();
delete missingTruthPolicy.evaluation_truth_policy;
const missingTruthPolicyValidation = validateReleaseSetManifest(missingTruthPolicy);
assert.equal(missingTruthPolicyValidation.ok, true);
assert.equal(missingTruthPolicyValidation.formal_launch_gate_eligible, false);
assert.match(
  validateFormalLaunchGroundTruth(missingTruthPolicy).errors.join("; "),
  /must explicitly equal HUMAN_REVIEWED_FIELD_GROUND_TRUTH/
);

const missingReviewer = manifest();
delete missingReviewer.items[0].reviewed_ground_truth.reviewed_by;
const missingReviewerValidation = validateReleaseSetManifest(missingReviewer);
assert.equal(missingReviewerValidation.ok, false);
assert.ok(missingReviewerValidation.errors.some((error) => error.includes("reviewed_by is required")));

const invalidReviewedAt = manifest();
invalidReviewedAt.items[0].reviewed_ground_truth.reviewed_at = "yesterday";
const invalidReviewedAtValidation = validateReleaseSetManifest(invalidReviewedAt);
assert.equal(invalidReviewedAtValidation.ok, false);
assert.ok(invalidReviewedAtValidation.errors.some((error) => error.includes("valid date-time")));

const missingEvidence = manifest();
missingEvidence.items[0].reviewed_ground_truth.evidence_sources.year = [];
const missingEvidenceValidation = validateReleaseSetManifest(missingEvidence);
assert.equal(missingEvidenceValidation.ok, false);
assert.ok(missingEvidenceValidation.errors.some((error) => error.includes("year: CONFIRMED requires evidence_sources")));

const leaked = manifest({
  items: [{
    item_id: "leaked-1",
    recognition_input: {
      images: [{ image_url: "https://images.test/leaked-1.jpg" }],
      seller_title: "2024 Topps Chrome Hidden Answer"
    },
    reviewed_ground_truth: reviewedGroundTruth({ year: "2024" })
  }]
});
leaked.item_set_sha256 = releaseSetItemSetSha256(leaked.items);
assert.equal(validateReleaseSetManifest(leaked).ok, false);
assert.ok(validateReleaseSetManifest(leaked).errors.some((error) => error.includes("seller_title")));

const coldStart = manifest({
  set_id: "cold-start-v1",
  set_type: "COLD_START_HOLDOUT",
  leakage_policy: {
    exclude_from_training: true,
    exclude_query_images_from_reference_index: true,
    exclude_from_catalog_promotion: true
  }
});
assert.throws(() => assertReleaseSetManifest(coldStart), /exclude the query identity from catalog candidates/);

const metrics = summarizeReleaseMetrics([{
  writer_outcome: "ACCEPTED_UNCHANGED",
  reviewed_ground_truth: { fields: { year: "2024", product: "Topps Chrome", players: ["Test Player"] } },
  predicted_fields: { year: "2024", product: "Topps Chrome", players: ["Test Player"] },
  critical_fields: ["year", "product", "players"],
  active_recognition_ms: 10_000,
  cost_usd: 0.01
}, {
  writer_outcome: "CORRECTED_FIELDS",
  reviewed_ground_truth: { fields: { year: "2023", product: "Panini Prizm", players: ["Second Player"] } },
  predicted_fields: { year: "2022", product: "Panini Prizm", players: ["Second Player"] },
  critical_fields: ["year", "product", "players"],
  active_recognition_ms: 20_000,
  cost_usd: 0.02
}], { coreFields: ["year", "product", "players"] });

assert.deepEqual(metrics.metric_ids, releaseMetricIds);
assert.equal(metrics.metrics.writer_first_pass_accept_rate.value, 0.5);
assert.equal(metrics.metrics.critical_identity_error_rate.value, 0.5);
assert.equal(metrics.metrics.core_field_exact_accuracy.numerator, 5);
assert.equal(metrics.metrics.core_field_exact_accuracy.denominator, 6);
assert.equal(metrics.metrics.active_recognition_p95_ms.value, 20_000);
assert.equal(metrics.metrics.cost_per_accepted_title.value, 0.015);

const unknownExcluded = summarizeReleaseMetrics([{
  reviewed_ground_truth: { fields: { year: "UNKNOWN", product: "NOT_APPLICABLE" } },
  predicted_fields: {}
}], { coreFields: ["year", "product"] });
assert.equal(unknownExcluded.metrics.core_field_exact_accuracy.denominator, 0);
assert.equal(unknownExcluded.metrics.core_field_exact_accuracy.value, null);

console.log("release-set contract tests passed");
