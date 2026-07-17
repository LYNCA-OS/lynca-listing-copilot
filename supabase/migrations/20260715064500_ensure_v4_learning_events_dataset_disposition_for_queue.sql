-- Queue migration preflight: ensure Track D contract dependencies exist before
-- applying data flywheel queue convergence on production environments.
--
-- The production migration bundle runs
-- 20260715065830_track_d_data_flywheel_convergence, which expects
-- `public.prevent_v4_writer_learning_event_mutation()` and the
-- `public.v4_learning_events.dataset_disposition` column to already exist.

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
