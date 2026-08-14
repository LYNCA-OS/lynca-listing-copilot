#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_RELEASE_CONTRACT_V3,
  EXTERNAL_IDENTITY_SUPPORT_PACK,
  externalIdentityReleaseContractForRegistryRelease,
  validateExternalIdentityPublicReceipt
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_WRITER_PROJECTION_CONTRACTS
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  verifiedOriginalObservationHealthReceiptForReleases
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT
} from "./production-standard-p0-verifier.mjs";
import {
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "./materialize-writer-journey-source.mjs";
import {
  PRODUCTION_PARITY_EXPECTED_TITLE,
  PRODUCTION_PARITY_READBACK_RECEIPT_SCHEMA,
  PRODUCTION_STANDARD_READBACK_RECEIPT_SCHEMA,
  productionParityAssetId,
  productionStandardAssetId,
  verifyProductionParityReadback,
  verifyProductionStandardReadback
} from "./production-parity-readback.mjs";

const deploymentUrl = "https://lynca-listing-copilot-candidate456.vercel.app";
const gitSha = "a".repeat(40);
const assetId = "9f5ca6ab-7d48-4cc5-97da-a54831065d29";
const recognitionSessionId = `csmsess_${"b".repeat(40)}`;
const ownerVersion = "csm-owner-execution-receipt.v1";
const ownerSha256 = "c".repeat(64);
const standardAssetId = "1c78877d-d1ed-4877-8f18-8a720eab6457";
const standardRecognitionSessionId = `csmsess_${"d".repeat(40)}`;
const standardOwnerSha256 = "e".repeat(64);
const standardTitle = PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title;
const activeWriterContract = CSM_PROJECTION_ACTIVATION.active_writer;
const activeExternalIdentityRelease = externalIdentityReleaseContractForRegistryRelease(
  activeWriterContract.external_identity.registry_release_id
);
const activeExternalIdentityRegistry = activeExternalIdentityRelease.registry_release.id
  === THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT.id
  ? THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT
  : THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT;
const canonicalNamingForWriter = (writer) => [
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
].find((contract) => contract.composer_version === writer.standard.composer_version
  && contract.marketplace_profile_version === writer.standard.marketplace_profile_version);
const verifiedOriginalForWriter = (writer) => ({
  health: verifiedOriginalObservationHealthReceiptForReleases({
    verifiedOriginalObservationReleaseId: writer.verified_original_observation_overlay,
    externalIdentityRegistryReleaseId: writer.external_identity.registry_release_id
  }),
  receipt: VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases[
    writer.verified_original_observation_overlay
  ].receipt
});
const activeCanonicalNaming = canonicalNamingForWriter(activeWriterContract);
const activeVerifiedOriginal = verifiedOriginalForWriter(activeWriterContract);
const knownWrongStageForWriter = (writer) => [
  CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible.durable_projection_contract_version,
  CSM_WRITER_PROJECTION_CONTRACTS.future_v3.durable_projection_contract_version
].find((stage) => stage !== writer.durable_projection_contract_version);
const versions = {
  resolution_view_schema: "csm-resolution-view-v1",
  csm_contract: activeWriterContract.durable_projection_contract_version,
  resolver: activeExternalIdentityRelease.resolution_contract.resolver_version,
  composer: activeExternalIdentityRelease.resolution_contract.composer_version,
  marketplace_profile:
    activeExternalIdentityRelease.resolution_contract.marketplace_profile_version
};
const standardVersions = {
  ...versions,
  resolver: activeVerifiedOriginal.receipt.resolver_version,
  composer: activeCanonicalNaming.composer_version,
  marketplace_profile: activeCanonicalNaming.marketplace_profile_version
};
const expectedFields = [
  "card_number", "manufacturer", "product", "set", "subjects", "team", "year"
];
const sourceIds = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map(({ source_id: id }) => id).sort();
const decisionSourceIds = Object.freeze({
  year: sourceIds,
  manufacturer: ["beckett.item.3117708"],
  product: sourceIds,
  set: sourceIds,
  subjects: sourceIds,
  team: ["tcdb.set.2551", "beckett.item.3117708"],
  card_number: sourceIds
});
const clone = (value) => structuredClone(value);
const stableJson = (value) => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`
    : JSON.stringify(value);
const retryReceiptBody = {
  schema_version: "luna-definitive-502-transport-retry-receipt-v1",
  operation_key_sha256: "7".repeat(64),
  payload_sha256: "8".repeat(64),
  provider: "openai",
  model: "gpt-5.6-luna",
  failed_attempt: 1,
  failed_attempt_class: "fresh",
  http_status: 502,
  ambiguous: false,
  returned_http_response: true,
  response_body_complete: true,
  provider_output_present: false,
  provider_contract_failure: false,
  provider_business_failure: false,
  actual_tokens: null,
  provider_request_id: "req-first-502",
  provider_client_request_id: "lynca-first-502",
  retry_provider_client_request_id: "lynca-retry-502",
  provider_error_code: "server_error",
  provider_error_type: "server_error",
  provider_error_param: null,
  provider_ms: 15,
  settle_code: "settled",
  operation_status: "FAILED",
  retry_attempt: 2,
  retry_attempt_class: "retry"
};
const retryReceipt = {
  ...retryReceiptBody,
  receipt_sha256: createHash("sha256").update(stableJson(retryReceiptBody)).digest("hex")
};

const evidenceExternal = {
  applied: true,
  match_basis: "VERIFIED_ORIGINAL_SET",
  record_id: "tcdb-2551-hr14",
  registry_release_id: activeExternalIdentityRelease.registry_release.id,
  registry_release_sha256: activeExternalIdentityRelease.registry_release.content_sha256,
  pack_id: activeExternalIdentityRelease.support_pack.id,
  pack_sha256: activeExternalIdentityRelease.support_pack.sha256,
  index_id: activeExternalIdentityRelease.index.id,
  index_sha256: activeExternalIdentityRelease.index.sha256,
  resolution_contract_sha256: activeExternalIdentityRelease.resolution_contract.sha256,
  supported_fields: expectedFields,
  source_count: sourceIds.length,
  source_ids: sourceIds
};
const evidence = {
  schema_version: "production-writer-journey-evidence-v7",
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
    verified_original_set_match_count: 1,
    canonical_naming_active_case_count: 1,
    standard_p0_exact_case_count: 1
  },
  cases: [
    {
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
    },
    {
      case_id: "NON_TCG",
      expected_grammar: "NON_TCG",
      source_kind: "PRODUCTION_ASSET",
      source_record_id: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.source_asset_id,
      source_asset_id: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.source_asset_id,
      hash_provenance: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.hash_provenance,
      image_sha256: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images.map((image) => ({
        role: image.role,
        content_sha256: image.content_sha256
      })),
      asset_id: standardAssetId,
      recognition_session_id: standardRecognitionSessionId,
      provider_attempt_number: 1,
      provider_retry_count: 0,
      execution_receipt: {
        provider_transport_retry_receipt: null,
        provider_authority_receipt: {
          operation_key_sha256: "7".repeat(64),
          attempt: 1,
          attempt_class: "fresh"
        }
      },
      resolution_http_method: "GET",
      resolution_request_count: 1,
      trace_reliable: true,
      recomposed_matches_stored: true,
      title_length: standardTitle.length,
      canonical_naming_active: true,
      standard_p0_identity: {
        card_number_selected_exact: true,
        serial_selected_exact: true,
        selected_brackets_exact: true,
        recomposed_title_exact: true,
        stored_title_exact: true,
        recognition_title_exact: true,
        ui_title_exact: true
      },
      owner_execution_readback: {
        version: ownerVersion,
        sha256: standardOwnerSha256,
        durable_read_after_write: true
      },
      versions: standardVersions
    }
  ]
};
const publicSources = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map((source) => ({
  provider: source.source_id.startsWith("tcdb.")
    ? "TCDB" : source.source_id.startsWith("psa.") ? "PSA" : "Beckett",
  source_id: source.source_id,
  url: source.url,
  retrieved_at: source.retrieved_at,
  fact_sha256: source.fact_sha256,
  fields: Object.entries(decisionSourceIds)
    .filter(([, ids]) => ids.includes(source.source_id))
    .map(([field]) => field)
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
      id: activeExternalIdentityRelease.registry_release.id,
      registry_version: activeExternalIdentityRegistry.registry_version,
      content_sha256: activeExternalIdentityRelease.registry_release.content_sha256,
      sem_standard_version: activeExternalIdentityRegistry.sem_standard_version
    },
    match_basis: "VERIFIED_ORIGINAL_SET",
    resolver_version: activeExternalIdentityRelease.resolution_contract.resolver_version,
    conflict_policy_version:
      activeExternalIdentityRelease.resolution_contract.conflict_policy_version,
    composer_version: activeExternalIdentityRelease.resolution_contract.composer_version,
    marketplace_profile_version:
      activeExternalIdentityRelease.resolution_contract.marketplace_profile_version,
    resolution_contract_sha256: activeExternalIdentityRelease.resolution_contract.sha256,
    pack: activeExternalIdentityRelease.support_pack,
    index: activeExternalIdentityRelease.index,
    record_id: "tcdb-2551-hr14",
    supported_fields: expectedFields,
    field_decisions: Object.fromEntries(expectedFields.map((field) => [field, {
      action: "CORROBORATE", source_ids: decisionSourceIds[field]
    }])),
    sources: publicSources
  }
};
const verifiedOriginalSupport = {
  schema_version: "csm-verified-original-closed-projection-public-receipt.v1",
  status: "APPLIED",
  match_basis: "EXACT_VERIFIED_ORIGINAL_SET",
  release_id: activeVerifiedOriginal.health.release_id,
  pack_id: "lynca.csm.verified-original-closed-projection.subset-a",
  pack_version: activeVerifiedOriginal.health.pack_version,
  pack_sha256: activeVerifiedOriginal.health.pack_sha256,
  resolver_version: activeVerifiedOriginal.receipt.resolver_version,
  conflict_policy_version: VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  resolution_contract_sha256:
    activeVerifiedOriginal.health.resolution_contract_sha256,
  projection_mode: "CLOSED_WORLD_EXACT",
  closed_world_field_count:
    activeVerifiedOriginal.health.closed_world_field_count
};
const standardResolutionView = {
  schema_version: standardVersions.resolution_view_schema,
  asset_id: standardAssetId,
  recognition_session_id: standardRecognitionSessionId,
  grammar: {
    value: "NON_TCG",
    raw: "standard",
    contract_version: standardVersions.resolution_view_schema,
    resolver_version: standardVersions.resolver
  },
  composer: {
    title: standardTitle,
    stored_title: standardTitle,
    character_budget: activeCanonicalNaming.character_budget,
    length: standardTitle.length,
    truncated: false,
    composer_version: standardVersions.composer,
    marketplace_profile_version: standardVersions.marketplace_profile,
    recomposed_matches_stored: true,
    trace_reliable: true
  },
  brackets: [{
    bracket: "card_number",
    canonical_field: "card_number",
    value: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_card_number,
    selected_candidate: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_card_number,
    rendered_text: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.rendered_card_number
  }, {
    bracket: "numerical_rarity",
    canonical_field: "serial",
    value: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial,
    selected_candidate: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial,
    rendered_text: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial
  }],
  verified_original_observation_support: verifiedOriginalSupport,
  owner_execution_receipt: { version: ownerVersion, sha256: standardOwnerSha256 }
};

function externalIdentityVariant({ writerContract, release, registry }) {
  const variantEvidence = clone(evidence);
  const variantView = clone(resolutionView);
  const variantVersions = {
    ...variantEvidence.cases[0].versions,
    csm_contract: writerContract.durable_projection_contract_version,
    resolver: release.resolution_contract.resolver_version,
    composer: release.resolution_contract.composer_version,
    marketplace_profile: release.resolution_contract.marketplace_profile_version
  };
  variantEvidence.cases[0].versions = variantVersions;
  Object.assign(variantEvidence.cases[0].external_identity_support, {
    registry_release_id: release.registry_release.id,
    registry_release_sha256: release.registry_release.content_sha256,
    pack_id: release.support_pack.id,
    pack_sha256: release.support_pack.sha256,
    index_id: release.index.id,
    index_sha256: release.index.sha256,
    resolution_contract_sha256: release.resolution_contract.sha256
  });
  variantView.grammar.resolver_version = variantVersions.resolver;
  variantView.composer.composer_version = variantVersions.composer;
  Object.assign(variantView.external_identity_support, {
    registry_release: {
      id: release.registry_release.id,
      registry_version: registry.registry_version,
      content_sha256: release.registry_release.content_sha256,
      sem_standard_version: registry.sem_standard_version
    },
    resolver_version: release.resolution_contract.resolver_version,
    conflict_policy_version: release.resolution_contract.conflict_policy_version,
    composer_version: release.resolution_contract.composer_version,
    marketplace_profile_version: release.resolution_contract.marketplace_profile_version,
    resolution_contract_sha256: release.resolution_contract.sha256,
    pack: release.support_pack,
    index: release.index
  });
  if (release.registry_release.id === EXTERNAL_IDENTITY_RELEASE_CONTRACT_V3.registry_release.id) {
    variantView.external_identity_support.field_decisions.product.action = "CORRECT_CONFLICT";
  }
  assert.equal(validateExternalIdentityPublicReceipt(
    variantView.external_identity_support
  ), true);
  return Object.freeze({
    evidence: variantEvidence,
    resolutionView: variantView,
    writerContract
  });
}

function standardVariant(writerContract) {
  const variantEvidence = clone(evidence);
  const variantView = clone(standardResolutionView);
  const canonical = canonicalNamingForWriter(writerContract);
  const verified = verifiedOriginalForWriter(writerContract);
  const variantVersions = {
    ...variantEvidence.cases[1].versions,
    csm_contract: writerContract.durable_projection_contract_version,
    resolver: verified.receipt.resolver_version,
    composer: canonical.composer_version,
    marketplace_profile: canonical.marketplace_profile_version
  };
  variantEvidence.cases[1].versions = variantVersions;
  variantView.grammar.resolver_version = variantVersions.resolver;
  Object.assign(variantView.composer, {
    character_budget: canonical.character_budget,
    composer_version: canonical.composer_version,
    marketplace_profile_version: canonical.marketplace_profile_version
  });
  Object.assign(variantView.verified_original_observation_support, {
    release_id: verified.health.release_id,
    pack_version: verified.health.pack_version,
    pack_sha256: verified.health.pack_sha256,
    resolver_version: verified.receipt.resolver_version,
    conflict_policy_version: verified.receipt.conflict_policy_version,
    resolution_contract_sha256: verified.health.resolution_contract_sha256,
    closed_world_field_count: verified.health.closed_world_field_count
  });
  return Object.freeze({
    evidence: variantEvidence,
    resolutionView: variantView,
    writerContract
  });
}

assert.equal(productionParityAssetId({ evidence, deploymentUrl, gitSha }), assetId);
const receipt = verifyProductionParityReadback({
  evidence,
  resolutionView,
  deploymentUrl,
  gitSha,
  now: () => new Date("2026-08-11T12:00:00.000Z")
});
assert.equal(receipt.schema_version, PRODUCTION_PARITY_READBACK_RECEIPT_SCHEMA);
assert.equal(receipt.canonical_origin, "https://listing.lyncafei.team");
assert.equal(receipt.deployment_url, deploymentUrl);
assert.equal(receipt.git_sha, gitSha);
assert.equal(receipt.read_route, "/api/csm-resolution-view");
assert.equal(receipt.http_method, "GET");
assert.equal(receipt.provider_calls, 0);
assert.equal(receipt.asset_id, assetId);
assert.equal(receipt.recognition_session_id, recognitionSessionId);
assert.equal(receipt.persisted_title_exact_match, true);
assert.equal(receipt.marketplace_profile_version, versions.marketplace_profile);
assert.equal(receipt.owner_execution_receipt_sha256, ownerSha256);
assert.equal(receipt.verified_at, "2026-08-11T12:00:00.000Z");
assert.equal(JSON.stringify(receipt).includes(PRODUCTION_PARITY_EXPECTED_TITLE), false);
assert.equal(Object.hasOwn(receipt, "stored_title"), false);
assert.equal(Object.hasOwn(receipt, "title_sha256"), false);
assert.equal(Object.hasOwn(receipt, "sources"), false);

const externalV2 = externalIdentityVariant({
  writerContract: CSM_WRITER_PROJECTION_CONTRACTS.future_v3,
  release: EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  registry: THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
});
const externalV3 = externalIdentityVariant({
  writerContract: CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3,
  release: EXTERNAL_IDENTITY_RELEASE_CONTRACT_V3,
  registry: THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT
});
for (const variant of [externalV2, externalV3]) {
  const expectedRelease = externalIdentityReleaseContractForRegistryRelease(
    variant.writerContract.external_identity.registry_release_id
  );
  assert.equal(productionParityAssetId({
    evidence: variant.evidence,
    deploymentUrl,
    gitSha,
    writerContract: variant.writerContract
  }), assetId);
  const variantReceipt = verifyProductionParityReadback({
    evidence: variant.evidence,
    resolutionView: variant.resolutionView,
    deploymentUrl,
    gitSha,
    writerContract: variant.writerContract
  });
  assert.equal(variantReceipt.registry_release_id, expectedRelease.registry_release.id);
  assert.equal(variantReceipt.resolution_contract_sha256,
    expectedRelease.resolution_contract.sha256);
  assert.equal(variantReceipt.provider_calls, 0);
}
for (const [variant, invalidStage] of [
  [externalV2, knownWrongStageForWriter(externalV2.writerContract)],
  [externalV3, knownWrongStageForWriter(externalV3.writerContract)]
]) {
  const changed = clone(variant.evidence);
  changed.cases[0].versions.csm_contract = invalidStage;
  assert.throws(() => productionParityAssetId({
    evidence: changed,
    deploymentUrl,
    gitSha,
    writerContract: variant.writerContract
  }), /production_parity_readback_case_invalid/);
  assert.throws(() => verifyProductionParityReadback({
    evidence: changed,
    resolutionView: variant.resolutionView,
    deploymentUrl,
    gitSha,
    writerContract: variant.writerContract
  }), /production_parity_readback_case_invalid/);
}
for (const invalidStage of [
  knownWrongStageForWriter(activeWriterContract),
  "csm-stage-unknown"
]) {
  const changed = clone(evidence);
  changed.cases[0].versions.csm_contract = invalidStage;
  assert.throws(() => productionParityAssetId({
    evidence: changed, deploymentUrl, gitSha
  }), /production_parity_readback_case_invalid/);
  assert.throws(() => verifyProductionParityReadback({
    evidence: changed, resolutionView, deploymentUrl, gitSha
  }), /production_parity_readback_case_invalid/);
}
for (const [writerContract, variantEvidence, variantView] of [
  [externalV3.writerContract, externalV2.evidence, externalV2.resolutionView],
  [externalV2.writerContract, externalV3.evidence, externalV3.resolutionView],
  [externalV3.writerContract, externalV3.evidence, externalV2.resolutionView],
  [externalV2.writerContract, externalV2.evidence, externalV3.resolutionView]
]) {
  assert.throws(() => verifyProductionParityReadback({
    evidence: variantEvidence,
    resolutionView: variantView,
    deploymentUrl,
    gitSha,
    writerContract
  }), /production_parity_readback_/);
}
{
  const unknownEvidence = clone(externalV3.evidence);
  unknownEvidence.cases[0].external_identity_support.registry_release_id = "unknown-release";
  assert.throws(() => productionParityAssetId({
    evidence: unknownEvidence,
    deploymentUrl,
    gitSha,
    writerContract: externalV3.writerContract
  }), /production_parity_readback_case_invalid/);
  const unknownReadback = clone(externalV3.resolutionView);
  unknownReadback.external_identity_support.registry_release.id = "unknown-release";
  assert.throws(() => verifyProductionParityReadback({
    evidence: externalV3.evidence,
    resolutionView: unknownReadback,
    deploymentUrl,
    gitSha,
    writerContract: externalV3.writerContract
  }), /production_parity_readback_external_identity_mismatch/);
}

assert.equal(productionStandardAssetId({ evidence, deploymentUrl, gitSha }), standardAssetId);
const standardReceipt = verifyProductionStandardReadback({
  evidence,
  resolutionView: standardResolutionView,
  deploymentUrl,
  gitSha,
  now: () => new Date("2026-08-11T12:01:00.000Z")
});
assert.equal(standardReceipt.schema_version, PRODUCTION_STANDARD_READBACK_RECEIPT_SCHEMA);
assert.equal(standardReceipt.provider_calls, 0);
assert.equal(standardReceipt.asset_id, standardAssetId);
assert.equal(standardReceipt.recognition_session_id, standardRecognitionSessionId);
assert.equal(standardReceipt.persisted_standard_canonical_naming, true);
assert.equal(standardReceipt.source_asset_exact_match, true);
assert.equal(standardReceipt.writer_journey_standard_p0_exact, true);
assert.equal(standardReceipt.full_title_exact_match, true);
assert.equal(standardReceipt.card_number_exact_match, true);
assert.equal(standardReceipt.serial_exact_match, true);
assert.equal(standardReceipt.selected_brackets_exact, true);
assert.equal(standardReceipt.composer_version,
  activeCanonicalNaming.composer_version);
assert.equal(standardReceipt.marketplace_profile_version,
  activeCanonicalNaming.marketplace_profile_version);
assert.equal(standardReceipt.character_budget,
  activeCanonicalNaming.character_budget);
assert.equal(standardReceipt.owner_execution_receipt_sha256, standardOwnerSha256);
assert.equal(standardReceipt.verified_at, "2026-08-11T12:01:00.000Z");
assert.equal(JSON.stringify(standardReceipt).includes(standardTitle), false);
assert.equal(JSON.stringify(standardReceipt).includes(
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_serial
), false);
assert.equal(JSON.stringify(standardReceipt).includes(
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.rendered_card_number
), false);
assert.equal(Object.hasOwn(standardReceipt, "stored_title"), false);
assert.equal(Object.hasOwn(standardReceipt, "title"), false);

const futureStandard = standardVariant(
  CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
);
assert.equal(productionStandardAssetId({
  evidence: futureStandard.evidence,
  deploymentUrl,
  gitSha,
  writerContract: futureStandard.writerContract
}), standardAssetId);
assert.equal(verifyProductionStandardReadback({
  evidence: futureStandard.evidence,
  resolutionView: futureStandard.resolutionView,
  deploymentUrl,
  gitSha,
  writerContract: futureStandard.writerContract
}).csm_contract_version,
futureStandard.writerContract.durable_projection_contract_version);
{
  const changed = clone(futureStandard.evidence);
  changed.cases[1].versions.csm_contract =
    knownWrongStageForWriter(futureStandard.writerContract);
  assert.throws(() => productionStandardAssetId({
    evidence: changed,
    deploymentUrl,
    gitSha,
    writerContract: futureStandard.writerContract
  }), /production_standard_readback_case_invalid/);
  assert.throws(() => verifyProductionStandardReadback({
    evidence: changed,
    resolutionView: futureStandard.resolutionView,
    deploymentUrl,
    gitSha,
    writerContract: futureStandard.writerContract
  }), /production_standard_readback_case_invalid/);
}
for (const invalidStage of [
  knownWrongStageForWriter(activeWriterContract),
  "csm-stage-unknown"
]) {
  const changed = clone(evidence);
  changed.cases[1].versions.csm_contract = invalidStage;
  assert.throws(() => productionStandardAssetId({
    evidence: changed, deploymentUrl, gitSha
  }), /production_standard_readback_case_invalid/);
  assert.throws(() => verifyProductionStandardReadback({
    evidence: changed,
    resolutionView: standardResolutionView,
    deploymentUrl,
    gitSha
  }), /production_standard_readback_case_invalid/);
}

const repairedEvidence = structuredClone(evidence);
const repairedCase = repairedEvidence.cases[1];
repairedCase.provider_attempt_number = 2;
repairedCase.provider_retry_count = 1;
repairedCase.execution_receipt = {
  provider_transport_retry_receipt: structuredClone(retryReceipt),
  provider_authority_receipt: {
    operation_key_sha256: retryReceipt.operation_key_sha256,
    attempt: 2,
    attempt_class: "retry"
  }
};
assert.equal(verifyProductionStandardReadback({
  evidence: repairedEvidence,
  resolutionView: standardResolutionView,
  deploymentUrl,
  gitSha
}).provider_calls, 0,
"post-promotion readback must accept the exact sealed single-502 retry tuple");

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
  (value) => { value.composer.marketplace_profile_version = versions.marketplace_profile; },
  (value) => { value.composer.marketplace_profile_version = "profile-drift"; },
  (value) => { value.composer.marketplace_profile_version = null; },
  (value) => { value.external_identity_support.registry_release.id = "registry-drift"; }
]) {
  const changed = clone(resolutionView);
  mutate(changed);
  assert.throws(() => verifyProductionParityReadback({
    evidence, resolutionView: changed, deploymentUrl, gitSha
  }), /production_parity_readback_/);
}
for (const mutate of [
  (value) => { value.final_seal.canonical_naming_active_case_count = 0; },
  (value) => { value.final_seal.standard_p0_exact_case_count = 0; },
  (value) => { value.cases[1].canonical_naming_active = false; },
  (value) => { value.cases[1].source_asset_id = "asset_drift"; },
  (value) => { value.cases[1].image_sha256[0].content_sha256 = "f".repeat(64); },
  (value) => { value.cases[1].standard_p0_identity.card_number_selected_exact = false; },
  (value) => { value.cases[1].expected_grammar = "TCG"; },
  (value) => { value.cases[1].versions.resolver = "resolver-drift"; },
  (value) => { value.cases[1].versions.composer = "thin-marketplace-composer-v2"; },
  (value) => { value.cases[1].title_length = 81; },
  (value) => { value.cases[1].external_identity_support = evidenceExternal; },
  (value) => { value.cases[1].provider_attempt_number = 2; },
  (value) => { value.cases[1].provider_retry_count = 1; }
]) {
  const changed = clone(evidence);
  mutate(changed);
  assert.throws(() => verifyProductionStandardReadback({
    evidence: changed,
    resolutionView: standardResolutionView,
    deploymentUrl,
    gitSha
  }), /production_standard_readback_/);
}
for (const mutate of [
  (value) => { value.cases[1].provider_retry_count = 0; },
  (value) => {
    value.cases[1].execution_receipt.provider_authority_receipt.operation_key_sha256 =
      "9".repeat(64);
  },
  (value) => {
    value.cases[1].execution_receipt.provider_transport_retry_receipt.receipt_sha256 =
      "0".repeat(64);
  }
]) {
  const changed = clone(repairedEvidence);
  mutate(changed);
  assert.throws(() => verifyProductionStandardReadback({
    evidence: changed,
    resolutionView: standardResolutionView,
    deploymentUrl,
    gitSha
  }), /production_standard_readback_/);
}
for (const mutate of [
  (value) => { value.composer.stored_title = `${standardTitle} drift`; },
  (value) => { value.brackets.push({ ...value.brackets[0] }); },
  (value) => { value.brackets.push({ ...value.brackets[1] }); },
  (value) => { value.brackets[0].canonical_field = "collector_number"; },
  (value) => { value.brackets[0].selected_candidate = "250"; },
  (value) => { value.brackets[1].rendered_text = "49/50"; },
  (value) => { delete value.composer.marketplace_profile_version; },
  (value) => { value.composer.marketplace_profile_version = null; },
  (value) => { value.composer.marketplace_profile_version = "ebay-profile-v1"; },
  (value) => { value.composer.composer_version = "unknown-composer"; },
  (value) => { delete value.verified_original_observation_support; },
  (value) => { value.verified_original_observation_support.resolver_version = "resolver-drift"; },
  (value) => { value.verified_original_observation_support.release_id = "release-drift"; },
  (value) => { value.verified_original_observation_support.original_set_sha256 = "0".repeat(64); },
  (value) => { value.grammar.raw = "tcg"; },
  (value) => { value.owner_execution_receipt.sha256 = "f".repeat(64); },
  (value) => { value.composer.trace_reliable = false; },
  (value) => { value.external_identity_support = {}; }
]) {
  const changed = clone(standardResolutionView);
  mutate(changed);
  assert.throws(() => verifyProductionStandardReadback({
    evidence,
    resolutionView: changed,
    deploymentUrl,
    gitSha
  }), /production_standard_readback_/);
}

// Isolate the frozen P0 full-title check: all generic length and evidence
// invariants agree with the shorter value, so only title identity can reject it.
{
  const shortTitle = "#251 50/50";
  const changedEvidence = clone(evidence);
  changedEvidence.cases[1].title_length = shortTitle.length;
  const changedView = clone(standardResolutionView);
  changedView.composer.title = shortTitle;
  changedView.composer.stored_title = shortTitle;
  changedView.composer.length = shortTitle.length;
  assert.throws(() => verifyProductionStandardReadback({
    evidence: changedEvidence,
    resolutionView: changedView,
    deploymentUrl,
    gitSha
  }), /production_standard_readback_persisted_value_mismatch/);
}

const temp = await mkdtemp(path.join(tmpdir(), "lynca-production-parity-readback-"));
try {
  const evidencePath = path.join(temp, "evidence.json");
  const readbackPath = path.join(temp, "readback.json");
  const receiptPath = path.join(temp, "receipt.json");
  const standardReadbackPath = path.join(temp, "standard-readback.json");
  const standardReceiptPath = path.join(temp, "standard-receipt.json");
  await writeFile(evidencePath, JSON.stringify(evidence));
  await writeFile(readbackPath, JSON.stringify(resolutionView), { mode: 0o600 });
  await writeFile(standardReadbackPath, JSON.stringify(standardResolutionView), { mode: 0o600 });
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

  const standardAssetOutput = execFileSync(process.execPath, [
    script, "standard-asset-id",
    "--evidence", evidencePath,
    "--deployment-url", deploymentUrl,
    "--git-sha", gitSha
  ], { encoding: "utf8" }).trim();
  assert.equal(standardAssetOutput, standardAssetId);
  execFileSync(process.execPath, [
    script, "verify-standard",
    "--evidence", evidencePath,
    "--readback", standardReadbackPath,
    "--deployment-url", deploymentUrl,
    "--git-sha", gitSha,
    "--out", standardReceiptPath
  ]);
  assert.equal((await stat(standardReceiptPath)).mode & 0o777, 0o600);
  const savedStandard = JSON.parse(await readFile(standardReceiptPath, "utf8"));
  assert.equal(savedStandard.persisted_standard_canonical_naming, true);
  assert.equal(JSON.stringify(savedStandard).includes(standardTitle), false);

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

console.log("production parity and standard persisted readback: ok");
