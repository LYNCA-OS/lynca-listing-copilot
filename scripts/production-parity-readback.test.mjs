#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  PRODUCTION_PARITY_EXPECTED_TITLE,
  productionParityAssetId,
  verifyProductionParityReadback
} from "./production-parity-readback.mjs";

const deploymentUrl = "https://lynca-listing-copilot-candidate456.vercel.app";
const gitSha = "a".repeat(40);
const assetId = "9f5ca6ab-7d48-4cc5-97da-a54831065d29";
const recognitionSessionId = `csmsess_${"b".repeat(40)}`;
const ownerVersion = "csm-owner-execution-receipt.v1";
const ownerSha256 = "c".repeat(64);
const versions = {
  resolution_view_schema: "csm-resolution-view-v1",
  csm_contract: "csm-stage-shadow-v2",
  resolver: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.resolver_version,
  composer: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version
};
const expectedFields = [
  "card_number", "manufacturer", "product", "set", "subjects", "team", "year"
];
const sourceIds = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map(({ source_id: id }) => id).sort();

const evidenceExternal = {
  applied: true,
  match_basis: "VERIFIED_ORIGINAL_SET",
  record_id: "tcdb-2551-hr14",
  registry_release_id: EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id,
  registry_release_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.content_sha256,
  pack_id: EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.id,
  pack_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.sha256,
  index_id: EXTERNAL_IDENTITY_RELEASE_CONTRACT.index.id,
  index_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.index.sha256,
  resolution_contract_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.sha256,
  supported_fields: expectedFields,
  source_count: sourceIds.length,
  source_ids: sourceIds
};
const evidence = {
  schema_version: "production-writer-journey-evidence-v5",
  evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
  accuracy_claim: null,
  release_class: "ordinary",
  passed: true,
  deployment_origin: deploymentUrl,
  deployment_identity: `${deploymentUrl}#${gitSha}`,
  deployment_git_commit_sha: gitSha,
  deployment_environment: "production",
  final_seal: {
    codex_parity_exact_match_count: 1,
    verified_original_set_match_count: 1
  },
  cases: [{
    case_id: "EXTERNAL_IDENTITY",
    asset_id: assetId,
    recognition_session_id: recognitionSessionId,
    codex_parity_exact_match: true,
    resolution_http_method: "GET",
    resolution_request_count: 1,
    trace_reliable: true,
    recomposed_matches_stored: true,
    owner_execution_readback: {
      version: ownerVersion,
      sha256: ownerSha256,
      durable_read_after_write: true
    },
    versions,
    external_identity_support: evidenceExternal
  }]
};
const publicSources = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map((source) => ({
  provider: source.source_id.startsWith("tcdb.")
    ? "TCDB" : source.source_id.startsWith("psa.") ? "PSA" : "Beckett",
  source_id: source.source_id,
  url: source.url,
  retrieved_at: source.retrieved_at,
  fact_sha256: source.fact_sha256,
  fields: ["year"]
}));
const resolutionView = {
  schema_version: versions.resolution_view_schema,
  asset_id: assetId,
  recognition_session_id: recognitionSessionId,
  grammar: {
    contract_version: versions.resolution_view_schema,
    resolver_version: versions.resolver
  },
  composer: {
    composer_version: versions.composer,
    stored_title: PRODUCTION_PARITY_EXPECTED_TITLE,
    recomposed_matches_stored: true,
    trace_reliable: true
  },
  owner_execution_receipt: { version: ownerVersion, sha256: ownerSha256 },
  external_identity_support: {
    schema_version: "csm-external-identity-public-receipt.v1",
    status: "APPLIED",
    registry_release: {
      id: EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.id,
      registry_version: THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.registry_version,
      content_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.registry_release.content_sha256,
      sem_standard_version: THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.sem_standard_version
    },
    match_basis: "VERIFIED_ORIGINAL_SET",
    resolver_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.resolver_version,
    conflict_policy_version:
      EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.conflict_policy_version,
    composer_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version,
    marketplace_profile_version:
      EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version,
    resolution_contract_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.sha256,
    pack: EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack,
    index: EXTERNAL_IDENTITY_RELEASE_CONTRACT.index,
    record_id: "tcdb-2551-hr14",
    supported_fields: expectedFields,
    field_decisions: Object.fromEntries(expectedFields.map((field) => [field, {
      action: "CORROBORATE", source_ids: [sourceIds[0]]
    }])),
    sources: publicSources
  }
};

assert.equal(productionParityAssetId({ evidence, deploymentUrl, gitSha }), assetId);
const receipt = verifyProductionParityReadback({
  evidence,
  resolutionView,
  deploymentUrl,
  gitSha,
  now: () => new Date("2026-08-11T12:00:00.000Z")
});
assert.equal(receipt.schema_version, "production-parity-persisted-readback-receipt-v1");
assert.equal(receipt.canonical_origin, "https://listing.lyncafei.team");
assert.equal(receipt.deployment_url, deploymentUrl);
assert.equal(receipt.git_sha, gitSha);
assert.equal(receipt.read_route, "/api/csm-resolution-view");
assert.equal(receipt.http_method, "GET");
assert.equal(receipt.provider_calls, 0);
assert.equal(receipt.asset_id, assetId);
assert.equal(receipt.recognition_session_id, recognitionSessionId);
assert.equal(receipt.persisted_title_exact_match, true);
assert.equal(receipt.owner_execution_receipt_sha256, ownerSha256);
assert.equal(receipt.verified_at, "2026-08-11T12:00:00.000Z");
assert.equal(JSON.stringify(receipt).includes(PRODUCTION_PARITY_EXPECTED_TITLE), false);
assert.equal(Object.hasOwn(receipt, "stored_title"), false);
assert.equal(Object.hasOwn(receipt, "title_sha256"), false);
assert.equal(Object.hasOwn(receipt, "sources"), false);

const clone = (value) => structuredClone(value);
for (const mutate of [
  (value) => { value.passed = false; },
  (value) => { value.release_class = "compatibility-bridge"; },
  (value) => { value.deployment_git_commit_sha = "d".repeat(40); },
  (value) => { value.cases[0].resolution_http_method = "POST"; },
  (value) => { value.cases[0].owner_execution_readback.sha256 = "d".repeat(64); }
]) {
  const changed = clone(evidence);
  mutate(changed);
  assert.throws(() => verifyProductionParityReadback({
    evidence: changed, resolutionView, deploymentUrl, gitSha
  }), /production_parity_readback_/);
}
for (const mutate of [
  (value) => { value.composer.stored_title = `${PRODUCTION_PARITY_EXPECTED_TITLE} drift`; },
  (value) => { value.recognition_session_id = `csmsess_${"d".repeat(40)}`; },
  (value) => { value.owner_execution_receipt.sha256 = "d".repeat(64); },
  (value) => { value.grammar.resolver_version = "resolver-drift"; },
  (value) => { value.external_identity_support.registry_release.id = "registry-drift"; }
]) {
  const changed = clone(resolutionView);
  mutate(changed);
  assert.throws(() => verifyProductionParityReadback({
    evidence, resolutionView: changed, deploymentUrl, gitSha
  }), /production_parity_readback_/);
}

const temp = await mkdtemp(path.join(tmpdir(), "lynca-production-parity-readback-"));
try {
  const evidencePath = path.join(temp, "evidence.json");
  const readbackPath = path.join(temp, "readback.json");
  const receiptPath = path.join(temp, "receipt.json");
  await writeFile(evidencePath, JSON.stringify(evidence));
  await writeFile(readbackPath, JSON.stringify(resolutionView), { mode: 0o600 });
  const script = path.resolve("scripts/production-parity-readback.mjs");
  const assetOutput = execFileSync(process.execPath, [
    script, "asset-id",
    "--evidence", evidencePath,
    "--deployment-url", deploymentUrl,
    "--git-sha", gitSha
  ], { encoding: "utf8" }).trim();
  assert.equal(assetOutput, assetId);
  execFileSync(process.execPath, [
    script, "verify",
    "--evidence", evidencePath,
    "--readback", readbackPath,
    "--deployment-url", deploymentUrl,
    "--git-sha", gitSha,
    "--out", receiptPath
  ]);
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(saved.persisted_title_exact_match, true);
  assert.equal(JSON.stringify(saved).includes(PRODUCTION_PARITY_EXPECTED_TITLE), false);

  await chmod(readbackPath, 0o644);
  assert.throws(() => execFileSync(process.execPath, [
    script, "verify",
    "--evidence", evidencePath,
    "--readback", readbackPath,
    "--deployment-url", deploymentUrl,
    "--git-sha", gitSha,
    "--out", path.join(temp, "must-not-exist.json")
  ], { stdio: "pipe" }), /Command failed/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("production parity persisted readback: ok");
