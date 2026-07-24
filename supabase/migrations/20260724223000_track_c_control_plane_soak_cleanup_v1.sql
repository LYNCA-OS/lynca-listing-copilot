create or replace function public.cleanup_track_c_control_plane_soak(p_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_ids text[];
  v_tenant_count integer := 0;
begin
  if p_run_id is null
     or p_run_id !~ '^tc_hosted_[a-z0-9]+_[0-9a-f]{8}$' then
    raise exception 'invalid control-plane soak run id';
  end if;

  select pg_catalog.coalesce(pg_catalog.array_agg(t.id order by t.id), '{}'::text[])
    into v_tenant_ids
  from public.tenants t
  where t.id ~ ('^' || p_run_id || '_w[1-3]_[ab]$');

  v_tenant_count := pg_catalog.coalesce(pg_catalog.array_length(v_tenant_ids, 1), 0);
  if v_tenant_count = 0 then
    return jsonb_build_object('ok', true, 'tenants_deleted', 0);
  end if;

  if exists (
    select 1
    from public.v4_recognition_jobs j
    where j.tenant_id = any(v_tenant_ids)
      and j.job_type <> 'CONTROL_PLANE_SOAK'
  ) then
    raise exception 'refusing to clean tenant containing non-soak jobs';
  end if;

  if exists (
    select 1
    from public.listing_assets a
    where a.tenant_id = any(v_tenant_ids)
      and a.category <> 'control_plane_soak'
  ) then
    raise exception 'refusing to clean tenant containing non-soak assets';
  end if;

  delete from public.request_logs where tenant_id = any(v_tenant_ids);
  delete from public.error_logs where tenant_id = any(v_tenant_ids);
  delete from public.production_events where tenant_id = any(v_tenant_ids);
  delete from public.job_attempt_events where tenant_id = any(v_tenant_ids);
  delete from public.v4_recognition_jobs where tenant_id = any(v_tenant_ids);
  delete from public.v4_recognition_batches where tenant_id = any(v_tenant_ids);
  delete from public.v4_recognition_sessions where tenant_id = any(v_tenant_ids);

  update public.listing_image_verifications
  set canonical_eligible = false,
      object_verified = false
  where tenant_id = any(v_tenant_ids);

  delete from public.listing_image_verifications where tenant_id = any(v_tenant_ids);
  delete from public.listing_assets where tenant_id = any(v_tenant_ids);
  delete from public.tenants where id = any(v_tenant_ids);

  return jsonb_build_object('ok', true, 'tenants_deleted', v_tenant_count);
end;
$$;

revoke all on function public.cleanup_track_c_control_plane_soak(text)
  from public, anon, authenticated;
grant execute on function public.cleanup_track_c_control_plane_soak(text)
  to service_role;

comment on function public.cleanup_track_c_control_plane_soak(text) is
  'Atomically removes only isolated tc_hosted control-plane soak fixtures; refuses mixed tenants.';
