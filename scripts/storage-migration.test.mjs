import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260622_listing_image_storage.sql", "utf8");
const rollback = await readFile("supabase/migrations/20260622_listing_image_storage_rollback.sql", "utf8");
const verificationMigration = await readFile("supabase/migrations/20260622_listing_image_verifications.sql", "utf8");
const verificationRollback = await readFile("supabase/migrations/20260622_listing_image_verifications_rollback.sql", "utf8");
const visualVectorMigration = await readFile("supabase/migrations/20260625035856_card_visual_vector_retrieval.sql", "utf8");
const visualVectorRollback = await readFile("supabase/migrations/20260625035856_card_visual_vector_retrieval_rollback.sql", "utf8");
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

assert.match(visualVectorMigration, /create extension if not exists vector with schema extensions/i, "visual vector migration should enable pgvector");
assert.match(visualVectorMigration, /create table if not exists public\.card_identities/i, "visual vector migration should create card identities");
assert.match(visualVectorMigration, /create table if not exists public\.card_reference_images/i, "visual vector migration should create reference image records");
assert.match(visualVectorMigration, /create table if not exists public\.card_image_embeddings/i, "visual vector migration should create embedding records");
assert.match(visualVectorMigration, /reference_key text not null/i, "reference images should have a stable upsert key");
assert.match(visualVectorMigration, /card_reference_images_identity_role_key_uidx/i, "reference images should be idempotently upsertable without true content hashes");
assert.match(visualVectorMigration, /model_id text not null/i, "embedding records should preserve model id");
assert.match(visualVectorMigration, /model_revision text not null/i, "embedding records should preserve model revision");
assert.match(visualVectorMigration, /preprocessing_version text not null/i, "embedding records should preserve preprocessing version");
assert.match(visualVectorMigration, /embedding extensions\.vector\(768\) not null/i, "embedding records should use fixed pgvector dimensions");
assert.match(visualVectorMigration, /using hnsw\s*\(embedding extensions\.vector_cosine_ops\)/i, "visual vector migration should create HNSW cosine index");
assert.match(visualVectorMigration, /create or replace function public\.match_card_image_embeddings/i, "visual vector migration should expose a top-K RPC");
assert.match(visualVectorMigration, /retrieval_enabled is true/i, "visual vector RPC should only search enabled identities");
assert.match(visualVectorMigration, /include_candidate_identities boolean default false/i, "candidate identities should be opt-in for visual vector retrieval");
assert.match(visualVectorMigration, /include_candidate_identities is true and ci\.retrieval_status = 'candidate'/i, "candidate identities should only search when explicitly requested");
assert.match(visualVectorMigration, /approved_for_retrieval is true/i, "visual vector RPC should only search approved reference images");
assert.match(visualVectorMigration, /revoke all on table public\.card_image_embeddings from anon, authenticated/i, "embedding table should remain server-only");
assert.match(visualVectorMigration, /grant execute on function public\.match_card_image_embeddings/i, "visual vector RPC should be callable by service role");
assert.match(visualVectorRollback, /drop function if exists public\.match_card_image_embeddings/i, "visual vector rollback should drop the RPC");
assert.match(visualVectorRollback, /drop table if exists public\.card_image_embeddings/i, "visual vector rollback should drop embedding records");

assert.match(phase2, /20260622_listing_image_storage\.sql/, "Phase 2 doc should mention the storage migration");
assert.match(phase2, /20260622_listing_image_verifications\.sql/, "Phase 2 doc should mention the verification migration");
assert.match(phase2, /private bucket/i, "Phase 2 doc should keep the private bucket boundary visible");

console.log("storage migration tests passed");
