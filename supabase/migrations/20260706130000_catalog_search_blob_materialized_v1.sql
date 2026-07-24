-- V4 smoke: catalog retrieval p95 hit 63.8s (one card 63.8s, one 13.4s).
-- Root cause: the unified hybrid RPC builds its trigram/fulltext blob
-- dynamically per row (concat_ws over 11 columns x 16.5k rows x several
-- queries per card), so the pg_trgm index can never be used. Materialize
-- the blob as a stored generated column, index it, and let pure-text
-- queries pre-filter through the index.

-- pg_catalog.concat_ws is marked STABLE because it accepts polymorphic input,
-- even though this call site is text-only. Wrap the exact text contract in an
-- immutable function so a clean PostgreSQL bootstrap can legally use it in a
-- stored generated column.
create or replace function public.build_catalog_search_blob(
  canonical_title text,
  sport text,
  season_year text,
  brand text,
  manufacturer text,
  product text,
  set_or_insert text,
  players text[],
  card_number text,
  checklist_code text,
  surface_color text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select pg_catalog.lower(pg_catalog.concat_ws(' ',
    canonical_title,
    sport,
    season_year,
    brand,
    manufacturer,
    product,
    set_or_insert,
    pg_catalog.array_to_string(players, ' '),
    card_number,
    checklist_code,
    surface_color
  ));
$function$;

alter table public.catalog_cards
  add column if not exists search_blob text
  generated always as (
    public.build_catalog_search_blob(
      canonical_title,
      sport,
      season_year,
      brand,
      manufacturer,
      product,
      set_or_insert,
      array_to_string(players, ' '),
      card_number,
      checklist_code,
      surface_color
    )
  ) stored;

create index if not exists catalog_cards_search_blob_trgm
  on public.catalog_cards using gin (search_blob extensions.gin_trgm_ops);

create or replace function public.search_card_identities_hybrid(
  search_text text default null::text,
  exact_checklist_code text default null::text,
  exact_collector_number text default null::text,
  exact_subject text default null::text,
  exact_year text default null::text,
  exact_product text default null::text,
  match_count integer default 30
)
returns table(
  identity_id uuid,
  identity_key text,
  canonical_title text,
  category text,
  fields jsonb,
  retrieval_status text,
  channel_id text,
  raw_score double precision,
  normalized_score double precision,
  supporting_fields text[]
)
language sql
stable
as $function$
  with input as (
    select
      lower(trim(coalesce(search_text, ''))) as q,
      lower(trim(coalesce(exact_checklist_code, ''))) as checklist_code,
      lower(regexp_replace(trim(coalesce(exact_collector_number, '')), '^#\s*', '')) as collector_number,
      lower(trim(coalesce(exact_subject, ''))) as subject,
      lower(trim(coalesce(exact_year, ''))) as year_text,
      lower(trim(coalesce(exact_product, ''))) as product
  ),
  subject_parts as (
    select array(
      select trim(part)
      from unnest(string_to_array((select subject from input), '/')) part
      where trim(part) <> ''
    ) as parts
  ),
  candidate_text as (
    select
      ci.identity_id,
      ci.identity_key,
      ci.canonical_title,
      ci.category,
      ci.fields,
      ci.retrieval_status,
      lower(concat_ws(
        ' ',
        ci.identity_key,
        ci.canonical_title,
        ci.category,
        ci.fields->>'year',
        ci.fields->>'brand',
        ci.fields->>'manufacturer',
        ci.fields->>'product',
        ci.fields->>'set',
        ci.fields->>'player',
        ci.fields->>'character',
        ci.fields->>'collector_number',
        ci.fields->>'checklist_code',
        ci.fields->>'parallel_exact',
        ci.fields->>'parallel'
      )) as blob,
      ci.fields->>'year' as year_value
    from public.card_identities ci
    where ci.retrieval_enabled is true
      and ci.retrieval_status in ('approved', 'reviewed', 'registry')

    union all

    select
      cc.id as identity_id,
      concat_ws(':', cc.sport, cc.season_year, cc.product, array_to_string(cc.players, '/'), cc.card_number, cc.checklist_code) as identity_key,
      cc.canonical_title,
      cc.sport as category,
      jsonb_strip_nulls(jsonb_build_object(
        'category', cc.sport,
        'year', cc.season_year,
        'manufacturer', cc.manufacturer,
        'brand', cc.brand,
        'product', cc.product,
        'set', cc.set_or_insert,
        'subset', cc.subset,
        'players', cc.players,
        'team', cc.team,
        'collector_number', cc.card_number,
        'checklist_code', cc.checklist_code,
        'official_card_type', cc.official_card_type,
        'observable_components', cc.observable_components,
        'surface_color', cc.surface_color
      )) as fields,
      case
        when cc.review_status = 'REVIEWED_INTERNAL' then 'reviewed'
        when cc.source_status in ('AUTO_PARSED_FROM_OFFICIAL_CHECKLIST', 'OFFICIAL_CHECKLIST_CANDIDATE', 'TOPPS_OFFICIAL_RAW', 'OFFICIAL_CHECKLIST_RAW') then 'registry'
        else 'candidate'
      end as retrieval_status,
      cc.search_blob as blob,
      cc.season_year as year_value
    from public.catalog_cards cc
    cross join input i
    where cc.review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')
      and cc.source_status in (
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
      -- Pure-text queries pre-filter through the trigram index; queries that
      -- carry structural anchors (subject/year/codes/product) are already
      -- narrowed by the filters below.
      and (
        i.q = ''
        or i.subject <> ''
        or i.year_text <> ''
        or i.checklist_code <> ''
        or i.collector_number <> ''
        or i.product <> ''
        or cc.search_blob % i.q
      )
  ),
  filtered as (
    select c.*
    from candidate_text c
    cross join input i
    cross join subject_parts sp
    where
      (
        i.subject = ''
        or exists (
          select 1 from unnest(sp.parts) qs
          where c.blob like '%' || lower(qs) || '%'
        )
      )
      and (
        i.year_text = ''
        or coalesce(c.year_value, '') = ''
        or public.catalog_years_compatible(i.year_text, c.year_value)
      )
  ),
  scored as (
    select
      c.*,
      (
        case when i.checklist_code <> '' and lower(coalesce(c.fields->>'checklist_code', '')) = i.checklist_code then 3.0 else 0 end
        + case when i.collector_number <> '' and lower(regexp_replace(coalesce(c.fields->>'collector_number', ''), '^#\s*', '')) = i.collector_number then 1.4 else 0 end
        + case when i.subject <> '' then 1.0 else 0 end
        + case when i.year_text <> '' and public.catalog_years_compatible(i.year_text, c.year_value) then 0.8 else 0 end
        + case when i.product <> '' and (
            lower(coalesce(c.fields->>'product', '')) like '%' || i.product || '%'
            or lower(coalesce(c.fields->>'set', '')) like '%' || i.product || '%'
            or c.blob like '%' || i.product || '%'
          ) then 0.8 else 0 end
        + case when i.q <> '' then least(1.0, greatest(extensions.similarity(c.blob, i.q), 0)) else 0 end
        + case when i.q <> ''
            and to_tsvector('simple', c.blob) @@ websearch_to_tsquery('simple', i.q)
          then ts_rank_cd(to_tsvector('simple', c.blob), websearch_to_tsquery('simple', i.q))
          else 0
          end
      ) as raw_score,
      array_remove(array[
        case when i.checklist_code <> '' and lower(coalesce(c.fields->>'checklist_code', '')) = i.checklist_code then 'checklist_code' end,
        case when i.collector_number <> '' and lower(regexp_replace(coalesce(c.fields->>'collector_number', ''), '^#\s*', '')) = i.collector_number then 'collector_number' end,
        case when i.subject <> '' then 'subjects' end,
        case when i.year_text <> '' and public.catalog_years_compatible(i.year_text, c.year_value) then 'year' end,
        case when i.product <> '' and c.blob like '%' || i.product || '%' then 'product' end,
        case when i.q <> ''
            and to_tsvector('simple', c.blob) @@ websearch_to_tsquery('simple', i.q)
          then 'full_text'
          end,
        case when i.q <> '' and extensions.similarity(c.blob, i.q) > 0 then 'trigram'
          end
      ], null)::text[] as supporting_fields
    from filtered c
    cross join input i
    where i.q <> ''
      or i.checklist_code <> ''
      or i.collector_number <> ''
      or i.subject <> ''
      or i.year_text <> ''
      or i.product <> ''
  )
  select
    s.identity_id,
    s.identity_key,
    s.canonical_title,
    s.category,
    s.fields,
    s.retrieval_status,
    case
      when 'checklist_code' = any(s.supporting_fields) or 'collector_number' = any(s.supporting_fields) then 'ocr_exact_code'
      when 'full_text' = any(s.supporting_fields) or 'trigram' = any(s.supporting_fields) then 'postgres_full_text'
      else 'structured_metadata'
    end as channel_id,
    s.raw_score,
    least(1.0, s.raw_score / 5.5) as normalized_score,
    s.supporting_fields
  from scored s
  where s.raw_score > 0
  order by s.raw_score desc, s.identity_key asc
  limit least(greatest(coalesce(match_count, 30), 1), 50);
$function$;
