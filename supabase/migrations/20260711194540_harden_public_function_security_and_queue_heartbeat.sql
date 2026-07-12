create or replace function public.heartbeat_v4_recognition_job(
  p_job_id text,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  heartbeat_applied boolean := false;
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 900));
  next_expiry timestamptz := clock_timestamp() + make_interval(secs => lease_seconds);
begin
  if nullif(btrim(p_job_id), '') is null or nullif(btrim(p_worker_id), '') is null then
    return false;
  end if;

  update public.v4_recognition_jobs jobs
  set lease_expires_at = next_expiry,
      updated_at = clock_timestamp()
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and jobs.lease_owner = p_worker_id
  returning true into heartbeat_applied;

  if coalesce(heartbeat_applied, false) then
    update public.v4_provider_capacity_leases leases
    set lease_expires_at = next_expiry,
        updated_at = clock_timestamp()
    where leases.job_id = p_job_id
      and leases.lease_owner = p_worker_id;
  end if;

  return coalesce(heartbeat_applied, false);
end;
$$;

-- Every function in public is an internal server-side primitive. Postgres grants
-- EXECUTE to PUBLIC by default, so lock both existing and future functions down.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- A fixed search path prevents mutable-search-path warnings and keeps invoker
-- functions from resolving attacker-controlled objects first.
do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, extensions',
      function_signature
    );
  end loop;
end;
$$;

-- These indexes have identical definitions. Keep the established short name.
drop index if exists public.catalog_cards_players_gin_idx;
