alter table public.listing_identity_resolution_cache
  add column if not exists image_generation_hash text,
  add column if not exists version_fingerprint text,
  add column if not exists result_version jsonb not null default '{}'::jsonb;

create index if not exists listing_identity_resolution_cache_generation_version_idx
  on public.listing_identity_resolution_cache (
    tenant_id,
    image_generation_hash,
    cache_status,
    expires_at desc
  );

comment on column public.listing_identity_resolution_cache.image_generation_hash is
  'Stable hash of verified primary image roles and content hashes. Object paths and signed URLs are excluded.';

comment on column public.listing_identity_resolution_cache.version_fingerprint is
  'SHA-256 of model, prompt, SEM, candidate policy, catalog snapshot, renderer, and cache contract versions.';

comment on column public.listing_identity_resolution_cache.result_version is
  'Version vector required for an exact zero-provider cache hit.';
