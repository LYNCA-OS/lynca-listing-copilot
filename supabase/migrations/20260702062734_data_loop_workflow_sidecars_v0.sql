create extension if not exists pgcrypto with schema extensions;

create table if not exists public.data_loop_integration_runs (
  run_id uuid primary key default gen_random_uuid(),
  integration_name text not null,
  mode text not null default 'stub',
  status text not null default 'queued',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  input_count integer not null default 0,
  output_count integer not null default 0,
  error_count integer not null default 0,
  report_json jsonb not null default '{}'::jsonb,
  commit_sha text,
  cloud_environment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_loop_integration_runs_status_check
    check (status in ('queued', 'running', 'completed', 'failed', 'skipped'))
);

create table if not exists public.recognition_workflow_events (
  event_id uuid primary key default gen_random_uuid(),
  analysis_run_id text,
  asset_id text,
  source_record_id text,
  event_payload jsonb not null default '{}'::jsonb,
  workflow_action_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);

create table if not exists public.catalog_entity_clusters (
  cluster_id uuid primary key default gen_random_uuid(),
  source_record_ids jsonb not null default '[]'::jsonb,
  canonical_candidate_title text,
  canonical_fields jsonb not null default '{}'::jsonb,
  confidence numeric,
  match_probability numeric,
  source_breakdown jsonb not null default '{}'::jsonb,
  review_status text not null default 'candidate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_entity_clusters_review_status_check
    check (review_status in ('candidate', 'active', 'review_required', 'merged', 'rejected'))
);

create table if not exists public.data_quality_findings (
  finding_id uuid primary key default gen_random_uuid(),
  workflow_action_id text,
  idempotency_key text,
  source_record_id text,
  analysis_run_id text,
  finding_type text not null,
  severity text not null default 'MEDIUM',
  score numeric,
  affected_fields jsonb not null default '[]'::jsonb,
  explanation text,
  recommended_action text,
  review_status text not null default 'OPEN',
  workflow_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_quality_findings_severity_check
    check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  constraint data_quality_findings_review_status_check
    check (review_status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'))
);

create table if not exists public.annotation_tasks (
  task_id uuid primary key default gen_random_uuid(),
  workflow_action_id text,
  idempotency_key text,
  tool text not null,
  source_record_id text,
  analysis_run_id text,
  image_ids jsonb not null default '[]'::jsonb,
  prelabel_fields jsonb not null default '{}'::jsonb,
  task_payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED',
  review_url text,
  exported_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_tasks_tool_check
    check (tool in ('label_studio', 'cvat')),
  constraint annotation_tasks_status_check
    check (status in ('QUEUED', 'CREATED', 'COMPLETED', 'FAILED', 'NOT_CONFIGURED', 'CANCELLED'))
);

create table if not exists public.reviewed_field_annotations (
  annotation_id uuid primary key default gen_random_uuid(),
  source_record_id text,
  analysis_run_id text,
  tool text not null default 'label_studio',
  field_name text not null,
  ai_value jsonb,
  reviewed_value jsonb,
  review_status text not null default 'REVIEWED',
  reviewer_id text,
  confidence numeric,
  annotation_task_id uuid references public.annotation_tasks(task_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviewed_field_annotations_review_status_check
    check (review_status in ('REVIEWED', 'APPROVED', 'CORRECTED', 'REJECTED', 'UNCERTAIN'))
);

create table if not exists public.crop_annotations (
  annotation_id uuid primary key default gen_random_uuid(),
  source_record_id text,
  image_id text,
  region_type text not null,
  bbox jsonb not null default '{}'::jsonb,
  text_ground_truth text,
  annotation_tool text not null default 'cvat',
  review_status text not null default 'REVIEWED',
  annotation_task_id uuid references public.annotation_tasks(task_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_annotations_region_type_check
    check (region_type in (
      'SERIAL_REGION',
      'CARD_NUMBER_REGION',
      'SLAB_LABEL_REGION',
      'PRODUCT_TEXT_REGION',
      'PLAYER_NAME_REGION',
      'TCG_CODE_REGION',
      'SURFACE_REGION',
      'FRONT_CARD_REGION',
      'BACK_CARD_REGION'
    )),
  constraint crop_annotations_review_status_check
    check (review_status in ('REVIEWED', 'APPROVED', 'CORRECTED', 'REJECTED', 'UNCERTAIN'))
);

create table if not exists public.hard_negative_examples (
  hard_negative_id uuid primary key default gen_random_uuid(),
  workflow_action_id text,
  idempotency_key text,
  query_card_id text,
  correct_candidate_id text,
  wrong_candidate_id text,
  error_type text not null,
  matched_fields jsonb not null default '[]'::jsonb,
  conflicting_fields jsonb not null default '[]'::jsonb,
  similarity_features jsonb not null default '{}'::jsonb,
  source_trace jsonb not null default '{}'::jsonb,
  writer_resolution text,
  training_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists data_loop_integration_runs_integration_status_idx
  on public.data_loop_integration_runs (integration_name, status, started_at desc);

create index if not exists recognition_workflow_events_analysis_run_idx
  on public.recognition_workflow_events (analysis_run_id);

create index if not exists recognition_workflow_events_source_record_idx
  on public.recognition_workflow_events (source_record_id);

create index if not exists recognition_workflow_events_created_at_idx
  on public.recognition_workflow_events (created_at desc);

create index if not exists catalog_entity_clusters_source_record_ids_idx
  on public.catalog_entity_clusters using gin (source_record_ids);

create index if not exists catalog_entity_clusters_review_status_idx
  on public.catalog_entity_clusters (review_status, created_at desc);

create index if not exists data_quality_findings_source_record_idx
  on public.data_quality_findings (source_record_id, created_at desc);

create unique index if not exists data_quality_findings_idempotency_key_idx
  on public.data_quality_findings (idempotency_key)
  where idempotency_key is not null;

create index if not exists data_quality_findings_review_status_idx
  on public.data_quality_findings (review_status, severity, created_at desc);

create index if not exists annotation_tasks_tool_status_idx
  on public.annotation_tasks (tool, status, created_at desc);

create unique index if not exists annotation_tasks_idempotency_key_idx
  on public.annotation_tasks (idempotency_key)
  where idempotency_key is not null;

create index if not exists annotation_tasks_source_record_idx
  on public.annotation_tasks (source_record_id, created_at desc);

create index if not exists reviewed_field_annotations_source_field_idx
  on public.reviewed_field_annotations (source_record_id, field_name, created_at desc);

create index if not exists crop_annotations_source_region_idx
  on public.crop_annotations (source_record_id, region_type, created_at desc);

create index if not exists hard_negative_examples_query_idx
  on public.hard_negative_examples (query_card_id, created_at desc);

create unique index if not exists hard_negative_examples_idempotency_key_idx
  on public.hard_negative_examples (idempotency_key)
  where idempotency_key is not null;

alter table public.data_loop_integration_runs enable row level security;
alter table public.recognition_workflow_events enable row level security;
alter table public.catalog_entity_clusters enable row level security;
alter table public.data_quality_findings enable row level security;
alter table public.annotation_tasks enable row level security;
alter table public.reviewed_field_annotations enable row level security;
alter table public.crop_annotations enable row level security;
alter table public.hard_negative_examples enable row level security;

revoke all on public.data_loop_integration_runs from public, anon, authenticated;
revoke all on public.recognition_workflow_events from public, anon, authenticated;
revoke all on public.catalog_entity_clusters from public, anon, authenticated;
revoke all on public.data_quality_findings from public, anon, authenticated;
revoke all on public.annotation_tasks from public, anon, authenticated;
revoke all on public.reviewed_field_annotations from public, anon, authenticated;
revoke all on public.crop_annotations from public, anon, authenticated;
revoke all on public.hard_negative_examples from public, anon, authenticated;

grant select, insert, update, delete on public.data_loop_integration_runs to service_role;
grant select, insert, update, delete on public.recognition_workflow_events to service_role;
grant select, insert, update, delete on public.catalog_entity_clusters to service_role;
grant select, insert, update, delete on public.data_quality_findings to service_role;
grant select, insert, update, delete on public.annotation_tasks to service_role;
grant select, insert, update, delete on public.reviewed_field_annotations to service_role;
grant select, insert, update, delete on public.crop_annotations to service_role;
grant select, insert, update, delete on public.hard_negative_examples to service_role;

comment on table public.recognition_workflow_events is
  'Append-only recognition workflow event bus for async sidecars. Does not alter resolver/gate/renderer output.';

comment on table public.catalog_entity_clusters is
  'Splink-like catalog entity cluster lookup output. Candidate support only; never final truth or REVIEWED_INTERNAL promotion.';

comment on table public.data_quality_findings is
  'cleanlab-like quality findings and active-learning priority records. Review signal only; no automatic field overwrite.';

comment on table public.annotation_tasks is
  'Label Studio and CVAT task stubs for field-level writer review and crop/region annotation.';

comment on table public.reviewed_field_annotations is
  'Field-level reviewer annotations that can later feed REVIEWED_INTERNAL promotion only through explicit reviewed workflows.';

comment on table public.crop_annotations is
  'Visual region annotations for OCR/crop detector training; not card identity truth.';

comment on table public.hard_negative_examples is
  'Hard negative examples for candidate reranking and failure gallery review. Training eligibility defaults false.';
