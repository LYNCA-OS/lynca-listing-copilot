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
  feedback_id text := nullif(p_feedback_event ->> 'id', '');
  learning_id text := nullif(p_learning_event ->> 'id', '');
  writer_title text := nullif(p_feedback_event ->> 'writer_final_title', '');
begin
  if nullif(btrim(p_session_id), '') is null
     or nullif(btrim(p_operator_id), '') is null
     or feedback_id is null
     or learning_id is null
     or p_session_status not in ('ACCEPTED', 'EDITED', 'REJECTED') then
    raise exception 'invalid_feedback_transaction_payload';
  end if;

  if p_feedback_event ->> 'recognition_session_id' is distinct from p_session_id
     or p_learning_event ->> 'recognition_session_id' is distinct from p_session_id then
    raise exception 'feedback_session_mismatch';
  end if;

  select sessions.operator_id
  into session_operator_id
  from public.v4_recognition_sessions sessions
  where sessions.id = p_session_id
  for update;

  if not found or session_operator_id is distinct from p_operator_id then
    raise exception 'feedback_session_not_owned';
  end if;

  insert into public.v4_writer_feedback_events (
    id,
    recognition_session_id,
    schema_version,
    action,
    generated_title,
    writer_final_title,
    title_diff,
    field_graph,
    correction_type,
    operator_id,
    created_at,
    sem_standard_version
  ) values (
    feedback_id,
    p_session_id,
    coalesce(nullif(p_feedback_event ->> 'schema_version', ''), 'v4-recognition-session-v1'),
    coalesce(nullif(p_feedback_event ->> 'action', ''), 'EDIT'),
    nullif(p_feedback_event ->> 'generated_title', ''),
    writer_title,
    coalesce(p_feedback_event -> 'title_diff', '{}'::jsonb),
    coalesce(p_feedback_event -> 'field_graph', '{}'::jsonb),
    nullif(p_feedback_event ->> 'correction_type', ''),
    p_operator_id,
    coalesce(nullif(p_feedback_event ->> 'created_at', '')::timestamptz, clock_timestamp()),
    coalesce(nullif(p_feedback_event ->> 'sem_standard_version', ''), 'linear-cos-10-23-v25')
  )
  on conflict (id) do update
  set action = excluded.action,
      generated_title = excluded.generated_title,
      writer_final_title = excluded.writer_final_title,
      title_diff = excluded.title_diff,
      field_graph = excluded.field_graph,
      correction_type = excluded.correction_type,
      operator_id = excluded.operator_id,
      sem_standard_version = excluded.sem_standard_version;

  insert into public.v4_learning_events (
    id,
    recognition_session_id,
    schema_version,
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
    writer_semantic_label_required
  ) values (
    learning_id,
    p_session_id,
    coalesce(nullif(p_learning_event ->> 'schema_version', ''), 'v4-recognition-session-v1'),
    coalesce(nullif(p_learning_event ->> 'event_type', ''), 'WRITER_EDIT'),
    nullif(p_learning_event ->> 'generated_title', ''),
    nullif(p_learning_event ->> 'writer_final_title', ''),
    coalesce(p_learning_event -> 'field_level_ground_truth', '[]'::jsonb),
    coalesce(p_learning_event -> 'candidate_reranker_dataset', '[]'::jsonb),
    coalesce(p_learning_event -> 'hard_negative_samples', '[]'::jsonb),
    coalesce((p_learning_event ->> 'training_eligible')::boolean, false),
    coalesce(nullif(p_learning_event ->> 'created_at', '')::timestamptz, clock_timestamp()),
    coalesce(p_learning_event -> 'feedback_training_event', '{}'::jsonb),
    coalesce(p_learning_event -> 'field_level_diff', '[]'::jsonb),
    coalesce(p_learning_event -> 'candidate_changes', '{}'::jsonb),
    coalesce(nullif(p_learning_event ->> 'sem_standard_version', ''), 'linear-cos-10-23-v25'),
    coalesce(nullif(p_learning_event ->> 'feedback_layer', ''), 'COMMERCIAL_FEEDBACK'),
    coalesce(nullif(p_learning_event ->> 'semantic_learning_status', ''), 'TRAINING_CANDIDATE_FROM_WRITER_TITLE'),
    coalesce((p_learning_event ->> 'semantic_truth')::boolean, false),
    coalesce((p_learning_event ->> 'writer_semantic_label_required')::boolean, false)
  )
  on conflict (id) do update
  set event_type = excluded.event_type,
      generated_title = excluded.generated_title,
      writer_final_title = excluded.writer_final_title,
      field_level_ground_truth = excluded.field_level_ground_truth,
      candidate_reranker_dataset = excluded.candidate_reranker_dataset,
      hard_negative_samples = excluded.hard_negative_samples,
      training_eligible = excluded.training_eligible,
      feedback_training_event = excluded.feedback_training_event,
      field_level_diff = excluded.field_level_diff,
      candidate_changes = excluded.candidate_changes,
      sem_standard_version = excluded.sem_standard_version,
      feedback_layer = excluded.feedback_layer,
      semantic_learning_status = excluded.semantic_learning_status,
      semantic_truth = excluded.semantic_truth,
      writer_semantic_label_required = excluded.writer_semantic_label_required;

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
    'recognition_session_id', p_session_id,
    'status', p_session_status,
    'feedback_event_id', feedback_id,
    'learning_event_id', learning_id
  );
end;
$$;

revoke execute on function public.persist_v4_writer_feedback_transaction(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_v4_writer_feedback_transaction(text, text, text, jsonb, jsonb)
  to service_role;
