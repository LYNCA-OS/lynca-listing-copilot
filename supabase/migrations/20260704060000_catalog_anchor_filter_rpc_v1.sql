-- Catalog retrieval: anchor-FILTER semantics.
--
-- eBay C10 root cause: subject/year were score bonuses (+0.22/+0.12) instead
-- of filters, so "same product, different player" rows (year+product = 0.30)
-- outscored or crowded out same-player rows. The anchor plan declares subject
-- and year as role=identity_filter; this migration makes the RPC honor that:
-- rows contradicting a provided subject or year anchor are excluded, not
-- merely outscored. Year matching is season-compatible (2018 ~ 2018-19).

create or replace function public.catalog_expand_years(value text)
returns int[]
language sql
immutable
as $$
  select coalesce(array(
    select distinct y from (
      select (m[1])::int as y
      from regexp_matches(coalesce(value, ''), '(19\d{2}|20\d{2})', 'g') m
      union
      select (substring(coalesce(value, '') from '((?:19|20)\d{2})'))::int + 1
      where coalesce(value, '') ~ '(?:19|20)\d{2}\s*[-/]\s*\d{2}'
    ) t
    where y is not null
  ), '{}'::int[]);
$$;


-- Season-strict year compatibility: two full season formats (YYYY-YY) must
-- share the same starting year (2024-25 vs 2025-26 are different products);
-- single-year vs season uses expanded-year overlap (2018 matches 2018-19).
create or replace function public.catalog_years_compatible(query_year text, candidate_year text)
returns boolean
language sql
immutable
as $$
  select case
    when coalesce(query_year, '') ~ '(?:19|20)\d{2}\s*[-/]\s*\d{2}'
     and coalesce(candidate_year, '') ~ '(?:19|20)\d{2}\s*[-/]\s*\d{2}'
      then substring(query_year from '((?:19|20)\d{2})') = substring(candidate_year from '((?:19|20)\d{2})')
    else public.catalog_expand_years(query_year) && public.catalog_expand_years(candidate_year)
  end;
$$;

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
as $function$
  with params as (
    select
      lower(nullif(trim(search_text), '')) as q,
      upper(nullif(trim(exact_checklist_code), '')) as checklist,
      upper(nullif(trim(exact_card_number), '')) as card_no,
      lower(nullif(trim(exact_subject), '')) as subject,
      nullif(trim(exact_year), '') as yr_raw,
      public.catalog_expand_years(exact_year) as yr_set,
      lower(nullif(trim(exact_product), '')) as product_name,
      nullif(regexp_replace(coalesce(exact_serial_denominator, ''), '[^0-9]', '', 'g'), '') as denom,
      greatest(1, least(coalesce(match_count, 30), 50)) as limit_n
  ),
  subject_parts as (
    select array(
      select trim(part)
      from unnest(string_to_array((select subject from params), '/')) part
      where trim(part) <> ''
    ) as parts
  ),
  scored as (
    select
      c.*,
      s.source_type,
      (
        case when p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist then 0.42 else 0 end +
        case when p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no then 0.32 else 0 end +
        case when p.subject is not null then 0.22 else 0 end +
        case when p.yr_raw is not null
          and public.catalog_years_compatible(p.yr_raw, c.season_year) then 0.12 else 0 end +
        case when p.product_name is not null and lower(coalesce(c.product, '')) like '%' || p.product_name || '%' then 0.18 else 0 end +
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 0.10 else 0 end +
        case when p.q is not null and lower(coalesce(c.canonical_title, '')) like '%' || p.q || '%' then 0.08 else 0 end +
        case when c.review_status = 'REVIEWED_INTERNAL' then 0.08 else 0 end +
        case when s.source_type in (
          'TOPPS_OFFICIAL_CHECKLIST',
          'PANINI_OFFICIAL_CHECKLIST',
          'UPPER_DECK_OFFICIAL_CHECKLIST',
          'POKEMON_OFFICIAL_CARD_SEARCH',
          'KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE',
          'WOTC_GATHERER_OFFICIAL_DATABASE'
        ) then 0.04 else 0 end
      )::numeric as score,
      array_remove(array[
        case when p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist then 'checklist_code' end,
        case when p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no then 'collector_number' end,
        case when p.subject is not null then 'subject' end,
        case when p.yr_raw is not null
          and public.catalog_years_compatible(p.yr_raw, c.season_year) then 'year' end,
        case when p.product_name is not null and lower(coalesce(c.product, '')) like '%' || p.product_name || '%' then 'product' end,
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 'serial_denominator' end,
        case when p.q is not null and lower(coalesce(c.canonical_title, '')) like '%' || p.q || '%' then 'canonical_title' end
      ], null)::text[] as support
    from public.catalog_cards c
    left join public.catalog_sources s on s.id = c.source_id
    cross join params p
    cross join subject_parts sp
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
      -- Identity FILTER: a provided subject anchor must match (any query
      -- player against players[] or the canonical title). Rows about a
      -- different player never enter the candidate list.
      and (
        p.subject is null
        or exists (
          select 1
          from unnest(sp.parts) qs
          left join lateral unnest(c.players) player on true
          where (player is not null and (lower(player) like '%' || lower(qs) || '%' or lower(qs) like '%' || lower(player) || '%'))
             or lower(coalesce(c.canonical_title, '')) like '%' || lower(qs) || '%'
        )
      )
      -- Identity FILTER: a provided year anchor must be season-compatible.
      -- Rows with no parseable year are kept (checklist rows may omit it);
      -- rows with an incompatible year are excluded.
      and (
        p.yr_raw is null
        or public.catalog_expand_years(c.season_year) = '{}'::int[]
        or public.catalog_years_compatible(p.yr_raw, c.season_year)
      )
      and (
        p.checklist is not null
        or p.card_no is not null
        or p.subject is not null
        or p.yr_raw is not null
        or p.product_name is not null
        or p.denom is not null
        or p.q is not null
      )
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
