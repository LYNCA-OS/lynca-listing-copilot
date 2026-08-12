#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION,
  buildCsmPersistenceCheckpoint,
  deterministicCsmSessionId,
  runDirectCsmAsset,
  validateCsmPersistenceCheckpoint
} from "../api/csm-listing-title.js";
import { buildAccuracyLossLedger } from "../lib/listing/thin/accuracy-loss-ledger.mjs";
import {
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK,
  externalIdentityReplayReleaseForReceipt,
  resolveExternalIdentitySupport,
  validateExternalIdentityDecisionObservation,
  validateExternalIdentityFieldDecisions,
  validateExternalIdentitySourceProvenance,
  validatePostObservationResolutionContract
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  verifyReplay
} from "../lib/listing/thin/csm-replay.mjs";
import {
  persistPreparedCanonicalListingPath,
  prepareCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import {
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";

const ORIGINAL_SHA256 = Object.freeze([
  "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
  "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
]);
const ORIGINAL_SET_SHA256 =
  "61ee1d99b10690cf5877e9b5f08b53ba98051a3961d0a9e5c04f9e8e130db159";
const TARGET_TITLE =
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls";
const V1_LONG_TITLE =
  "1996-97 Topps Stadium Club High Risers Michael Jordan Members Only Chicago Bulls";
const TENANT_ID = "tenant-v2-rollback";
const ASSET_ID = "asset-v2-rollback";
const USER_ID = "user-v2-rollback";
const INTENT_ID = "intent-v2-rollback";
const HISTORICAL_PAYLOAD_SHA256 = "b".repeat(64);
const CREATED_AT = "2026-08-10T00:00:00Z";

const v1 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
  .registry_thin_external_identity_high_risers_v1;
const v2 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
  .registry_thin_external_identity_high_risers_v2;

const observedFields = Object.freeze({
  year: "1994-95",
  manufacturer: "Topps",
  product: "Stadium Club",
  set: "Hardwood Heroes",
  subjects: Object.freeze(["Michael Jordan"]),
  team: "Bulls",
  card_name: "",
  release_variant: "",
  surface_color: "",
  parallel_family: "",
  parallel_exact: "",
  descriptive_rarity: "",
  card_number: "HR 14",
  serial: "",
  attributes: Object.freeze([]),
  grade: "",
  grammar: "standard",
  lot_count: "",
  unreadable: Object.freeze([]),
  low_confidence: Object.freeze([])
});
const rawProviderOutput = JSON.stringify(observedFields);

function completedProvider(providerFields = observedFields) {
  return async (request) => {
    const sourceFields = [
      "year", "language", "manufacturer", "product", "set", "subjects", "team",
      "card_name", "release_variant", "surface_color", "parallel_family",
      "parallel_exact", "descriptive_rarity", "card_number", "serial", "attributes",
      "grading_info", "grammar", "lot_count", "special_stamp", "description"
    ];
    const audited = {
      ...providerFields,
      field_sources: sourceFields.filter((field) => {
        const value = providerFields[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
      }).map((field) => ({ field, source_ids: ["original_image_1"] })),
      set_card_name_relations: {
        set: providerFields.set ? "CURRENT_CARD_MEMBER_OF_SET" : "",
        card_name: providerFields.card_name ? "CURRENT_CARD_NAMED_BY_DESIGN" : ""
      }
    };
    return new Response(JSON.stringify({
    id: "resp_v2_historical_fixture",
    model: request.model,
    status: "completed",
    output_text: JSON.stringify(audited),
    reasoning: request.reasoning,
    usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 }
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "req_v2_historical_fixture" }
  });
  };
}

const sourceIdsByField = Object.freeze({
  year: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"]),
  manufacturer: Object.freeze(["beckett.item.3117708"]),
  product: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"]),
  set: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"]),
  subjects: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"]),
  team: Object.freeze(["tcdb.set.2551", "beckett.item.3117708"]),
  card_number: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"])
});
const actionsByField = Object.freeze({
  year: "CORRECT_CONFLICT",
  manufacturer: "CORROBORATE",
  product: "CORROBORATE",
  set: "CORRECT_CONFLICT",
  subjects: "CORROBORATE",
  team: "NORMALIZE_ALIAS",
  card_number: "NORMALIZE_ALIAS"
});

const v2ResolutionContract = Object.freeze({
  schema_version: "csm-post-observation-resolution-contract.v1",
  contract_id: "lynca.csm.post-observation.external-identity.v2",
  support_pack_sha256: v2.receipt.pack_sha256,
  resolver_version: v2.resolution.resolver_version,
  conflict_policy_version: v2.resolution.conflict_policy_version,
  composer_version: v2.output.composer_version,
  marketplace_profile_version: v2.output.marketplace_profile_version,
  registry_release_id: v2.receipt.registry_release_id,
  matching: "exact_unique_four_anchor_or_verified_original_set",
  visible_conflict_policy:
    "verified_original_set_plus_four_anchor_corrects_year_set_else_abstain",
  physical_copy_fields: "immutable",
  provider_calls_added: 0,
  contract_sha256: v2.receipt.resolution_contract_sha256
});
validatePostObservationResolutionContract(v2ResolutionContract, {
  expectedSha256: v2.receipt.resolution_contract_sha256
});

function v2Support(observed, fields, { actions = actionsByField } = {}) {
  return {
    ...v2.receipt,
    status: "APPLIED",
    record_id: "tcdb-2551-hr14",
    match_mode: "VERIFIED_ORIGINAL_SET",
    original_set_sha256: ORIGINAL_SET_SHA256,
    source_ids: EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map((source) => source.source_id),
    sources: EXTERNAL_IDENTITY_SUPPORT_PACK.sources,
    source_field_map: sourceIdsByField,
    supported_fields: Object.keys(sourceIdsByField),
    corrected_fields: ["year", "set"],
    field_decisions: Object.fromEntries(Object.keys(sourceIdsByField).map((field) => [field, {
      action: actions[field],
      observed_value: observed[field],
      canonical_value: fields[field],
      source_ids: sourceIdsByField[field]
    }]))
  };
}

async function baseProviderResult(recognitionSessionId, providerFields = observedFields) {
  return prepareCanonicalListingPath({
    tenantId: TENANT_ID,
    recognitionSessionId,
    imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    externalIdentityContext: { originalImageSha256: ORIGINAL_SHA256 },
    createdAt: CREATED_AT,
    callProvider: completedProvider(providerFields)
  });
}

async function activeV2Prepared(
  recognitionSessionId,
  providerFields = observedFields,
  { actions = actionsByField, expectedTitle = TARGET_TITLE } = {}
) {
  const base = await baseProviderResult(recognitionSessionId, providerFields);
  assert.equal(base.external_identity_support.status, "APPLIED");
  assert.equal(base.external_identity_support.match_mode, "VERIFIED_ORIGINAL_SET");
  const observed = base.observed_fields;
  const fields = base.fields;
  const support = v2Support(observed, fields, { actions });
  assert.equal(validateExternalIdentityFieldDecisions(support), true);
  assert.equal(validateExternalIdentitySourceProvenance(support), true);
  assert.equal(validateExternalIdentityDecisionObservation(support, observed, fields), true);
  const composed = composeCanonicalFieldsForStoredOutput(fields, {
    marketplace: "EBAY",
    ...v2.output,
    contract_version: "csm-stage-shadow-v3"
  });
  assert.equal(composed.title, expectedTitle);
  const csmRows = buildCsmStageRows({
    tenantId: TENANT_ID,
    recognitionSessionId,
    fields,
    observedFields: observed,
    externalIdentitySupport: support,
    composed,
    founderBetaWebReceipt: base.founder_beta_web_receipt,
    setCardNameRelationReceipt: base.set_card_name_relation_receipt,
    title: composed.title,
    registryReleaseId: v2.receipt.registry_release_id,
    createdAt: CREATED_AT
  });
  const result = {
    ...base,
    title: composed.title,
    fields,
    observed_fields: observed,
    grammar: composed.grammar,
    brackets: composed.brackets,
    dropped_brackets: composed.dropped,
    suppressed_brackets: composed.suppressed,
    restored_brackets: composed.restored,
    empty_fields: composed.empty_fields,
    input_empty_fields: composed.input_empty_fields,
    normalization_reasons: composed.normalization_reasons,
    publication_coverage: composed.publication_coverage,
    character_budget: composed.character_budget,
    length: composed.length,
    truncated: composed.truncated,
    external_identity_support: support,
    resolution_contract_sha256: v2.receipt.resolution_contract_sha256,
    resolution_contract: v2ResolutionContract,
    csm_rows: csmRows
  };
  result.accuracy_loss_ledger = buildAccuracyLossLedger({
    rawProviderOutput: JSON.stringify(providerFields),
    result
  });
  return result;
}

function checkpointReceipt() {
  return {
    schema_version: "csm-external-identity-checkpoint-receipt.v1",
    status: "APPLIED",
    request_original_set_sha256: ORIGINAL_SET_SHA256,
    pack_id: v2.receipt.pack_id,
    pack_version: v2.receipt.pack_version,
    pack_sha256: v2.receipt.pack_sha256,
    index_id: v2.receipt.index_id,
    index_version: v2.receipt.index_version,
    index_sha256: v2.receipt.index_sha256,
    registry_release_id: v2.receipt.registry_release_id,
    resolution_contract_sha256: v2.receipt.resolution_contract_sha256,
    match_mode: "VERIFIED_ORIGINAL_SET",
    original_set_sha256: ORIGINAL_SET_SHA256,
    record_id: "tcdb-2551-hr14"
  };
}

function historicalCheckpoint(prepared, { operationKey, payloadHash }) {
  return {
    ...prepared,
    csm_persistence_checkpoint: {
      schema_version: CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION,
      state: "PERSISTENCE_PENDING",
      tenant_id: TENANT_ID,
      operation_key: operationKey,
      payload_sha256: payloadHash,
      recognition_session_id: prepared.csm_rows.resolution.recognition_session_id,
      recognition_session_deferred: false,
      execution_contract_sha256: prepared.execution_contract_sha256,
      external_identity_receipt: checkpointReceipt(),
      packet_hashes: prepared.csm_rows.session_hashes,
      accuracy_loss_ledger_version: prepared.accuracy_loss_ledger.version,
      accuracy_loss_ledger_sha256: prepared.accuracy_loss_ledger.ledger_sha256
    }
  };
}

function canonicalImages() {
  return {
    asset_id: ASSET_ID,
    image_generation_id: ASSET_ID,
    image_set_sha256: "e".repeat(64),
    expected_original_count: 2,
    image_references: ORIGINAL_SHA256.map((contentSha256, index) => ({
      image_id: `original-${index + 1}`,
      image_role: index === 0 ? "front_original" : "back_original",
      bucket: "cards",
      object_path: `${TENANT_ID}/${ASSET_ID}/original-${index + 1}.jpg`,
      content_sha256: contentSha256,
      derived: false
    })),
    images: ORIGINAL_SHA256.map((contentSha256, index) => ({
      image_id: `original-${index + 1}`,
      objectPath: `${TENANT_ID}/${ASSET_ID}/original-${index + 1}.jpg`,
      bucket: "cards",
      size: 1_000 + index,
      storageRole: index === 0 ? "image_1_original" : "image_2_original",
      derived: false,
      content_sha256: contentSha256
    }))
  };
}

// Activation changes only the live descriptor. The append-only reader must
// retain exact v1 title bytes while fresh verified-original-set execution uses
// v2 conflict correction.
assert.equal(EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID, v2.receipt.registry_release_id);
assert.equal(
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.id,
  v2.receipt.registry_release_id
);
const v2Conflict = resolveExternalIdentitySupport(observedFields, {
  externalIdentityContext: { originalImageSha256: ORIGINAL_SHA256 }
});
assert.equal(v2Conflict.status, "APPLIED");
assert.deepEqual(v2Conflict.receipt.corrected_fields, ["set", "year"]);
assert.equal(v2Conflict.fields.year, "1996-97");
assert.equal(v2Conflict.fields.set, "High Risers");
const v1Long = composeCanonicalFieldsForStoredOutput({
  ...observedFields,
  year: "1996-97",
  set: "High Risers",
  team: "Chicago Bulls",
  card_number: "HR14",
  card_name: "Members Only"
}, { marketplace: "EBAY", ...v1.output });
assert.equal(v1Long.title, V1_LONG_TITLE);
assert.equal(v1Long.length, 80);

// Exact action semantics: a visible correction cannot be relabelled FILL;
// canonical facts cannot be self-resealed; and HR 14 is an alias, not an exact
// presentation match.
const validatorPrepared = await activeV2Prepared("session-validator-v2");
const validSupport = validatorPrepared.external_identity_support;
const correctionAsFill = structuredClone(validSupport);
correctionAsFill.field_decisions.year.action = "FILL";
assert.equal(validateExternalIdentityFieldDecisions(correctionAsFill), false);
const allValuesForged = structuredClone(validSupport);
for (const decision of Object.values(allValuesForged.field_decisions)) {
  decision.action = "CORROBORATE";
  decision.observed_value = "forged";
  decision.canonical_value = "forged";
}
assert.equal(validateExternalIdentityFieldDecisions(allValuesForged), false);
assert.equal(validSupport.field_decisions.card_number.action, "NORMALIZE_ALIAS");
const spacedCardAsCorroborate = structuredClone(validSupport);
spacedCardAsCorroborate.field_decisions.card_number.action = "CORROBORATE";
assert.equal(validateExternalIdentityFieldDecisions(spacedCardAsCorroborate), false);
const exactCard = structuredClone(validSupport);
exactCard.field_decisions.card_number.observed_value = "HR14";
exactCard.field_decisions.card_number.action = "CORROBORATE";
assert.equal(validateExternalIdentityFieldDecisions(exactCard), true);
const whitespaceDecisionSource = structuredClone(validSupport);
whitespaceDecisionSource.field_decisions.year.source_ids[0] = " tcdb.set.2551 ";
assert.equal(validateExternalIdentityFieldDecisions(whitespaceDecisionSource), false);
const whitespacePrivateSource = structuredClone(validSupport);
whitespacePrivateSource.sources[0].source_id = " tcdb.set.2551 ";
assert.equal(validateExternalIdentitySourceProvenance(whitespacePrivateSource), false);

// A complete APPLIED v2 packet replays exactly and traverses the real storage
// boundary. The persisted owner versions come from the stored v2 rows, never
// from unversioned current defaults.
assert.deepEqual(verifyReplay(
  validatorPrepared.csm_rows,
  validatorPrepared.title
).problems, []);
let persistedRows = null;
let persistedSessionPatch = null;
const persisted = await persistPreparedCanonicalListingPath({
  tenantId: TENANT_ID,
  recognitionSessionId: "session-validator-v2",
  prepared: validatorPrepared,
  writeRows: async (rows, { sessionPatch }) => {
    persistedRows = rows;
    persistedSessionPatch = sessionPatch;
    return {
      ok: true,
      atomic: true,
      replayed: false,
      skipped: null,
      session: { saved: true }
    };
  }
});
assert.equal(persisted.title, TARGET_TITLE);
assert.deepEqual(persistedRows, validatorPrepared.csm_rows);
assert.equal(persistedSessionPatch.csm_registry_release_id, v2.receipt.registry_release_id);
assert.equal(persistedSessionPatch.csm_owner_versions.resolver, v2.resolution.resolver_version);
assert.equal(persistedSessionPatch.csm_owner_versions.composer, v2.output.composer_version);
assert.equal(
  persistedSessionPatch.csm_owner_versions.marketplace_profile,
  v2.output.marketplace_profile_version
);

// Fresh checkpoints must now bind v2. A self-consistent historical v1 receipt
// remains replay-readable but cannot silently downgrade a new checkpoint.
const freshCheckpoint = buildCsmPersistenceCheckpoint({
  prepared: validatorPrepared,
  tenantId: TENANT_ID,
  operationKey: "operation-fresh-v2-active",
  payloadHash: "a".repeat(64),
  recognitionSessionId: "session-validator-v2",
  executionContractSha256: validatorPrepared.execution_contract_sha256,
  resolutionContractSha256: v2.receipt.resolution_contract_sha256,
  originalSetSha256: ORIGINAL_SET_SHA256
});
assert.equal(
  freshCheckpoint.csm_persistence_checkpoint.external_identity_receipt.registry_release_id,
  v2.receipt.registry_release_id
);
const inactiveV1Support = {
  ...validatorPrepared.external_identity_support,
  ...v1.receipt
};
assert.equal(
  externalIdentityReplayReleaseForReceipt(inactiveV1Support)?.receipt.registry_release_id,
  v1.receipt.registry_release_id
);
assert.throws(() => buildCsmPersistenceCheckpoint({
  prepared: { ...validatorPrepared, external_identity_support: inactiveV1Support },
  tenantId: TENANT_ID,
  operationKey: "operation-fresh-v1-forbidden",
  payloadHash: "a".repeat(64),
  recognitionSessionId: "session-validator-v2",
  executionContractSha256: validatorPrepared.execution_contract_sha256,
  resolutionContractSha256: v2.receipt.resolution_contract_sha256,
  originalSetSha256: ORIGINAL_SET_SHA256
}), (error) => error.code === "csm_persistence_checkpoint_invalid"
  && error.detail === "external_identity_registry_release_not_active");

const checkpoint = historicalCheckpoint(validatorPrepared, {
  operationKey: "operation-historical-v2",
  payloadHash: HISTORICAL_PAYLOAD_SHA256
});
assert.equal(validateCsmPersistenceCheckpoint(checkpoint, {
  tenantId: TENANT_ID,
  operationKey: "operation-historical-v2",
  payloadHash: HISTORICAL_PAYLOAD_SHA256,
  recognitionSessionId: "session-validator-v2",
  executionContractSha256: validatorPrepared.execution_contract_sha256,
  resolutionContractSha256: v2.receipt.resolution_contract_sha256,
  originalSetSha256: ORIGINAL_SET_SHA256
}).title, TARGET_TITLE);

// Self-consistent packet re-sealing cannot launder a changed evidence source.
const sourceTampered = structuredClone(validatorPrepared.csm_rows);
const registryEvidence = sourceTampered.evidence.find((row) => row.modality === "REGISTRY");
registryEvidence.source_ref.sources[0].url =
  "https://www.tcdb.com/arbitrary-but-same-host";
sourceTampered.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(sourceTampered).csm_recognition_packet_sha256;
sourceTampered.output.resolution_packet_sha256 =
  computeCsmPacketHashes(sourceTampered).csm_resolution_packet_sha256;
sourceTampered.session_hashes = computeCsmPacketHashes(sourceTampered);
assert.equal(verifyReplay(sourceTampered, validatorPrepared.title).ok, false);
assert.ok(verifyReplay(sourceTampered, validatorPrepared.title).problems.some((problem) => (
  problem.kind === "external_identity_source_provenance_invalid"
)));

const whitespaceSourceId = structuredClone(validatorPrepared.csm_rows);
const whitespaceRegistryEvidence = whitespaceSourceId.evidence.find((row) => (
  row.modality === "REGISTRY" && row.source_ref.field === "year"
));
whitespaceRegistryEvidence.source_ref.sources[0].source_id = " tcdb.set.2551 ";
whitespaceSourceId.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(whitespaceSourceId).csm_recognition_packet_sha256;
whitespaceSourceId.output.resolution_packet_sha256 =
  computeCsmPacketHashes(whitespaceSourceId).csm_resolution_packet_sha256;
whitespaceSourceId.session_hashes = computeCsmPacketHashes(whitespaceSourceId);
assert.ok(verifyReplay(whitespaceSourceId, validatorPrepared.title).problems.some((problem) => (
  problem.kind === "external_identity_source_provenance_invalid"
    && problem.field === "year"
)));

const registryValueTampered = structuredClone(validatorPrepared.csm_rows);
const yearRegistryValue = registryValueTampered.evidence.find((row) => (
  row.modality === "REGISTRY" && row.source_ref.field === "year"
));
yearRegistryValue.raw_value = "1900";
yearRegistryValue.normalized_value = "1900";
registryValueTampered.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(registryValueTampered).csm_recognition_packet_sha256;
registryValueTampered.output.resolution_packet_sha256 =
  computeCsmPacketHashes(registryValueTampered).csm_resolution_packet_sha256;
registryValueTampered.session_hashes = computeCsmPacketHashes(registryValueTampered);
assert.ok(verifyReplay(registryValueTampered, validatorPrepared.title).problems.some((problem) => (
  problem.kind === "external_identity_registry_value_mismatch" && problem.field === "year"
)), "re-sealing cannot detach Registry evidence values from the frozen decision");

const observedValueTampered = structuredClone(validatorPrepared.csm_rows);
observedValueTampered.output.structured_output.external_identity_support
  .field_decisions.year.observed_value = "1993-94";
observedValueTampered.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(observedValueTampered).csm_recognition_packet_sha256;
observedValueTampered.output.resolution_packet_sha256 =
  computeCsmPacketHashes(observedValueTampered).csm_resolution_packet_sha256;
observedValueTampered.session_hashes = computeCsmPacketHashes(observedValueTampered);
const observedValueProblems = verifyReplay(observedValueTampered, validatorPrepared.title).problems;
assert.ok(observedValueProblems.some((problem) => (
  problem.kind === "external_identity_observed_evidence_mismatch" && problem.field === "year"
)), "a re-sealed decision must stay bound to WHOLE_CARD_VISUAL raw_value");

const duplicateRegistryField = structuredClone(validatorPrepared.csm_rows);
const duplicateYear = structuredClone(duplicateRegistryField.evidence.find((row) => (
  row.modality === "REGISTRY" && row.source_ref.field === "year"
)));
duplicateYear.id = "duplicate-year-registry-evidence";
duplicateRegistryField.evidence.push(duplicateYear);
duplicateRegistryField.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(duplicateRegistryField).csm_recognition_packet_sha256;
duplicateRegistryField.output.resolution_packet_sha256 =
  computeCsmPacketHashes(duplicateRegistryField).csm_resolution_packet_sha256;
duplicateRegistryField.session_hashes = computeCsmPacketHashes(duplicateRegistryField);
assert.ok(verifyReplay(duplicateRegistryField, validatorPrepared.title).problems.some((problem) => (
  problem.kind === "external_identity_field_evidence_cardinality_invalid"
    && problem.field === "year" && problem.count === 2
)));

// `search_optimization` carries presentation components and team together. A
// historical FILL decision with no observed team remains valid when RC is
// present, while an unknown residual token cannot be hidden as a component.
const componentOnlyObserved = Object.freeze({
  ...observedFields,
  team: "",
  attributes: Object.freeze(["RC"])
});
const componentOnlyActions = Object.freeze({
  ...actionsByField,
  team: "FILL"
});
const componentOnlyPrepared = await activeV2Prepared(
  "session-team-component-v2",
  componentOnlyObserved,
  {
    actions: componentOnlyActions,
    expectedTitle: `${TARGET_TITLE} RC`
  }
);
assert.equal(
  componentOnlyPrepared.external_identity_support.field_decisions.team.action,
  "FILL"
);
assert.deepEqual(
  verifyReplay(componentOnlyPrepared.csm_rows, componentOnlyPrepared.title).problems,
  []
);
const extraTeamToken = structuredClone(componentOnlyPrepared.csm_rows);
const searchVisual = extraTeamToken.evidence.find((row) => (
  row.modality === "WHOLE_CARD_VISUAL" && row.bracket === "search_optimization"
));
assert.ok(searchVisual);
searchVisual.raw_value.push("Unknown Team");
searchVisual.normalized_value.push("Unknown Team");
extraTeamToken.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(extraTeamToken).csm_recognition_packet_sha256;
extraTeamToken.output.resolution_packet_sha256 =
  computeCsmPacketHashes(extraTeamToken).csm_resolution_packet_sha256;
extraTeamToken.session_hashes = computeCsmPacketHashes(extraTeamToken);
assert.ok(verifyReplay(extraTeamToken, componentOnlyPrepared.title).problems.some((problem) => (
  problem.kind === "external_identity_observed_evidence_mismatch" && problem.field === "team"
)));

// The production direct route recovers an active-v2 checkpoint by the stable
// operation key and performs zero sign/session/prepare/provider calls. Its
// persistence seam is the real replay-verified storage function above.
let paidBoundaryCalls = 0;
let lookupByKeyCalls = 0;
let atomicWrites = 0;
let durableForRun = null;
const direct = await runDirectCsmAsset({
  tenantId: TENANT_ID,
  userId: USER_ID,
  assetId: ASSET_ID,
  intentId: INTENT_ID,
  resumeOnly: true,
  dependencies: {
    checkReadiness: async () => ({ ready: true }),
    readImages: async () => canonicalImages(),
    signImage: async () => { paidBoundaryCalls += 1; throw new Error("must_not_sign"); },
    createSession: async () => { paidBoundaryCalls += 1; throw new Error("must_not_create_session"); },
    preparePath: async () => { paidBoundaryCalls += 1; throw new Error("must_not_prepare"); },
    providerAdmission: {
      globallyEnforced: true,
      lookupOperationResult: async () => {
        throw Object.assign(new Error("operation_payload_conflict"), {
          code: "operation_payload_conflict",
          statusCode: 409,
          retryable: false,
          provider_attempt_started: false
        });
      },
      lookupOperationResultByKey: async ({ operationKey }) => {
        lookupByKeyCalls += 1;
        const recognitionSessionId = deterministicCsmSessionId(operationKey);
        const prepared = await activeV2Prepared(recognitionSessionId);
        durableForRun = historicalCheckpoint(prepared, {
          operationKey,
          payloadHash: HISTORICAL_PAYLOAD_SHA256
        });
        return {
          status: "found",
          payloadHash: HISTORICAL_PAYLOAD_SHA256,
          result: durableForRun,
          latestAttempt: 1
        };
      },
      enqueueAttempt: async () => { paidBoundaryCalls += 1; },
      runAttempt: async () => { paidBoundaryCalls += 1; }
    },
    persistPath: (args) => persistPreparedCanonicalListingPath({
      ...args,
      writeRows: async (rows, { sessionPatch }) => {
        atomicWrites += 1;
        assert.equal(rows.output.title, TARGET_TITLE);
        assert.equal(sessionPatch.csm_registry_release_id, v2.receipt.registry_release_id);
        return {
          ok: true,
          atomic: true,
          replayed: false,
          skipped: null,
          session: { saved: true }
        };
      }
    })
  }
});
assert.equal(direct.title, TARGET_TITLE);
assert.equal(direct.execution_origin, "HISTORICAL_KEY_RECOVERY");
assert.equal(direct.csm_rows.resolution.resolver_version, v2.resolution.resolver_version);
assert.equal(direct.csm_rows.output.composer_version, v2.output.composer_version);
assert.equal(lookupByKeyCalls, 1);
assert.equal(atomicWrites, 1);
assert.equal(paidBoundaryCalls, 0);
assert.ok(durableForRun);

console.log("external identity rollback bridge: ok");
