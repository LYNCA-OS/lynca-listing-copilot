#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const migrationName = "20260801101152_csm_thin_provider_admission_v1.sql";
const sql = await readFile(new URL(
  `../infrastructure/supabase-production/supabase/migrations/${migrationName}`,
  import.meta.url
), "utf8");
const pacerMigrationName = "20260801115421_csm_thin_provider_pacer_v1.sql";
const pacerSql = await readFile(new URL(
  `../infrastructure/supabase-production/supabase/migrations/${pacerMigrationName}`,
  import.meta.url
), "utf8");
const profileReservationMigrationName =
  "20260809145100_csm_model_profile_token_reservation_v1.sql";
const profileReservationSql = await readFile(new URL(
  `../infrastructure/supabase-production/supabase/migrations/${profileReservationMigrationName}`,
  import.meta.url
), "utf8");
const operationKeyRecoveryMigrationName =
  "20260809145241_csm_provider_operation_key_recovery_v1.sql";
const operationKeyRecoverySql = await readFile(new URL(
  `../infrastructure/supabase-production/supabase/migrations/${operationKeyRecoveryMigrationName}`,
  import.meta.url
), "utf8");
const authorityExecuteHardeningMigrationName =
  "20260809151333_csm_provider_authority_execute_hardening_v1.sql";
const authorityExecuteHardeningSql = await readFile(new URL(
  `../infrastructure/supabase-production/supabase/migrations/${authorityExecuteHardeningMigrationName}`,
  import.meta.url
), "utf8");

assert.ok(Number(migrationName.slice(0, 14)) > 20260801094353,
  "the additive authority must follow the last applied remote migration");
assert.equal(
  createHash("sha256").update(sql).digest("hex"),
  "27703c7c0e4596622f176cf22749941d3122a59baac3d51888e4f0d9f155e3f4",
  "the applied/fetched authority migration is immutable"
);
assert.doesNotMatch(sql, /\bv4_/i, "the thin authority must not couple to the old v4 queue");

for (const table of [
  "csm_thin_provider_scopes",
  "csm_thin_provider_operations",
  "csm_thin_provider_attempts"
]) {
  assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
  assert.match(sql, new RegExp(
    `revoke all on table public\\.${table}\\s+from public, anon, authenticated, service_role`
  ));
}

assert.match(sql, /primary key \(provider, account_scope, model\)/);
assert.match(sql, /primary key \(tenant_id, operation_key\)/);
assert.match(sql, /primary key \(tenant_id, operation_key, attempt_no\)/);
assert.match(sql, /max_active between 1 and 120/);
assert.match(sql, /max_active_tokens between 1 and 440000/);
assert.match(sql, /retry_fraction > 0 and retry_fraction <= 0\.20000/);
assert.match(sql, /rolling_window_seconds = 60/);
assert.match(sql, /request_window_target = 4500/);
assert.match(sql, /request_window_hard_limit = 5000/);
assert.match(sql, /token_window_target = 3600000/);
assert.match(sql, /token_window_hard_limit = 4000000/);
assert.match(sql, /active_count between 0 and max_active/);
assert.match(sql, /active_tokens between 0 and max_active_tokens/);
assert.match(sql, /payload_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(sql, /operation_payload_conflict/);
assert.match(sql, /retry_predecessor_not_safe/,
  "only an explicitly failed predecessor may create a retry attempt");

assert.match(sql, /row_number\(\) over \([\s\S]*?partition by eligible\.tenant_id/,
  "scheduler selection must compare one eligible head per tenant");
assert.doesNotMatch(sql, /partition by [^\n]*attempt_class/,
  "a tenant must not get simultaneous fresh and retry scheduler heads");
assert.match(sql, /greatest\([\s\S]*?1::numeric \/ scope_row\.max_active[\s\S]*?p_estimated_tokens::numeric \/ scope_row\.max_active_tokens/,
  "finish cost must use dominant count/token share");
assert.match(sql, /start_tag := greatest\(scope_row\.virtual_time, last_finish\)/);
assert.match(sql, /fair_row\.bypass_count \+ 1 >= 8/);
assert.match(sql, /now_at - fair_row\.enqueued_at >= interval '30 seconds'/);
assert.match(sql, /reservation_tenant_id = fair_row\.tenant_id/);
assert.match(sql, /or not fresh_backlog[\s\S]*?active_retry_count \+ 1 <= retry_count_limit/,
  "retries borrow idle only when fresh work is absent");
assert.match(sql, /started_at > now_at[\s\S]*?rolling_window_seconds/);
assert.match(sql, /window_request_count \+ 1 <= scope_row\.request_window_target/);
assert.match(sql, /window_charged_tokens \+ fair_row\.estimated_tokens <= scope_row\.token_window_target/);
assert.match(sql, /charged_tokens = selected_row\.estimated_tokens/,
  "claim must reserve estimated tokens exactly once before provider execution");
assert.match(sql, /charged_tokens = coalesce\(p_actual_tokens, charged_tokens\)/,
  "settle may replace the estimate only when observed usage is available");
assert.match(sql, /p_outcome = 'RATE_LIMITED'[\s\S]*?effective_max_active \/ 2\.0/,
  "a 429 must lower the shared effective window rather than a process-local counter");
assert.match(sql, /queue_expires_at <= now_at[\s\S]*?queue_owner_expired/);
assert.match(sql, /set queue_expires_at = now_at[\s\S]*?queue_ttl_seconds/);

assert.match(sql, /from public\.csm_thin_provider_scopes[\s\S]*?for update;/,
  "claim/settle must serialize the hard counters on the scope row");
assert.match(sql, /lease_fence = selected_row\.lease_fence/);
assert.match(sql, /and lease_fence = p_lease_fence/);
assert.match(sql, /target_row\.state = 'RUNNING'[\s\S]*?target_row\.lease_owner is not distinct from p_worker_id[\s\S]*?'claim_receipt_replayed'/,
  "only the exact worker may recover a lost claim receipt");
assert.match(sql, /state = 'LEASE_EXPIRED'[\s\S]*?status = case when cancel_requested_at is null then 'AMBIGUOUS'/,
  "expired external attempts must fail closed, not auto-retry");
assert.match(sql, /status = case when running_count > 0 then 'CANCEL_REQUESTED' else 'CANCELLED' end/);
assert.match(sql, /active_count = active_count - 1/,
  "settle, not cancel, releases a running provider lease");
assert.match(sql, /when aimd_cooldown_until is null or aimd_cooldown_until <= now_at[\s\S]*?effective_max_active \/ 2\.0/,
  "a burst of 429 responses must decrease once per shared cooldown epoch");
assert.match(sql, /aimd_cooldown_until = greatest\(/,
  "later 429 responses may extend but never shorten the shared cooldown");

const rpcSignatures = [
  "enqueue_csm_thin_provider_attempt_v1",
  "claim_csm_thin_provider_attempt_v1",
  "heartbeat_csm_thin_provider_attempt_v1",
  "settle_csm_thin_provider_attempt_v1",
  "cancel_csm_thin_provider_operation_v1",
  "lookup_csm_thin_provider_operation_v1"
];
for (const rpc of rpcSignatures) {
  assert.match(sql, new RegExp(
    `create or replace function public\\.${rpc}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`
  ));
  assert.match(sql, new RegExp(
    `revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon, authenticated`
  ));
  assert.match(sql, new RegExp(
    `grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role`
  ));
}

assert.equal((sql.match(/create index csm_thin_provider_/g) || []).length, 4);

assert.ok(Number(pacerMigrationName.slice(0, 14)) > Number(migrationName.slice(0, 14)),
  "the pacer must be a later additive migration");
assert.doesNotMatch(pacerSql, /^\s*(?:drop|truncate|delete)\b/im,
  "the pacer migration must not remove schema or data");
assert.match(pacerSql, /add column baseline_working_max_active integer/);
assert.match(pacerSql, /add column pacer_tokens_per_second integer/);
assert.match(pacerSql, /add column pacer_burst_tokens integer/);
assert.match(pacerSql, /add column pacer_available_tokens numeric\(20,6\)/);
assert.match(pacerSql, /add column pacer_refilled_at timestamptz/);
assert.match(pacerSql, /baseline_working_max_active = least\(43, max_active\)/);
assert.match(pacerSql, /pacer_tokens_per_second = 60000/);
assert.match(pacerSql, /pacer_burst_tokens = 65200/);
assert.match(pacerSql, /effective_max_active = least\(effective_max_active, 43, max_active\)/);
assert.match(pacerSql, /effective_max_active between 1 and baseline_working_max_active/);
assert.match(pacerSql, /pacer_tokens_per_second \* rolling_window_seconds <= token_window_target/);
assert.doesNotMatch(pacerSql, /set\s+max_active\s*=/i,
  "120 remains the absolute count authority");
assert.doesNotMatch(pacerSql, /set\s+max_active_tokens\s*=/i,
  "440k remains the absolute active-token authority");
assert.match(pacerSql, /create or replace function public\.claim_csm_thin_provider_attempt_v1\(/);
assert.match(pacerSql, /create or replace function public\.settle_csm_thin_provider_attempt_v1\(/);
assert.match(pacerSql, /for update;[\s\S]*?now_at := pg_catalog\.clock_timestamp\(\);/,
  "pacing time must be refreshed after the scope-row lock");
assert.match(pacerSql, /effective_count_limit := least\([\s\S]*?scope_row\.max_active,[\s\S]*?scope_row\.baseline_working_max_active,[\s\S]*?scope_row\.effective_max_active/);
assert.match(pacerSql, /refilled_pacer_tokens := least\([\s\S]*?scope_row\.pacer_available_tokens[\s\S]*?scope_row\.pacer_tokens_per_second/);
assert.match(pacerSql, /refilled_pacer_tokens < pacer_required_tokens[\s\S]*?'code', 'pacer_limited'/);
assert.match(pacerSql, /pacer_available_tokens = refilled_pacer_tokens - selected_row\.estimated_tokens/,
  "an admitted start must charge the serialized token bucket");
assert.match(pacerSql, /max_active, baseline_working_max_active, effective_max_active \+ 1/,
  "AIMD recovery must stop at the 43 working baseline");
for (const rpc of ["claim", "settle"]) {
  assert.match(pacerSql, new RegExp(
    `create or replace function public\\.${rpc}_csm_thin_provider_attempt_v1\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`
  ));
}
assert.match(pacerSql, /create or replace function public\.check_csm_thin_provider_pacer_v1\([\s\S]*?security definer[\s\S]*?set search_path = ''/);
assert.match(pacerSql, /revoke all on function public\.check_csm_thin_provider_pacer_v1\([\s\S]*?from public, anon, authenticated, service_role/);
assert.match(pacerSql, /grant execute on function public\.check_csm_thin_provider_pacer_v1\([\s\S]*?to service_role/);

assert.ok(
  Number(profileReservationMigrationName.slice(0, 14)) > Number(pacerMigrationName.slice(0, 14)),
  "the profile reservation update must follow the applied pacer"
);
assert.doesNotMatch(profileReservationSql, /^\s*(?:drop|truncate|delete)\b/im);
assert.match(profileReservationSql, /alter column pacer_burst_tokens set default 66000/);
assert.match(profileReservationSql, /alter column pacer_available_tokens set default 66000/);
assert.match(profileReservationSql, /pacer_burst_tokens = 66000/);
assert.match(profileReservationSql, /and pacer_burst_tokens = 65200/,
  "the profile migration must stop instead of overwriting an unknown predecessor");
assert.match(profileReservationSql, /pacer_available_tokens = least\(pacer_available_tokens, 66000\)/,
  "the migration may raise the ceiling but must not mint live capacity");
assert.match(profileReservationSql, /changed_rows <> 1/);
assert.doesNotMatch(profileReservationSql, /set\s+(?:max_active|max_active_tokens|effective_max_active)\s*=/i);

assert.ok(
  Number(operationKeyRecoveryMigrationName.slice(0, 14))
    > Number(profileReservationMigrationName.slice(0, 14)),
  "key-only recovery must follow the exact active-profile reservation"
);
assert.doesNotMatch(operationKeyRecoverySql, /^\s*(?:drop|truncate|delete)\b/im);
assert.match(operationKeyRecoverySql,
  /to_regprocedure\(\s*'public\.lookup_csm_thin_provider_operation_v1\(text,text,text\)'\s*\)/,
  "the additive RPC must stop when its exact predecessor is absent");
assert.match(operationKeyRecoverySql,
  /PRIMARY KEY \(tenant_id, operation_key\)/,
  "scope-free recovery depends on one unique tenant operation row");
assert.match(operationKeyRecoverySql, /and pacer_burst_tokens = 66000/,
  "the migration must not install on a partially upgraded profile scope");
assert.match(operationKeyRecoverySql,
  /create or replace function public\.lookup_csm_thin_provider_operation_by_key_v1\(\s*p_tenant_id text,\s*p_operation_key text\s*\)[\s\S]*?language plpgsql[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''/);
assert.match(operationKeyRecoverySql,
  /where tenant_id = pg_catalog\.btrim\(p_tenant_id\)\s+and operation_key = pg_catalog\.btrim\(p_operation_key\)/,
  "the read is tenant exact and operation exact");
assert.match(operationKeyRecoverySql,
  /if operation_row\.status = 'SUCCEEDED'[\s\S]*?'payload_sha256', operation_row\.payload_sha256[\s\S]*?'result', operation_row\.terminal_result/);
assert.match(operationKeyRecoverySql,
  /'code', 'found_non_success'[\s\S]*?'operation_status', operation_row\.status[\s\S]*?'latest_attempt_state', latest_attempt\.state\s*\)/,
  "non-success states may expose state metadata only");
assert.match(operationKeyRecoverySql,
  /revoke all on function public\.lookup_csm_thin_provider_operation_by_key_v1\([\s\S]*?from public, anon, authenticated, service_role/);
assert.match(operationKeyRecoverySql,
  /grant execute on function public\.lookup_csm_thin_provider_operation_by_key_v1\([\s\S]*?to service_role/);

assert.ok(
  Number(authorityExecuteHardeningMigrationName.slice(0, 14))
    > Number(operationKeyRecoveryMigrationName.slice(0, 14)),
  "execute hardening must follow every authority RPC definition"
);
assert.doesNotMatch(authorityExecuteHardeningSql, /^\s*(?:drop|truncate|delete)\b/im);
for (const rpc of [
  "enqueue_csm_thin_provider_attempt_v1",
  "claim_csm_thin_provider_attempt_v1",
  "heartbeat_csm_thin_provider_attempt_v1",
  "settle_csm_thin_provider_attempt_v1",
  "cancel_csm_thin_provider_operation_v1",
  "lookup_csm_thin_provider_operation_v1",
  "lookup_csm_thin_provider_operation_by_key_v1",
  "check_csm_thin_provider_pacer_v1"
]) {
  assert.match(authorityExecuteHardeningSql, new RegExp(
    `revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon, authenticated, service_role`
  ));
  assert.match(authorityExecuteHardeningSql, new RegExp(
    `grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role`
  ));
}
assert.match(authorityExecuteHardeningSql,
  /alter default privileges for role postgres in schema public\s+revoke execute on functions from public, anon, authenticated/);
assert.match(authorityExecuteHardeningSql,
  /alter default privileges for role postgres in schema public\s+grant execute on functions to service_role/);
console.log("CSM provider admission migration contract tests passed");
