import assert from "node:assert/strict";
import {
  assertReleaseSetManifest,
  formalReleaseLaunchFields,
  formalReleaseTruthPolicy,
  releaseMetricIds,
  releaseSetItemDigestSchemaVersion,
  releaseSetItemSetSha256,
  summarizeReleaseMetrics,
  validateReleaseSetManifest
} from "../lib/listing/evaluation/release-set-contract.mjs";

function manifest(overrides = {}) {
  const fields = Object.fromEntries(formalReleaseLaunchFields.map((field) => [field, "NOT_APPLICABLE"]));
  const fieldStatuses = Object.fromEntries(formalReleaseLaunchFields.map((field) => [field, "NOT_APPLICABLE"]));
  Object.assign(fields, { year: "2024", product: "Topps Chrome", subject: ["Test Player"] });
  Object.assign(fieldStatuses, { year: "CONFIRMED", product: "CONFIRMED", subject: "CONFIRMED" });
  const items = overrides.items || [{
    item_id: "core-1",
    identity_group_id: "identity-core-1",
    recognition_input: {
      images: [{
        image_url: "https://images.test/core-1-front.jpg",
        content_sha256: "1".repeat(64)
      }]
    },
    reviewed_ground_truth: {
      fields,
      field_statuses: fieldStatuses,
      evidence_sources: {
        year: [{ source_id: "writer-review-1", source_sha256: "2".repeat(64) }],
        product: [{ source_id: "official-catalog-1", source_sha256: "3".repeat(64) }],
        subject: [{ source_id: "writer-review-1", source_sha256: "2".repeat(64) }]
      },
      reviewed_by: "reviewer-1",
      reviewed_at: "2026-07-13T23:00:00.000Z"
    }
  }];
  const result = {
    schema_version: "release-set-v1",
    set_id: "core-holdout-v1",
    set_type: "CORE_HOLDOUT",
    partition: "holdout",
    version: "1",
    frozen_at: "2026-07-14T00:00:00.000Z",
    item_set_digest_schema_version: releaseSetItemDigestSchemaVersion,
    evaluation_truth_policy: { ...formalReleaseTruthPolicy },
    leakage_policy: {
      exclude_from_training: true,
      exclude_query_images_from_reference_index: true,
      exclude_from_catalog_promotion: true
    },
    items,
    ...overrides
  };
  if (!Object.hasOwn(overrides, "item_set_sha256")) {
    result.item_set_sha256 = releaseSetItemSetSha256(result.items, {
      split: result.partition,
      evaluationTruthPolicy: result.evaluation_truth_policy
    });
  }
  return result;
}

const valid = assertReleaseSetManifest(manifest());
assert.equal(valid.ok, true);
assert.equal(valid.item_count, 1);

const leaked = manifest({
  items: [{
    ...manifest().items[0],
    item_id: "leaked-1",
    recognition_input: {
      images: [{ image_url: "https://images.test/leaked-1.jpg", content_sha256: "4".repeat(64) }],
      seller_title: "2024 Topps Chrome Hidden Answer"
    }
  }]
});
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

const digestBase = manifest();
for (const mutate of [
  (value) => { value.items[0].recognition_input.images[0].content_sha256 = "5".repeat(64); },
  (value) => { value.items[0].reviewed_ground_truth.fields.product = "Topps Chrome Sapphire"; },
  (value) => { value.items[0].reviewed_ground_truth.field_statuses.product = "UNKNOWN"; },
  (value) => { value.items[0].reviewed_ground_truth.evidence_sources.product[0].source_id = "official-catalog-2"; },
  (value) => { value.items[0].reviewed_ground_truth.evidence_sources.product[0].source_sha256 = "6".repeat(64); },
  (value) => { value.items[0].reviewed_ground_truth.reviewed_by = "reviewer-2"; },
  (value) => { value.items[0].reviewed_ground_truth.reviewed_at = "2026-07-13T23:01:00.000Z"; },
  (value) => { value.partition = "validation"; },
  (value) => { value.evaluation_truth_policy.launch_gate_eligible = false; }
]) {
  const changed = structuredClone(digestBase);
  mutate(changed);
  const changedDigest = releaseSetItemSetSha256(changed.items, {
    split: changed.partition,
    evaluationTruthPolicy: changed.evaluation_truth_policy
  });
  assert.notEqual(changedDigest, digestBase.item_set_sha256);
  assert.equal(validateReleaseSetManifest(changed).ok, false);
}

for (const mutate of [
  (value) => { delete value.evaluation_truth_policy; },
  (value) => { delete value.item_set_digest_schema_version; },
  (value) => { delete value.items[0].recognition_input.images[0].content_sha256; },
  (value) => { delete value.items[0].reviewed_ground_truth.field_statuses.product; },
  (value) => { value.items[0].reviewed_ground_truth.evidence_sources.product = ["legacy-source-name"]; },
  (value) => { delete value.items[0].reviewed_ground_truth.reviewed_by; }
]) {
  const incomplete = structuredClone(digestBase);
  mutate(incomplete);
  incomplete.item_set_sha256 = releaseSetItemSetSha256(incomplete.items, {
    split: incomplete.partition,
    evaluationTruthPolicy: incomplete.evaluation_truth_policy
  });
  assert.equal(validateReleaseSetManifest(incomplete).ok, false);
}

const thinTruth = structuredClone(digestBase.items[0]);
thinTruth.reviewed_ground_truth.fields = { language: "English" };
thinTruth.reviewed_ground_truth.field_statuses = { language: "CONFIRMED" };
thinTruth.reviewed_ground_truth.evidence_sources = {
  language: [{ source_id: "writer-review-1", source_sha256: "2".repeat(64) }]
};
const thinManifest = manifest({ items: [thinTruth] });
const thinValidation = validateReleaseSetManifest(thinManifest);
assert.equal(thinValidation.ok, false);
assert.ok(thinValidation.errors.some((error) => error.includes("formal field status is required")));
assert.ok(thinValidation.errors.some((error) => error.includes("formal critical identity coverage")));

const caseVariants = ["core-case", "CORE-CASE"].map((itemId, index) => ({
  ...structuredClone(digestBase.items[0]),
  item_id: itemId,
  identity_group_id: `identity-case-${index}`
}));
const caseCollisionValidation = validateReleaseSetManifest(manifest({ items: caseVariants }));
assert.equal(caseCollisionValidation.ok, false);
assert.ok(caseCollisionValidation.errors.includes("item_id values must be strict and canonically unique"));

const duplicateIdentityItems = ["identity-row-1", "identity-row-2"].map((itemId) => ({
  ...structuredClone(digestBase.items[0]),
  item_id: itemId,
  identity_group_id: "same-identity"
}));
const duplicateIdentityValidation = validateReleaseSetManifest(manifest({ items: duplicateIdentityItems }));
assert.equal(duplicateIdentityValidation.ok, false);
assert.ok(duplicateIdentityValidation.errors.some((error) => error.includes("identity_group_id")));

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
