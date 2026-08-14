#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";

const V1_FILE = "20260810120000_csm_external_identity_high_risers_registry_v1.sql";
const V2_FILE = "20260810200000_csm_external_identity_high_risers_registry_v2.sql";
const V3_FILE = "20260813221955_csm_external_identity_high_risers_registry_v3.sql";
const productionPath = (fileName) => resolve(
  import.meta.dirname, "..", "infrastructure", "supabase-production", "supabase", "migrations", fileName
);
const historicalPath = (fileName) => resolve(import.meta.dirname, "..", "supabase", "migrations", fileName);
const jsonSha256 = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");

assert.equal(jsonSha256(THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT),
  "41b22091b6dca7a31b07d0eb5753278fb3d64e1a65e9f94a9cf3d0bd333839f6",
"active writer release remains byte-identical v2");
assert.equal(jsonSha256(THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT),
  "c8d9c9b6b975c8052f2dd315b8eb62da93770454604c35fc3cb11c0750856d63",
"active writer payload remains byte-identical v2");

for (const fileName of [V1_FILE, V2_FILE, V3_FILE]) {
  assert.equal(existsSync(productionPath(fileName)), true,
    `${fileName} must live in the single Production deployment ledger`);
  assert.equal(existsSync(historicalPath(fileName)), false,
    `${fileName} must not masquerade as an application-contract migration`);
}

const v1Sql = readFileSync(productionPath(V1_FILE), "utf8");
const v2Sql = readFileSync(productionPath(V2_FILE), "utf8");
const v3Sql = readFileSync(productionPath(V3_FILE), "utf8");
assert.equal(
  createHash("sha256").update(v1Sql).digest("hex"),
  "6ca2ebd9b4136bd63276188a2d3995fabe2333a54f35b7fb6c935a07ce09b896",
  "the promoted v1 Registry migration is exact Singapore remote bytes"
);
assert.equal(
  createHash("sha256").update(v2Sql).digest("hex"),
  "e4cbb2f034406db54231093b054966b333a7b4451da94a359f7d72f896e577a5",
  "the promoted v2 Registry migration remains exact Singapore remote bytes"
);

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
]) assert.match(v2Sql, new RegExp(escaped(value)));
for (const value of [
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.id,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.registry_version,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.content_sha256,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.sem_standard_version,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT.resolution_contract_sha256
]) assert.match(v3Sql, new RegExp(escaped(value)));

assert.equal(
  EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id
);
assert.notEqual(
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.id,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id,
  "the behavior-neutral bridge exposes v3 readiness without moving active v2 writes"
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

const V1_PAYLOAD = Object.freeze({
  mode: "post_observation_exact_external_identity",
  external_catalog: true,
  pack_id: "lynca.csm.external-identity",
  pack_version: "2026-08-10",
  pack_sha256: "f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
  index_id: "basketball.1996-97-topps-stadium-club-high-risers",
  index_sha256: "984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
  resolution_contract_sha256: "e0b2e3463e8dc13f33d5ca2dbb3739b6e07c7b02f820901b4961ed83d0d945df",
  provider_calls_added: 0
});

function assertAdditiveRelease(sql, { migrationVersion, promotedAt, payload }) {
  assert.equal((sql.match(/insert\s+into\s+public\.csm_registry_releases/gi) || []).length, 1);
  assert.match(sql, /on conflict \(id\) do nothing/i);
  assert.match(sql, new RegExp(`and promoted_by = 'migration:${escaped(migrationVersion)}'`, "i"));
  assert.match(sql, new RegExp(`and promoted_at = '${escaped(promotedAt)}'::timestamptz`, "i"));
  assert.doesNotMatch(sql, /\b(?:delete|update|drop|truncate|alter)\b/i,
    "Registry releases must remain additive");

  const registryPayloads = [...sql.matchAll(/'(\{[\s\S]*?\})'::jsonb/g)]
    .map((match) => JSON.parse(match[1]));
  assert.equal(registryPayloads.length, 2,
    "the inserted and migration-time asserted Registry payloads must both be explicit");
  for (const actual of registryPayloads) {
    assert.deepEqual(actual, payload);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(payload).sort());
  }
  assert.match(sql, /and\s+registry_payload\s*=\s*'\{[\s\S]*?\}'::jsonb/i,
    "PostgreSQL jsonb equality must reject rows with missing or additional payload keys");
  assert.doesNotMatch(sql, /registry_payload\s*->>/i,
    "per-field extraction would silently accept unrecognized payload keys");
}

for (const [key, value] of Object.entries(THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT)) {
  const expected = typeof value === "boolean" ? String(value) : String(value);
  assert.match(v2Sql, new RegExp(`"${escaped(key)}"\\s*:\\s*${typeof value === "string" ? `"${escaped(expected)}"` : escaped(expected)}`));
}
for (const [key, value] of Object.entries(
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT
)) {
  const expected = String(value);
  assert.match(v3Sql, new RegExp(`"${escaped(key)}"\\s*:\\s*${typeof value === "string" ? `"${escaped(expected)}"` : escaped(expected)}`));
}

assertAdditiveRelease(v1Sql, {
  migrationVersion: "20260810120000",
  promotedAt: "2026-08-10T12:00:00Z",
  payload: V1_PAYLOAD
});
assertAdditiveRelease(v2Sql, {
  migrationVersion: "20260810200000",
  promotedAt: "2026-08-09T19:40:00Z",
  payload: THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
});
assertAdditiveRelease(v3Sql, {
  migrationVersion: "20260813221955",
  promotedAt: "2026-08-13T22:19:55Z",
  payload: THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT
});

console.log("CSM external identity Registry migration: ok");
