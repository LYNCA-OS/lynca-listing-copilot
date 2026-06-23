-- Export approved review rows for scripts/build-held-out-commercial.mjs.
-- Run this in Supabase SQL editor or psql, save the single JSON result to a file,
-- then run:
--   npm run commercial:heldout -- --source exports/commercial-reviews.json --out data/golden-dataset.commercial.json --replace
--
-- The query intentionally excludes rows without explicit final title quality
-- booleans in corrected_resolved_fields. Those booleans are part of the
-- commercial gate and should be reviewed, not defaulted.

with ranked_reviews as (
  select
    a.id as asset_id,
    a.category,
    a.front_object_path,
    a.back_object_path,
    a.additional_image_paths,
    ar.id as analysis_run_id,
    ar.provider,
    ar.model_id,
    ar.prompt_version,
    ar.schema_version,
    ar.resolver_version,
    ar.registry_version,
    ar.route,
    ar.capture_quality,
    ar.generated_evidence,
    ar.generated_resolved_fields as analysis_generated_resolved_fields,
    ar.generated_modules,
    ar.retrieval_trace,
    ar.resolution_trace,
    ar.rendered_title,
    ar.model_title_suggestion,
    ar.usage,
    r.id as review_id,
    r.generated_resolved_fields as review_generated_resolved_fields,
    r.corrected_resolved_fields,
    r.corrected_modules,
    r.field_changes,
    r.corrected_title,
    r.title_override,
    r.review_outcome,
    r.operator_id,
    r.review_duration_ms,
    r.approved_at,
    r.created_at as review_created_at,
    row_number() over (
      partition by r.asset_id
      order by r.approved_at desc nulls last, r.created_at desc, r.id desc
    ) as asset_review_rank
  from public.listing_reviews r
  join public.listing_assets a on a.id = r.asset_id
  join public.listing_analysis_runs ar on ar.id = r.analysis_run_id
  where r.approved_at is not null
    and r.review_outcome in (
      'ACCEPTED_UNCHANGED',
      'CORRECTED_FIELDS',
      'TITLE_ONLY_OVERRIDE',
      'TARGETED_RESCAN_RECOVERED',
      'NON_STANDARD_MANUAL'
    )
    and coalesce(a.front_object_path, '') <> ''
    and coalesce(jsonb_object_length(r.generated_resolved_fields), 0) > 0
    and coalesce(jsonb_object_length(r.corrected_resolved_fields), 0) > 0
    and jsonb_typeof(r.corrected_resolved_fields -> 'final_title_required_fields') = 'boolean'
    and jsonb_typeof(r.corrected_resolved_fields -> 'final_title_unsubstantiated_fields') = 'boolean'
),
heldout_candidates as (
  select *
  from ranked_reviews
  where asset_review_rank = 1
  order by md5(review_id)
  limit 500
)
select jsonb_pretty(jsonb_build_object(
  'rows',
  coalesce(jsonb_agg(jsonb_build_object(
    'asset',
    jsonb_build_object(
      'id', asset_id,
      'category', category,
      'front_object_path', front_object_path,
      'back_object_path', back_object_path,
      'additional_image_paths', additional_image_paths
    ),
    'analysis',
    jsonb_build_object(
      'id', analysis_run_id,
      'asset_id', asset_id,
      'provider', provider,
      'model_id', model_id,
      'prompt_version', prompt_version,
      'schema_version', schema_version,
      'resolver_version', resolver_version,
      'registry_version', registry_version,
      'route', route,
      'capture_quality', capture_quality,
      'generated_evidence', generated_evidence,
      'generated_resolved_fields', analysis_generated_resolved_fields,
      'generated_modules', generated_modules,
      'retrieval_trace', retrieval_trace,
      'resolution_trace', resolution_trace,
      'rendered_title', rendered_title,
      'model_title_suggestion', model_title_suggestion,
      'usage', usage
    ),
    'review',
    jsonb_build_object(
      'id', review_id,
      'asset_id', asset_id,
      'analysis_run_id', analysis_run_id,
      'generated_resolved_fields', review_generated_resolved_fields,
      'corrected_resolved_fields', corrected_resolved_fields,
      'corrected_modules', corrected_modules,
      'field_changes', field_changes,
      'corrected_title', corrected_title,
      'title_override', title_override,
      'review_outcome', review_outcome,
      'operator_id', operator_id,
      'review_duration_ms', review_duration_ms,
      'approved_at', approved_at,
      'created_at', review_created_at,
      'commercial_quality',
      jsonb_build_object(
        'final_title_required_fields', corrected_resolved_fields -> 'final_title_required_fields',
        'final_title_unsubstantiated_fields', corrected_resolved_fields -> 'final_title_unsubstantiated_fields'
      )
    )
  )), '[]'::jsonb)
)) as commercial_heldout_source
from heldout_candidates;
