-- The feedback contract's asset_id is the durable listing_assets identifier.
-- stable_asset_id is a content identity used for grouping/replay and must not
-- replace the durable asset foreign identity in writer feedback snapshots.
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
         sessions.asset_id,
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
