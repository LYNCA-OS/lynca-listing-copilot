alter table if exists public.card_image_embeddings
  alter column model_revision set default 'f775b65a79762255128c981547af89addcfe0f88';

alter table if exists public.card_identity_prototypes
  alter column model_revision set default 'f775b65a79762255128c981547af89addcfe0f88';

alter table if exists public.vector_fingerprints
  alter column model_revision set default 'f775b65a79762255128c981547af89addcfe0f88';

create or replace function public.promote_card_reference_to_approved(
  p_identity_id uuid,
  p_reference_image_id uuid,
  p_actor text default null,
  p_source_gap_id uuid default null,
  p_source_feedback_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  identity_id uuid,
  reference_image_id uuid,
  promotion_event_id uuid,
  embedding_count integer,
  retrieval_status text,
  reference_status text,
  approved_for_retrieval boolean
)
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_identity_status text;
  v_identity_reference_status text;
  v_reference_status text;
  v_next_retrieval_status text;
  v_next_identity_reference_status text;
  v_event_id uuid;
  v_embedding_count integer := 0;
begin
  if p_identity_id is null then
    raise exception 'identity_id is required' using errcode = '22023';
  end if;

  if p_reference_image_id is null then
    raise exception 'reference_image_id is required' using errcode = '22023';
  end if;

  select ci.retrieval_status, ci.reference_status
    into v_identity_status, v_identity_reference_status
  from public.card_identities ci
  where ci.identity_id = p_identity_id
  for update;

  if not found then
    raise exception 'card identity % not found', p_identity_id using errcode = 'P0002';
  end if;

  select cri.reference_status
    into v_reference_status
  from public.card_reference_images cri
  where cri.reference_image_id = p_reference_image_id
    and cri.identity_id = p_identity_id
  for update;

  if not found then
    raise exception 'reference image % does not belong to identity %', p_reference_image_id, p_identity_id using errcode = 'P0002';
  end if;

  v_next_retrieval_status := case
    when v_identity_status = 'registry' then 'registry'
    else 'approved'
  end;
  v_next_identity_reference_status := case
    when v_identity_status = 'registry' then 'registry'
    else 'approved'
  end;

  update public.card_identities ci
  set
    retrieval_enabled = true,
    retrieval_status = v_next_retrieval_status,
    reference_status = v_next_identity_reference_status,
    updated_at = v_now,
    source_record = jsonb_strip_nulls(
      coalesce(ci.source_record, '{}'::jsonb)
      || jsonb_build_object(
        'last_reference_promotion_at', v_now,
        'last_reference_promotion_by', nullif(p_actor, ''),
        'last_promoted_reference_image_id', p_reference_image_id
      )
    )
  where ci.identity_id = p_identity_id;

  update public.card_reference_images cri
  set
    approved_for_retrieval = true,
    reference_status = 'approved',
    metadata = jsonb_strip_nulls(
      coalesce(cri.metadata, '{}'::jsonb)
      || coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'retrieval_status', v_next_retrieval_status,
        'reference_status', 'approved',
        'promotion_status', 'approved',
        'promoted_at', v_now,
        'promoted_by', nullif(p_actor, '')
      )
    )
  where cri.reference_image_id = p_reference_image_id
    and cri.identity_id = p_identity_id;

  update public.card_image_embeddings cie
  set metadata = jsonb_strip_nulls(
    coalesce(cie.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'retrieval_eligible', true,
      'approved_for_retrieval', true,
      'reference_status', 'approved',
      'index_status', 'active',
      'promotion_status', 'approved',
      'promoted_at', v_now,
      'promoted_by', nullif(p_actor, '')
    )
  )
  where cie.reference_image_id = p_reference_image_id
    and cie.identity_id = p_identity_id;

  get diagnostics v_embedding_count = row_count;

  insert into public.card_reference_promotion_events (
    identity_id,
    reference_image_id,
    source_gap_id,
    source_feedback_id,
    action,
    actor,
    before_status,
    after_status,
    metadata
  )
  values (
    p_identity_id,
    p_reference_image_id,
    p_source_gap_id,
    p_source_feedback_id,
    case
      when v_identity_status = 'candidate' then 'promote_new_identity'
      else 'approve_reference_image'
    end,
    nullif(p_actor, ''),
    concat_ws(':', v_identity_status, v_identity_reference_status, v_reference_status),
    concat_ws(':', v_next_retrieval_status, v_next_identity_reference_status, 'approved'),
    jsonb_strip_nulls(
      coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'embedding_count', v_embedding_count,
        'retrieval_enabled', true,
        'approved_for_retrieval', true,
        'index_status', 'active'
      )
    )
  )
  returning card_reference_promotion_events.promotion_event_id into v_event_id;

  if p_source_gap_id is not null then
    update public.catalog_gap_queue cgq
    set
      status = 'approved',
      resolved_identity_id = p_identity_id,
      reviewed_by = coalesce(nullif(p_actor, ''), cgq.reviewed_by),
      source_feedback_id = coalesce(cgq.source_feedback_id, p_source_feedback_id),
      updated_at = v_now,
      metadata = jsonb_strip_nulls(
        coalesce(cgq.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'promotion_event_id', v_event_id,
          'promoted_reference_image_id', p_reference_image_id,
          'promoted_at', v_now
        )
      )
    where cgq.gap_id = p_source_gap_id;
  end if;

  return query
  select
    p_identity_id,
    p_reference_image_id,
    v_event_id,
    v_embedding_count,
    v_next_retrieval_status,
    'approved'::text,
    true;
end;
$$;

revoke all on function public.promote_card_reference_to_approved(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;

grant execute on function public.promote_card_reference_to_approved(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  jsonb
) to service_role;

comment on function public.promote_card_reference_to_approved(uuid, uuid, text, uuid, uuid, jsonb) is
  'Atomically promotes a reviewed reference image into approved retrieval eligibility, updates identity/reference/embedding index metadata, and writes a promotion audit event. Service-role only.';
