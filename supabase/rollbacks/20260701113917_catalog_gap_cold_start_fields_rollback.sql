drop index if exists public.catalog_gap_queue_promoted_identity_idx;
drop index if exists public.catalog_gap_queue_cold_start_status_idx;

drop trigger if exists catalog_gap_queue_sync_cold_start_promotion_fields
  on public.catalog_gap_queue;

drop function if exists public.sync_catalog_gap_cold_start_promotion_fields();

alter table public.catalog_gap_queue
  drop column if exists training_eligible,
  drop column if exists promotion_status,
  drop column if exists promoted_catalog_identity_id,
  drop column if exists writer_confirmed_fields,
  drop column if exists writer_final_title,
  drop column if exists writer_action_required,
  drop column if exists cold_start_status,
  drop column if exists reason,
  drop column if exists marketplace_hints,
  drop column if exists external_retrieval_hints,
  drop column if exists high_risk_fields,
  drop column if exists unresolved_fields,
  drop column if exists observed_fields,
  drop column if exists ai_draft_title,
  drop column if exists query_image_ids,
  drop column if exists source_batch;
