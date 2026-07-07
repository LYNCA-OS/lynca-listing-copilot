alter table if exists public.v4_recognition_jobs
  add column if not exists lane text not null default 'background',
  add column if not exists parent_job_id text,
  add column if not exists paired_job_id text,
  add column if not exists stage_result jsonb not null default '{}'::jsonb;

alter table if exists public.v4_recognition_sessions
  add column if not exists l1_status text not null default 'PENDING',
  add column if not exists l1_title text,
  add column if not exists l1_ready_at timestamptz,
  add column if not exists l1_route text,
  add column if not exists l1_timing jsonb not null default '{}'::jsonb,
  add column if not exists l2_status text not null default 'PENDING',
  add column if not exists l2_title text,
  add column if not exists l2_ready_at timestamptz,
  add column if not exists l2_route text,
  add column if not exists l2_timing jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'v4_recognition_jobs_lane_check'
  ) then
    alter table public.v4_recognition_jobs
      add constraint v4_recognition_jobs_lane_check
      check (lane in ('interactive', 'background'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'v4_recognition_sessions_l1_status_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_recognition_sessions_l1_status_check
      check (l1_status in ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SKIPPED'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'v4_recognition_sessions_l2_status_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_recognition_sessions_l2_status_check
      check (l2_status in ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SKIPPED'));
  end if;
end $$;

create index if not exists v4_recognition_jobs_lane_claim_idx
  on public.v4_recognition_jobs(lane, status, not_before, priority, created_at)
  where status in ('QUEUED', 'RETRYING');

create index if not exists v4_recognition_jobs_parent_idx
  on public.v4_recognition_jobs(parent_job_id);

create index if not exists v4_recognition_jobs_paired_idx
  on public.v4_recognition_jobs(paired_job_id);

create index if not exists v4_recognition_jobs_tenant_lane_idx
  on public.v4_recognition_jobs(tenant_id, lane, status, priority, created_at)
  where status in ('QUEUED', 'RETRYING', 'RUNNING');

drop function if exists public.claim_v4_recognition_jobs(integer, text, integer);

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
    where status in ('QUEUED', 'RETRYING')
      and not_before <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      and (p_lane is null or lane = p_lane)
      and (p_tenant_id is null or tenant_id = p_tenant_id)
    order by
      case when lane = 'interactive' then 0 else 1 end,
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
