-- PostgREST catalog attestation follow-up.
--
-- pg_get_expr(tgqual, tgrelid) cannot deparse a trigger WHEN expression
-- that references both OLD and NEW against one relation context. The
-- production contract only needs to prove that expected triggers have no
-- WHEN clause, so retain a fail-closed presence marker instead.

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
          case when trigger.tgqual is null then null else 'present' end as when_expression,
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
