-- Follow-up cleanup for writer-title TCG names using star quantity forms like lot*2.

create or replace function public._lynca_clean_writer_tcg_lot_star_v0(value text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              coalesce(value, ''),
              '(?:^|[[:space:]])(?:lot|lots|qty|quantity|bundle)[[:space:]]*(?:of[[:space:]]*)?(?:x|[*])?[[:space:]]*[0-9]+(?:$|[[:space:]])',
              ' ',
              'gi'
            ),
            '(?:^|[[:space:]])(?:x|[*])[[:space:]]*[0-9]+(?:$|[[:space:]])',
            ' ',
            'gi'
          ),
          '(?:^|[[:space:]])[0-9]{3,6}(?:$|[[:space:]])',
          ' ',
          'g'
        ),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

update public.catalog_cards c
set
  players = coalesce((
    select array_agg(cleaned_name)
    from (
      select public._lynca_clean_writer_tcg_lot_star_v0(player_name) as cleaned_name
      from unnest(c.players) as player_name
    ) cleaned
    where cleaned_name is not null
  ), array[]::text[]),
  metadata = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(c.metadata, '{}'::jsonb),
        '{card_name}',
        to_jsonb(coalesce(public._lynca_clean_writer_tcg_lot_star_v0(c.metadata->>'card_name'), c.metadata->>'card_name')),
        true
      ),
      '{character}',
      to_jsonb(coalesce(public._lynca_clean_writer_tcg_lot_star_v0(c.metadata->>'character'), c.metadata->>'character')),
      true
    ),
    '{sales_term_cleanup_lot_star}',
    to_jsonb('catalog_clean_writer_title_tcg_lot_star_v0'::text),
    true
  ),
  updated_at = now()
where c.metadata->>'import_source' = 'writer_title_catalog_seed_v1'
  and c.sport = 'tcg'
  and (
    c.players::text ~* '(lot[*]|lot|qty|quantity|bundle|[0-9]{3,6})'
    or coalesce(c.metadata->>'card_name', '') ~* '(lot[*]|lot|qty|quantity|bundle|[0-9]{3,6})'
    or coalesce(c.metadata->>'character', '') ~* '(lot[*]|lot|qty|quantity|bundle|[0-9]{3,6})'
  );

drop function public._lynca_clean_writer_tcg_lot_star_v0(text);
