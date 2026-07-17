#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  "supabase/migrations/20260717130819_track_c_schema_attestation_and_tenant_convergence.sql",
  "utf8"
);
const followUpSource = await readFile(
  "supabase/migrations/20260717132242_fix_track_c_catalog_trigger_when_marker.sql",
  "utf8"
);
const boundaryConvergenceSource = await readFile(
  "supabase/migrations/20260717133700_track_c_fact_and_storage_boundary_convergence.sql",
  "utf8"
);

assert.doesNotMatch(source, /\bdelete\s+from\b/i, "tenant convergence must never delete business rows");
assert.match(source, /v4_sem_validation_tenant_backfill_requires_remediation/);
assert.match(source, /count\(distinct candidate\.tenant_id\)[\s\S]*tenant_count <> 1/);
assert.match(source, /update public\.v4_sem_validation_events[\s\S]*nullif\(pg_catalog\.btrim\(validation\.tenant_id\), ''\) is null/);
assert.match(source, /alter column tenant_id set not null/);
assert.match(source, /add constraint v4_sem_validation_events_tenant_id_fkey[\s\S]*not valid;[\s\S]*validate constraint v4_sem_validation_events_tenant_id_fkey/);
assert.match(source, /track_c_tenant_id_immutable[\s\S]*private\.prevent_tenant_change\(\)/);

assert.match(source, /v4_session_preingestion_bundle_tenant_remediation_required/);
assert.match(source, /bundle\.tenant_id is distinct from session_row\.tenant_id/);
assert.match(source, /create unique index if not exists v4_preingestion_bundles_tenant_id_uidx[\s\S]*\(tenant_id, id\)/);
assert.match(source, /add constraint track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f[\s\S]*foreign key \(tenant_id, preingestion_bundle_id\)[\s\S]*references public\.v4_preingestion_bundles\(tenant_id, id\)[\s\S]*on delete set null \(preingestion_bundle_id\)[\s\S]*not valid;/);
assert.match(source, /validate constraint track_c_v4_recognition_sessions_tenant_preingestion_bundle_id_f/);

assert.match(source, /create or replace function public\.track_c_production_schema_catalog_snapshot\(\)[\s\S]*language plpgsql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/);
assert.match(source, /track_c_catalog_attestation_service_role_required/);
assert.match(source, /'request\.jwt\.claims'/);
assert.match(source, /revoke all on function public\.track_c_production_schema_catalog_snapshot\(\)[\s\S]*from public, anon, authenticated/);
assert.match(source, /grant execute on function public\.track_c_production_schema_catalog_snapshot\(\)[\s\S]*to service_role/);
for (const section of [
  "tables",
  "columns",
  "procedures",
  "policies",
  "triggers",
  "constraints",
  "indexes",
  "table_acls",
  "data_invariants",
  "execution_boundary"
]) {
  assert.match(source, new RegExp(`'${section}'`), `catalog attestation must return ${section}`);
}
assert.match(source, /notify pgrst, 'reload schema'/);
assert.match(
  source,
  /pg_catalog\.pg_get_expr\(trigger\.tgqual, trigger\.tgrelid, true\) as when_expression/,
  "the already-applied migration must remain immutable"
);
assert.match(followUpSource, /create or replace function public\.track_c_production_schema_catalog_snapshot\(\)/);
assert.match(followUpSource, /case when trigger\.tgqual is null then null else 'present' end as when_expression/);
assert.doesNotMatch(followUpSource, /pg_get_expr\(trigger\.tgqual, trigger\.tgrelid/);
assert.match(followUpSource, /revoke all on function public\.track_c_production_schema_catalog_snapshot\(\)[\s\S]*grant execute[\s\S]*to service_role/);
assert.match(followUpSource, /notify pgrst, 'reload schema'/);

assert.match(boundaryConvergenceSource, /drop policy if exists track_c_writer_feedback_select[\s\S]*on public\.v4_writer_feedback_events/);
assert.match(boundaryConvergenceSource, /drop policy if exists track_c_tenant_update[\s\S]*on public\.v4_learning_events/);
assert.match(boundaryConvergenceSource, /revoke delete on table public\.v4_learning_events from service_role;[\s\S]*grant select, insert, update on table public\.v4_learning_events to service_role/);
assert.doesNotMatch(boundaryConvergenceSource, /revoke (?:all|update)[^;]*public\.v4_learning_events from service_role/);
assert.match(boundaryConvergenceSource, /add constraint v4_sem_validation_events_tenant_id_fkey_restrict[\s\S]*references public\.tenants\(id\)[\s\S]*on delete restrict[\s\S]*not valid;[\s\S]*validate constraint v4_sem_validation_events_tenant_id_fkey_restrict[\s\S]*drop constraint if exists v4_sem_validation_events_tenant_id_fkey;[\s\S]*rename constraint v4_sem_validation_events_tenant_id_fkey_restrict[\s\S]*to v4_sem_validation_events_tenant_id_fkey/);
assert.doesNotMatch(boundaryConvergenceSource, /revoke (?:usage on schema storage|all on table storage\.objects)/);
assert.match(boundaryConvergenceSource, /create or replace function public\.track_c_storage_boundary_snapshot\(\)[\s\S]*language plpgsql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/);
assert.match(boundaryConvergenceSource, /track_c_storage_boundary_service_role_required/);
assert.match(boundaryConvergenceSource, /relation\.relrowsecurity[\s\S]*'roles', policy\.roles::text\[\][\s\S]*'cmd', policy\.cmd[\s\S]*'qual', policy\.qual[\s\S]*'with_check', policy\.with_check[\s\S]*from pg_catalog\.pg_policies policy/);
assert.match(boundaryConvergenceSource, /revoke all on function public\.track_c_storage_boundary_snapshot\(\)[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.track_c_storage_boundary_snapshot\(\)[\s\S]*to service_role/);
assert.match(boundaryConvergenceSource, /notify pgrst, 'reload schema'/);
assert.doesNotMatch(boundaryConvergenceSource, /\bdelete\s+from\b/i, "boundary convergence must never delete business rows");

console.log("track-c schema attestation migration contract tests passed");
