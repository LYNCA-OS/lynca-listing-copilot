delete from public.listing_identity_resolution_cache
where identity_status = 'ABSTAIN';

alter table public.listing_identity_resolution_cache
  drop constraint if exists listing_identity_resolution_cache_identity_status_check;

alter table public.listing_identity_resolution_cache
  add constraint listing_identity_resolution_cache_identity_status_check
  check (identity_status in ('CONFIRMED', 'RESOLVED'));
