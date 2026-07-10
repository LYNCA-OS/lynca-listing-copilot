create table if not exists public.v4_provider_capacity_leases (
  provider_id text not null,
  slot_no integer not null,
  key_slot integer not null,
  job_id text,
  lease_owner text,
  lease_expires_at timestamptz,
  acquired_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider_id, slot_no),
  constraint v4_provider_capacity_slot_positive check (slot_no > 0 and key_slot > 0)
);

create index if not exists v4_provider_capacity_available_idx
  on public.v4_provider_capacity_leases(provider_id, lease_expires_at, slot_no);

alter table public.v4_provider_capacity_leases enable row level security;

create table if not exists public.v4_queue_kick_leases (
  scope text primary key,
  lease_owner text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.v4_queue_kick_leases enable row level security;

revoke all on table public.v4_provider_capacity_leases from public, anon, authenticated;
revoke all on table public.v4_queue_kick_leases from public, anon, authenticated;
grant select, insert, update, delete on table public.v4_provider_capacity_leases to service_role;
grant select, insert, update, delete on table public.v4_queue_kick_leases to service_role;

create or replace function public.try_acquire_v4_queue_kick(
  p_scope text default 'global',
  p_lease_owner text default 'enqueue',
  p_lease_ms integer default 1200
)
returns boolean
language plpgsql
as $$
declare
  acquired boolean := false;
  lease_ms integer := greatest(250, least(coalesce(p_lease_ms, 1200), 30000));
begin
  insert into public.v4_queue_kick_leases(scope, lease_owner, lease_expires_at, updated_at)
  values (
    coalesce(nullif(p_scope, ''), 'global'),
    coalesce(nullif(p_lease_owner, ''), 'enqueue'),
    clock_timestamp() + make_interval(secs => lease_ms::double precision / 1000.0),
    clock_timestamp()
  )
  on conflict (scope) do update
  set lease_owner = excluded.lease_owner,
      lease_expires_at = excluded.lease_expires_at,
      updated_at = excluded.updated_at
  where public.v4_queue_kick_leases.lease_expires_at <= clock_timestamp()
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.claim_v4_recognition_jobs_with_capacity(
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 120,
  p_lane text default null,
  p_tenant_id text default null,
  p_provider_id text default 'openai_legacy',
  p_provider_capacity integer default 2,
  p_per_key_concurrency integer default 2
)
returns setof public.v4_recognition_jobs
language plpgsql
as $$
declare
  provider_name text := coalesce(nullif(p_provider_id, ''), 'openai_legacy');
  worker_name text := coalesce(nullif(p_worker_id, ''), 'worker');
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
  provider_capacity integer := greatest(1, least(coalesce(p_provider_capacity, 2), 96));
  per_key_concurrency integer := greatest(1, least(coalesce(p_per_key_concurrency, 2), 8));
  claim_limit integer := greatest(1, least(coalesce(p_limit, 1), 25));
  slot_ids integer[] := array[]::integer[];
  key_slots integer[] := array[]::integer[];
  job_ids text[] := array[]::text[];
  item_count integer := 0;
  item_index integer;
begin
  insert into public.v4_provider_capacity_leases(provider_id, slot_no, key_slot, updated_at)
  select
    provider_name,
    slot_no,
    ((slot_no - 1) / per_key_concurrency) + 1,
    clock_timestamp()
  from generate_series(1, provider_capacity) as slot_no
  on conflict (provider_id, slot_no) do update
  set key_slot = excluded.key_slot,
      updated_at = excluded.updated_at
  where public.v4_provider_capacity_leases.job_id is null
     or public.v4_provider_capacity_leases.lease_expires_at <= clock_timestamp();

  select
    coalesce(array_agg(available.slot_no order by available.slot_no), array[]::integer[]),
    coalesce(array_agg(available.key_slot order by available.slot_no), array[]::integer[])
  into slot_ids, key_slots
  from (
    select leases.slot_no, leases.key_slot
    from public.v4_provider_capacity_leases leases
    where leases.provider_id = provider_name
      and leases.slot_no <= provider_capacity
      and (leases.job_id is null or leases.lease_expires_at <= clock_timestamp())
    order by leases.slot_no
    limit claim_limit
    for update skip locked
  ) available;

  if cardinality(slot_ids) = 0 then
    return;
  end if;

  with ranked as materialized (
    select
      jobs.id,
      jobs.lane,
      jobs.priority,
      jobs.created_at,
      row_number() over (
        partition by coalesce(nullif(jobs.batch_id, ''), nullif(jobs.tenant_id, ''), jobs.id)
        order by jobs.priority asc, jobs.created_at asc
      ) as tenant_rank
    from public.v4_recognition_jobs jobs
    where (
        jobs.status in ('QUEUED', 'RETRYING')
        or (jobs.status = 'RUNNING' and jobs.lease_expires_at is not null and jobs.lease_expires_at < clock_timestamp())
      )
      and jobs.not_before <= clock_timestamp()
      and (jobs.lease_expires_at is null or jobs.lease_expires_at < clock_timestamp())
      and (p_lane is null or jobs.lane = p_lane)
      and (p_tenant_id is null or jobs.tenant_id = p_tenant_id)
      and coalesce(nullif(jobs.provider_id, ''), 'openai_legacy') = provider_name
  ), locked as (
    select
      jobs.id,
      case when jobs.lane = 'interactive' then 0 else 1 end as lane_order,
      ranked.tenant_rank,
      jobs.priority,
      jobs.created_at
    from public.v4_recognition_jobs jobs
    join ranked on ranked.id = jobs.id
    order by
      case when jobs.lane = 'interactive' then 0 else 1 end,
      ranked.tenant_rank,
      jobs.priority,
      jobs.created_at
    limit cardinality(slot_ids)
    for update of jobs skip locked
  )
  select coalesce(
    array_agg(
      locked.id
      order by locked.lane_order, locked.tenant_rank, locked.priority, locked.created_at
    ),
    array[]::text[]
  )
  into job_ids
  from locked;

  item_count := least(cardinality(slot_ids), cardinality(job_ids));
  if item_count = 0 then
    return;
  end if;

  for item_index in 1..item_count loop
    update public.v4_provider_capacity_leases leases
    set job_id = job_ids[item_index],
        lease_owner = worker_name,
        lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
        acquired_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where leases.provider_id = provider_name
      and leases.slot_no = slot_ids[item_index];

    update public.v4_recognition_jobs jobs
    set status = 'RUNNING',
        lease_owner = worker_name,
        lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
        started_at = coalesce(jobs.started_at, clock_timestamp()),
        attempt_count = jobs.attempt_count + 1,
        queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb) || jsonb_build_object(
          'provider_capacity_slot', slot_ids[item_index],
          'provider_key_slot', key_slots[item_index],
          'provider_capacity', provider_capacity,
          'provider_per_key_concurrency', per_key_concurrency,
          'provider_capacity_lease_owner', worker_name,
          'provider_capacity_leased_at', clock_timestamp()
        ),
        updated_at = clock_timestamp()
    where jobs.id = job_ids[item_index];
  end loop;

  return query
  select jobs.*
  from public.v4_recognition_jobs jobs
  where jobs.id = any(job_ids[1:item_count])
  order by array_position(job_ids[1:item_count], jobs.id);
end;
$$;

create or replace function public.release_v4_provider_capacity_for_job(
  p_job_id text,
  p_worker_id text default null
)
returns integer
language plpgsql
as $$
declare
  released_count integer := 0;
begin
  update public.v4_provider_capacity_leases leases
  set job_id = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where leases.job_id = p_job_id
    and (p_worker_id is null or leases.lease_owner = p_worker_id);

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.try_acquire_v4_queue_kick(text, text, integer) from public;
grant execute on function public.try_acquire_v4_queue_kick(text, text, integer) to service_role;

revoke all on function public.claim_v4_recognition_jobs_with_capacity(integer, text, integer, text, text, text, integer, integer) from public;
grant execute on function public.claim_v4_recognition_jobs_with_capacity(integer, text, integer, text, text, text, integer, integer) to service_role;

revoke all on function public.release_v4_provider_capacity_for_job(text, text) from public;
grant execute on function public.release_v4_provider_capacity_for_job(text, text) to service_role;
