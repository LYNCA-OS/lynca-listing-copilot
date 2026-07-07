create table if not exists public.v4_recognition_jobs (
  id text primary key,
  schema_version text not null,
  batch_id text,
  tenant_id text,
  operator_id text,
  asset_id text,
  recognition_session_id text references public.v4_recognition_sessions(id) on delete set null,
  job_type text not null default 'listing_title',
  provider_id text not null default 'openai_legacy',
  status text not null default 'QUEUED',
  priority integer not null default 100,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error jsonb not null default '{}'::jsonb,
  timing jsonb not null default '{}'::jsonb,
  queue_tags jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 2,
  lease_owner text,
  lease_expires_at timestamptz,
  not_before timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v4_recognition_jobs_status_check check (
    status in ('QUEUED', 'RETRYING', 'RUNNING', 'L1_READY', 'L2_READY', 'FAILED', 'CANCELLED')
  ),
  constraint v4_recognition_jobs_attempts_check check (attempt_count >= 0 and max_attempts >= 1),
  constraint v4_recognition_jobs_priority_check check (priority >= 0)
);

create index if not exists v4_recognition_jobs_claim_idx
  on public.v4_recognition_jobs(status, not_before, priority, created_at)
  where status in ('QUEUED', 'RETRYING');

create index if not exists v4_recognition_jobs_batch_idx
  on public.v4_recognition_jobs(batch_id, created_at desc);

create index if not exists v4_recognition_jobs_session_idx
  on public.v4_recognition_jobs(recognition_session_id);

create index if not exists v4_recognition_jobs_lease_idx
  on public.v4_recognition_jobs(lease_owner, lease_expires_at)
  where status = 'RUNNING';

alter table if exists public.v4_recognition_jobs enable row level security;

create or replace function public.claim_v4_recognition_jobs(
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 90
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
    order by priority asc, created_at asc
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

revoke all on function public.claim_v4_recognition_jobs(integer, text, integer) from public;
grant execute on function public.claim_v4_recognition_jobs(integer, text, integer) to service_role;
