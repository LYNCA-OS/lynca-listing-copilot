import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  auditCardLevelReleasePack,
  cardLevelReleasePackDatasetBindingMeasurements,
  cardLevelReleasePackDatasetBindingVersion,
  canonicalCardIdentityId,
  compileCardLevelReleasePackIndex,
  validateCardLevelReleasePackManifest
} from "../lib/listing/evaluation/card-level-release-pack-audit.mjs";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const catalogHash = hash("catalog-fixture");
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};

const provenance = Object.freeze({
  source_id: "trusted-catalog-fixture",
  source_type: "TRUSTED_CATALOG_SNAPSHOT",
  source_version: "fixture-v1",
  source_sha256: catalogHash
});

function officialCard(id, overrides = {}) {
  return {
    id,
    season_year: "2025-26",
    manufacturer: "Panini",
    product: "Panini Prizm Basketball",
    set_or_insert: "Base",
    players: ["Jaxson Dart/Jaxson Dart"],
    card_number: "024",
    surface_color: "Gold",
    serial_denominator: "10",
    source: {
      id: `official-source-${id}`,
      source_type: "PANINI_OFFICIAL_CHECKLIST",
      source_metadata: {}
    },
    ...overrides
  };
}

function writerCard(id, feedbackId, overrides = {}) {
  return officialCard(id, {
    source: {
      id: `writer-source-${id}`,
      source_type: "INTERNAL_CORRECTED_TITLE",
      source_metadata: {
        source_feedback_id: feedbackId,
        source_file_sha256: hash("writer-file"),
        writer_title_batch_id: "writer-v1"
      }
    },
    ...overrides
  });
}

function truthItem(id, split = "development", overrides = {}) {
  const identityFields = overrides.identity_fields || {
    year: "2025-26",
    manufacturer: "Panini",
    product: "Panini Prizm Basketball",
    set: "Base",
    subject: ["Jaxson Dart/Jaxson Dart"],
    card_number: "024",
    print_finish: "Gold",
    serial_denominator: "10"
  };
  return {
    item_id: id,
    source_feedback_id: id,
    retrieval_ground_truth: {
      retrieval_evaluable: true,
      accepted_identity_ids: [canonicalCardIdentityId(identityFields)],
      identity_fields: identityFields,
      sealed_source_candidate_ids: [`self-row-${id}`],
      provenance: {
        source_id: id,
        source_version: `sha256:${hash(`truth-${id}`)}`,
        independent_from_system_under_test: true,
        sealed_from_system: true
      },
      ...overrides,
      identity_fields: identityFields
    },
    evaluation_partition: split
  };
}

function manifest({ development = [], validation = [], holdout = [] } = {}) {
  return {
    schema_version: "v4-oracle-reproducible-split-manifest-v1",
    frozen_assignment_id: "fixture-frozen-v1",
    source_fingerprint_sha256: hash("frozen-source"),
    leakage_check: {
      development_validation: 0,
      development_holdout: 0,
      validation_holdout: 0
    },
    actual_counts: {
      development: development.length,
      validation: validation.length,
      holdout: holdout.length
    },
    partitions: { development, validation, holdout }
  };
}

function datasetBinding(dataset, frozenManifest) {
  const measurements = cardLevelReleasePackDatasetBindingMeasurements({
    dataset,
    partitions: frozenManifest.partitions
  });
  return {
    schema_version: cardLevelReleasePackDatasetBindingVersion,
    frozen_assignment_id: frozenManifest.frozen_assignment_id,
    manifest_source_fingerprint_sha256: frozenManifest.source_fingerprint_sha256,
    manifest_content_fingerprint_sha256: createHash("sha256")
      .update(JSON.stringify(stable(frozenManifest)))
      .digest("hex"),
    ...measurements
  };
}

test("compiles deterministic card-level identities with product and subject aliases", () => {
  const cards = [officialCard("official"), writerCard("writer", "unrelated")];
  const first = compileCardLevelReleasePackIndex({ cards, provenance, pack_version: "v1" });
  const second = compileCardLevelReleasePackIndex({
    cards: [...cards].reverse(),
    provenance,
    pack_version: "v1"
  });
  assert.equal(first.pack_fingerprint, second.pack_fingerprint);
  assert.equal(first.pack_content_fingerprint, second.pack_content_fingerprint);
  assert.equal(first.indexed_identity_count, 1);
  assert.equal(first.duplicate_identity_row_count, 1);
  const result = first.query({
    year: "2025-26",
    manufacturer: "Panini",
    product: "Prizm",
    set: "Base",
    subject: ["Jaxson Dart"],
    card_number: "24",
    print_finish: "Gold",
    serial_denominator: "10"
  });
  assert.equal(result.strict_exact_identity_count, 1);
  assert.equal(result.strict_exact_unique, true);
  assert.deepEqual(result.candidates[0].source_classes, ["official", "writer"]);
});

test("same-source row is excluded and cannot prove its own truth", () => {
  const index = compileCardLevelReleasePackIndex({
    cards: [writerCard("self-row-dev", "dev")],
    provenance,
    pack_version: "v1"
  });
  const result = index.query(truthItem("dev").retrieval_ground_truth.identity_fields, {
    exclusion: {
      sealed_row_ids: new Set(["self-row-dev"]),
      feedback_ids: new Set(["dev"]),
      source_ids: new Set(["dev"]),
      content_hashes: new Set([hash("truth-dev")])
    }
  });
  assert.equal(result.independent_candidate_count, 0);
  assert.equal(result.strict_exact_identity_count, 0);
});

test("an independently sourced duplicate survives self exclusion", () => {
  const index = compileCardLevelReleasePackIndex({
    cards: [writerCard("self-row-dev", "dev"), officialCard("official")],
    provenance,
    pack_version: "v1"
  });
  const truth = truthItem("dev").retrieval_ground_truth;
  const result = index.query(truth.identity_fields, {
    accepted_identity_ids: truth.accepted_identity_ids,
    exclusion: {
      sealed_row_ids: new Set(["self-row-dev"]),
      feedback_ids: new Set(["dev"]),
      source_ids: new Set(["dev"]),
      content_hashes: new Set([hash("truth-dev")])
    }
  });
  assert.equal(result.strict_exact_identity_count, 1);
  assert.equal(result.accepted_identity_match_count, 1);
  assert.equal(result.accepted_identity_rank, 1);
  assert.deepEqual(result.candidates[0].source_classes, ["official"]);
});

test("variant conflicts are not promoted as exact identity", () => {
  const index = compileCardLevelReleasePackIndex({
    cards: [officialCard("wrong", { surface_color: "Red", serial_denominator: "25" })],
    provenance,
    pack_version: "v1"
  });
  const result = index.query(truthItem("dev").retrieval_ground_truth.identity_fields);
  assert.equal(result.query_compatible_core_count, 1);
  assert.equal(result.strict_exact_identity_count, 0);
  assert.equal(result.candidates[0].comparison.field_comparison.print_finish, "CONFLICT");
});

test("audit consumes development and validation without reading holdout", () => {
  const development = truthItem("dev");
  const validationFields = {
    ...development.retrieval_ground_truth.identity_fields,
    subject: ["Jane Doe"],
    card_number: "025"
  };
  const validation = truthItem("val", "validation", { identity_fields: validationFields });
  const dataset = { items: [development, validation] };
  const frozenManifest = manifest({
    development: ["dev"],
    validation: ["val"],
    holdout: ["sealed"]
  });
  const report = auditCardLevelReleasePack({
    dataset,
    manifest: frozenManifest,
    dataset_binding: datasetBinding(dataset, frozenManifest),
    catalog: {
      schema_version: "fixture-catalog-v1",
      generated_at: "2026-07-30T00:00:00.000Z",
      cards: [
        officialCard("official"),
        officialCard("validation", { players: ["Jane Doe"], card_number: "025" })
      ]
    },
    provenance
  });
  assert.equal(report.holdout_consumed, false);
  assert.equal(report.denominator.identity_groups, 2);
  assert.equal(report.split.development.variant_compatible_unique, 1);
  assert.equal(report.split.validation.variant_compatible_unique, 1);
  assert.equal(report.split.development.accepted_identity_presence, 1);
  assert.equal(report.split.validation.identity_recall_at_1, 1);
  assert.equal(report.evidence_class, "TRUTH_FED_CATALOG_UPPER_BOUND");
  assert.equal(report.classification_counts.INDEPENDENT_IDENTITY_PRESENT, 2);
  assert.deepEqual(report.manifest_integrity.recomputed_actual_counts, {
    development: 1,
    validation: 1,
    holdout: 1
  });
  assert.deepEqual(report.manifest_integrity.recomputed_leakage_check, {
    development_validation: 0,
    development_holdout: 0,
    validation_holdout: 0
  });
  assert.equal(report.manifest_integrity.dataset_binding.dataset_binding_verified, true);
  assert.equal(
    report.manifest_integrity.dataset_binding.manifest_source_fingerprint_sha256,
    report.manifest_integrity.source_fingerprint_sha256
  );
});

test("audit rejects a holdout row rather than silently ignoring it", () => {
  const frozenManifest = manifest({ holdout: ["sealed"] });
  const binding = {
    schema_version: cardLevelReleasePackDatasetBindingVersion,
    frozen_assignment_id: frozenManifest.frozen_assignment_id,
    manifest_source_fingerprint_sha256: frozenManifest.source_fingerprint_sha256,
    manifest_content_fingerprint_sha256: createHash("sha256")
      .update(JSON.stringify(stable(frozenManifest)))
      .digest("hex"),
    truth_item_count: 1,
    truth_item_ids_sha256: hash("never-read-holdout-ids"),
    truth_dataset_content_fingerprint_sha256: hash("never-read-holdout-content")
  };
  assert.throws(() => auditCardLevelReleasePack({
    dataset: { items: [truthItem("sealed", "holdout")] },
    manifest: frozenManifest,
    dataset_binding: binding,
    catalog: { cards: [] },
    provenance
  }), /HOLDOUT_INPUT_REJECTED:sealed/);
});

test("audit reports self-source-only coverage separately from independent coverage", () => {
  const dataset = { items: [truthItem("dev")] };
  const frozenManifest = manifest({ development: ["dev"] });
  const report = auditCardLevelReleasePack({
    dataset,
    manifest: frozenManifest,
    dataset_binding: datasetBinding(dataset, frozenManifest),
    catalog: {
      schema_version: "fixture-catalog-v1",
      generated_at: "2026-07-30T00:00:00.000Z",
      cards: [writerCard("self-row-dev", "dev")]
    },
    provenance
  });
  assert.equal(report.classification_counts.CORRELATED_SOURCE_ONLY, 1);
  assert.equal(report.combined.variant_compatible_presence, 0);
});

test("manifest dataset binding rejects truth-field mutation under the same item id", () => {
  const original = { items: [truthItem("dev")] };
  const frozenManifest = manifest({ development: ["dev"] });
  const binding = datasetBinding(original, frozenManifest);
  const mutated = structuredClone(original);
  mutated.items[0].retrieval_ground_truth.identity_fields.product = "Panini Select";
  assert.throws(() => auditCardLevelReleasePack({
    dataset: mutated,
    manifest: frozenManifest,
    dataset_binding: binding,
    catalog: { cards: [] },
    provenance
  }), /TRUTH_DATASET_CONTENT_FINGERPRINT_MISMATCH/);
});

test("pack fingerprint changes when card content changes under the same provenance claim", () => {
  const first = compileCardLevelReleasePackIndex({
    cards: [officialCard("official")],
    provenance,
    pack_version: "v1"
  });
  const changed = compileCardLevelReleasePackIndex({
    cards: [officialCard("official", { surface_color: "Red" })],
    provenance,
    pack_version: "v1"
  });
  assert.notEqual(changed.pack_content_fingerprint, first.pack_content_fingerprint);
  assert.notEqual(changed.pack_fingerprint, first.pack_fingerprint);
});

test("manifest gate recomputes cross-split leakage instead of trusting claimed zero", () => {
  const malformed = manifest({ development: ["shared"], validation: ["shared"] });
  assert.throws(
    () => validateCardLevelReleasePackManifest(malformed),
    /CROSS_SPLIT_LEAKAGE:development_validation:1/
  );
});

test("manifest gate rejects duplicates within a partition", () => {
  const malformed = manifest({ development: ["duplicate", "duplicate"] });
  assert.throws(
    () => validateCardLevelReleasePackManifest(malformed),
    /DUPLICATE_ITEM_ID:development/
  );
});

test("manifest gate rejects self-reported actual counts that do not match partitions", () => {
  const malformed = manifest({ development: ["dev"] });
  malformed.actual_counts.development = 2;
  assert.throws(
    () => validateCardLevelReleasePackManifest(malformed),
    /ACTUAL_COUNT_MISMATCH:development:2:1/
  );
});

test("manifest gate fails closed when a required partition is malformed", () => {
  const malformed = manifest({ development: ["dev"] });
  malformed.partitions.validation = null;
  assert.throws(
    () => validateCardLevelReleasePackManifest(malformed),
    /PARTITION_NOT_ARRAY:validation/
  );
});

test("manifest gate rejects an unowned extra partition", () => {
  const malformed = manifest({ development: ["dev"] });
  malformed.partitions.future = ["future-row"];
  assert.throws(
    () => validateCardLevelReleasePackManifest(malformed),
    /UNKNOWN_PARTITION:future/
  );
});
