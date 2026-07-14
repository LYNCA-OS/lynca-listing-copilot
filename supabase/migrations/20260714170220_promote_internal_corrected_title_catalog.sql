-- The original corrected-title catalog is the internal writer-reviewed corpus.
-- Keep title-derived fields auditable: the title is reviewed ground truth, while
-- individual parsed fields still require current-image anchor agreement.
update public.catalog_cards as card
set
  source_status = 'REVIEWED_INTERNAL',
  review_status = 'REVIEWED_INTERNAL',
  metadata = coalesce(card.metadata, '{}'::jsonb) || jsonb_build_object(
    'prompt_safe_internal_writer_title', true,
    'corrected_title_is_ground_truth', true,
    'corrected_title_is_reviewed_title_ground_truth', true,
    'title_ground_truth_scope', 'writer_reviewed_marketplace_title',
    'title_derived_fields_are_ground_truth', false,
    'reviewed_catalog_activated_at', now()
  ),
  updated_at = now()
where card.metadata->>'import_source' = 'corrected_title_catalog_v0'
  and exists (
    select 1
    from public.catalog_sources as source
    where source.id = card.source_id
      and source.source_type = 'INTERNAL_CORRECTED_TITLE'
  );
