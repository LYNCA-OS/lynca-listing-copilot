-- Additive canary primitive: a claimed job can acquire provider capacity only
-- after immutable preparation has completed. Existing claim RPCs are unchanged.

set lock_timeout = '5s';
set statement_timeout = '5min';

create or replace function public.acquire_v4_provider_capacity_for_job(
  p_job_id text,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_provider_id text default 'openai_legacy',
  p_provider_capacity integer default 2,
  p_per_key_concurrency integer default 2,
  p_provider_key_count integer default 1
)
returns table(
  acquired boolean,
  reason text,
  provider_capacity_slot integer,
  provider_key_slot integer,
  acquired_at timestamptz,
  existing boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_job public.v4_recognition_jobs%rowtype;
  provider_name text := coalesce(nullif(p_provider_id, ''), 'openai_legacy');
  worker_name text := coalesce(nullif(p_worker_id, ''), 'worker');
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
  key_count integer := greatest(1, least(coalesce(p_provider_key_count, 1), 50));
  per_key integer := greatest(1, least(coalesce(p_per_key_concurrency, 2), 8));
  capacity integer := greatest(1, least(coalesce(p_provider_capacity, 2), key_count * per_key, 96));
  slot_id integer;
  key_slot_id integer;
  acquired_time timestamptz;
begin
  if nullif(p_job_id, '') is null or nullif(p_worker_id, '') is null then
    return query select false, 'missing_job_or_worker', null::integer, null::integer, null::timestamptz, false;
    return;
  end if;

  select jobs.* into current_job
  from public.v4_recognition_jobs jobs
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and jobs.lease_owner = worker_name
    and jobs.lease_expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    return query select false, 'job_lease_not_live', null::integer, null::integer, null::timestamptz, false;
    return;
  end if;

  select leases.slot_no, leases.key_slot, leases.acquired_at
  into slot_id, key_slot_id, acquired_time
  from public.v4_provider_capacity_leases leases
  where leases.provider_id = provider_name
    and leases.job_id = current_job.id
    and leases.lease_owner = worker_name
    and leases.lease_expires_at > pg_catalog.clock_timestamp()
  limit 1;
  if slot_id is not null then
    return query select true, 'already_acquired', slot_id, key_slot_id, acquired_time, true;
    return;
  end if;

  insert into public.v4_provider_capacity_leases(provider_id, slot_no, key_slot, updated_at)
  select provider_name, generated.slot_no, ((generated.slot_no - 1) % key_count) + 1, pg_catalog.clock_timestamp()
  from pg_catalog.generate_series(1, capacity) as generated(slot_no)
  on conflict (provider_id, slot_no) do nothing;

  select leases.slot_no, ((leases.slot_no - 1) % key_count) + 1
  into slot_id, key_slot_id
  from public.v4_provider_capacity_leases leases
  where leases.provider_id = provider_name
    and leases.slot_no <= capacity
    and (leases.job_id is null or leases.lease_expires_at <= pg_catalog.clock_timestamp())
  order by leases.slot_no
  limit 1
  for update skip locked;
  if slot_id is null then
    return query select false, 'provider_capacity_unavailable', null::integer, null::integer, null::timestamptz, false;
    return;
  end if;

  acquired_time := pg_catalog.clock_timestamp();
  update public.v4_provider_capacity_leases leases
  set key_slot = key_slot_id,
      job_id = current_job.id,
      lease_owner = worker_name,
      lease_expires_at = least(current_job.lease_expires_at, acquired_time + pg_catalog.make_interval(secs => lease_seconds)),
      acquired_at = acquired_time,
      updated_at = acquired_time
  where leases.provider_id = provider_name and leases.slot_no = slot_id;

  update public.v4_recognition_jobs jobs
  set queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'provider_capacity_slot', slot_id,
        'provider_key_slot', key_slot_id,
        'provider_capacity', capacity,
        'provider_key_count', key_count,
        'provider_per_key_concurrency', per_key,
        'provider_capacity_lease_owner', worker_name,
        'provider_capacity_leased_at', acquired_time,
        'provider_capacity_assignment', 'late_provider_lease_v1'
      ),
      updated_at = acquired_time
  where jobs.id = current_job.id and jobs.lease_owner = worker_name;

  return query select true, 'acquired', slot_id, key_slot_id, acquired_time, false;
end;
$$;

revoke all on function public.acquire_v4_provider_capacity_for_job(text, text, integer, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_v4_provider_capacity_for_job(text, text, integer, text, integer, integer, integer)
  to service_role;;
