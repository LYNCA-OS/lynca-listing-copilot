-- Queue migration preflight: ensure Track D contract dependencies exist before
-- applying data flywheel queue convergence on production environments.
--
-- The production migration bundle runs
-- 20260715065830_track_d_data_flywheel_convergence, which expects
-- both `public.v4_recognition_batches` and
-- `public.prevent_v4_writer_learning_event_mutation()` to exist, and assumes
-- `public.v4_learning_events.dataset_disposition` is present.

create table if not exists public.v4_recognition_batches (
  id text primary key,
  tenant_id text not null default 'tenant_legacy'
    references public.tenants(id) on delete restrict,
  created_by_user_id text references public.users(id) on delete set null,
  assigned_to_user_id text references public.users(id) on delete set null,
  status text not null default 'QUEUED',
  item_count integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint v4_recognition_batches_status_check check (
    status in (
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'PARTIAL_FAILED',
      'FAILED',
      'CANCELLED',
      'LEGACY_IMPORTED'
    )
  )
);

create index if not exists v4_recognition_batches_tenant_status_idx
  on public.v4_recognition_batches(tenant_id, status, created_at desc);

comment on table public.v4_recognition_batches is
  'Track D queueing bridge for atomic recognition-enqueue batches.';

comment on column public.v4_recognition_batches.assigned_to_user_id is
  'Deprecated summary field. See session/job assignment fields for runtime owner tracking.';

alter table if exists public.v4_learning_events
  add column if not exists dataset_disposition text not null default 'LEGACY_CAPTURE';

update public.v4_learning_events
set dataset_disposition = coalesce(dataset_disposition, 'LEGACY_CAPTURE')
where dataset_disposition is null;

comment on column public.v4_learning_events.dataset_disposition is
  'Controls V4 learning-event routing and feedback data disposition defaults for queue/worker control.';

-- Ensure this trigger helper function exists even if earlier Track D migrations are
-- not part of the current tenant baseline.
create or replace function public.prevent_v4_writer_learning_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.event_type like 'WRITER\_%' escape '\\' then
    raise exception 'v4_writer_learning_events_is_append_only';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_v4_writer_learning_event_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_v4_writer_learning_event_mutation()
  to service_role;
