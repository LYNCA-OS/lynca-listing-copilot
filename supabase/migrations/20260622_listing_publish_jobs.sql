create table if not exists public.listing_publish_jobs (
  id text primary key default ('publish_' || gen_random_uuid()::text),
  asset_id text not null references public.listing_assets(id) on delete cascade,
  review_id text not null references public.listing_reviews(id) on delete cascade,
  destination text not null,
  idempotency_key text not null unique,
  status text not null check (
    status in (
      'PENDING',
      'PUBLISHED',
      'FAILED',
      'SKIPPED_DUPLICATE'
    )
  ),
  request_snapshot jsonb not null default '{}'::jsonb,
  response_snapshot jsonb,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listing_publish_jobs_asset_id_idx
  on public.listing_publish_jobs(asset_id);

create index if not exists listing_publish_jobs_review_id_idx
  on public.listing_publish_jobs(review_id);

create index if not exists listing_publish_jobs_destination_status_idx
  on public.listing_publish_jobs(destination, status);

alter table public.listing_publish_jobs enable row level security;
