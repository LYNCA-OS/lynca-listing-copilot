-- Forward-only convergence for the small Track C runtime surface confirmed
-- missing in production. This intentionally does not replay the historical
-- Track C/Track D migrations whose effects are already partially present.

set lock_timeout = '5s';
set statement_timeout = '5min';

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
      else 'FAILED_FINAL'
    end
  ) stored,
  add column if not exists retry_count integer generated always as (
    case when status = 'RETRYING'
      then greatest(attempt_count, 0)
      else greatest(attempt_count - 1, 0)
    end
  ) stored,
  add column if not exists last_error text generated always as (nullif(error ->> 'message', '')) stored,
  add column if not exists error_type text generated always as (nullif(error ->> 'code', '')) stored,
  add column if not exists next_retry_at timestamptz generated always as (
    case when status = 'RETRYING' then not_before else null end
  ) stored;

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
    select jobs.id, jobs.lease_expires_at as previous_lease_expires_at
    from public.v4_recognition_jobs jobs
    where jobs.status = 'RUNNING'
      and jobs.lease_expires_at is not null
      and jobs.lease_expires_at < finalized_at
      and jobs.attempt_count >= jobs.max_attempts
    order by jobs.lease_expires_at, jobs.created_at
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
            case when pg_catalog.jsonb_typeof(jobs.error -> 'attempt_history') = 'array'
              then jobs.error -> 'attempt_history' else '[]'::jsonb end
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'attempt', jobs.attempt_count,
              'code', 'LEASE_EXPIRED_MAX_ATTEMPTS',
              'retryable', false,
              'will_retry', false,
              'failed_at', finalized_at
            ))
        ),
        queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb)
          - 'provider_capacity_slot' - 'provider_key_slot'
          - 'provider_capacity_lease_owner' - 'provider_capacity_leased_at'
          || pg_catalog.jsonb_build_object('lease_expiry_finalized_at', finalized_at),
        updated_at = finalized_at
    from exhausted
    where jobs.id = exhausted.id
      and jobs.status = 'RUNNING'
      and jobs.lease_expires_at is not null
      and jobs.lease_expires_at < finalized_at
      and jobs.attempt_count >= jobs.max_attempts
    returning jobs.id, jobs.tenant_id, jobs.batch_id,
      jobs.recognition_session_id, jobs.attempt_count, jobs.provider_id,
      jobs.max_attempts, exhausted.previous_lease_expires_at
  ), logged as (
    insert into public.job_attempt_events (
      tenant_id, batch_id, job_id, session_id, attempt_no, event_type,
      physical_status, canonical_status, retry_delay_ms, error_code,
      recoverable, provider, metadata, occurred_at
    )
    select
      coalesce(nullif(finalized.tenant_id, ''), 'tenant_legacy'),
      finalized.batch_id, finalized.id, finalized.recognition_session_id,
      finalized.attempt_count, 'LEASE_EXPIRED_FINALIZED', 'FAILED',
      'FAILED_FINAL', null, 'LEASE_EXPIRED_MAX_ATTEMPTS', false,
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
    set job_id = null, lease_owner = null, lease_expires_at = null, updated_at = finalized_at
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
        or (jobs.status = 'RUNNING' and jobs.lease_expires_at is not null
          and jobs.lease_expires_at < pg_catalog.clock_timestamp())
      )
      and jobs.attempt_count < jobs.max_attempts
      and jobs.not_before <= pg_catalog.clock_timestamp()
      and (jobs.lease_expires_at is null or jobs.lease_expires_at < pg_catalog.clock_timestamp())
      and (p_lane is null or jobs.lane = p_lane)
      and (p_tenant_id is null or jobs.tenant_id = p_tenant_id)
    order by
      case when jobs.lane = 'interactive' then 0 else 1 end,
      case when jobs.status = 'RUNNING' then 0 else 1 end,
      jobs.priority, jobs.created_at
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
    if not found then continue; end if;

    insert into public.job_attempt_events (
      tenant_id, batch_id, job_id, session_id, attempt_no, event_type,
      physical_status, canonical_status, recoverable, provider, metadata, occurred_at
    ) values (
      coalesce(nullif(claimed_job.tenant_id, ''), 'tenant_legacy'),
      claimed_job.batch_id, claimed_job.id, claimed_job.recognition_session_id,
      claimed_job.attempt_count, 'ATTEMPT_STARTED', 'RUNNING', 'RUNNING', null,
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

revoke all on function public.finalize_exhausted_v4_recognition_jobs()
  from public, anon, authenticated;
grant execute on function public.finalize_exhausted_v4_recognition_jobs()
  to service_role;
revoke all on function public.claim_v4_recognition_jobs(integer, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_v4_recognition_jobs(integer, text, integer, text, text)
  to service_role;

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
  select jobs.* into current_job
  from public.v4_recognition_jobs jobs
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and (p_worker_id is null or jobs.lease_owner = p_worker_id)
  for update;
  if not found then return; end if;

  retry_delay_seconds := case current_job.attempt_count
    when 0 then 10 when 1 then 10 when 2 then 30 when 3 then 120 else null end;
  should_retry := p_force_final_failure is not true
    and coalesce(p_retryable, true)
    and current_job.attempt_count < current_job.max_attempts
    and retry_delay_seconds is not null;
  safe_error_code := pg_catalog.left(pg_catalog.upper(pg_catalog.regexp_replace(
    coalesce(nullif(p_error ->> 'code', ''), 'UNCLASSIFIED_ERROR'),
    '[^a-zA-Z0-9]+', '_', 'g'
  )), 120);
  if nullif(safe_error_code, '') is null then safe_error_code := 'UNCLASSIFIED_ERROR'; end if;
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
      not_before = case when should_retry
        then failure_at + pg_catalog.make_interval(secs => retry_delay_seconds)
        else jobs.not_before end,
      completed_at = case when should_retry then null else failure_at end,
      lease_owner = null,
      lease_expires_at = null,
      queue_tags = coalesce(jobs.queue_tags, '{}'::jsonb)
        - 'provider_capacity_slot' - 'provider_key_slot'
        - 'provider_capacity_lease_owner' - 'provider_capacity_leased_at',
      updated_at = failure_at
  where jobs.id = current_job.id
    and jobs.status = 'RUNNING'
    and (p_worker_id is null or jobs.lease_owner = p_worker_id)
  returning jobs.* into updated_job;
  if not found then return; end if;

  update public.v4_provider_capacity_leases leases
  set job_id = null, lease_owner = null, lease_expires_at = null, updated_at = failure_at
  where leases.job_id = current_job.id
    and (p_worker_id is null or leases.lease_owner = p_worker_id);

  insert into public.job_attempt_events (
    tenant_id, batch_id, job_id, session_id, attempt_no, event_type,
    physical_status, canonical_status, retry_delay_ms, error_code,
    recoverable, provider, metadata, occurred_at
  ) values (
    coalesce(nullif(updated_job.tenant_id, ''), 'tenant_legacy'),
    updated_job.batch_id, updated_job.id, updated_job.recognition_session_id,
    updated_job.attempt_count,
    case when should_retry then 'RETRY_SCHEDULED' else 'FAILED_FINAL' end,
    updated_job.status,
    case when should_retry then 'RETRYABLE_FAILED' else 'FAILED_FINAL' end,
    case when should_retry then retry_delay_seconds::bigint * 1000 else null end,
    safe_error_code, should_retry, updated_job.provider_id,
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

revoke all on function public.fail_v4_recognition_job(text, text, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.fail_v4_recognition_job(text, text, jsonb, boolean, boolean)
  to service_role;

alter table public.tenants
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_settings_object_check'
  ) then
    alter table public.tenants add constraint tenants_settings_object_check
      check (pg_catalog.jsonb_typeof(settings) = 'object') not valid;
  end if;
end;
$$;
alter table public.tenants validate constraint tenants_settings_object_check;

alter table public.preingestion_jobs
  add column if not exists max_attempts integer not null default 3,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

update public.preingestion_jobs
set max_attempts = least(20, greatest(1, coalesce(max_attempts, 3)))
where max_attempts is null or max_attempts < 1 or max_attempts > 20;

update public.preingestion_jobs
set lease_owner = null, lease_expires_at = null
where status <> 'running'
  and (lease_owner is not null or lease_expires_at is not null);

update public.preingestion_jobs
set lease_owner = coalesce(nullif(lease_owner, ''), 'legacy-unleased-' || pg_catalog.left(job_id::text, 120)),
    lease_expires_at = coalesce(lease_expires_at, updated_at + interval '6 minutes'),
    max_attempts = least(20, greatest(1, coalesce(max_attempts, 3)))
where job_type = 'ocr_crop_verification'
  and status = 'running'
  and (lease_owner is null or lease_owner = '' or lease_expires_at is null);

alter table public.preingestion_jobs
  drop constraint if exists preingestion_jobs_max_attempts_chk,
  add constraint preingestion_jobs_max_attempts_chk check (max_attempts between 1 and 20) not valid,
  drop constraint if exists preingestion_jobs_lease_pair_chk,
  add constraint preingestion_jobs_lease_pair_chk
    check ((lease_owner is null) = (lease_expires_at is null)) not valid;
alter table public.preingestion_jobs validate constraint preingestion_jobs_max_attempts_chk;
alter table public.preingestion_jobs validate constraint preingestion_jobs_lease_pair_chk;

create index if not exists preingestion_jobs_ocr_stale_lease_idx
  on public.preingestion_jobs(tenant_id, lease_expires_at, updated_at, attempts)
  where job_type = 'ocr_crop_verification' and status = 'running';

-- Fix the four confirmed mutable-search-path helpers without changing their
-- bodies or signatures. Their relation references are schema-qualified and
-- pg_catalog remains implicitly available.
alter function public.acquire_v4_stage_capacity(text, text, text, integer, integer)
  set search_path = '';
alter function public.release_v4_stage_capacity(text, text, text)
  set search_path = '';
alter function public.release_v4_provider_capacity_for_job(text, text)
  set search_path = '';
alter function public.try_acquire_v4_queue_kick(text, text, integer)
  set search_path = '';

-- Browser roles never query Storage tables. All object operations are issued
-- through tenant-aware signed URL APIs; service_role remains the only DB role.
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    revoke usage on schema storage from anon, authenticated;
    grant usage on schema storage to service_role;
    execute 'drop policy if exists listing_card_images_service_role_select on storage.objects';
    execute 'drop policy if exists listing_card_images_service_role_insert on storage.objects';
    execute 'drop policy if exists listing_card_images_service_role_update on storage.objects';
    execute 'drop policy if exists listing_card_images_service_role_delete on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_select on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_insert on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_update on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_delete on storage.objects';
    execute $policy$
      create policy listing_card_images_service_role_select on storage.objects
      for select to service_role using (bucket_id = 'listing-card-images')
    $policy$;
    execute $policy$
      create policy listing_card_images_service_role_insert on storage.objects
      for insert to service_role with check (bucket_id = 'listing-card-images')
    $policy$;
    execute $policy$
      create policy listing_card_images_service_role_update on storage.objects
      for update to service_role using (bucket_id = 'listing-card-images')
      with check (bucket_id = 'listing-card-images')
    $policy$;
    execute $policy$
      create policy listing_card_images_service_role_delete on storage.objects
      for delete to service_role using (bucket_id = 'listing-card-images')
    $policy$;
    execute 'revoke all on table storage.objects from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table storage.objects to service_role';
  end if;
end;
$$;

notify pgrst, 'reload schema';
