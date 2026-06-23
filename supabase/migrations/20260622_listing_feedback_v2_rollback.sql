-- Rollback for 20260622_listing_feedback_v2.sql.
-- Run only after exporting any production rows that must be retained.
-- If the publishing migration was also applied, run
-- 20260622_listing_publish_jobs_rollback.sql first because publish jobs
-- reference listing_reviews and listing_assets.
drop table if exists public.listing_reviews;
drop table if exists public.listing_analysis_runs;
drop table if exists public.listing_assets;
