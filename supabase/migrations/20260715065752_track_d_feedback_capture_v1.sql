-- Track D / Day-1 capture boundary.
-- Raw writer decisions are immutable facts. SEM, error labels, and training
-- eligibility remain derived, review-gated projections.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '15min';

alter table if exists public.v4_recognition_sessions
  add column if not exists tenant_id text,
  add column if not exists user_id text,
  add column if not exists stable_asset_id text,
  add column if not exists client_asset_ref text,
  add column if not exists asset_fingerprint text,
  add column if not exists identity_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists model_version text,
  add column if not exists prompt_version text,
  add column if not exists prompt_mode text,
  add column if not exists generation_completed_at timestamptz;

update public.v4_recognition_sessions
set tenant_id = coalesce(nullif(tenant_id, ''), nullif(operator_id, '')),
    user_id = coalesce(nullif(user_id, ''), nullif(operator_id, '')),
    client_asset_ref = coalesce(nullif(client_asset_ref, ''), nullif(asset_id, '')),
    model_version = coalesce(nullif(model_version, ''), nullif(provider_result_summary ->> 'model', '')),
    prompt_version = coalesce(nullif(prompt_version, ''), nullif(provider_result_summary ->> 'prompt_version', '')),
    prompt_mode = coalesce(nullif(prompt_mode, ''), nullif(provider_result_summary ->> 'provider_prompt_mode', '')),
    identity_snapshot = case
      when identity_snapshot = '{}'::jsonb then jsonb_build_object(
        'schema_version', 'data-identity-v1',
        'tenant_id', coalesce(nullif(tenant_id, ''), nullif(operator_id, '')),
        'user_id', coalesce(nullif(user_id, ''), nullif(operator_id, '')),
        'operator_id', nullif(operator_id, ''),
        'asset_id', coalesce(nullif(stable_asset_id, ''), nullif(asset_id, '')),
        'stable_asset_id', nullif(stable_asset_id, ''),
        'client_asset_ref', coalesce(nullif(client_asset_ref, ''), nullif(asset_id, '')),
        'asset_fingerprint', nullif(asset_fingerprint, ''),
        'asset_identity_status', case when asset_fingerprint is not null then 'FINGERPRINT_UNVERIFIED' else 'CLIENT_REF_ONLY' end,
        'tenant_identity_source', 'LEGACY_OPERATOR_BACKFILL',
        'user_identity_source', 'LEGACY_OPERATOR_BACKFILL'
      )
      else identity_snapshot
    end;

alter table if exists public.v4_writer_feedback_events
  add column if not exists submission_id text,
  add column if not exists payload_sha256 text,
  add column if not exists tenant_id text,
  add column if not exists user_id text,
  add column if not exists asset_id text,
  add column if not exists client_asset_ref text,
  add column if not exists asset_fingerprint text,
  add column if not exists model_version text,
  add column if not exists prompt_version text,
  add column if not exists writer_raw_title text,
  add column if not exists writer_normalized_title text,
  add column if not exists recognition_result jsonb not null default '{}'::jsonb,
  add column if not exists writer_feedback jsonb not null default '{}'::jsonb,
  add column if not exists diff_algorithm_version text not null default 'legacy-token-set-v0',
  add column if not exists previous_feedback_event_id text,
  add column if not exists feedback_revision bigint,
  add column if not exists client_occurred_at timestamptz,
  add column if not exists received_at timestamptz not null default clock_timestamp(),
  add column if not exists dataset_disposition text not null default 'LEGACY_CAPTURE';

update public.v4_writer_feedback_events as events
set submission_id = coalesce(nullif(events.submission_id, ''), events.id),
    tenant_id = coalesce(nullif(events.tenant_id, ''), sessions.tenant_id),
    user_id = coalesce(nullif(events.user_id, ''), sessions.user_id, sessions.operator_id),
    asset_id = coalesce(nullif(events.asset_id, ''), sessions.stable_asset_id, sessions.asset_id),
    client_asset_ref = coalesce(nullif(events.client_asset_ref, ''), sessions.client_asset_ref, sessions.asset_id),
    asset_fingerprint = coalesce(nullif(events.asset_fingerprint, ''), sessions.asset_fingerprint),
    model_version = coalesce(nullif(events.model_version, ''), sessions.model_version, nullif(sessions.provider_result_summary ->> 'model', '')),
    prompt_version = coalesce(nullif(events.prompt_version, ''), sessions.prompt_version, nullif(sessions.provider_result_summary ->> 'prompt_version', '')),
    writer_raw_title = coalesce(
      events.writer_raw_title,
      nullif(events.title_diff ->> 'raw_writer_title', ''),
      events.writer_final_title
    ),
    writer_normalized_title = coalesce(events.writer_normalized_title, events.writer_final_title),
    recognition_result = case
      when recognition_result = '{}'::jsonb then jsonb_build_object(
        'schema_version', 'legacy-v4-feedback-snapshot-v0',
        'result_id', events.recognition_session_id,
        'recognition_session_id', events.recognition_session_id,
        'tenant_id', sessions.tenant_id,
        'user_id', coalesce(sessions.user_id, sessions.operator_id),
        'asset_id', coalesce(sessions.stable_asset_id, sessions.asset_id),
        'client_asset_ref', coalesce(sessions.client_asset_ref, sessions.asset_id),
        'asset_fingerprint', sessions.asset_fingerprint,
        'ai_title', events.generated_title,
        'ai_sem', coalesce(events.field_graph, '{}'::jsonb),
        'model_version', sessions.model_version,
        'prompt_version', sessions.prompt_version,
        'legacy_backfill', true
      )
      else recognition_result
    end,
    writer_feedback = case
      when writer_feedback = '{}'::jsonb then jsonb_build_object(
        'schema_version', 'legacy-v4-feedback-snapshot-v0',
        'submission_id', coalesce(nullif(events.submission_id, ''), events.id),
        'tenant_id', sessions.tenant_id,
        'user_id', coalesce(sessions.user_id, sessions.operator_id),
        'asset_id', coalesce(sessions.stable_asset_id, sessions.asset_id),
        'action', events.action,
        'final_title', coalesce(nullif(events.title_diff ->> 'raw_writer_title', ''), events.writer_final_title),
        'normalized_title', events.writer_final_title,
        'legacy_backfill', true
      )
      else writer_feedback
    end,
    received_at = coalesce(events.created_at, events.received_at),
    dataset_disposition = coalesce(nullif(events.dataset_disposition, ''), 'LEGACY_CAPTURE')
from public.v4_recognition_sessions sessions
where sessions.id = events.recognition_session_id;

with ranked as (
  select id,
         row_number() over (
           partition by recognition_session_id
           order by created_at asc, id asc
         ) as revision
  from public.v4_writer_feedback_events
)
update public.v4_writer_feedback_events events
set feedback_revision = ranked.revision
from ranked
where events.id = ranked.id
  and events.feedback_revision is null;

alter table if exists public.v4_writer_feedback_events
  alter column submission_id set not null;

alter table if exists public.v4_learning_events
  add column if not exists feedback_event_id text,
  add column if not exists sem_extraction jsonb not null default '{}'::jsonb,
  add column if not exists sem_validation jsonb not null default '{}'::jsonb,
  add column if not exists error_candidates jsonb not null default '[]'::jsonb,
  add column if not exists dataset_disposition text not null default 'LEGACY_CAPTURE';

update public.v4_learning_events
set training_eligible = false,
    dataset_disposition = 'OBSERVE_ONLY'
where event_type like 'WRITER_%';

update public.v4_learning_events
set semantic_truth = false,
    semantic_learning_status = 'PARSER_CANDIDATE_PENDING_REVIEW'
where event_type like 'WRITER_%'
  and semantic_truth = false;

create table if not exists public.v4_sem_validation_events (
  id text primary key,
  schema_version text not null default 'sem-validation-event-v1',
  learning_event_id text not null references public.v4_learning_events(id) on delete restrict,
  feedback_event_id text not null references public.v4_writer_feedback_events(id) on delete restrict,
  recognition_session_id text not null references public.v4_recognition_sessions(id) on delete restrict,
  tenant_id text,
  user_id text,
  asset_id text,
  identity_group_id text,
  parser_version text,
  sem_standard_version text,
  candidate_sem jsonb not null default '{}'::jsonb,
  validated_sem jsonb not null default '{}'::jsonb,
  confidence double precision,
  validation_status text not null,
  validation_sources jsonb not null default '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  semantic_truth boolean not null default false,
  golden_sem_candidate boolean not null default false,
  dataset_disposition text not null default 'OBSERVE_ONLY',
  training_eligible boolean not null default false,
  payload_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint v4_sem_validation_status_check
    check (validation_status in ('PENDING', 'VALIDATED', 'REJECTED')),
  constraint v4_sem_validation_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint v4_sem_validation_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint v4_sem_validation_truth_check
    check (
      (validation_status = 'VALIDATED' and semantic_truth = true and golden_sem_candidate = true)
      or (validation_status <> 'VALIDATED' and semantic_truth = false and golden_sem_candidate = false)
    ),
  constraint v4_sem_validation_review_check
    check (
      validation_status = 'PENDING'
      or (nullif(reviewed_by, '') is not null and reviewed_at is not null)
    ),
  constraint v4_sem_validation_value_check
    check (validation_status <> 'VALIDATED' or validated_sem <> '{}'::jsonb),
  constraint v4_sem_validation_training_gate_check
    check (training_eligible = false)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'v4_writer_feedback_action_check'
      and conrelid = 'public.v4_writer_feedback_events'::regclass
  ) then
    alter table public.v4_writer_feedback_events
      add constraint v4_writer_feedback_action_check
      check (action in ('ACCEPT', 'EDIT', 'REJECT')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'v4_writer_feedback_payload_sha256_check'
      and conrelid = 'public.v4_writer_feedback_events'::regclass
  ) then
    alter table public.v4_writer_feedback_events
      add constraint v4_writer_feedback_payload_sha256_check
      check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'v4_writer_feedback_previous_event_fk'
      and conrelid = 'public.v4_writer_feedback_events'::regclass
  ) then
    alter table public.v4_writer_feedback_events
      add constraint v4_writer_feedback_previous_event_fk
      foreign key (previous_feedback_event_id)
      references public.v4_writer_feedback_events(id)
      on delete restrict
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'v4_learning_feedback_event_fk'
      and conrelid = 'public.v4_learning_events'::regclass
  ) then
    alter table public.v4_learning_events
      add constraint v4_learning_feedback_event_fk
      foreign key (feedback_event_id)
      references public.v4_writer_feedback_events(id)
      on delete restrict
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'v4_writer_feedback_action_title_check'
      and conrelid = 'public.v4_writer_feedback_events'::regclass
  ) then
    alter table public.v4_writer_feedback_events
      add constraint v4_writer_feedback_action_title_check
      check (
        (action = 'REJECT' and nullif(writer_final_title, '') is null)
        or (action = 'ACCEPT'
          and nullif(writer_final_title, '') is not null
          and writer_final_title is not distinct from generated_title)
        or (action = 'EDIT'
          and nullif(writer_final_title, '') is not null
          and writer_final_title is distinct from generated_title)
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'v4_writer_feedback_projection_check'
      and conrelid = 'public.v4_writer_feedback_events'::regclass
  ) then
    alter table public.v4_writer_feedback_events
      add constraint v4_writer_feedback_projection_check
      check (
        nullif(writer_feedback ->> 'action', '') is not distinct from action
        and nullif(writer_feedback ->> 'final_title', '') is not distinct from nullif(writer_final_title, '')
        and nullif(recognition_result ->> 'recognition_session_id', '') is not distinct from recognition_session_id
        and nullif(recognition_result ->> 'ai_title', '') is not distinct from nullif(generated_title, '')
      ) not valid;
  end if;
end $$;

alter table public.v4_writer_feedback_events
  validate constraint v4_writer_feedback_action_check;
alter table public.v4_writer_feedback_events
  validate constraint v4_writer_feedback_payload_sha256_check;
alter table public.v4_writer_feedback_events
  validate constraint v4_writer_feedback_previous_event_fk;
alter table public.v4_learning_events
  validate constraint v4_learning_feedback_event_fk;

-- The two projection checks intentionally remain NOT VALID for legacy rows;
-- PostgreSQL still enforces them for every new feedback fact.

create unique index if not exists v4_writer_feedback_submission_uidx
  on public.v4_writer_feedback_events(recognition_session_id, submission_id);
create unique index if not exists v4_writer_feedback_revision_uidx
  on public.v4_writer_feedback_events(recognition_session_id, feedback_revision)
  where feedback_revision is not null;
create index if not exists v4_writer_feedback_received_idx
  on public.v4_writer_feedback_events(received_at desc);
create index if not exists v4_learning_feedback_event_idx
  on public.v4_learning_events(feedback_event_id)
  where feedback_event_id is not null;
create index if not exists v4_sem_validation_learning_idx
  on public.v4_sem_validation_events(learning_event_id, created_at desc);
create index if not exists v4_sem_validation_status_idx
  on public.v4_sem_validation_events(validation_status, created_at desc);
create index if not exists v4_recognition_sessions_tenant_user_idx
  on public.v4_recognition_sessions(tenant_id, user_id, created_at desc);
create index if not exists v4_recognition_sessions_stable_asset_idx
  on public.v4_recognition_sessions(stable_asset_id)
  where stable_asset_id is not null;
create index if not exists v4_writer_feedback_tenant_received_idx
  on public.v4_writer_feedback_events(tenant_id, received_at desc);
create index if not exists v4_writer_feedback_asset_idx
  on public.v4_writer_feedback_events(asset_id)
  where asset_id is not null;

alter table public.v4_writer_feedback_events enable row level security;
alter table public.v4_learning_events enable row level security;
alter table public.v4_sem_validation_events enable row level security;

-- Latest state is projected by v4_recognition_sessions. Superseding an old
-- derived row in place would make the event log non-reproducible.
drop trigger if exists supersede_stale_v4_writer_learning_events
  on public.v4_learning_events;

revoke all on table public.v4_writer_feedback_events from public, anon, authenticated;
revoke all on table public.v4_learning_events from public, anon, authenticated;
revoke all on table public.v4_sem_validation_events from public, anon, authenticated;
grant select, insert on table public.v4_writer_feedback_events to service_role;
grant select, insert on table public.v4_learning_events to service_role;
grant select, insert on table public.v4_sem_validation_events to service_role;
grant select, update on table public.v4_recognition_sessions to service_role;

create or replace function public.prevent_v4_session_identity_reassignment()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.tenant_id is not null and new.tenant_id is distinct from old.tenant_id then
    raise exception 'v4_session_tenant_is_immutable';
  end if;
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'v4_session_user_is_immutable';
  end if;
  if old.operator_id is not null and new.operator_id is distinct from old.operator_id then
    raise exception 'v4_session_operator_is_immutable';
  end if;
  if old.stable_asset_id is not null and new.stable_asset_id is distinct from old.stable_asset_id then
    raise exception 'v4_session_asset_is_immutable';
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
set search_path = pg_catalog, public
as $$
declare
  expected_tenant_id text;
  expected_user_id text;
  expected_asset_id text;
  expected_session_id text;
  expected_feedback_id text;
  expected_candidate_sem jsonb;
begin
  select sessions.tenant_id,
         coalesce(sessions.user_id, sessions.operator_id),
         coalesce(sessions.stable_asset_id, sessions.asset_id)
  into expected_tenant_id, expected_user_id, expected_asset_id
  from public.v4_recognition_sessions sessions
  where sessions.id = new.recognition_session_id;

  if not found
     or new.tenant_id is distinct from expected_tenant_id
     or new.user_id is distinct from expected_user_id
     or new.asset_id is distinct from expected_asset_id then
    raise exception 'sem_validation_identity_mismatch';
  end if;

  if new.learning_event_id is not null then
    select events.recognition_session_id,
           events.feedback_event_id,
           coalesce(events.sem_extraction -> 'candidate_sem', '{}'::jsonb)
    into expected_session_id, expected_feedback_id, expected_candidate_sem
    from public.v4_learning_events events
    where events.id = new.learning_event_id;

    if not found
       or expected_session_id is distinct from new.recognition_session_id
       or expected_feedback_id is distinct from new.feedback_event_id
       or expected_candidate_sem is distinct from new.candidate_sem then
      raise exception 'sem_validation_candidate_mismatch';
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

create or replace function public.persist_v4_writer_feedback_transaction(
  p_session_id text,
  p_operator_id text,
  p_session_status text,
  p_feedback_event jsonb,
  p_learning_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  session_operator_id text;
  session_tenant_id text;
  session_user_id text;
  session_asset_id text;
  session_client_asset_ref text;
  session_asset_fingerprint text;
  session_model_version text;
  session_prompt_version text;
  session_ai_title text;
  session_ai_sem jsonb;
  previous_feedback_id text;
  next_feedback_revision bigint;
  feedback_id text := nullif(p_feedback_event ->> 'id', '');
  learning_id text := nullif(p_learning_event ->> 'id', '');
  submission_id text := nullif(p_feedback_event ->> 'submission_id', '');
  incoming_payload_sha256 text := nullif(p_feedback_event ->> 'payload_sha256', '');
  existing_payload_sha256 text;
  writer_title text := nullif(p_feedback_event ->> 'writer_final_title', '');
begin
  if nullif(btrim(p_session_id), '') is null
     or nullif(btrim(p_operator_id), '') is null
     or feedback_id is null
     or learning_id is null
     or submission_id is null
     or incoming_payload_sha256 is null
     or incoming_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_session_status not in ('ACCEPTED', 'EDITED', 'REJECTED')
     or p_feedback_event ->> 'action' not in ('ACCEPT', 'EDIT', 'REJECT') then
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
         sessions.tenant_id,
         coalesce(sessions.user_id, sessions.operator_id),
         coalesce(sessions.stable_asset_id, sessions.asset_id),
         coalesce(sessions.client_asset_ref, sessions.asset_id),
         sessions.asset_fingerprint,
         coalesce(sessions.model_version, nullif(sessions.provider_result_summary ->> 'model', '')),
         coalesce(sessions.prompt_version, nullif(sessions.provider_result_summary ->> 'prompt_version', '')),
         sessions.final_title,
         coalesce(sessions.resolved_fields, '{}'::jsonb),
         sessions.writer_feedback_event_id
  into session_operator_id,
       session_tenant_id,
       session_user_id,
       session_asset_id,
       session_client_asset_ref,
       session_asset_fingerprint,
       session_model_version,
       session_prompt_version,
       session_ai_title,
       session_ai_sem,
       previous_feedback_id
  from public.v4_recognition_sessions sessions
  where sessions.id = p_session_id
  for update;

  if not found or session_operator_id is distinct from p_operator_id then
    raise exception 'feedback_session_not_owned';
  end if;

  if nullif(p_feedback_event -> 'recognition_result' ->> 'recognition_session_id', '') is distinct from p_session_id
     or nullif(p_feedback_event ->> 'tenant_id', '') is distinct from session_tenant_id
     or nullif(p_feedback_event ->> 'user_id', '') is distinct from session_user_id
     or nullif(p_feedback_event ->> 'asset_id', '') is distinct from session_asset_id
     or nullif(p_feedback_event ->> 'model_version', '') is distinct from session_model_version
     or nullif(p_feedback_event ->> 'prompt_version', '') is distinct from session_prompt_version
     or nullif(p_feedback_event ->> 'generated_title', '') is distinct from nullif(session_ai_title, '')
     or nullif(p_feedback_event -> 'recognition_result' ->> 'ai_title', '') is distinct from nullif(session_ai_title, '')
     or coalesce(p_feedback_event -> 'recognition_result' -> 'ai_sem', '{}'::jsonb) is distinct from session_ai_sem
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'tenant_id', '') is distinct from session_tenant_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'user_id', '') is distinct from session_user_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'asset_id', '') is distinct from session_asset_id
     or nullif(p_feedback_event -> 'writer_feedback' ->> 'operator_id', '') is distinct from p_operator_id
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

  select events.payload_sha256
  into existing_payload_sha256
  from public.v4_writer_feedback_events events
  where events.id = feedback_id;

  if found then
    if existing_payload_sha256 is distinct from incoming_payload_sha256 then
      return jsonb_build_object(
        'saved', false,
        'conflict', true,
        'reason', 'feedback_submission_payload_mismatch',
        'recognition_session_id', p_session_id,
        'feedback_event_id', feedback_id
      );
    end if;
    return jsonb_build_object(
      'saved', true,
      'deduplicated', true,
      'recognition_session_id', p_session_id,
      'status', p_session_status,
      'feedback_event_id', feedback_id,
      'learning_event_id', learning_id
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

  if exists (
    select 1 from public.v4_learning_events events where events.id = learning_id
  ) then
    raise exception 'learning_event_id_already_exists';
  end if;

  insert into public.v4_learning_events (
    id,
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
    and sessions.operator_id = p_operator_id;

  return jsonb_build_object(
    'saved', true,
    'deduplicated', false,
    'recognition_session_id', p_session_id,
    'status', p_session_status,
    'feedback_event_id', feedback_id,
    'learning_event_id', learning_id,
    'feedback_revision', next_feedback_revision,
    'dataset_disposition', 'OBSERVE_ONLY'
  );
end;
$$;

revoke all on function public.persist_v4_writer_feedback_transaction(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_v4_writer_feedback_transaction(text, text, text, jsonb, jsonb)
  to service_role;

comment on table public.v4_writer_feedback_events is
  'Append-only writer decision facts. Raw title and authoritative recognition snapshot are retained; downstream labels are projections.';
comment on column public.v4_writer_feedback_events.submission_id is
  'One committed writer decision. A client retry reuses this id; a later edit uses a new id.';
comment on column public.v4_learning_events.dataset_disposition is
  'OBSERVE_ONLY writer events cannot train or promote production state before field-level review.';
comment on table public.v4_sem_validation_events is
  'Append-only field-level SEM review decisions. VALIDATED rows may enter Golden SEM but remain OBSERVE_ONLY until a separate release gate.';

notify pgrst, 'reload schema';

commit;
