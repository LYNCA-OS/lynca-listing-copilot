alter table if exists public.listing_analysis_runs
  add column if not exists field_graph jsonb not null default '{}'::jsonb;

alter table if exists public.listing_reviews
  add column if not exists field_graph jsonb not null default '{}'::jsonb,
  add column if not exists feedback_training_event jsonb not null default '{}'::jsonb,
  add column if not exists candidate_reranker_dataset jsonb not null default '[]'::jsonb,
  add column if not exists field_level_ground_truth jsonb not null default '[]'::jsonb,
  add column if not exists hard_negative_samples jsonb not null default '[]'::jsonb;

create index if not exists listing_analysis_runs_field_graph_gin_idx
  on public.listing_analysis_runs
  using gin (field_graph);

create index if not exists listing_reviews_feedback_training_event_gin_idx
  on public.listing_reviews
  using gin (feedback_training_event);

create index if not exists listing_reviews_candidate_reranker_dataset_gin_idx
  on public.listing_reviews
  using gin (candidate_reranker_dataset);

create index if not exists listing_reviews_field_level_ground_truth_gin_idx
  on public.listing_reviews
  using gin (field_level_ground_truth);

create index if not exists listing_reviews_hard_negative_samples_gin_idx
  on public.listing_reviews
  using gin (hard_negative_samples);
