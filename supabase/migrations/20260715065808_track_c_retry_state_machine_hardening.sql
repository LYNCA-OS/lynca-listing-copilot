-- Track C retry hardening keeps the established physical job states while
-- making the commercial contract explicit: one initial attempt plus at most
-- three automatic retries at 10s, 30s, and 120s.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '15min';

alter table public.v4_recognition_jobs
  alter column max_attempts set default 4;

update public.v4_recognition_jobs
set max_attempts = 4,
    updated_at = pg_catalog.clock_timestamp()
where max_attempts = 2
  and status in ('QUEUED', 'RETRYING', 'RUNNING');

alter table public.v4_recognition_jobs
  add column if not exists canonical_state text generated always as (
    case status
      when 'QUEUED' then 'QUEUED'
      when 'RUNNING' then 'RUNNING'
      when 'L1_READY' then 'SUCCESS'
      when 'L2_READY' then 'SUCCESS'
      when 'RETRYING' then 'RETRYABLE_FAILED'
      when 'FAILED' then 'FAILED_FINAL'
      when 'CANCELLED' then 'FAILED_FINAL'
      else 'FAILED_FINAL'
    end
  ) stored;

-- Operational aliases keep the public retry contract explicit while the
-- existing attempt_count/error/not_before columns remain the physical source
-- of truth. Generated columns cannot drift from the transactional state
-- machine and are available to admin queries without decoding JSON.
alter table public.v4_recognition_jobs
  add column if not exists retry_count integer generated always as (
    case
      when status = 'RETRYING' then greatest(attempt_count, 0)
      else greatest(attempt_count - 1, 0)
    end
  ) stored,
  add column if not exists last_error text generated always as (
    nullif(error ->> 'message', '')
  ) stored,
  add column if not exists error_type text generated always as (
    nullif(error ->> 'code', '')
  ) stored,
  add column if not exists next_retry_at timestamptz generated always as (
    case when status = 'RETRYING' then not_before else null end
  ) stored;

comment on column public.v4_recognition_jobs.canonical_state is
  'External five-state projection; status remains the backward-compatible physical state.';
comment on column public.v4_recognition_jobs.retry_count is
  'Number of automatic or manual retry cycles scheduled/executed after the initial attempt.';
comment on column public.v4_recognition_jobs.last_error is
  'Latest bounded public error message projected from error JSON.';
comment on column public.v4_recognition_jobs.error_type is
  'Latest normalized error code projected from error JSON.';
comment on column public.v4_recognition_jobs.next_retry_at is
  'Retry eligibility timestamp when canonical_state is RETRYABLE_FAILED.';

-- A heartbeat is also the execution fence used immediately before any paid
-- provider path. Never revive an already expired lease: after expiry another
-- worker may be reclaiming the row, so only a RUNNING, matching, unexpired
-- owner may extend both the job and its provider-capacity lease.
create or replace function public.heartbeat_v4_recognition_job(
  p_job_id text,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  heartbeat_applied boolean := false;
  heartbeat_at timestamptz := pg_catalog.clock_timestamp();
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 900));
  next_expiry timestamptz := heartbeat_at + pg_catalog.make_interval(secs => lease_seconds);
begin
  if nullif(pg_catalog.btrim(p_job_id), '') is null
    or nullif(pg_catalog.btrim(p_worker_id), '') is null then
    return false;
  end if;

  update public.v4_recognition_jobs jobs
  set lease_expires_at = next_expiry,
      updated_at = heartbeat_at
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and jobs.lease_owner = p_worker_id
    and jobs.lease_expires_at is not null
    and jobs.lease_expires_at > heartbeat_at
  returning true into heartbeat_applied;

  if coalesce(heartbeat_applied, false) then
    update public.v4_provider_capacity_leases leases
    set lease_expires_at = next_expiry,
        updated_at = heartbeat_at
    where leases.job_id = p_job_id
      and leases.lease_owner = p_worker_id;
  end if;

  return coalesce(heartbeat_applied, false);
end;
$$;

revoke all on function public.heartbeat_v4_recognition_job(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_v4_recognition_job(text, text, integer)
  to service_role;

-- This helper is invoked at the start of every claim transaction. Updating
-- the job and inserting the append-only event happen in the same transaction,
-- so a crashed/exhausted RUNNING lease cannot remain claimable forever or be
-- finalized without an audit record.
create or replace function public.finalize_exhausted_v4_recognition_jobs()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finalized_at timestamptz := pg_catalog.clock_timestamp();
  finalized_job_ids text[] := array[]::text[];
begin
  with exhausted as materialized (
    select
      jobs.id,
      jobs.lease_expires_at as previous_lease_expires_at
    from public.v4_recognition_jobs jobs
    where jobs.status = 'RUNNING'
      and jobs.lease_expires_at is not null
      and jobs.lease_expires_at < finalized_at
      and jobs.attempt_count >= jobs.max_attempts
    order by jobs.lease_expires_at asc, jobs.created_at asc
    limit 500
    for update skip locked
  ), finalized as (
    update public.v4_recognition_jobs jobs
    set status = 'FAILED',
        completed_at = finalized_at,
        lease_owner = null,
        lease_expires_at = null,
        error = coalesce(jobs.error, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'message', 'lease_expired_after_max_attempts',
          'code', 'LEASE_EXPIRED_MAX_ATTEMPTS',
          'retryable', false,
          'will_retry', false,
          'failed_at', finalized_at,
          'attempt_history',
            case
              when pg_catalog.jsonb_typeof(jobs.error -> 'attempt_history') = 'array'
                then jobs.error -> 'attempt_history'
              else '[]'::jsonb
            end || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'attempt', jobs.attempt_count,
              'code', 'LEASE_EXPIRED_MAX_ATTEMPTS',
              'retryable', false,
              'will_retry', false,
              'failed_at', finalized_at
            ))
        ),
        queue_tags = (
          coalesce(jobs.queue_tags, '{}'::jsonb)
            - 'provider_capacity_slot'
            - 'provider_key_slot'
            - 'provider_capacity_lease_owner'
            - 'provider_capacity_leased_at'
        ) || pg_catalog.jsonb_build_object('lease_expiry_finalized_at', finalized_at),
        updated_at = finalized_at
    from exhausted
    where jobs.id = exhausted.id
      and jobs.status = 'RUNNING'
      and jobs.lease_expires_at is not null
      and jobs.lease_expires_at < finalized_at
      and jobs.attempt_count >= jobs.max_attempts
    returning
      jobs.id,
      jobs.tenant_id,
      jobs.batch_id,
      jobs.recognition_session_id,
      jobs.attempt_count,
      jobs.provider_id,
      jobs.max_attempts,
      exhausted.previous_lease_expires_at
  ), logged as (
    insert into public.job_attempt_events (
      tenant_id,
      batch_id,
      job_id,
      session_id,
      attempt_no,
      event_type,
      physical_status,
      canonical_status,
      retry_delay_ms,
      error_code,
      recoverable,
      provider,
      metadata,
      occurred_at
    )
    select
      coalesce(nullif(finalized.tenant_id, ''), 'tenant_legacy'),
      finalized.batch_id,
      finalized.id,
      finalized.recognition_session_id,
      finalized.attempt_count,
      'LEASE_EXPIRED_FINALIZED',
      'FAILED',
      'FAILED_FINAL',
      null,
      'LEASE_EXPIRED_MAX_ATTEMPTS',
      false,
      finalized.provider_id,
      pg_catalog.jsonb_build_object(
        'max_attempts', finalized.max_attempts,
        'previous_lease_expires_at', finalized.previous_lease_expires_at
      ),
      finalized_at
    from finalized
    returning job_id
  )
  select coalesce(pg_catalog.array_agg(logged.job_id), array[]::text[])
  into finalized_job_ids
  from logged;

  if pg_catalog.cardinality(finalized_job_ids) > 0 then
    update public.v4_provider_capacity_leases leases
    set job_id = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = finalized_at
    where leases.job_id = any(finalized_job_ids);
  end if;

  return pg_catalog.cardinality(finalized_job_ids);
end;
$$;

create or replace function public.claim_v4_recognition_jobs(
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 90,
  p_lane text default null,
  p_tenant_id text default null
)
returns setof public.v4_recognition_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate record;
  claimed_job public.v4_recognition_jobs%rowtype;
  claimed_at timestamptz;
  worker_name text := coalesce(nullif(p_worker_id, ''), 'worker');
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 90), 900));
begin
  perform public.finalize_exhausted_v4_recognition_jobs();

  for candidate in
    select jobs.id, jobs.status as previous_status, jobs.not_before as attempt_ready_at
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
    order by
      case when jobs.lane = 'interactive' then 0 else 1 end,
      case when jobs.status = 'RUNNING' then 0 else 1 end,
      jobs.priority asc,
      jobs.created_at asc
    limit greatest(1, least(coalesce(p_limit, 1), 25))
    for update skip locked
  loop
    claimed_at := pg_catalog.clock_timestamp();
    update public.v4_recognition_jobs jobs
    set status = 'RUNNING',
        lease_owner = worker_name,
        lease_expires_at = claimed_at + pg_catalog.make_interval(secs => lease_seconds),
        started_at = coalesce(jobs.started_at, claimed_at),
        attempt_count = jobs.attempt_count + 1,
        updated_at = claimed_at
    where jobs.id = candidate.id
      and jobs.attempt_count < jobs.max_attempts
    returning jobs.* into claimed_job;

    if not found then
      continue;
    end if;

    insert into public.job_attempt_events (
      tenant_id,
      batch_id,
      job_id,
      session_id,
      attempt_no,
      event_type,
      physical_status,
      canonical_status,
      recoverable,
      provider,
      metadata,
      occurred_at
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
        'previous_physical_status', candidate.previous_status,
        'attempt_ready_at', candidate.attempt_ready_at,
        'lease_seconds', lease_seconds
      ),
      claimed_at
    );

    return next claimed_job;
  end loop;
  return;
end;
$$;

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
  slot_ids integer[] := array[]::integer[];
  key_slots integer[] := array[]::integer[];
  job_ids text[] := array[]::text[];
  claimed_job_ids text[] := array[]::text[];
  item_count integer := 0;
  item_index integer;
  prior_status text;
  attempt_ready_at timestamptz;
  claimed_at timestamptz;
  claimed_job public.v4_recognition_jobs%rowtype;
begin
  perform public.finalize_exhausted_v4_recognition_jobs();

  insert into public.v4_provider_capacity_leases(provider_id, slot_no, key_slot, updated_at)
  select
    provider_name,
    slot_no,
    ((slot_no - 1) % provider_key_count) + 1,
    pg_catalog.clock_timestamp()
  from pg_catalog.generate_series(1, provider_capacity) as slot_no
  on conflict (provider_id, slot_no) do update
  set key_slot = excluded.key_slot,
      updated_at = excluded.updated_at
  where public.v4_provider_capacity_leases.job_id is null
     or public.v4_provider_capacity_leases.lease_expires_at <= pg_catalog.clock_timestamp();

  select
    coalesce(pg_catalog.array_agg(available.slot_no order by available.slot_no), array[]::integer[]),
    coalesce(pg_catalog.array_agg(available.key_slot order by available.slot_no), array[]::integer[])
  into slot_ids, key_slots
  from (
    select leases.slot_no, leases.key_slot
    from public.v4_provider_capacity_leases leases
    where leases.provider_id = provider_name
      and leases.slot_no <= provider_capacity
      and (leases.job_id is null or leases.lease_expires_at <= pg_catalog.clock_timestamp())
    order by leases.slot_no
    limit claim_limit
    for update skip locked
  ) available;

  if pg_catalog.cardinality(slot_ids) = 0 then
    return;
  end if;

  with ranked as materialized (
    select
      jobs.id,
      jobs.lane,
      jobs.priority,
      jobs.created_at,
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
    limit pg_catalog.cardinality(slot_ids)
    for update of jobs skip locked
  )
  select coalesce(
    pg_catalog.array_agg(
      locked.id
      order by locked.lane_order, locked.tenant_rank, locked.priority, locked.created_at
    ),
    array[]::text[]
  )
  into job_ids
  from locked;

  item_count := least(pg_catalog.cardinality(slot_ids), pg_catalog.cardinality(job_ids));
  if item_count = 0 then
    return;
  end if;

  for item_index in 1..item_count loop
    select jobs.status, jobs.not_before
    into prior_status, attempt_ready_at
    from public.v4_recognition_jobs jobs
    where jobs.id = job_ids[item_index];

    claimed_at := pg_catalog.clock_timestamp();
    update public.v4_provider_capacity_leases leases
    set job_id = job_ids[item_index],
        lease_owner = worker_name,
        lease_expires_at = claimed_at + pg_catalog.make_interval(secs => lease_seconds),
        acquired_at = claimed_at,
        updated_at = claimed_at
    where leases.provider_id = provider_name
      and leases.slot_no = slot_ids[item_index];

    update public.v4_recognition_jobs jobs
    set status = 'RUNNING',
        lease_owner = worker_name,
        lease_expires_at = claimed_at + pg_catalog.make_interval(secs => lease_seconds),
        started_at = coalesce(jobs.started_at, claimed_at),
        attempt_count = jobs.attempt_count + 1,
        queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'provider_capacity_slot', slot_ids[item_index],
          'provider_key_slot', key_slots[item_index],
          'provider_capacity', provider_capacity,
          'provider_key_count', provider_key_count,
          'provider_per_key_concurrency', per_key_concurrency,
          'provider_key_assignment', 'balanced_round_robin_v1',
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
    where jobs.id = job_ids[item_index]
      and jobs.attempt_count < jobs.max_attempts
    returning jobs.* into claimed_job;

    if not found then
      update public.v4_provider_capacity_leases leases
      set job_id = null,
          lease_owner = null,
          lease_expires_at = null,
          updated_at = pg_catalog.clock_timestamp()
      where leases.provider_id = provider_name
        and leases.slot_no = slot_ids[item_index]
        and leases.job_id = job_ids[item_index];
      continue;
    end if;

    claimed_job_ids := pg_catalog.array_append(claimed_job_ids, claimed_job.id);
    insert into public.job_attempt_events (
      tenant_id,
      batch_id,
      job_id,
      session_id,
      attempt_no,
      event_type,
      physical_status,
      canonical_status,
      recoverable,
      provider,
      metadata,
      occurred_at
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
        'provider_capacity_slot', slot_ids[item_index],
        'provider_key_slot', key_slots[item_index]
      ),
      claimed_at
    );
  end loop;

  if pg_catalog.cardinality(claimed_job_ids) = 0 then
    return;
  end if;

  return query
  select jobs.*
  from public.v4_recognition_jobs jobs
  where jobs.id = any(claimed_job_ids)
  order by pg_catalog.array_position(claimed_job_ids, jobs.id);
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
language sql
security invoker
set search_path = ''
as $$
  select *
  from public.claim_v4_recognition_jobs_with_balanced_capacity(
    p_limit,
    p_worker_id,
    p_lease_seconds,
    p_lane,
    p_tenant_id,
    p_provider_id,
    p_provider_capacity,
    p_per_key_concurrency,
    greatest(
      1,
      ceil(greatest(1, p_provider_capacity)::numeric / greatest(1, p_per_key_concurrency)::numeric)::integer
    )
  );
$$;

-- Failure handling is an RPC instead of a REST PATCH so state, retry timing,
-- capacity release, and the attempt event share one transaction.
create or replace function public.fail_v4_recognition_job(
  p_job_id text,
  p_worker_id text default null,
  p_error jsonb default '{}'::jsonb,
  p_retryable boolean default true,
  p_force_final_failure boolean default false
)
returns setof public.v4_recognition_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_job public.v4_recognition_jobs%rowtype;
  updated_job public.v4_recognition_jobs%rowtype;
  failure_at timestamptz := pg_catalog.clock_timestamp();
  retry_delay_seconds integer;
  should_retry boolean := false;
  safe_error_code text;
  failure_payload jsonb;
begin
  select jobs.*
  into current_job
  from public.v4_recognition_jobs jobs
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and (p_worker_id is null or jobs.lease_owner = p_worker_id)
  for update;

  if not found then
    return;
  end if;

  retry_delay_seconds := case current_job.attempt_count
    when 0 then 10
    when 1 then 10
    when 2 then 30
    when 3 then 120
    else null
  end;
  should_retry := p_force_final_failure is not true
    and coalesce(p_retryable, true)
    and current_job.attempt_count < current_job.max_attempts
    and retry_delay_seconds is not null;
  safe_error_code := left(
    upper(pg_catalog.regexp_replace(
      coalesce(nullif(p_error ->> 'code', ''), 'UNCLASSIFIED_ERROR'),
      '[^a-zA-Z0-9]+',
      '_',
      'g'
    )),
    120
  );
  if nullif(safe_error_code, '') is null then
    safe_error_code := 'UNCLASSIFIED_ERROR';
  end if;
  failure_payload := coalesce(p_error, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'code', safe_error_code,
    'retryable', coalesce(p_retryable, true),
    'will_retry', should_retry,
    'retry_delay_seconds', case when should_retry then retry_delay_seconds else null end,
    'failed_at', failure_at
  );

  update public.v4_recognition_jobs jobs
  set status = case when should_retry then 'RETRYING' else 'FAILED' end,
      error = failure_payload,
      not_before = case
        when should_retry
          then failure_at + pg_catalog.make_interval(secs => retry_delay_seconds)
        else jobs.not_before
      end,
      completed_at = case when should_retry then null else failure_at end,
      lease_owner = null,
      lease_expires_at = null,
      queue_tags = (
        coalesce(jobs.queue_tags, '{}'::jsonb)
          - 'provider_capacity_slot'
          - 'provider_key_slot'
          - 'provider_capacity_lease_owner'
          - 'provider_capacity_leased_at'
      ),
      updated_at = failure_at
  where jobs.id = current_job.id
    and jobs.status = 'RUNNING'
    and (p_worker_id is null or jobs.lease_owner = p_worker_id)
  returning jobs.* into updated_job;

  if not found then
    return;
  end if;

  update public.v4_provider_capacity_leases leases
  set job_id = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = failure_at
  where leases.job_id = current_job.id
    and (p_worker_id is null or leases.lease_owner = p_worker_id);

  insert into public.job_attempt_events (
    tenant_id,
    batch_id,
    job_id,
    session_id,
    attempt_no,
    event_type,
    physical_status,
    canonical_status,
    retry_delay_ms,
    error_code,
    recoverable,
    provider,
    metadata,
    occurred_at
  ) values (
    coalesce(nullif(updated_job.tenant_id, ''), 'tenant_legacy'),
    updated_job.batch_id,
    updated_job.id,
    updated_job.recognition_session_id,
    updated_job.attempt_count,
    case when should_retry then 'RETRY_SCHEDULED' else 'FAILED_FINAL' end,
    updated_job.status,
    case when should_retry then 'RETRYABLE_FAILED' else 'FAILED_FINAL' end,
    case when should_retry then retry_delay_seconds::bigint * 1000 else null end,
    safe_error_code,
    should_retry,
    updated_job.provider_id,
    pg_catalog.jsonb_build_object(
      'max_attempts', updated_job.max_attempts,
      'error_classified_retryable', coalesce(p_retryable, true),
      'force_final_failure', p_force_final_failure is true
    ),
    failure_at
  );

  return next updated_job;
  return;
end;
$$;

revoke all on function public.finalize_exhausted_v4_recognition_jobs()
  from public, anon, authenticated;
grant execute on function public.finalize_exhausted_v4_recognition_jobs()
  to service_role;

revoke all on function public.claim_v4_recognition_jobs(integer, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_v4_recognition_jobs(integer, text, integer, text, text)
  to service_role;

revoke all on function public.claim_v4_recognition_jobs_with_balanced_capacity(
  integer, text, integer, text, text, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_v4_recognition_jobs_with_balanced_capacity(
  integer, text, integer, text, text, text, integer, integer, integer
) to service_role;

revoke all on function public.claim_v4_recognition_jobs_with_capacity(
  integer, text, integer, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_v4_recognition_jobs_with_capacity(
  integer, text, integer, text, text, text, integer, integer
) to service_role;

revoke all on function public.fail_v4_recognition_job(text, text, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.fail_v4_recognition_job(text, text, jsonb, boolean, boolean)
  to service_role;

revoke all on table public.job_attempt_events from public, anon, authenticated;
grant select, insert on table public.job_attempt_events to service_role;

notify pgrst, 'reload schema';

commit;
