import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationFiles = Object.freeze({
  parents: new URL("../supabase/migrations/20260717190000_track_c_legacy_asset_parent_convergence_v1.sql", import.meta.url),
  provenance: new URL("../supabase/migrations/20260717191000_listing_image_verified_crop_provenance_v1.sql", import.meta.url),
  enqueue: new URL("../supabase/migrations/20260717192000_atomic_enqueue_verified_image_set_v2.sql", import.meta.url),
  runtime: new URL("../supabase/migrations/20260717193000_track_c_runtime_schema_convergence_v1.sql", import.meta.url)
});

const entries = await Promise.all(Object.entries(migrationFiles).map(async ([name, file]) => (
  [name, await readFile(file, "utf8")]
)));
const migrations = Object.fromEntries(entries);

assert.match(migrations.parents, /information_schema\.tables[\s\S]*table_type = 'BASE TABLE'/i);
assert.match(migrations.parents, /drop table if exists pg_temp\.track_c_asset_parent_convergence_v1/i);
assert.match(migrations.parents, /on commit preserve rows/i);
assert.match(migrations.parents, /drop table track_c_asset_parent_convergence_v1/i);
assert.match(migrations.parents, /listing_asset_cross_tenant_conflict/);
assert.match(migrations.parents, /listing_asset_parent_convergence_incomplete/);
assert.match(migrations.parents, /insert into public\.listing_assets \(id, tenant_id\)/i);
assert.match(migrations.parents, /insert into public\.listing_assets \(id, tenant_id, image_generation_id\)/i);

assert.match(migrations.provenance, /set canonical_eligible = false\s+where canonical_eligible is null/i);
assert.match(migrations.provenance, /set image_generation_id = null,[\s\S]*where canonical_eligible is false/i);
assert.match(migrations.provenance, /array_length\(pg_catalog\.string_to_array\(object_path, '\/'\), 1\) = 6/i);
assert.match(migrations.provenance, /coalesce\(\([\s\S]*object_verified is true[\s\S]*content_hash_verified is true[\s\S]*dimension_source = 'object_bytes'[\s\S]*bucket = 'listing-card-images'[\s\S]*size > 0[\s\S]*width > 0[\s\S]*height > 0[\s\S]*\), false\)/i);
assert.match(migrations.provenance, /v_x is null or v_y is null or v_width is null or v_height is null/i);
assert.match(migrations.provenance, /listing_crop_source_not_verified/);
assert.match(migrations.provenance, /source_side' = 'front'[\s\S]*front_original[\s\S]*source_side' = 'back'[\s\S]*back_original/i);
assert.match(migrations.provenance, /listing_asset_retired_image_set_immutable/);
assert.match(migrations.provenance, /listing_canonical_image_identity_immutable/);
assert.match(migrations.provenance, /listing_canonical_image_invalidation_incomplete/);
assert.match(migrations.provenance, /listing_canonical_image_delete_requires_invalidation/);
assert.match(migrations.provenance, /before update\s+on public\.listing_image_verifications/i);
assert.match(migrations.provenance, /before delete\s+on public\.listing_image_verifications/i);

assert.match(migrations.enqueue, /create or replace function public\.canonical_listing_asset_image_set/i);
assert.match(migrations.enqueue, /image_references' is distinct from v_set -> 'image_references'/i);
assert.match(migrations.enqueue, /session_verified_image_set_conflict/);
assert.match(migrations.enqueue, /job_verified_image_set_conflict/);
assert.equal(
  (migrations.enqueue.match(/when invalid_text_representation or numeric_value_out_of_range/g) || []).length,
  2,
  "session and job guards must normalize malformed original-count projections"
);

assert.doesNotMatch(migrations.runtime, /pg_catalog\.(?:greatest|least)\s*\(/i);
assert.match(migrations.runtime, /alter column max_attempts set default 4/i);
assert.match(migrations.runtime, /create or replace function public\.finalize_exhausted_v4_recognition_jobs/i);
assert.match(migrations.runtime, /create or replace function public\.fail_v4_recognition_job/i);
assert.match(migrations.runtime, /revoke usage on schema storage from anon, authenticated/i);
assert.match(migrations.runtime, /revoke all on table storage\.objects from public, anon, authenticated/i);

console.log("canonical image migration contract tests passed");
