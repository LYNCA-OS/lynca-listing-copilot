-- Rollback for 20260622_listing_image_verifications.sql.
-- Run only after exporting any verification records that must be retained.
drop table if exists public.listing_image_verifications;
