create table if not exists public.listing_assets (
  id text primary key default ('asset_' || gen_random_uuid()::text),
  capture_profile_id text,
  category text,
  front_object_path text,
  back_object_path text,
  additional_image_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_analysis_runs (
  id text primary key default ('analysis_' || gen_random_uuid()::text),
  asset_id text not null references public.listing_assets(id) on delete cascade,
  provider text,
  model_id text,
  prompt_version text,
  schema_version text,
  resolver_version text,
  registry_version text,
  route text,
  capture_quality jsonb not null default '{}'::jsonb,
  generated_evidence jsonb not null default '{}'::jsonb,
  generated_resolved_fields jsonb not null default '{}'::jsonb,
  generated_modules jsonb not null default '{}'::jsonb,
  retrieval_trace jsonb not null default '{}'::jsonb,
  resolution_trace jsonb not null default '[]'::jsonb,
  rendered_title text,
  model_title_suggestion text,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_reviews (
  id text primary key default ('review_' || gen_random_uuid()::text),
  asset_id text not null references public.listing_assets(id) on delete cascade,
  analysis_run_id text not null references public.listing_analysis_runs(id) on delete cascade,
  generated_resolved_fields jsonb not null default '{}'::jsonb,
  corrected_resolved_fields jsonb not null default '{}'::jsonb,
  generated_modules jsonb not null default '{}'::jsonb,
  corrected_modules jsonb not null default '{}'::jsonb,
  field_changes jsonb not null default '[]'::jsonb,
  rendered_title text,
  corrected_title text not null,
  title_override text,
  review_outcome text not null check (
    review_outcome in (
      'ACCEPTED_UNCHANGED',
      'CORRECTED_FIELDS',
      'TITLE_ONLY_OVERRIDE',
      'TARGETED_RESCAN_RECOVERED',
      'NON_STANDARD_MANUAL',
      'REJECTED',
      'TECHNICAL_FAILURE'
    )
  ),
  operator_id text not null,
  review_duration_ms integer,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists listing_analysis_runs_asset_id_idx
  on public.listing_analysis_runs(asset_id);

create index if not exists listing_analysis_runs_provider_route_idx
  on public.listing_analysis_runs(provider, route);

create index if not exists listing_reviews_asset_id_idx
  on public.listing_reviews(asset_id);

create index if not exists listing_reviews_analysis_run_id_idx
  on public.listing_reviews(analysis_run_id);

create index if not exists listing_reviews_review_outcome_idx
  on public.listing_reviews(review_outcome);

create index if not exists listing_reviews_created_at_idx
  on public.listing_reviews(created_at desc);

alter table public.listing_assets enable row level security;
alter table public.listing_analysis_runs enable row level security;
alter table public.listing_reviews enable row level security;
