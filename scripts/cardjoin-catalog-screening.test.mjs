import assert from "node:assert/strict";
import test from "node:test";

import { screenCardJoinCatalog } from "../lib/listing/evaluation/cardjoin-catalog-screening.mjs";

const sourceFingerprint = "e".repeat(64);

function frozenManifest({ development = [], validation = [], holdout = [] } = {}) {
  return {
    schema_version: "v4-oracle-reproducible-split-manifest-v1",
    frozen_assignment_id: "fixture-frozen-v1",
    source_fingerprint_sha256: sourceFingerprint,
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

function truthItem(id, split = "development") {
  return {
    item_id: id,
    source_feedback_id: id,
    retrieval_ground_truth: {
      retrieval_evaluable: true,
      accepted_identity_ids: [`identity:${id}`],
      identity_fields: {
        year: "2025",
        manufacturer: "Panini",
        product: "Phoenix",
        set: "Contours",
        subject: ["Jaxson Dart"],
        card_number: "24",
        print_finish: "",
        serial_denominator: ""
      },
      sealed_source_candidate_ids: [`self-${id}`],
      provenance: {
        source_id: id,
        source_version: `sha256:${"f".repeat(64)}`,
        independent_from_system_under_test: true,
        sealed_from_system: true
      }
    },
    split
  };
}

function catalogCard(id, overrides = {}) {
  return {
    id,
    season_year: "2025",
    manufacturer: "Panini",
    product: "Phoenix",
    set_or_insert: "Contours",
    players: ["Jaxson Dart"],
    card_number: "24",
    source: {
      source_type: "PANINI_OFFICIAL_CHECKLIST",
      source_metadata: {}
    },
    ...overrides
  };
}

test("screening excludes self rows and never consumes holdout", () => {
  const development = truthItem("dev");
  const validation = truthItem("val", "validation");
  const report = screenCardJoinCatalog({
    dataset: { items: [development, validation, truthItem("sealed", "holdout")] },
    manifest: frozenManifest({ development: ["dev"], validation: ["val"], holdout: ["sealed"] }),
    catalog: {
      cards: [
        catalogCard("self-dev", {
          source: { source_type: "INTERNAL_CORRECTED_TITLE", source_metadata: { source_feedback_id: "dev" } }
        }),
        catalogCard("official")
      ]
    }
  });
  assert.equal(report.holdout_consumed, false);
  assert.equal(report.denominator.identity_groups, 2);
  assert.equal(report.combined.all_known_exact_unique, 2);
  assert.equal(report.catalog.source_row_counts.official, 1);
});

test("self-source-only truth is not counted as independent addressability", () => {
  const report = screenCardJoinCatalog({
    dataset: { items: [truthItem("dev")] },
    manifest: frozenManifest({ development: ["dev"] }),
    catalog: { cards: [catalogCard("self-dev", {
      source: { source_type: "INTERNAL_CORRECTED_TITLE", source_metadata: { source_feedback_id: "dev" } }
    })] }
  });
  assert.equal(report.classification_counts.SELF_SOURCE_ONLY, 1);
  assert.equal(report.combined.core_unique, 0);
  assert.equal(report.status, "NO_GO");
});

test("same subject cannot replace a conflicting known card number in the GO numerator", () => {
  const development = truthItem("dev");
  const validation = truthItem("val", "validation");
  const report = screenCardJoinCatalog({
    dataset: { items: [development, validation] },
    manifest: frozenManifest({ development: ["dev"], validation: ["val"] }),
    catalog: { cards: [catalogCard("wrong-number", { card_number: "99" })] }
  });
  assert.equal(report.combined.core_unique, 2, "subject agreement remains a diagnostic support signal");
  assert.equal(report.combined.all_known_exact_unique, 0);
  assert.equal(report.status, "NO_GO");
});

test("catalog source lineage is excluded even when row ids differ", () => {
  const item = truthItem("dev");
  const report = screenCardJoinCatalog({
    dataset: { items: [item] },
    manifest: frozenManifest({ development: ["dev"] }),
    catalog: { cards: [catalogCard("different-row-id", {
      source: {
        source_type: "INTERNAL_CORRECTED_TITLE",
        source_metadata: { source_id: "dev", writer_title_batch_id: "writer-v1" }
      }
    })] }
  });
  assert.equal(report.classification_counts.SELF_SOURCE_ONLY, 1);
  assert.equal(report.combined.all_known_exact_unique, 0);
});
