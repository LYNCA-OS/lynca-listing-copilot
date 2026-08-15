#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT,
  THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";

const MIGRATION_VERSION = "20260815034533";
const MIGRATION_FILE = `${MIGRATION_VERSION}_csm_tcg_grammar_context_trainer_gallery_registry_v1.sql`;
const PROMOTED_AT = "2026-08-15T03:45:33Z";
const productionPath = (fileName) => resolve(
  import.meta.dirname,
  "..",
  "infrastructure",
  "supabase-production",
  "supabase",
  "migrations",
  fileName
);
const historicalPath = (fileName) => resolve(
  import.meta.dirname,
  "..",
  "supabase",
  "migrations",
  fileName
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

assert.equal(existsSync(productionPath(MIGRATION_FILE)), true,
  "the TCG Grammar context release must live in the single Production ledger");
assert.equal(existsSync(historicalPath(MIGRATION_FILE)), false,
  "the release must not be copied into the frozen application-contract ledger");

const historicalRegistryMigrations = Object.freeze({
  "20260810120000_csm_external_identity_high_risers_registry_v1.sql":
    "6ca2ebd9b4136bd63276188a2d3995fabe2333a54f35b7fb6c935a07ce09b896",
  "20260810200000_csm_external_identity_high_risers_registry_v2.sql":
    "e4cbb2f034406db54231093b054966b333a7b4451da94a359f7d72f896e577a5",
  "20260813221955_csm_external_identity_high_risers_registry_v3.sql":
    "fae222d8234e2a96403699d5858d547b183262007b18e82cf04a290abad47c1e"
});
for (const [fileName, expectedHash] of Object.entries(historicalRegistryMigrations)) {
  assert.equal(sha256(readFileSync(productionPath(fileName), "utf8")), expectedHash,
    `${fileName} must remain byte-identical`);
}

const sql = readFileSync(productionPath(MIGRATION_FILE), "utf8");
assert.equal((sql.match(/insert\s+into\s+public\.csm_registry_releases/gi) || []).length, 1,
  "the migration seeds exactly one additive Registry row");
assert.match(sql, /on conflict \(id\) do nothing/i,
  "an exact second application must be idempotent");
assert.doesNotMatch(sql, /\b(?:delete|update|drop|truncate|alter)\b/i,
  "the migration must not mutate schema or historical Registry rows");

for (const value of Object.values(THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT)) {
  assert.match(sql, new RegExp(escaped(value)));
}
assert.match(sql, new RegExp(`promoted_by = 'migration:${MIGRATION_VERSION}'`, "i"));
assert.match(sql, new RegExp(`promoted_at = '${PROMOTED_AT}'::timestamptz`, "i"));

const payloads = [...sql.matchAll(/'(\{[\s\S]*?\})'::jsonb/g)]
  .map((match) => JSON.parse(match[1]));
assert.equal(payloads.length, 2,
  "insert and post-conflict guard must each state the complete payload");
for (const payload of payloads) {
  assert.deepEqual(payload, THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT);
  assert.deepEqual(
    Object.keys(payload).sort(),
    Object.keys(THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT).sort(),
    "missing or extra payload keys must fail the exact contract"
  );
}

assert.match(sql, /and\s+registry_payload\s*=\s*'\{[\s\S]*?\}'::jsonb/i,
  "jsonb equality must reject a row with payload drift");
assert.doesNotMatch(sql, /registry_payload\s*->>/i,
  "per-field extraction would accept unknown payload keys");
assert.match(sql, /if not exists\s*\([\s\S]*?where id\s*=\s*'registry_tcg_grammar_context_trainer_gallery_v1'[\s\S]*?\) then/i,
  "a conflicting existing row must be checked rather than overwritten");
assert.match(sql, /errcode\s*=\s*'55000'/i,
  "Registry drift must stop the migration with an explicit object-state error");
assert.match(sql, /message\s*=\s*'csm_tcg_grammar_context_registry_contract_mismatch'/i,
  "Registry drift must surface a stable fail-closed error");

console.log("CSM TCG Grammar context Registry migration: ok");
