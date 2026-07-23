create index if not exists v4_provider_capacity_active_job_idx
  on public.v4_provider_capacity_leases (job_id, lease_owner)
  where job_id is not null;

create index if not exists preingestion_jobs_status_type_priority_idx
  on public.preingestion_jobs (status, job_type, priority, created_at);

create or replace function public.release_v4_provider_capacity_for_job(
  p_job_id text,
  p_worker_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  released_count integer := 0;
  pruned_count integer := 0;
begin
  with released as (
    update public.v4_provider_capacity_leases leases
    set job_id = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where leases.job_id = p_job_id
      and (p_worker_id is null or leases.lease_owner = p_worker_id)
    returning leases.provider_id, leases.slot_no
  ), pruned as (
    delete from public.v4_provider_capacity_leases leases
    using released
    where leases.provider_id = released.provider_id
      and leases.slot_no = released.slot_no
      and pg_catalog.left(leases.provider_id, pg_catalog.length('stage:paddle_ocr:asset:')) = 'stage:paddle_ocr:asset:'
      and leases.job_id is null
      and leases.lease_owner is null
      and leases.lease_expires_at is null
    returning 1
  )
  select pg_catalog.count(*), (select pg_catalog.count(*) from pruned)
  into released_count, pruned_count
  from released;

  return released_count;
end;
$function$;

revoke all on function public.release_v4_provider_capacity_for_job(text, text) from public;
grant execute on function public.release_v4_provider_capacity_for_job(text, text) to service_role;

delete from public.v4_provider_capacity_leases leases
where pg_catalog.left(leases.provider_id, pg_catalog.length('stage:paddle_ocr:asset:')) = 'stage:paddle_ocr:asset:'
  and leases.job_id is null
  and leases.lease_owner is null
  and leases.lease_expires_at is null;
