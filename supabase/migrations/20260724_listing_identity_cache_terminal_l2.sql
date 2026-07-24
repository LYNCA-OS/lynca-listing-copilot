alter table public.listing_identity_resolution_cache
  drop constraint if exists listing_identity_resolution_cache_identity_status_check;

alter table public.listing_identity_resolution_cache
  add constraint listing_identity_resolution_cache_identity_status_check
  check (identity_status in ('CONFIRMED', 'RESOLVED', 'ABSTAIN'));

comment on column public.listing_identity_resolution_cache.identity_status is
  'Original resolver status. Cache replay preserves this status and never promotes ABSTAIN to RESOLVED or CONFIRMED.';
