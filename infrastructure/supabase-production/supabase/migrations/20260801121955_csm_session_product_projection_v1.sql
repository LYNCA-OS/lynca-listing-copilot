-- Additive CSM product-read-model projection v1.
--
-- `persist_csm_stage_packet_v1` inserts the immutable marketplace output and
-- then marks composition COMPLETE in one transaction.  Project the small
-- writer-facing read model in that same final UPDATE, instead of asking the
-- application to perform a second fallible write after the atomic RPC.
--
-- Reversibility: a later additive migration may drop the readiness function,
-- trigger, and projection function below without touching CSM facts. Rows
-- written by this projection are
-- tagged in provider_result_summary.  Untouched rows can also be unprojected
-- safely by requiring the tag, no writer_feedback_event_id, and equality with
-- their immutable CSM output; a row changed by a writer must never be rolled
-- back automatically.

create or replace function private.project_csm_session_product_read_model_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $csm_product_projection$
declare
  output_row public.csm_marketplace_outputs%rowtype;
  output_count integer;
  sem_projection jsonb;
  owner_versions jsonb := coalesce(new.csm_owner_versions, '{}'::jsonb);
  projection_summary jsonb;
begin
  if new.schema_version <> 'csm-recognition-session-v1'
     or new.csm_composition_stage_status <> 'COMPLETE' then
    return new;
  end if;

  select pg_catalog.count(*)
    into output_count
  from public.csm_marketplace_outputs output
  where output.tenant_id = new.tenant_id
    and output.recognition_session_id = new.id;

  if output_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'csm_product_projection_requires_one_output';
  end if;

  select output.*
    into strict output_row
  from public.csm_marketplace_outputs output
  where output.tenant_id = new.tenant_id
    and output.recognition_session_id = new.id;

  sem_projection := output_row.structured_output -> 'sem';
  if pg_catalog.jsonb_typeof(sem_projection) <> 'object' then
    raise exception using
      errcode = '23514',
      message = 'csm_product_projection_requires_sem_object';
  end if;
  if pg_catalog.jsonb_typeof(new.provider_result_summary) <> 'object' then
    raise exception using
      errcode = '23514',
      message = 'csm_product_projection_requires_summary_object';
  end if;

  -- Keep unknown receipts as explicit JSON null rather than deleting their
  -- keys.  That distinguishes "this provider call predates receipt capture"
  -- from "the product projection forgot to carry the receipt contract".
  projection_summary := pg_catalog.jsonb_build_object(
    'csm_product_projection_version', 'csm-session-product-projection-v1',
    'provider', coalesce(
      nullif(owner_versions ->> 'provider', ''),
      'openai'
    ),
    'model', nullif(owner_versions ->> 'model', ''),
    'prompt_version', nullif(owner_versions ->> 'prompt_version', ''),
    'reasoning_effort', coalesce(
      nullif(owner_versions ->> 'reasoning_effort', ''),
      nullif(owner_versions ->> 'effort', '')
    ),
    'provider_image_detail', nullif(owner_versions ->> 'image_detail', ''),
    'provider_response_id', nullif(owner_versions ->> 'provider_response_id', ''),
    'provider_request_id', nullif(owner_versions ->> 'provider_request_id', ''),
    'provider_client_request_id', nullif(
      owner_versions ->> 'provider_client_request_id', ''
    ),
    'latency_ms', owner_versions -> 'latency_ms',
    'input_tokens', owner_versions -> 'input_tokens',
    'output_tokens', owner_versions -> 'output_tokens',
    'total_tokens', owner_versions -> 'total_tokens',
    'provider_prompt_mode', 'csm_thin_direct',
    'title_stage', 'CSM_COMPOSITION',
    'assisted_draft_status', 'REVIEW_REQUIRED',
    'writer_review_required', true,
    'outcome_type', 'WRITER_REVIEW_REQUIRED',
    'csm_contract_version', new.csm_contract_version,
    'csm_registry_release_id', new.csm_registry_release_id,
    'resolver_version', nullif(owner_versions ->> 'resolver', ''),
    'composer_version', output_row.composer_version,
    'marketplace_profile_version', output_row.marketplace_profile_version,
    'title_length_policy', pg_catalog.jsonb_build_object(
      'marketplace', output_row.marketplace,
      'max_length', 80
    )
  );

  new.status := 'WRITER_REVIEW';
  new.final_title := output_row.title;
  new.resolved_fields := sem_projection;
  new.provider_result_summary := coalesce(new.provider_result_summary, '{}'::jsonb)
    || projection_summary;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$csm_product_projection$;

revoke all on function private.project_csm_session_product_read_model_v1()
  from public, anon, authenticated;
grant execute on function private.project_csm_session_product_read_model_v1()
  to service_role;

drop trigger if exists project_csm_session_product_read_model_v1
  on public.v4_recognition_sessions;
create trigger project_csm_session_product_read_model_v1
before update of csm_composition_stage_status
on public.v4_recognition_sessions
for each row
when (
  new.schema_version = 'csm-recognition-session-v1'
  and new.csm_composition_stage_status = 'COMPLETE'
)
execute function private.project_csm_session_product_read_model_v1();

-- Backfill is fail-closed.  It may populate a pristine CSM session or attach
-- the tag to an already-identical projection, but it never overwrites a title,
-- SEM object, or workflow state that could have been changed by a writer.
do $csm_product_projection_backfill_preflight$
declare
  conflict_session_id text;
begin
  select session_row.id
    into conflict_session_id
  from public.v4_recognition_sessions session_row
  left join lateral (
    select
      pg_catalog.count(*) as output_count,
      pg_catalog.min(output.title) as title,
      pg_catalog.min(output.structured_output::text)::jsonb -> 'sem' as sem
    from public.csm_marketplace_outputs output
    where output.tenant_id = session_row.tenant_id
      and output.recognition_session_id = session_row.id
  ) projection on true
  where session_row.schema_version = 'csm-recognition-session-v1'
    and session_row.csm_composition_stage_status = 'COMPLETE'
    and (
      projection.output_count <> 1
      or nullif(pg_catalog.btrim(projection.title), '') is null
      or pg_catalog.jsonb_typeof(projection.sem) <> 'object'
      or pg_catalog.jsonb_typeof(session_row.provider_result_summary) <> 'object'
      or (
        session_row.provider_result_summary ->> 'csm_product_projection_version'
          is distinct from 'csm-session-product-projection-v1'
        and not (
          (
            session_row.status = 'CREATED'
            and session_row.final_title is null
            and session_row.resolved_fields = '{}'::jsonb
            and session_row.provider_result_summary = '{}'::jsonb
          )
          or (
            session_row.status = 'WRITER_REVIEW'
            and session_row.final_title is not distinct from projection.title
            and session_row.resolved_fields is not distinct from projection.sem
          )
        )
      )
    )
  order by session_row.id
  limit 1;

  if conflict_session_id is not null then
    raise exception using
      errcode = '23514',
      message = 'csm_product_projection_backfill_requires_remediation:'
        || conflict_session_id;
  end if;
end;
$csm_product_projection_backfill_preflight$;

-- Mentioning the column in SET fires the projection trigger even though the
-- stage is already COMPLETE.  The preflight above proves this is non-lossy.
update public.v4_recognition_sessions session_row
set csm_composition_stage_status = 'COMPLETE'
where session_row.schema_version = 'csm-recognition-session-v1'
  and session_row.csm_composition_stage_status = 'COMPLETE'
  and session_row.provider_result_summary ->> 'csm_product_projection_version'
    is distinct from 'csm-session-product-projection-v1';

comment on function private.project_csm_session_product_read_model_v1() is
  'Atomically projects one completed CSM marketplace output into the writer-facing recognition-session read model.';

-- Fail before the paid provider boundary when the schema was not activated.
-- This is deliberately a live catalog check rather than a hard-coded version
-- flag: a disabled trigger or a same-name trigger rebound to another function
-- returns not-ready.
create or replace function public.check_csm_session_product_projection_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $csm_product_projection_readiness$
declare
  expected_function oid := pg_catalog.to_regprocedure(
    'private.project_csm_session_product_read_model_v1()'
  );
  composition_attribute smallint;
  trigger_enabled "char";
  trigger_function oid;
  trigger_type smallint;
  trigger_attributes text;
  trigger_when_expression text;
begin
  select attribute.attnum
    into composition_attribute
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.v4_recognition_sessions'::pg_catalog.regclass
    and attribute.attname = 'csm_composition_stage_status'
    and not attribute.attisdropped;

  select trigger_row.tgenabled,
         trigger_row.tgfoid,
         trigger_row.tgtype,
         trigger_row.tgattr::text,
         pg_catalog.regexp_replace(
           pg_catalog.split_part(
             pg_catalog.split_part(
               pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
               ' WHEN (',
               2
             ),
             ') EXECUTE FUNCTION ',
             1
           ),
           '[[:space:]]+',
           ' ',
           'g'
         )
    into trigger_enabled, trigger_function, trigger_type, trigger_attributes,
         trigger_when_expression
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.v4_recognition_sessions'::pg_catalog.regclass
    and trigger_row.tgname = 'project_csm_session_product_read_model_v1'
    and not trigger_row.tgisinternal;

  if expected_function is null
     or composition_attribute is null
     or trigger_enabled not in ('O', 'A')
     or trigger_function is distinct from expected_function
     -- ROW (1) + BEFORE (2) + UPDATE (16), with no other event bits.
     or trigger_type <> 19
     or trigger_attributes is distinct from composition_attribute::text
     -- pg_get_expr(tgqual, tgrelid) cannot deparse OLD/NEW together on PG17;
     -- pg_get_triggerdef is PostgreSQL's trigger-aware deparser for tgqual.
     or trigger_when_expression is distinct from
       'new.schema_version = ''csm-recognition-session-v1''::text AND new.csm_composition_stage_status = ''COMPLETE''::text' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'csm_product_projection_not_ready',
      'version', 'csm-session-product-projection-v1'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'csm_product_projection_ready',
    'version', 'csm-session-product-projection-v1'
  );
end;
$csm_product_projection_readiness$;

revoke all on function public.check_csm_session_product_projection_v1()
  from public, anon, authenticated;
grant execute on function public.check_csm_session_product_projection_v1()
  to service_role;

comment on function public.check_csm_session_product_projection_v1() is
  'Service-role readiness probe that verifies the live CSM product projection trigger binding before provider spend.';
