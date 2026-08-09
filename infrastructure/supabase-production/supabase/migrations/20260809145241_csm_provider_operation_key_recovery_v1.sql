-- Recover one already-paid ordinary CSM operation across future model/profile
-- changes without guessing its historical payload hash. The existing primary
-- key makes (tenant_id, operation_key) the unique durable user-operation row;
-- this RPC is read-only and returns payload/result only for SUCCEEDED.

begin;

do $csm_provider_operation_key_recovery_predecessor$
declare
  exact_primary_key boolean;
begin
  if pg_catalog.to_regprocedure(
    'public.lookup_csm_thin_provider_operation_v1(text,text,text)'
  ) is null then
    raise exception using
      errcode = '55000',
      message = 'csm_provider_operation_key_recovery_predecessor_missing';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid) =
      'PRIMARY KEY (tenant_id, operation_key)'
    into exact_primary_key
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'public.csm_thin_provider_operations'::pg_catalog.regclass
    and constraint_row.contype = 'p';

  if exact_primary_key is distinct from true then
    raise exception using
      errcode = '55000',
      message = 'csm_provider_operation_key_recovery_identity_mismatch';
  end if;

  -- The immediately preceding profile-reservation migration is part of the
  -- controlled production ledger. Refuse to install this readiness contract
  -- on a partially upgraded or unexpectedly mutated authority scope.
  if not exists (
    select 1
    from public.csm_thin_provider_scopes
    where provider = 'openai'
      and account_scope = 'lynca-primary'
      and model = 'gpt-5.6-luna'
      and max_active = 120
      and max_active_tokens = 440000
      and baseline_working_max_active = 43
      and pacer_tokens_per_second = 60000
      and pacer_burst_tokens = 66000
      and token_window_target = 3600000
      and token_window_hard_limit = 4000000
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_provider_operation_key_recovery_scope_mismatch';
  end if;
end;
$csm_provider_operation_key_recovery_predecessor$;

create or replace function public.lookup_csm_thin_provider_operation_by_key_v1(
  p_tenant_id text,
  p_operation_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $csm_thin_lookup_by_key$
declare
  operation_row public.csm_thin_provider_operations%rowtype;
  latest_attempt public.csm_thin_provider_attempts%rowtype;
begin
  if pg_catalog.btrim(coalesce(p_tenant_id, '')) = ''
      or pg_catalog.btrim(coalesce(p_operation_key, '')) = '' then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'operation_identity_invalid', 'status_code', 400
    );
  end if;

  select * into operation_row
  from public.csm_thin_provider_operations
  where tenant_id = pg_catalog.btrim(p_tenant_id)
    and operation_key = pg_catalog.btrim(p_operation_key);

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'not_found', 'status_code', 200,
      'found', false
    );
  end if;

  select * into latest_attempt
  from public.csm_thin_provider_attempts
  where tenant_id = operation_row.tenant_id
    and operation_key = operation_row.operation_key
  order by attempt_no desc
  limit 1;

  if operation_row.status = 'SUCCEEDED' then
    if operation_row.terminal_result is null
        or pg_catalog.jsonb_typeof(operation_row.terminal_result) <> 'object' then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'operation_succeeded_result_missing',
        'status_code', 409
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'found_succeeded', 'status_code', 200,
      'found', true,
      'operation_status', operation_row.status,
      'payload_sha256', operation_row.payload_sha256,
      'latest_attempt_no', latest_attempt.attempt_no,
      'latest_attempt_state', latest_attempt.state,
      'result', operation_row.terminal_result
    );
  end if;

  -- FAILED/PENDING/AMBIGUOUS/CANCELLED are state evidence only. In particular,
  -- never expose an attempt result that an application could mistake for a
  -- paid success checkpoint, and never reveal its historical payload hash as
  -- a capability for a new write.
  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'found_non_success', 'status_code', 200,
    'found', true,
    'operation_status', operation_row.status,
    'latest_attempt_no', latest_attempt.attempt_no,
    'latest_attempt_state', latest_attempt.state
  );
end;
$csm_thin_lookup_by_key$;

revoke all on function public.lookup_csm_thin_provider_operation_by_key_v1(
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.lookup_csm_thin_provider_operation_by_key_v1(
  text, text
) to service_role;

commit;
