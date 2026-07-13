-- The writer path calls search_catalog_candidates, while the previous search
-- blob migration only optimized search_card_identities_hybrid. As a result,
-- the production RPC still scanned every catalog row and expanded players[]
-- for each query (6.79s on a 16.5k-row catalog). Build a small, index-backed
-- anchor pool first, then score only those rows. This preserves the existing
-- response contract and fail-closed subject/year filters.

create or replace function public.search_catalog_candidates(
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
  expected_serial_denominator text
)
language sql
stable
set search_path = pg_catalog, public, extensions
as $function$
  with params as (
    select
      nullif(trim(regexp_replace(lower(coalesce(search_text, '')), '[^[:alnum:]]+', ' ', 'g')), '') as q,
      nullif(upper(trim(exact_checklist_code)), '') as checklist,
      nullif(upper(regexp_replace(trim(exact_card_number), '^#\s*', '')), '') as card_no,
      nullif(trim(regexp_replace(lower(coalesce(exact_subject, '')), '[^[:alnum:]]+', ' ', 'g')), '') as subject,
      nullif(trim(exact_year), '') as yr_raw,
      nullif(trim(regexp_replace(lower(coalesce(exact_product, '')), '[^[:alnum:]]+', ' ', 'g')), '') as product_name,
      nullif(regexp_replace(coalesce(exact_serial_denominator, ''), '[^0-9]', '', 'g'), '') as denom,
      greatest(1, least(coalesce(match_count, 30), 50)) as limit_n
  ),
  candidate_ids as materialized (
    -- Natural-key lanes use their dedicated btree indexes.
    select c.id
    from public.catalog_cards c cross join params p
    where p.checklist is not null
      and upper(c.checklist_code) = p.checklist

    union

    select c.id
    from public.catalog_cards c cross join params p
    where p.card_no is not null
      and upper(c.card_number) = p.card_no

    union

    -- Subject is the primary open-text identity anchor. The query is
    -- punctuation-normalized so "Jr." matches stored "Jr" values.
    select c.id
    from public.catalog_cards c cross join params p
    where p.subject is not null
      and (
        c.search_blob like '%' || p.subject || '%'
        or c.search_blob % p.subject
      )

    union

    -- Product/text are fallback lanes only when stronger natural keys are
    -- absent. This prevents generic values such as "Panini" from flooding
    -- the candidate pool on normal card requests.
    select c.id
    from public.catalog_cards c cross join params p
    where p.checklist is null
      and p.card_no is null
      and p.subject is null
      and p.product_name is not null
      and (
        c.search_blob like '%' || p.product_name || '%'
        or c.search_blob % p.product_name
      )

    union

    select c.id
    from public.catalog_cards c cross join params p
    where p.checklist is null
      and p.card_no is null
      and p.subject is null
      and p.product_name is null
      and p.q is not null
      and (
        c.search_blob like '%' || p.q || '%'
        or c.search_blob % p.q
      )
  ),
  eligible as (
    select
      c.*,
      s.source_type,
      p.*,
      (p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist) as checklist_match,
      (p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no) as card_number_match,
      (p.subject is not null and (
        c.search_blob like '%' || p.subject || '%'
        or c.search_blob % p.subject
      )) as subject_match,
      (p.yr_raw is not null and public.catalog_years_compatible(p.yr_raw, c.season_year)) as year_match,
      (p.product_name is not null and (
        c.search_blob like '%' || p.product_name || '%'
        or c.search_blob % p.product_name
      )) as product_match,
      (p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom) as denominator_match,
      (p.q is not null and (
        c.search_blob like '%' || p.q || '%'
        or c.search_blob % p.q
      )) as text_match
    from candidate_ids ids
    join public.catalog_cards c on c.id = ids.id
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
        'OFFICIAL_PARSE_REVIEW_REQUIRED',
        'EXTERNAL_DIRECTORY_CANDIDATE',
        'COMMUNITY_API_CANDIDATE',
        'REVIEW_REQUIRED',
        'REVIEWED_INTERNAL'
      )
      and (
        p.subject is null
        or c.search_blob like '%' || p.subject || '%'
        or c.search_blob % p.subject
      )
      and (
        p.yr_raw is null
        or public.catalog_expand_years(c.season_year) = '{}'::int[]
        or public.catalog_years_compatible(p.yr_raw, c.season_year)
      )
  ),
  scored as (
    select
      e.*,
      (
        case when e.checklist_match then 0.42 else 0 end
        + case when e.card_number_match then 0.32 else 0 end
        + case when e.subject_match then 0.22 else 0 end
        + case when e.year_match then 0.12 else 0 end
        + case when e.product_match then 0.18 else 0 end
        + case when e.denominator_match then 0.10 else 0 end
        + case when e.text_match then 0.08 else 0 end
        + case when e.review_status = 'REVIEWED_INTERNAL' then 0.08 else 0 end
        + case when e.source_type in (
          'TOPPS_OFFICIAL_CHECKLIST',
          'PANINI_OFFICIAL_CHECKLIST',
          'UPPER_DECK_OFFICIAL_CHECKLIST',
          'POKEMON_OFFICIAL_CARD_SEARCH',
          'KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE',
          'WOTC_GATHERER_OFFICIAL_DATABASE'
        ) then 0.04 else 0 end
      )::numeric as score,
      array_remove(array[
        case when e.checklist_match then 'checklist_code' end,
        case when e.card_number_match then 'collector_number' end,
        case when e.subject_match then 'subject' end,
        case when e.year_match then 'year' end,
        case when e.product_match then 'product' end,
        case when e.denominator_match then 'serial_denominator' end,
        case when e.text_match then 'canonical_title' end
      ], null)::text[] as support
    from eligible e
  )
  select
    scored.id as identity_id,
    scored.canonical_title,
    concat_ws(':', scored.sport, scored.season_year, scored.product, array_to_string(scored.players, '/'), scored.card_number, scored.checklist_code) as identity_key,
    jsonb_strip_nulls(jsonb_build_object(
      'category', scored.sport,
      'year', scored.season_year,
      'manufacturer', scored.manufacturer,
      'brand', scored.brand,
      'product', scored.product,
      'set', scored.set_or_insert,
      'subset', scored.subset,
      'players', scored.players,
      'category_candidates', scored.metadata -> 'category_candidates',
      'secondary_categories', scored.metadata -> 'secondary_categories',
      'team', scored.team,
      'collector_number', scored.card_number,
      'checklist_code', scored.checklist_code,
      'official_card_type', scored.official_card_type,
      'observable_components', scored.observable_components,
      'surface_color', scored.surface_color
    )) as fields,
    case
      when scored.review_status = 'REVIEWED_INTERNAL' then 'reviewed'
      when scored.source_status = 'AUTO_PARSED_FROM_VERIFIED_TITLE' then 'candidate'
      when scored.source_status in ('AUTO_PARSED_FROM_OFFICIAL_CHECKLIST', 'OFFICIAL_CHECKLIST_CANDIDATE', 'TOPPS_OFFICIAL_RAW', 'OFFICIAL_CHECKLIST_RAW') then 'registry'
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
$function$;

comment on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer)
is 'Anchor-first, index-backed candidate generation over catalog_cards. External rows remain candidate evidence and never become final titles directly.';

revoke all on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer) to service_role;
