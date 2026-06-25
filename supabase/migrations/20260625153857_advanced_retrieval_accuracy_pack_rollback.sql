drop function if exists public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
);

drop table if exists public.vector_retrieval_ablation_runs;
drop table if exists public.vector_ann_recall_audits;
drop table if exists public.vector_fingerprints;
drop table if exists public.card_identity_prototypes;
drop table if exists public.vector_hard_negatives;

drop index if exists public.card_reference_images_metadata_filter_idx;
drop index if exists public.card_identities_metadata_filter_idx;
drop index if exists public.card_identities_fields_gin_idx;
drop index if exists public.card_identities_identity_key_trgm_idx;
drop index if exists public.card_identities_title_trgm_idx;

alter table if exists public.card_image_embeddings
  drop constraint if exists card_image_embeddings_embedding_role_check;

alter table if exists public.card_image_embeddings
  add constraint card_image_embeddings_embedding_role_check
  check (embedding_role in ('front_global', 'back_global', 'full_card_global', 'subject_layout', 'parallel_surface'));

alter table if exists public.vector_query_logs
  drop constraint if exists vector_query_logs_image_role_check;

alter table if exists public.vector_query_logs
  add constraint vector_query_logs_image_role_check
  check (image_role in ('front_global', 'back_global', 'full_card_global', 'subject_layout', 'parallel_surface'));

alter table if exists public.card_reference_images
  drop column if exists perceptual_hash,
  drop column if exists color_moment_hash,
  drop column if exists raw_or_slab,
  drop column if exists language,
  drop column if exists manufacturer_family,
  drop column if exists single_or_multi_subject,
  drop column if exists reference_status,
  drop column if exists reference_quality_score;

alter table if exists public.card_identities
  drop column if exists manufacturer_family,
  drop column if exists single_or_multi_subject,
  drop column if exists reference_status;
