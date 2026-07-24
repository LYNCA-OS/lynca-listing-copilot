-- Revert the experimental provider-release visibility behavior introduced by
-- 20260724235900. Two fixed cold-20 production runs showed no throughput gain,
-- so capacity release returns to the established single-owner lease mutation.

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
begin
  update public.v4_provider_capacity_leases leases
  set job_id = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where leases.job_id = p_job_id
    and (p_worker_id is null or leases.lease_owner = p_worker_id);

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.release_v4_provider_capacity_for_job(text, text) from public;
grant execute on function public.release_v4_provider_capacity_for_job(text, text) to service_role;
