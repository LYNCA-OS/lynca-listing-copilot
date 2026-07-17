-- Forward-only convergence for production databases where Track C lineage
-- triggers landed before the legacy listing_assets parents were materialized.
-- Discover every public base table carrying both tenant_id and asset_id so the
-- repair cannot silently omit an older data-asset lane.

set lock_timeout = '5s';
set statement_timeout = '5min';

do $$
begin
  if pg_catalog.to_regclass('public.listing_assets') is null then
    raise exception using errcode = '42P01', message = 'listing_assets_missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listing_assets'
      and column_name = 'tenant_id'
  ) then
    raise exception using errcode = '42703', message = 'listing_assets_tenant_id_missing';
  end if;
end;
$$;

drop table if exists pg_temp.track_c_asset_parent_convergence_v1;

create temporary table track_c_asset_parent_convergence_v1 (
  tenant_id text not null,
  asset_id text not null,
  primary key (tenant_id, asset_id)
) on commit preserve rows;

do $$
declare
  v_table record;
begin
  for v_table in
    select tables.table_name
    from information_schema.tables tables
    where tables.table_schema = 'public'
      and tables.table_type = 'BASE TABLE'
      and tables.table_name <> 'listing_assets'
      and exists (
        select 1 from information_schema.columns columns
        where columns.table_schema = tables.table_schema
          and columns.table_name = tables.table_name
          and columns.column_name = 'tenant_id'
      )
      and exists (
        select 1 from information_schema.columns columns
        where columns.table_schema = tables.table_schema
          and columns.table_name = tables.table_name
          and columns.column_name = 'asset_id'
      )
    order by tables.table_name
  loop
    execute pg_catalog.format(
      'insert into track_c_asset_parent_convergence_v1 (tenant_id, asset_id)
       select distinct tenant_id::text, asset_id::text
       from public.%I
       where tenant_id is not null and asset_id is not null
       on conflict do nothing',
      v_table.table_name
    );
  end loop;
end;
$$;

do $$
declare
  v_conflicting_asset text;
begin
  select parents.asset_id
  into v_conflicting_asset
  from track_c_asset_parent_convergence_v1 parents
  group by parents.asset_id
  having pg_catalog.count(distinct parents.tenant_id) > 1
  order by parents.asset_id
  limit 1;
  if v_conflicting_asset is not null then
    raise exception using
      errcode = '23505',
      message = 'listing_asset_cross_tenant_conflict',
      detail = v_conflicting_asset;
  end if;

  if exists (
    select 1
    from track_c_asset_parent_convergence_v1 parents
    join public.listing_assets assets on assets.id = parents.asset_id
    where assets.tenant_id is distinct from parents.tenant_id
  ) then
    raise exception using errcode = '23505', message = 'listing_asset_existing_tenant_conflict';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'listing_assets'
      and column_name = 'image_generation_id'
  ) then
    insert into public.listing_assets (id, tenant_id, image_generation_id)
    select parents.asset_id, parents.tenant_id, parents.asset_id
    from track_c_asset_parent_convergence_v1 parents
    order by parents.asset_id
    on conflict (id) do nothing;
  else
    insert into public.listing_assets (id, tenant_id)
    select parents.asset_id, parents.tenant_id
    from track_c_asset_parent_convergence_v1 parents
    order by parents.asset_id
    on conflict (id) do nothing;
  end if;
end;
$$;

do $$
declare
  v_table record;
  v_orphan_count bigint;
begin
  for v_table in
    select tables.table_name
    from information_schema.tables tables
    where tables.table_schema = 'public'
      and tables.table_type = 'BASE TABLE'
      and tables.table_name <> 'listing_assets'
      and exists (
        select 1 from information_schema.columns columns
        where columns.table_schema = tables.table_schema
          and columns.table_name = tables.table_name
          and columns.column_name = 'tenant_id'
      )
      and exists (
        select 1 from information_schema.columns columns
        where columns.table_schema = tables.table_schema
          and columns.table_name = tables.table_name
          and columns.column_name = 'asset_id'
      )
    order by tables.table_name
  loop
    execute pg_catalog.format(
      'select count(*)
       from public.%I child
       left join public.listing_assets parent
         on parent.id = child.asset_id::text
        and parent.tenant_id = child.tenant_id::text
       where child.asset_id is not null
         and child.tenant_id is not null
         and parent.id is null',
      v_table.table_name
    ) into v_orphan_count;
    if v_orphan_count <> 0 then
      raise exception using
        errcode = '23503',
        message = 'listing_asset_parent_convergence_incomplete',
        detail = pg_catalog.format('%s:%s', v_table.table_name, v_orphan_count);
    end if;
  end loop;
end;
$$;

drop table track_c_asset_parent_convergence_v1;
