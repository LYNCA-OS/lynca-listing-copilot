-- Additive COS-25 transport closure.
--
-- One recognition_session_id is one immutable attempt. The RPC locks that
-- session, compares the three canonical packet hashes, inserts the complete
-- six-table CSM graph, and marks the session COMPLETE in one transaction.
-- It never mutates an already-applied historical migration.

-- The thin path has no external Registry dependency, but every resolution
-- must still name the exact semantic/rule release it used.
insert into public.csm_registry_releases (
  id, registry_version, content_sha256, sem_standard_version,
  registry_payload, promoted_by, promoted_at
) values (
  'registry_thin_sem_v25',
  'thin-path-registry-release-v1',
  'ac36d845fe8ca6ad21b017560736864f077fc67a1a864ad9947ac25b8432a6c7',
  'linear-cos-10-23-v25',
  '{"mode":"local_sem_and_composer_only","external_catalog":false}'::jsonb,
  'migration:20260801123000',
  '2026-08-01T12:30:00Z'::timestamptz
)
on conflict (id) do nothing;

do $csm_registry_release_contract$
begin
  if not exists (
    select 1
    from public.csm_registry_releases
    where id = 'registry_thin_sem_v25'
      and registry_version = 'thin-path-registry-release-v1'
      and content_sha256 = 'ac36d845fe8ca6ad21b017560736864f077fc67a1a864ad9947ac25b8432a6c7'
      and sem_standard_version = 'linear-cos-10-23-v25'
      and registry_payload = '{"mode":"local_sem_and_composer_only","external_catalog":false}'::jsonb
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_registry_release_contract_mismatch:registry_thin_sem_v25';
  end if;
end;
$csm_registry_release_contract$;

-- Make the transport's conflict-key contract a migration-time assertion
-- against PostgreSQL's actual primary keys. Tests parse this same VALUES list;
-- deployment also fails if the database has drifted.
do $csm_primary_key_contract$
declare
  expected record;
  actual_columns text;
begin
  for expected in
    select * from (values
      ('csm_evidence_observations', 'id'),
      ('csm_bracket_candidates', 'id'),
      ('csm_candidate_evidence_links', 'candidate_id,evidence_observation_id,relationship'),
      ('csm_identity_resolutions', 'id'),
      ('csm_resolved_brackets', 'resolution_id,bracket'),
      ('csm_marketplace_outputs', 'id')
    ) as primary_keys(table_name, column_names)
  loop
    select pg_catalog.string_agg(attribute.attname, ',' order by key_column.ordinality)
      into actual_columns
    from pg_catalog.pg_constraint constraint_row
    cross join lateral pg_catalog.unnest(constraint_row.conkey)
      with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = key_column.attnum
    where constraint_row.conrelid = pg_catalog.to_regclass('public.' || expected.table_name)
      and constraint_row.contype = 'p';

    if actual_columns is distinct from expected.column_names then
      raise exception using
        errcode = '55000',
        message = 'csm_primary_key_contract_mismatch:' || expected.table_name;
    end if;
  end loop;
end;
$csm_primary_key_contract$;

create or replace function public.persist_csm_stage_packet_v1(
  p_tenant_id text,
  p_recognition_session_id text,
  p_packet jsonb,
  p_session_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_atomic_rpc$
declare
  session_row public.v4_recognition_sessions%rowtype;
  recognition_hash text;
  resolution_hash text;
  marketplace_hash text;
  present_hash_count integer;
  evidence_count integer := 0;
  candidate_count integer := 0;
  link_count integer := 0;
  resolution_count integer := 0;
  resolved_count integer := 0;
  output_count integer := 0;
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null
     or nullif(pg_catalog.btrim(p_recognition_session_id), '') is null then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'missing_csm_stage_row_identity', 'status_code', 400
    );
  end if;
  if pg_catalog.jsonb_typeof(p_packet) <> 'object'
     or pg_catalog.jsonb_typeof(p_session_patch) <> 'object'
     or pg_catalog.jsonb_typeof(p_packet -> 'evidence') <> 'array'
     or pg_catalog.jsonb_typeof(p_packet -> 'candidates') <> 'array'
     or pg_catalog.jsonb_typeof(p_packet -> 'links') <> 'array'
     or pg_catalog.jsonb_typeof(p_packet -> 'resolution') <> 'object'
     or pg_catalog.jsonb_typeof(p_packet -> 'resolved') <> 'array'
     or pg_catalog.jsonb_typeof(p_packet -> 'output') <> 'object'
     or pg_catalog.jsonb_typeof(p_packet -> 'session_hashes') <> 'object' then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_csm_atomic_packet_shape', 'status_code', 400
    );
  end if;

  recognition_hash := p_packet #>> '{session_hashes,csm_recognition_packet_sha256}';
  resolution_hash := p_packet #>> '{session_hashes,csm_resolution_packet_sha256}';
  marketplace_hash := p_packet #>> '{session_hashes,csm_marketplace_packet_sha256}';
  if recognition_hash is null or recognition_hash !~ '^[0-9a-f]{64}$'
     or resolution_hash is null or resolution_hash !~ '^[0-9a-f]{64}$'
     or marketplace_hash is null or marketplace_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_csm_packet_hashes', 'status_code', 400
    );
  end if;
  if p_packet #>> '{resolution,recognition_packet_sha256}' is distinct from recognition_hash
     or p_packet #>> '{output,resolution_packet_sha256}' is distinct from resolution_hash then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'csm_packet_lineage_hash_mismatch', 'status_code', 400
    );
  end if;

  -- Security-definer input must not be able to smuggle rows across a tenant or
  -- recognition session. Foreign keys are a second line, not the first.
  if exists (
    select 1
    from (
      select value as fact from pg_catalog.jsonb_array_elements(p_packet -> 'evidence')
      union all select value from pg_catalog.jsonb_array_elements(p_packet -> 'candidates')
      union all select value from pg_catalog.jsonb_array_elements(p_packet -> 'links')
      union all select p_packet -> 'resolution'
      union all select value from pg_catalog.jsonb_array_elements(p_packet -> 'resolved')
      union all select p_packet -> 'output'
    ) facts
    where facts.fact ->> 'tenant_id' is distinct from p_tenant_id
       or facts.fact ->> 'recognition_session_id' is distinct from p_recognition_session_id
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'mixed_csm_stage_row_identity', 'status_code', 400
    );
  end if;

  select * into session_row
  from public.v4_recognition_sessions
  where tenant_id = p_tenant_id and id = p_recognition_session_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'csm_session_not_found', 'status_code', 409
    );
  end if;

  present_hash_count :=
    (session_row.csm_recognition_packet_sha256 is not null)::integer
    + (session_row.csm_resolution_packet_sha256 is not null)::integer
    + (session_row.csm_marketplace_packet_sha256 is not null)::integer;

  if present_hash_count = 3 then
    if session_row.csm_recognition_packet_sha256 is distinct from recognition_hash
       or session_row.csm_resolution_packet_sha256 is distinct from resolution_hash
       or session_row.csm_marketplace_packet_sha256 is distinct from marketplace_hash then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'immutable_session_conflict', 'status_code', 409
      );
    end if;
    if session_row.csm_recognition_stage_status = 'COMPLETE'
       and session_row.csm_resolution_stage_status = 'COMPLETE'
       and session_row.csm_composition_stage_status = 'COMPLETE' then
      return pg_catalog.jsonb_build_object(
        'ok', true, 'code', 'exact_replay', 'status_code', 200,
        'replayed', true, 'atomic', true,
        'written', pg_catalog.jsonb_build_object(
          'csm_evidence_observations', 0,
          'csm_bracket_candidates', 0,
          'csm_candidate_evidence_links', 0,
          'csm_identity_resolutions', 0,
          'csm_resolved_brackets', 0,
          'csm_marketplace_outputs', 0
        )
      );
    end if;
    -- A transaction-backed writer cannot produce this state. Do not adopt a
    -- partial legacy REST attempt without an explicit remediation migration.
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'csm_atomic_attempt_incomplete', 'status_code', 409
    );
  elsif present_hash_count <> 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'csm_session_hash_state_incomplete', 'status_code', 409
    );
  end if;

  if exists (select 1 from public.csm_evidence_observations where tenant_id = p_tenant_id and recognition_session_id = p_recognition_session_id)
     or exists (select 1 from public.csm_bracket_candidates where tenant_id = p_tenant_id and recognition_session_id = p_recognition_session_id)
     or exists (select 1 from public.csm_candidate_evidence_links where tenant_id = p_tenant_id and recognition_session_id = p_recognition_session_id)
     or exists (select 1 from public.csm_identity_resolutions where tenant_id = p_tenant_id and recognition_session_id = p_recognition_session_id)
     or exists (select 1 from public.csm_resolved_brackets where tenant_id = p_tenant_id and recognition_session_id = p_recognition_session_id)
     or exists (select 1 from public.csm_marketplace_outputs where tenant_id = p_tenant_id and recognition_session_id = p_recognition_session_id) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'csm_unclaimed_partial_state', 'status_code', 409
    );
  end if;

  if p_session_patch ->> 'csm_recognition_packet_sha256' is distinct from recognition_hash
     or p_session_patch ->> 'csm_resolution_packet_sha256' is distinct from resolution_hash
     or p_session_patch ->> 'csm_marketplace_packet_sha256' is distinct from marketplace_hash
     or p_session_patch ->> 'csm_contract_version' is distinct from p_packet #>> '{resolution,contract_version}'
     or p_session_patch ->> 'csm_registry_release_id' is distinct from p_packet #>> '{resolution,registry_release_id}'
     or p_session_patch ->> 'csm_grammar' is distinct from p_packet #>> '{resolution,grammar}'
     or coalesce(p_session_patch ->> 'recognition_pipeline_fingerprint', '') !~ '^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(p_session_patch -> 'csm_owner_versions') <> 'object'
     or p_session_patch -> 'csm_owner_versions' = '{}'::jsonb then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_csm_session_patch', 'status_code', 400
    );
  end if;

  insert into public.csm_evidence_observations (
    id, tenant_id, recognition_session_id, contract_version, bracket,
    raw_value, normalized_value, modality, source_ref,
    observation_confidence, normalization_version,
    normalization_outcome, normalization_reason_code
  )
  select id, tenant_id, recognition_session_id, contract_version, bracket,
    raw_value, normalized_value, modality, source_ref,
    observation_confidence, normalization_version,
    normalization_outcome, normalization_reason_code
  from pg_catalog.jsonb_to_recordset(p_packet -> 'evidence') as fact(
    id text, tenant_id text, recognition_session_id text, contract_version text,
    bracket text, raw_value jsonb, normalized_value jsonb, modality text,
    source_ref jsonb, observation_confidence double precision,
    normalization_version text, normalization_outcome text,
    normalization_reason_code text
  );
  get diagnostics evidence_count = row_count;

  insert into public.csm_bracket_candidates (
    id, tenant_id, recognition_session_id, contract_version, bracket,
    value_kind, canonical_value, empty_reason, source_trust,
    candidate_confidence, candidate_rank
  )
  select id, tenant_id, recognition_session_id, contract_version, bracket,
    value_kind, canonical_value, empty_reason, source_trust,
    candidate_confidence, candidate_rank
  from pg_catalog.jsonb_to_recordset(p_packet -> 'candidates') as fact(
    id text, tenant_id text, recognition_session_id text, contract_version text,
    bracket text, value_kind text, canonical_value jsonb, empty_reason text,
    source_trust text, candidate_confidence double precision, candidate_rank integer
  );
  get diagnostics candidate_count = row_count;

  insert into public.csm_candidate_evidence_links (
    tenant_id, recognition_session_id, candidate_id,
    evidence_observation_id, relationship
  )
  select tenant_id, recognition_session_id, candidate_id,
    evidence_observation_id, relationship
  from pg_catalog.jsonb_to_recordset(p_packet -> 'links') as fact(
    tenant_id text, recognition_session_id text, candidate_id text,
    evidence_observation_id text, relationship text
  );
  get diagnostics link_count = row_count;

  insert into public.csm_identity_resolutions (
    id, tenant_id, recognition_session_id, contract_version, revision,
    grammar, registry_release_id, resolver_version, conflict_policy_version,
    recognition_packet_sha256, resolution_status
  )
  select id, tenant_id, recognition_session_id, contract_version, revision,
    grammar, registry_release_id, resolver_version, conflict_policy_version,
    recognition_packet_sha256, resolution_status
  from pg_catalog.jsonb_to_record(p_packet -> 'resolution') as fact(
    id text, tenant_id text, recognition_session_id text, contract_version text,
    revision integer, grammar text, registry_release_id text,
    resolver_version text, conflict_policy_version text,
    recognition_packet_sha256 text, resolution_status text
  );
  get diagnostics resolution_count = row_count;

  insert into public.csm_resolved_brackets (
    tenant_id, recognition_session_id, resolution_id, bracket, selected_kind,
    canonical_value, empty_reason, selected_candidate_id,
    alternate_candidate_ids, rationale_codes, semantic_confidence
  )
  select tenant_id, recognition_session_id, resolution_id, bracket, selected_kind,
    canonical_value, empty_reason, selected_candidate_id,
    alternate_candidate_ids, rationale_codes, semantic_confidence
  from pg_catalog.jsonb_to_recordset(p_packet -> 'resolved') as fact(
    tenant_id text, recognition_session_id text, resolution_id text,
    bracket text, selected_kind text, canonical_value jsonb, empty_reason text,
    selected_candidate_id text, alternate_candidate_ids jsonb,
    rationale_codes jsonb, semantic_confidence double precision
  );
  get diagnostics resolved_count = row_count;

  insert into public.csm_marketplace_outputs (
    id, tenant_id, recognition_session_id, resolution_id, contract_version,
    marketplace, composer_version, marketplace_profile_version,
    resolution_packet_sha256, title, structured_output,
    included_brackets, dropped_trace
  )
  select id, tenant_id, recognition_session_id, resolution_id, contract_version,
    marketplace, composer_version, marketplace_profile_version,
    resolution_packet_sha256, title, structured_output,
    included_brackets, dropped_trace
  from pg_catalog.jsonb_to_record(p_packet -> 'output') as fact(
    id text, tenant_id text, recognition_session_id text, resolution_id text,
    contract_version text, marketplace text, composer_version text,
    marketplace_profile_version text, resolution_packet_sha256 text,
    title text, structured_output jsonb, included_brackets jsonb,
    dropped_trace jsonb
  );
  get diagnostics output_count = row_count;

  update public.v4_recognition_sessions
  set csm_contract_version = p_session_patch ->> 'csm_contract_version',
      csm_registry_release_id = p_session_patch ->> 'csm_registry_release_id',
      csm_grammar = p_session_patch ->> 'csm_grammar',
      csm_grammar_confidence = (p_session_patch ->> 'csm_grammar_confidence')::double precision,
      recognition_pipeline_fingerprint = p_session_patch ->> 'recognition_pipeline_fingerprint',
      csm_owner_versions = p_session_patch -> 'csm_owner_versions',
      csm_recognition_stage_status = 'COMPLETE',
      csm_resolution_stage_status = 'COMPLETE',
      csm_composition_stage_status = 'COMPLETE',
      csm_recognition_packet_sha256 = recognition_hash,
      csm_resolution_packet_sha256 = resolution_hash,
      csm_marketplace_packet_sha256 = marketplace_hash
  where tenant_id = p_tenant_id and id = p_recognition_session_id;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'inserted', 'status_code', 200,
    'replayed', false, 'atomic', true, 'session_saved', true,
    'written', pg_catalog.jsonb_build_object(
      'csm_evidence_observations', evidence_count,
      'csm_bracket_candidates', candidate_count,
      'csm_candidate_evidence_links', link_count,
      'csm_identity_resolutions', resolution_count,
      'csm_resolved_brackets', resolved_count,
      'csm_marketplace_outputs', output_count
    )
  );
end;
$csm_atomic_rpc$;

revoke all on function public.persist_csm_stage_packet_v1(text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_csm_stage_packet_v1(text, text, jsonb, jsonb)
  to service_role;
;
