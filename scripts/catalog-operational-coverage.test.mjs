import assert from "node:assert/strict";
import { buildCatalogOperationalCoverage, decisionActiveCatalogCard } from "./catalog-operational-coverage.mjs";

assert.equal(decisionActiveCatalogCard({
  source: { source_type: "PANINI_OFFICIAL_CHECKLIST", source_status: "OFFICIAL_CHECKLIST_RAW" },
  card: { source_status: "OFFICIAL_CHECKLIST_RAW" }
}), true);
assert.equal(decisionActiveCatalogCard({
  source: { source_type: "MARKETPLACE_REFERENCE", source_status: "REVIEW_REQUIRED" },
  card: { source_status: "REVIEW_REQUIRED" }
}), false);

const registry = [
  { provider: "internal", label: "Reviewed", source_type: "INTERNAL_CORRECTED_TITLE", quality_tier: "REVIEWED_INTERNAL", import_mode: "reviewed_internal", default_enabled: true },
  { provider: "panini", label: "Panini", source_type: "PANINI_OFFICIAL_CHECKLIST", quality_tier: "OFFICIAL_DISCOVERY", import_mode: "manual_csv_fallback", default_enabled: true },
  { provider: "upper_deck", label: "Upper Deck", source_type: "UPPER_DECK_OFFICIAL_CHECKLIST", quality_tier: "OFFICIAL_DISCOVERY", import_mode: "manual_csv_fallback", default_enabled: true }
];
const report = buildCatalogOperationalCoverage({
  registry,
  generatedAt: "2026-07-24T00:00:00.000Z",
  sources: [
    { id: "internal-1", source_type: "INTERNAL_CORRECTED_TITLE", source_status: "REVIEWED_INTERNAL" },
    { id: "panini-1", source_type: "PANINI_OFFICIAL_CHECKLIST", source_status: "OFFICIAL_CHECKLIST_RAW" },
    { id: "extra-1", source_type: "UNREGISTERED_TEST_SOURCE", source_status: "REVIEW_REQUIRED" }
  ],
  cards: [
    { id: "card-1", source_id: "internal-1", source_status: "REVIEWED_INTERNAL" },
    { id: "card-2", source_id: "panini-1", source_status: "OFFICIAL_CHECKLIST_RAW" },
    { id: "card-3", source_id: "missing-source", source_status: "REVIEW_REQUIRED" }
  ]
});

assert.equal(report.schema_version, "catalog-operational-coverage-v1");
assert.deepEqual(report.summary.stage_breakdown, { DECISION_ACTIVE: 2, REGISTERED_ONLY: 1 });
assert.equal(report.summary.orphan_catalog_card_count, 1);
assert.deepEqual(report.unregistered_source_types, ["UNREGISTERED_TEST_SOURCE"]);
assert.equal(report.sources.find((row) => row.provider === "panini").decision_active_card_count, 1);
assert.equal(report.sources.find((row) => row.provider === "upper_deck").operational_stage, "REGISTERED_ONLY");

console.log("catalog operational coverage tests passed");
