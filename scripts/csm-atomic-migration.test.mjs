#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const historical = await readFile(new URL(
  "../supabase/migrations/20260728190000_csm_stage_shadow_foundation_v1.sql",
  import.meta.url
), "utf8");
const additive = await readFile(new URL(
  "../supabase/migrations/20260801094353_csm_atomic_stage_packet_v1.sql",
  import.meta.url
), "utf8");

assert.doesNotMatch(historical, /registry_thin_sem_v25/,
  "an already-applied historical migration must remain unchanged");
assert.match(additive, /insert into public\.csm_registry_releases[\s\S]*?'registry_thin_sem_v25'/);
assert.match(additive, /csm_registry_release_contract_mismatch:registry_thin_sem_v25/,
  "an existing Registry id with different content must fail the migration");

assert.match(additive, /create or replace function public\.persist_csm_stage_packet_v1\(/);
assert.match(additive, /language plpgsql[\s\S]*?security definer[\s\S]*?set search_path = ''/);
assert.match(additive, /from public\.v4_recognition_sessions[\s\S]*?for update;/,
  "the immutable attempt decision must hold a row lock");
assert.match(additive, /'immutable_session_conflict'[\s\S]*?'status_code', 409/);
assert.match(additive, /'exact_replay'[\s\S]*?'replayed', true[\s\S]*?'atomic', true/);

const tables = [
  "csm_evidence_observations", "csm_bracket_candidates", "csm_candidate_evidence_links",
  "csm_identity_resolutions", "csm_resolved_brackets", "csm_marketplace_outputs"
];
for (const table of tables) {
  assert.match(additive, new RegExp(`insert into public\\.${table} \\(`));
  assert.match(additive, new RegExp(`'${table}', [a-z_]+_count`),
    `${table} must report its database row count`);
}

const firstChildInsert = additive.indexOf("insert into public.csm_evidence_observations");
const conflictCheck = additive.indexOf("'immutable_session_conflict'");
const sessionComplete = additive.indexOf("update public.v4_recognition_sessions", firstChildInsert);
assert.ok(conflictCheck >= 0 && conflictCheck < firstChildInsert,
  "changed retries must be rejected before the first child insert");
assert.ok(sessionComplete > firstChildInsert,
  "the COMPLETE marker must be in the same function after all child inserts");
assert.match(additive.slice(sessionComplete), /csm_recognition_stage_status = 'COMPLETE'/);
assert.match(additive.slice(sessionComplete), /csm_resolution_stage_status = 'COMPLETE'/);
assert.match(additive.slice(sessionComplete), /csm_composition_stage_status = 'COMPLETE'/);
assert.match(additive, /revoke all on function public\.persist_csm_stage_packet_v1[\s\S]*?from public, anon, authenticated/);
assert.match(additive, /grant execute on function public\.persist_csm_stage_packet_v1[\s\S]*?to service_role/);

process.stdout.write("csm atomic migration: ok\n");
