drop index if exists public.listing_reviews_workflow_status_idx;
drop index if exists public.listing_analysis_runs_workflow_status_idx;
drop index if exists public.listing_analysis_runs_open_set_status_idx;

alter table public.listing_reviews
  drop column if exists workflow_summary;

alter table public.listing_analysis_runs
  drop column if exists workflow_action_plan,
  drop column if exists workflow_sidecars,
  drop column if exists workflow_summary,
  drop column if exists open_set_readiness;
