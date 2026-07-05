alter table public.listing_analysis_runs
  add column if not exists open_set_readiness jsonb not null default '{}'::jsonb,
  add column if not exists workflow_summary jsonb not null default '{}'::jsonb,
  add column if not exists workflow_sidecars jsonb not null default '{}'::jsonb,
  add column if not exists workflow_action_plan jsonb not null default '{}'::jsonb;

alter table public.listing_reviews
  add column if not exists workflow_summary jsonb not null default '{}'::jsonb;

create index if not exists listing_analysis_runs_open_set_status_idx
  on public.listing_analysis_runs ((open_set_readiness->>'status'));

create index if not exists listing_analysis_runs_workflow_status_idx
  on public.listing_analysis_runs ((workflow_summary->>'status'));

create index if not exists listing_reviews_workflow_status_idx
  on public.listing_reviews ((workflow_summary->>'status'));
