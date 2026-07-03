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
      lower(nullif(trim(search_text), '')) as q,
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
        case when p.subject is not null and (
          exists (
            select 1 from unnest(c.players) player
            where lower(player) like '%' || p.subject || '%'
              or p.subject like '%' || lower(player) || '%'
          )
          or lower(coalesce(c.canonical_title, '')) like '%' || p.subject || '%'
        ) then 0.22 else 0 end +
        case when p.yr is not null and lower(coalesce(c.season_year, '')) = p.yr then 0.12 else 0 end +
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
        case when p.subject is not null and (
          exists (
            select 1 from unnest(c.players) player
            where lower(player) like '%' || p.subject || '%'
              or p.subject like '%' || lower(player) || '%'
          )
          or lower(coalesce(c.canonical_title, '')) like '%' || p.subject || '%'
        ) then 'subject' end,
        case when p.yr is not null and lower(coalesce(c.season_year, '')) = p.yr then 'year' end,
        case when p.product_name is not null and lower(coalesce(c.product, '')) like '%' || p.product_name || '%' then 'product' end,
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 'serial_denominator' end,
        case when p.q is not null and lower(coalesce(c.canonical_title, '')) like '%' || p.q || '%' then 'canonical_title' end
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
        'OFFICIAL_PARSE_REVIEW_REQUIRED',
        'EXTERNAL_DIRECTORY_CANDIDATE',
        'COMMUNITY_API_CANDIDATE',
        'REVIEW_REQUIRED',
        'REVIEWED_INTERNAL'
      )
      and (
        p.checklist is not null
        or p.card_no is not null
        or p.subject is not null
        or p.yr is not null
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
$$;

grant execute on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer) to service_role;

comment on function public.search_catalog_candidates(text, text, text, text, text, text, text, integer) is
  'Catalog candidate search for泛体育 + TCG. Replaces the old basketball-only filter and supports title-backed subject matching for writer-title catalog seeds.';
