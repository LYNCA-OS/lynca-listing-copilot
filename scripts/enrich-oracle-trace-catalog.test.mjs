import assert from "node:assert/strict";
import { catalogRowsFromSnapshot, enrichOracleTraceCatalog } from "./enrich-oracle-trace-catalog.mjs";

const output = enrichOracleTraceCatalog({ cards: [{ retrieval_candidates: [{ identity_id: "identity-1", fields: { product: "Chrome", parallel_exact: "Gold" } }] }] }, [{
  identity_id: "identity-1",
  fields: { product: "Topps Chrome", subject: ["Player"], print_finish: ["Refractor"], serial_denominator: ["50"] }
}]);
assert.equal(output.catalog_enrichment.enriched_candidate_count, 1);
assert.equal(output.cards[0].retrieval_candidates[0].fields.product, "Chrome");
assert.deepEqual(output.cards[0].retrieval_candidates[0].fields.subject, ["Player"]);
assert.deepEqual(output.cards[0].retrieval_candidates[0].fields.print_finish, ["Refractor", "Gold"]);
assert.deepEqual(output.cards[0].retrieval_candidates[0].fields.numerical_rarity, ["#/50"]);

const snapshotRows = catalogRowsFromSnapshot({
  schema_version: "snapshot-v1",
  generated_at: "2026-07-24T00:00:00.000Z",
  cards: [{
    id: "identity-2",
    season_year: "2025",
    manufacturer: "Topps",
    product: "Chrome",
    players: ["Player"],
    surface_color: "Gold",
    serial_denominator: "50",
    metadata: { catalog_fields: { parallel_exact: "Gold Geometric" } }
  }]
});
assert.equal(snapshotRows[0].identity_id, "identity-2");
assert.deepEqual(snapshotRows[0].fields.print_finish, ["Gold Geometric", "Gold"]);
assert.equal(snapshotRows[0].provenance.snapshot_schema_version, "snapshot-v1");

console.log("enrich oracle trace catalog tests passed");
