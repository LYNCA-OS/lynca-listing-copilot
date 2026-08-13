#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildCsmResolutionView } from "../csm/contracts/resolution-view.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeLyncaStandardName } from
  "../lib/listing/thin/canonical-naming-adapter.mjs";

import {
  PRODUCTION_FORWARD_READBACK_EXPECTATION_SCHEMA,
  PRODUCTION_FORWARD_READBACK_RECEIPT_SCHEMA,
  buildProductionForwardReadbackExpectation,
  classifyFounderWebSearch,
  classifyFounderWebSearchSignals,
  FOUNDER_WEB_SEARCH_CLASSIFICATION,
  governedIdentityAppliedSupportUrl,
  governedAppliedWebSupportProof,
  productionForwardReadbackAssetId,
  strictNoSearchReceipt,
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
  schema_version: "production-writer-journey-evidence-v7",
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
    founder_web_search: {
      classification: "STRICT_NO_SEARCH",
      web_search_used: false,
      web_search_call_count: 0,
      query_recorded: false,
      query_visible_anchor_match: true,
      source_url_count: 0,
      governed_support_url_count: 0,
      governed_support_fields: [],
      governed_applied_support: false,
      strict_no_search: true,
      used_without_governed_applied_support: false,
      unresolved_authority_fields: []
    },
    owner_execution_readback: {
      version: "csm-owner-execution-receipt-v1",
      sha256: ownerSha256,
      durable_read_after_write: true
    },
    versions
  }, {
    case_id: "LARGE_STAGED_TRANSPORT",
    transport_only: true
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
ordinaryEvidence.cases[0].original_set_sha256 =
  "f2c21929f45fc664aa0136bb5f3ef045018b53bbe05ada9cf799bb914213f2a0";
const ordinaryFields = parseCanonicalFields({
  year: "2020-21", manufacturer: "Panini", product: "Contenders",
  set: "Rookie Ticket", card_name: "Variation Autograph",
  subjects: ["Anthony Edwards"], card_number: "105", grammar: "standard"
}).fields;
const ordinaryComposed = composeLyncaStandardName(ordinaryFields, {
  publicationCoverage: true
});
const ordinaryTitle = ordinaryComposed.title;
ordinaryEvidence.cases[0].title_length = ordinaryTitle.length;
ordinaryEvidence.cases[0].founder_web_search = {
  classification: "GOVERNED_APPLIED_SUPPORT",
  web_search_used: true,
  web_search_call_count: 1,
  query_recorded: true,
  query_visible_anchor_match: true,
  source_url_count: 1,
  governed_support_url_count: 1,
  governed_support_fields: ["set"],
  governed_applied_support: true,
  strict_no_search: false,
  used_without_governed_applied_support: false,
  unresolved_authority_fields: []
};
ordinaryEvidence.final_seal = {
  qualified_governed_web_support_case_count: 1,
  strict_no_search_case_count: 1,
  used_without_governed_applied_support_case_count: 0,
  semantic_web_case_count: 2,
  transport_only_web_excluded_case_count: 1,
  selected_forward_readback_case_id: "NON_TCG_WEB_IDENTITY"
};
ordinaryEvidence.cases.push({
  ...clone(ordinaryEvidence.cases[0]),
  case_id: "TCG",
  asset_id: "asset-forward-readback-no-search",
  recognition_session_id: `csmsess_${"9".repeat(40)}`,
  original_set_sha256: null,
  founder_web_search: {
    classification: "STRICT_NO_SEARCH",
    web_search_used: false,
    web_search_call_count: 0,
    query_recorded: false,
    query_visible_anchor_match: true,
    source_url_count: 0,
    governed_support_url_count: 0,
    governed_support_fields: [],
    governed_applied_support: false,
    strict_no_search: true,
    used_without_governed_applied_support: false,
    unresolved_authority_fields: []
  }
});
for (const caseId of ["NON_TCG", "EXTERNAL_IDENTITY", "LOT_SHARED_ONLY"]) {
  ordinaryEvidence.cases.push({
    ...clone(ordinaryEvidence.cases.find((entry) => entry.case_id === "TCG")),
    case_id: caseId,
    asset_id: `asset-forward-readback-${caseId.toLowerCase()}`,
    recognition_session_id: `csmsess_${caseId.charCodeAt(0).toString(16).repeat(40).slice(0, 40)}`
  });
}
ordinaryEvidence.final_seal.strict_no_search_case_count = 4;
ordinaryEvidence.final_seal.semantic_web_case_count = 5;
const ordinaryView = clone(buildCsmResolutionView({
  fields: ordinaryFields,
  composed: ordinaryComposed,
  assetId,
  recognitionSessionId: sessionId
}));
ordinaryEvidence.cases[0].versions.resolver = ordinaryView.grammar.resolver_version;
ordinaryView.composer = {
  ...ordinaryView.composer,
  stored_title: ordinaryTitle,
  composer_version: "thin-marketplace-composer-v3",
  marketplace_profile_version: "lynca-standard-name-v0.3",
  recomposed_matches_stored: true,
  trace_reliable: true
};
ordinaryView.owner_execution_receipt = clone(resolutionView.owner_execution_receipt);
ordinaryView.founder_beta_web_receipt = {
  schema_version: "founder-beta-web-receipt-v1",
  provider_request_count: 1,
  isolated_model_call_count: 0,
  provider_model: "gpt-5.6-luna",
  reasoning_effort: "low",
  web_search_used: true,
  web_search_call_count: 1,
  queries: ["2020-21 Panini Contenders Anthony Edwards #105 checklist"],
  urls: ["https://www.paniniamerica.net/checklist"],
  field_evidence: [{
    field: "set",
    support_urls: ["https://www.paniniamerica.net/checklist"],
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
assert.equal(governedAppliedWebSupportProof(
  ordinaryView.founder_beta_web_receipt, ordinaryView, {
    originalSetSha256: ordinaryEvidence.cases[0].original_set_sha256
  }
), true);
assert.equal(governedAppliedWebSupportProof(
  ordinaryView.founder_beta_web_receipt, ordinaryView, {
    originalSetSha256: "0".repeat(64)
  }
), false);
assert.equal(strictNoSearchReceipt(ordinaryView.founder_beta_web_receipt), false);
assert.equal(strictNoSearchReceipt({
  ...ordinaryView.founder_beta_web_receipt,
  web_search_used: false,
  web_search_call_count: 0,
  queries: [],
  urls: [],
  field_evidence: []
}), true);
assert.equal(classifyFounderWebSearch(
  ordinaryView.founder_beta_web_receipt, ordinaryView, {
    originalSetSha256: ordinaryEvidence.cases[0].original_set_sha256
  }
)?.classification, FOUNDER_WEB_SEARCH_CLASSIFICATION.GOVERNED_APPLIED_SUPPORT);
const strictNoSearchV1 = {
  ...clone(ordinaryView.founder_beta_web_receipt),
  web_search_used: false,
  web_search_call_count: 0,
  queries: [],
  urls: [],
  field_evidence: []
};
assert.equal(classifyFounderWebSearch(strictNoSearchV1, ordinaryView)?.classification,
  FOUNDER_WEB_SEARCH_CLASSIFICATION.STRICT_NO_SEARCH);
const usedWithoutFieldEvidenceV2 = {
  ...clone(strictNoSearchV1),
  schema_version: "founder-beta-web-receipt-v2",
  outcome: "USED_WITHOUT_FIELD_EVIDENCE",
  web_search_used: true,
  web_search_call_count: 1
};
assert.deepEqual(classifyFounderWebSearch(usedWithoutFieldEvidenceV2, ordinaryView), {
  classification:
    FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT,
  governed_applied_support: false,
  strict_no_search: false,
  used_without_governed_applied_support: true
});
const queryOnlyV1 = {
  ...clone(usedWithoutFieldEvidenceV2),
  schema_version: "founder-beta-web-receipt-v1",
  queries: ["provider-owned query without applied support"]
};
delete queryOnlyV1.outcome;
assert.equal(classifyFounderWebSearch(queryOnlyV1, ordinaryView)?.classification,
  FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT,
"historical valid query-only receipts must enter the exhaustive third WJ class");
assert.equal(classifyFounderWebSearchSignals({
  webSearchUsed: false,
  governedAppliedSupport: true,
  strictNoSearch: true
}), null, "contradictory Web claims may not enter any class");
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
const transportProofTamper = clone(ordinaryEvidence);
transportProofTamper.cases.find((entry) => entry.transport_only).founder_web_search =
  clone(ordinaryEvidence.cases.find((entry) => entry.case_id === "TCG").founder_web_search);
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: transportProofTamper,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"the transport-only row may not fabricate a Web classification");
const duplicateTransportCase = clone(ordinaryEvidence);
duplicateTransportCase.cases.push({
  case_id: "LARGE_STAGED_TRANSPORT",
  transport_only: true
});
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: duplicateTransportCase,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"the Web cohort must exclude exactly one known transport-only case");
const semanticTransportSpoof = clone(ordinaryEvidence);
const spoofedTcgCase = semanticTransportSpoof.cases.find(
  (entry) => entry.case_id === "TCG"
);
spoofedTcgCase.transport_only = true;
delete spoofedTcgCase.founder_web_search;
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: semanticTransportSpoof,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"a semantic case may not spoof the transport-only exclusion");
const unmarkedLargeTransport = clone(ordinaryEvidence);
delete unmarkedLargeTransport.cases.find(
  (entry) => entry.case_id === "LARGE_STAGED_TRANSPORT"
).transport_only;
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: unmarkedLargeTransport,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"the known large transport case must be explicitly excluded from semantic Web classification");
const missingSemanticCase = clone(ordinaryEvidence);
missingSemanticCase.cases = missingSemanticCase.cases.filter(
  (entry) => entry.case_id !== "LOT_SHARED_ONLY"
);
missingSemanticCase.final_seal.semantic_web_case_count = 4;
missingSemanticCase.final_seal.strict_no_search_case_count = 3;
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: missingSemanticCase,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"ordinary readback must retain the complete five-case semantic Web cohort");
const replacedSemanticCase = clone(ordinaryEvidence);
const lotCaseIndex = replacedSemanticCase.cases.findIndex(
  (entry) => entry.case_id === "LOT_SHARED_ONLY"
);
replacedSemanticCase.cases[lotCaseIndex] = {
  ...clone(replacedSemanticCase.cases.find((entry) => entry.case_id === "TCG")),
  asset_id: "asset-forward-readback-duplicate-tcg",
  recognition_session_id: `csmsess_${"7".repeat(40)}`
};
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: replacedSemanticCase,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"five rows may not hide a missing semantic case behind a duplicate case id");
const boundedOrdinaryView = clone(ordinaryView);
boundedOrdinaryView.founder_beta_web_receipt.web_search_call_count = 2;
const boundedOrdinaryExpectation = buildProductionForwardReadbackExpectation({
  evidence: ordinaryEvidence,
  resolutionView: boundedOrdinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
const boundedOrdinaryReceipt = verifyPromotedProductionForwardReadback({
  evidence: ordinaryEvidence,
  expectation: boundedOrdinaryExpectation,
  resolutionView: boundedOrdinaryView,
  responseUrl,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
assert.equal(boundedOrdinaryReceipt.web_search_used, true);
assert.equal(boundedOrdinaryReceipt.web_search_call_count, 2,
  "forward readback must preserve the actual bounded call count");
const dynamicOrdinaryEvidence = clone(ordinaryEvidence);
dynamicOrdinaryEvidence.cases.find(
  (entry) => entry.case_id === "EXTERNAL_IDENTITY"
).case_id = "NON_TCG_WEB_IDENTITY";
dynamicOrdinaryEvidence.cases[0].case_id = "EXTERNAL_IDENTITY";
dynamicOrdinaryEvidence.final_seal.selected_forward_readback_case_id = "EXTERNAL_IDENTITY";
const dynamicOrdinaryView = clone(ordinaryView);
const dynamicOrdinaryExpectation = buildProductionForwardReadbackExpectation({
  evidence: dynamicOrdinaryEvidence,
  resolutionView: dynamicOrdinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
assert.equal(dynamicOrdinaryExpectation.case_id, "EXTERNAL_IDENTITY");
const dynamicOrdinaryReceipt = verifyPromotedProductionForwardReadback({
  evidence: dynamicOrdinaryEvidence,
  expectation: dynamicOrdinaryExpectation,
  resolutionView: dynamicOrdinaryView,
  responseUrl,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
});
assert.equal(dynamicOrdinaryReceipt.provider_calls, 0);
assert.equal(dynamicOrdinaryReceipt.full_resolution_view_exact_match, true,
  "post-promotion readback must preserve the dynamically selected full view");
const missingCardNumberDynamicView = clone(dynamicOrdinaryView);
missingCardNumberDynamicView.composer.title =
  "2020-21 Panini Contenders Rookie Ticket Variation Autograph Anthony Edwards";
missingCardNumberDynamicView.composer.stored_title =
  missingCardNumberDynamicView.composer.title;
missingCardNumberDynamicView.composer.length = missingCardNumberDynamicView.composer.title.length;
assert.equal(governedAppliedWebSupportProof(
  missingCardNumberDynamicView.founder_beta_web_receipt,
  missingCardNumberDynamicView,
  { originalSetSha256: dynamicOrdinaryEvidence.cases[0].original_set_sha256 }
), false);
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: dynamicOrdinaryEvidence,
  resolutionView: missingCardNumberDynamicView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_resolution_view_invalid/,
"a dynamically selected non-Web-ID case cannot omit the public #105 token");
for (const mutate of [
  (value) => { value.final_seal.qualified_governed_web_support_case_count = 2; },
  (value) => { value.final_seal.strict_no_search_case_count = 0; },
  (value) => { value.final_seal.selected_forward_readback_case_id = "TCG"; },
  (value) => {
    value.cases.find((entry) => entry.case_id === "TCG")
      .founder_web_search.strict_no_search = false;
  },
  (value) => {
    value.cases.find((entry) => entry.case_id === "TCG")
      .founder_web_search.used_without_governed_applied_support = true;
  }
]) {
  const changed = clone(ordinaryEvidence);
  mutate(changed);
  assert.throws(() => buildProductionForwardReadbackExpectation({
    evidence: changed,
    resolutionView: ordinaryView,
    deploymentUrl: candidateOrigin,
    gitSha: candidateGitSha
  }), /production_forward_readback_standard_case_invalid/);
}
const governedRecastAsThird = clone(ordinaryEvidence);
Object.assign(governedRecastAsThird.cases[0].founder_web_search, {
  classification: "USED_WITHOUT_GOVERNED_APPLIED_SUPPORT",
  governed_applied_support: false,
  strict_no_search: false,
  used_without_governed_applied_support: true
});
Object.assign(governedRecastAsThird.final_seal, {
  qualified_governed_web_support_case_count: 0,
  used_without_governed_applied_support_case_count: 1
});
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: governedRecastAsThird,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"a coherent third-class rewrite may not erase the exactly-one governed case gate");

const strictRecastAsThird = clone(ordinaryEvidence);
Object.assign(strictRecastAsThird.cases.find(
  (entry) => entry.case_id === "TCG"
).founder_web_search, {
  classification: "USED_WITHOUT_GOVERNED_APPLIED_SUPPORT",
  web_search_used: true,
  web_search_call_count: 1,
  governed_applied_support: false,
  strict_no_search: false,
  used_without_governed_applied_support: true
});
Object.assign(strictRecastAsThird.final_seal, {
  strict_no_search_case_count: 0,
  used_without_governed_applied_support_case_count: 1
});
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: strictRecastAsThird,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"a coherent third-class rewrite may not erase the at-least-one strict no-search gate");

const extraGovernedCase = clone(ordinaryEvidence);
Object.assign(extraGovernedCase.cases.find(
  (entry) => entry.case_id === "TCG"
).founder_web_search, {
  classification: "GOVERNED_APPLIED_SUPPORT",
  web_search_used: true,
  web_search_call_count: 1,
  governed_applied_support: true,
  strict_no_search: false,
  used_without_governed_applied_support: false
});
Object.assign(extraGovernedCase.final_seal, {
  qualified_governed_web_support_case_count: 2,
  strict_no_search_case_count: 0
});
assert.throws(() => buildProductionForwardReadbackExpectation({
  evidence: extraGovernedCase,
  resolutionView: ordinaryView,
  deploymentUrl: candidateOrigin,
  gitSha: candidateGitSha
}), /production_forward_readback_standard_case_invalid/,
"a second coherently forged non-selected governed class must violate the exactly-one gate");
for (const queries of [
  ["2020-21 Panini Contenders Anthony Edwards #105 checklist"],
  ["#105 / Contenders — additional seller words"],
  ["CONTENDERS 105 Anthony Edwards"]
]) assert.equal(webIdentityQueryHasVisibleAnchors(queries), true);
for (const queries of [
  ["cheap basketball shoes near me"],
  ["Contenders cheap basketball shoes"],
  ["Anthony Edwards basketball shoes"],
  ["Anthony Edwards", "Contenders checklist"],
  ["Anthony Edwards Contenders basketball shoes"],
  ["105 basketball shoes"],
  ["Contenders 1050"]
]) assert.equal(webIdentityQueryHasVisibleAnchors(queries), false);
assert.equal(governedIdentityAppliedSupportUrl(
  "https://www.paniniamerica.net/checklist.html"
), true);
assert.equal(governedIdentityAppliedSupportUrl(
  "https://www.paniniamerica.net/privacy-policy"
), false);
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
  (value) => { value.founder_beta_web_receipt.web_search_call_count = 3; },
  (value) => { value.founder_beta_web_receipt.queries = []; },
  (value) => { value.founder_beta_web_receipt.urls = []; },
  (value) => { value.founder_beta_web_receipt.field_evidence = []; },
  (value) => { value.set_card_name_relation_receipt.card_name.predicate = "wrong"; },
  (value) => {
    value.founder_beta_web_receipt.urls = ["https://example.com/checklist"];
    value.founder_beta_web_receipt.field_evidence[0].support_urls =
      ["https://example.com/checklist"];
  },
  (value) => {
    value.founder_beta_web_receipt.urls =
      ["https://www.paniniamerica.net/privacy-policy"];
    value.founder_beta_web_receipt.field_evidence[0].support_urls =
      ["https://www.paniniamerica.net/privacy-policy"];
  },
  (value) => {
    value.founder_beta_web_receipt.field_evidence[0].field = "year";
  },
  (value) => { value.set_card_name_relation_receipt.set.value = "Rookie Tickets"; },
  (value) => {
    value.brackets.find((entry) => entry.canonical_field === "card_name")
      .selected_candidate = "Rookie Autograph";
  },
  (value) => {
    value.composer.title = value.composer.stored_title =
      "2020-21 Panini Contenders Variation Autograph Rookie Ticket #105 Anthony Edwards";
    value.composer.length = value.composer.title.length;
  },
  (value) => {
    value.composer.title = value.composer.stored_title =
      "2020-21 Panini Contenders Rookie Ticket Variation Autograph Anthony Edwards #105";
    value.composer.length = value.composer.title.length;
  },
  (value) => {
    value.brackets.push(structuredClone(
      value.brackets.find((entry) => entry.canonical_field === "card_name")
    ));
  },
  (value) => {
    value.brackets.find((entry) => entry.canonical_field === "card_name")
      .publication_coverage.push({
        bracket: "card_name",
        source_field: "card_name",
        source_index: 0,
        canonical_value: "Variation Autograph",
        disposition: "SUPPRESSED_BY_PROFILE"
      });
  },
  (value) => {
    const bracket = value.brackets.find((entry) => entry.canonical_field === "card_name");
    bracket.rendered_text = null;
    bracket.composer_disposition = "SUPPRESSED_BY_PROFILE";
    bracket.publication_coverage = [{
      bracket: "card_name", source_field: "card_name", source_index: 0,
      canonical_value: "Variation Autograph", disposition: "SUPPRESSED_BY_PROFILE"
    }];
  },
  (value) => {
    const bracket = value.brackets.find((entry) => entry.canonical_field === "card_name");
    bracket.rendered_text = null;
    bracket.composer_disposition = "DROPPED_FOR_BUDGET";
    bracket.publication_coverage = [{
      bracket: "card_name", source_field: "card_name", source_index: 0,
      canonical_value: "Variation Autograph", disposition: "DROPPED_FOR_BUDGET"
    }];
  }
]) {
  const changed = clone(ordinaryView);
  mutate(changed);
  assert.equal(governedAppliedWebSupportProof(
    changed.founder_beta_web_receipt, changed, {
      originalSetSha256: ordinaryEvidence.cases[0].original_set_sha256
    }
  ), false, "every tampered view must fail the shared release qualification proof");
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
