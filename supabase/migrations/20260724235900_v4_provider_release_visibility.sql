-- Persist the provider-release boundary on the job itself. A recognition job
-- can remain RUNNING while resolver/renderer work continues after the scarce
-- provider slot has already been returned. Queue self-healing must distinguish
-- those states or it unnecessarily strands free provider capacity.

create or replace function public.release_v4_provider_capacity_for_job(
  p_job_id text,
  p_worker_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  released_count integer := 0;
  released_at timestamptz := pg_catalog.clock_timestamp();
begin
  update public.v4_provider_capacity_leases leases
  set job_id = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = released_at
  where leases.job_id = p_job_id
    and (p_worker_id is null or leases.lease_owner = p_worker_id);

  get diagnostics released_count = row_count;

  if released_count > 0 then
    update public.v4_recognition_jobs jobs
    set queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'provider_capacity_released', true,
          'provider_capacity_released_at', released_at
        ),
        updated_at = released_at
    where jobs.id = p_job_id;
  end if;

  return released_count;
end;
$$;

revoke all on function public.release_v4_provider_capacity_for_job(text, text) from public;
grant execute on function public.release_v4_provider_capacity_for_job(text, text) to service_role;
