alter table public.listing_image_verifications
  add column if not exists content_sha256 text,
  add column if not exists content_hash_verified boolean not null default false;

alter table public.listing_assets
  add column if not exists asset_fingerprint text,
  add column if not exists front_content_sha256 text,
  add column if not exists back_content_sha256 text;

alter table public.listing_reviews
  add column if not exists asset_fingerprint text,
  add column if not exists stable_training_sample boolean not null default false,
  add column if not exists training_status text not null default 'not_eligible',
  add column if not exists reusable_approved_title boolean not null default false;

alter table public.listing_reviews
  drop constraint if exists listing_reviews_training_status_check;

alter table public.listing_reviews
  add constraint listing_reviews_training_status_check
  check (
    training_status in (
      'approved_clean',
      'reviewed_correction',
      'manual_non_standard',
      'not_eligible'
    )
  );

create index if not exists listing_image_verifications_content_sha256_idx
  on public.listing_image_verifications(content_sha256)
  where content_sha256 is not null;

create index if not exists listing_assets_asset_fingerprint_idx
  on public.listing_assets(asset_fingerprint)
  where asset_fingerprint is not null;

create index if not exists listing_reviews_asset_fingerprint_idx
  on public.listing_reviews(asset_fingerprint)
  where asset_fingerprint is not null;

create index if not exists listing_reviews_stable_training_sample_idx
  on public.listing_reviews(stable_training_sample, approved_at desc)
  where stable_training_sample is true;
