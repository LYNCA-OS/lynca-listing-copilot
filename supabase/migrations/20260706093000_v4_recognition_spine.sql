create table if not exists public.v4_recognition_sessions (
  id text primary key,
  schema_version text not null,
  status text not null,
  asset_id text,
  preingestion_bundle_id text,
  route text,
  route_reason text,
  route_plan jsonb not null default '{}'::jsonb,
  request_summary jsonb not null default '{}'::jsonb,
  final_title text,
  writer_final_title text,
  resolved_fields jsonb not null default '{}'::jsonb,
  field_states jsonb not null default '{}'::jsonb,
  candidate_control_plane_trace jsonb not null default '{}'::jsonb,
  provider_result_summary jsonb not null default '{}'::jsonb,
  writer_feedback_event_id text,
  learning_event_id text,
  failure_reason text,
  operator_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v4_preingestion_bundles (
  id text primary key,
  asset_id text,
  schema_version text not null,
  status text not null default 'READY',
  bundle jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v4_field_evidence (
  id text primary key,
  recognition_session_id text not null references public.v4_recognition_sessions(id) on delete cascade,
  field_name text not null,
  field_value text,
  display_status text not null default 'NORMAL',
  source_type text not null default 'V4_RESULT_ADAPTER',
  provenance jsonb not null default '{}'::jsonb,
  confidence double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.v4_candidate_traces (
  id text primary key,
  recognition_session_id text not null references public.v4_recognition_sessions(id) on delete cascade,
  schema_version text not null,
  trace jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.v4_writer_feedback_events (
  id text primary key,
  recognition_session_id text not null references public.v4_recognition_sessions(id) on delete cascade,
  schema_version text not null,
  action text not null,
  generated_title text,
  writer_final_title text,
  title_diff jsonb not null default '{}'::jsonb,
  field_graph jsonb not null default '{}'::jsonb,
  correction_type text,
  operator_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.v4_learning_events (
  id text primary key,
  recognition_session_id text not null references public.v4_recognition_sessions(id) on delete cascade,
  schema_version text not null,
  event_type text not null,
  generated_title text,
  writer_final_title text,
  field_level_ground_truth jsonb not null default '{}'::jsonb,
  candidate_reranker_dataset jsonb not null default '[]'::jsonb,
  hard_negative_samples jsonb not null default '[]'::jsonb,
  training_eligible boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.v4_production_quality_ledger (
  id text primary key,
  recognition_session_id text not null references public.v4_recognition_sessions(id) on delete cascade,
  schema_version text not null,
  route text,
  provider text,
  model text,
  status text,
  confidence text,
  latency_ms double precision,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  provider_error_type text,
  token_diagnostics jsonb not null default '{}'::jsonb,
  timing jsonb not null default '{}'::jsonb,
  route_plan jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  persistence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.v4_catalog_gap_queue (
  id text primary key,
  recognition_session_id text references public.v4_recognition_sessions(id) on delete set null,
  asset_id text,
  gap_type text not null default 'CATALOG_IDENTITY_GAP',
  observed_fields jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  draft_title text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists v4_recognition_sessions_status_idx on public.v4_recognition_sessions(status);
create index if not exists v4_recognition_sessions_asset_idx on public.v4_recognition_sessions(asset_id);
create index if not exists v4_recognition_sessions_created_idx on public.v4_recognition_sessions(created_at desc);
create index if not exists v4_preingestion_bundles_asset_idx on public.v4_preingestion_bundles(asset_id);
create index if not exists v4_field_evidence_session_idx on public.v4_field_evidence(recognition_session_id);
create index if not exists v4_field_evidence_field_idx on public.v4_field_evidence(field_name);
create index if not exists v4_candidate_traces_session_idx on public.v4_candidate_traces(recognition_session_id);
create index if not exists v4_writer_feedback_events_session_idx on public.v4_writer_feedback_events(recognition_session_id);
create index if not exists v4_learning_events_session_idx on public.v4_learning_events(recognition_session_id);
create index if not exists v4_quality_ledger_session_idx on public.v4_production_quality_ledger(recognition_session_id);
create index if not exists v4_catalog_gap_queue_status_idx on public.v4_catalog_gap_queue(status);
