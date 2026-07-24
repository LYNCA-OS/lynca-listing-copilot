-- Query anchors are punctuation-normalized before search. Keep the stored,
-- indexed search blob in the same canonical form so names such as
-- "Sephiroth, One-Winged Angel" survive the fail-closed subject gate.
create or replace function public.catalog_search_blob_text(
  p_title text,
  p_sport text,
  p_year text,
  p_brand text,
  p_manu text,
  p_product text,
  p_set text,
  p_players text[],
  p_card text,
  p_check text,
  p_color text
)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions
as $function$
  select trim(regexp_replace(lower(
    coalesce(p_title,'') || ' ' || coalesce(p_sport,'') || ' ' || coalesce(p_year,'') || ' ' ||
    coalesce(p_brand,'') || ' ' || coalesce(p_manu,'') || ' ' || coalesce(p_product,'') || ' ' ||
    coalesce(p_set,'') || ' ' || coalesce(pg_catalog.array_to_string(p_players, ' '), '') || ' ' ||
    coalesce(p_card,'') || ' ' || coalesce(p_check,'') || ' ' || coalesce(p_color,'')
  ), '[^[:alnum:]]+', ' ', 'g'));
$function$;

comment on function public.catalog_search_blob_text(text, text, text, text, text, text, text, text[], text, text, text)
is 'Canonical punctuation-insensitive catalog search text. Query and storage normalization must remain identical.';

-- Stored generated columns are recomputed when a dependent input is updated.
-- Touch only rows whose existing blob is not already canonical.
update public.catalog_cards
set canonical_title = canonical_title
where search_blob is distinct from trim(regexp_replace(lower(search_blob), '[^[:alnum:]]+', ' ', 'g'));
