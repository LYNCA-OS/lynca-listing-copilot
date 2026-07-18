-- Remove the shared-row write hotspot from provider/stage capacity admission
-- and add a tenant-scoped, idempotent recovery transition for stalled jobs.

set lock_timeout = '5s';
set statement_timeout = '5min';

create or replace function public.claim_v4_recognition_jobs_with_balanced_capacity(
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
declare
  provider_name text := coalesce(nullif(p_provider_id, ''), 'openai_legacy');
  worker_name text := coalesce(nullif(p_worker_id, ''), 'worker');
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
  per_key_concurrency integer := greatest(1, least(coalesce(p_per_key_concurrency, 2), 8));
  provider_key_count integer := greatest(1, least(coalesce(p_provider_key_count, 1), 50));
  provider_capacity integer := greatest(
    1,
    least(coalesce(p_provider_capacity, 2), provider_key_count * per_key_concurrency, 96)
  );
  claim_limit integer := greatest(1, least(coalesce(p_limit, 1), 25));
  item_index integer;
  slot_id integer;
  key_slot_id integer;
  candidate_job_id text;
  prior_status text;
  attempt_ready_at timestamptz;
  claimed_at timestamptz;
  claimed_job public.v4_recognition_jobs%rowtype;
begin
  perform public.finalize_exhausted_v4_recognition_jobs();

  -- Existing claims used DO UPDATE here. Every pump therefore wrote the same
  -- two provider rows before it could even look for work, serializing otherwise
  -- independent workers. Slot metadata is immutable at admission; the dynamic
  -- key assignment is written only when a slot is actually leased.
  insert into public.v4_provider_capacity_leases(provider_id, slot_no, key_slot, updated_at)
  select
    provider_name,
    generated.slot_no,
    ((generated.slot_no - 1) % provider_key_count) + 1,
    pg_catalog.clock_timestamp()
  from pg_catalog.generate_series(1, provider_capacity) as generated(slot_no)
  on conflict (provider_id, slot_no) do nothing;

  for item_index in 1..least(claim_limit, provider_capacity) loop
    slot_id := null;
    key_slot_id := null;
    candidate_job_id := null;

    select
      leases.slot_no,
      ((leases.slot_no - 1) % provider_key_count) + 1
    into slot_id, key_slot_id
    from public.v4_provider_capacity_leases leases
    where leases.provider_id = provider_name
      and leases.slot_no <= provider_capacity
      and (leases.job_id is null or leases.lease_expires_at <= pg_catalog.clock_timestamp())
    order by leases.slot_no
    limit 1
    for update skip locked;

    if slot_id is null then
      return;
    end if;

    with ranked as materialized (
      select
        jobs.id,
        pg_catalog.row_number() over (
          partition by coalesce(nullif(jobs.tenant_id, ''), nullif(jobs.batch_id, ''), jobs.id)
          order by jobs.priority asc, jobs.created_at asc
        ) as tenant_rank
      from public.v4_recognition_jobs jobs
      where (
          jobs.status in ('QUEUED', 'RETRYING')
          or (
            jobs.status = 'RUNNING'
            and jobs.lease_expires_at is not null
            and jobs.lease_expires_at < pg_catalog.clock_timestamp()
          )
        )
        and jobs.attempt_count < jobs.max_attempts
        and jobs.not_before <= pg_catalog.clock_timestamp()
        and (jobs.lease_expires_at is null or jobs.lease_expires_at < pg_catalog.clock_timestamp())
        and (p_lane is null or jobs.lane = p_lane)
        and (p_tenant_id is null or jobs.tenant_id = p_tenant_id)
        and coalesce(nullif(jobs.provider_id, ''), 'openai_legacy') = provider_name
    )
    select jobs.id
    into candidate_job_id
    from public.v4_recognition_jobs jobs
    join ranked on ranked.id = jobs.id
    order by
      case when jobs.lane = 'interactive' then 0 else 1 end,
      ranked.tenant_rank,
      jobs.priority,
      jobs.created_at
    limit 1
    for update of jobs skip locked;

    if candidate_job_id is null then
      return;
    end if;

    select jobs.status, jobs.not_before
    into prior_status, attempt_ready_at
    from public.v4_recognition_jobs jobs
    where jobs.id = candidate_job_id;

    claimed_at := pg_catalog.clock_timestamp();
    update public.v4_provider_capacity_leases leases
    set key_slot = key_slot_id,
        job_id = candidate_job_id,
        lease_owner = worker_name,
        lease_expires_at = claimed_at + pg_catalog.make_interval(secs => lease_seconds),
        acquired_at = claimed_at,
        updated_at = claimed_at
    where leases.provider_id = provider_name
      and leases.slot_no = slot_id;

    update public.v4_recognition_jobs jobs
    set status = 'RUNNING',
        lease_owner = worker_name,
        lease_expires_at = claimed_at + pg_catalog.make_interval(secs => lease_seconds),
        started_at = coalesce(jobs.started_at, claimed_at),
        attempt_count = jobs.attempt_count + 1,
        queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'provider_capacity_slot', slot_id,
          'provider_key_slot', key_slot_id,
          'provider_capacity', provider_capacity,
          'provider_key_count', provider_key_count,
          'provider_per_key_concurrency', per_key_concurrency,
          'provider_key_assignment', 'balanced_round_robin_v2',
          'provider_capacity_lease_owner', worker_name,
          'provider_capacity_leased_at', claimed_at,
          'scheduling_fairness_scope', case
            when nullif(jobs.tenant_id, '') is not null then 'tenant'
            when nullif(jobs.batch_id, '') is not null then 'batch'
            else 'job'
          end,
          'scheduling_fairness_key', coalesce(nullif(jobs.tenant_id, ''), nullif(jobs.batch_id, ''), jobs.id)
        ),
        updated_at = claimed_at
    where jobs.id = candidate_job_id
      and jobs.attempt_count < jobs.max_attempts
    returning jobs.* into claimed_job;

    if not found then
      update public.v4_provider_capacity_leases leases
      set job_id = null,
          lease_owner = null,
          lease_expires_at = null,
          updated_at = pg_catalog.clock_timestamp()
      where leases.provider_id = provider_name
        and leases.slot_no = slot_id
        and leases.job_id = candidate_job_id;
      continue;
    end if;

    insert into public.job_attempt_events (
      tenant_id, batch_id, job_id, session_id, attempt_no, event_type,
      physical_status, canonical_status, recoverable, provider, metadata, occurred_at
    ) values (
      coalesce(nullif(claimed_job.tenant_id, ''), 'tenant_legacy'),
      claimed_job.batch_id,
      claimed_job.id,
      claimed_job.recognition_session_id,
      claimed_job.attempt_count,
      'ATTEMPT_STARTED',
      'RUNNING',
      'RUNNING',
      null,
      claimed_job.provider_id,
      pg_catalog.jsonb_build_object(
        'previous_physical_status', prior_status,
        'attempt_ready_at', attempt_ready_at,
        'lease_seconds', lease_seconds,
        'provider_capacity_slot', slot_id,
        'provider_key_slot', key_slot_id
      ),
      claimed_at
    );

    return next claimed_job;
  end loop;
  return;
end;
$$;

create or replace function public.acquire_v4_stage_capacity(
  p_stage_id text,
  p_job_id text,
  p_lease_owner text default 'stage_worker',
  p_capacity integer default 1,
  p_lease_seconds integer default 90
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  stage_name text := 'stage:' || coalesce(nullif(pg_catalog.btrim(p_stage_id), ''), 'unknown');
  job_name text := coalesce(nullif(pg_catalog.btrim(p_job_id), ''), gen_random_uuid()::text);
  owner_name text := coalesce(nullif(pg_catalog.btrim(p_lease_owner), ''), 'stage_worker');
  stage_capacity integer := greatest(1, least(coalesce(p_capacity, 1), 64));
  lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 90), 900));
  acquired_slot integer;
begin
  insert into public.v4_provider_capacity_leases(provider_id, slot_no, key_slot, updated_at)
  select stage_name, generated.slot_no, generated.slot_no, pg_catalog.clock_timestamp()
  from pg_catalog.generate_series(1, stage_capacity) as generated(slot_no)
  on conflict (provider_id, slot_no) do nothing;

  select leases.slot_no
  into acquired_slot
  from public.v4_provider_capacity_leases leases
  where leases.provider_id = stage_name
    and leases.slot_no <= stage_capacity
    and leases.job_id = job_name
    and leases.lease_owner = owner_name
    and leases.lease_expires_at > pg_catalog.clock_timestamp()
  order by leases.slot_no
  limit 1
  for update;

  if acquired_slot is not null then
    update public.v4_provider_capacity_leases
    set lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
        updated_at = pg_catalog.clock_timestamp()
    where provider_id = stage_name and slot_no = acquired_slot;
    return acquired_slot;
  end if;

  select leases.slot_no
  into acquired_slot
  from public.v4_provider_capacity_leases leases
  where leases.provider_id = stage_name
    and leases.slot_no <= stage_capacity
    and (leases.job_id is null or leases.lease_expires_at <= pg_catalog.clock_timestamp())
  order by leases.slot_no
  limit 1
  for update skip locked;

  if acquired_slot is null then
    return null;
  end if;

  update public.v4_provider_capacity_leases
  set job_id = job_name,
      lease_owner = owner_name,
      lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      acquired_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where provider_id = stage_name and slot_no = acquired_slot;

  return acquired_slot;
end;
$$;

create or replace function public.request_v4_recognition_job_recovery(
  p_job_id text,
  p_tenant_id text,
  p_requested_by_user_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_job public.v4_recognition_jobs%rowtype;
  recovered_job public.v4_recognition_jobs%rowtype;
  recovery_at timestamptz := pg_catalog.clock_timestamp();
  recovery_action text;
  canonical_status text;
begin
  if nullif(pg_catalog.btrim(p_job_id), '') is null
    or nullif(pg_catalog.btrim(p_tenant_id), '') is null then
    return pg_catalog.jsonb_build_object('action', 'INVALID_REQUEST');
  end if;

  -- Capacity rows are always locked before job rows. This matches the claim
  -- transaction and prevents a manual recovery from introducing a lock-order
  -- inversion under load.
  perform 1
  from public.v4_provider_capacity_leases leases
  where leases.job_id = p_job_id
  order by leases.provider_id, leases.slot_no
  for update;

  select jobs.*
  into current_job
  from public.v4_recognition_jobs jobs
  where jobs.id = p_job_id
    and jobs.tenant_id = p_tenant_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('action', 'NOT_FOUND');
  end if;

  if current_job.status in ('L1_READY', 'L2_READY', 'FAILED', 'CANCELLED') then
    return pg_catalog.jsonb_build_object(
      'action', 'TERMINAL_REQUIRES_FRESH_ENQUEUE',
      'job_id', current_job.id,
      'job_status', current_job.status
    );
  end if;

  if current_job.status = 'RUNNING'
    and current_job.lease_expires_at is not null
    and current_job.lease_expires_at > recovery_at then
    return pg_catalog.jsonb_build_object(
      'action', 'ALREADY_RUNNING',
      'job_id', current_job.id,
      'job_status', current_job.status,
      'lease_expires_at', current_job.lease_expires_at
    );
  end if;

  if current_job.attempt_count >= current_job.max_attempts then
    update public.v4_recognition_jobs jobs
    set status = 'FAILED',
        completed_at = recovery_at,
        lease_owner = null,
        lease_expires_at = null,
        error = coalesce(jobs.error, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'message', 'manual_recovery_attempts_exhausted',
          'code', 'MANUAL_RECOVERY_ATTEMPTS_EXHAUSTED',
          'retryable', false,
          'failed_at', recovery_at
        ),
        queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb)
          - 'provider_capacity_slot' - 'provider_key_slot'
          - 'provider_capacity_lease_owner' - 'provider_capacity_leased_at'
          || pg_catalog.jsonb_build_object(
            'manual_recovery_requested_at', recovery_at,
            'manual_recovery_requested_by_user_id', p_requested_by_user_id
          ),
        updated_at = recovery_at
    where jobs.id = current_job.id
    returning jobs.* into recovered_job;
    recovery_action := 'TERMINAL_REQUIRES_FRESH_ENQUEUE';
    canonical_status := 'FAILED_FINAL';
  else
    recovery_action := case
      when current_job.status = 'RUNNING' then 'REQUEUED_EXPIRED_LEASE'
      else 'REPRIORITIZED'
    end;
    update public.v4_recognition_jobs jobs
    set status = case when current_job.status = 'RUNNING' then 'RETRYING' else jobs.status end,
        priority = 0,
        not_before = recovery_at,
        completed_at = null,
        lease_owner = null,
        lease_expires_at = null,
        queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb)
          - 'provider_capacity_slot' - 'provider_key_slot'
          - 'provider_capacity_lease_owner' - 'provider_capacity_leased_at'
          || pg_catalog.jsonb_build_object(
            'manual_recovery_requested_at', recovery_at,
            'manual_recovery_requested_by_user_id', p_requested_by_user_id,
            'manual_recovery_action', recovery_action
          ),
        updated_at = recovery_at
    where jobs.id = current_job.id
    returning jobs.* into recovered_job;
    canonical_status := case when recovered_job.status = 'RETRYING' then 'RETRYABLE_FAILED' else 'QUEUED' end;
  end if;

  update public.v4_provider_capacity_leases leases
  set job_id = null,
      lease_owner = null,
      lease_expires_at = null,
      acquired_at = null,
      updated_at = recovery_at
  where leases.job_id = current_job.id;

  insert into public.job_attempt_events (
    tenant_id, batch_id, job_id, session_id, attempt_no, event_type,
    physical_status, canonical_status, recoverable, provider, metadata, occurred_at
  ) values (
    coalesce(nullif(recovered_job.tenant_id, ''), 'tenant_legacy'),
    recovered_job.batch_id,
    recovered_job.id,
    recovered_job.recognition_session_id,
    recovered_job.attempt_count,
    case recovery_action
      when 'REQUEUED_EXPIRED_LEASE' then 'MANUAL_RECOVERY_REQUEUED'
      when 'REPRIORITIZED' then 'MANUAL_RECOVERY_REPRIORITIZED'
      else 'MANUAL_RECOVERY_EXHAUSTED'
    end,
    recovered_job.status,
    canonical_status,
    recovery_action <> 'TERMINAL_REQUIRES_FRESH_ENQUEUE',
    recovered_job.provider_id,
    pg_catalog.jsonb_build_object(
      'requested_by_user_id', p_requested_by_user_id,
      'previous_status', current_job.status,
      'previous_lease_owner', current_job.lease_owner,
      'previous_lease_expires_at', current_job.lease_expires_at,
      'priority', recovered_job.priority
    ),
    recovery_at
  );

  return pg_catalog.jsonb_build_object(
    'action', recovery_action,
    'job_id', recovered_job.id,
    'job_status', recovered_job.status,
    'priority', recovered_job.priority,
    'not_before', recovered_job.not_before
  );
end;
$$;

revoke all on function public.claim_v4_recognition_jobs_with_balanced_capacity(
  integer, text, integer, text, text, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_v4_recognition_jobs_with_balanced_capacity(
  integer, text, integer, text, text, text, integer, integer, integer
) to service_role;

revoke all on function public.acquire_v4_stage_capacity(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_v4_stage_capacity(text, text, text, integer, integer)
  to service_role;

revoke all on function public.request_v4_recognition_job_recovery(text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_v4_recognition_job_recovery(text, text, text)
  to service_role;

notify pgrst, 'reload schema';
