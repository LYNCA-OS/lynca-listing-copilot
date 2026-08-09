#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";

const fileName = "20260810120000_csm_external_identity_high_risers_registry_v1.sql";
const productionPath = resolve(
  import.meta.dirname, "..", "infrastructure", "supabase-production", "supabase", "migrations", fileName
);
const historicalPath = resolve(import.meta.dirname, "..", "supabase", "migrations", fileName);

assert.equal(existsSync(productionPath), true,
  "the Registry release must live in the single Production deployment ledger");
assert.equal(existsSync(historicalPath), false,
  "the frozen application-contract ledger must not masquerade as a deployable migration");

const sql = readFileSync(productionPath, "utf8");
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const value of [
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.registry_version,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.content_sha256,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.sem_standard_version,
  EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id,
  EXTERNAL_IDENTITY_SUPPORT_PACK.pack_version,
  EXTERNAL_IDENTITY_SUPPORT_PACK.index_id,
  EXTERNAL_IDENTITY_SUPPORT_PACK.index_sha256,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
]) assert.match(sql, new RegExp(escaped(value)));

assert.equal(
  EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id
);
assert.equal(
  EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.content_sha256,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.content_sha256
);
assert.equal(
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT.pack_sha256,
  EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.sha256
);
assert.equal(
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT.index_sha256,
  EXTERNAL_IDENTITY_RELEASE_CONTRACT.index.sha256
);
assert.equal(
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT.resolution_contract_sha256,
  EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.sha256
);

assert.equal((sql.match(/insert\s+into\s+public\.csm_registry_releases/gi) || []).length, 1);
assert.match(sql, /on conflict \(id\) do nothing/i);
assert.match(sql, /and promoted_by = 'migration:20260810120000'/i);
assert.match(sql, /and promoted_at = '2026-08-10T12:00:00Z'::timestamptz/i);
assert.doesNotMatch(sql, /\b(?:delete|update|drop|truncate|alter)\b/i,
  "the seed must remain additive and cannot rewrite an existing Registry release");
for (const [key, value] of Object.entries(THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT)) {
  const expected = typeof value === "boolean" ? String(value) : String(value);
  assert.match(sql, new RegExp(`"${escaped(key)}"\\s*:\\s*${typeof value === "string" ? `"${escaped(expected)}"` : escaped(expected)}`));
}

const registryPayloads = [...sql.matchAll(/'(\{[\s\S]*?\})'::jsonb/g)]
  .map((match) => JSON.parse(match[1]));
assert.equal(registryPayloads.length, 2,
  "the inserted and migration-time asserted Registry payloads must both be explicit");
for (const payload of registryPayloads) {
  assert.deepEqual(payload, THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT);
  assert.deepEqual(
    Object.keys(payload).sort(),
    Object.keys(THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT).sort()
  );
}
assert.match(sql, /and\s+registry_payload\s*=\s*'\{[\s\S]*?\}'::jsonb/i,
  "PostgreSQL jsonb equality must reject rows with missing or additional payload keys");
assert.doesNotMatch(sql, /registry_payload\s*->>/i,
  "per-field extraction would silently accept unrecognized payload keys");

console.log("CSM external identity Registry migration: ok");
