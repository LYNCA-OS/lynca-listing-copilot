drop index if exists public.listing_identity_resolution_cache_generation_version_idx;

alter table public.listing_identity_resolution_cache
  drop column if exists result_version,
  drop column if exists version_fingerprint,
  drop column if exists image_generation_hash;
