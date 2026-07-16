-- Track D / Data Flywheel v1 production convergence.
--
-- This migration intentionally follows Track C's 20260715065803 tenant
-- foundation and later 0658xx hardening migrations. The already-published
-- 20260715065752 Track D migration is immutable history; upgrade and clean
-- installs converge here on the same tenant-aware, append-only contract.

-- The historical LIKE expression treated "_" as a wildcard. Re-assert the
-- writer-only safety state with a literal underscore for all current rows.
-- The published Track D migration already protects these facts with a BEFORE
-- UPDATE trigger. Remove that trigger only for this deterministic maintenance
-- rewrite; PostgreSQL migration transactions restore it automatically if any
-- later statement fails, and we recreate it immediately below.
drop trigger if exists prevent_v4_writer_learning_event_mutation
  on public.v4_learning_events;

update public.v4_learning_events
set training_eligible = false,
    dataset_disposition = 'OBSERVE_ONLY'
where event_type like 'WRITER\_%' escape '\';

update public.v4_learning_events
set semantic_truth = false,
    semantic_learning_status = case
      when event_type = 'WRITER_REJECT' then 'REJECTED_COMMERCIAL_FEEDBACK'
      else 'PARSER_CANDIDATE_PENDING_REVIEW'
    end
where event_type like 'WRITER\_%' escape '\';

create trigger prevent_v4_writer_learning_event_mutation
before update or delete on public.v4_learning_events
for each row execute function public.prevent_v4_writer_learning_event_mutation();

-- Backfill provenance only from the immutable learning candidate that the
-- validation row already references. Never synthesize parser/SEM versions.
update public.v4_sem_validation_events validation
set parser_version = coalesce(
      nullif(validation.parser_version, ''),
      nullif(learning.sem_extraction ->> 'parser_version', '')
    ),
    sem_standard_version = coalesce(
      nullif(validation.sem_standard_version, ''),
      nullif(learning.sem_extraction ->> 'sem_standard_version', '')
    )
from public.v4_learning_events learning
where learning.id = validation.learning_event_id
  and (
    nullif(validation.parser_version, '') is null
    or nullif(validation.sem_standard_version, '') is null
  );

do $$
begin
  if exists (
    select 1
    from public.v4_sem_validation_events
    where nullif(parser_version, '') is null
       or nullif(sem_standard_version, '') is null
  ) then
    raise exception 'sem_validation_provenance_backfill_required';
  end if;

  if exists (
    select feedback_event_id
    from public.v4_learning_events
    where feedback_event_id is not null
    group by feedback_event_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_learning_feedback_links_require_remediation';
  end if;

  if exists (
    select 1
    from public.v4_sem_validation_events validation
    where validation.validation_status = 'VALIDATED'
      and (
        pg_catalog.jsonb_typeof(validation.validation_sources) is distinct from 'object'
        or not exists (
          select 1
          from pg_catalog.jsonb_each(validation.validation_sources) sources
          where pg_catalog.upper(coalesce(sources.value ->> 'status', '')) = 'SUPPORTED'
            and case
              when pg_catalog.jsonb_typeof(sources.value -> 'evidence_refs') = 'array'
                then pg_catalog.jsonb_array_length(sources.value -> 'evidence_refs') > 0
              else false
            end
        )
      )
  ) then
    raise exception 'validated_sem_supporting_evidence_remediation_required';
  end if;
end;
$$;

alter table public.v4_sem_validation_events
  alter column learning_event_id set not null,
  alter column feedback_event_id set not null,
  alter column recognition_session_id set not null,
  alter column parser_version set not null,
  alter column sem_standard_version set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.v4_sem_validation_events'::regclass
      and conname = 'v4_sem_validation_identity_group_check'
  ) then
    alter table public.v4_sem_validation_events
      add constraint v4_sem_validation_identity_group_check
      check (
        validation_status <> 'VALIDATED'
        or nullif(btrim(identity_group_id), '') is not null
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.v4_sem_validation_events'::regclass
      and conname = 'v4_sem_validation_current_version_check'
  ) then
    alter table public.v4_sem_validation_events
      add constraint v4_sem_validation_current_version_check
      check (
        validation_status <> 'VALIDATED'
        or (
          parser_version = 'parse-reviewed-title-fields-v1'
          and sem_standard_version = 'linear-cos-10-23-v25'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.v4_sem_validation_events'::regclass
      and conname = 'v4_sem_validation_sources_object_check'
  ) then
    alter table public.v4_sem_validation_events
      add constraint v4_sem_validation_sources_object_check
      check (jsonb_typeof(validation_sources) = 'object') not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.v4_sem_validation_events'::regclass
      and conname = 'v4_sem_validation_disposition_check'
  ) then
    alter table public.v4_sem_validation_events
      add constraint v4_sem_validation_disposition_check
      check (dataset_disposition = 'OBSERVE_ONLY') not valid;
  end if;
end;
$$;

alter table public.v4_sem_validation_events
  validate constraint v4_sem_validation_identity_group_check;
alter table public.v4_sem_validation_events
  validate constraint v4_sem_validation_current_version_check;
alter table public.v4_sem_validation_events
  validate constraint v4_sem_validation_sources_object_check;
alter table public.v4_sem_validation_events
  validate constraint v4_sem_validation_disposition_check;

create unique index if not exists v4_learning_feedback_event_uidx
  on public.v4_learning_events(feedback_event_id)
  where feedback_event_id is not null;

-- Track C re-grants generic service-role mutation rights. Immutable feedback
-- and SEM review facts remain insert-only outside controlled migrations.
revoke update, delete on table public.v4_writer_feedback_events from service_role;
revoke update, delete on table public.v4_sem_validation_events from service_role;
grant select, insert on table public.v4_writer_feedback_events to service_role;
grant select, insert on table public.v4_sem_validation_events to service_role;
drop policy if exists track_c_writer_feedback_insert
  on public.v4_writer_feedback_events;
drop policy if exists track_c_writer_feedback_update
  on public.v4_writer_feedback_events;

create or replace function public.prevent_v4_session_identity_reassignment()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'v4_session_tenant_is_immutable';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'v4_session_user_is_immutable';
  end if;
  if new.operator_id is distinct from old.operator_id then
    raise exception 'v4_session_operator_is_immutable';
  end if;
  if old.stable_asset_id is not null and new.stable_asset_id is distinct from old.stable_asset_id then
    raise exception 'v4_session_asset_is_immutable';
  end if;
  if old.client_asset_ref is not null and new.client_asset_ref is distinct from old.client_asset_ref then
    raise exception 'v4_session_client_asset_ref_is_immutable';
  end if;
  if old.asset_fingerprint is not null and new.asset_fingerprint is distinct from old.asset_fingerprint then
    raise exception 'v4_session_asset_fingerprint_is_immutable';
  end if;
  if old.identity_snapshot <> '{}'::jsonb and new.identity_snapshot is distinct from old.identity_snapshot then
    raise exception 'v4_session_identity_snapshot_is_immutable';
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_v4_session_identity_reassignment()
  from public, anon, authenticated;
grant execute on function public.prevent_v4_session_identity_reassignment()
  to service_role;

drop trigger if exists prevent_v4_session_identity_reassignment
  on public.v4_recognition_sessions;
create trigger prevent_v4_session_identity_reassignment
before update on public.v4_recognition_sessions
for each row execute function public.prevent_v4_session_identity_reassignment();

create or replace function public.prevent_v4_writer_feedback_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'v4_writer_feedback_events_is_append_only';
end;
$$;

revoke execute on function public.prevent_v4_writer_feedback_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_v4_writer_feedback_mutation()
  to service_role;

drop trigger if exists prevent_v4_writer_feedback_mutation
  on public.v4_writer_feedback_events;
create trigger prevent_v4_writer_feedback_mutation
before update or delete on public.v4_writer_feedback_events
for each row execute function public.prevent_v4_writer_feedback_mutation();

drop trigger if exists prevent_v4_sem_validation_mutation
  on public.v4_sem_validation_events;
create trigger prevent_v4_sem_validation_mutation
before update or delete on public.v4_sem_validation_events
for each row execute function public.prevent_v4_writer_feedback_mutation();

-- Existing callers still upsert non-writer learning rows, so the table cannot
-- be made globally insert-only yet. Writer-derived observations are immutable
-- facts, however, and must never depend on the service_role's historical
-- table grants. Protect that subset at the database boundary.
create or replace function public.prevent_v4_writer_learning_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.event_type like 'WRITER\_%' escape '\' then
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

drop trigger if exists prevent_v4_writer_learning_event_mutation
  on public.v4_learning_events;
create trigger prevent_v4_writer_learning_event_mutation
before update or delete on public.v4_learning_events
for each row execute function public.prevent_v4_writer_learning_event_mutation();

create or replace function public.validate_v4_sem_validation_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_tenant_id text;
  expected_user_id text;
  expected_asset_id text;
  expected_identity_group_id text;
  expected_current_feedback_id text;
  expected_current_learning_id text;
  expected_session_id text;
  expected_feedback_id text;
  expected_learning_tenant_id text;
  expected_candidate_sem jsonb;
  expected_parser_version text;
  expected_sem_standard_version text;
  feedback_tenant_id text;
  feedback_user_id text;
  feedback_asset_id text;
begin
  select sessions.tenant_id,
         coalesce(sessions.user_id, sessions.operator_id, sessions.created_by_user_id),
         coalesce(sessions.stable_asset_id, sessions.asset_id),
         nullif(sessions.identity_snapshot ->> 'identity_group_id', ''),
         sessions.writer_feedback_event_id,
         sessions.learning_event_id
  into expected_tenant_id,
       expected_user_id,
       expected_asset_id,
       expected_identity_group_id,
       expected_current_feedback_id,
       expected_current_learning_id
  from public.v4_recognition_sessions sessions
  where sessions.id = new.recognition_session_id
    and sessions.tenant_id = new.tenant_id
  for share;

  if not found
     or new.user_id is distinct from expected_user_id
     or new.asset_id is distinct from expected_asset_id
     or new.feedback_event_id is distinct from expected_current_feedback_id
     or new.learning_event_id is distinct from expected_current_learning_id
     or (
       new.validation_status = 'VALIDATED'
       and expected_identity_group_id is not null
       and new.identity_group_id is distinct from expected_identity_group_id
     ) then
    raise exception 'sem_validation_identity_mismatch';
  end if;

  select events.tenant_id,
         events.user_id,
         events.asset_id
  into feedback_tenant_id,
       feedback_user_id,
       feedback_asset_id
  from public.v4_writer_feedback_events events
  where events.id = new.feedback_event_id
    and events.recognition_session_id = new.recognition_session_id
  for share;

  if not found
     or feedback_tenant_id is distinct from expected_tenant_id
     or feedback_user_id is distinct from expected_user_id
     or feedback_asset_id is distinct from expected_asset_id then
    raise exception 'sem_validation_feedback_identity_mismatch';
  end if;

  if new.validation_status = 'VALIDATED' and new.learning_event_id is null then
    raise exception 'sem_validation_current_learning_required';
  end if;

  select events.recognition_session_id,
         events.feedback_event_id,
         events.tenant_id,
         coalesce(events.sem_extraction -> 'candidate_sem', '{}'::jsonb),
         nullif(events.sem_extraction ->> 'parser_version', ''),
         nullif(events.sem_extraction ->> 'sem_standard_version', '')
  into expected_session_id,
       expected_feedback_id,
       expected_learning_tenant_id,
       expected_candidate_sem,
       expected_parser_version,
       expected_sem_standard_version
  from public.v4_learning_events events
  where events.id = new.learning_event_id
  for share;

  if not found
     or expected_session_id is distinct from new.recognition_session_id
     or expected_feedback_id is distinct from new.feedback_event_id
     or expected_learning_tenant_id is distinct from expected_tenant_id
     or expected_candidate_sem is distinct from new.candidate_sem
     or expected_parser_version is distinct from new.parser_version
     or expected_sem_standard_version is distinct from new.sem_standard_version then
    raise exception 'sem_validation_candidate_mismatch';
  end if;

  if new.validation_status = 'VALIDATED' then
    if new.parser_version is distinct from 'parse-reviewed-title-fields-v1'
       or new.sem_standard_version is distinct from 'linear-cos-10-23-v25' then
      raise exception 'sem_validation_current_version_required';
    end if;

    if pg_catalog.jsonb_typeof(new.validation_sources) is distinct from 'object'
       or not exists (
         select 1
         from pg_catalog.jsonb_each(new.validation_sources) sources
         where pg_catalog.upper(coalesce(sources.value ->> 'status', '')) = 'SUPPORTED'
           and case
             when pg_catalog.jsonb_typeof(sources.value -> 'evidence_refs') = 'array'
               then pg_catalog.jsonb_array_length(sources.value -> 'evidence_refs') > 0
             else false
           end
       ) then
      raise exception 'sem_validation_supporting_evidence_required';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_v4_sem_validation_identity()
  from public, anon, authenticated;
grant execute on function public.validate_v4_sem_validation_identity()
  to service_role;

drop trigger if exists validate_v4_sem_validation_identity
  on public.v4_sem_validation_events;
create trigger validate_v4_sem_validation_identity
before insert on public.v4_sem_validation_events
for each row execute function public.validate_v4_sem_validation_identity();

-- The five-argument overload predates trusted tenant context. Remove it on
-- both upgraded and clean databases so it can never become an accidental
-- authorization bypass during a mixed-version deploy.
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.persist_v4_writer_feedback_transaction(text,text,text,jsonb,jsonb)'
  ) is not null then
    execute 'revoke all on function public.persist_v4_writer_feedback_transaction(text,text,text,jsonb,jsonb) from public, anon, authenticated, service_role';
    execute 'drop function public.persist_v4_writer_feedback_transaction(text,text,text,jsonb,jsonb)';
  end if;
end;
$$;

create or replace function public.persist_v4_writer_feedback_transaction(
  p_tenant_id text,
  p_session_id text,
  p_operator_id text,
  p_session_status text,
  p_feedback_event jsonb,
  p_learning_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_operator_id text;
  session_writer_id text;
  session_tenant_id text;
  session_user_id text;
  session_asset_id text;
  session_client_asset_ref text;
  session_asset_fingerprint text;
  session_model_version text;
  session_prompt_version text;
  session_ai_title text;
  session_ai_sem jsonb;
  session_current_status text;
  session_current_writer_title text;
  session_current_learning_id text;
  previous_feedback_id text;
  next_feedback_revision bigint;
  current_feedback_revision bigint;
  feedback_id text := nullif(p_feedback_event ->> 'id', '');
  learning_id text := nullif(p_learning_event ->> 'id', '');
  submission_id text := nullif(p_feedback_event ->> 'submission_id', '');
  incoming_payload_sha256 text := nullif(p_feedback_event ->> 'payload_sha256', '');
  existing_feedback_id text;
  existing_payload_sha256 text;
  existing_learning_id text;
  operator_role text;
  write_count integer;
  writer_title text := nullif(p_feedback_event ->> 'writer_final_title', '');
begin
  if nullif(btrim(p_tenant_id), '') is null
     or nullif(btrim(p_session_id), '') is null
     or nullif(btrim(p_operator_id), '') is null
     or feedback_id is null
     or learning_id is null
     or submission_id is null
     or incoming_payload_sha256 is null
     or incoming_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_session_status not in ('ACCEPTED', 'EDITED', 'REJECTED')
     or p_feedback_event ->> 'action' not in ('ACCEPT', 'EDIT', 'REJECT')
     or nullif(p_feedback_event ->> 'sem_standard_version', '') is distinct from 'linear-cos-10-23-v25'
     or nullif(p_learning_event ->> 'sem_standard_version', '') is distinct from 'linear-cos-10-23-v25'
     or nullif(p_learning_event -> 'sem_extraction' ->> 'parser_version', '') is distinct from 'parse-reviewed-title-fields-v1'
     or nullif(p_learning_event -> 'sem_extraction' ->> 'sem_standard_version', '') is distinct from 'linear-cos-10-23-v25'
     or coalesce((p_learning_event ->> 'training_eligible')::boolean, false)
     or coalesce((p_learning_event ->> 'semantic_truth')::boolean, false) then
    raise exception 'invalid_feedback_transaction_payload';
  end if;

  if p_feedback_event ->> 'recognition_session_id' is distinct from p_session_id
     or p_learning_event ->> 'recognition_session_id' is distinct from p_session_id
     or p_learning_event ->> 'feedback_event_id' is distinct from feedback_id then
    raise exception 'feedback_session_mismatch';
  end if;

  if p_session_status is distinct from (case p_feedback_event ->> 'action'
       when 'ACCEPT' then 'ACCEPTED'
       when 'EDIT' then 'EDITED'
       when 'REJECT' then 'REJECTED'
     end)
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'submission_id', '') is distinct from submission_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'action', '') is distinct from p_feedback_event ->> 'action'
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'final_title', '') is distinct from writer_title
     or nullif(p_learning_event ->> 'event_type', '') is distinct from 'WRITER_' || (p_feedback_event ->> 'action') then
    raise exception 'feedback_projection_mismatch';
  end if;

  select sessions.operator_id,
         coalesce(
           sessions.assigned_to_user_id,
           sessions.created_by_user_id,
           sessions.operator_id
         ),
         sessions.tenant_id,
         coalesce(sessions.user_id, sessions.operator_id, sessions.created_by_user_id),
         coalesce(sessions.stable_asset_id, sessions.asset_id),
         coalesce(sessions.client_asset_ref, sessions.asset_id),
         sessions.asset_fingerprint,
         coalesce(sessions.model_version, nullif(sessions.provider_result_summary ->> 'model', '')),
         coalesce(sessions.prompt_version, nullif(sessions.provider_result_summary ->> 'prompt_version', '')),
         sessions.final_title,
         coalesce(sessions.resolved_fields, '{}'::jsonb),
         sessions.writer_feedback_event_id,
         sessions.status,
         sessions.writer_final_title,
         sessions.learning_event_id,
         (
           select member.role
           from public.tenant_members member
           join public.users app_user on app_user.id = member.user_id
           join public.tenants tenant on tenant.id = member.tenant_id
           where member.tenant_id = p_tenant_id
             and member.user_id = p_operator_id
             and member.status = 'ACTIVE'
             and member.disabled_at is null
             and app_user.status = 'ACTIVE'
             and app_user.disabled_at is null
             and tenant.status = 'ACTIVE'
             and tenant.disabled_at is null
           limit 1
         )
  into session_operator_id,
       session_writer_id,
       session_tenant_id,
       session_user_id,
       session_asset_id,
       session_client_asset_ref,
       session_asset_fingerprint,
       session_model_version,
       session_prompt_version,
       session_ai_title,
       session_ai_sem,
       previous_feedback_id,
       session_current_status,
       session_current_writer_title,
       session_current_learning_id,
       operator_role
  from public.v4_recognition_sessions sessions
  where sessions.id = p_session_id
    and sessions.tenant_id = p_tenant_id
  for update;

  if not found
     or session_tenant_id is distinct from p_tenant_id
     or operator_role is null
     or (
       session_writer_id is distinct from p_operator_id
       and operator_role is distinct from 'OWNER'
     ) then
    return jsonb_build_object(
      'saved', false,
      'reason', 'not_found_or_not_owned'
    );
  end if;

  if nullif(p_feedback_event -> 'recognition_result' ->> 'recognition_session_id', '') is distinct from p_session_id
     or nullif(p_feedback_event ->> 'tenant_id', '') is distinct from session_tenant_id
     or nullif(p_feedback_event ->> 'user_id', '') is distinct from session_user_id
     or nullif(p_feedback_event ->> 'asset_id', '') is distinct from session_asset_id
     or nullif(p_feedback_event ->> 'client_asset_ref', '') is distinct from session_client_asset_ref
     or nullif(p_feedback_event ->> 'asset_fingerprint', '') is distinct from session_asset_fingerprint
     or nullif(p_feedback_event ->> 'model_version', '') is distinct from session_model_version
     or nullif(p_feedback_event ->> 'prompt_version', '') is distinct from session_prompt_version
     or nullif(p_feedback_event ->> 'generated_title', '') is distinct from nullif(session_ai_title, '')
     or nullif(p_feedback_event -> 'recognition_result' ->> 'ai_title', '') is distinct from nullif(session_ai_title, '')
     or coalesce(p_feedback_event -> 'recognition_result' -> 'ai_sem', '{}'::jsonb) is distinct from session_ai_sem
     or nullif(p_feedback_event -> 'recognition_result' ->> 'client_asset_ref', '') is distinct from session_client_asset_ref
     or nullif(p_feedback_event -> 'recognition_result' ->> 'asset_fingerprint', '') is distinct from session_asset_fingerprint
     or nullif(p_feedback_event -> 'recognition_result' -> 'data_identity' ->> 'tenant_id', '') is distinct from session_tenant_id
     or nullif(p_feedback_event -> 'recognition_result' -> 'data_identity' ->> 'user_id', '') is distinct from session_user_id
     or nullif(p_feedback_event -> 'recognition_result' -> 'data_identity' ->> 'asset_id', '') is distinct from session_asset_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'tenant_id', '') is distinct from session_tenant_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'user_id', '') is distinct from session_user_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'asset_id', '') is distinct from session_asset_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'operator_id', '') is distinct from p_operator_id
     or nullif(p_learning_event ->> 'tenant_id', '') is distinct from session_tenant_id
     or nullif(p_learning_event ->> 'user_id', '') is distinct from session_user_id
     or nullif(p_learning_event ->> 'asset_id', '') is distinct from session_asset_id
     or nullif(p_learning_event ->> 'generated_title', '') is distinct from nullif(session_ai_title, '')
     or nullif(p_learning_event ->> 'writer_final_title', '') is distinct from writer_title then
    raise exception 'feedback_recognition_snapshot_mismatch';
  end if;

  if (p_feedback_event ->> 'action' = 'REJECT' and writer_title is not null)
     or (p_feedback_event ->> 'action' <> 'REJECT' and writer_title is null)
     or (p_feedback_event ->> 'action' = 'ACCEPT' and writer_title is distinct from nullif(session_ai_title, ''))
     or (p_feedback_event ->> 'action' = 'EDIT' and writer_title is not distinct from nullif(session_ai_title, '')) then
    raise exception 'feedback_action_title_invariant_failed';
  end if;

  if (p_feedback_event ->> 'action' = 'REJECT'
      and coalesce(p_learning_event -> 'sem_extraction' ->> 'validation_status', '') <> 'REJECTED')
     or (p_feedback_event ->> 'action' <> 'REJECT'
      and coalesce(p_learning_event -> 'sem_extraction' ->> 'validation_status', '') <> 'PENDING') then
    raise exception 'feedback_sem_candidate_status_invalid';
  end if;

  select events.id,
         events.payload_sha256,
         learning.id
  into existing_feedback_id,
       existing_payload_sha256,
       existing_learning_id
  from public.v4_writer_feedback_events events
  left join public.v4_learning_events learning
    on learning.feedback_event_id = events.id
  where events.recognition_session_id = p_session_id
    and events.submission_id = submission_id
  for share of events;

  if found then
    if existing_feedback_id is distinct from feedback_id
       or existing_payload_sha256 is distinct from incoming_payload_sha256
       or existing_learning_id is distinct from learning_id then
      return jsonb_build_object(
        'saved', false,
        'conflict', true,
        'reason', 'feedback_submission_payload_mismatch',
        'recognition_session_id', p_session_id,
        'feedback_event_id', feedback_id
      );
    end if;

    select events.feedback_revision
    into current_feedback_revision
    from public.v4_writer_feedback_events events
    where events.id = previous_feedback_id
      and events.recognition_session_id = p_session_id;

    return jsonb_build_object(
      'saved', true,
      'deduplicated', true,
      'recognition_session_id', p_session_id,
      'status', session_current_status,
      'feedback_event_id', previous_feedback_id,
      'learning_event_id', session_current_learning_id,
      'feedback_revision', current_feedback_revision,
      'writer_final_title', session_current_writer_title,
      'submitted_feedback_event_id', feedback_id,
      'superseded_retry', previous_feedback_id is distinct from feedback_id
    );
  end if;

  if exists (
    select 1
    from public.v4_writer_feedback_events events
    where events.id = feedback_id
  ) or exists (
    select 1
    from public.v4_learning_events events
    where events.id = learning_id
  ) then
    return jsonb_build_object(
      'saved', false,
      'conflict', true,
      'reason', 'feedback_event_identity_collision',
      'recognition_session_id', p_session_id,
      'feedback_event_id', feedback_id
    );
  end if;

  select coalesce(max(events.feedback_revision), 0) + 1
  into next_feedback_revision
  from public.v4_writer_feedback_events events
  where events.recognition_session_id = p_session_id;

  insert into public.v4_writer_feedback_events (
    id,
    recognition_session_id,
    schema_version,
    submission_id,
    payload_sha256,
    tenant_id,
    user_id,
    asset_id,
    client_asset_ref,
    asset_fingerprint,
    model_version,
    prompt_version,
    action,
    generated_title,
    writer_final_title,
    writer_raw_title,
    writer_normalized_title,
    recognition_result,
    writer_feedback,
    title_diff,
    diff_algorithm_version,
    field_graph,
    correction_type,
    operator_id,
    previous_feedback_event_id,
    feedback_revision,
    client_occurred_at,
    received_at,
    created_at,
    sem_standard_version,
    dataset_disposition
  ) values (
    feedback_id,
    p_session_id,
    coalesce(nullif(p_feedback_event ->> 'schema_version', ''), 'v4-recognition-session-v1'),
    submission_id,
    incoming_payload_sha256,
    session_tenant_id,
    session_user_id,
    session_asset_id,
    session_client_asset_ref,
    session_asset_fingerprint,
    session_model_version,
    session_prompt_version,
    p_feedback_event ->> 'action',
    nullif(p_feedback_event ->> 'generated_title', ''),
    writer_title,
    nullif(p_feedback_event ->> 'writer_raw_title', ''),
    nullif(p_feedback_event ->> 'writer_normalized_title', ''),
    coalesce(p_feedback_event -> 'recognition_result', '{}'::jsonb),
    coalesce(p_feedback_event -> 'writer_feedback', '{}'::jsonb),
    coalesce(p_feedback_event -> 'title_diff', '{}'::jsonb),
    coalesce(nullif(p_feedback_event ->> 'diff_algorithm_version', ''), 'whitespace-token-lcs-v1'),
    coalesce(p_feedback_event -> 'field_graph', '{}'::jsonb),
    nullif(p_feedback_event ->> 'correction_type', ''),
    p_operator_id,
    case when previous_feedback_id = feedback_id then null else previous_feedback_id end,
    next_feedback_revision,
    nullif(p_feedback_event ->> 'client_occurred_at', '')::timestamptz,
    clock_timestamp(),
    clock_timestamp(),
    coalesce(nullif(p_feedback_event ->> 'sem_standard_version', ''), 'linear-cos-10-23-v25'),
    'OBSERVE_ONLY'
  );

  insert into public.v4_learning_events (
    id,
    tenant_id,
    recognition_session_id,
    schema_version,
    feedback_event_id,
    event_type,
    generated_title,
    writer_final_title,
    field_level_ground_truth,
    candidate_reranker_dataset,
    hard_negative_samples,
    training_eligible,
    created_at,
    feedback_training_event,
    field_level_diff,
    candidate_changes,
    sem_standard_version,
    feedback_layer,
    semantic_learning_status,
    semantic_truth,
    writer_semantic_label_required,
    sem_extraction,
    sem_validation,
    error_candidates,
    dataset_disposition
  ) values (
    learning_id,
    session_tenant_id,
    p_session_id,
    coalesce(nullif(p_learning_event ->> 'schema_version', ''), 'v4-recognition-session-v1'),
    feedback_id,
    coalesce(nullif(p_learning_event ->> 'event_type', ''), 'WRITER_EDIT'),
    nullif(p_learning_event ->> 'generated_title', ''),
    nullif(p_learning_event ->> 'writer_final_title', ''),
    coalesce(p_learning_event -> 'field_level_ground_truth', '[]'::jsonb),
    coalesce(p_learning_event -> 'candidate_reranker_dataset', '[]'::jsonb),
    coalesce(p_learning_event -> 'hard_negative_samples', '[]'::jsonb),
    false,
    clock_timestamp(),
    coalesce(p_learning_event -> 'feedback_training_event', '{}'::jsonb),
    coalesce(p_learning_event -> 'field_level_diff', '[]'::jsonb),
    coalesce(p_learning_event -> 'candidate_changes', '{}'::jsonb),
    coalesce(nullif(p_learning_event ->> 'sem_standard_version', ''), 'linear-cos-10-23-v25'),
    'COMMERCIAL_FEEDBACK',
    case
      when p_feedback_event ->> 'action' = 'REJECT' then 'REJECTED_COMMERCIAL_FEEDBACK'
      else 'PARSER_CANDIDATE_PENDING_REVIEW'
    end,
    false,
    p_feedback_event ->> 'action' <> 'REJECT',
    coalesce(p_learning_event -> 'sem_extraction', '{}'::jsonb),
    coalesce(p_learning_event -> 'sem_validation', '{}'::jsonb),
    coalesce(p_learning_event -> 'error_candidates', '[]'::jsonb),
    'OBSERVE_ONLY'
  );

  update public.v4_recognition_sessions sessions
  set status = p_session_status,
      writer_final_title = writer_title,
      writer_feedback_event_id = feedback_id,
      learning_event_id = learning_id,
      updated_at = clock_timestamp()
  where sessions.id = p_session_id
    and sessions.tenant_id = p_tenant_id;

  get diagnostics write_count = row_count;
  if write_count <> 1 then
    raise exception 'feedback_session_projection_conflict';
  end if;

  return jsonb_build_object(
    'saved', true,
    'deduplicated', false,
    'tenant_id', p_tenant_id,
    'recognition_session_id', p_session_id,
    'status', p_session_status,
    'feedback_event_id', feedback_id,
    'learning_event_id', learning_id,
    'feedback_revision', next_feedback_revision,
    'dataset_disposition', 'OBSERVE_ONLY'
  );
end;
$$;

revoke all on function public.persist_v4_writer_feedback_transaction(text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_v4_writer_feedback_transaction(text, text, text, text, jsonb, jsonb)
  to service_role;

alter table public.listing_assets
  add column if not exists asset_fingerprint text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.listing_assets'::regclass
      and conname = 'listing_assets_asset_fingerprint_check'
  ) then
    alter table public.listing_assets
      add constraint listing_assets_asset_fingerprint_check
      check (asset_fingerprint is null or asset_fingerprint ~ '^[0-9a-f]{64}$')
      not valid;
  end if;
end;
$$;

alter table public.listing_assets
  validate constraint listing_assets_asset_fingerprint_check;

-- Batch, recognition-session stub, and all paired stage jobs are one
-- idempotent transaction. This is required by Track C's tenant/batch FK and
-- also makes the session/job identity winner indivisible under concurrency.
create or replace function public.enqueue_v4_recognition_batch_atomic(
  p_tenant_id text,
  p_operator_id text,
  p_batch jsonb,
  p_sessions jsonb,
  p_jobs jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id text := nullif(pg_catalog.btrim(p_batch ->> 'id'), '');
  v_enqueue_identity text := nullif(p_batch -> 'metadata' ->> 'enqueue_identity_sha256', '');
  v_batch_item_count_text text := nullif(p_batch ->> 'item_count', '');
  v_job_count integer := case
    when pg_catalog.jsonb_typeof(p_jobs) = 'array' then pg_catalog.jsonb_array_length(p_jobs)
    else 0
  end;
  v_session_count integer := case
    when pg_catalog.jsonb_typeof(p_sessions) = 'array' then pg_catalog.jsonb_array_length(p_sessions)
    else 0
  end;
  v_distinct_count integer := 0;
  v_batch public.v4_recognition_batches%rowtype;
  v_session public.v4_recognition_sessions%rowtype;
  v_job public.v4_recognition_jobs%rowtype;
  v_asset public.listing_assets%rowtype;
  v_session_json jsonb;
  v_job_json jsonb;
  v_front_path text;
  v_back_path text;
  v_additional_paths jsonb;
  v_write_count integer := 0;
  v_session_inserted integer := 0;
  v_job_inserted integer := 0;
  v_accepted integer := 0;
  v_queued integer := 0;
  v_deduplicated integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null
     or nullif(pg_catalog.btrim(p_operator_id), '') is null
     or p_tenant_id !~ '^[A-Za-z0-9_-]{1,128}$'
     or v_batch_id is null
     or pg_catalog.jsonb_typeof(p_batch) <> 'object'
     or pg_catalog.jsonb_typeof(p_batch -> 'metadata') <> 'object'
     or v_enqueue_identity !~ '^[0-9a-f]{64}$'
     or coalesce(v_batch_item_count_text, '') !~ '^[0-9]{1,3}$'
     or pg_catalog.jsonb_typeof(p_sessions) <> 'array'
     or pg_catalog.jsonb_typeof(p_jobs) <> 'array'
     or v_session_count < 1
     or v_job_count < 1
     or v_session_count > 250
     or v_job_count > 500
     or nullif(p_batch ->> 'tenant_id', '') is distinct from p_tenant_id
     or nullif(p_batch ->> 'operator_id', '') is distinct from p_operator_id then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_atomic_enqueue_request');
  end if;

  if v_batch_item_count_text::integer <> v_job_count then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_atomic_enqueue_item_count');
  end if;

  if not exists (
    select 1
    from public.tenant_members member
    join public.users app_user on app_user.id = member.user_id
    join public.tenants tenant on tenant.id = member.tenant_id
    where member.tenant_id = p_tenant_id
      and member.user_id = p_operator_id
      and member.role in ('OWNER', 'MANAGER', 'WRITER')
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'operator_not_active_member');
  end if;

  select count(distinct session_item ->> 'id')::integer
  into v_distinct_count
  from pg_catalog.jsonb_array_elements(p_sessions) session_item;
  if v_distinct_count <> v_session_count then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'duplicate_session_id');
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    where nullif(session_item ->> 'id', '') is null
       or coalesce(nullif(session_item ->> 'asset_id', ''), '')
          !~* '^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(session_item ->> 'client_asset_ref', '') is null
       or pg_catalog.length(session_item ->> 'client_asset_ref') > 160
       or session_item ->> 'client_asset_ref' ~ '[[:cntrl:]]'
       or nullif(session_item ->> 'tenant_id', '') is distinct from p_tenant_id
       or nullif(session_item ->> 'operator_id', '') is distinct from p_operator_id
       or nullif(session_item ->> 'user_id', '') is distinct from p_operator_id
       or pg_catalog.jsonb_typeof(session_item -> 'identity_snapshot') <> 'object'
       or pg_catalog.jsonb_typeof(
            coalesce(session_item -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
          ) <> 'array'
       or nullif(session_item -> 'identity_snapshot' ->> 'tenant_id', '') is distinct from p_tenant_id
       or nullif(session_item -> 'identity_snapshot' ->> 'operator_id', '') is distinct from p_operator_id
       or nullif(session_item -> 'identity_snapshot' ->> 'user_id', '') is distinct from p_operator_id
       or nullif(session_item -> 'identity_snapshot' ->> 'asset_id', '')
          is distinct from nullif(session_item ->> 'asset_id', '')
       or nullif(session_item -> 'identity_snapshot' ->> 'client_asset_ref', '')
          is distinct from nullif(session_item ->> 'client_asset_ref', '')
       or nullif(session_item -> 'identity_snapshot' ->> 'stable_asset_id', '')
          is distinct from nullif(session_item ->> 'stable_asset_id', '')
       or nullif(session_item -> 'identity_snapshot' ->> 'asset_fingerprint', '')
          is distinct from nullif(session_item ->> 'asset_fingerprint', '')
       or (
         nullif(session_item ->> 'asset_fingerprint', '') is not null
         and nullif(session_item ->> 'asset_fingerprint', '') !~ '^[0-9a-f]{64}$'
       )
       or nullif(session_item ->> 'preingestion_bundle_id', '') is not null
       or nullif(session_item ->> 'preingestionBundleId', '') is not null
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'session_identity_invalid');
  end if;

  -- Storage paths are server-owned tenant/asset lineage. A queue caller may
  -- reference an already uploaded image, but it cannot point a canonical
  -- asset at another tenant's or another asset's object namespace.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(session_item -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where nullif(image_ref ->> 'object_path', '') is not null
      and (
        pg_catalog.length(image_ref ->> 'object_path') > 1024
        or pg_catalog.array_length(pg_catalog.string_to_array(image_ref ->> 'object_path', '/'), 1) <> 6
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 1) <> 'tenants'
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 2) <> p_tenant_id
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 3) <> 'listing-assets'
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 4) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 5) is distinct from pg_catalog.left(
          pg_catalog.btrim(
            pg_catalog.regexp_replace(
              pg_catalog.lower(session_item ->> 'asset_id'),
              '[^a-z0-9_-]+',
              '-',
              'g'
            ),
            '-'
          ),
          72
        )
        or nullif(pg_catalog.split_part(image_ref ->> 'object_path', '/', 6), '') is null
      )
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'session_image_object_path_out_of_scope');
  end if;

  select count(distinct job_item ->> 'id')::integer
  into v_distinct_count
  from pg_catalog.jsonb_array_elements(p_jobs) job_item;
  if v_distinct_count <> v_job_count then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'duplicate_job_id');
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_jobs) job_item
    where nullif(job_item ->> 'id', '') is null
       or nullif(job_item ->> 'asset_id', '') is null
       or nullif(job_item ->> 'recognition_session_id', '') is null
       or nullif(job_item ->> 'tenant_id', '') is distinct from p_tenant_id
       or nullif(job_item ->> 'operator_id', '') is distinct from p_operator_id
       or nullif(job_item ->> 'batch_id', '') is distinct from v_batch_id
       or pg_catalog.jsonb_typeof(job_item -> 'payload') <> 'object'
       or nullif(job_item -> 'payload' ->> 'recognition_session_id', '')
          is distinct from nullif(job_item ->> 'recognition_session_id', '')
       or nullif(job_item -> 'payload' ->> 'asset_id', '')
          is distinct from nullif(job_item ->> 'asset_id', '')
       or job_item -> 'payload' ? 'preingestion_bundle_id'
       or job_item -> 'payload' ? 'preingestionBundleId'
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_sessions) session_item
         where session_item ->> 'id' = job_item ->> 'recognition_session_id'
           and session_item ->> 'asset_id' = job_item ->> 'asset_id'
       )
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'job_identity_invalid');
  end if;

  -- Validate every caller-supplied scalar before the first write. PostgreSQL
  -- casts must never turn malformed JSON into a partially persisted batch.
  for v_job_json in
    select job_item
    from pg_catalog.jsonb_array_elements(p_jobs) job_item
  loop
    if coalesce(nullif(v_job_json ->> 'priority', ''), '100') !~ '^[0-9]{1,5}$'
       or coalesce(nullif(v_job_json ->> 'max_attempts', ''), '2') !~ '^[0-9]{1,2}$' then
      return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_job_scalar');
    end if;
    if coalesce(nullif(v_job_json ->> 'priority', ''), '100')::integer not between 0 and 10000
       or coalesce(nullif(v_job_json ->> 'max_attempts', ''), '2')::integer not between 1 and 10 then
      return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_job_scalar');
    end if;
    begin
      perform coalesce(
        nullif(v_job_json ->> 'not_before', '')::timestamptz,
        pg_catalog.clock_timestamp()
      );
    exception
      when invalid_text_representation or datetime_field_overflow then
        return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_job_scalar');
    end;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    group by session_item ->> 'asset_id'
    having count(distinct (session_item -> 'identity_snapshot')::text) > 1
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'root_listing_asset_identity_conflict');
  end if;

  -- listing_assets is a server-created Track C tenant root. Queue submission
  -- may bind still-null immutable identity fields, but must never become a
  -- second asset-creation endpoint.
  for v_session_json in
    select distinct on (session_item ->> 'asset_id') session_item
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    order by session_item ->> 'asset_id', session_item ->> 'id'
  loop
    select nullif(image_ref ->> 'object_path', '')
    into v_front_path
    from pg_catalog.jsonb_array_elements(
      coalesce(v_session_json -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where image_ref ->> 'image_role' = 'front_original'
    order by image_ref ->> 'object_path'
    limit 1;

    select nullif(image_ref ->> 'object_path', '')
    into v_back_path
    from pg_catalog.jsonb_array_elements(
      coalesce(v_session_json -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where image_ref ->> 'image_role' = 'back_original'
    order by image_ref ->> 'object_path'
    limit 1;

    select coalesce(pg_catalog.jsonb_agg(image_ref order by image_ref ->> 'object_path'), '[]'::jsonb)
    into v_additional_paths
    from pg_catalog.jsonb_array_elements(
      coalesce(v_session_json -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where coalesce(image_ref ->> 'image_role', '') not in ('front_original', 'back_original');

    select assets.*
    into v_asset
    from public.listing_assets assets
    where assets.id = v_session_json ->> 'asset_id'
    for update;
    if not found
       or v_asset.tenant_id is distinct from p_tenant_id then
      raise exception using errcode = '23503', message = 'root_listing_asset_not_found';
    end if;

    if (v_asset.asset_fingerprint is not null
          and nullif(v_session_json ->> 'asset_fingerprint', '') is not null
          and v_asset.asset_fingerprint is distinct from nullif(v_session_json ->> 'asset_fingerprint', ''))
       or (v_asset.front_object_path is not null and v_front_path is not null
           and v_asset.front_object_path is distinct from v_front_path)
       or (v_asset.back_object_path is not null and v_back_path is not null
           and v_asset.back_object_path is distinct from v_back_path) then
      raise exception using errcode = '23505', message = 'root_listing_asset_identity_conflict';
    end if;

    update public.listing_assets assets
    set asset_fingerprint = coalesce(
          assets.asset_fingerprint,
          nullif(v_session_json ->> 'asset_fingerprint', '')
        ),
        front_object_path = coalesce(assets.front_object_path, v_front_path),
        back_object_path = coalesce(assets.back_object_path, v_back_path),
        additional_image_paths = case
          when assets.additional_image_paths = '[]'::jsonb and v_additional_paths <> '[]'::jsonb
            then v_additional_paths
          else assets.additional_image_paths
        end
    where assets.id = v_session_json ->> 'asset_id'
      and assets.tenant_id = p_tenant_id;
  end loop;

  insert into public.v4_recognition_batches (
    id, tenant_id, created_by_user_id, assigned_to_user_id, status,
    item_count, completed_count, failed_count, metadata, created_at, updated_at
  ) values (
    v_batch_id, p_tenant_id, p_operator_id, null, 'QUEUED',
    v_job_count, 0, 0, p_batch -> 'metadata',
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
  on conflict (id) do nothing;

  select batches.*
  into v_batch
  from public.v4_recognition_batches batches
  where batches.id = v_batch_id
  for update;
  if not found
     or v_batch.tenant_id is distinct from p_tenant_id
     or v_batch.created_by_user_id is distinct from p_operator_id
     or v_batch.item_count is distinct from v_job_count
     or nullif(v_batch.metadata ->> 'enqueue_identity_sha256', '') is distinct from v_enqueue_identity then
    raise exception using errcode = '23505', message = 'queue_batch_identity_conflict';
  end if;

  for v_session_json in
    select session_item
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    order by session_item ->> 'id'
  loop
    insert into public.v4_recognition_sessions (
      id, schema_version, status, asset_id, stable_asset_id, client_asset_ref,
      asset_fingerprint, tenant_id, user_id, identity_snapshot,
      preingestion_bundle_id, route, route_reason, route_plan, request_summary,
      operator_id, created_by_user_id, assigned_to_user_id, created_at, updated_at
    ) values (
      v_session_json ->> 'id',
      coalesce(nullif(v_session_json ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      'CREATED',
      v_session_json ->> 'asset_id',
      nullif(v_session_json ->> 'stable_asset_id', ''),
      nullif(v_session_json ->> 'client_asset_ref', ''),
      nullif(v_session_json ->> 'asset_fingerprint', ''),
      p_tenant_id,
      p_operator_id,
      v_session_json -> 'identity_snapshot',
      null,
      nullif(v_session_json ->> 'route', ''),
      nullif(v_session_json ->> 'route_reason', ''),
      coalesce(v_session_json -> 'route_plan', '{}'::jsonb),
      coalesce(v_session_json -> 'request_summary', '{}'::jsonb),
      p_operator_id,
      p_operator_id,
      p_operator_id,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
    on conflict (id) do nothing;
    get diagnostics v_write_count = row_count;
    v_session_inserted := v_session_inserted + v_write_count;

    select sessions.*
    into v_session
    from public.v4_recognition_sessions sessions
    where sessions.id = v_session_json ->> 'id'
    for update;
    if not found
       or v_session.tenant_id is distinct from p_tenant_id
       or v_session.operator_id is distinct from p_operator_id
       or v_session.user_id is distinct from p_operator_id
       or v_session.created_by_user_id is distinct from p_operator_id
       or v_session.asset_id is distinct from nullif(v_session_json ->> 'asset_id', '')
       or v_session.stable_asset_id is distinct from nullif(v_session_json ->> 'stable_asset_id', '')
       or v_session.client_asset_ref is distinct from nullif(v_session_json ->> 'client_asset_ref', '')
       or v_session.asset_fingerprint is distinct from nullif(v_session_json ->> 'asset_fingerprint', '')
       or v_session.identity_snapshot is distinct from v_session_json -> 'identity_snapshot' then
      raise exception using errcode = '23505', message = 'queue_session_identity_conflict';
    end if;
  end loop;

  for v_job_json in
    select job_item
    from pg_catalog.jsonb_array_elements(p_jobs) job_item
    order by job_item ->> 'id'
  loop
    insert into public.v4_recognition_jobs (
      id, schema_version, batch_id, tenant_id, operator_id,
      created_by_user_id, assigned_to_user_id, asset_id,
      recognition_session_id, job_type, provider_id, status, lane, priority,
      parent_job_id, paired_job_id, payload, result, error, timing, queue_tags,
      attempt_count, max_attempts, not_before, created_at, updated_at
    ) values (
      v_job_json ->> 'id',
      coalesce(nullif(v_job_json ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      v_batch_id,
      p_tenant_id,
      p_operator_id,
      p_operator_id,
      p_operator_id,
      v_job_json ->> 'asset_id',
      v_job_json ->> 'recognition_session_id',
      coalesce(nullif(v_job_json ->> 'job_type', ''), 'FINAL_ASSISTED_TITLE'),
      coalesce(nullif(v_job_json ->> 'provider_id', ''), 'openai_legacy'),
      'QUEUED',
      coalesce(nullif(v_job_json ->> 'lane', ''), 'background'),
      coalesce((v_job_json ->> 'priority')::integer, 100),
      nullif(v_job_json ->> 'parent_job_id', ''),
      nullif(v_job_json ->> 'paired_job_id', ''),
      v_job_json -> 'payload',
      coalesce(v_job_json -> 'result', '{}'::jsonb),
      coalesce(v_job_json -> 'error', '{}'::jsonb),
      coalesce(v_job_json -> 'timing', '{}'::jsonb),
      coalesce(v_job_json -> 'queue_tags', '{}'::jsonb),
      0,
      coalesce((v_job_json ->> 'max_attempts')::integer, 2),
      coalesce(nullif(v_job_json ->> 'not_before', '')::timestamptz, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
    on conflict (id) do nothing;
    get diagnostics v_write_count = row_count;
    v_job_inserted := v_job_inserted + v_write_count;

    select jobs.*
    into v_job
    from public.v4_recognition_jobs jobs
    where jobs.id = v_job_json ->> 'id'
    for update;
    if not found
       or v_job.tenant_id is distinct from p_tenant_id
       or v_job.operator_id is distinct from p_operator_id
       or v_job.created_by_user_id is distinct from p_operator_id
       or v_job.batch_id is distinct from v_batch_id
       or v_job.asset_id is distinct from nullif(v_job_json ->> 'asset_id', '')
       or v_job.recognition_session_id is distinct from nullif(v_job_json ->> 'recognition_session_id', '')
       or v_job.job_type is distinct from coalesce(
            nullif(v_job_json ->> 'job_type', ''),
            'FINAL_ASSISTED_TITLE'
          )
       or v_job.lane is distinct from coalesce(nullif(v_job_json ->> 'lane', ''), 'background')
       or v_job.parent_job_id is distinct from nullif(v_job_json ->> 'parent_job_id', '')
       or v_job.paired_job_id is distinct from nullif(v_job_json ->> 'paired_job_id', '')
       or v_job.provider_id is distinct from coalesce(
            nullif(v_job_json ->> 'provider_id', ''),
            'openai_legacy'
          )
       or v_job.payload is distinct from v_job_json -> 'payload' then
      raise exception using errcode = '23505', message = 'queue_job_identity_conflict';
    end if;

    if v_job.status in ('FAILED', 'CANCELLED') then
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'saved', false,
        'row', pg_catalog.to_jsonb(v_job),
        'error', 'queue_job_terminal_retry_required',
        'retry_required', true,
        'deduplicated', true
      ));
      v_deduplicated := v_deduplicated + 1;
    else
      v_accepted := v_accepted + 1;
      if v_job.status in ('QUEUED', 'RETRYING', 'RUNNING') then
        v_queued := v_queued + 1;
      end if;
      if v_write_count = 0 then
        v_deduplicated := v_deduplicated + 1;
      end if;
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'saved', true,
        'row', pg_catalog.to_jsonb(v_job),
        'error', null,
        'deduplicated', v_write_count = 0
      ));
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'saved', true,
    'batch_id', v_batch_id,
    'jobs', v_results,
    'accepted_count', v_accepted,
    'queued_count', v_queued,
    'inserted_count', v_job_inserted,
    'deduplicated_count', v_deduplicated,
    'session_rows_written', v_session_inserted,
    'job_rows_written', v_job_inserted
  );
end;
$$;

revoke all on function public.enqueue_v4_recognition_batch_atomic(text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_v4_recognition_batch_atomic(text, text, jsonb, jsonb, jsonb)
  to service_role;

-- A heartbeat may extend only a still-live lease. The previous implementation
-- could resurrect an expired lease and let two workers cross the provider
-- side-effect boundary.
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
  lease_seconds integer := greatest(
    30,
    least(coalesce(p_lease_seconds, 300), 900)
  );
  next_expiry timestamptz := pg_catalog.clock_timestamp()
    + pg_catalog.make_interval(secs => lease_seconds);
begin
  if nullif(pg_catalog.btrim(p_job_id), '') is null
     or nullif(pg_catalog.btrim(p_worker_id), '') is null then
    return false;
  end if;

  update public.v4_recognition_jobs jobs
  set lease_expires_at = next_expiry,
      updated_at = pg_catalog.clock_timestamp()
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and jobs.lease_owner = p_worker_id
    and jobs.lease_expires_at > pg_catalog.clock_timestamp()
  returning true into heartbeat_applied;

  if coalesce(heartbeat_applied, false) then
    update public.v4_provider_capacity_leases leases
    set lease_expires_at = next_expiry,
        updated_at = pg_catalog.clock_timestamp()
    where leases.job_id = p_job_id
      and leases.lease_owner = p_worker_id;
  end if;

  return coalesce(heartbeat_applied, false);
end;
$$;

-- This is the provider side-effect fence. It both verifies and extends the
-- live RUNNING lease in one row-locking statement, then returns only the
-- persisted job context from which the handler rebuilds all ownership fields.
create or replace function public.fence_v4_recognition_job_execution(
  p_job_id text,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fenced_job public.v4_recognition_jobs%rowtype;
  lease_seconds integer := greatest(
    30,
    least(coalesce(p_lease_seconds, 300), 900)
  );
  next_expiry timestamptz := pg_catalog.clock_timestamp()
    + pg_catalog.make_interval(secs => lease_seconds);
begin
  if nullif(pg_catalog.btrim(p_job_id), '') is null
     or nullif(pg_catalog.btrim(p_worker_id), '') is null then
    return null;
  end if;

  update public.v4_recognition_jobs jobs
  set lease_expires_at = next_expiry,
      updated_at = pg_catalog.clock_timestamp()
  where jobs.id = p_job_id
    and jobs.status = 'RUNNING'
    and jobs.lease_owner = p_worker_id
    and jobs.lease_expires_at > pg_catalog.clock_timestamp()
  returning jobs.* into fenced_job;

  if not found then
    return null;
  end if;

  update public.v4_provider_capacity_leases leases
  set lease_expires_at = next_expiry,
      updated_at = pg_catalog.clock_timestamp()
  where leases.job_id = fenced_job.id
    and leases.lease_owner = fenced_job.lease_owner;

  return pg_catalog.jsonb_build_object(
    'id', fenced_job.id,
    'batch_id', fenced_job.batch_id,
    'tenant_id', fenced_job.tenant_id,
    'operator_id', fenced_job.operator_id,
    'recognition_session_id', fenced_job.recognition_session_id,
    'asset_id', fenced_job.asset_id,
    'job_type', fenced_job.job_type,
    'lane', fenced_job.lane,
    'provider_id', fenced_job.provider_id,
    'payload', fenced_job.payload,
    'queue_tags', fenced_job.queue_tags,
    'lease_owner', fenced_job.lease_owner,
    'lease_expires_at', fenced_job.lease_expires_at,
    'status', fenced_job.status
  );
end;
$$;

revoke all on function public.heartbeat_v4_recognition_job(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_v4_recognition_job(text, text, integer)
  to service_role;
revoke all on function public.fence_v4_recognition_job_execution(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.fence_v4_recognition_job_execution(text, text, integer)
  to service_role;

-- Prevent concurrent idempotency races from combining a session created by
-- one request with a job payload from another request.
create or replace function public.validate_v4_recognition_job_session_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_tenant_id text;
  parent_operator_id text;
  parent_asset_id text;
begin
  select sessions.tenant_id,
         sessions.operator_id,
         sessions.asset_id
  into parent_tenant_id,
       parent_operator_id,
       parent_asset_id
  from public.v4_recognition_sessions sessions
  where sessions.id = new.recognition_session_id
  for share;

  if not found
     or new.tenant_id is distinct from parent_tenant_id
     or new.operator_id is distinct from parent_operator_id
     or new.asset_id is distinct from parent_asset_id
     or nullif(new.payload ->> 'recognition_session_id', '') is distinct from new.recognition_session_id
     or nullif(new.payload ->> 'asset_id', '') is distinct from new.asset_id then
    raise exception 'v4_job_session_identity_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_v4_recognition_job_session_identity()
  from public, anon, authenticated;
grant execute on function public.validate_v4_recognition_job_session_identity()
  to service_role;

drop trigger if exists validate_v4_recognition_job_session_identity
  on public.v4_recognition_jobs;
create trigger validate_v4_recognition_job_session_identity
before insert or update of recognition_session_id, tenant_id, operator_id, asset_id, payload
on public.v4_recognition_jobs
for each row execute function public.validate_v4_recognition_job_session_identity();

comment on table public.v4_writer_feedback_events is
  'Append-only writer decision facts. Raw title and authoritative recognition snapshot are retained; downstream labels are projections.';
comment on column public.v4_writer_feedback_events.submission_id is
  'One committed writer decision. A client retry reuses this id; a later edit uses a new id.';
comment on column public.v4_learning_events.dataset_disposition is
  'OBSERVE_ONLY writer events cannot train or promote production state before field-level review.';
comment on table public.v4_sem_validation_events is
  'Append-only field-level SEM review decisions. VALIDATED rows may enter Golden SEM but remain OBSERVE_ONLY until a separate release gate.';
