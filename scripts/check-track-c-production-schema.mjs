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
  "listing_identity_resolution_cache",
  "listing_active_catalog_snapshot",
  "listing_writer_final_replay",
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
  "v4_sem_validation_events",
  "listing_identity_resolution_cache",
  "listing_active_catalog_snapshot",
  "listing_writer_final_replay"
]);

const serviceUpdatableFactTables = Object.freeze([
  "v4_learning_events",
  "listing_identity_resolution_cache",
  "listing_active_catalog_snapshot",
  "listing_writer_final_replay"
]);

const serviceDeletableFactTables = Object.freeze([
  "listing_identity_resolution_cache",
  "listing_active_catalog_snapshot",
  "listing_writer_final_replay"
]);

const expectedStoragePolicyContracts = Object.freeze([
  Object.freeze({
    policy: "listing_card_images_service_role_select",
    roles: Object.freeze(["service_role"]),
    command: "SELECT",
    usingExpression: "bucket_id = 'listing-card-images'",
    withCheckExpression: null
  }),
  Object.freeze({
    policy: "listing_card_images_service_role_insert",
    roles: Object.freeze(["service_role"]),
    command: "INSERT",
    usingExpression: null,
    withCheckExpression: "bucket_id = 'listing-card-images'"
  }),
  Object.freeze({
    policy: "listing_card_images_service_role_update",
    roles: Object.freeze(["service_role"]),
    command: "UPDATE",
    usingExpression: "bucket_id = 'listing-card-images'",
    withCheckExpression: "bucket_id = 'listing-card-images'"
  }),
  Object.freeze({
    policy: "listing_card_images_service_role_delete",
    roles: Object.freeze(["service_role"]),
    command: "DELETE",
    usingExpression: "bucket_id = 'listing-card-images'",
    withCheckExpression: null
  })
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
  "enqueue_v4_recognition_batch_atomic(jsonb,jsonb,text,jsonb,text)",
  "fence_v4_recognition_job_execution(text,text,integer)",
  "persist_v4_noncritical_artifacts(text,jsonb,jsonb,jsonb,jsonb)",
  "persist_v4_writer_ready_and_release_capacity(text,jsonb,text,text)",
  "track_c_ops_snapshot(text,timestamp with time zone)",
  "track_c_production_schema_catalog_snapshot()",
  "track_c_storage_boundary_snapshot()",
  "fail_v4_recognition_job(text,text,jsonb,boolean,boolean)",
  "bump_active_catalog_snapshot_revision()",
  "sync_writer_final_replay_from_session()"
]);

// Trigger functions are part of the PostgreSQL catalog contract but PostgREST
// intentionally does not expose functions returning `trigger` as RPC routes.
// Keeping the two contracts distinct prevents a healthy schema from blocking
// every production release.
const requiredRestFunctions = Object.freeze(requiredFunctions.filter((signature) => ![
  "bump_active_catalog_snapshot_revision()",
  "sync_writer_final_replay_from_session()"
].includes(signature)));

const forbiddenFunctions = Object.freeze([
  "persist_v4_writer_feedback_transaction(text,text,text,jsonb,jsonb)",
  "enqueue_v4_recognition_batch_atomic(text,text,jsonb,jsonb,jsonb)"
]);

const serviceOnlyFunctions = Object.freeze([
  "heartbeat_v4_recognition_job(text,text,integer)",
  "persist_v4_writer_feedback_transaction(text,text,text,text,jsonb,jsonb)",
  "enqueue_v4_recognition_batch_atomic(jsonb,jsonb,text,jsonb,text)",
  "fence_v4_recognition_job_execution(text,text,integer)",
  "track_c_production_schema_catalog_snapshot()",
  "track_c_storage_boundary_snapshot()",
  "bump_active_catalog_snapshot_revision()",
  "sync_writer_final_replay_from_session()"
]);

const browserDeniedTables = requiredTables;
const browserTablePrivileges = Object.freeze([
  "select",
  "insert",
  "update",
  "delete",
  "truncate",
  "references",
  "trigger"
]);

function policyContract(table, policy, command, usingExpression = null, withCheckExpression = null) {
  return Object.freeze({
    table,
    policy,
    permissive: "PERMISSIVE",
    roles: Object.freeze(["authenticated"]),
    command,
    usingExpression,
    withCheckExpression
  });
}

const expectedPolicyContracts = Object.freeze([
  policyContract("tenants", "track_c_tenants_select", "SELECT", "private.is_tenant_member(id)"),
  policyContract(
    "tenants",
    "track_c_tenants_update",
    "UPDATE",
    "private.has_tenant_permission(id, 'MANAGE_TENANT')",
    "private.has_tenant_permission(id, 'MANAGE_TENANT')"
  ),
  policyContract("users", "track_c_users_select", "SELECT", "private.can_view_app_user(id)"),
  policyContract(
    "users",
    "track_c_users_update_self",
    "UPDATE",
    "id = private.current_app_user_id()",
    "id = private.current_app_user_id()"
  ),
  policyContract(
    "tenant_members",
    "track_c_tenant_members_select",
    "SELECT",
    "private.has_tenant_permission(tenant_id, 'VIEW_ALL')"
  ),
  policyContract(
    "tenant_members",
    "track_c_tenant_members_insert",
    "INSERT",
    null,
    "private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS')"
  ),
  policyContract(
    "tenant_members",
    "track_c_tenant_members_update",
    "UPDATE",
    "private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS')",
    "private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS')"
  ),
  policyContract(
    "tenant_members",
    "track_c_tenant_members_delete",
    "DELETE",
    "private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS')"
  ),
  ...tenantPolicyTables.flatMap((table) => {
    const mutationPermission = ["v4_writer_export_batches", "v4_writer_export_items"].includes(table)
      ? "EXPORT"
      : "OPERATE";
    return [
      policyContract(
        table,
        "track_c_tenant_select",
        "SELECT",
        "private.has_tenant_permission(tenant_id, 'VIEW_ALL')"
      ),
      policyContract(
        table,
        "track_c_tenant_insert",
        "INSERT",
        null,
        `private.has_tenant_permission(tenant_id, '${mutationPermission}')`
      ),
      policyContract(
        table,
        "track_c_tenant_update",
        "UPDATE",
        `private.has_tenant_permission(tenant_id, '${mutationPermission}')`,
        `private.has_tenant_permission(tenant_id, '${mutationPermission}')`
      ),
      policyContract(
        table,
        "track_c_tenant_delete",
        "DELETE",
        `private.has_tenant_permission(tenant_id, '${mutationPermission}')`
      )
    ];
  }),
  policyContract(
    "request_logs",
    "track_c_request_logs_select",
    "SELECT",
    "private.has_tenant_permission(tenant_id, 'VIEW_ALL')"
  ),
  policyContract(
    "job_attempt_events",
    "track_c_job_attempt_events_select",
    "SELECT",
    "private.has_tenant_permission(tenant_id, 'VIEW_ALL')"
  ),
  policyContract(
    "error_logs",
    "track_c_error_logs_select",
    "SELECT",
    "private.has_tenant_permission(tenant_id, 'VIEW_ALL')"
  ),
  policyContract(
    "production_events",
    "track_c_production_events_select",
    "SELECT",
    "private.has_tenant_permission(tenant_id, 'VIEW_COSTS')"
  )
]);

const requiredPolicies = Object.freeze(
  expectedPolicyContracts.map(({ table, policy }) => [table, policy])
);

function checkConstraintContract(table, constraint, columns, expression, validated = true) {
  return Object.freeze({
    table,
    constraint,
    type: "c",
    validated,
    columns: Object.freeze(columns),
    expression
  });
}

function foreignKeyConstraintContract(
  table,
  constraint,
  columns,
  referencedTable,
  referencedColumns,
  { deleteAction = "r", deleteSetColumns = [] } = {}
) {
  return Object.freeze({
    table,
    constraint,
    type: "f",
    validated: true,
    columns: Object.freeze(columns),
    referencedTable,
    referencedColumns: Object.freeze(referencedColumns),
    updateAction: "a",
    deleteAction,
    matchType: "s",
    deferrable: false,
    initiallyDeferred: false,
    deleteSetColumns: Object.freeze(deleteSetColumns)
  });
}

const expectedConstraintContracts = Object.freeze([
  checkConstraintContract(
    "tenant_members",
    "tenant_members_role_check",
    ["role"],
    "role = ANY (ARRAY['OWNER', 'MANAGER', 'WRITER'])"
  ),
  checkConstraintContract(
    "tenants",
    "tenants_settings_object_check",
    ["settings"],
    "jsonb_typeof(settings) = 'object'"
  ),
  checkConstraintContract(
    "preingestion_jobs",
    "preingestion_jobs_max_attempts_chk",
    ["max_attempts"],
    "max_attempts >= 1 AND max_attempts <= 20"
  ),
  checkConstraintContract(
    "preingestion_jobs",
    "preingestion_jobs_lease_pair_chk",
    ["lease_owner", "lease_expires_at"],
    "(lease_owner IS NULL) = (lease_expires_at IS NULL)"
  ),
  foreignKeyConstraintContract(
    "v4_recognition_jobs",
    "v4_recognition_jobs_tenant_id_fkey",
    ["tenant_id"],
    "public.tenants",
    ["id"]
  ),
  foreignKeyConstraintContract(
    "v4_recognition_jobs",
    "v4_recognition_jobs_tenant_batch_fkey",
    ["tenant_id", "batch_id"],
    "public.v4_recognition_batches",
    ["tenant_id", "id"]
  ),
  foreignKeyConstraintContract(
    "v4_recognition_sessions",
    "track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f",
    ["tenant_id", "preingestion_bundle_id"],
    "public.v4_preingestion_bundles",
    ["tenant_id", "id"],
    { deleteAction: "n", deleteSetColumns: ["preingestion_bundle_id"] }
  ),
  foreignKeyConstraintContract(
    "v4_writer_feedback_events",
    "v4_writer_feedback_events_tenant_id_fkey",
    ["tenant_id"],
    "public.tenants",
    ["id"]
  ),
  foreignKeyConstraintContract(
    "v4_learning_events",
    "v4_learning_events_tenant_id_fkey",
    ["tenant_id"],
    "public.tenants",
    ["id"]
  ),
  foreignKeyConstraintContract(
    "v4_sem_validation_events",
    "v4_sem_validation_events_tenant_id_fkey",
    ["tenant_id"],
    "public.tenants",
    ["id"]
  ),
  checkConstraintContract(
    "v4_sem_validation_events",
    "v4_sem_validation_identity_group_check",
    ["validation_status", "identity_group_id"],
    "validation_status <> 'VALIDATED' OR NULLIF(btrim(identity_group_id), '') IS NOT NULL"
  ),
  checkConstraintContract(
    "v4_sem_validation_events",
    "v4_sem_validation_current_version_check",
    ["validation_status", "parser_version", "sem_standard_version"],
    "validation_status <> 'VALIDATED' OR parser_version = 'parse-reviewed-title-fields-v1' AND sem_standard_version = 'linear-cos-10-23-v25'"
  ),
  checkConstraintContract(
    "v4_sem_validation_events",
    "v4_sem_validation_sources_object_check",
    ["validation_sources"],
    "jsonb_typeof(validation_sources) = 'object'"
  ),
  checkConstraintContract(
    "v4_sem_validation_events",
    "v4_sem_validation_disposition_check",
    ["dataset_disposition"],
    "dataset_disposition = 'OBSERVE_ONLY'"
  ),
  // These checks deliberately remain NOT VALID for pre-Track-D legacy rows.
  // PostgreSQL still enforces them for every new feedback fact.
  checkConstraintContract(
    "v4_writer_feedback_events",
    "v4_writer_feedback_action_title_check",
    ["action", "writer_final_title", "generated_title"],
    "action = 'REJECT' AND NULLIF(writer_final_title, '') IS NULL OR action = 'ACCEPT' AND NULLIF(writer_final_title, '') IS NOT NULL AND NOT writer_final_title IS DISTINCT FROM generated_title OR action = 'EDIT' AND NULLIF(writer_final_title, '') IS NOT NULL AND writer_final_title IS DISTINCT FROM generated_title",
    false
  ),
  checkConstraintContract(
    "v4_writer_feedback_events",
    "v4_writer_feedback_projection_check",
    [
      "writer_feedback",
      "action",
      "writer_final_title",
      "recognition_result",
      "recognition_session_id",
      "generated_title"
    ],
    "NOT NULLIF(writer_feedback ->> 'action', '') IS DISTINCT FROM action AND NOT NULLIF(writer_feedback ->> 'final_title', '') IS DISTINCT FROM NULLIF(writer_final_title, '') AND NOT NULLIF(recognition_result ->> 'recognition_session_id', '') IS DISTINCT FROM recognition_session_id AND NOT NULLIF(recognition_result ->> 'ai_title', '') IS DISTINCT FROM NULLIF(generated_title, '')",
    false
  )
]);

const requiredConstraints = Object.freeze(
  expectedConstraintContracts
    .filter((contract) => contract.validated)
    .map(({ table, constraint }) => [table, constraint])
);
const requiredNotValidConstraints = Object.freeze(
  expectedConstraintContracts
    .filter((contract) => !contract.validated)
    .map(({ table, constraint }) => [table, constraint])
);

const requiredIndexes = Object.freeze([
  ["preingestion_jobs", "preingestion_jobs_ocr_stale_lease_idx"],
  ["v4_preingestion_bundles", "v4_preingestion_bundles_tenant_id_uidx"],
  ["v4_writer_feedback_events", "v4_writer_feedback_submission_uidx"],
  ["v4_writer_feedback_events", "v4_writer_feedback_revision_uidx"],
  ["v4_learning_events", "v4_learning_feedback_event_uidx"],
  ["v4_sem_validation_events", "v4_sem_validation_status_idx"]
]);

function triggerContract(
  table,
  trigger,
  functionSignature,
  events,
  updateColumns = []
) {
  return Object.freeze({
    table,
    trigger,
    functionSignature,
    timing: "BEFORE",
    events: Object.freeze(events),
    updateColumns: Object.freeze(updateColumns),
    rowLevel: true,
    enabledState: "O",
    whenExpression: null
  });
}

const expectedTriggerContracts = Object.freeze([
  ...tenantScopedTables.map((table) => triggerContract(
    table,
    "track_c_tenant_id_immutable",
    "private.prevent_tenant_change()",
    ["UPDATE"],
    ["tenant_id"]
  )),
  triggerContract(
    "v4_recognition_sessions",
    "prevent_v4_session_identity_reassignment",
    "public.prevent_v4_session_identity_reassignment()",
    ["UPDATE"]
  ),
  triggerContract(
    "v4_recognition_jobs",
    "validate_v4_recognition_job_session_identity",
    "public.validate_v4_recognition_job_session_identity()",
    ["INSERT", "UPDATE"],
    ["recognition_session_id", "tenant_id", "operator_id", "asset_id", "payload"]
  ),
  triggerContract(
    "v4_writer_feedback_events",
    "prevent_v4_writer_feedback_mutation",
    "public.prevent_v4_writer_feedback_mutation()",
    ["DELETE", "UPDATE"]
  ),
  triggerContract(
    "v4_learning_events",
    "prevent_v4_writer_learning_event_mutation",
    "public.prevent_v4_writer_learning_event_mutation()",
    ["DELETE", "UPDATE"]
  ),
  triggerContract(
    "v4_sem_validation_events",
    "prevent_v4_sem_validation_mutation",
    "public.prevent_v4_writer_feedback_mutation()",
    ["DELETE", "UPDATE"]
  ),
  triggerContract(
    "v4_sem_validation_events",
    "validate_v4_sem_validation_identity",
    "public.validate_v4_sem_validation_identity()",
    ["INSERT"]
  )
]);

const requiredTriggers = Object.freeze(
  expectedTriggerContracts.map(({ table, trigger }) => [table, trigger])
);

export const TRACK_C_SCHEMA_SECURITY_CONTRACT = Object.freeze({
  browserDeniedTables,
  browserTablePrivileges,
  policies: expectedPolicyContracts,
  storagePolicies: expectedStoragePolicyContracts,
  triggers: expectedTriggerContracts,
  constraints: expectedConstraintContracts
});

// Keep the Data API fallback on the same source-of-truth lists as the full
// PostgreSQL catalog preflight. OpenAPI cannot expose every pg_catalog detail,
// so the fallback additionally performs active, read-only PostgREST probes;
// it must never silently drop a table or RPC when this contract evolves.
export const TRACK_C_REST_SCHEMA_CONTRACT = Object.freeze({
  catalogRequiredTables: requiredTables,
  requiredTables: Object.freeze([
    ...new Set([
      ...requiredTables,
      ...requiredIndexes.map(([table]) => table)
    ])
  ]),
  tenantScopedTables,
  catalogRequiredFunctions: requiredFunctions,
  requiredFunctions: requiredRestFunctions,
  forbiddenFunctions,
  serviceOnlyFactTables,
  serviceUpdatableFactTables,
  serviceDeletableFactTables,
  serviceOnlyFunctions,
  requiredIndexes,
  criticalColumns: Object.freeze([
    ...tenantScopedTables.map((table) => Object.freeze({
      table,
      column: "tenant_id",
      format: "text",
      required: true,
      default: null
    })),
    Object.freeze({ table: "tenants", column: "settings", format: "jsonb", required: true }),
    ...[
      ["canonical_state", "text"],
      ["retry_count", "integer"],
      ["last_error", "text"],
      ["error_type", "text"],
      ["next_retry_at", "timestamp with time zone"]
    ].map(([column, format]) => Object.freeze({
      table: "v4_recognition_jobs",
      column,
      format,
      required: false
    })),
    Object.freeze({
      table: "v4_recognition_jobs",
      column: "max_attempts",
      format: "integer",
      required: true,
      default: 4
    }),
    Object.freeze({
      table: "preingestion_jobs",
      column: "max_attempts",
      format: "integer",
      required: true,
      default: 3
    }),
    Object.freeze({
      table: "preingestion_jobs",
      column: "lease_owner",
      format: "text",
      required: false
    }),
    Object.freeze({
      table: "preingestion_jobs",
      column: "lease_expires_at",
      format: "timestamp with time zone",
      required: false
    }),
    ...["v4_recognition_sessions", "v4_recognition_jobs"].flatMap((table) => (
      ["created_by_user_id", "assigned_to_user_id"].map((column) => Object.freeze({
        table,
        column,
        format: "text"
      }))
    ))
  ]),
  atomicEnqueueRpc: Object.freeze({
    name: "enqueue_v4_recognition_batch_atomic",
    properties: Object.freeze({
      p_batch: "jsonb",
      p_jobs: "jsonb",
      p_operator_id: "text",
      p_sessions: "jsonb",
      p_tenant_id: "text"
    }),
    required: Object.freeze([
      "p_batch",
      "p_jobs",
      "p_operator_id",
      "p_sessions",
      "p_tenant_id"
    ])
  })
});

function cleanText(value) {
  return String(value || "").trim();
}

function stripBalancedOuterParentheses(value) {
  let text = cleanText(value);
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let closesAtEnd = false;
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === "'" && text[index - 1] !== "\\") quoted = !quoted;
      if (quoted) continue;
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0) {
        closesAtEnd = index === text.length - 1;
        break;
      }
    }
    if (!closesAtEnd) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function normalizeSqlExpression(value) {
  if (value === null || value === undefined) return null;
  return stripBalancedOuterParentheses(
    cleanText(value)
      .replace(/::(?:pg_catalog\.)?text\b/g, "")
      .replace(/\s+/g, " ")
  );
}

function sortedStrings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .sort();
}

function sameOrderedStrings(actual, expected) {
  const left = (Array.isArray(actual) ? actual : []).map((value) => cleanText(value));
  const right = (Array.isArray(expected) ? expected : []).map((value) => cleanText(value));
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSet(actual, expected) {
  return sameOrderedStrings(sortedStrings(actual), sortedStrings(expected));
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
      select
        tablename,
        policyname,
        permissive,
        roles::text[] as roles,
        cmd,
        qual,
        with_check
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename, policyname
    `,
    [policyTables]
  );

  const triggerResult = await client.query(
    `
      select
        relation.relname as table_name,
        trigger.tgname as trigger_name,
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
      join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_proc function_row on function_row.oid = trigger.tgfoid
      join pg_catalog.pg_namespace function_namespace
        on function_namespace.oid = function_row.pronamespace
      where namespace.nspname = 'public'
        and relation.relname = any($1::text[])
        and trigger.tgname = any($2::text[])
        and not trigger.tgisinternal
      order by relation.relname, trigger.tgname
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
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.confupdtype,
        constraint_row.confdeltype,
        constraint_row.confmatchtype,
        case
          when referenced_relation.oid is null then null
          else pg_catalog.format(
            '%I.%I',
            referenced_namespace.nspname,
            referenced_relation.relname
          )
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
        pg_catalog.pg_get_expr(
          constraint_row.conbin,
          constraint_row.conrelid,
          true
        ) as check_expression,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as constraint_definition
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      left join pg_catalog.pg_class referenced_relation
        on referenced_relation.oid = constraint_row.confrelid
      left join pg_catalog.pg_namespace referenced_namespace
        on referenced_namespace.oid = referenced_relation.relnamespace
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

  const browserAclResult = await client.query(
    `
      with required as (
        select
          required_table.table_name,
          pg_catalog.to_regclass(
            pg_catalog.format('public.%I', required_table.table_name)
          ) as relation_oid
        from pg_catalog.unnest($1::text[]) as required_table(table_name)
      )
      select
        required.table_name,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'SELECT') as anon_select,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'INSERT') as anon_insert,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'UPDATE') as anon_update,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'DELETE') as anon_delete,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'TRUNCATE') as anon_truncate,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'REFERENCES') as anon_references,
        pg_catalog.has_table_privilege('anon', required.relation_oid, 'TRIGGER') as anon_trigger,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'SELECT'
        ) as authenticated_select,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'INSERT'
        ) as authenticated_insert,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'UPDATE'
        ) as authenticated_update,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'DELETE'
        ) as authenticated_delete,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'TRUNCATE'
        ) as authenticated_truncate,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'REFERENCES'
        ) as authenticated_references,
        pg_catalog.has_table_privilege(
          'authenticated', required.relation_oid, 'TRIGGER'
        ) as authenticated_trigger
      from required
      order by required.table_name
    `,
    [browserDeniedTables]
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
        coalesce((
          select relation.relrowsecurity
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace
            on namespace.oid = relation.relnamespace
          where namespace.nspname = 'storage'
            and relation.relname = 'objects'
            and relation.relkind in ('r', 'p')
        ), false) as storage_row_level_security,
        coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'policyname', policy.policyname,
              'roles', policy.roles::text[],
              'cmd', policy.cmd,
              'qual', policy.qual,
              'with_check', policy.with_check
            )
            order by policy.policyname
          )
          from pg_catalog.pg_policies policy
          where policy.schemaname = 'storage'
            and policy.tablename = 'objects'
        ), '[]'::jsonb) as storage_policies,
        (
          select pg_catalog.jsonb_build_object(
            'function_volatility', function_row.provolatile,
            'security_definer', function_row.prosecdef,
            'search_path', function_row.proconfig
          )
          from pg_catalog.pg_proc function_row
          where function_row.oid = pg_catalog.to_regprocedure(
            'public.track_c_storage_boundary_snapshot()'
          )
        ) as storage_boundary_meta,
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
    browserAcls: browserAclResult.rows,
    factAcls: factAclResult.rows,
    functionAcls: functionAclResult.rows,
    dataInvariants: dataInvariantResult.rows[0],
    server: serverResult.rows[0],
    executionBoundary: executionBoundaryResult.rows[0]
  };
}

export function evaluateTrackCSecurityCatalog(snapshot = {}) {
  const policies = Array.isArray(snapshot.policies) ? snapshot.policies : [];
  const policyMap = new Map(
    policies.map((row) => [`${row.tablename}.${row.policyname}`, row])
  );
  const policyChecks = expectedPolicyContracts.map((expected) => {
    const row = policyMap.get(`${expected.table}.${expected.policy}`);
    const actualRoles = sortedStrings(row?.roles);
    const expectedRoles = sortedStrings(expected.roles);
    const actualUsing = normalizeSqlExpression(row?.qual);
    const expectedUsing = normalizeSqlExpression(expected.usingExpression);
    const actualWithCheck = normalizeSqlExpression(row?.with_check);
    const expectedWithCheck = normalizeSqlExpression(expected.withCheckExpression);
    return {
      table: expected.table,
      policy: expected.policy,
      requirement: "exact_policy_semantics",
      ok: Boolean(
        row
        && row.permissive === expected.permissive
        && sameOrderedStrings(actualRoles, expectedRoles)
        && row.cmd === expected.command
        && actualUsing === expectedUsing
        && actualWithCheck === expectedWithCheck
      ),
      actual: row
        ? {
            permissive: row.permissive,
            roles: actualRoles,
            command: row.cmd,
            using_expression: actualUsing,
            with_check_expression: actualWithCheck
          }
        : null,
      expected: {
        permissive: expected.permissive,
        roles: expectedRoles,
        command: expected.command,
        using_expression: expectedUsing,
        with_check_expression: expectedWithCheck
      }
    };
  });

  const serviceOnlyPolicyChecks = serviceOnlyFactTables.map((table) => {
    const tablePolicies = policies
      .filter((row) => row.tablename === table)
      .map((row) => row.policyname)
      .sort();
    return {
      table,
      requirement: "no_authenticated_rls_policies",
      ok: tablePolicies.length === 0,
      policies: tablePolicies
    };
  });

  const browserAclMap = new Map(
    (Array.isArray(snapshot.browserAcls) ? snapshot.browserAcls : [])
      .map((row) => [row.table_name, row])
  );
  const browserAclChecks = browserDeniedTables.map((table) => {
    const row = browserAclMap.get(table);
    const actual = Object.fromEntries(["anon", "authenticated"].map((role) => [
      role,
      Object.fromEntries(browserTablePrivileges.map((privilege) => [
        privilege,
        row?.[`${role}_${privilege}`] === true
      ]))
    ]));
    return {
      table,
      requirement: "anon_and_authenticated_have_no_table_privileges",
      ok: Boolean(
        row
        && ["anon", "authenticated"].every((role) => (
          browserTablePrivileges.every((privilege) => row[`${role}_${privilege}`] === false)
        ))
      ),
      actual
    };
  });

  const triggerMap = new Map(
    (Array.isArray(snapshot.triggers) ? snapshot.triggers : [])
      .map((row) => [`${row.table_name}.${row.trigger_name}`, row])
  );
  const triggerChecks = expectedTriggerContracts.map((expected) => {
    const row = triggerMap.get(`${expected.table}.${expected.trigger}`);
    const actualEvents = sortedStrings(row?.events);
    const expectedEvents = sortedStrings(expected.events);
    const actualUpdateColumns = sortedStrings(row?.update_columns);
    const expectedUpdateColumns = sortedStrings(expected.updateColumns);
    const actualWhenExpression = normalizeSqlExpression(row?.when_expression);
    const expectedWhenExpression = normalizeSqlExpression(expected.whenExpression);
    return {
      table: expected.table,
      trigger: expected.trigger,
      requirement: "exact_trigger_semantics",
      ok: Boolean(
        row
        && row.function_signature === expected.functionSignature
        && row.timing === expected.timing
        && sameOrderedStrings(actualEvents, expectedEvents)
        && sameOrderedStrings(actualUpdateColumns, expectedUpdateColumns)
        && row.row_level === expected.rowLevel
        && row.tgenabled === expected.enabledState
        && actualWhenExpression === expectedWhenExpression
      ),
      actual: row
        ? {
            function_signature: row.function_signature,
            timing: row.timing,
            events: actualEvents,
            update_columns: actualUpdateColumns,
            row_level: row.row_level === true,
            enabled_state: row.tgenabled,
            when_expression: actualWhenExpression,
            definition: row.trigger_definition || null
          }
        : null,
      expected: {
        function_signature: expected.functionSignature,
        timing: expected.timing,
        events: expectedEvents,
        update_columns: expectedUpdateColumns,
        row_level: expected.rowLevel,
        enabled_state: expected.enabledState,
        when_expression: expectedWhenExpression
      }
    };
  });

  const constraints = Array.isArray(snapshot.constraints) ? snapshot.constraints : [];
  const constraintMap = new Map(
    constraints.map((row) => [`${row.table_name}.${row.constraint_name}`, row])
  );
  const constraintChecks = expectedConstraintContracts.map((expected) => {
    const row = constraintMap.get(`${expected.table}.${expected.constraint}`);
    const actualColumns = Array.isArray(row?.constrained_columns)
      ? row.constrained_columns.map((value) => cleanText(value))
      : [];
    const commonSemanticsMatch = Boolean(
      row
      && row.contype === expected.type
      && row.convalidated === expected.validated
    );
    let semanticsMatch = false;
    let actualSemantics = null;
    let expectedSemantics = null;

    if (expected.type === "c") {
      const actualExpression = normalizeSqlExpression(row?.check_expression);
      const expectedExpression = normalizeSqlExpression(expected.expression);
      semanticsMatch = Boolean(
        commonSemanticsMatch
        && sameStringSet(actualColumns, expected.columns)
        && actualExpression === expectedExpression
      );
      actualSemantics = row
        ? { columns: sortedStrings(actualColumns), check_expression: actualExpression }
        : null;
      expectedSemantics = {
        columns: sortedStrings(expected.columns),
        check_expression: expectedExpression
      };
    } else if (expected.type === "f") {
      const actualReferencedColumns = Array.isArray(row?.referenced_columns)
        ? row.referenced_columns.map((value) => cleanText(value))
        : [];
      const actualDeleteSetColumns = sortedStrings(row?.delete_set_columns);
      const expectedDeleteSetColumns = sortedStrings(expected.deleteSetColumns);
      semanticsMatch = Boolean(
        commonSemanticsMatch
        && sameOrderedStrings(actualColumns, expected.columns)
        && row.referenced_table === expected.referencedTable
        && sameOrderedStrings(actualReferencedColumns, expected.referencedColumns)
        && row.confupdtype === expected.updateAction
        && row.confdeltype === expected.deleteAction
        && row.confmatchtype === expected.matchType
        && row.condeferrable === expected.deferrable
        && row.condeferred === expected.initiallyDeferred
        && sameOrderedStrings(actualDeleteSetColumns, expectedDeleteSetColumns)
      );
      actualSemantics = row
        ? {
            columns: actualColumns,
            referenced_table: row.referenced_table,
            referenced_columns: actualReferencedColumns,
            update_action: row.confupdtype,
            delete_action: row.confdeltype,
            match_type: row.confmatchtype,
            deferrable: row.condeferrable === true,
            initially_deferred: row.condeferred === true,
            delete_set_columns: actualDeleteSetColumns
          }
        : null;
      expectedSemantics = {
        columns: expected.columns,
        referenced_table: expected.referencedTable,
        referenced_columns: expected.referencedColumns,
        update_action: expected.updateAction,
        delete_action: expected.deleteAction,
        match_type: expected.matchType,
        deferrable: expected.deferrable,
        initially_deferred: expected.initiallyDeferred,
        delete_set_columns: expectedDeleteSetColumns
      };
    }

    return {
      table: expected.table,
      constraint: expected.constraint,
      requirement: expected.validated
        ? "exact_validated_constraint_semantics"
        : "exact_not_valid_constraint_semantics",
      ok: semanticsMatch,
      present: Boolean(row),
      type: row?.contype || null,
      validated: row?.convalidated === true,
      actual: actualSemantics,
      expected: expectedSemantics,
      definition: row?.constraint_definition || null
    };
  });

  const expectedConstraintChecks = constraintChecks.filter((check) => (
    check.requirement === "exact_validated_constraint_semantics"
  ));
  const requiredNotValidConstraintChecks = constraintChecks.filter((check) => (
    check.requirement === "exact_not_valid_constraint_semantics"
  ));
  const allowedNotValidConstraintKeys = new Set(
    requiredNotValidConstraints.map(([table, constraint]) => `${table}.${constraint}`)
  );
  const invalidConstraints = constraints
    .filter((row) => (
      row.convalidated !== true
      && !allowedNotValidConstraintKeys.has(`${row.table_name}.${row.constraint_name}`)
    ))
    .map((row) => ({ table: row.table_name, constraint: row.constraint_name, type: row.contype }));

  return {
    policies: policyChecks,
    service_only_fact_policies: serviceOnlyPolicyChecks,
    browser_denied_table_acls: browserAclChecks,
    required_triggers: triggerChecks,
    expected_constraints: expectedConstraintChecks,
    intentional_not_valid_constraints: requiredNotValidConstraintChecks,
    invalid_constraints: {
      ok: invalidConstraints.length === 0,
      items: invalidConstraints
    }
  };
}

export function evaluateTrackCProductionSchemaSnapshot(snapshot) {
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

  const securitySections = evaluateTrackCSecurityCatalog(snapshot);

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
  const storagePolicies = Array.isArray(executionBoundary.storage_policies)
    ? executionBoundary.storage_policies
    : [];
  const storagePolicyMap = new Map(
    storagePolicies.map((row) => [cleanText(row?.policyname), row])
  );
  const expectedStoragePolicyNames = new Set(
    expectedStoragePolicyContracts.map(({ policy }) => policy)
  );
  const storagePolicyChecks = expectedStoragePolicyContracts.map((expected) => {
    const row = storagePolicyMap.get(expected.policy);
    const actualRoles = sortedStrings(row?.roles);
    const expectedRoles = sortedStrings(expected.roles);
    const actualUsing = normalizeSqlExpression(row?.qual);
    const expectedUsing = normalizeSqlExpression(expected.usingExpression);
    const actualWithCheck = normalizeSqlExpression(row?.with_check);
    const expectedWithCheck = normalizeSqlExpression(expected.withCheckExpression);
    return {
      policy: expected.policy,
      ok: Boolean(
        row
        && sameOrderedStrings(actualRoles, expectedRoles)
        && row.cmd === expected.command
        && actualUsing === expectedUsing
        && actualWithCheck === expectedWithCheck
      ),
      actual: row
        ? {
            roles: actualRoles,
            command: row.cmd,
            using_expression: actualUsing,
            with_check_expression: actualWithCheck
          }
        : null,
      expected: {
        roles: expectedRoles,
        command: expected.command,
        using_expression: expectedUsing,
        with_check_expression: expectedWithCheck
      }
    };
  });
  const browserStoragePolicies = storagePolicies.filter((row) => (
    sortedStrings(row?.roles).some((role) => (
      ["public", "anon", "authenticated"].includes(role.toLowerCase())
    ))
  ));
  const unexpectedStoragePolicies = storagePolicies.filter((row) => (
    !expectedStoragePolicyNames.has(cleanText(row?.policyname))
  ));
  const storageBoundaryMeta = executionBoundary.storage_boundary_meta || {};
  const storageBoundaryEmptySearchPath = Array.isArray(storageBoundaryMeta.search_path)
    && storageBoundaryMeta.search_path.some((setting) => (
      /^search_path=(?:""|)$/.test(cleanText(setting))
    ));
  const executionBoundaryChecks = [
    {
      boundary: "browser_storage_rls",
      requirement: "rls_default_deny_with_exact_service_signed_url_policies",
      ok: Boolean(
        executionBoundary.storage_objects
        && executionBoundary.storage_row_level_security === true
        && browserStoragePolicies.length === 0
        && unexpectedStoragePolicies.length === 0
        && storagePolicies.length === expectedStoragePolicyContracts.length
        && storagePolicyChecks.every(({ ok }) => ok)
        && storageBoundaryMeta.function_volatility === "s"
        && storageBoundaryMeta.security_definer === true
        && storageBoundaryEmptySearchPath
      ),
      actual: {
        storage_objects: executionBoundary.storage_objects || null,
        row_level_security: executionBoundary.storage_row_level_security === true,
        browser_policies: browserStoragePolicies.map((row) => cleanText(row.policyname)),
        unexpected_policies: unexpectedStoragePolicies.map((row) => cleanText(row.policyname)),
        policy_checks: storagePolicyChecks,
        helper: {
          stable: storageBoundaryMeta.function_volatility === "s",
          security_definer: storageBoundaryMeta.security_definer === true,
          empty_search_path: storageBoundaryEmptySearchPath
        },
        managed_authenticated_table_privileges: {
          schema_usage: executionBoundary.authenticated_storage_usage === true,
          select: executionBoundary.authenticated_storage_select === true,
          insert: executionBoundary.authenticated_storage_insert === true,
          update: executionBoundary.authenticated_storage_update === true,
          delete: executionBoundary.authenticated_storage_delete === true
        }
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

  const factAclChecks = snapshot.factAcls.map((row) => {
    const serviceUpdateExpected = serviceUpdatableFactTables.includes(row.table_name);
    const serviceDeleteExpected = serviceDeletableFactTables.includes(row.table_name);
    return {
      table: row.table_name,
      requirement: serviceDeleteExpected
        ? "browser_denied_service_full_lifecycle"
        : serviceUpdateExpected
        ? "browser_denied_service_upsert_without_delete"
        : "browser_denied_service_insert_only",
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
        && row.service_update === serviceUpdateExpected
        && row.service_delete === serviceDeleteExpected
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
    };
  });

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
    ...securitySections,
    indexes: indexChecks,
    service_only_fact_acls: factAclChecks,
    service_only_function_acls: functionAclChecks,
    data_invariants: dataInvariantChecks,
    execution_boundaries: executionBoundaryChecks
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
    const evaluation = evaluateTrackCProductionSchemaSnapshot(snapshot);
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
