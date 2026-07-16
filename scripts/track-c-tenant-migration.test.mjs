import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../supabase/migrations/20260715065803_track_c_tenant_foundation_expand.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");
const settingsMigrationPath = path.resolve(
  here,
  "../supabase/migrations/20260715065812_track_c_tenant_settings.sql"
);
const settingsSql = fs.readFileSync(settingsMigrationPath, "utf8");
const retryMigrationPath = path.resolve(
  here,
  "../supabase/migrations/20260715065808_track_c_retry_state_machine_hardening.sql"
);
const retrySql = fs.readFileSync(retryMigrationPath, "utf8");
const feedbackCaptureSql = fs.readFileSync(path.resolve(
  here,
  "../supabase/migrations/20260715065752_track_d_feedback_capture_v1.sql"
), "utf8");
const ocrLeaseSql = fs.readFileSync(path.resolve(
  here,
  "../supabase/migrations/20260715065820_track_c_preingestion_ocr_durable_leases.sql"
), "utf8");
const convergenceSql = fs.readFileSync(path.resolve(
  here,
  "../supabase/migrations/20260715065830_track_d_data_flywheel_convergence.sql"
), "utf8");
const preflightSource = fs.readFileSync(path.resolve(
  here,
  "./check-track-c-production-schema.mjs"
), "utf8");

for (const [name, migration] of [
  ["track_d_feedback_capture", feedbackCaptureSql],
  ["track_c_tenant_foundation", sql],
  ["track_c_retry_hardening", retrySql],
  ["track_c_tenant_settings", settingsSql],
  ["track_c_ocr_leases", ocrLeaseSql],
  ["track_d_convergence", convergenceSql]
]) {
  assert.match(migration, /^\s*(?:--[^\n]*\n)*\s*begin;/i, `${name} must be explicitly atomic`);
  assert.match(migration, /set local lock_timeout = '5s'/i, `${name} must fail fast on lock contention`);
  assert.match(migration, /set local statement_timeout = '15min'/i, `${name} must have a bounded runtime`);
  assert.match(migration, /commit;\s*$/i, `${name} must commit only after the complete migration`);
}

function tableBody(tableName) {
  const marker = `create table if not exists public.${tableName} (`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing CREATE TABLE for ${tableName}`);
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, `unterminated CREATE TABLE for ${tableName}`);
  return sql.slice(start, end + 3);
}

function functionBody(signatureStart) {
  const start = sql.indexOf(signatureStart);
  assert.notEqual(start, -1, `missing function ${signatureStart}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${signatureStart}`);
  return sql.slice(start, end + 4);
}

function assertColumns(body, columns) {
  for (const column of columns) {
    assert.match(body, new RegExp(`\\n\\s*${column}\\s`, "i"), `missing column ${column}`);
  }
}

function stripLineComments(value) {
  return value.replace(/--[^\n]*/g, "");
}

assert.ok(sql.length > 10_000, "tenant foundation migration unexpectedly small");
assert.match(retrySql, /create or replace function public\.heartbeat_v4_recognition_job/);
assert.match(retrySql, /jobs\.status = 'RUNNING'/);
assert.match(retrySql, /jobs\.lease_owner = p_worker_id/);
assert.match(retrySql, /jobs\.lease_expires_at is not null/);
assert.match(retrySql, /jobs\.lease_expires_at > heartbeat_at/);
assert.match(convergenceSql, /heartbeat_at timestamptz := pg_catalog\.clock_timestamp\(\)/);
assert.match(convergenceSql, /drop trigger if exists prevent_v4_sem_validation_mutation\s+on public\.v4_sem_validation_events/);
assert.match(convergenceSql, /jobs\.lease_expires_at is not null/);
assert.match(convergenceSql, /jobs\.lease_expires_at > heartbeat_at/);
assert.match(convergenceSql, /notify pgrst, 'reload schema';\s*\n\s*commit;/i);
assert.match(preflightSource, /requiredNotValidConstraints/);
assert.match(preflightSource, /v4_writer_feedback_action_title_check/);
assert.match(preflightSource, /v4_writer_feedback_projection_check/);
for (const table of [
  "v4_writer_feedback_events",
  "v4_learning_events",
  "v4_sem_validation_events"
]) {
  assert.match(preflightSource, new RegExp(`"${table}"`));
}
for (const signature of [
  "enqueue_v4_recognition_batch_atomic\\(text,text,jsonb,jsonb,jsonb\\)",
  "fence_v4_recognition_job_execution\\(text,text,integer\\)",
  "persist_v4_writer_feedback_transaction\\(text,text,text,jsonb,jsonb\\)"
]) {
  assert.match(preflightSource, new RegExp(signature));
}
assert.match(preflightSource, /serviceOnlyFactTables/);
assert.match(preflightSource, /serviceOnlyFunctions/);
assert.match(preflightSource, /requiredTriggers/);
assert.match(preflightSource, /validated_sem_without_supported_evidence/);
assert.match(preflightSource, /browser_denied_service_insert_only/);
assert.match(preflightSource, /service_role_execute_only/);
assert.match(sql, /'v4_sem_validation_events'/);
assert.match(sql, /drop trigger if exists prevent_v4_sem_validation_mutation on public\.v4_sem_validation_events/);
assert.match(sql, /create trigger prevent_v4_sem_validation_mutation before update or delete on public\.v4_sem_validation_events/);
assert.match(convergenceSql, /revoke update, delete on table public\.v4_learning_events from service_role/);
const semValidationIdentityStart = convergenceSql.indexOf(
  "create or replace function public.validate_v4_sem_validation_identity()"
);
const semValidationIdentityEnd = convergenceSql.indexOf("\n$$;", semValidationIdentityStart);
assert.notEqual(semValidationIdentityStart, -1, "missing final SEM validation identity trigger function");
assert.notEqual(semValidationIdentityEnd, -1, "unterminated final SEM validation identity trigger function");
const semValidationIdentityBody = convergenceSql.slice(
  semValidationIdentityStart,
  semValidationIdentityEnd
);
assert.match(semValidationIdentityBody, /from public\.v4_recognition_sessions sessions[\s\S]*for share/);
assert.doesNotMatch(
  semValidationIdentityBody,
  /from public\.v4_writer_feedback_events events[\s\S]*for share/,
  "append-only feedback identity checks must not require UPDATE privilege"
);
assert.doesNotMatch(
  semValidationIdentityBody,
  /from public\.v4_learning_events events[\s\S]*for share/,
  "append-only learning identity checks must not require UPDATE privilege"
);
for (const policy of [
  "track_c_tenant_select",
  "track_c_tenant_insert",
  "track_c_tenant_update",
  "track_c_tenant_delete"
]) {
  assert.match(convergenceSql, new RegExp(`'${policy}'`));
}

const tenants = tableBody("tenants");
assertColumns(tenants, ["id", "name", "plan", "status", "disabled_at", "created_at", "updated_at"]);
assert.match(tenants, /status in \('ACTIVE', 'DISABLED'\)/);

const users = tableBody("users");
assertColumns(users, [
  "id",
  "auth_user_id",
  "legacy_operator_id",
  "email",
  "status",
  "session_version",
  "disabled_at",
  "created_at",
  "updated_at"
]);
assert.match(users, /constraint users_auth_user_id_key unique \(auth_user_id\)/);
assert.match(users, /constraint users_legacy_operator_id_key unique \(legacy_operator_id\)/);

const members = tableBody("tenant_members");
assertColumns(members, ["tenant_id", "user_id", "role", "status", "disabled_at"]);
assert.match(members, /constraint tenant_members_tenant_id_fkey/i);
assert.match(members, /constraint tenant_members_user_id_fkey/i);
for (const role of ["OWNER", "MANAGER", "WRITER"]) {
  assert.match(members, new RegExp(`'${role}'`));
}

assert.match(sql, /'tenant_legacy'[\s\S]*?'Legacy shared workspace'[\s\S]*?'ACTIVE'/);
assert.match(sql, /'user_legacy'[\s\S]*?'user_legacy'[\s\S]*?'ACTIVE'/);
assert.match(
  sql,
  /'tenant_legacy',[\s\S]*?'user_legacy',[\s\S]*?'OWNER',[\s\S]*?'ACTIVE'/,
  "legacy compatibility principal must remain an active owner"
);
assert.match(sql, /'user_legacy_' \|\| substr\(md5/);
assert.match(sql, /'WRITER',[\s\S]*?'DISABLED'/);
assert.match(sql, /create or replace function private\.preserve_last_active_tenant_owner\(\)/);
assert.match(sql, /pg_advisory_xact_lock[\s\S]*lynca:last-owner:/);
assert.match(sql, /track_c_last_active_owner_required/);
assert.match(sql, /create trigger track_c_preserve_last_active_tenant_owner[\s\S]*before update or delete on public\.tenant_members/);

assert.match(sql, /rename column tenant_id to legacy_scheduler_scope_id/i);
assert.match(sql, /set tenant_id = %L where tenant_id is null or btrim\(tenant_id\) = %L/i);
assert.match(sql, /v_table,[\s\S]*?'tenant_legacy',[\s\S]*?''/);
assert.match(
  sql,
  /not exists \(select 1 from public\.tenants tenant_row where tenant_row\.id = btrim\(scoped\.tenant_id\)\)/,
  "unknown legacy tenant identifiers must converge before tenant foreign keys are validated"
);
assert.match(sql, /alter column tenant_id set not null/i);
assert.match(sql, /references public\.tenants\(id\)/i);
assert.match(sql, /alter column tenant_id drop default/i, "live tenant writes must fail closed when tenant_id is omitted");
assert.match(sql, /create or replace function private\.prevent_tenant_change\(\)/);
assert.match(sql, /track_c_tenant_id_immutable/);
assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);

const batches = tableBody("v4_recognition_batches");
assertColumns(batches, [
  "id",
  "tenant_id",
  "created_by_user_id",
  "assigned_to_user_id",
  "status",
  "item_count",
  "completed_count",
  "failed_count",
  "metadata",
  "created_at",
  "updated_at",
  "completed_at"
]);
assert.match(sql, /v4_recognition_jobs_tenant_batch_fkey/);
assert.match(sql, /v4_recognition_sessions_tenant_id_id_uidx/);
assert.match(sql, /on public\.v4_recognition_sessions\(tenant_id, id\)/);
assert.match(sql, /v4_recognition_jobs_tenant_id_id_uidx/);
assert.match(sql, /on public\.v4_recognition_jobs\(tenant_id, id\)/);
assert.match(sql, /preingestion_bundles_tenant_asset_source_version_uidx/);
assert.match(sql, /on public\.preingestion_bundles\(tenant_id, asset_id, source, bundle_version\)/);
assert.match(sql, /drop index if exists public\.preingestion_bundles_asset_source_version_uidx/);
assert.match(sql, /preingestion_jobs_tenant_job_key_uidx/);
assert.match(sql, /on public\.preingestion_jobs\(tenant_id, job_key\)/);
assert.match(sql, /drop index if exists public\.preingestion_jobs_job_key_uidx/);

const scopedMatch = sql.match(/v_tenant_scoped_tables text\[\] := array\[([\s\S]*?)\n\s*\];/);
assert.ok(scopedMatch, "missing explicit tenant-scoped table allowlist");
const scopedTables = new Set(
  [...scopedMatch[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1])
);
for (const table of [
  "listing_assets",
  "catalog_gap_queue",
  "listing_image_verifications",
  "listing_publish_jobs",
  "preingestion_bundles",
  "preingestion_jobs",
  "image_derived_assets",
  "v4_recognition_batches",
  "v4_recognition_sessions",
  "v4_preingestion_bundles",
  "v4_recognition_jobs",
  "v4_writer_feedback_events",
  "v4_learning_events",
  "v4_sem_validation_events",
  "v4_production_quality_ledger",
  "v4_writer_export_batches",
  "v4_writer_export_items",
  "v4_fast_scout_cache",
  "vector_query_logs",
  "recognition_workflow_events",
  "annotation_tasks",
  "reviewed_field_annotations",
  "crop_annotations"
]) {
  assert.ok(scopedTables.has(table), `missing tenant scope for ${table}`);
}
for (const sharedTable of [
  "sem_definitions",
  "catalog_sources",
  "catalog_products",
  "catalog_sets",
  "catalog_cards",
  "catalog_parallels",
  "catalog_entity_clusters",
  "card_identities",
  "card_reference_images",
  "card_image_embeddings",
  "vector_index_snapshots",
  "v4_provider_capacity_leases",
  "v4_queue_kick_leases"
]) {
  assert.equal(scopedTables.has(sharedTable), false, `${sharedTable} must remain platform-scoped`);
}

assert.match(sql, /pg_catalog\.to_regclass\('public\.v4_recognition_jobs'\) is not null/);
assert.match(sql, /information_schema\.columns/);
assert.match(sql, /add column if not exists tenant_id text/);
assert.match(sql, /add constraint %I foreign key \(tenant_id\)/);
assert.match(sql, /validate constraint %I/);
assert.match(sql, /add column if not exists created_by_user_id text, add column if not exists assigned_to_user_id text/);
assert.match(sql, /v_table \|\| '_tenant_assignee_idx'/);
assert.match(sql, /create or replace function private\.enforce_active_tenant_assignment\(\)/);
assert.match(sql, /create or replace function private\.enforce_job_session_assignee\(\)/);
assert.match(sql, /track_c_job_session_assignee_mismatch/);
assert.match(sql, /create or replace function private\.validate_session_job_assignees\(\)/);
assert.match(sql, /create constraint trigger zzzz_track_c_session_job_assignees[\s\S]*deferrable initially deferred/);
assert.match(sql, /track_c_session_job_assignee_mismatch/);

const permissionHelper = functionBody("create or replace function private.has_tenant_permission(");
assert.match(permissionHelper, /security definer/);
assert.match(permissionHelper, /set search_path = ''/);
for (const permission of [
  "MANAGE_MEMBERS",
  "MANAGE_TENANT",
  "VIEW_COSTS",
  "EXPORT",
  "VIEW_ALL",
  "OPERATE",
  "UPLOAD",
  "ASSIGN_TASK",
  "VIEW_ASSET",
  "WRITE_TITLE",
  "SUBMIT_FEEDBACK"
]) {
  assert.match(permissionHelper, new RegExp(`'${permission}'`));
}
assert.match(sql, /revoke all on function private\.has_tenant_permission/);
assert.match(sql, /grant execute on function private\.has_tenant_permission/);

for (const table of ["tenants", "users", "tenant_members"]) {
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
}
assert.match(sql, /create policy track_c_tenant_members_insert/);
assert.match(sql, /MANAGE_MEMBERS/);
assert.match(
  sql,
  /create policy track_c_tenant_members_select[\s\S]*using \(private\.has_tenant_permission\(tenant_id, 'VIEW_ALL'\)\)/,
  "Writer must not receive the tenant member directory through direct RLS access"
);
const canViewUser = functionBody("create or replace function private.can_view_app_user(");
assert.match(canViewUser, /self_member\.role in \('OWNER', 'MANAGER'\)/);

const lineage = functionBody("create or replace function private.enforce_tenant_from_parent()");
assert.match(lineage, /set search_path = ''/);
assert.match(lineage, /new\.tenant_id := v_parent_tenant_id/);
assert.match(lineage, /track_c_tenant_mismatch/);
assert.match(lineage, /track_c_tenant_parent_missing/);
for (const table of [
  "listing_reviews",
  "listing_publish_jobs",
  "listing_image_verifications",
  "preingestion_bundles",
  "image_derived_assets",
  "v4_field_evidence",
  "v4_candidate_traces",
  "v4_writer_feedback_events",
  "v4_production_quality_ledger",
  "v4_writer_export_items",
  "v4_fast_scout_cache",
  "vector_query_logs"
]) {
  assert.match(sql, new RegExp(`'${table}'`), `missing lineage declaration for ${table}`);
}
assert.match(sql, /before insert or update of tenant_id/);

assert.match(sql, /listing_image_verifications_tenant_object_path_uidx/);
assert.match(sql, /on public\.listing_image_verifications\(tenant_id, object_path\)/);
assert.match(sql, /split_part\(object_path, '\/', 1\) = 'tenants'/);
assert.match(sql, /split_part\(object_path, '\/', 2\) = tenant_id/);
assert.match(sql, /split_part\(object_path, '\/', 3\) = 'listing-assets'/);

assert.doesNotMatch(sql, /create policy track_c_listing_card_images_tenant_(select|insert|update|delete)/);
assert.match(sql, /revoke usage on schema storage from anon, authenticated/);
assert.match(sql, /revoke all on table storage\.objects from public, anon, authenticated/);
assert.match(sql, /grant select, insert, update, delete on table storage\.objects to service_role/);
assert.doesNotMatch(stripLineComments(sql), /auth\.role\(\)/);

const requestLogs = tableBody("request_logs");
assertColumns(requestLogs, ["id", "request_id", "tenant_id", "user_id", "api", "metadata"]);
assert.match(requestLogs, /"timestamp" timestamptz not null/);

const attemptEvents = tableBody("job_attempt_events");
assertColumns(attemptEvents, [
  "id",
  "tenant_id",
  "request_id",
  "batch_id",
  "job_id",
  "session_id",
  "attempt_no",
  "event_type",
  "physical_status",
  "canonical_status",
  "retry_delay_ms",
  "error_code",
  "recoverable",
  "occurred_at"
]);

const errors = tableBody("error_logs");
assertColumns(errors, [
  "id",
  "tenant_id",
  "request_id",
  "user_id",
  "job_id",
  "session_id",
  "error_type",
  "stack",
  "recoverable",
  "created_at"
]);

const productionEvents = tableBody("production_events");
assertColumns(productionEvents, [
  "id",
  "request_id",
  "tenant_id",
  "user_id",
  "batch_id",
  "job_id",
  "session_id",
  "event_type",
  "duration_ms",
  "model_version",
  "prompt_version",
  "route",
  "success",
  "provider_calls",
  "input_tokens",
  "output_tokens",
  "estimated_cost_usd",
  "metadata",
  "created_at"
]);
const productionEventTypes = [
  "upload_started",
  "job_created",
  "recognition_started",
  "provider_called",
  "recognition_completed",
  "recognition_failed",
  "feedback_saved",
  "export_generated"
];
for (const eventType of productionEventTypes) {
  assert.match(productionEvents, new RegExp(`'${eventType}'`));
}
assert.match(sql, /production_events_tenant_event_created_idx/);
assert.match(sql, /production_events_tenant_cost_created_idx/);
for (const table of ["request_logs", "job_attempt_events", "error_logs", "production_events"]) {
  assert.match(sql, new RegExp(`revoke all on table public\\.${table} from service_role`));
  assert.match(sql, new RegExp(`grant select, insert on table public\\.${table} to service_role`));
  assert.doesNotMatch(
    stripLineComments(sql),
    new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`)
  );
}

for (const field of [
  "request_id",
  "batch_id",
  "job_id",
  "user_id",
  "attempt_no",
  "prompt_version",
  "model_version",
  "success",
  "provider_calls",
  "input_cost_usd",
  "output_cost_usd",
  "estimated_cost_usd",
  "cost_currency"
]) {
  assert.match(sql, new RegExp(`add column if not exists ${field}\\s`, "i"));
}

const tenantFeedbackRpc = functionBody(
  "create or replace function public.persist_v4_writer_feedback_transaction(\n  p_tenant_id text,"
);
assert.match(tenantFeedbackRpc, /sessions\.tenant_id = p_tenant_id/);
assert.match(tenantFeedbackRpc, /id,[\s\S]*?tenant_id,[\s\S]*?recognition_session_id/);
assert.match(tenantFeedbackRpc, /'saved', false/);
assert.match(tenantFeedbackRpc, /not_found_or_not_owned/);
assert.match(tenantFeedbackRpc, /set search_path = ''/);
assert.match(tenantFeedbackRpc, /sessions\.assigned_to_user_id/);
assert.match(tenantFeedbackRpc, /v_operator_role is distinct from 'OWNER'/);
assert.match(
  sql,
  /revoke all on function public\.persist_v4_writer_feedback_transaction\([\s\S]*?text, text, text, text, jsonb, jsonb[\s\S]*?from public, anon, authenticated/
);

const assignmentRpc = functionBody("create or replace function public.assign_v4_recognition_job(");
assert.match(assignmentRpc, /security definer/);
assert.match(assignmentRpc, /member\.status = 'ACTIVE'/);
assert.match(assignmentRpc, /from public\.v4_recognition_sessions[\s\S]*for update/);
assert.match(assignmentRpc, /order by jobs\.id[\s\S]*for update/);
assert.match(assignmentRpc, /update public\.v4_recognition_sessions[\s\S]*assigned_to_user_id = p_assigned_to_user_id/);
assert.match(assignmentRpc, /update public\.v4_recognition_jobs[\s\S]*recognition_session_id = v_session_id/);
assert.doesNotMatch(assignmentRpc, /update public\.v4_recognition_batches[\s\S]*assigned_to_user_id/);
assert.match(assignmentRpc, /'assigned_job_count', v_write_count/);
assert.match(sql, /revoke all on function public\.assign_v4_recognition_job\(text, text, text\)[\s\S]*from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.assign_v4_recognition_job\(text, text, text\)[\s\S]*to service_role/);

const opsRpc = functionBody("create or replace function public.track_c_ops_snapshot(");
assert.match(opsRpc, /set search_path = ''/);
for (const metric of [
  "queued",
  "interactive_queued",
  "background_queued",
  "running",
  "completed",
  "retryable_failed",
  "failed_final",
  "retry_count",
  "average_wait_ms",
  "p50_wait_ms",
  "p95_wait_ms",
  "p50_writer_visible_latency_ms",
  "p95_writer_visible_latency_ms",
  "recognition_count",
  "success_count",
  "failed_count",
  "success_rate",
  "feedback_count",
  "accept_count",
  "edit_count",
  "reject_count",
  "accept_rate",
  "edit_rate",
  "reject_rate",
  "provider_calls",
  "provider_call_events",
  "priced_call_events",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "estimated_cost_usd",
  "average_cost_per_successful_card_usd",
  "cost_configured",
  "feedback_rate",
  "pricing_rate"
]) {
  assert.match(opsRpc, new RegExp(`'${metric}'`));
}
assert.match(opsRpc, /select distinct on \(card_key\)[\s\S]*latest_terminal_outcomes/);
assert.match(opsRpc, /metadata ->> 'recoverable'[\s\S]*<> 'true'/);
assert.match(opsRpc, /event_type = 'ATTEMPT_STARTED'[\s\S]*attempt_no > 1/);
assert.match(opsRpc, /information_schema\.columns[\s\S]*column_name = 'lane'/);
assert.match(opsRpc, /replace\(\$query\$[\s\S]*'__lane__', v_lane_expression\)/);
assert.match(opsRpc, /writer_ready_cards[\s\S]*min\(completed_at\) as writer_ready_at/);
assert.match(opsRpc, /group by coalesce\(nullif\(recognition_session_id, ''\), id\)/);
assert.doesNotMatch(opsRpc, /'estimated_cost_usd',\s*coalesce/i);
assert.match(sql, /revoke all on function public\.track_c_ops_snapshot\(text, timestamptz\)[\s\S]*?from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.track_c_ops_snapshot\(text, timestamptz\)[\s\S]*?to service_role/);

assert.match(sql, /persist_v4_noncritical_artifacts\(text, jsonb, jsonb, jsonb, jsonb\)[\s\S]*?set search_path = ''/);
assert.doesNotMatch(stripLineComments(sql), /alter table(?: if exists)? public\.sem_definitions\b/i);
assert.doesNotMatch(stripLineComments(sql), /alter table(?: if exists)? public\.catalog_(?:sources|products|sets|cards|parallels)\b/i);

assert.match(settingsSql, /alter table public\.tenants[\s\S]*add column if not exists settings jsonb not null default '\{\}'::jsonb/);
assert.match(settingsSql, /constraint tenants_settings_object_check[\s\S]*jsonb_typeof\(settings\) = 'object'/);
assert.match(settingsSql, /validate constraint tenants_settings_object_check/);

for (const delimiter of ["$$", "$sql$", "$policy$", "$query$"]) {
  const count = sql.split(delimiter).length - 1;
  assert.equal(count % 2, 0, `unbalanced SQL delimiter ${delimiter}: ${count}`);
}

console.log("track C tenant migration contract tests passed");
