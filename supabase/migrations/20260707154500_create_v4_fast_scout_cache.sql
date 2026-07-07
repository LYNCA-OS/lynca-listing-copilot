create table if not exists public.v4_fast_scout_cache (
  id text primary key,
  scout_id text not null,
  asset_id text,
  image_hash text,
  image_role text,
  model_id text,
  model_revision text,
  scout_fields jsonb not null default '{}'::jsonb,
  review_fields jsonb not null default '[]'::jsonb,
  confidence numeric,
  route_hint jsonb not null default '{}'::jsonb,
  status text not null default 'READY',
  error_message text,
  result_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists v4_fast_scout_cache_asset_idx
  on public.v4_fast_scout_cache(asset_id);

create index if not exists v4_fast_scout_cache_image_hash_idx
  on public.v4_fast_scout_cache(image_hash);

create index if not exists v4_fast_scout_cache_status_expires_idx
  on public.v4_fast_scout_cache(status, expires_at);

alter table public.v4_fast_scout_cache enable row level security;

grant select, insert, update, delete on public.v4_fast_scout_cache to service_role;
