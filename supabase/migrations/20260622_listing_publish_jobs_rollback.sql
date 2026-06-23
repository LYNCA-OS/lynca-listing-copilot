-- Rollback for 20260622_listing_publish_jobs.sql.
-- Run before 20260622_listing_feedback_v2_rollback.sql because this table
-- references listing_assets and listing_reviews.
drop table if exists public.listing_publish_jobs;
