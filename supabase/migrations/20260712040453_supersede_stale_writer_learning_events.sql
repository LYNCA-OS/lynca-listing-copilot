create or replace function public.supersede_stale_v4_writer_learning_events()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
begin
  if new.event_type like 'WRITER_%' then
    update public.v4_learning_events events
    set training_eligible = false,
        semantic_learning_status = 'SUPERSEDED_BY_LATEST_WRITER_FEEDBACK'
    where events.recognition_session_id = new.recognition_session_id
      and events.id <> new.id
      and events.event_type like 'WRITER_%'
      and events.training_eligible = true;
  end if;

  return new;
end;
$$;

revoke execute on function public.supersede_stale_v4_writer_learning_events()
  from public, anon, authenticated;
grant execute on function public.supersede_stale_v4_writer_learning_events()
  to service_role;

drop trigger if exists supersede_stale_v4_writer_learning_events
  on public.v4_learning_events;
create trigger supersede_stale_v4_writer_learning_events
before insert on public.v4_learning_events
for each row execute function public.supersede_stale_v4_writer_learning_events();
