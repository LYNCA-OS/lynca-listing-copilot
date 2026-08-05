#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const schema = await readFile(new URL(
  "infrastructure/supabase-production/supabase/migrations/20260706093959_v4_recognition_spine.sql",
  root
), "utf8");
const atomic = await readFile(new URL(
  "infrastructure/supabase-production/supabase/migrations/20260801094353_csm_atomic_stage_packet_v1.sql",
  root
), "utf8");
const projection = await readFile(new URL(
  "infrastructure/supabase-production/supabase/migrations/20260801121955_csm_session_product_projection_v1.sql",
  root
), "utf8");

for (const column of [
  "status", "final_title", "resolved_fields", "provider_result_summary", "updated_at"
]) {
  assert.match(schema, new RegExp(`\\b${column}\\b`), `${column} must be a real session column`);
}

// The already-applied atomic migration stays immutable. Its last session
// UPDATE deliberately remains the trigger point rather than being rewritten.
const atomicSessionUpdate = atomic.slice(atomic.indexOf("update public.v4_recognition_sessions"));
assert.match(atomicSessionUpdate, /csm_composition_stage_status = 'COMPLETE'/);
assert.doesNotMatch(atomicSessionUpdate, /final_title\s*=/);
assert.doesNotMatch(atomicSessionUpdate, /resolved_fields\s*=/);

assert.match(projection,
  /create or replace function private\.project_csm_session_product_read_model_v1\(\)/);
assert.match(projection, /language plpgsql[\s\S]*?security definer[\s\S]*?set search_path = ''/);
assert.match(projection,
  /before update of csm_composition_stage_status[\s\S]*?new\.schema_version = 'csm-recognition-session-v1'[\s\S]*?new\.csm_composition_stage_status = 'COMPLETE'/,
  "only the new CSM session contract may be projected");
assert.match(projection,
  /where output\.tenant_id = new\.tenant_id[\s\S]*?output\.recognition_session_id = new\.id/,
  "the output lookup must preserve tenant identity");
assert.match(projection, /if output_count <> 1 then[\s\S]*?csm_product_projection_requires_one_output/);
assert.match(projection, /sem_projection := output_row\.structured_output -> 'sem'/);
assert.match(projection, /jsonb_typeof\(sem_projection\) <> 'object'/);
assert.match(projection, /jsonb_typeof\(new\.provider_result_summary\) <> 'object'/);

assert.match(projection, /new\.status := 'WRITER_REVIEW'/);
assert.match(projection, /new\.final_title := output_row\.title/);
assert.match(projection, /new\.resolved_fields := sem_projection/);
assert.match(projection,
  /new\.provider_result_summary := coalesce\(new\.provider_result_summary, '\{\}'::jsonb\)[\s\S]*?\|\| projection_summary/,
  "projection metadata must merge without deleting an existing summary");

for (const receipt of [
  "provider_response_id", "provider_request_id", "provider_client_request_id"
]) {
  assert.match(projection, new RegExp(`'${receipt}'[\\s\\S]*?owner_versions ->> '${receipt}'`));
}
for (const metric of ["latency_ms", "input_tokens", "output_tokens", "total_tokens"]) {
  assert.match(projection, new RegExp(`'${metric}'[\\s\\S]*?owner_versions -> '${metric}'`));
}
assert.match(projection, /'provider'[\s\S]*?'openai'/);
assert.match(projection, /'model'[\s\S]*?owner_versions ->> 'model'/);
assert.match(projection, /'prompt_version'[\s\S]*?owner_versions ->> 'prompt_version'/);
assert.match(projection, /'title_length_policy'[\s\S]*?'max_length', 80/);
assert.match(projection, /'csm_product_projection_version', 'csm-session-product-projection-v1'/);

assert.match(projection, /csm_product_projection_backfill_requires_remediation/);
assert.match(projection,
  /session_row\.status = 'CREATED'[\s\S]*?session_row\.final_title is null[\s\S]*?session_row\.resolved_fields = '\{\}'::jsonb[\s\S]*?session_row\.provider_result_summary = '\{\}'::jsonb/,
  "backfill may overwrite only a pristine product read model");
assert.match(projection,
  /set csm_composition_stage_status = 'COMPLETE'/,
  "backfill must reuse the same trigger rather than duplicate projection SQL");
assert.match(projection,
  /revoke all on function private\.project_csm_session_product_read_model_v1\(\)[\s\S]*?from public, anon, authenticated/);

assert.match(projection,
  /create or replace function public\.check_csm_session_product_projection_v1\(\)/);
assert.match(projection,
  /stable[\s\S]*?security definer[\s\S]*?set search_path = ''/);
assert.match(projection,
  /from pg_catalog\.pg_trigger[\s\S]*?project_csm_session_product_read_model_v1/);
assert.match(projection,
  /trigger_function is distinct from expected_function/,
  "readiness must verify the real function binding, not only a version string");
assert.match(projection, /trigger_enabled not in \('O', 'A'\)/);
assert.match(projection, /trigger_type <> 19/);
assert.match(projection, /trigger_attributes is distinct from composition_attribute::text/);
assert.match(projection,
  /pg_catalog\.pg_get_triggerdef\(trigger_row\.oid, true\)/,
  "readiness must use PostgreSQL's trigger-aware deparser for the live tgqual");
assert.match(projection,
  /trigger_when_expression is distinct from[\s\S]*?new\.schema_version = ''csm-recognition-session-v1''::text AND new\.csm_composition_stage_status = ''COMPLETE''::text/,
  "readiness must fail closed unless the live trigger has the exact projection condition");
assert.match(projection,
  /'code', 'csm_product_projection_ready'[\s\S]*?'version', 'csm-session-product-projection-v1'/);
assert.match(projection,
  /revoke all on function public\.check_csm_session_product_projection_v1\(\)[\s\S]*?from public, anon, authenticated[\s\S]*?grant execute[\s\S]*?to service_role/);

process.stdout.write("csm product projection migration: ok\n");
