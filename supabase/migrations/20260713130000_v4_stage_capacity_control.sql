-- Global capacity leases for non-LLM stages. The existing lease table already
-- provides the right durable primitive; stage ids use a separate namespace so
-- OCR capacity can scale independently from the GPT provider pool.

create or replace function public.acquire_v4_stage_capacity(
  p_stage_id text,
  p_job_id text,
  p_lease_owner text default 'stage_worker',
  p_capacity integer default 1,
  p_lease_seconds integer default 90
)
returns integer
language plpgsql
as $$
declare
  stage_name text := 'stage:' || coalesce(nullif(trim(p_stage_id), ''), 'unknown');
  job_name text := coalesce(nullif(trim(p_job_id), ''), gen_random_uuid()::text);
  owner_name text := coalesce(nullif(trim(p_lease_owner), ''), 'stage_worker');
  stage_capacity integer := greatest(1, least(coalesce(p_capacity, 1), 64));
  lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 90), 900));
  acquired_slot integer;
begin
  insert into public.v4_provider_capacity_leases(provider_id, slot_no, key_slot, updated_at)
  select stage_name, slot_no, slot_no, clock_timestamp()
  from generate_series(1, stage_capacity) as slot_no
  on conflict (provider_id, slot_no) do update
  set key_slot = excluded.key_slot,
      updated_at = excluded.updated_at
  where public.v4_provider_capacity_leases.job_id is null
     or public.v4_provider_capacity_leases.lease_expires_at <= clock_timestamp();

  select leases.slot_no
  into acquired_slot
  from public.v4_provider_capacity_leases leases
  where leases.provider_id = stage_name
    and leases.slot_no <= stage_capacity
    and leases.job_id = job_name
    and leases.lease_owner = owner_name
    and leases.lease_expires_at > clock_timestamp()
  order by leases.slot_no
  limit 1
  for update;

  if acquired_slot is not null then
    update public.v4_provider_capacity_leases
    set lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
        updated_at = clock_timestamp()
    where provider_id = stage_name and slot_no = acquired_slot;
    return acquired_slot;
  end if;

  select leases.slot_no
  into acquired_slot
  from public.v4_provider_capacity_leases leases
  where leases.provider_id = stage_name
    and leases.slot_no <= stage_capacity
    and (leases.job_id is null or leases.lease_expires_at <= clock_timestamp())
  order by leases.slot_no
  limit 1
  for update skip locked;

  if acquired_slot is null then
    return null;
  end if;

  update public.v4_provider_capacity_leases
  set job_id = job_name,
      lease_owner = owner_name,
      lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
      acquired_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where provider_id = stage_name and slot_no = acquired_slot;

  return acquired_slot;
end;
$$;

create or replace function public.release_v4_stage_capacity(
  p_stage_id text,
  p_job_id text,
  p_lease_owner text default null
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
      acquired_at = null,
      updated_at = clock_timestamp()
  where leases.provider_id = 'stage:' || coalesce(nullif(trim(p_stage_id), ''), 'unknown')
    and leases.job_id = p_job_id
    and (p_lease_owner is null or leases.lease_owner = p_lease_owner);

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.acquire_v4_stage_capacity(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_v4_stage_capacity(text, text, text) from public, anon, authenticated;
grant execute on function public.acquire_v4_stage_capacity(text, text, text, integer, integer) to service_role;
grant execute on function public.release_v4_stage_capacity(text, text, text) to service_role;
