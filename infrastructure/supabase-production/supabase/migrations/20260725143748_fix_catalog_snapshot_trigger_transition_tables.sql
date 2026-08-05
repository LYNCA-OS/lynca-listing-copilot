create or replace function public.bump_active_catalog_snapshot_revision()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  insert into public.listing_active_catalog_snapshot(
    singleton, revision, content_revision, changed_table, changed_operation, updated_at
  ) values (
    true, 1, 'catalog-revision-1',
    tg_table_schema || '.' || tg_table_name, tg_op, clock_timestamp()
  )
  on conflict (singleton) do update
  set revision = public.listing_active_catalog_snapshot.revision + 1,
      content_revision = 'catalog-revision-' || (public.listing_active_catalog_snapshot.revision + 1)::text,
      changed_table = excluded.changed_table,
      changed_operation = excluded.changed_operation,
      updated_at = excluded.updated_at;
  return null;
end;
$function$;

create or replace function public.bump_active_catalog_snapshot_revision_on_update()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not exists (
    select 1
    from (
      (select to_jsonb(old_rows) as row_data from old_rows
       except all
       select to_jsonb(new_rows) as row_data from new_rows)
      union all
      (select to_jsonb(new_rows) as row_data from new_rows
       except all
       select to_jsonb(old_rows) as row_data from old_rows)
    ) as changed_rows
  ) then
    return null;
  end if;

  insert into public.listing_active_catalog_snapshot(
    singleton, revision, content_revision, changed_table, changed_operation, updated_at
  ) values (
    true, 1, 'catalog-revision-1',
    tg_table_schema || '.' || tg_table_name, tg_op, clock_timestamp()
  )
  on conflict (singleton) do update
  set revision = public.listing_active_catalog_snapshot.revision + 1,
      content_revision = 'catalog-revision-' || (public.listing_active_catalog_snapshot.revision + 1)::text,
      changed_table = excluded.changed_table,
      changed_operation = excluded.changed_operation,
      updated_at = excluded.updated_at;
  return null;
end;
$function$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'catalog_sources','catalog_products','catalog_sets','catalog_cards',
    'catalog_parallels','card_identities','card_reference_images','card_image_embeddings'
  ] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('drop trigger if exists %I on public.%I', 'bump_active_catalog_snapshot_revision_on_update', target_table);
      execute format(
        'create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.bump_active_catalog_snapshot_revision_on_update()',
        'bump_active_catalog_snapshot_revision_on_update',
        target_table
      );
    end if;
  end loop;
end;
$$;;
