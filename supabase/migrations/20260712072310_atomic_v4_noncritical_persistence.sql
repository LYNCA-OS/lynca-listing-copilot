-- Collapse the four post-title learning writes into one idempotent transaction.
-- The writer-ready response is already durable before this RPC runs; this
-- function only persists evidence, candidate, gap, and quality artifacts.

create or replace function public.persist_v4_noncritical_artifacts(
  p_session_id text,
  p_field_evidence jsonb default '[]'::jsonb,
  p_candidate_trace jsonb default null,
  p_catalog_gap jsonb default null,
  p_quality_ledger jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field_evidence_count integer := 0;
  v_candidate_trace_saved boolean := false;
  v_catalog_gap_saved boolean := false;
  v_quality_ledger_saved boolean := false;
begin
  if coalesce(p_session_id, '') = '' then
    raise exception 'missing_session_id';
  end if;
  if not exists (select 1 from public.v4_recognition_sessions where id = p_session_id) then
    raise exception 'recognition_session_not_found:%', p_session_id;
  end if;

  if jsonb_typeof(coalesce(p_field_evidence, '[]'::jsonb)) = 'array' then
    insert into public.v4_field_evidence (
      id,
      recognition_session_id,
      field_name,
      field_value,
      display_status,
      source_type,
      provenance,
      confidence,
      created_at
    )
    select
      row.id,
      p_session_id,
      row.field_name,
      row.field_value,
      coalesce(nullif(row.display_status, ''), 'NORMAL'),
      coalesce(nullif(row.source_type, ''), 'V4_RESULT_ADAPTER'),
      coalesce(row.provenance, '{}'::jsonb),
      row.confidence,
      coalesce(row.created_at, now())
    from jsonb_to_recordset(coalesce(p_field_evidence, '[]'::jsonb)) as row(
      id text,
      recognition_session_id text,
      field_name text,
      field_value text,
      display_status text,
      source_type text,
      provenance jsonb,
      confidence double precision,
      created_at timestamptz
    )
    where coalesce(row.id, '') <> ''
      and coalesce(row.field_name, '') <> ''
    on conflict (id) do update set
      field_value = excluded.field_value,
      display_status = excluded.display_status,
      source_type = excluded.source_type,
      provenance = excluded.provenance,
      confidence = excluded.confidence;
    get diagnostics v_field_evidence_count = row_count;
  end if;

  if p_candidate_trace is not null and jsonb_typeof(p_candidate_trace) = 'object' then
    insert into public.v4_candidate_traces (
      id,
      recognition_session_id,
      schema_version,
      trace,
      created_at
    ) values (
      coalesce(nullif(p_candidate_trace ->> 'id', ''), p_session_id || '_candidate_trace'),
      p_session_id,
      coalesce(nullif(p_candidate_trace ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      coalesce(p_candidate_trace -> 'trace', '{}'::jsonb),
      coalesce((p_candidate_trace ->> 'created_at')::timestamptz, now())
    )
    on conflict (id) do update set
      schema_version = excluded.schema_version,
      trace = excluded.trace;
    v_candidate_trace_saved := true;
  end if;

  if p_catalog_gap is not null and jsonb_typeof(p_catalog_gap) = 'object' then
    insert into public.v4_catalog_gap_queue (
      id,
      recognition_session_id,
      asset_id,
      gap_type,
      observed_fields,
      candidate_snapshot,
      draft_title,
      status,
      created_at,
      updated_at
    ) values (
      p_catalog_gap ->> 'id',
      p_session_id,
      nullif(p_catalog_gap ->> 'asset_id', ''),
      coalesce(nullif(p_catalog_gap ->> 'gap_type', ''), 'CATALOG_IDENTITY_GAP'),
      coalesce(p_catalog_gap -> 'observed_fields', '{}'::jsonb),
      coalesce(p_catalog_gap -> 'candidate_snapshot', '{}'::jsonb),
      nullif(p_catalog_gap ->> 'draft_title', ''),
      coalesce(nullif(p_catalog_gap ->> 'status', ''), 'OPEN'),
      coalesce((p_catalog_gap ->> 'created_at')::timestamptz, now()),
      coalesce((p_catalog_gap ->> 'updated_at')::timestamptz, now())
    )
    on conflict (id) do update set
      recognition_session_id = excluded.recognition_session_id,
      observed_fields = excluded.observed_fields,
      candidate_snapshot = excluded.candidate_snapshot,
      draft_title = excluded.draft_title,
      status = excluded.status,
      updated_at = excluded.updated_at;
    v_catalog_gap_saved := true;
  end if;

  if p_quality_ledger is not null and jsonb_typeof(p_quality_ledger) = 'object' then
    insert into public.v4_production_quality_ledger (
      id,
      recognition_session_id,
      schema_version,
      route,
      provider,
      model,
      status,
      confidence,
      latency_ms,
      input_tokens,
      output_tokens,
      total_tokens,
      provider_error_type,
      token_diagnostics,
      timing,
      route_plan,
      warnings,
      persistence_summary,
      provider_diagnostics,
      pipeline_node_ledger,
      created_at
    ) values (
      coalesce(nullif(p_quality_ledger ->> 'id', ''), p_session_id || '_quality'),
      p_session_id,
      coalesce(nullif(p_quality_ledger ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      nullif(p_quality_ledger ->> 'route', ''),
      nullif(p_quality_ledger ->> 'provider', ''),
      nullif(p_quality_ledger ->> 'model', ''),
      nullif(p_quality_ledger ->> 'status', ''),
      nullif(p_quality_ledger ->> 'confidence', ''),
      nullif(p_quality_ledger ->> 'latency_ms', '')::double precision,
      nullif(p_quality_ledger ->> 'input_tokens', '')::integer,
      nullif(p_quality_ledger ->> 'output_tokens', '')::integer,
      nullif(p_quality_ledger ->> 'total_tokens', '')::integer,
      nullif(p_quality_ledger ->> 'provider_error_type', ''),
      coalesce(p_quality_ledger -> 'token_diagnostics', '{}'::jsonb),
      coalesce(p_quality_ledger -> 'timing', '{}'::jsonb),
      coalesce(p_quality_ledger -> 'route_plan', '{}'::jsonb),
      coalesce(p_quality_ledger -> 'warnings', '[]'::jsonb),
      coalesce(p_quality_ledger -> 'persistence_summary', '{}'::jsonb),
      coalesce(p_quality_ledger -> 'provider_diagnostics', '{}'::jsonb),
      coalesce(p_quality_ledger -> 'pipeline_node_ledger', '{}'::jsonb),
      coalesce((p_quality_ledger ->> 'created_at')::timestamptz, now())
    )
    on conflict (id) do update set
      route = excluded.route,
      provider = excluded.provider,
      model = excluded.model,
      status = excluded.status,
      confidence = excluded.confidence,
      latency_ms = excluded.latency_ms,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens,
      provider_error_type = excluded.provider_error_type,
      token_diagnostics = excluded.token_diagnostics,
      timing = excluded.timing,
      route_plan = excluded.route_plan,
      warnings = excluded.warnings,
      persistence_summary = excluded.persistence_summary,
      provider_diagnostics = excluded.provider_diagnostics,
      pipeline_node_ledger = excluded.pipeline_node_ledger;
    v_quality_ledger_saved := true;
  end if;

  return jsonb_build_object(
    'saved', true,
    'recognition_session_id', p_session_id,
    'field_evidence_count', v_field_evidence_count,
    'candidate_trace_saved', v_candidate_trace_saved,
    'catalog_gap_saved', v_catalog_gap_saved,
    'quality_ledger_saved', v_quality_ledger_saved
  );
end;
$$;

revoke all on function public.persist_v4_noncritical_artifacts(text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_v4_noncritical_artifacts(text, jsonb, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.persist_v4_noncritical_artifacts(text, jsonb, jsonb, jsonb, jsonb) is
  'Atomically persists post-title V4 evidence, candidate, catalog-gap, and quality artifacts after writer readiness.';
