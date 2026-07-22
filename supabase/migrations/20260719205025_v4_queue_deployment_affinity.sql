-- Candidate deployments share the production queue table, but must never
-- share workers. Untagged jobs remain production-compatible; tagged Preview
-- jobs are visible only while the matching claim wrapper sets a transaction-
-- local deployment affinity.

set lock_timeout = '5s';
set statement_timeout = '5min';

do $migration$
declare
  target_oid oid;
  definition text;
  needle text;
  replacement text;
begin
  select p.oid into target_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'claim_v4_recognition_jobs'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_limit integer, p_worker_id text, p_lease_seconds integer, p_lane text, p_tenant_id text';
  if target_oid is null then raise exception 'claim_v4_recognition_jobs signature missing'; end if;
  definition := pg_catalog.pg_get_functiondef(target_oid);
  needle := '      and (p_tenant_id is null or jobs.tenant_id = p_tenant_id)';
  replacement := needle || E'\n      and (case\n        when nullif(pg_catalog.current_setting(''lynca.deployment_affinity'', true), '''') is null\n          then nullif(jobs.queue_tags ->> ''deployment_affinity'', '''') is null\n        else jobs.queue_tags ->> ''deployment_affinity'' = pg_catalog.current_setting(''lynca.deployment_affinity'', true)\n      end)';
  if pg_catalog.strpos(definition, needle) = 0 then raise exception 'legacy affinity insertion point missing'; end if;
  execute pg_catalog.replace(definition, needle, replacement);

  select p.oid into target_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'claim_v4_recognition_jobs_with_balanced_capacity'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_limit integer, p_worker_id text, p_lease_seconds integer, p_lane text, p_tenant_id text, p_provider_id text, p_provider_capacity integer, p_per_key_concurrency integer, p_provider_key_count integer';
  if target_oid is null then raise exception 'balanced claim signature missing'; end if;
  definition := pg_catalog.pg_get_functiondef(target_oid);
  needle := '        and coalesce(nullif(jobs.provider_id, ''''), ''openai_legacy'') = provider_name';
  replacement := E'        and (case\n          when nullif(pg_catalog.current_setting(''lynca.deployment_affinity'', true), '''') is null\n            then nullif(jobs.queue_tags ->> ''deployment_affinity'', '''') is null\n          else jobs.queue_tags ->> ''deployment_affinity'' = pg_catalog.current_setting(''lynca.deployment_affinity'', true)\n        end)\n' || needle;
  if pg_catalog.strpos(definition, needle) = 0 then raise exception 'balanced affinity insertion point missing'; end if;
  execute pg_catalog.replace(definition, needle, replacement);
end
$migration$;

create or replace function public.claim_v4_recognition_jobs_for_deployment(
  p_deployment_affinity text,
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 120,
  p_lane text default null,
  p_tenant_id text default null
)
returns setof public.v4_recognition_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(p_deployment_affinity, '') is null then
    raise exception 'deployment affinity is required';
  end if;
  perform pg_catalog.set_config('lynca.deployment_affinity', p_deployment_affinity, true);
  return query select * from public.claim_v4_recognition_jobs(
    p_limit, p_worker_id, p_lease_seconds, p_lane, p_tenant_id
  );
end;
$$;

create or replace function public.claim_v4_recognition_jobs_with_balanced_capacity_for_deployment(
  p_deployment_affinity text,
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 120,
  p_lane text default null,
  p_tenant_id text default null,
  p_provider_id text default 'openai_legacy',
  p_provider_capacity integer default 2,
  p_per_key_concurrency integer default 2,
  p_provider_key_count integer default 1
)
returns setof public.v4_recognition_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(p_deployment_affinity, '') is null then
    raise exception 'deployment affinity is required';
  end if;
  perform pg_catalog.set_config('lynca.deployment_affinity', p_deployment_affinity, true);
  return query select * from public.claim_v4_recognition_jobs_with_balanced_capacity(
    p_limit, p_worker_id, p_lease_seconds, p_lane, p_tenant_id,
    p_provider_id, p_provider_capacity, p_per_key_concurrency, p_provider_key_count
  );
end;
$$;

revoke all on function public.claim_v4_recognition_jobs_for_deployment(text, integer, text, integer, text, text) from public;
grant execute on function public.claim_v4_recognition_jobs_for_deployment(text, integer, text, integer, text, text) to service_role;
revoke all on function public.claim_v4_recognition_jobs_with_balanced_capacity_for_deployment(text, integer, text, integer, text, text, text, integer, integer, integer) from public;
grant execute on function public.claim_v4_recognition_jobs_with_balanced_capacity_for_deployment(text, integer, text, integer, text, text, text, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
