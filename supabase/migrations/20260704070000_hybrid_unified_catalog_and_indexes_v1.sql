-- A2: unify the hybrid retrieval surface. search_card_identities_hybrid
-- previously searched only card_identities (65 rows) while the imported
-- catalog lives in catalog_cards (16.5k rows) - the hybrid lane was
-- effectively blind. The candidate surface is now the UNION of both, with
-- the same subject/year identity-filter semantics as search_catalog_candidates.
--
-- S4: scale indexes for catalog_cards (trigram on canonical_title, exact-code
-- btrees, players GIN) plus a materialized season_start_year column so year
-- filtering stops calling a function per row.

create extension if not exists pg_trgm with schema extensions;

alter table public.catalog_cards
  add column if not exists season_start_year int
  generated always as (
    nullif(substring(coalesce(season_year, '') from '(?:19|20)\d{2}'), '')::int
  ) stored;

create index if not exists catalog_cards_canonical_title_trgm
  on public.catalog_cards using gin (lower(canonical_title) extensions.gin_trgm_ops);
create index if not exists catalog_cards_card_number_upper
  on public.catalog_cards (upper(card_number));
create index if not exists catalog_cards_checklist_code_upper
  on public.catalog_cards (upper(checklist_code));
create index if not exists catalog_cards_players_gin
  on public.catalog_cards using gin (players);
create index if not exists catalog_cards_season_start_year
  on public.catalog_cards (season_start_year);

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
      lower(concat_ws(
        ' ',
        cc.canonical_title,
        cc.sport,
        cc.season_year,
        cc.brand,
        cc.manufacturer,
        cc.product,
        cc.set_or_insert,
        array_to_string(cc.players, ' '),
        cc.card_number,
        cc.checklist_code,
        cc.surface_color
      )) as blob,
      cc.season_year as year_value
    from public.catalog_cards cc
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
  ),
  filtered as (
    select c.*
    from candidate_text c
    cross join input i
    cross join subject_parts sp
    where
      -- Identity FILTER: provided subject must match the candidate text.
      (
        i.subject = ''
        or exists (
          select 1 from unnest(sp.parts) qs
          where c.blob like '%' || lower(qs) || '%'
        )
      )
      -- Identity FILTER: provided year must be season-compatible.
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
