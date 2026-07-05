create extension if not exists vector with schema extensions;

create table if not exists public.vector_index_snapshots (
  index_snapshot_id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  status text not null default 'building'
    check (status in ('building', 'active', 'retired', 'failed')),
  model_id text not null,
  model_revision text not null,
  preprocessing_version text not null,
  embedding_dimensions integer not null default 768 check (embedding_dimensions = 768),
  normalization_method text not null default 'l2',
  reference_count integer not null default 0 check (reference_count >= 0),
  embedding_count integer not null default 0 check (embedding_count >= 0),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.vector_query_logs (
  query_log_id uuid primary key default gen_random_uuid(),
  analysis_run_id text,
  asset_id text,
  source_feedback_id text,
  physical_card_id text,
  physical_instance_group_id text,
  image_id text,
  image_role text not null
    check (image_role in ('front_global', 'back_global', 'full_card_global', 'subject_layout', 'parallel_surface')),
  content_sha256 text,
  perceptual_hash text,
  model_id text not null,
  model_revision text not null,
  preprocessing_version text not null,
  embedding_dimensions integer not null default 768 check (embedding_dimensions = 768),
  normalization_method text not null default 'l2',
  embedding extensions.vector(768),
  searchable boolean not null default false check (searchable is false),
  status text not null default 'QUERY_ONLY'
    check (status in ('QUERY_ONLY', 'WRITER_APPROVED', 'REFERENCE_PENDING', 'REFERENCE_APPROVED', 'INDEXED', 'REJECTED')),
  quality_score double precision,
  generated_at timestamptz not null default now(),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.vector_retrieval_runs (
  retrieval_run_id uuid primary key default gen_random_uuid(),
  analysis_run_id text,
  query_log_id uuid references public.vector_query_logs(query_log_id) on delete set null,
  index_snapshot_id uuid references public.vector_index_snapshots(index_snapshot_id) on delete set null,
  mode text not null default 'shadow'
    check (mode in ('shadow', 'assist', 'eval')),
  status text not null
    check (status in ('VECTOR_RETRIEVAL_COMPLETED', 'VECTOR_NO_CONFIDENT_MATCH', 'VECTOR_RETRIEVAL_UNAVAILABLE', 'VECTOR_RETRIEVAL_TIMEOUT', 'VECTOR_RETRIEVAL_ERROR')),
  top_k integer not null default 10 check (top_k > 0),
  internal_top_n integer not null default 30 check (internal_top_n > 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  unavailable_reason text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.vector_retrieval_candidates (
  retrieval_candidate_id uuid primary key default gen_random_uuid(),
  retrieval_run_id uuid not null references public.vector_retrieval_runs(retrieval_run_id) on delete cascade,
  rank integer not null check (rank > 0),
  candidate_identity_id uuid references public.card_identities(identity_id) on delete set null,
  reference_image_id uuid references public.card_reference_images(reference_image_id) on delete set null,
  embedding_id uuid references public.card_image_embeddings(embedding_id) on delete set null,
  similarity double precision,
  combined_score double precision,
  top1_top2_margin double precision,
  reference_count integer not null default 1 check (reference_count > 0),
  candidate_fields jsonb not null default '{}'::jsonb,
  gpt_decision text check (gpt_decision in ('SELECTED', 'PARTIAL_SUPPORT', 'REJECTED_ALL', 'NOT_AVAILABLE') or gpt_decision is null),
  selected_by_gpt boolean,
  created_at timestamptz not null default now()
);

create index if not exists vector_index_snapshots_active_idx
  on public.vector_index_snapshots(model_id, model_revision, preprocessing_version, status)
  where status = 'active';

create index if not exists vector_query_logs_lookup_idx
  on public.vector_query_logs(content_sha256, model_id, model_revision, preprocessing_version, image_role);

create index if not exists vector_query_logs_query_only_idx
  on public.vector_query_logs(status, searchable)
  where searchable is false;

create index if not exists vector_retrieval_runs_analysis_idx
  on public.vector_retrieval_runs(analysis_run_id, created_at desc);

create index if not exists vector_retrieval_candidates_run_rank_idx
  on public.vector_retrieval_candidates(retrieval_run_id, rank);

alter table public.vector_index_snapshots enable row level security;
alter table public.vector_query_logs enable row level security;
alter table public.vector_retrieval_runs enable row level security;
alter table public.vector_retrieval_candidates enable row level security;

revoke all on table public.vector_index_snapshots from anon, authenticated;
revoke all on table public.vector_query_logs from anon, authenticated;
revoke all on table public.vector_retrieval_runs from anon, authenticated;
revoke all on table public.vector_retrieval_candidates from anon, authenticated;

grant select, insert, update, delete on table public.vector_index_snapshots to service_role;
grant select, insert, update, delete on table public.vector_query_logs to service_role;
grant select, insert, update, delete on table public.vector_retrieval_runs to service_role;
grant select, insert, update, delete on table public.vector_retrieval_candidates to service_role;

comment on table public.vector_index_snapshots is
  'Versioned approved-reference vector index snapshots. Query and reference vectors must use the same model, revision, preprocessing, dimensions, and normalization.';

comment on table public.vector_query_logs is
  'Non-searchable query embedding records for new uploads. These rows must not enter candidate retrieval before writer approval and reference eligibility checks.';

comment on table public.vector_retrieval_runs is
  'Per-request vector retrieval telemetry. UNAVAILABLE and NO_CONFIDENT_MATCH are distinct states.';

comment on table public.vector_retrieval_candidates is
  'Sanitized vector candidate telemetry for recovery/regression evaluation. Candidate fields must not include reference serial numerator, grade, cert, or seller titles.';
