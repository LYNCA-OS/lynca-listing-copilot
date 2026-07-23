create or replace function public.materialize_listing_asset_idempotent(
  p_id text,
  p_tenant_id text,
  p_expected_original_count smallint,
  p_capture_profile_id text default null,
  p_category text default null
)
returns table (
  asset_id text,
  tenant_id text,
  image_generation_id text,
  expected_original_count smallint,
  capture_profile_id text,
  category text,
  inserted boolean,
  conflict boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_asset public.listing_assets%rowtype;
begin
  if p_id is null or btrim(p_id) = ''
     or p_tenant_id is null or btrim(p_tenant_id) = ''
     or p_expected_original_count not between 1 and 2 then
    raise exception 'invalid_listing_asset_materialization_request'
      using errcode = '22023';
  end if;

  insert into public.listing_assets (
    id,
    tenant_id,
    image_generation_id,
    expected_original_count,
    image_set_state,
    capture_profile_id,
    category
  ) values (
    p_id,
    p_tenant_id,
    p_id,
    p_expected_original_count,
    'INCOMPLETE',
    p_capture_profile_id,
    p_category
  )
  on conflict (id) do nothing
  returning * into v_asset;

  if found then
    return query select
      v_asset.id,
      v_asset.tenant_id,
      v_asset.image_generation_id,
      v_asset.expected_original_count,
      v_asset.capture_profile_id,
      v_asset.category,
      true,
      false;
    return;
  end if;

  select *
    into v_asset
    from public.listing_assets
   where id = p_id;

  if not found then
    raise exception 'listing_asset_idempotency_race'
      using errcode = '40001';
  end if;

  return query select
    v_asset.id,
    v_asset.tenant_id,
    v_asset.image_generation_id,
    v_asset.expected_original_count,
    v_asset.capture_profile_id,
    v_asset.category,
    false,
    not (
      v_asset.tenant_id = p_tenant_id
      and v_asset.image_generation_id = p_id
      and v_asset.expected_original_count = p_expected_original_count
      and v_asset.capture_profile_id is not distinct from p_capture_profile_id
      and v_asset.category is not distinct from p_category
    );
end;
$$;

revoke all on function public.materialize_listing_asset_idempotent(
  text, text, smallint, text, text
) from public, anon, authenticated;

grant execute on function public.materialize_listing_asset_idempotent(
  text, text, smallint, text, text
) to service_role;

comment on function public.materialize_listing_asset_idempotent(
  text, text, smallint, text, text
) is 'Atomically creates or validates one immutable deterministic listing asset idempotency contract.';
