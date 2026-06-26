import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260622_listing_image_storage.sql", "utf8");
const rollback = await readFile("supabase/migrations/20260622_listing_image_storage_rollback.sql", "utf8");
const verificationMigration = await readFile("supabase/migrations/20260622_listing_image_verifications.sql", "utf8");
const verificationRollback = await readFile("supabase/migrations/20260622_listing_image_verifications_rollback.sql", "utf8");
const visualVectorMigration = await readFile("supabase/migrations/20260625035856_card_visual_vector_retrieval.sql", "utf8");
const visualVectorRollback = await readFile("supabase/migrations/20260625035856_card_visual_vector_retrieval_rollback.sql", "utf8");
const vectorQueryLifecycleMigration = await readFile("supabase/migrations/20260625151516_vector_query_lifecycle.sql", "utf8");
const vectorQueryLifecycleRollback = await readFile("supabase/migrations/20260625151516_vector_query_lifecycle_rollback.sql", "utf8");
const advancedRetrievalMigration = await readFile("supabase/migrations/20260625153857_advanced_retrieval_accuracy_pack.sql", "utf8");
const advancedRetrievalRollback = await readFile("supabase/migrations/20260625153857_advanced_retrieval_accuracy_pack_rollback.sql", "utf8");
const referencePromotionMigration = await readFile("supabase/migrations/20260626051832_promote_card_reference_to_approved.sql", "utf8");
const referencePromotionRollback = await readFile("supabase/migrations/20260626051832_promote_card_reference_to_approved_rollback.sql", "utf8");
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

assert.match(vectorQueryLifecycleMigration, /create table if not exists public\.vector_index_snapshots/i, "vector lifecycle migration should create index snapshots");
assert.match(vectorQueryLifecycleMigration, /create table if not exists public\.vector_query_logs/i, "vector lifecycle migration should create query logs");
assert.match(vectorQueryLifecycleMigration, /searchable boolean not null default false check \(searchable is false\)/i, "query embeddings must remain non-searchable");
assert.match(vectorQueryLifecycleMigration, /status in \('QUERY_ONLY', 'WRITER_APPROVED', 'REFERENCE_PENDING', 'REFERENCE_APPROVED', 'INDEXED', 'REJECTED'\)/i, "query lifecycle states should be explicit");
assert.match(vectorQueryLifecycleMigration, /model_revision text not null/i, "vector lifecycle tables should preserve model revision");
assert.match(vectorQueryLifecycleMigration, /preprocessing_version text not null/i, "vector lifecycle tables should preserve preprocessing version");
assert.match(vectorQueryLifecycleMigration, /VECTOR_RETRIEVAL_UNAVAILABLE/i, "retrieval telemetry should distinguish unavailable from no-match");
assert.match(vectorQueryLifecycleMigration, /alter table public\.vector_query_logs enable row level security/i, "query logs should have RLS enabled");
assert.match(vectorQueryLifecycleMigration, /revoke all on table public\.vector_query_logs from anon, authenticated/i, "query logs must stay server-only");
assert.match(vectorQueryLifecycleMigration, /grant select, insert, update, delete on table public\.vector_retrieval_candidates to service_role/i, "retrieval candidate telemetry should be service-role only");
assert.match(vectorQueryLifecycleRollback, /drop table if exists public\.vector_query_logs/i, "vector lifecycle rollback should drop query logs");
assert.match(vectorQueryLifecycleRollback, /drop table if exists public\.vector_index_snapshots/i, "vector lifecycle rollback should drop snapshots");

assert.match(advancedRetrievalMigration, /create extension if not exists pg_trgm with schema extensions/i, "advanced retrieval migration should enable trigram search");
assert.match(advancedRetrievalMigration, /card_design/i, "advanced retrieval migration should allow card design embedding roles");
assert.match(advancedRetrievalMigration, /identity_text/i, "advanced retrieval migration should allow identity text embedding roles");
assert.match(advancedRetrievalMigration, /create table if not exists public\.vector_hard_negatives/i, "advanced retrieval migration should create hard negative store");
assert.match(advancedRetrievalMigration, /same_subject_different_card/i, "hard negative taxonomy should include same-subject different-card errors");
assert.match(advancedRetrievalMigration, /same_denominator_different_parallel/i, "hard negative taxonomy should include denominator/parallel errors");
assert.match(advancedRetrievalMigration, /create table if not exists public\.card_identity_prototypes/i, "advanced retrieval migration should create identity prototypes");
assert.match(advancedRetrievalMigration, /identity_medoid_embedding extensions\.vector\(768\)/i, "identity prototypes should store medoid embeddings");
assert.match(advancedRetrievalMigration, /quality_weighted_centroid extensions\.vector\(768\)/i, "identity prototypes should store quality-weighted centroids");
assert.match(advancedRetrievalMigration, /create table if not exists public\.vector_fingerprints/i, "advanced retrieval migration should create visual fingerprints");
assert.match(advancedRetrievalMigration, /content_sha256/i, "visual fingerprints should preserve content hashes");
assert.match(advancedRetrievalMigration, /perceptual_hash/i, "visual fingerprints should preserve pHash");
assert.match(advancedRetrievalMigration, /color_moment_hash/i, "visual fingerprints should preserve color moment hash");
assert.match(advancedRetrievalMigration, /homography_valid/i, "visual fingerprints should store geometric verification support");
assert.match(advancedRetrievalMigration, /create table if not exists public\.vector_ann_recall_audits/i, "advanced retrieval migration should create ANN recall audit records");
assert.match(advancedRetrievalMigration, /ann_recall_at_1/i, "ANN audit should preserve recall@1");
assert.match(advancedRetrievalMigration, /create table if not exists public\.vector_retrieval_ablation_runs/i, "advanced retrieval migration should create ablation run records");
assert.match(advancedRetrievalMigration, /check \(step in \('A', 'B', 'C', 'D', 'E', 'F', 'G'\)\)/i, "ablation steps should be explicit");
assert.match(advancedRetrievalMigration, /create or replace function public\.search_card_identities_hybrid/i, "advanced retrieval migration should expose hybrid Postgres RPC");
assert.match(advancedRetrievalMigration, /websearch_to_tsquery/i, "hybrid RPC should use Postgres full-text search");
assert.match(advancedRetrievalMigration, /extensions\.similarity/i, "hybrid RPC should use trigram similarity");
assert.match(advancedRetrievalMigration, /alter table public\.vector_hard_negatives enable row level security/i, "hard negatives should have RLS enabled");
assert.match(advancedRetrievalMigration, /revoke all on table public\.vector_hard_negatives from anon, authenticated/i, "hard negatives must stay server-only");
assert.match(advancedRetrievalMigration, /grant select, insert, update, delete on table public\.vector_hard_negatives to service_role/i, "hard negatives should be service-role accessible");
assert.match(advancedRetrievalMigration, /grant execute on function public\.search_card_identities_hybrid/i, "hybrid RPC should be callable only by service role");
assert.match(advancedRetrievalMigration, /corrected titles and hidden ground truth are prohibited/i, "hybrid RPC comment should preserve no-label-leakage contract");
assert.match(advancedRetrievalRollback, /drop function if exists public\.search_card_identities_hybrid/i, "advanced retrieval rollback should drop the hybrid RPC");
assert.match(advancedRetrievalRollback, /drop table if exists public\.vector_hard_negatives/i, "advanced retrieval rollback should drop hard negatives");
assert.match(advancedRetrievalRollback, /drop table if exists public\.card_identity_prototypes/i, "advanced retrieval rollback should drop identity prototypes");

assert.match(referencePromotionMigration, /create or replace function public\.promote_card_reference_to_approved/i, "promotion migration should create an atomic promotion RPC");
assert.match(referencePromotionMigration, /model_revision set default 'f775b65a79762255128c981547af89addcfe0f88'/i, "promotion migration should pin SigLIP2 revision defaults");
assert.match(referencePromotionMigration, /language plpgsql/i, "promotion RPC should run as a single database transaction");
assert.doesNotMatch(referencePromotionMigration, /security definer/i, "promotion RPC must not bypass RLS with SECURITY DEFINER");
assert.match(referencePromotionMigration, /for update/i, "promotion RPC should lock identity and reference rows");
assert.match(referencePromotionMigration, /update public\.card_identities[\s\S]*retrieval_enabled = true/i, "promotion RPC should enable identity retrieval");
assert.match(referencePromotionMigration, /update public\.card_reference_images[\s\S]*approved_for_retrieval = true/i, "promotion RPC should approve reference image retrieval");
assert.match(referencePromotionMigration, /update public\.card_image_embeddings[\s\S]*'index_status', 'active'/i, "promotion RPC should mark embedding/index state active");
assert.match(referencePromotionMigration, /insert into public\.card_reference_promotion_events/i, "promotion RPC should record promotion events");
assert.match(referencePromotionMigration, /update public\.catalog_gap_queue/i, "promotion RPC should close catalog gaps when supplied");
assert.match(referencePromotionMigration, /revoke all on function public\.promote_card_reference_to_approved/i, "promotion RPC should revoke public execution");
assert.match(referencePromotionMigration, /grant execute on function public\.promote_card_reference_to_approved[\s\S]*to service_role/i, "promotion RPC should be service-role only");
assert.match(referencePromotionRollback, /drop function if exists public\.promote_card_reference_to_approved/i, "promotion rollback should drop the promotion RPC");

assert.match(phase2, /20260622_listing_image_storage\.sql/, "Phase 2 doc should mention the storage migration");
assert.match(phase2, /20260622_listing_image_verifications\.sql/, "Phase 2 doc should mention the verification migration");
assert.match(phase2, /private bucket/i, "Phase 2 doc should keep the private bucket boundary visible");

console.log("storage migration tests passed");
