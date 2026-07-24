drop index if exists public.listing_identity_resolution_cache_generation_version_idx;

alter table public.listing_identity_resolution_cache
  drop column if exists tenant_id cascade;

create index if not exists listing_identity_resolution_cache_global_generation_version_idx
  on public.listing_identity_resolution_cache (
    image_generation_hash,
    cache_status,
    expires_at desc
  );

comment on table public.listing_identity_resolution_cache is
  'Server-only anonymous cache for globally reusable card facts and titles keyed by verified image content and the complete algorithm version vector. Not a training table.';

comment on column public.listing_identity_resolution_cache.image_fingerprints is
  'Verified primary image roles and SHA-256 values only. Tenant ids, object paths, signed URLs, asset ids, and user data are forbidden.';
