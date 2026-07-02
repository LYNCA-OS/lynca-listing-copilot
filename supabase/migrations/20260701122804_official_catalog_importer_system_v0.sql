alter table public.catalog_sources
  add column if not exists raw_checksum text,
  add column if not exists source_trust text,
  add column if not exists source_scope text,
  add column if not exists parser_version text;

alter table public.catalog_import_staging
  add column if not exists raw_text text,
  add column if not exists parsed_fields jsonb not null default '{}'::jsonb,
  add column if not exists field_status_by_name jsonb not null default '{}'::jsonb,
  add column if not exists review_required_fields text[] not null default '{}'::text[],
  add column if not exists source_type text,
  add column if not exists source_trust text,
  add column if not exists raw_checksum text,
  add column if not exists source_url text,
  add column if not exists source_title text;

alter table public.catalog_sources drop constraint if exists catalog_sources_source_type_check;
alter table public.catalog_sources add constraint catalog_sources_source_type_check
  check (source_type in (
    'INTERNAL_CORRECTED_TITLE',
    'TOPPS_OFFICIAL_CHECKLIST',
    'PANINI_OFFICIAL_CHECKLIST',
    'UPPER_DECK_OFFICIAL_CHECKLIST',
    'LEAF_OFFICIAL_CHECKLIST',
    'LEAF_OFFICIAL_RELEASE',
    'FUTERA_OFFICIAL_CHECKLIST',
    'OFFICIAL_RELEASE_PAGE',
    'OFFICIAL_DIGITAL_LIBRARY',
    'LICENSED_EXTERNAL_DIRECTORY',
    'MARKETPLACE_REFERENCE'
  ));

alter table public.catalog_sources drop constraint if exists catalog_sources_source_status_check;
alter table public.catalog_sources add constraint catalog_sources_source_status_check
  check (source_status in (
    'VERIFIED_CANONICAL_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_SOURCE_DISCOVERED',
    'RAW_IMPORTED',
    'RAW_TEXT_EXTRACTED',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_CHECKLIST_CONFIRMED',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEWED_INTERNAL',
    'REVIEW_REQUIRED'
  ));

alter table public.catalog_import_staging drop constraint if exists catalog_import_staging_import_status_check;
alter table public.catalog_import_staging add constraint catalog_import_staging_import_status_check
  check (import_status in (
    'OFFICIAL_SOURCE_DISCOVERED',
    'RAW_IMPORTED',
    'RAW_TEXT_EXTRACTED',
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_CHECKLIST_CONFIRMED',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'READY_CANDIDATE',
    'REVIEWED_INTERNAL',
    'REJECTED'
  ));

alter table public.catalog_products drop constraint if exists catalog_products_source_status_check;
alter table public.catalog_products add constraint catalog_products_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_sets drop constraint if exists catalog_sets_source_status_check;
alter table public.catalog_sets add constraint catalog_sets_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_cards drop constraint if exists catalog_cards_source_status_check;
alter table public.catalog_cards add constraint catalog_cards_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_parallels drop constraint if exists catalog_parallels_source_status_check;
alter table public.catalog_parallels add constraint catalog_parallels_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

create index if not exists catalog_sources_raw_checksum_idx
  on public.catalog_sources(raw_checksum)
  where raw_checksum is not null;

create index if not exists catalog_import_staging_source_type_status_idx
  on public.catalog_import_staging(source_type, import_status, created_at desc);

create index if not exists catalog_import_staging_review_fields_gin_idx
  on public.catalog_import_staging using gin (review_required_fields);

create or replace function public.search_catalog_candidates(
  search_text text default '',
  exact_checklist_code text default '',
  exact_card_number text default '',
  exact_subject text default '',
  exact_year text default '',
  exact_product text default '',
  exact_serial_denominator text default '',
  match_count integer default 30
)
returns table (
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
  expected_serial_denominator text
)
language sql
stable
as $$
  with params as (
    select
      nullif(trim(search_text), '') as q,
      upper(nullif(trim(exact_checklist_code), '')) as checklist,
      upper(nullif(trim(exact_card_number), '')) as card_no,
      lower(nullif(trim(exact_subject), '')) as subject,
      lower(nullif(trim(exact_year), '')) as yr,
      lower(nullif(trim(exact_product), '')) as product_name,
      nullif(regexp_replace(coalesce(exact_serial_denominator, ''), '[^0-9]', '', 'g'), '') as denom,
      greatest(1, least(coalesce(match_count, 30), 50)) as limit_n
  ),
  scored as (
    select
      c.*,
      s.source_type,
      (
        case when p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist then 0.42 else 0 end +
        case when p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no then 0.32 else 0 end +
        case when p.subject is not null and exists (
          select 1 from unnest(c.players) player where lower(player) like '%' || p.subject || '%' or p.subject like '%' || lower(player) || '%'
        ) then 0.22 else 0 end +
        case when p.yr is not null and lower(coalesce(c.season_year, '')) = p.yr then 0.12 else 0 end +
        case when p.product_name is not null and (
          lower(coalesce(c.product, '')) like '%' || p.product_name || '%'
          or p.product_name like '%' || lower(coalesce(c.product, '')) || '%'
          or lower(coalesce(c.canonical_title, '')) like '%' || p.product_name || '%'
        ) then 0.18 else 0 end +
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 0.10 else 0 end +
        case when c.review_status = 'REVIEWED_INTERNAL' then 0.08 else 0 end +
        case when coalesce(s.source_type, '') in (
          'TOPPS_OFFICIAL_CHECKLIST',
          'PANINI_OFFICIAL_CHECKLIST',
          'UPPER_DECK_OFFICIAL_CHECKLIST',
          'FUTERA_OFFICIAL_CHECKLIST'
        ) then 0.04 else 0 end +
        case when coalesce(s.source_type, '') in (
          'LEAF_OFFICIAL_RELEASE',
          'OFFICIAL_RELEASE_PAGE',
          'OFFICIAL_DIGITAL_LIBRARY'
        ) then 0.02 else 0 end +
        case when p.q is not null and coalesce(c.canonical_title, '') ilike '%' || p.q || '%' then 0.05 else 0 end
      )::numeric as score,
      array_remove(array[
        case when p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist then 'checklist_code' end,
        case when p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no then 'collector_number' end,
        case when p.subject is not null and exists (
          select 1 from unnest(c.players) player where lower(player) like '%' || p.subject || '%' or p.subject like '%' || lower(player) || '%'
        ) then 'players' end,
        case when p.yr is not null and lower(coalesce(c.season_year, '')) = p.yr then 'year' end,
        case when p.product_name is not null and (
          lower(coalesce(c.product, '')) like '%' || p.product_name || '%'
          or p.product_name like '%' || lower(coalesce(c.product, '')) || '%'
          or lower(coalesce(c.canonical_title, '')) like '%' || p.product_name || '%'
        ) then 'product' end,
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 'serial_denominator' end,
        case when p.q is not null and coalesce(c.canonical_title, '') ilike '%' || p.q || '%' then 'canonical_title' end
      ], null)::text[] as support
    from public.catalog_cards c
    left join public.catalog_sources s on s.id = c.source_id
    cross join params p
    where c.review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')
      and c.source_status in (
        'AUTO_PARSED_FROM_VERIFIED_TITLE',
        'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
        'TOPPS_OFFICIAL_RAW',
        'OFFICIAL_CHECKLIST_RAW',
        'OFFICIAL_CHECKLIST_CANDIDATE',
        'OFFICIAL_RELEASE_SUPPORT',
        'OFFICIAL_RELEASE_METADATA',
        'REVIEWED_INTERNAL'
      )
      and (
        p.checklist is not null
        or p.card_no is not null
        or p.subject is not null
        or p.yr is not null
        or p.product_name is not null
        or p.denom is not null
        or (p.q is not null and coalesce(c.canonical_title, '') ilike '%' || p.q || '%')
      )
  )
  select
    scored.id as identity_id,
    scored.canonical_title,
    concat_ws(':', scored.sport, scored.season_year, scored.product, scored.set_or_insert, array_to_string(scored.players, '/'), scored.card_number, scored.checklist_code, scored.serial_denominator) as identity_key,
    jsonb_strip_nulls(jsonb_build_object(
      'category', scored.sport,
      'year', scored.season_year,
      'manufacturer', scored.manufacturer,
      'brand', scored.brand,
      'product', scored.product,
      'set', scored.set_or_insert,
      'insert', scored.set_or_insert,
      'subset', scored.subset,
      'players', scored.players,
      'team', scored.team,
      'collector_number', scored.card_number,
      'checklist_code', scored.checklist_code,
      'official_card_type', scored.official_card_type,
      'observable_components', scored.observable_components,
      'surface_color', scored.surface_color,
      'serial_denominator', scored.serial_denominator
    )) as fields,
    case
      when scored.review_status = 'REVIEWED_INTERNAL' then 'reviewed'
      when scored.source_status = 'AUTO_PARSED_FROM_VERIFIED_TITLE' then 'candidate'
      when scored.source_status in (
        'TOPPS_OFFICIAL_RAW',
        'OFFICIAL_CHECKLIST_RAW',
        'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
        'OFFICIAL_CHECKLIST_CANDIDATE',
        'OFFICIAL_RELEASE_SUPPORT',
        'OFFICIAL_RELEASE_METADATA'
      ) then 'registry'
      else 'review_required'
    end as retrieval_status,
    scored.sport as category,
    scored.source_type,
    scored.source_status,
    scored.support as supporting_fields,
    scored.score as raw_score,
    least(1, scored.score) as normalized_score,
    scored.serial_denominator as expected_serial_denominator
  from scored, params
  where scored.score > 0
  order by scored.score desc, scored.review_status desc, scored.created_at desc
  limit (select limit_n from params);
$$;

comment on column public.catalog_sources.raw_checksum is
  'SHA-256 checksum of official source raw text or fetched file; used for duplicate detection and import auditing.';

comment on column public.catalog_import_staging.raw_text is
  'Raw official-source row or excerpt retained for review. Official rows are staging only and never REVIEWED_INTERNAL without confirmation.';

comment on column public.catalog_import_staging.parsed_fields is
  'Normalized parsed identity fields from an official source. Physical instance fields such as serial numerator, grade, and cert must remain absent.';

comment on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer)
  is 'Catalog-first identity candidate lookup. Official checklist/release source types are identity constraints only; current physical serial numerator, grade, and cert must come from current image evidence.';

revoke all on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer) from anon, authenticated;
grant execute on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer) to service_role;

revoke all on public.catalog_sources from anon, authenticated;
revoke all on public.catalog_import_staging from anon, authenticated;
revoke all on public.catalog_products from anon, authenticated;
revoke all on public.catalog_sets from anon, authenticated;
revoke all on public.catalog_cards from anon, authenticated;
revoke all on public.catalog_parallels from anon, authenticated;
grant all on public.catalog_sources to service_role;
grant all on public.catalog_import_staging to service_role;
grant all on public.catalog_products to service_role;
grant all on public.catalog_sets to service_role;
grant all on public.catalog_cards to service_role;
grant all on public.catalog_parallels to service_role;
