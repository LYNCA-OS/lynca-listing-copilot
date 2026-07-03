-- Remove marketplace quantity / inventory terms from TCG identity fields parsed
-- from internal writer-upload titles. Keep canonical_title unchanged for audit.

create or replace function public._lynca_clean_writer_tcg_name_v0(value text)
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
              '(?:^|[[:space:]])(?:lot|lots|qty|quantity|bundle)[[:space:]]*(?:of[[:space:]]*)?(?:x|\\*)?[[:space:]]*[0-9]+(?:$|[[:space:]])',
              ' ',
              'gi'
            ),
            '(?:^|[[:space:]])(?:x|\\*)[[:space:]]*[0-9]+(?:$|[[:space:]])',
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
      select public._lynca_clean_writer_tcg_name_v0(player_name) as cleaned_name
      from unnest(c.players) as player_name
    ) cleaned
    where cleaned_name is not null
  ), array[]::text[]),
  metadata = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(c.metadata, '{}'::jsonb),
        '{card_name}',
        to_jsonb(coalesce(public._lynca_clean_writer_tcg_name_v0(c.metadata->>'card_name'), c.metadata->>'card_name')),
        true
      ),
      '{character}',
      to_jsonb(coalesce(public._lynca_clean_writer_tcg_name_v0(c.metadata->>'character'), c.metadata->>'character')),
      true
    ),
    '{sales_term_cleanup}',
    to_jsonb('catalog_clean_writer_title_tcg_sales_terms_v0'::text),
    true
  ),
  updated_at = now()
where c.metadata->>'import_source' = 'writer_title_catalog_seed_v1'
  and c.sport = 'tcg'
  and (
    c.players::text ~* '(lot|qty|quantity|bundle|[0-9]{3,6})'
    or coalesce(c.metadata->>'card_name', '') ~* '(lot|qty|quantity|bundle|[0-9]{3,6})'
    or coalesce(c.metadata->>'character', '') ~* '(lot|qty|quantity|bundle|[0-9]{3,6})'
  );

drop function public._lynca_clean_writer_tcg_name_v0(text);
