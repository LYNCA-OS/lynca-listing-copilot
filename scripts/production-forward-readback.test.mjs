#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA,
  PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA,
  buildProductionForwardReadbackExpectation,
  productionForwardReadbackAssetId,
  webIdentityQueryHasVisibleAnchors,
  verifyPromotedProductionForwardReadback,
  verifyProductionForwardReadback,
  writeProductionForwardReadbackExpectation
} from "./production-forward-readback.mjs";

const candidateOrigin = "https://lynca-listing-copilot-bridge123.vercel.app";
const candidateGitSha = "a".repeat(40);
const rollbackGitSha = "b".repeat(40);
const assetId = "asset-forward-readback-1";
const sessionId = `csmsess_${"c".repeat(40)}`;
const ownerSha256 = "d".repeat(64);
const title = "2025 Topps Chrome #251 Cooper Flagg Mavericks RC 50/50";
const versions = {
  resolution_view_schema: "csm-resolution-view-v1",
  csm_contract: "csm-stage-shadow-v2",
  resolver: "thin-path-resolver-v1",
  composer: "thin-marketplace-composer-v2",
  marketplace_profile: "ebay-profile-v1"
};
const evidence = {
  schema_version: "production-writer-journey-evidence-v6",
  evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
  accuracy_claim: null,
  release_class: "compatibility-bridge",
  passed: true,
  deployment_origin: candidateOrigin,
  deployment_identity: `${candidateOrigin}#${candidateGitSha}`,
  deployment_git_commit_sha: candidateGitSha,
  deployment_environment: "production",
  cases: [{
    case_id: "NON_TCG",
    expected_grammar: "NON_TCG",
    asset_id: assetId,
    recognition_session_id: sessionId,
    resolution_http_method: "GET",
    resolution_request_count: 1,
    trace_reliable: true,
    recomposed_matches_stored: true,
    title_length: title.length,
    owner_execution_readback: {
      version: "csm-owner-execution-receipt-v1",
      sha256: ownerSha256,
      durable_read_after_write: true
    },
    versions
  }]
};
const resolutionView = {
  schema_version: versions.resolution_view_schema,
  asset_id: assetId,
  recognition_session_id: sessionId,
  grammar: {
    value: "NON_TCG",
    raw: "standard",
    contract_version: versions.resolution_view_schema,
    resolver_version: versions.resolver
  },
  composer: {
    title,
    stored_title: title,
    character_budget: 80,
    length: title.length,
    truncated: false,
    composer_version: versions.composer,
    marketplace_profile_version: versions.marketplace_profile,
    recomposed_matches_stored: true,
    trace_reliable: true
  },
  brackets: [{
    bracket: "card_number",
    canonical_field: "card_number",
    value: "251",
    selected_candidate: "251",
    rendered_text: "#251"
  }],
  summary: { included: 1, omitted: 0 },
  owner_execution_receipt: {
    version: "csm-owner-execution-receipt-v1",
    sha256: ownerSha256
  }
};
const rollbackReceipt = {
  schema_version: "vercel-production-rollback-receipt-v1",
  canonical_origin: "https://listing.lyncafei.team",
  team_id: "team_ForwardReadback",
  project_id: "prj_ForwardReadback",
  deployment_id: "dpl_ForwardReadback",
  deployment_url: "https://lynca-listing-copilot-old123.vercel.app",
  git_sha: rollbackGitSha,
  ready_state: "READY",
  target: "production",
  captured_at: "2026-08-11T12:00:00.000Z"
};
const responseUrl =
  `https://listing.lyncafei.team/api/csm-resolution-view?asset_id=${assetId}`;

const expectation = buildProductionForwardReadbackExpectation({
  evidence,
  resolutionView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
assert.equal(expectation.schema_version, PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA);
assert.equal(expectation.resolution_view.composer.stored_title, title);
assert.equal(productionForwardReadbackAssetId({
  evidence,
  expectation,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), assetId);

const receipt = verifyProductionForwardReadback({
  evidence,
  expectation,
  resolutionView,
  responseUrl,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha,
  rollbackReceipt,
  now: () => new Date("2026-08-11T12:05:00.000Z")
});
assert.equal(receipt.schema_version, PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA);
assert.equal(receipt.canonical_read_scope, "CAPTURED_ROLLBACK_TARGET");
assert.equal(receipt.canonical_read_deployment_git_sha, rollbackGitSha);
assert.equal(receipt.candidate_git_sha, candidateGitSha);
assert.equal(receipt.release_class, "compatibility-bridge");
assert.equal(receipt.http_method, "GET");
assert.equal(receipt.redirects_followed, 0);
assert.equal(receipt.provider_calls, 0);
assert.equal(receipt.stored_title_exact_match, true);
assert.equal(receipt.composer_profile_exact_match, true);
assert.equal(receipt.owner_execution_receipt_exact_match, true);
assert.equal(receipt.trace_exact_match, true);
assert.equal(receipt.support_receipts_exact_match, true);
assert.equal(receipt.founder_beta_web_receipt_exact_match, false);
assert.equal(receipt.web_search_used, false);
assert.equal(receipt.web_search_call_count, 0);
assert.equal(receipt.full_resolution_view_exact_match, true);
assert.equal(receipt.verified_at, "2026-08-11T12:05:00.000Z");
assert.equal(JSON.stringify(receipt).includes(title), false);
assert.equal(Object.hasOwn(receipt, "title_sha256"), false);
assert.equal(Object.hasOwn(receipt, "resolution_view"), false);

const promotedReceipt = verifyPromotedProductionForwardReadback({
  evidence,
  expectation,
  resolutionView,
  responseUrl,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha,
  now: () => new Date("2026-08-11T12:06:00.000Z")
});
assert.equal(promotedReceipt.canonical_read_scope, "PROMOTED_CANDIDATE");
assert.equal(promotedReceipt.canonical_read_deployment_git_sha, candidateGitSha);
assert.equal(promotedReceipt.full_resolution_view_exact_match, true);

const clone = (value) => structuredClone(value);
for (const mutate of [
  (value) => { value.passed = false; },
  (value) => { value.release_class = "unsupported-release-class"; },
  (value) => { value.deployment_identity = `${candidateOrigin}#${rollbackGitSha}`; },
  (value) => { value.cases[0].recognition_session_id = `csmsess_${"e".repeat(40)}`; },
  (value) => { value.cases[0].owner_execution_readback.sha256 = "e".repeat(64); },
  (value) => { value.cases[0].versions.composer = "thin-marketplace-composer-v3"; },
  (value) => { value.cases[0].trace_reliable = false; }
]) {
  const changed = clone(evidence);
  mutate(changed);
  assert.throws(() => productionForwardReadbackAssetId({
    evidence: changed,
    expectation,
    deploymentUrl: candidateOrigin,
    gitSha: candidateGitSha
  }), /production_forward_readback_/);
}

for (const mutate of [
  (value) => { value.composer.stored_title = `${title} drift`; },
  (value) => { value.composer.title = `${title} drift`; value.composer.stored_title = `${title} drift`; value.composer.length += 6; },
  (value) => { value.composer.composer_version = "thin-marketplace-composer-v3"; },
  (value) => { value.composer.marketplace_profile_version = "lynca-standard-name-v0.1"; },
  (value) => { value.owner_execution_receipt.sha256 = "e".repeat(64); },
  (value) => { value.composer.trace_reliable = false; },
  (value) => { value.brackets[0].selected_candidate = "250"; },
  (value) => { value.verified_original_observation_support = { status: "APPLIED" }; }
]) {
  const changed = clone(resolutionView);
  mutate(changed);
  assert.throws(() => verifyProductionForwardReadback({
    evidence,
    expectation,
    resolutionView: changed,
    responseUrl,
    deploymentUrl: candidateOrigin,
    gitSha: candidateGitSha,
    rollbackReceipt
  }), /production_forward_readback_/);
}

for (const changedUrl of [
  responseUrl.replace("listing.lyncafei.team", "lynca-listing-copilot-old123.vercel.app"),
  `${responseUrl}&extra=1`,
  "https://listing.lyncafei.team/api/csm-resolution-view",
  `http://listing.lyncafei.team/api/csm-resolution-view?asset_id=${assetId}`
]) {
  assert.throws(() => verifyProductionForwardReadback({
    evidence,
    expectation,
    resolutionView,
    responseUrl: changedUrl,
    deploymentUrl: candidateOrigin,
    gitSha: candidateGitSha,
    rollbackReceipt
  }), /production_forward_readback_response_url_invalid/);
}

for (const changedRollback of [
  { ...rollbackReceipt, canonical_origin: "https://example.invalid" },
  { ...rollbackReceipt, deployment_url: candidateOrigin },
  { ...rollbackReceipt, git_sha: "not-a-sha" }
]) {
  assert.throws(() => verifyProductionForwardReadback({
    evidence,
    expectation,
    resolutionView,
    responseUrl,
    deploymentUrl: candidateOrigin,
    gitSha: candidateGitSha,
    rollbackReceipt: changedRollback
  }), /production_forward_readback_/);
}

// Ordinary Activation A binds this existing zero-call GET lane to the frozen
// governed-Web case. Compatibility Bridge above remains bound to NON_TCG.
const ordinaryEvidence = clone(evidence);
ordinaryEvidence.release_class = "ordinary";
ordinaryEvidence.cases[0].case_id = "NON_TCG_WEB_IDENTITY";
ordinaryEvidence.cases[0].versions.composer = "thin-marketplace-composer-v3";
ordinaryEvidence.cases[0].versions.marketplace_profile = "lynca-standard-name-v0.3";
ordinaryEvidence.cases[0].versions.csm_contract = "csm-stage-shadow-v3";
const ordinaryView = clone(resolutionView);
ordinaryView.composer.composer_version = "thin-marketplace-composer-v3";
ordinaryView.composer.marketplace_profile_version = "lynca-standard-name-v0.3";
ordinaryView.founder_beta_web_receipt = {
  schema_version: "founder-beta-web-receipt-v1",
  provider_request_count: 1,
  isolated_model_call_count: 0,
  provider_model: "gpt-5.6-luna",
  reasoning_effort: "low",
  web_search_used: true,
  web_search_call_count: 1,
  queries: ["2020-21 Panini Contenders Anthony Edwards #105 checklist"],
  urls: ["https://example.com/checklist"],
  field_evidence: [{
    field: "card_name",
    support_urls: ["https://example.com/checklist"],
    conflict_urls: [],
    unresolved_urls: []
  }],
  semantic_state_sha256: "f".repeat(64)
};
ordinaryView.set_card_name_relation_receipt = {
  schema_version: "set-card-name-relations-v1",
  set: { predicate: "CURRENT_CARD_MEMBER_OF_SET", value: "Rookie Ticket" },
  card_name: {
    predicate: "CURRENT_CARD_NAMED_BY_DESIGN", value: "Variation Autograph"
  }
};
const ordinaryExpectation = buildProductionForwardReadbackExpectation({
  evidence: ordinaryEvidence,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
const ordinaryReceipt = verifyProductionForwardReadback({
  evidence: ordinaryEvidence,
  expectation: ordinaryExpectation,
  resolutionView: ordinaryView,
  responseUrl,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha,
  rollbackReceipt
});
assert.equal(ordinaryReceipt.release_class, "ordinary");
assert.equal(ordinaryReceipt.support_receipts_exact_match, true);
assert.equal(ordinaryReceipt.composer_version, "thin-marketplace-composer-v3");
assert.equal(ordinaryReceipt.provider_calls, 0);
assert.equal(ordinaryReceipt.founder_beta_web_receipt_exact_match, true);
assert.equal(ordinaryReceipt.web_search_used, true);
assert.equal(ordinaryReceipt.web_search_call_count, 1);
for (const queries of [
  ["2020-21 Panini Contenders Anthony Edwards #105 checklist"],
  ["#105 / Contenders — additional seller words"],
  ["Anthony Edwards", "Contenders checklist"],
  ["CONTENDERS 105 Anthony Edwards"]
]) assert.equal(webIdentityQueryHasVisibleAnchors(queries), true);
for (const queries of [
  ["cheap basketball shoes near me"],
  ["Contenders cheap basketball shoes"],
  ["Anthony Edwards basketball shoes"],
  ["105 basketball shoes"],
  ["Contenders 1050"]
]) assert.equal(webIdentityQueryHasVisibleAnchors(queries), false);
const modelOwnedQueryView = clone(ordinaryView);
modelOwnedQueryView.founder_beta_web_receipt.queries = [
  "Contenders #105 identity lookup with extra model-selected words"
];
const modelOwnedQueryExpectation = buildProductionForwardReadbackExpectation({
  evidence: ordinaryEvidence,
  resolutionView: modelOwnedQueryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
assert.doesNotThrow(() => verifyProductionForwardReadback({
  evidence: ordinaryEvidence,
  expectation: modelOwnedQueryExpectation,
  resolutionView: modelOwnedQueryView,
  responseUrl,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha,
  rollbackReceipt
}), "post-promotion readback must not require an exact model-owned query string");
const irrelevantQueryView = clone(ordinaryView);
irrelevantQueryView.founder_beta_web_receipt.queries = ["cheap basketball shoes near me"];
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: ordinaryEvidence,
  resolutionView: irrelevantQueryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_resolution_view_invalid/,
"an unrelated provider query must fail the designated Web release proof");
for (const mutate of [
  (value) => { value.founder_beta_web_receipt.web_search_call_count = 0; },
  (value) => { value.founder_beta_web_receipt.queries = []; },
  (value) => { value.founder_beta_web_receipt.urls = []; },
  (value) => { value.founder_beta_web_receipt.field_evidence = []; },
  (value) => { value.set_card_name_relation_receipt.card_name.predicate = "wrong"; }
]) {
  const changed = clone(ordinaryView);
  mutate(changed);
  assert.throws(() => verifyPromotedProductionForwardReadback({
    evidence: ordinaryEvidence,
    expectation: ordinaryExpectation,
    resolutionView: changed,
    responseUrl,
    deploymentUrl: candidateOrigin,
    gitSha: candidateGitSha
  }), /production_forward_readback_/);
}

const temp = await mkdtemp(path.join(tmpdir(), "lynca-forward-readback-"));
try {
  const evidencePath = path.join(temp, "evidence.json");
  const expectationPath = path.join(temp, "expectation.json");
  const readbackPath = path.join(temp, "readback.json");
  const rollbackPath = path.join(temp, "rollback.json");
  const receiptPath = path.join(temp, "receipt.json");
  await writeFile(evidencePath, JSON.stringify(evidence));
  await writeProductionForwardReadbackExpectation(expectationPath, expectation);
  await writeFile(readbackPath, JSON.stringify(resolutionView), { mode: 0o600 });
  await writeFile(rollbackPath, JSON.stringify(rollbackReceipt), { mode: 0o600 });
  assert.equal((await stat(expectationPath)).mode & 0o777, 0o600);
  const script = path.resolve("scripts/production-forward-readback.mjs");
  const env = {
    ...process.env,
    VERCEL_ORG_ID: rollbackReceipt.team_id,
    VERCEL_PROJECT_ID: rollbackReceipt.project_id
  };
  assert.equal(execFileSync(process.execPath, [
    script, "asset-id",
    "--evidence", evidencePath,
    "--expectation", expectationPath,
    "--deployment-url", candidateOrigin,
    "--git-sha", candidateGitSha
  ], { encoding: "utf8", env }).trim(), assetId);
  execFileSync(process.execPath, [
    script, "verify",
    "--evidence", evidencePath,
    "--expectation", expectationPath,
    "--readback", readbackPath,
    "--response-url", responseUrl,
    "--deployment-url", candidateOrigin,
    "--git-sha", candidateGitSha,
    "--rollback-receipt", rollbackPath,
    "--out", receiptPath
  ], { env });
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(receiptPath, "utf8"))
    .full_resolution_view_exact_match, true);

  await chmod(expectationPath, 0o644);
  assert.throws(() => execFileSync(process.execPath, [
    script, "asset-id",
    "--evidence", evidencePath,
    "--expectation", expectationPath,
    "--deployment-url", candidateOrigin,
    "--git-sha", candidateGitSha
  ], { env, stdio: "pipe" }), /Command failed/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("production forward readback: ok");
