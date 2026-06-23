drop index if exists public.listing_reviews_stable_training_sample_idx;
drop index if exists public.listing_reviews_asset_fingerprint_idx;
drop index if exists public.listing_assets_asset_fingerprint_idx;
drop index if exists public.listing_image_verifications_content_sha256_idx;

alter table public.listing_reviews
  drop constraint if exists listing_reviews_training_status_check;

alter table public.listing_reviews
  drop column if exists reusable_approved_title,
  drop column if exists training_status,
  drop column if exists stable_training_sample,
  drop column if exists asset_fingerprint;

alter table public.listing_assets
  drop column if exists back_content_sha256,
  drop column if exists front_content_sha256,
  drop column if exists asset_fingerprint;

alter table public.listing_image_verifications
  drop column if exists content_hash_verified,
  drop column if exists content_sha256;
