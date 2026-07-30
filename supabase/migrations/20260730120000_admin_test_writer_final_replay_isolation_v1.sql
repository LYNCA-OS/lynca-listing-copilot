-- Administrator production journeys exercise the real ACCEPT / EDIT path, but
-- their deliberately synthetic titles are never writer replay authority.
-- Keep this boundary in PostgreSQL so no API or client can accidentally bypass
-- it, and expose only a bounded service-role proof for the Journey gate.

create index if not exists listing_writer_final_replay_source_feedback_idx
  on public.listing_writer_final_replay(tenant_id, source_feedback_event_id)
  where source_feedback_event_id is not null;

-- Repair only rows whose current source still points at an administrator test
-- event. A later legitimate writer event changes source_feedback_event_id, so
-- this deliberately leaves that newer authority untouched.
update public.listing_writer_final_replay replay
set replay_status = 'tombstoned',
    updated_at = pg_catalog.clock_timestamp()
from public.v4_writer_feedback_events feedback
where replay.tenant_id = feedback.tenant_id
  and replay.source_feedback_event_id = feedback.id
  and pg_catalog.upper(coalesce(
        nullif(pg_catalog.btrim(feedback.writer_feedback ->> 'dataset_disposition'), ''),
        ''
      )) = 'ADMIN_TEST_ONLY'
  and replay.replay_status = 'active';

create or replace function public.sync_writer_final_replay_from_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  generation_hash text := pg_catalog.lower(
    nullif(new.provider_result_summary ->> 'identity_cache_image_generation_hash', '')
  );
  feedback_dataset_disposition text;
begin
  if new.status not in ('ACCEPTED', 'EDITED')
     or nullif(pg_catalog.btrim(new.writer_final_title), '') is null then
    return new;
  end if;
  if generation_hash is null or generation_hash !~ '^[0-9a-f]{64}$' then
    return new;
  end if;

  select pg_catalog.upper(coalesce(
           nullif(pg_catalog.btrim(feedback.writer_feedback ->> 'dataset_disposition'), ''),
           ''
         ))
  into feedback_dataset_disposition
  from public.v4_writer_feedback_events feedback
  where feedback.id = new.writer_feedback_event_id
    and feedback.tenant_id = new.tenant_id
    and feedback.recognition_session_id = new.id;

  -- Replay is the highest runtime authority. Fail closed unless the immutable
  -- source event explicitly carries the normal writer disposition; missing,
  -- malformed, unknown, and administrator-test events all remain audit-only.
  if feedback_dataset_disposition is distinct from 'OBSERVE_ONLY' then
    return new;
  end if;

  insert into public.listing_writer_final_replay(
    tenant_id,
    image_generation_hash,
    writer_final_title,
    resolved_fields,
    field_states,
    identity_status,
    ambiguity_status,
    source_session_id,
    source_feedback_event_id,
    replay_status,
    training_eligible,
    catalog_promotion_eligible,
    identity_truth,
    updated_at
  ) values (
    new.tenant_id,
    generation_hash,
    pg_catalog.btrim(new.writer_final_title),
    coalesce(new.resolved_fields, '{}'::jsonb),
    coalesce(new.field_states, '{}'::jsonb),
    nullif(new.provider_result_summary ->> 'identity_resolution_status', ''),
    nullif(new.provider_result_summary ->> 'ambiguity_status', ''),
    new.id,
    new.writer_feedback_event_id,
    'active',
    false,
    false,
    false,
    pg_catalog.clock_timestamp()
  )
  on conflict (tenant_id, image_generation_hash) do update
  set writer_final_title = excluded.writer_final_title,
      resolved_fields = excluded.resolved_fields,
      field_states = excluded.field_states,
      identity_status = excluded.identity_status,
      ambiguity_status = excluded.ambiguity_status,
      source_session_id = excluded.source_session_id,
      source_feedback_event_id = excluded.source_feedback_event_id,
      replay_status = 'active',
      training_eligible = false,
      catalog_promotion_eligible = false,
      identity_truth = false,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

alter function public.sync_writer_final_replay_from_session()
  owner to postgres;
revoke all on function public.sync_writer_final_replay_from_session()
  from public, anon, authenticated;
grant execute on function public.sync_writer_final_replay_from_session()
  to service_role;

drop trigger if exists sync_writer_final_replay_from_session
  on public.v4_recognition_sessions;
create trigger sync_writer_final_replay_from_session
after update of status, writer_final_title, writer_feedback_event_id
on public.v4_recognition_sessions
for each row
when (new.status in ('ACCEPTED', 'EDITED'))
execute function public.sync_writer_final_replay_from_session();

create or replace function public.verify_v4_admin_test_feedback_isolation(
  p_session_id text,
  p_tenant_id text,
  p_feedback_event_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  feedback_event_count bigint;
  learning_event_count bigint;
  session_projection_count bigint;
  replay_source_count bigint;
  active_replay_source_count bigint;
  active_admin_replay_for_image_count bigint;
  generation_hash text;
  verified boolean;
begin
  if nullif(pg_catalog.btrim(p_session_id), '') is null
     or nullif(pg_catalog.btrim(p_tenant_id), '') is null
     or nullif(pg_catalog.btrim(p_feedback_event_id), '') is null then
    return pg_catalog.jsonb_build_object(
      'proof_version', 'admin-test-feedback-isolation-proof-v1',
      'verified', false,
      'reason_code', 'MISSING_PROOF_IDENTITY'
    );
  end if;

  select pg_catalog.count(*)
  into feedback_event_count
  from public.v4_writer_feedback_events feedback
  where feedback.id = p_feedback_event_id
    and feedback.tenant_id = p_tenant_id
    and feedback.recognition_session_id = p_session_id
    and feedback.dataset_disposition = 'OBSERVE_ONLY'
    and pg_catalog.upper(coalesce(
          nullif(pg_catalog.btrim(feedback.writer_feedback ->> 'dataset_disposition'), ''),
          ''
        )) = 'ADMIN_TEST_ONLY';

  select pg_catalog.count(*)
  into learning_event_count
  from public.v4_learning_events learning
  where learning.feedback_event_id = p_feedback_event_id
    and learning.tenant_id = p_tenant_id
    and learning.recognition_session_id = p_session_id
    and learning.dataset_disposition = 'OBSERVE_ONLY'
    and learning.training_eligible = false
    and pg_catalog.upper(coalesce(
          nullif(pg_catalog.btrim(
            learning.feedback_training_event ->> 'dataset_disposition'
          ), ''),
          ''
        )) = 'ADMIN_TEST_ONLY';

  select pg_catalog.count(*),
         pg_catalog.max(pg_catalog.lower(
           nullif(session.provider_result_summary ->> 'identity_cache_image_generation_hash', '')
         ))
  into session_projection_count, generation_hash
  from public.v4_recognition_sessions session
  where session.id = p_session_id
    and session.tenant_id = p_tenant_id
    and session.writer_feedback_event_id = p_feedback_event_id
    and session.status in ('ACCEPTED', 'EDITED');

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (where replay.replay_status = 'active')
  into replay_source_count, active_replay_source_count
  from public.listing_writer_final_replay replay
  where replay.tenant_id = p_tenant_id
    and replay.source_feedback_event_id = p_feedback_event_id;

  if generation_hash ~ '^[0-9a-f]{64}$' then
    select pg_catalog.count(*)
    into active_admin_replay_for_image_count
    from public.listing_writer_final_replay replay
    join public.v4_writer_feedback_events feedback
      on feedback.id = replay.source_feedback_event_id
     and feedback.tenant_id = replay.tenant_id
    where replay.tenant_id = p_tenant_id
      and replay.image_generation_hash = generation_hash
      and replay.replay_status = 'active'
      and pg_catalog.upper(coalesce(
            nullif(pg_catalog.btrim(feedback.writer_feedback ->> 'dataset_disposition'), ''),
            ''
          )) = 'ADMIN_TEST_ONLY';
  else
    active_admin_replay_for_image_count := 0;
  end if;

  verified := feedback_event_count = 1
    and learning_event_count = 1
    and session_projection_count = 1
    and coalesce(generation_hash ~ '^[0-9a-f]{64}$', false)
    and active_replay_source_count = 0
    and active_admin_replay_for_image_count = 0;

  return pg_catalog.jsonb_build_object(
    'proof_version', 'admin-test-feedback-isolation-proof-v1',
    'verified', verified,
    'reason_code', case when verified then null else 'ADMIN_TEST_FEEDBACK_ISOLATION_NOT_PROVEN' end,
    'feedback_event_verified', feedback_event_count = 1,
    'learning_event_verified', learning_event_count = 1,
    'session_projection_verified', session_projection_count = 1,
    'image_generation_hash_verified', coalesce(
      generation_hash ~ '^[0-9a-f]{64}$',
      false
    ),
    'writer_final_replay_excluded', active_replay_source_count = 0
      and active_admin_replay_for_image_count = 0,
    'replay_source_count', replay_source_count,
    'active_writer_final_replay_source_count', active_replay_source_count,
    'active_admin_test_replay_for_image_count', active_admin_replay_for_image_count
  );
end;
$$;

alter function public.verify_v4_admin_test_feedback_isolation(text, text, text)
  owner to postgres;
revoke all on function public.verify_v4_admin_test_feedback_isolation(text, text, text)
  from public, anon, authenticated;
grant execute on function public.verify_v4_admin_test_feedback_isolation(text, text, text)
  to service_role;

comment on function public.verify_v4_admin_test_feedback_isolation(text, text, text) is
  'Service-role-only bounded proof that an administrator Journey event persisted for audit but did not become active writer-final replay authority.';
