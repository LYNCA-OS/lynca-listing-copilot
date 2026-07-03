-- Clear historical "unknown" catalog category rows from earlier corrected-title imports.
-- The remaining uncertain rows are explicit other_collectibles fallbacks, not unknowns.

with inferred_products as (
  select
    id,
    case
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(pokemon|pokémon|yu[- ]?gi[- ]?oh|yugioh|one piece|digimon|dragon ball|magic: the gathering|\\bmtg\\b|final fantasy)' then 'tcg'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(ufc|\\bmma\\b)' then 'mma'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(\\bwwe\\b|\\bwwf\\b|wrestl)' then 'wrestling'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(formula 1|\\bf1\\b|nascar|racing|verstappen|hamilton)' then 'racing'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(hockey|\\bnhl\\b|young guns|mcdavid|ovechkin|crosby)' then 'hockey'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(soccer|\\bucc\\b|\\buefa\\b|\\bucl\\b|champions league|premier league|messi|ronaldo|yamal|mbappe|haaland|football club)' then 'soccer'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(basketball|\\bnba\\b|\\bwnba\\b|kobe|lebron|wembanyama|jordan|anthony edwards|cooper flagg|jalen brunson|contenders.*rookie ticket|panini absolute|hoopla)' then 'basketball'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(baseball|\\bmlb\\b|ohtani|dodgers|yankees|bowman|stadium club|griffey|trout|hank aaron|nick swisher)' then 'baseball'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(football|\\bnfl\\b|quarterback|draft edition|rated rookie|rashee rice|dontayvion|skattebo|travis hunter|graham harrell)' then 'football'
      when concat_ws(' ', product, manufacturer, brand, league, metadata::text) ~* '(marvel|star wars|disney|goodwin|game of thrones|harry potter|garbage pail|veefriends|the monsters)' then 'non_sports'
      else 'other_collectibles'
    end as inferred_sport
  from public.catalog_products
  where coalesce(sport, '') in ('', 'unknown')
)
update public.catalog_products p
set
  sport = i.inferred_sport,
  metadata = jsonb_set(
    jsonb_set(coalesce(p.metadata, '{}'::jsonb), '{category_cleanup}', to_jsonb('catalog_clear_unknown_categories_v0'::text), true),
    '{previous_sport}',
    to_jsonb(coalesce(p.sport, 'unknown')),
    true
  ),
  updated_at = now()
from inferred_products i
where p.id = i.id;

with inferred_cards as (
  select
    id,
    case
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(pokemon|pokémon|yu[- ]?gi[- ]?oh|yugioh|one piece|digimon|dragon ball|magic: the gathering|\\bmtg\\b|final fantasy)' then 'tcg'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(ufc|\\bmma\\b)' then 'mma'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(\\bwwe\\b|\\bwwf\\b|wrestl)' then 'wrestling'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(formula 1|\\bf1\\b|nascar|racing|verstappen|hamilton)' then 'racing'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(hockey|\\bnhl\\b|young guns|mcdavid|ovechkin|crosby)' then 'hockey'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(soccer|\\bucc\\b|\\buefa\\b|\\bucl\\b|champions league|premier league|messi|ronaldo|yamal|mbappe|haaland|football club)' then 'soccer'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(basketball|\\bnba\\b|\\bwnba\\b|kobe|lebron|wembanyama|jordan|anthony edwards|cooper flagg|jalen brunson|contenders.*rookie ticket|panini absolute|hoopla)' then 'basketball'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(baseball|\\bmlb\\b|ohtani|dodgers|yankees|bowman|stadium club|griffey|trout|hank aaron|nick swisher)' then 'baseball'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(football|\\bnfl\\b|quarterback|draft edition|rated rookie|rashee rice|dontayvion|skattebo|travis hunter|graham harrell)' then 'football'
      when concat_ws(' ', canonical_title, product, manufacturer, brand, league, metadata::text) ~* '(marvel|star wars|disney|goodwin|game of thrones|harry potter|garbage pail|veefriends|the monsters)' then 'non_sports'
      else 'other_collectibles'
    end as inferred_sport
  from public.catalog_cards
  where coalesce(sport, '') in ('', 'unknown')
)
update public.catalog_cards c
set
  sport = i.inferred_sport,
  metadata = jsonb_set(
    jsonb_set(coalesce(c.metadata, '{}'::jsonb), '{category_cleanup}', to_jsonb('catalog_clear_unknown_categories_v0'::text), true),
    '{previous_sport}',
    to_jsonb(coalesce(c.sport, 'unknown')),
    true
  ),
  updated_at = now()
from inferred_cards i
where c.id = i.id;
