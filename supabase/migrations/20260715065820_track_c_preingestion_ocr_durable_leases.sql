-- Track C: make pre-ingestion OCR claims durable and reclaimable.
--
-- This is intentionally an expand-only migration. Old workers may continue to
-- write status without leases during a rolling deployment; the new worker
-- treats an unleased RUNNING row as stale only after its configured timeout.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '15min';

alter table public.preingestion_jobs
  add column if not exists max_attempts integer not null default 3,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

update public.preingestion_jobs
set max_attempts = least(20, greatest(1, coalesce(max_attempts, 3)))
where max_attempts is null or max_attempts < 1 or max_attempts > 20;

alter table public.preingestion_jobs
  alter column max_attempts set default 3,
  alter column max_attempts set not null;

-- Rows completed by a previous deployment must never retain an active lease.
update public.preingestion_jobs
set lease_owner = null,
    lease_expires_at = null
where status <> 'running'
  and (lease_owner is not null or lease_expires_at is not null);

-- Give in-flight legacy OCR workers a bounded grace period. Old abandoned rows
-- whose updated_at is already older than six minutes become immediately
-- reclaimable, while a row claimed during migration is not double-run.
update public.preingestion_jobs
set lease_owner = coalesce(
      nullif(lease_owner, ''),
      'legacy-unleased-' || left(job_id::text, 120)
    ),
    lease_expires_at = coalesce(
      lease_expires_at,
      updated_at + interval '6 minutes'
    ),
    max_attempts = least(20, greatest(1, coalesce(max_attempts, 3)))
where job_type = 'ocr_crop_verification'
  and status = 'running'
  and (
    lease_owner is null
    or lease_owner = ''
    or lease_expires_at is null
    or max_attempts is null
    or max_attempts < 1
    or max_attempts > 20
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.preingestion_jobs'::regclass
      and conname = 'preingestion_jobs_max_attempts_chk'
  ) then
    alter table public.preingestion_jobs
      add constraint preingestion_jobs_max_attempts_chk
      check (max_attempts between 1 and 20) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.preingestion_jobs'::regclass
      and conname = 'preingestion_jobs_lease_pair_chk'
  ) then
    alter table public.preingestion_jobs
      add constraint preingestion_jobs_lease_pair_chk
      check ((lease_owner is null) = (lease_expires_at is null)) not valid;
  end if;
end
$$;

-- NOT VALID keeps the constraint-add step lightweight; explicit validation
-- then proves all existing rows before the transaction can commit.
alter table public.preingestion_jobs
  validate constraint preingestion_jobs_max_attempts_chk;

alter table public.preingestion_jobs
  validate constraint preingestion_jobs_lease_pair_chk;

create index if not exists preingestion_jobs_ocr_stale_lease_idx
  on public.preingestion_jobs(tenant_id, lease_expires_at, updated_at, attempts)
  where job_type = 'ocr_crop_verification'
    and status = 'running';

comment on column public.preingestion_jobs.max_attempts is
  'Maximum total OCR attempts, including the initial claim.';
comment on column public.preingestion_jobs.lease_owner is
  'Opaque owner token required by OCR completion and requeue compare-and-set writes.';
comment on column public.preingestion_jobs.lease_expires_at is
  'Expired OCR RUNNING rows may be requeued or finalized by the scheduled sweep.';

notify pgrst, 'reload schema';

commit;
