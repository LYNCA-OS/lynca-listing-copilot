import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL(
  "../supabase/migrations/20260723200346_catalog_retrieval_preserve_structured_fields.sql",
  import.meta.url
), "utf8");

for (const field of [
  "game",
  "language",
  "subject",
  "card_name",
  "rarity",
  "parallel_name",
  "parallel_exact",
  "image_url",
  "image_urls",
  "external_id"
]) {
  assert.match(migration, new RegExp(`catalog_fields,${field}`));
}

assert.match(migration, /candidate\.fields\s*\|\|\s*jsonb_strip_nulls/i);
assert.match(migration, /to service_role/i);
assert.doesNotMatch(migration, /serial_number|grade_company|cert_number|condition/i);

console.log("catalog field fidelity migration tests passed");
