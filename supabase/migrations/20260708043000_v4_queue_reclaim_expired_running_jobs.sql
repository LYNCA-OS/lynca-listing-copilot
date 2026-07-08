create index if not exists v4_recognition_jobs_reclaim_idx
  on public.v4_recognition_jobs(lane, status, lease_expires_at, not_before, priority, created_at)
  where status in ('QUEUED', 'RETRYING', 'RUNNING');

create or replace function public.claim_v4_recognition_jobs(
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 90,
  p_lane text default null,
  p_tenant_id text default null
)
returns setof public.v4_recognition_jobs
language plpgsql
as $$
begin
  return query
  with next_jobs as (
    select id
    from public.v4_recognition_jobs
    where (
        status in ('QUEUED', 'RETRYING')
        or (status = 'RUNNING' and lease_expires_at is not null and lease_expires_at < now())
      )
      and not_before <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      and (p_lane is null or lane = p_lane)
      and (p_tenant_id is null or tenant_id = p_tenant_id)
    order by
      case when lane = 'interactive' then 0 else 1 end,
      case when status = 'RUNNING' then 0 else 1 end,
      priority asc,
      created_at asc
    limit greatest(1, least(coalesce(p_limit, 1), 25))
    for update skip locked
  )
  update public.v4_recognition_jobs jobs
  set status = 'RUNNING',
      lease_owner = coalesce(nullif(p_worker_id, ''), 'worker'),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 900))),
      started_at = coalesce(jobs.started_at, now()),
      attempt_count = jobs.attempt_count + 1,
      updated_at = now()
  from next_jobs
  where jobs.id = next_jobs.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_v4_recognition_jobs(integer, text, integer, text, text) from public;
grant execute on function public.claim_v4_recognition_jobs(integer, text, integer, text, text) to service_role;
