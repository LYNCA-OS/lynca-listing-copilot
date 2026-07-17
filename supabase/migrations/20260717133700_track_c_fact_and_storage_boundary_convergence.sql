-- Close the remaining production-only Track C trust-boundary drift without
-- changing Supabase-managed Storage grants.
--
-- Writer feedback and SEM rows are append-only service facts. Learning rows
-- are also browser-denied, but retain service-role UPDATE for the established
-- non-writer idempotent-upsert path; Writer-derived rows remain immutable via
-- prevent_v4_writer_learning_event_mutation(). Storage authorization is
-- attested through RLS and exact policies because storage.objects is owned and
-- provisioned by Supabase's storage service.

begin;

drop policy if exists track_c_tenant_delete
  on public.v4_writer_feedback_events;
drop policy if exists track_c_tenant_insert
  on public.v4_writer_feedback_events;
drop policy if exists track_c_tenant_select
  on public.v4_writer_feedback_events;
drop policy if exists track_c_tenant_update
  on public.v4_writer_feedback_events;
drop policy if exists track_c_writer_feedback_select
  on public.v4_writer_feedback_events;
drop policy if exists track_c_writer_feedback_insert
  on public.v4_writer_feedback_events;
drop policy if exists track_c_writer_feedback_update
  on public.v4_writer_feedback_events;

drop policy if exists track_c_tenant_delete
  on public.v4_learning_events;
drop policy if exists track_c_tenant_insert
  on public.v4_learning_events;
drop policy if exists track_c_tenant_select
  on public.v4_learning_events;
drop policy if exists track_c_tenant_update
  on public.v4_learning_events;

revoke all on table public.v4_writer_feedback_events
  from public, anon, authenticated;
revoke all on table public.v4_learning_events
  from public, anon, authenticated;
revoke all on table public.v4_sem_validation_events
  from public, anon, authenticated;

-- PostgREST upsert requires SELECT + INSERT + UPDATE. DELETE has no production
-- caller and is deliberately removed; the Writer-event immutability trigger
-- remains a second boundary for UPDATE and privileged maintenance paths.
revoke delete on table public.v4_learning_events from service_role;
grant select, insert, update on table public.v4_learning_events to service_role;

-- Build and validate the exact RESTRICT FK before removing the older NO ACTION
-- constraint. The validated temporary constraint keeps tenant lineage enforced
-- for the entire swap, including concurrent writes.
alter table public.v4_sem_validation_events
  drop constraint if exists v4_sem_validation_events_tenant_id_fkey_restrict;
alter table public.v4_sem_validation_events
  add constraint v4_sem_validation_events_tenant_id_fkey_restrict
  foreign key (tenant_id)
  references public.tenants(id)
  on delete restrict
  not valid;
alter table public.v4_sem_validation_events
  validate constraint v4_sem_validation_events_tenant_id_fkey_restrict;
alter table public.v4_sem_validation_events
  drop constraint if exists v4_sem_validation_events_tenant_id_fkey;
alter table public.v4_sem_validation_events
  rename constraint v4_sem_validation_events_tenant_id_fkey_restrict
  to v4_sem_validation_events_tenant_id_fkey;

-- Supabase owns storage.objects and grants its API roles the underlying table
-- privileges used by Storage. The product boundary is RLS default-deny plus
-- the exact service-only listing bucket policies, exposed here through a
-- narrowly scoped, service-role-only attestation RPC.
create or replace function public.track_c_storage_boundary_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := '{}'::jsonb;
  v_request_role text := '';
  v_snapshot jsonb;
begin
  begin
    v_claims := coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
      '{}'
    )::jsonb;
  exception
    when others then
      raise exception using
        errcode = '42501',
        message = 'track_c_storage_boundary_invalid_claims';
  end;

  v_request_role := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(v_claims ->> 'role', ''),
    ''
  );
  if v_request_role <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'track_c_storage_boundary_service_role_required';
  end if;

  select pg_catalog.jsonb_build_object(
    'meta', (
      select pg_catalog.jsonb_build_object(
        'contract_version', 'track_c_storage_boundary_snapshot_v1',
        'function_volatility', function_row.provolatile,
        'security_definer', function_row.prosecdef,
        'search_path', function_row.proconfig,
        'request_role', v_request_role
      )
      from pg_catalog.pg_proc function_row
      where function_row.oid =
        'public.track_c_storage_boundary_snapshot()'::pg_catalog.regprocedure
    ),
    'storage_objects', pg_catalog.to_regclass('storage.objects')::text,
    'storage_row_level_security', coalesce((
      select relation.relrowsecurity
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'storage'
        and relation.relname = 'objects'
        and relation.relkind in ('r', 'p')
    ), false),
    'storage_policies', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'policyname', policy.policyname,
          'roles', policy.roles::text[],
          'cmd', policy.cmd,
          'qual', policy.qual,
          'with_check', policy.with_check
        )
        order by policy.policyname
      )
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
    ), '[]'::jsonb)
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

revoke all on function public.track_c_storage_boundary_snapshot()
  from public, anon, authenticated;
grant execute on function public.track_c_storage_boundary_snapshot()
  to service_role;

notify pgrst, 'reload schema';

commit;
