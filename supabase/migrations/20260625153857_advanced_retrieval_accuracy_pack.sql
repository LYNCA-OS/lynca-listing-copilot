create extension if not exists pg_trgm with schema extensions;

alter table public.card_image_embeddings
  drop constraint if exists card_image_embeddings_embedding_role_check;

alter table public.card_image_embeddings
  add constraint card_image_embeddings_embedding_role_check
  check (embedding_role in (
    'front_global',
    'back_global',
    'full_card_global',
    'subject_layout',
    'card_design',
    'parallel_surface',
    'identity_text'
  ));

alter table public.vector_query_logs
  drop constraint if exists vector_query_logs_image_role_check;

alter table public.vector_query_logs
  add constraint vector_query_logs_image_role_check
  check (image_role in (
    'front_global',
    'back_global',
    'full_card_global',
    'subject_layout',
    'card_design',
    'parallel_surface',
    'identity_text'
  ));

alter table public.card_reference_images
  add column if not exists perceptual_hash text,
  add column if not exists color_moment_hash text,
  add column if not exists raw_or_slab text
    check (raw_or_slab in ('raw', 'slab', 'unknown') or raw_or_slab is null),
  add column if not exists language text,
  add column if not exists manufacturer_family text,
  add column if not exists single_or_multi_subject text
    check (single_or_multi_subject in ('single_subject', 'multi_subject', 'unknown') or single_or_multi_subject is null),
  add column if not exists reference_status text not null default 'candidate'
    check (reference_status in ('candidate', 'approved', 'reviewed', 'rejected', 'disabled')),
  add column if not exists reference_quality_score double precision;

alter table public.card_identities
  add column if not exists manufacturer_family text,
  add column if not exists single_or_multi_subject text
    check (single_or_multi_subject in ('single_subject', 'multi_subject', 'unknown') or single_or_multi_subject is null),
  add column if not exists reference_status text not null default 'candidate'
    check (reference_status in ('candidate', 'approved', 'reviewed', 'registry', 'disabled'));

create index if not exists card_identities_title_trgm_idx
  on public.card_identities
  using gin (canonical_title extensions.gin_trgm_ops);

create index if not exists card_identities_identity_key_trgm_idx
  on public.card_identities
  using gin (identity_key extensions.gin_trgm_ops);

create index if not exists card_identities_fields_gin_idx
  on public.card_identities using gin (fields);

create index if not exists card_identities_metadata_filter_idx
  on public.card_identities(
    category,
    manufacturer_family,
    single_or_multi_subject,
    retrieval_status,
    reference_status
  )
  where retrieval_enabled is true;

create index if not exists card_reference_images_metadata_filter_idx
  on public.card_reference_images(
    image_role,
    raw_or_slab,
    language,
    manufacturer_family,
    single_or_multi_subject,
    reference_status
  )
  where approved_for_retrieval is true;

create table if not exists public.vector_hard_negatives (
  hard_negative_id uuid primary key default gen_random_uuid(),
  query_id text not null,
  correct_identity_id uuid references public.card_identities(identity_id) on delete set null,
  wrong_candidate_identity_id uuid references public.card_identities(identity_id) on delete cascade,
  wrong_rank integer check (wrong_rank > 0),
  similarity double precision,
  margin double precision,
  conflicting_fields jsonb not null default '[]'::jsonb,
  error_type text not null
    check (error_type in (
      'same_subject_different_card',
      'same_product_different_year',
      'same_design_different_subject',
      'same_denominator_different_parallel',
      'same_product_family_different_edition',
      'multi_subject_omission',
      'other'
    )),
  reviewed_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.card_identity_prototypes (
  prototype_id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.card_identities(identity_id) on delete cascade,
  embedding_role text not null
    check (embedding_role in (
      'front_global',
      'back_global',
      'full_card_global',
      'subject_layout',
      'card_design',
      'parallel_surface',
      'identity_text'
    )),
  model_id text not null,
  model_revision text not null default 'main',
  preprocessing_version text not null,
  identity_medoid_embedding extensions.vector(768),
  quality_weighted_centroid extensions.vector(768),
  reference_count integer not null default 0 check (reference_count >= 0),
  quality_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_identity_prototypes_identity_model_role_uidx unique (
    identity_id,
    embedding_role,
    model_id,
    model_revision,
    preprocessing_version
  )
);

create table if not exists public.vector_fingerprints (
  fingerprint_id uuid primary key default gen_random_uuid(),
  reference_image_id uuid references public.card_reference_images(reference_image_id) on delete cascade,
  query_log_id uuid references public.vector_query_logs(query_log_id) on delete cascade,
  purpose text not null default 'duplicate_detection'
    check (purpose in ('duplicate_detection', 'near_duplicate_grouping', 'self_exclusion', 'evaluation_leakage_prevention')),
  content_sha256 text,
  perceptual_hash text,
  color_moment_hash text,
  keypoint_match_count integer check (keypoint_match_count is null or keypoint_match_count >= 0),
  inlier_count integer check (inlier_count is null or inlier_count >= 0),
  inlier_ratio double precision,
  homography_valid boolean,
  geometric_support_score double precision,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint vector_fingerprints_reference_or_query_check
    check (reference_image_id is not null or query_log_id is not null)
);

create table if not exists public.vector_ann_recall_audits (
  ann_audit_id uuid primary key default gen_random_uuid(),
  index_snapshot_id uuid references public.vector_index_snapshots(index_snapshot_id) on delete set null,
  model_id text not null,
  model_revision text not null default 'main',
  preprocessing_version text not null,
  category text,
  image_role text,
  ann_recall_at_1 double precision,
  ann_recall_at_5 double precision,
  ann_recall_at_10 double precision,
  index_latency_ms integer check (index_latency_ms is null or index_latency_ms >= 0),
  exact_latency_ms integer check (exact_latency_ms is null or exact_latency_ms >= 0),
  sample_count integer not null default 0 check (sample_count >= 0),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.vector_retrieval_ablation_runs (
  ablation_run_id uuid primary key default gen_random_uuid(),
  step text not null check (step in ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  candidate_recall_at_1 double precision,
  candidate_recall_at_5 double precision,
  candidate_recall_at_10 double precision,
  ai_card_exact double precision,
  recovery integer not null default 0 check (recovery >= 0),
  regression integer not null default 0 check (regression >= 0),
  net_benefit integer not null default 0,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  cost_usd numeric,
  unflagged_critical_error integer not null default 0 check (unflagged_critical_error >= 0),
  created_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb
);

create index if not exists vector_hard_negatives_wrong_identity_idx
  on public.vector_hard_negatives(wrong_candidate_identity_id, error_type, created_at desc);

create index if not exists card_identity_prototypes_identity_idx
  on public.card_identity_prototypes(identity_id, embedding_role, model_id, model_revision, preprocessing_version);

create index if not exists vector_fingerprints_content_idx
  on public.vector_fingerprints(content_sha256)
  where content_sha256 is not null;

create index if not exists vector_fingerprints_phash_idx
  on public.vector_fingerprints(perceptual_hash)
  where perceptual_hash is not null;

create index if not exists vector_ann_recall_audits_model_idx
  on public.vector_ann_recall_audits(model_id, model_revision, preprocessing_version, category, image_role, created_at desc);

create or replace function public.search_card_identities_hybrid(
  search_text text default null,
  exact_checklist_code text default null,
  exact_collector_number text default null,
  exact_subject text default null,
  exact_year text default null,
  exact_product text default null,
  match_count integer default 30
)
returns table (
  identity_id uuid,
  identity_key text,
  canonical_title text,
  category text,
  fields jsonb,
  retrieval_status text,
  channel_id text,
  raw_score double precision,
  normalized_score double precision,
  supporting_fields text[]
)
language sql
stable
as $$
  with input as (
    select
      lower(trim(coalesce(search_text, ''))) as q,
      lower(trim(coalesce(exact_checklist_code, ''))) as checklist_code,
      lower(regexp_replace(trim(coalesce(exact_collector_number, '')), '^#\s*', '')) as collector_number,
      lower(trim(coalesce(exact_subject, ''))) as subject,
      lower(trim(coalesce(exact_year, ''))) as year_text,
      lower(trim(coalesce(exact_product, ''))) as product
  ),
  candidate_text as (
    select
      ci.identity_id,
      ci.identity_key,
      ci.canonical_title,
      ci.category,
      ci.fields,
      ci.retrieval_status,
      lower(concat_ws(
        ' ',
        ci.identity_key,
        ci.canonical_title,
        ci.category,
        ci.fields->>'year',
        ci.fields->>'brand',
        ci.fields->>'manufacturer',
        ci.fields->>'product',
        ci.fields->>'set',
        ci.fields->>'player',
        ci.fields->>'character',
        ci.fields->>'collector_number',
        ci.fields->>'checklist_code',
        ci.fields->>'parallel_exact',
        ci.fields->>'parallel'
      )) as blob
    from public.card_identities ci
    where ci.retrieval_enabled is true
      and ci.retrieval_status in ('approved', 'reviewed', 'registry')
  ),
  scored as (
    select
      c.*,
      (
        case when i.checklist_code <> '' and lower(coalesce(c.fields->>'checklist_code', '')) = i.checklist_code then 3.0 else 0 end
        + case when i.collector_number <> '' and lower(regexp_replace(coalesce(c.fields->>'collector_number', ''), '^#\s*', '')) = i.collector_number then 1.4 else 0 end
        + case when i.subject <> '' and c.blob like '%' || i.subject || '%' then 1.0 else 0 end
        + case when i.year_text <> '' and lower(coalesce(c.fields->>'year', '')) = i.year_text then 0.8 else 0 end
        + case when i.product <> '' and (
            lower(coalesce(c.fields->>'product', '')) like '%' || i.product || '%'
            or lower(coalesce(c.fields->>'set', '')) like '%' || i.product || '%'
            or c.blob like '%' || i.product || '%'
          ) then 0.8 else 0 end
        + case when i.q <> '' then least(1.0, greatest(extensions.similarity(c.blob, i.q), 0)) else 0 end
        + case when i.q <> ''
            and to_tsvector('simple', c.blob) @@ websearch_to_tsquery('simple', i.q)
          then ts_rank_cd(to_tsvector('simple', c.blob), websearch_to_tsquery('simple', i.q))
          else 0
          end
      ) as raw_score,
      array_remove(array[
        case when i.checklist_code <> '' and lower(coalesce(c.fields->>'checklist_code', '')) = i.checklist_code then 'checklist_code' end,
        case when i.collector_number <> '' and lower(regexp_replace(coalesce(c.fields->>'collector_number', ''), '^#\s*', '')) = i.collector_number then 'collector_number' end,
        case when i.subject <> '' and c.blob like '%' || i.subject || '%' then 'subjects' end,
        case when i.year_text <> '' and lower(coalesce(c.fields->>'year', '')) = i.year_text then 'year' end,
        case when i.product <> '' and c.blob like '%' || i.product || '%' then 'product' end,
        case when i.q <> ''
            and to_tsvector('simple', c.blob) @@ websearch_to_tsquery('simple', i.q)
          then 'full_text'
          end,
        case when i.q <> '' and extensions.similarity(c.blob, i.q) > 0 then 'trigram'
          end
      ], null)::text[] as supporting_fields
    from candidate_text c
    cross join input i
    where i.q <> ''
      or i.checklist_code <> ''
      or i.collector_number <> ''
      or i.subject <> ''
      or i.year_text <> ''
      or i.product <> ''
  )
  select
    s.identity_id,
    s.identity_key,
    s.canonical_title,
    s.category,
    s.fields,
    s.retrieval_status,
    case
      when 'checklist_code' = any(s.supporting_fields) or 'collector_number' = any(s.supporting_fields) then 'ocr_exact_code'
      when 'full_text' = any(s.supporting_fields) or 'trigram' = any(s.supporting_fields) then 'postgres_full_text'
      else 'structured_metadata'
    end as channel_id,
    s.raw_score,
    least(1.0, s.raw_score / 5.5) as normalized_score,
    s.supporting_fields
  from scored s
  where s.raw_score > 0
  order by s.raw_score desc, s.identity_key asc
  limit least(greatest(coalesce(match_count, 30), 1), 50);
$$;

alter table public.vector_hard_negatives enable row level security;
alter table public.card_identity_prototypes enable row level security;
alter table public.vector_fingerprints enable row level security;
alter table public.vector_ann_recall_audits enable row level security;
alter table public.vector_retrieval_ablation_runs enable row level security;

revoke all on table public.vector_hard_negatives from anon, authenticated;
revoke all on table public.card_identity_prototypes from anon, authenticated;
revoke all on table public.vector_fingerprints from anon, authenticated;
revoke all on table public.vector_ann_recall_audits from anon, authenticated;
revoke all on table public.vector_retrieval_ablation_runs from anon, authenticated;

grant select, insert, update, delete on table public.vector_hard_negatives to service_role;
grant select, insert, update, delete on table public.card_identity_prototypes to service_role;
grant select, insert, update, delete on table public.vector_fingerprints to service_role;
grant select, insert, update, delete on table public.vector_ann_recall_audits to service_role;
grant select, insert, update, delete on table public.vector_retrieval_ablation_runs to service_role;

revoke all on function public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) to service_role;

comment on table public.vector_hard_negatives is
  'Reviewed retrieval mistakes used by the candidate reranker. These rows do not fine-tune embeddings and must be validated by ablation before production defaults change.';

comment on table public.card_identity_prototypes is
  'Per-identity visual prototypes. Instance retrieval remains primary; medoids and quality-weighted centroids are support signals only.';

comment on table public.vector_fingerprints is
  'Content and perceptual hashes for duplicate detection, near-duplicate grouping, self-exclusion, and evaluation leakage prevention. Geometric support cannot confirm serial, grade, or entity fields.';

comment on table public.vector_ann_recall_audits is
  'Periodic exact-search audits for HNSW recall. ANN recall drops must be diagnosed before blaming GPT or the embedding model.';

comment on table public.vector_retrieval_ablation_runs is
  'Ablation metrics for Advanced Retrieval steps A-G. A step should not become default unless net benefit is positive and regression does not increase.';

comment on function public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) is
  'Returns text, exact-code, and structured metadata identity candidates for RRF. Inputs must come from current-query evidence only; corrected titles and hidden ground truth are prohibited.';
