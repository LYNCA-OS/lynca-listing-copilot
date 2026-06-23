import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260622_listing_image_storage.sql", "utf8");
const rollback = await readFile("supabase/migrations/20260622_listing_image_storage_rollback.sql", "utf8");
const verificationMigration = await readFile("supabase/migrations/20260622_listing_image_verifications.sql", "utf8");
const verificationRollback = await readFile("supabase/migrations/20260622_listing_image_verifications_rollback.sql", "utf8");
const phase2 = await readFile("docs/architecture/phase-2-storage-image-quality-2026-06-22.md", "utf8");

assert.match(migration, /insert into storage\.buckets/i, "storage migration should create the Supabase bucket");
assert.match(migration, /'listing-card-images'/, "storage migration should target the default listing image bucket");
assert.match(migration, /public,\s*file_size_limit,\s*allowed_mime_types/is, "bucket migration should configure visibility, size, and MIME constraints");
assert.match(migration, /false,\s*26214400/is, "bucket must remain private with the default 25MB storage limit");

[
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
].forEach((mime) => {
  assert.match(migration, new RegExp(`'${mime}'`), `${mime} should be allowed by Storage migration`);
});

assert.match(migration, /on conflict \(id\) do update/i, "migration should be safely re-runnable");
assert.match(migration, /public = false/i, "bucket must stay private on migration reruns");
assert.match(migration, /auth\.role\(\) = 'service_role'/i, "storage policies should keep browser access out of the policy boundary");
assert.doesNotMatch(migration, /auth\.role\(\) = 'anon'|to anon|public = true/i, "migration must not grant anonymous or public object access");

assert.match(rollback, /drop policy if exists "listing_card_images_service_role_select"/i, "rollback should drop storage policies");
assert.match(rollback, /delete from storage\.buckets\s+where id = 'listing-card-images'/i, "rollback should remove only the default storage bucket row");

assert.match(verificationMigration, /create table if not exists public\.listing_image_verifications/i, "verification migration should create durable image verification records");
assert.match(verificationMigration, /object_path text primary key/i, "verification records should be keyed by stable object path");
assert.match(verificationMigration, /object_verified boolean not null default false/i, "verification records should preserve explicit verification state");
assert.match(verificationMigration, /alter table public\.listing_image_verifications enable row level security/i, "verification records should have RLS enabled");
assert.match(verificationRollback, /drop table if exists public\.listing_image_verifications/i, "verification rollback should remove only the verification table");

assert.match(phase2, /20260622_listing_image_storage\.sql/, "Phase 2 doc should mention the storage migration");
assert.match(phase2, /20260622_listing_image_verifications\.sql/, "Phase 2 doc should mention the verification migration");
assert.match(phase2, /private bucket/i, "Phase 2 doc should keep the private bucket boundary visible");

console.log("storage migration tests passed");
