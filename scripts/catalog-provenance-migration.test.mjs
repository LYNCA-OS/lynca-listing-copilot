import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL(
  "../supabase/migrations/20260723193552_quarantine_marketplace_catalog_provenance.sql",
  import.meta.url
), "utf8");

assert.match(migration, /source_type\s*=\s*'MARKETPLACE_REFERENCE'/);
assert.match(migration, /provenance_policy'\s*,\s*'legacy_ebay_diagnostic_only_v1'/);
assert.match(migration, /catalog_provenance_backfill_incomplete/);
assert.doesNotMatch(migration, /delete\s+from\s+public\.catalog_/i);

for (const table of ["catalog_products", "catalog_sets", "catalog_cards", "catalog_parallels"]) {
  const tableBlock = new RegExp(
    `alter table public\\.${table}[\\s\\S]*?alter column source_id set not null;[\\s\\S]*?on delete restrict;`,
    "i"
  );
  assert.match(migration, tableBlock, `${table} must require durable source provenance`);
}

console.log("catalog provenance migration tests passed");
