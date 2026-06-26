create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.catalog_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('INTERNAL_CORRECTED_TITLE', 'TOPPS_OFFICIAL_CHECKLIST')),
  source_status text not null check (source_status in ('VERIFIED_CANONICAL_TITLE', 'TOPPS_OFFICIAL_RAW', 'REVIEWED_INTERNAL', 'REVIEW_REQUIRED')),
  source_name text not null,
  source_url text,
  source_metadata jsonb not null default '{}'::jsonb,
  raw_text text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_import_staging (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.catalog_sources(id) on delete cascade,
  import_status text not null default 'REVIEW_REQUIRED' check (import_status in ('AUTO_PARSED_FROM_VERIFIED_TITLE', 'REVIEW_REQUIRED', 'READY_CANDIDATE', 'REVIEWED_INTERNAL', 'REJECTED')),
  source_row_key text,
  canonical_title text,
  identity_fields jsonb not null default '{}'::jsonb,
  physical_instance_fields jsonb not null default '{}'::jsonb,
  field_statuses jsonb not null default '{}'::jsonb,
  parse_confidence numeric not null default 0 check (parse_confidence >= 0 and parse_confidence <= 1),
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, source_row_key)
);

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  sport text not null default 'basketball',
  league text,
  season_year text,
  manufacturer text,
  brand text,
  product text not null,
  source_id uuid references public.catalog_sources(id) on delete set null,
  source_status text not null default 'REVIEW_REQUIRED' check (source_status in ('AUTO_PARSED_FROM_VERIFIED_TITLE', 'TOPPS_OFFICIAL_RAW', 'REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  review_status text not null default 'REVIEW_REQUIRED' check (review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_sets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  set_or_insert text,
  subset text,
  official_card_type text,
  source_id uuid references public.catalog_sources(id) on delete set null,
  source_status text not null default 'REVIEW_REQUIRED' check (source_status in ('AUTO_PARSED_FROM_VERIFIED_TITLE', 'TOPPS_OFFICIAL_RAW', 'REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  review_status text not null default 'REVIEW_REQUIRED' check (review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_cards (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  set_id uuid references public.catalog_sets(id) on delete set null,
  sport text not null default 'basketball',
  league text,
  season_year text,
  manufacturer text,
  brand text,
  product text not null,
  set_or_insert text,
  subset text,
  players text[] not null default '{}'::text[],
  team text,
  card_number text,
  checklist_code text,
  official_card_type text,
  observable_components text[] not null default '{}'::text[],
  surface_color text,
  serial_denominator text,
  canonical_title text,
  source_id uuid references public.catalog_sources(id) on delete set null,
  source_status text not null default 'REVIEW_REQUIRED' check (source_status in ('AUTO_PARSED_FROM_VERIFIED_TITLE', 'TOPPS_OFFICIAL_RAW', 'REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  review_status text not null default 'REVIEW_REQUIRED' check (review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_parallels (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  catalog_card_id uuid references public.catalog_cards(id) on delete cascade,
  surface_color text,
  parallel_family text,
  parallel_exact text,
  expected_serial_denominator text,
  source_id uuid references public.catalog_sources(id) on delete set null,
  source_status text not null default 'REVIEW_REQUIRED' check (source_status in ('AUTO_PARSED_FROM_VERIFIED_TITLE', 'TOPPS_OFFICIAL_RAW', 'REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  review_status text not null default 'REVIEW_REQUIRED' check (review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_sources_type_status_idx on public.catalog_sources(source_type, source_status);
create index if not exists catalog_import_staging_status_idx on public.catalog_import_staging(import_status);
create index if not exists catalog_products_identity_idx on public.catalog_products(sport, league, season_year, product);
create index if not exists catalog_cards_card_number_idx on public.catalog_cards(card_number);
create index if not exists catalog_cards_checklist_code_idx on public.catalog_cards(checklist_code);
create index if not exists catalog_cards_year_product_idx on public.catalog_cards(season_year, product);
create index if not exists catalog_cards_players_gin_idx on public.catalog_cards using gin(players);
create index if not exists catalog_cards_title_trgm_idx on public.catalog_cards using gin(canonical_title gin_trgm_ops);
create index if not exists catalog_parallels_card_idx on public.catalog_parallels(catalog_card_id);

alter table public.catalog_sources enable row level security;
alter table public.catalog_import_staging enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_sets enable row level security;
alter table public.catalog_cards enable row level security;
alter table public.catalog_parallels enable row level security;

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
      s.source_status,
      (
        case when p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist then 0.42 else 0 end +
        case when p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no then 0.32 else 0 end +
        case when p.subject is not null and exists (
          select 1 from unnest(c.players) player where lower(player) like '%' || p.subject || '%' or p.subject like '%' || lower(player) || '%'
        ) then 0.22 else 0 end +
        case when p.yr is not null and lower(coalesce(c.season_year, '')) = p.yr then 0.12 else 0 end +
        case when p.product_name is not null and lower(coalesce(c.product, '')) like '%' || p.product_name || '%' then 0.18 else 0 end +
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 0.10 else 0 end +
        case when c.review_status = 'REVIEWED_INTERNAL' then 0.08 else 0 end +
        case when s.source_type = 'TOPPS_OFFICIAL_CHECKLIST' then 0.04 else 0 end
      )::numeric as score,
      array_remove(array[
        case when p.checklist is not null and upper(coalesce(c.checklist_code, '')) = p.checklist then 'checklist_code' end,
        case when p.card_no is not null and upper(coalesce(c.card_number, '')) = p.card_no then 'collector_number' end,
        case when p.subject is not null and exists (
          select 1 from unnest(c.players) player where lower(player) like '%' || p.subject || '%' or p.subject like '%' || lower(player) || '%'
        ) then 'players' end,
        case when p.yr is not null and lower(coalesce(c.season_year, '')) = p.yr then 'year' end,
        case when p.product_name is not null and lower(coalesce(c.product, '')) like '%' || p.product_name || '%' then 'product' end,
        case when p.denom is not null and regexp_replace(coalesce(c.serial_denominator, ''), '[^0-9]', '', 'g') = p.denom then 'serial_denominator' end
      ], null)::text[] as support
    from public.catalog_cards c
    left join public.catalog_sources s on s.id = c.source_id
    cross join params p
    where c.sport = 'basketball'
      and c.review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL')
      and c.source_status in ('AUTO_PARSED_FROM_VERIFIED_TITLE', 'TOPPS_OFFICIAL_RAW', 'REVIEWED_INTERNAL')
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
    concat_ws(':', scored.season_year, scored.product, array_to_string(scored.players, '/'), scored.card_number, scored.checklist_code) as identity_key,
    jsonb_strip_nulls(jsonb_build_object(
      'category', scored.sport,
      'year', scored.season_year,
      'manufacturer', scored.manufacturer,
      'brand', scored.brand,
      'product', scored.product,
      'set', scored.set_or_insert,
      'subset', scored.subset,
      'players', scored.players,
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
      when scored.source_status = 'TOPPS_OFFICIAL_RAW' then 'registry'
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
