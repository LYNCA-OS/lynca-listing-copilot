import assert from "node:assert/strict";
import {
  assertReleaseSetManifest,
  releaseMetricIds,
  releaseSetItemSetSha256,
  summarizeReleaseMetrics,
  validateReleaseSetManifest
} from "../lib/listing/evaluation/release-set-contract.mjs";

function manifest(overrides = {}) {
  const items = overrides.items || [{
    item_id: "core-1",
    recognition_input: { images: [{ image_url: "https://images.test/core-1-front.jpg" }] },
    reviewed_ground_truth: { fields: { year: "2024", product: "Topps Chrome", players: ["Test Player"] } }
  }];
  return {
    schema_version: "release-set-v1",
    set_id: "core-holdout-v1",
    set_type: "CORE_HOLDOUT",
    version: "1",
    frozen_at: "2026-07-14T00:00:00.000Z",
    item_set_sha256: releaseSetItemSetSha256(items),
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

const leaked = manifest({
  items: [{
    item_id: "leaked-1",
    recognition_input: {
      images: [{ image_url: "https://images.test/leaked-1.jpg" }],
      seller_title: "2024 Topps Chrome Hidden Answer"
    },
    reviewed_ground_truth: { fields: { year: "2024" } }
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
