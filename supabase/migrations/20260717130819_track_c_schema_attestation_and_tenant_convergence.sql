-- Close the remaining Track C tenant-lineage gaps before allowing the
-- production deployment workflow to attest the schema over PostgREST.
--
-- This migration is intentionally fail-closed. It only backfills a tenant
-- when every persisted parent points to one unambiguous tenant. It never
-- deletes business rows or invents a tenant identity.

do $$
begin
  if pg_catalog.to_regclass('public.v4_sem_validation_events') is null
     or pg_catalog.to_regclass('public.v4_learning_events') is null
     or pg_catalog.to_regclass('public.v4_recognition_sessions') is null
     or pg_catalog.to_regclass('public.v4_writer_feedback_events') is null
     or pg_catalog.to_regclass('public.v4_preingestion_bundles') is null
     or pg_catalog.to_regclass('public.tenants') is null then
    raise exception using
      errcode = '55000',
      message = 'track_c_schema_attestation_prerequisite_missing';
  end if;

  if pg_catalog.to_regprocedure('public.prevent_v4_writer_feedback_mutation()') is null
     or pg_catalog.to_regprocedure('private.prevent_tenant_change()') is null then
    raise exception using
      errcode = '55000',
      message = 'track_c_schema_attestation_guard_function_missing';
  end if;
end;
$$;

-- Prove that each existing SEM validation row resolves to exactly one tenant
-- across its immutable validation, learning, session, and feedback parents.
do $$
begin
  if exists (
    select 1
    from public.v4_sem_validation_events validation
    left join public.v4_learning_events learning
      on learning.id = validation.learning_event_id
    left join public.v4_recognition_sessions session_row
      on session_row.id = validation.recognition_session_id
    left join public.v4_writer_feedback_events feedback
      on feedback.id = validation.feedback_event_id
    cross join lateral (
      select
        count(distinct candidate.tenant_id) as tenant_count,
        min(candidate.tenant_id) as tenant_id
      from pg_catalog.unnest(array[
        nullif(pg_catalog.btrim(validation.tenant_id), ''),
        nullif(pg_catalog.btrim(learning.tenant_id), ''),
        nullif(pg_catalog.btrim(session_row.tenant_id), ''),
        nullif(pg_catalog.btrim(feedback.tenant_id), '')
      ]) as candidate(tenant_id)
      where candidate.tenant_id is not null
    ) resolved
    where resolved.tenant_count <> 1
       or not exists (
         select 1
         from public.tenants tenant
         where tenant.id = resolved.tenant_id
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'v4_sem_validation_tenant_backfill_requires_remediation';
  end if;
end;
$$;

-- The append-only trigger is removed only for the deterministic tenant
-- convergence update. A later failure rolls the entire migration back,
-- including this trigger change.
drop trigger if exists prevent_v4_sem_validation_mutation
  on public.v4_sem_validation_events;

with resolved_tenants as (
  select
    validation.id,
    min(candidate.tenant_id) as tenant_id
  from public.v4_sem_validation_events validation
  left join public.v4_learning_events learning
    on learning.id = validation.learning_event_id
  left join public.v4_recognition_sessions session_row
    on session_row.id = validation.recognition_session_id
  left join public.v4_writer_feedback_events feedback
    on feedback.id = validation.feedback_event_id
  cross join lateral pg_catalog.unnest(array[
    nullif(pg_catalog.btrim(validation.tenant_id), ''),
    nullif(pg_catalog.btrim(learning.tenant_id), ''),
    nullif(pg_catalog.btrim(session_row.tenant_id), ''),
    nullif(pg_catalog.btrim(feedback.tenant_id), '')
  ]) as candidate(tenant_id)
  where candidate.tenant_id is not null
  group by validation.id
)
update public.v4_sem_validation_events validation
set tenant_id = resolved.tenant_id
from resolved_tenants resolved
where validation.id = resolved.id
  and nullif(pg_catalog.btrim(validation.tenant_id), '') is null;

create trigger prevent_v4_sem_validation_mutation
before update or delete on public.v4_sem_validation_events
for each row execute function public.prevent_v4_writer_feedback_mutation();

do $$
begin
  if exists (
    select 1
    from public.v4_sem_validation_events validation
    where nullif(pg_catalog.btrim(validation.tenant_id), '') is null
       or not exists (
         select 1
         from public.tenants tenant
         where tenant.id = validation.tenant_id
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'v4_sem_validation_tenant_convergence_failed';
  end if;
end;
$$;

alter table public.v4_sem_validation_events
  alter column tenant_id drop default,
  alter column tenant_id set not null;

alter table public.v4_sem_validation_events
  drop constraint if exists v4_sem_validation_events_tenant_id_fkey;
alter table public.v4_sem_validation_events
  add constraint v4_sem_validation_events_tenant_id_fkey
  foreign key (tenant_id)
  references public.tenants(id)
  not valid;
alter table public.v4_sem_validation_events
  validate constraint v4_sem_validation_events_tenant_id_fkey;

drop trigger if exists track_c_tenant_id_immutable
  on public.v4_sem_validation_events;
create trigger track_c_tenant_id_immutable
before update of tenant_id on public.v4_sem_validation_events
for each row execute function private.prevent_tenant_change();

-- A nullable bundle reference is allowed, but a populated reference must stay
-- in the same tenant. Refuse the migration if any legacy row is orphaned or
-- crosses a tenant boundary.
do $$
begin
  if exists (
    select 1
    from public.v4_recognition_sessions session_row
    left join public.v4_preingestion_bundles bundle
      on bundle.id = session_row.preingestion_bundle_id
    where session_row.preingestion_bundle_id is not null
      and (
        bundle.id is null
        or bundle.tenant_id is distinct from session_row.tenant_id
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'v4_session_preingestion_bundle_tenant_remediation_required';
  end if;
end;
$$;

create unique index if not exists v4_preingestion_bundles_tenant_id_uidx
  on public.v4_preingestion_bundles(tenant_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.v4_preingestion_bundles'::pg_catalog.regclass
      and index_relation.relname = 'v4_preingestion_bundles_tenant_id_uidx'
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
  ) then
    raise exception using
      errcode = '55000',
      message = 'v4_preingestion_bundle_tenant_identity_index_not_ready';
  end if;
end;
$$;

alter table public.v4_recognition_sessions
  drop constraint if exists track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f;
alter table public.v4_recognition_sessions
  add constraint track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f
  foreign key (tenant_id, preingestion_bundle_id)
  references public.v4_preingestion_bundles(tenant_id, id)
  on delete set null (preingestion_bundle_id)
  not valid;
alter table public.v4_recognition_sessions
  validate constraint track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f;

-- PostgREST does not expose policy expressions, trigger semantics, index
-- readiness, partial SET NULL columns, or role ACLs in OpenAPI. Return the
-- raw read-only catalog snapshot so the deployment script can evaluate it
-- with the exact same JavaScript contract as the direct PostgreSQL preflight.
create or replace function public.track_c_production_schema_catalog_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := '{}'::jsonb;
  v_request_role text := '';
  v_snapshot jsonb;
begin
  begin
    v_claims := coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
      '{}'
    )::jsonb;
  exception
    when others then
      raise exception using
        errcode = '42501',
        message = 'track_c_catalog_attestation_invalid_claims';
  end;

  v_request_role := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(v_claims ->> 'role', ''),
    ''
  );
  if v_request_role <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'track_c_catalog_attestation_service_role_required';
  end if;

  select pg_catalog.jsonb_build_object(
    'meta', (
      select pg_catalog.jsonb_build_object(
        'contract_version', 'track_c_catalog_snapshot_v1',
        'function_volatility', function_row.provolatile,
        'security_definer', function_row.prosecdef,
        'search_path', function_row.proconfig,
        'request_role', v_request_role
      )
      from pg_catalog.pg_proc function_row
      where function_row.oid = 'public.track_c_production_schema_catalog_snapshot()'::pg_catalog.regprocedure
    ),
    'tables', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(table_row) order by table_row.table_name)
      from (
        select
          relation.relname::text as table_name,
          true as present,
          relation.relkind::text as relation_kind,
          relation.relrowsecurity as row_level_security
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
      ) table_row
    ), '[]'::jsonb),
    'columns', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(column_row) order by column_row.table_name, column_row.ordinal_position)
      from (
        select
          columns.table_name,
          columns.column_name,
          columns.data_type,
          columns.is_nullable,
          columns.column_default,
          columns.is_generated,
          columns.generation_expression,
          columns.ordinal_position
        from information_schema.columns
        where columns.table_schema = 'public'
      ) column_row
    ), '[]'::jsonb),
    'procedures', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(procedure_row) order by procedure_row.signature)
      from (
        select
          pg_catalog.regexp_replace(
            function_row.oid::pg_catalog.regprocedure::text,
            '^public\\.',
            ''
          ) as signature,
          pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE') as anon_execute,
          pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE') as authenticated_execute,
          pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE') as service_execute
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace
          on namespace.oid = function_row.pronamespace
        where namespace.nspname = 'public'
          and function_row.prokind = 'f'
      ) procedure_row
    ), '[]'::jsonb),
    'policies', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(policy_row) order by policy_row.tablename, policy_row.policyname)
      from (
        select
          policies.tablename,
          policies.policyname,
          policies.permissive,
          policies.roles::text[] as roles,
          policies.cmd,
          policies.qual,
          policies.with_check
        from pg_catalog.pg_policies policies
        where policies.schemaname = 'public'
      ) policy_row
    ), '[]'::jsonb),
    'triggers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(trigger_row) order by trigger_row.table_name, trigger_row.trigger_name)
      from (
        select
          relation.relname::text as table_name,
          trigger.tgname::text as trigger_name,
          pg_catalog.format(
            '%I.%I(%s)',
            function_namespace.nspname,
            function_row.proname,
            pg_catalog.pg_get_function_identity_arguments(function_row.oid)
          ) as function_signature,
          case
            when (trigger.tgtype & 2) <> 0 then 'BEFORE'
            when (trigger.tgtype & 64) <> 0 then 'INSTEAD OF'
            else 'AFTER'
          end as timing,
          pg_catalog.array_remove(array[
            case when (trigger.tgtype & 4) <> 0 then 'INSERT' end,
            case when (trigger.tgtype & 8) <> 0 then 'DELETE' end,
            case when (trigger.tgtype & 16) <> 0 then 'UPDATE' end,
            case when (trigger.tgtype & 32) <> 0 then 'TRUNCATE' end
          ], null)::text[] as events,
          coalesce((
            select pg_catalog.array_agg(attribute.attname::text order by trigger_column.ordinality)
            from pg_catalog.unnest(trigger.tgattr::smallint[])
              with ordinality as trigger_column(attribute_number, ordinality)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = trigger.tgrelid
             and attribute.attnum = trigger_column.attribute_number
          ), array[]::text[]) as update_columns,
          (trigger.tgtype & 1) <> 0 as row_level,
          trigger.tgenabled,
          pg_catalog.pg_get_expr(trigger.tgqual, trigger.tgrelid, true) as when_expression,
          pg_catalog.pg_get_triggerdef(trigger.oid, true) as trigger_definition
        from pg_catalog.pg_trigger trigger
        join pg_catalog.pg_class relation
          on relation.oid = trigger.tgrelid
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        join pg_catalog.pg_proc function_row
          on function_row.oid = trigger.tgfoid
        join pg_catalog.pg_namespace function_namespace
          on function_namespace.oid = function_row.pronamespace
        where namespace.nspname = 'public'
          and not trigger.tgisinternal
      ) trigger_row
    ), '[]'::jsonb),
    'constraints', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(constraint_result) order by constraint_result.table_name, constraint_result.constraint_name)
      from (
        select
          relation.relname::text as table_name,
          constraint_row.conname::text as constraint_name,
          constraint_row.contype,
          constraint_row.convalidated,
          constraint_row.condeferrable,
          constraint_row.condeferred,
          constraint_row.confupdtype,
          constraint_row.confdeltype,
          constraint_row.confmatchtype,
          case
            when referenced_relation.oid is null then null
            else pg_catalog.format('%I.%I', referenced_namespace.nspname, referenced_relation.relname)
          end as referenced_table,
          coalesce((
            select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
            from pg_catalog.unnest(constraint_row.conkey)
              with ordinality as key_column(attribute_number, ordinality)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = constraint_row.conrelid
             and attribute.attnum = key_column.attribute_number
          ), array[]::text[]) as constrained_columns,
          coalesce((
            select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
            from pg_catalog.unnest(constraint_row.confkey)
              with ordinality as key_column(attribute_number, ordinality)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = constraint_row.confrelid
             and attribute.attnum = key_column.attribute_number
          ), array[]::text[]) as referenced_columns,
          coalesce((
            select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
            from pg_catalog.unnest(constraint_row.confdelsetcols)
              with ordinality as key_column(attribute_number, ordinality)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = constraint_row.conrelid
             and attribute.attnum = key_column.attribute_number
          ), array[]::text[]) as delete_set_columns,
          pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true) as check_expression,
          pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as constraint_definition
        from pg_catalog.pg_constraint constraint_row
        join pg_catalog.pg_class relation
          on relation.oid = constraint_row.conrelid
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        left join pg_catalog.pg_class referenced_relation
          on referenced_relation.oid = constraint_row.confrelid
        left join pg_catalog.pg_namespace referenced_namespace
          on referenced_namespace.oid = referenced_relation.relnamespace
        where namespace.nspname = 'public'
      ) constraint_result
    ), '[]'::jsonb),
    'indexes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(index_result) order by index_result.table_name, index_result.index_name)
      from (
        select
          relation.relname::text as table_name,
          index_relation.relname::text as index_name,
          index_row.indisvalid,
          index_row.indisready
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class relation
          on relation.oid = index_row.indrelid
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_row.indexrelid
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
      ) index_result
    ), '[]'::jsonb),
    'table_acls', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(acl_row) order by acl_row.table_name)
      from (
        select
          relation.relname::text as table_name,
          pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT') as anon_select,
          pg_catalog.has_table_privilege('anon', relation.oid, 'INSERT') as anon_insert,
          pg_catalog.has_table_privilege('anon', relation.oid, 'UPDATE') as anon_update,
          pg_catalog.has_table_privilege('anon', relation.oid, 'DELETE') as anon_delete,
          pg_catalog.has_table_privilege('anon', relation.oid, 'TRUNCATE') as anon_truncate,
          pg_catalog.has_table_privilege('anon', relation.oid, 'REFERENCES') as anon_references,
          pg_catalog.has_table_privilege('anon', relation.oid, 'TRIGGER') as anon_trigger,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT') as authenticated_select,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'INSERT') as authenticated_insert,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'UPDATE') as authenticated_update,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'DELETE') as authenticated_delete,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'TRUNCATE') as authenticated_truncate,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'REFERENCES') as authenticated_references,
          pg_catalog.has_table_privilege('authenticated', relation.oid, 'TRIGGER') as authenticated_trigger,
          pg_catalog.has_table_privilege('service_role', relation.oid, 'SELECT') as service_select,
          pg_catalog.has_table_privilege('service_role', relation.oid, 'INSERT') as service_insert,
          pg_catalog.has_table_privilege('service_role', relation.oid, 'UPDATE') as service_update,
          pg_catalog.has_table_privilege('service_role', relation.oid, 'DELETE') as service_delete
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
      ) acl_row
    ), '[]'::jsonb),
    'data_invariants', (
      select pg_catalog.jsonb_build_object(
        'duplicate_learning_feedback_links', (
          select count(*)::bigint
          from (
            select learning.feedback_event_id
            from public.v4_learning_events learning
            where learning.feedback_event_id is not null
            group by learning.feedback_event_id
            having count(*) > 1
          ) duplicates
        ),
        'sem_validation_missing_provenance', (
          select count(*)::bigint
          from public.v4_sem_validation_events validation
          where nullif(validation.parser_version, '') is null
             or nullif(validation.sem_standard_version, '') is null
        ),
        'validated_sem_without_supported_evidence', (
          select count(*)::bigint
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
        )
      )
    ),
    'server', pg_catalog.jsonb_build_object(
      'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
      'server_version_num', pg_catalog.current_setting('server_version_num')
    ),
    'execution_boundary', (
      select pg_catalog.jsonb_build_object(
        'storage_objects', pg_catalog.to_regclass('storage.objects')::text,
        'authenticated_storage_usage', pg_catalog.has_schema_privilege('authenticated', 'storage', 'USAGE'),
        'authenticated_storage_select', pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'SELECT'),
        'authenticated_storage_insert', pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
        'authenticated_storage_update', pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'UPDATE'),
        'authenticated_storage_delete', pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'DELETE'),
        'service_storage_select', pg_catalog.has_table_privilege('service_role', 'storage.objects', 'SELECT'),
        'authenticated_heartbeat_execute', pg_catalog.has_function_privilege(
          'authenticated',
          'public.heartbeat_v4_recognition_job(text,text,integer)',
          'EXECUTE'
        ),
        'service_heartbeat_execute', pg_catalog.has_function_privilege(
          'service_role',
          'public.heartbeat_v4_recognition_job(text,text,integer)',
          'EXECUTE'
        ),
        'heartbeat_definition', case
          when pg_catalog.to_regprocedure('public.heartbeat_v4_recognition_job(text,text,integer)') is null then null
          else pg_catalog.pg_get_functiondef(
            pg_catalog.to_regprocedure('public.heartbeat_v4_recognition_job(text,text,integer)')
          )
        end,
        'execution_fence_definition', case
          when pg_catalog.to_regprocedure('public.fence_v4_recognition_job_execution(text,text,integer)') is null then null
          else pg_catalog.pg_get_functiondef(
            pg_catalog.to_regprocedure('public.fence_v4_recognition_job_execution(text,text,integer)')
          )
        end
      )
    )
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

comment on function public.track_c_production_schema_catalog_snapshot() is
  'Service-role-only, STABLE catalog snapshot used by the read-only production deployment preflight.';

revoke all on function public.track_c_production_schema_catalog_snapshot()
  from public, anon, authenticated;
grant execute on function public.track_c_production_schema_catalog_snapshot()
  to service_role;

notify pgrst, 'reload schema';
