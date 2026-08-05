create or replace function public.catalog_players_text(value text[])
returns text
language sql
immutable
as $$
  select coalesce((select string_agg(v, ' ') from unnest(coalesce(value, '{}'::text[])) v), '');
$$;

-- concat_ws/array_to_string are STABLE; this pure-text builder is
-- deterministic and safely IMMUTABLE for the generated column.
create or replace function public.catalog_search_blob_text(
  p_title text, p_sport text, p_year text, p_brand text, p_manu text,
  p_product text, p_set text, p_players text[], p_card text, p_check text, p_color text
) returns text
language sql
immutable
as $$
  select lower(
    coalesce(p_title,'') || ' ' || coalesce(p_sport,'') || ' ' || coalesce(p_year,'') || ' ' ||
    coalesce(p_brand,'') || ' ' || coalesce(p_manu,'') || ' ' || coalesce(p_product,'') || ' ' ||
    coalesce(p_set,'') || ' ' || public.catalog_players_text(p_players) || ' ' ||
    coalesce(p_card,'') || ' ' || coalesce(p_check,'') || ' ' || coalesce(p_color,'')
  );
$$;

alter table public.catalog_cards
  add column if not exists search_blob text
  generated always as (
    public.catalog_search_blob_text(
      canonical_title, sport, season_year, brand, manufacturer,
      product, set_or_insert, players, card_number, checklist_code, surface_color
    )
  ) stored;

create index if not exists catalog_cards_search_blob_trgm
  on public.catalog_cards using gin (search_blob extensions.gin_trgm_ops);;
