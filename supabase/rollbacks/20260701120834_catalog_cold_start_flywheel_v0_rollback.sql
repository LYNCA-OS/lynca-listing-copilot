drop table if exists public.catalog_flywheel_hard_negatives;

drop index if exists public.catalog_gap_queue_external_candidates_gin_idx;
drop index if exists public.catalog_gap_queue_selected_candidate_idx;

alter table public.catalog_gap_queue
  drop constraint if exists catalog_gap_queue_cold_start_status_check;

alter table public.catalog_gap_queue
  add constraint catalog_gap_queue_cold_start_status_check
  check (
    cold_start_status is null
    or cold_start_status in (
      'SAFE_DRAFT_READY',
      'WRITER_REVIEW_REQUIRED',
      'DEEP_RESEARCH_REQUIRED',
      'CATALOG_GAP_REQUIRED',
      'MARKETPLACE_HINTS_ONLY',
      'NO_APPROVED_CATALOG_MATCH'
    )
  );

alter table public.catalog_gap_queue
  drop column if exists review_time_ms,
  drop column if exists field_diff,
  drop column if exists rejected_candidate_ids,
  drop column if exists selected_candidate_id,
  drop column if exists external_candidates,
  drop column if exists official_candidates,
  drop column if exists internal_candidates,
  drop column if exists image_ids;
