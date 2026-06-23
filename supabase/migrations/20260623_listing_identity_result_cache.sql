create table if not exists public.listing_identity_resolution_cache (
  cache_key text primary key,
  image_fingerprints jsonb not null default '[]'::jsonb,
  image_count integer not null default 0,
  identity_status text not null check (identity_status in ('CONFIRMED', 'RESOLVED')),
  ambiguity_status text,
  final_title text not null,
  resolved_fields jsonb not null default '{}'::jsonb,
  legacy_fields jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  identity_resolution jsonb,
  field_states jsonb not null default '[]'::jsonb,
  conflict_map jsonb not null default '[]'::jsonb,
  resolution_trace jsonb not null default '[]'::jsonb,
  confidence_report jsonb,
  source_provider text,
  cache_status text not null default 'active' check (cache_status in ('active', 'disabled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listing_identity_resolution_cache_status_expires_idx
  on public.listing_identity_resolution_cache (cache_status, expires_at);

create index if not exists listing_identity_resolution_cache_identity_status_idx
  on public.listing_identity_resolution_cache (identity_status);

alter table public.listing_identity_resolution_cache enable row level security;

-- This table is server-only. It must be reachable by the Supabase Data API
-- when called with the service role key, but not by browser anon/authenticated
-- clients. RLS remains enabled as defense in depth; service_role bypasses RLS.
revoke all on table public.listing_identity_resolution_cache from anon, authenticated;
grant select, insert, update, delete on table public.listing_identity_resolution_cache to service_role;

comment on table public.listing_identity_resolution_cache is
  'Short-lived cache for evidence-grounded card identity results keyed by verified uploaded image content hashes. Not a training table.';

comment on column public.listing_identity_resolution_cache.image_fingerprints is
  'Primary image role/object/hash descriptors used to create the cache key. No signed URLs are stored.';

comment on column public.listing_identity_resolution_cache.evidence_snapshot is
  'Evidence snapshot used to explain the cached identity result. This is cache data, not approved training feedback.';

comment on column public.listing_identity_resolution_cache.resolution_trace is
  'Replayable field-level resolution trace from the original evidence-grounded identity solve.';
