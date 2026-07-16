#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const requiredTables = Object.freeze([
  "tenants",
  "users",
  "tenant_members",
  "listing_assets",
  "listing_reviews",
  "preingestion_jobs",
  "v4_recognition_batches",
  "v4_recognition_sessions",
  "v4_recognition_jobs",
  "v4_provider_capacity_leases",
  "v4_queue_kick_leases",
  "v4_writer_feedback_events",
  "v4_learning_events",
  "v4_sem_validation_events",
  "v4_writer_export_batches",
  "v4_writer_export_items",
  "request_logs",
  "job_attempt_events",
  "error_logs",
  "production_events"
]);

const tenantScopedTables = Object.freeze([
  "listing_assets",
  "listing_reviews",
  "preingestion_jobs",
  "v4_recognition_batches",
  "v4_recognition_sessions",
  "v4_recognition_jobs",
  "v4_writer_feedback_events",
  "v4_learning_events",
  "v4_sem_validation_events",
  "v4_writer_export_batches",
  "v4_writer_export_items"
]);

const serviceOnlyFactTables = Object.freeze([
  "v4_writer_feedback_events",
  "v4_learning_events",
  "v4_sem_validation_events"
]);

const tenantPolicyTables = Object.freeze(
  tenantScopedTables.filter((table) => !serviceOnlyFactTables.includes(table))
);

const requiredFunctions = Object.freeze([
  "assign_v4_recognition_job(text,text,text)",
  "claim_v4_recognition_jobs(integer,text,integer,text,text)",
  "claim_v4_recognition_jobs_with_balanced_capacity(integer,text,integer,text,text,text,integer,integer,integer)",
  "claim_v4_recognition_jobs_with_capacity(integer,text,integer,text,text,text,integer,integer)",
  "heartbeat_v4_recognition_job(text,text,integer)",
  "release_v4_provider_capacity_for_job(text,text)",
  "try_acquire_v4_queue_kick(text,text,integer)",
  "acquire_v4_stage_capacity(text,text,text,integer,integer)",
  "release_v4_stage_capacity(text,text,text)",
  "persist_v4_writer_feedback_transaction(text,text,text,text,jsonb,jsonb)",
  "enqueue_v4_recognition_batch_atomic(text,text,jsonb,jsonb,jsonb)",
  "fence_v4_recognition_job_execution(text,text,integer)",
  "persist_v4_noncritical_artifacts(text,jsonb,jsonb,jsonb,jsonb)",
  "persist_v4_writer_ready_and_release_capacity(text,jsonb,text,text)",
  "track_c_ops_snapshot(text,timestamp with time zone)",
  "fail_v4_recognition_job(text,text,jsonb,boolean,boolean)"
]);

const forbiddenFunctions = Object.freeze([
  "persist_v4_writer_feedback_transaction(text,text,text,jsonb,jsonb)"
]);

const serviceOnlyFunctions = Object.freeze([
  "heartbeat_v4_recognition_job(text,text,integer)",
  "persist_v4_writer_feedback_transaction(text,text,text,text,jsonb,jsonb)",
  "enqueue_v4_recognition_batch_atomic(text,text,jsonb,jsonb,jsonb)",
  "fence_v4_recognition_job_execution(text,text,integer)"
]);

const requiredPolicies = Object.freeze([
  ["tenants", "track_c_tenants_select"],
  ["tenants", "track_c_tenants_update"],
  ["users", "track_c_users_select"],
  ["users", "track_c_users_update_self"],
  ["tenant_members", "track_c_tenant_members_select"],
  ["tenant_members", "track_c_tenant_members_insert"],
  ["tenant_members", "track_c_tenant_members_update"],
  ["tenant_members", "track_c_tenant_members_delete"],
  ...tenantPolicyTables.flatMap((table) => [
    [table, "track_c_tenant_select"],
    [table, "track_c_tenant_insert"],
    [table, "track_c_tenant_update"],
    [table, "track_c_tenant_delete"]
  ]),
  ["request_logs", "track_c_request_logs_select"],
  ["job_attempt_events", "track_c_job_attempt_events_select"],
  ["error_logs", "track_c_error_logs_select"],
  ["production_events", "track_c_production_events_select"]
]);

const requiredConstraints = Object.freeze([
  ["tenant_members", "tenant_members_role_check"],
  ["tenants", "tenants_settings_object_check"],
  ["preingestion_jobs", "preingestion_jobs_max_attempts_chk"],
  ["preingestion_jobs", "preingestion_jobs_lease_pair_chk"],
  ["v4_recognition_jobs", "v4_recognition_jobs_tenant_id_fkey"],
  ["v4_recognition_jobs", "v4_recognition_jobs_tenant_batch_fkey"],
  ["v4_writer_feedback_events", "v4_writer_feedback_events_tenant_id_fkey"],
  ["v4_learning_events", "v4_learning_events_tenant_id_fkey"],
  ["v4_sem_validation_events", "v4_sem_validation_events_tenant_id_fkey"],
  ["v4_sem_validation_events", "v4_sem_validation_identity_group_check"],
  ["v4_sem_validation_events", "v4_sem_validation_current_version_check"],
  ["v4_sem_validation_events", "v4_sem_validation_sources_object_check"],
  ["v4_sem_validation_events", "v4_sem_validation_disposition_check"]
]);

// These checks deliberately remain NOT VALID for pre-Track-D legacy rows.
// PostgreSQL still enforces them for every new feedback fact. Treating every
// unvalidated constraint as a deployment failure would make the reviewed
// compatibility boundary impossible to deploy.
const requiredNotValidConstraints = Object.freeze([
  ["v4_writer_feedback_events", "v4_writer_feedback_action_title_check"],
  ["v4_writer_feedback_events", "v4_writer_feedback_projection_check"]
]);

const requiredIndexes = Object.freeze([
  ["preingestion_jobs", "preingestion_jobs_ocr_stale_lease_idx"],
  ["v4_writer_feedback_events", "v4_writer_feedback_submission_uidx"],
  ["v4_writer_feedback_events", "v4_writer_feedback_revision_uidx"],
  ["v4_learning_events", "v4_learning_feedback_event_uidx"],
  ["v4_sem_validation_events", "v4_sem_validation_status_idx"]
]);

const requiredTriggers = Object.freeze([
  ...tenantScopedTables.map((table) => [table, "track_c_tenant_id_immutable"]),
  ["v4_recognition_sessions", "prevent_v4_session_identity_reassignment"],
  ["v4_recognition_jobs", "validate_v4_recognition_job_session_identity"],
  ["v4_writer_feedback_events", "prevent_v4_writer_feedback_mutation"],
  ["v4_learning_events", "prevent_v4_writer_learning_event_mutation"],
  ["v4_sem_validation_events", "prevent_v4_sem_validation_mutation"],
  ["v4_sem_validation_events", "validate_v4_sem_validation_identity"]
]);

function cleanText(value) {
  return String(value || "").trim();
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : "";
}

function safeError(error, connectionString = "") {
  let message = cleanText(error?.message || error || "schema_preflight_failed");
  const redactions = [connectionString];
  try {
    const url = new URL(connectionString);
    redactions.push(url.password, url.username, url.hostname);
  } catch {
    // A malformed URL is reported without echoing the supplied value.
  }
  for (const value of redactions.filter(Boolean)) {
    message = message.split(value).join("[redacted]");
  }
  return {
    error_type: cleanText(error?.code || error?.name || "SCHEMA_PREFLIGHT_ERROR").slice(0, 120),
    error_message: message.slice(0, 500)
  };
}

function writeReport(report, outputPath = "") {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, text, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(text);
}

function byTableAndColumn(rows) {
  return new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
}

function summarizeColumns(columnRows) {
  const columns = byTableAndColumn(columnRows);
  const checks = [];

  for (const table of tenantScopedTables) {
    const column = columns.get(`${table}.tenant_id`);
    checks.push({
      table,
      column: "tenant_id",
      requirement: "text_not_null_without_default",
      ok: Boolean(
        column
        && column.data_type === "text"
        && column.is_nullable === "NO"
        && column.column_default === null
      ),
      actual: column
        ? {
            data_type: column.data_type,
            nullable: column.is_nullable,
            has_default: column.column_default !== null
          }
        : null
    });
  }

  const settings = columns.get("tenants.settings");
  checks.push({
    table: "tenants",
    column: "settings",
    requirement: "jsonb_not_null_with_object_default",
    ok: Boolean(
      settings
      && settings.data_type === "jsonb"
      && settings.is_nullable === "NO"
      && /'\{\}'::jsonb/.test(String(settings.column_default || ""))
    ),
    actual: settings
      ? {
          data_type: settings.data_type,
          nullable: settings.is_nullable,
          default: settings.column_default
        }
      : null
  });

  const retryColumns = [
    ["canonical_state", "text"],
    ["retry_count", "integer"],
    ["last_error", "text"],
    ["error_type", "text"],
    ["next_retry_at", "timestamp with time zone"]
  ];
  for (const [name, dataType] of retryColumns) {
    const column = columns.get(`v4_recognition_jobs.${name}`);
    checks.push({
      table: "v4_recognition_jobs",
      column: name,
      requirement: `stored_generated_${dataType.replaceAll(" ", "_")}`,
      ok: Boolean(
        column
        && column.data_type === dataType
        && column.is_generated === "ALWAYS"
        && cleanText(column.generation_expression)
      ),
      actual: column
        ? {
            data_type: column.data_type,
            generated: column.is_generated,
            has_generation_expression: Boolean(cleanText(column.generation_expression))
          }
        : null
    });
  }

  const maxAttempts = columns.get("v4_recognition_jobs.max_attempts");
  checks.push({
    table: "v4_recognition_jobs",
    column: "max_attempts",
    requirement: "integer_default_4",
    ok: Boolean(
      maxAttempts
      && maxAttempts.data_type === "integer"
      && /^4(?:::[a-z ]+)?$/i.test(cleanText(maxAttempts.column_default))
    ),
    actual: maxAttempts
      ? { data_type: maxAttempts.data_type, default: maxAttempts.column_default }
      : null
  });

  const ocrMaxAttempts = columns.get("preingestion_jobs.max_attempts");
  checks.push({
    table: "preingestion_jobs",
    column: "max_attempts",
    requirement: "integer_not_null_default_3",
    ok: Boolean(
      ocrMaxAttempts
      && ocrMaxAttempts.data_type === "integer"
      && ocrMaxAttempts.is_nullable === "NO"
      && /^3(?:::[a-z ]+)?$/i.test(cleanText(ocrMaxAttempts.column_default))
    ),
    actual: ocrMaxAttempts
      ? {
          data_type: ocrMaxAttempts.data_type,
          nullable: ocrMaxAttempts.is_nullable,
          default: ocrMaxAttempts.column_default
        }
      : null
  });

  for (const [name, dataType] of [
    ["lease_owner", "text"],
    ["lease_expires_at", "timestamp with time zone"]
  ]) {
    const column = columns.get(`preingestion_jobs.${name}`);
    checks.push({
      table: "preingestion_jobs",
      column: name,
      requirement: `nullable_${dataType.replaceAll(" ", "_")}`,
      ok: Boolean(column && column.data_type === dataType && column.is_nullable === "YES"),
      actual: column
        ? { data_type: column.data_type, nullable: column.is_nullable }
        : null
    });
  }

  for (const table of ["v4_recognition_sessions", "v4_recognition_jobs"]) {
    for (const name of ["created_by_user_id", "assigned_to_user_id"]) {
      const column = columns.get(`${table}.${name}`);
      checks.push({
        table,
        column: name,
        requirement: "text_assignment_column",
        ok: Boolean(column && column.data_type === "text"),
        actual: column ? { data_type: column.data_type } : null
      });
    }
  }

  return checks;
}

async function readSchema(client) {
  const tableResult = await client.query(
    `
      select
        required.table_name,
        relation.oid is not null as present,
        relation.relkind::text as relation_kind,
        coalesce(relation.relrowsecurity, false) as row_level_security
      from unnest($1::text[]) as required(table_name)
      left join pg_catalog.pg_namespace namespace
        on namespace.nspname = 'public'
      left join pg_catalog.pg_class relation
        on relation.relnamespace = namespace.oid
       and relation.relname = required.table_name
      order by required.table_name
    `,
    [requiredTables]
  );

  const columnResult = await client.query(
    `
      select
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default,
        is_generated,
        generation_expression
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name, ordinal_position
    `,
    [requiredTables]
  );

  const functionResult = await client.query(
    `
      select
        required.signature,
        pg_catalog.to_regprocedure(required.signature)::text as resolved_signature
      from unnest($1::text[]) as required(signature)
      order by required.signature
    `,
    [requiredFunctions]
  );

  const forbiddenFunctionResult = await client.query(
    `
      select
        forbidden.signature,
        pg_catalog.to_regprocedure(forbidden.signature)::text as resolved_signature
      from unnest($1::text[]) as forbidden(signature)
      order by forbidden.signature
    `,
    [forbiddenFunctions]
  );

  const policyTables = [
    ...new Set([
      ...requiredPolicies.map(([table]) => table),
      ...serviceOnlyFactTables
    ])
  ];
  const policyResult = await client.query(
    `
      select tablename, policyname
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = any($1::text[])
    `,
    [policyTables]
  );

  const triggerResult = await client.query(
    `
      select
        relation.relname as table_name,
        trigger.tgname as trigger_name,
        trigger.tgenabled
      from pg_catalog.pg_trigger trigger
      join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = any($1::text[])
        and trigger.tgname = any($2::text[])
        and not trigger.tgisinternal
    `,
    [
      [...new Set(requiredTriggers.map(([table]) => table))],
      [...new Set(requiredTriggers.map(([, trigger]) => trigger))]
    ]
  );

  const constraintResult = await client.query(
    `
      select
        relation.relname as table_name,
        constraint_row.conname as constraint_name,
        constraint_row.contype,
        constraint_row.convalidated
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = any($1::text[])
      order by relation.relname, constraint_row.conname
    `,
    [requiredTables]
  );

  const indexTables = [...new Set(requiredIndexes.map(([table]) => table))];
  const indexResult = await client.query(
    `
      select
        relation.relname as table_name,
        index_relation.relname as index_name,
        index_row.indisvalid,
        index_row.indisready
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = any($1::text[])
      order by relation.relname, index_relation.relname
    `,
    [indexTables]
  );

  const serverResult = await client.query(
    `select
       current_setting('transaction_read_only') as transaction_read_only,
       current_setting('server_version_num') as server_version_num`
  );

  const factAclResult = await client.query(
    `
      select
        fact.table_name,
        pg_catalog.has_table_privilege('anon', pg_catalog.format('public.%I', fact.table_name), 'SELECT') as anon_select,
        pg_catalog.has_table_privilege('anon', pg_catalog.format('public.%I', fact.table_name), 'INSERT') as anon_insert,
        pg_catalog.has_table_privilege('anon', pg_catalog.format('public.%I', fact.table_name), 'UPDATE') as anon_update,
        pg_catalog.has_table_privilege('anon', pg_catalog.format('public.%I', fact.table_name), 'DELETE') as anon_delete,
        pg_catalog.has_table_privilege('authenticated', pg_catalog.format('public.%I', fact.table_name), 'SELECT') as authenticated_select,
        pg_catalog.has_table_privilege('authenticated', pg_catalog.format('public.%I', fact.table_name), 'INSERT') as authenticated_insert,
        pg_catalog.has_table_privilege('authenticated', pg_catalog.format('public.%I', fact.table_name), 'UPDATE') as authenticated_update,
        pg_catalog.has_table_privilege('authenticated', pg_catalog.format('public.%I', fact.table_name), 'DELETE') as authenticated_delete,
        pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', fact.table_name), 'SELECT') as service_select,
        pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', fact.table_name), 'INSERT') as service_insert,
        pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', fact.table_name), 'UPDATE') as service_update,
        pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', fact.table_name), 'DELETE') as service_delete
      from unnest($1::text[]) as fact(table_name)
      order by fact.table_name
    `,
    [serviceOnlyFactTables]
  );

  const functionAclResult = await client.query(
    `
      select
        service_function.signature,
        pg_catalog.to_regprocedure(service_function.signature)::text as resolved_signature,
        case when pg_catalog.to_regprocedure(service_function.signature) is null then false else
          pg_catalog.has_function_privilege(
            'anon',
            pg_catalog.to_regprocedure(service_function.signature),
            'EXECUTE'
          )
        end as anon_execute,
        case when pg_catalog.to_regprocedure(service_function.signature) is null then false else
          pg_catalog.has_function_privilege(
            'authenticated',
            pg_catalog.to_regprocedure(service_function.signature),
            'EXECUTE'
          )
        end as authenticated_execute,
        case when pg_catalog.to_regprocedure(service_function.signature) is null then false else
          pg_catalog.has_function_privilege(
            'service_role',
            pg_catalog.to_regprocedure(service_function.signature),
            'EXECUTE'
          )
        end as service_execute
      from unnest($1::text[]) as service_function(signature)
      order by service_function.signature
    `,
    [serviceOnlyFunctions]
  );

  const dataInvariantResult = await client.query(
    `
      select
        (
          select count(*)::bigint
          from (
            select learning.feedback_event_id
            from public.v4_learning_events learning
            where learning.feedback_event_id is not null
            group by learning.feedback_event_id
            having count(*) > 1
          ) duplicates
        ) as duplicate_learning_feedback_links,
        (
          select count(*)::bigint
          from public.v4_sem_validation_events validation
          where nullif(validation.parser_version, '') is null
             or nullif(validation.sem_standard_version, '') is null
        ) as sem_validation_missing_provenance,
        (
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
        ) as validated_sem_without_supported_evidence
    `
  );

  const executionBoundaryResult = await client.query(
    `
      select
        pg_catalog.to_regclass('storage.objects')::text as storage_objects,
        pg_catalog.has_schema_privilege('authenticated', 'storage', 'USAGE') as authenticated_storage_usage,
        pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'SELECT') as authenticated_storage_select,
        pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'INSERT') as authenticated_storage_insert,
        pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'UPDATE') as authenticated_storage_update,
        pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'DELETE') as authenticated_storage_delete,
        pg_catalog.has_table_privilege('service_role', 'storage.objects', 'SELECT') as service_storage_select,
        pg_catalog.has_function_privilege(
          'authenticated',
          'public.heartbeat_v4_recognition_job(text,text,integer)',
          'EXECUTE'
        ) as authenticated_heartbeat_execute,
        pg_catalog.has_function_privilege(
          'service_role',
          'public.heartbeat_v4_recognition_job(text,text,integer)',
          'EXECUTE'
        ) as service_heartbeat_execute,
        pg_catalog.pg_get_functiondef(
          'public.heartbeat_v4_recognition_job(text,text,integer)'::pg_catalog.regprocedure
        ) as heartbeat_definition,
        pg_catalog.pg_get_functiondef(
          'public.fence_v4_recognition_job_execution(text,text,integer)'::pg_catalog.regprocedure
        ) as execution_fence_definition
    `
  );

  return {
    tables: tableResult.rows,
    columns: columnResult.rows,
    functions: functionResult.rows,
    forbiddenFunctions: forbiddenFunctionResult.rows,
    policies: policyResult.rows,
    triggers: triggerResult.rows,
    constraints: constraintResult.rows,
    indexes: indexResult.rows,
    factAcls: factAclResult.rows,
    functionAcls: functionAclResult.rows,
    dataInvariants: dataInvariantResult.rows[0],
    server: serverResult.rows[0],
    executionBoundary: executionBoundaryResult.rows[0]
  };
}

function evaluateSchema(snapshot) {
  const tableChecks = snapshot.tables.map((row) => ({
    table: row.table_name,
    ok: row.present === true && ["r", "p"].includes(row.relation_kind),
    present: row.present === true,
    relation_kind: row.relation_kind || null,
    row_level_security: row.row_level_security === true
  }));

  const rlsChecks = snapshot.tables.map((row) => ({
    table: row.table_name,
    ok: row.present === true && row.row_level_security === true
  }));

  const columnChecks = summarizeColumns(snapshot.columns);
  const functionChecks = snapshot.functions.map((row) => ({
    signature: row.signature,
    ok: Boolean(row.resolved_signature),
    resolved_signature: row.resolved_signature || null
  }));
  const forbiddenFunctionChecks = snapshot.forbiddenFunctions.map((row) => ({
    signature: row.signature,
    requirement: "absent",
    ok: !row.resolved_signature,
    resolved_signature: row.resolved_signature || null
  }));

  const policySet = new Set(snapshot.policies.map((row) => `${row.tablename}.${row.policyname}`));
  const policyChecks = requiredPolicies.map(([table, policy]) => ({
    table,
    policy,
    ok: policySet.has(`${table}.${policy}`)
  }));
  const serviceOnlyPolicyChecks = serviceOnlyFactTables.map((table) => {
    const policies = snapshot.policies
      .filter((row) => row.tablename === table)
      .map((row) => row.policyname)
      .sort();
    return {
      table,
      requirement: "no_authenticated_rls_policies",
      ok: policies.length === 0,
      policies
    };
  });

  const enabledTriggers = new Set(
    snapshot.triggers
      .filter((row) => ["O", "A"].includes(row.tgenabled))
      .map((row) => `${row.table_name}.${row.trigger_name}`)
  );
  const triggerChecks = requiredTriggers.map(([table, trigger]) => ({
    table,
    trigger,
    ok: enabledTriggers.has(`${table}.${trigger}`)
  }));

  const constraintMap = new Map(
    snapshot.constraints.map((row) => [`${row.table_name}.${row.constraint_name}`, row])
  );
  const expectedConstraintChecks = requiredConstraints.map(([table, constraint]) => {
    const row = constraintMap.get(`${table}.${constraint}`);
    return {
      table,
      constraint,
      ok: Boolean(row && row.convalidated === true),
      present: Boolean(row),
      validated: row?.convalidated === true
    };
  });
  const requiredNotValidConstraintChecks = requiredNotValidConstraints.map(([table, constraint]) => {
    const row = constraintMap.get(`${table}.${constraint}`);
    return {
      table,
      constraint,
      ok: Boolean(row && row.convalidated === false),
      present: Boolean(row),
      validated: row?.convalidated === true,
      expected_state: "NOT VALID (enforced for new rows)"
    };
  });
  const allowedNotValidConstraintKeys = new Set(
    requiredNotValidConstraints.map(([table, constraint]) => `${table}.${constraint}`)
  );
  const invalidConstraints = snapshot.constraints
    .filter((row) => (
      row.convalidated !== true
      && !allowedNotValidConstraintKeys.has(`${row.table_name}.${row.constraint_name}`)
    ))
    .map((row) => ({ table: row.table_name, constraint: row.constraint_name, type: row.contype }));

  const indexMap = new Map(
    snapshot.indexes.map((row) => [`${row.table_name}.${row.index_name}`, row])
  );
  const indexChecks = requiredIndexes.map(([table, index]) => {
    const row = indexMap.get(`${table}.${index}`);
    return {
      table,
      index,
      ok: Boolean(row && row.indisvalid === true && row.indisready === true),
      present: Boolean(row),
      valid: row?.indisvalid === true,
      ready: row?.indisready === true
    };
  });

  const executionBoundary = snapshot.executionBoundary || {};
  const heartbeatDefinition = cleanText(executionBoundary.heartbeat_definition);
  const executionFenceDefinition = cleanText(executionBoundary.execution_fence_definition);
  const executionBoundaryChecks = [
    {
      boundary: "browser_storage_acl",
      requirement: "authenticated_has_no_direct_storage_objects_access",
      ok: Boolean(
        executionBoundary.storage_objects
        && executionBoundary.authenticated_storage_usage === false
        && executionBoundary.authenticated_storage_select === false
        && executionBoundary.authenticated_storage_insert === false
        && executionBoundary.authenticated_storage_update === false
        && executionBoundary.authenticated_storage_delete === false
        && executionBoundary.service_storage_select === true
      ),
      actual: {
        storage_objects: executionBoundary.storage_objects || null,
        authenticated_schema_usage: executionBoundary.authenticated_storage_usage === true,
        authenticated_select: executionBoundary.authenticated_storage_select === true,
        authenticated_insert: executionBoundary.authenticated_storage_insert === true,
        authenticated_update: executionBoundary.authenticated_storage_update === true,
        authenticated_delete: executionBoundary.authenticated_storage_delete === true,
        service_select: executionBoundary.service_storage_select === true
      }
    },
    {
      boundary: "paid_execution_lease_fence",
      requirement: "service_only_running_owner_unexpired_heartbeat",
      ok: Boolean(
        executionBoundary.authenticated_heartbeat_execute === false
        && executionBoundary.service_heartbeat_execute === true
        && /jobs\.status\s*=\s*'RUNNING'/i.test(heartbeatDefinition)
        && /jobs\.lease_owner\s*=\s*p_worker_id/i.test(heartbeatDefinition)
        && /jobs\.lease_expires_at\s+is\s+not\s+null/i.test(heartbeatDefinition)
        && /jobs\.lease_expires_at\s*>\s*heartbeat_at/i.test(heartbeatDefinition)
      ),
      actual: {
        authenticated_execute: executionBoundary.authenticated_heartbeat_execute === true,
        service_execute: executionBoundary.service_heartbeat_execute === true,
        running_guard: /jobs\.status\s*=\s*'RUNNING'/i.test(heartbeatDefinition),
        owner_guard: /jobs\.lease_owner\s*=\s*p_worker_id/i.test(heartbeatDefinition),
        unexpired_guard: /jobs\.lease_expires_at\s*>\s*heartbeat_at/i.test(heartbeatDefinition)
      }
    },
    {
      boundary: "provider_side_effect_fence",
      requirement: "service_only_running_owner_unexpired_persisted_identity",
      ok: Boolean(
        /jobs\.status\s*=\s*'RUNNING'/i.test(executionFenceDefinition)
        && /jobs\.lease_owner\s*=\s*p_worker_id/i.test(executionFenceDefinition)
        && /jobs\.lease_expires_at\s*>\s*pg_catalog\.clock_timestamp\(\)/i.test(executionFenceDefinition)
        && /'tenant_id',\s*fenced_job\.tenant_id/i.test(executionFenceDefinition)
        && /'recognition_session_id',\s*fenced_job\.recognition_session_id/i.test(executionFenceDefinition)
        && /'asset_id',\s*fenced_job\.asset_id/i.test(executionFenceDefinition)
      ),
      actual: {
        running_guard: /jobs\.status\s*=\s*'RUNNING'/i.test(executionFenceDefinition),
        owner_guard: /jobs\.lease_owner\s*=\s*p_worker_id/i.test(executionFenceDefinition),
        unexpired_guard: /jobs\.lease_expires_at\s*>\s*pg_catalog\.clock_timestamp\(\)/i.test(executionFenceDefinition),
        returns_persisted_identity: /'tenant_id',\s*fenced_job\.tenant_id/i.test(executionFenceDefinition)
          && /'recognition_session_id',\s*fenced_job\.recognition_session_id/i.test(executionFenceDefinition)
          && /'asset_id',\s*fenced_job\.asset_id/i.test(executionFenceDefinition)
      }
    }
  ];

  const factAclChecks = snapshot.factAcls.map((row) => ({
    table: row.table_name,
    requirement: "browser_denied_service_insert_only",
    ok: Boolean(
      row.anon_select === false
      && row.anon_insert === false
      && row.anon_update === false
      && row.anon_delete === false
      && row.authenticated_select === false
      && row.authenticated_insert === false
      && row.authenticated_update === false
      && row.authenticated_delete === false
      && row.service_select === true
      && row.service_insert === true
      && row.service_update === false
      && row.service_delete === false
    ),
    actual: {
      anon: {
        select: row.anon_select === true,
        insert: row.anon_insert === true,
        update: row.anon_update === true,
        delete: row.anon_delete === true
      },
      authenticated: {
        select: row.authenticated_select === true,
        insert: row.authenticated_insert === true,
        update: row.authenticated_update === true,
        delete: row.authenticated_delete === true
      },
      service_role: {
        select: row.service_select === true,
        insert: row.service_insert === true,
        update: row.service_update === true,
        delete: row.service_delete === true
      }
    }
  }));

  const functionAclChecks = snapshot.functionAcls.map((row) => ({
    signature: row.signature,
    requirement: "service_role_execute_only",
    ok: Boolean(
      row.resolved_signature
      && row.anon_execute === false
      && row.authenticated_execute === false
      && row.service_execute === true
    ),
    actual: {
      resolved_signature: row.resolved_signature || null,
      anon_execute: row.anon_execute === true,
      authenticated_execute: row.authenticated_execute === true,
      service_execute: row.service_execute === true
    }
  }));

  const dataInvariants = snapshot.dataInvariants || {};
  const dataInvariantChecks = [
    ["duplicate_learning_feedback_links", dataInvariants.duplicate_learning_feedback_links],
    ["sem_validation_missing_provenance", dataInvariants.sem_validation_missing_provenance],
    ["validated_sem_without_supported_evidence", dataInvariants.validated_sem_without_supported_evidence]
  ].map(([invariant, value]) => ({
    invariant,
    requirement: "zero_rows",
    ok: Number(value) === 0,
    violating_row_count: Number(value || 0)
  }));

  const sections = {
    tables: tableChecks,
    row_level_security: rlsChecks,
    columns: columnChecks,
    functions: functionChecks,
    forbidden_functions: forbiddenFunctionChecks,
    policies: policyChecks,
    service_only_fact_policies: serviceOnlyPolicyChecks,
    required_triggers: triggerChecks,
    expected_constraints: expectedConstraintChecks,
    intentional_not_valid_constraints: requiredNotValidConstraintChecks,
    indexes: indexChecks,
    service_only_fact_acls: factAclChecks,
    service_only_function_acls: functionAclChecks,
    data_invariants: dataInvariantChecks,
    execution_boundaries: executionBoundaryChecks,
    invalid_constraints: {
      ok: invalidConstraints.length === 0,
      items: invalidConstraints
    }
  };

  const listChecks = Object.values(sections).flatMap((section) => (
    Array.isArray(section) ? section : [section]
  ));
  const failedChecks = listChecks.filter((item) => item.ok !== true).length;
  return { sections, failedChecks };
}

export async function checkTrackCProductionSchema({ connectionString, checkedAt = new Date() } = {}) {
  const databaseUrl = cleanText(connectionString);
  const baseReport = {
    contract: "track_c_d_production_schema_preflight_v2",
    checked_at: checkedAt.toISOString(),
    configured: Boolean(databaseUrl),
    read_only_requested: true,
    read_only: false
  };

  if (!databaseUrl) {
    return {
      ...baseReport,
      ok: false,
      error_type: "DATABASE_URL_NOT_CONFIGURED",
      error_message: "POSTGRES_URL_NON_POOLING is required for the production schema preflight."
    };
  }

  const client = new Client({
    connectionString: databaseUrl,
    application_name: "lynca_track_c_schema_preflight",
    connectionTimeoutMillis: 12_000,
    statement_timeout: 20_000,
    query_timeout: 25_000
  });

  try {
    await client.connect();
    await client.query("begin read only");
    await client.query("set local lock_timeout = '2s'");
    await client.query("set local statement_timeout = '20s'");
    const snapshot = await readSchema(client);
    const evaluation = evaluateSchema(snapshot);
    await client.query("commit");

    const readOnly = snapshot.server?.transaction_read_only === "on";
    return {
      ...baseReport,
      ok: readOnly && evaluation.failedChecks === 0,
      read_only: readOnly,
      server_version_num: snapshot.server?.server_version_num || null,
      failed_check_count: evaluation.failedChecks + (readOnly ? 0 : 1),
      checks: evaluation.sections
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The connection may have failed before a transaction existed.
    }
    return {
      ...baseReport,
      ok: false,
      ...safeError(error, databaseUrl)
    };
  } finally {
    try {
      await client.end();
    } catch {
      // Preserve the primary preflight result if connection cleanup fails.
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath = argumentValue(argv, "--out");
  const report = await checkTrackCProductionSchema({
    connectionString: process.env.POSTGRES_URL_NON_POOLING
  });
  writeReport(report, outputPath);
  process.exitCode = report.ok ? 0 : 1;
}

const isEntrypoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  await main();
}
