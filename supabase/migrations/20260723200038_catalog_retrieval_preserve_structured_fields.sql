-- Preserve bounded, source-backed fields that the official catalog importer
-- stores under catalog_cards.metadata.catalog_fields. The base search function
-- owns ranking; this source-aware wrapper only restores field fidelity.
create or replace function public.search_catalog_candidates_with_source(
  search_text text default ''::text,
  exact_checklist_code text default ''::text,
  exact_card_number text default ''::text,
  exact_subject text default ''::text,
  exact_year text default ''::text,
  exact_product text default ''::text,
  exact_serial_denominator text default ''::text,
  match_count integer default 30
)
returns table(
  identity_id uuid,
  canonical_title text,
  identity_key text,
  fields jsonb,
  retrieval_status text,
  category text,
  source_type text,
  source_status text,
  supporting_fields text[],
  raw_score numeric,
  normalized_score numeric,
  expected_serial_denominator text,
  source_feedback_id text
)
language sql
stable
set search_path = pg_catalog, public, extensions
as $function$
  select
    candidate.identity_id,
    candidate.canonical_title,
    candidate.identity_key,
    candidate.fields || jsonb_strip_nulls(jsonb_build_object(
      'game', nullif(card.metadata #>> '{catalog_fields,game}', ''),
      'language', nullif(card.metadata #>> '{catalog_fields,language}', ''),
      'subject', nullif(card.metadata #>> '{catalog_fields,subject}', ''),
      'card_name', nullif(card.metadata #>> '{catalog_fields,card_name}', ''),
      'rarity', nullif(card.metadata #>> '{catalog_fields,rarity}', ''),
      'parallel_name', nullif(card.metadata #>> '{catalog_fields,parallel_name}', ''),
      'parallel_exact', nullif(card.metadata #>> '{catalog_fields,parallel_exact}', ''),
      'image_url', nullif(card.metadata #>> '{catalog_fields,image_url}', ''),
      'image_urls', card.metadata #> '{catalog_fields,image_urls}',
      'external_id', nullif(card.metadata #>> '{catalog_fields,external_id}', '')
    )),
    candidate.retrieval_status,
    candidate.category,
    candidate.source_type,
    candidate.source_status,
    candidate.supporting_fields,
    candidate.raw_score,
    candidate.normalized_score,
    candidate.expected_serial_denominator,
    nullif(source.source_metadata ->> 'source_feedback_id', '') as source_feedback_id
  from public.search_catalog_candidates(
    search_text,
    exact_checklist_code,
    exact_card_number,
    exact_subject,
    exact_year,
    exact_product,
    exact_serial_denominator,
    match_count
  ) candidate
  left join public.catalog_cards card on card.id = candidate.identity_id
  left join public.catalog_sources source on source.id = card.source_id;
$function$;

comment on function public.search_catalog_candidates_with_source(text, text, text, text, text, text, text, integer)
is 'Catalog candidate search with source provenance and bounded structured catalog fields. Service-role only.';

revoke all on function public.search_catalog_candidates_with_source(text, text, text, text, text, text, text, integer)
from public, anon, authenticated;
grant execute on function public.search_catalog_candidates_with_source(text, text, text, text, text, text, text, integer)
to service_role;
