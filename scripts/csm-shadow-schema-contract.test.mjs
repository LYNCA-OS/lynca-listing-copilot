import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL(
  "../supabase/migrations/20260728190000_csm_stage_shadow_foundation_v1.sql",
  import.meta.url
), "utf8");

for (const table of [
  "csm_registry_releases",
  "csm_evidence_observations",
  "csm_bracket_candidates",
  "csm_candidate_evidence_links",
  "csm_identity_resolutions",
  "csm_resolved_brackets",
  "csm_marketplace_outputs"
]) {
  assert.match(source, new RegExp(`create table if not exists public\\.${table}\\b`));
  assert.match(source, new RegExp(`alter table public\\.%I enable row level security`));
}

assert.doesNotMatch(source, /create table if not exists public\.csm_recognition_runs\b/);
assert.doesNotMatch(source, /listing-originals|listing-derived/);
assert.match(source, /references public\.v4_recognition_sessions\(tenant_id, id\)/);
assert.match(source, /csm_grammar in \('TCG', 'NON_TCG'\)/);
assert.doesNotMatch(source, /'UNKNOWN'/);
assert.match(source, /value_kind = 'EMPTY'/);
assert.match(source, /selected_kind = 'EMPTY'/);
assert.match(source, /char_length\(title\) between 1 and 80/);
assert.match(source, /not structured_output \?\| array/);
assert.match(source, /observation_confidence double precision not null/);
assert.match(source, /semantic_confidence double precision not null/);
assert.match(source, /csm_shadow_facts_are_append_only/);
assert.match(source, /csm_resolution_requires_recognition_complete/);
assert.match(source, /csm_composition_requires_resolution_complete/);
assert.match(source, /csm_contract_metadata_required_before_stage_start/);
assert.match(source, /grant select, insert on table public\.%I to service_role/);
assert.match(source, /revoke all on table public\.%I from public, anon, authenticated/);

console.log("csm shadow schema contract tests passed");
