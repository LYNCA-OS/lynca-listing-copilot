#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const migration = "20260812153000_csm_collectible_semantic_state_audit_v1.sql";
const productionUrl = new URL(
  `../infrastructure/supabase-production/supabase/migrations/${migration}`,
  import.meta.url
);
const historicalUrl = new URL(`../supabase/migrations/${migration}`, import.meta.url);

assert.equal(existsSync(productionUrl), true,
  "the audit extension must live in the one Production migration ledger");
assert.equal(existsSync(historicalUrl), false,
  "the audit extension must not be copied into the historical app ledger");

const sql = await readFile(productionUrl, "utf8");
assert.equal(
  createHash("sha256").update(sql).digest("hex"),
  "3bc8e43a1c94c30398e5b3c6b1071088dc68176114e1d493ea61fb7c39efc4aa",
  "the reviewed audit-only migration must remain byte-immutable"
);
assert.match(sql, /create table if not exists public\.csm_collectible_semantic_state_audits/);
for (const literal of [
  "collectible-semantic-state-v1",
  "frontier-model-csm-harness-v1",
  "AUDIT_ONLY",
  "provider_calls_added = 0",
  "writer_projection_active = false"
]) assert.match(sql, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(sql,
  /foreign key \(\s*tenant_id, recognition_session_id\s*\)[\s\S]*?on delete restrict/i);
assert.match(sql,
  /foreign key \(\s*tenant_id, resolution_id, recognition_session_id\s*\)[\s\S]*?on delete restrict/i);
assert.match(sql, /enable row level security/i);
assert.match(sql,
  /revoke all on table public\.csm_collectible_semantic_state_audits\s+from public, anon, authenticated/i);
assert.match(sql,
  /revoke all on table public\.csm_collectible_semantic_state_audits\s+from service_role/i);
assert.match(sql,
  /grant select, insert on table public\.csm_collectible_semantic_state_audits\s+to service_role/i);
assert.doesNotMatch(sql, /grant[\s\S]*?\b(?:update|delete|truncate|references|trigger)\b[\s\S]*?to service_role/i);
assert.match(sql,
  /create trigger prevent_csm_semantic_state_audit_mutation\s+before update or delete[\s\S]*?private\.prevent_csm_shadow_fact_mutation\(\)/i);
assert.doesNotMatch(sql, /create\s+policy/i,
  "service-role-only audit storage must not gain a public RLS policy");
assert.doesNotMatch(sql,
  /\b(?:update|delete|truncate)\s+(?:from\s+)?public\./i,
  "the migration must not mutate existing Production rows");
assert.doesNotMatch(sql, /alter table public\.(?!csm_collectible_semantic_state_audits)/i,
  "the extension must not alter a live owner, resolution, or output table");
assert.doesNotMatch(sql, /create or replace function/i,
  "the inert extension must reuse the established append-only guard");
assert.doesNotMatch(sql, /\b(?:fetch|http|net\.|vault\.)/i,
  "the migration must have no network or secret surface");

process.stdout.write("CSM semantic-state audit migration contract: ok\n");
