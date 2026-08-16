// LOT checkpoint regression: the tcg-grammar-context checkpoint (global v4
// projection) is built for every case, but a LOT is outside the
// standard-to-tcg joint claim namespace. The claim-receipt/observed-fields
// binding must not run on real lot output (regression: the LOT_SHARED_ONLY
// acceptance case failed the persistence checkpoint with
// tcg_grammar_context_observed_fields_mismatch on real lot output).
//
// This file deliberately lives OUTSIDE the activation core freeze
// (scripts/csm-direct-api.test.mjs is a frozen activation contract path), so
// adding regression coverage here cannot cascade into the release pin chain.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildCsmPersistenceCheckpoint,
  validateCsmPersistenceCheckpoint
} from "../api/csm-listing-title.js";
import {
  CANONICAL_FIELDS_PARSER_SEMANTICS,
  parseCanonicalFields
} from "../lib/listing/thin/canonical-fields.mjs";
import { buildCsmModelExecutionContract, csmExecutionContractImageUrls, sha256ExecutionContractValue } from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE } from "../lib/listing/thin/csm-recognition-transport.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes,
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_WRITER_PROJECTION_CONTRACTS
} from "../lib/listing/thin/csm-projection-activation.mjs";
import { composeLyncaStandardNameForProfile } from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3,
  resolveExternalIdentitySupportForRelease
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import {
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import { resolveVerifiedOriginalObservation } from "../lib/listing/thin/verified-original-observation-support.mjs";
import { VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID } from "../lib/listing/thin/verified-original-observation-support.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import { COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3 } from "../lib/listing/thin/verified-original-observation-support.mjs";
import { deterministicProviderClientRequestId } from "../api/csm-listing-title.js";
import { finishCanonicalFields } from "../lib/listing/thin/thin-listing-path.mjs";
import { buildAccuracyLossLedger } from "../lib/listing/thin/accuracy-loss-ledger.mjs";

const futureTcgGrammarContextV4Projection = {
  ...structuredClone(CSM_PROJECTION_ACTIVATION),
  active_writer: structuredClone(
    CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4
  )
};

function tcgGrammarContextCheckpointFixture({
  tenantId = "tenant-1",
  recognitionSessionId = "session-tcg-grammar-context-v4",
  set = "Trainer Gallery",
  cardNumber = "TG22/TG30",
  grammar = "standard",
  operationKey = "csm-tcg-grammar-context-v4",
  payloadHash = "6".repeat(64),
  originalImageFingerprints = [`sha256:${"a".repeat(64)}`],
  recognitionImageFingerprints = originalImageFingerprints,
  verifiedOriginalImageSha256 = null,
  providerAttemptNumber = 1,
  providerResponseId = "resp-tcg-grammar-context-v4",
  providerClientRequestId = null,
  subject = "Eternatus"
} = {}) {
  const writer = CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4;
  const boundProviderClientRequestId = providerClientRequestId
    || deterministicProviderClientRequestId({
      operationKey,
      payloadHash,
      attempt: providerAttemptNumber
    });
  const raw = {
    year: "", ip: "", language: "", manufacturer: "", product: "",
    set, subjects: [subject], team: "", card_name: "",
    release_variant: "", surface_color: "", parallel_family: "",
    parallel_exact: "", descriptive_rarity: "", card_number: cardNumber,
    serial: "", attributes: [], grading_info: null, grammar, lot_count: "",
    unreadable: [], low_confidence: [], special_stamp: "", description: ""
  };
  const rawProviderOutput = JSON.stringify(raw);
  const founderBetaWebReceipt = {
    schema_version: "founder-beta-web-receipt-v2",
    outcome: "NOT_USED",
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: "gpt-5.6-luna",
    reasoning_effort: "low",
    web_search_used: false,
    web_search_call_count: 0,
    queries: [],
    urls: [],
    field_evidence: [],
    semantic_state_sha256: createHash("sha256").update(rawProviderOutput).digest("hex")
  };
  const tcgFieldSourceAuthorityReceipt = buildTcgFieldSourceAuthorityReceipt({
    fieldSources: [
      { field: "set", source_ids: ["original_image_1"] },
      { field: "card_number", source_ids: ["original_image_1"] }
    ],
    fields: raw,
    originalImageCount: originalImageFingerprints.length,
    semanticStateSha256: founderBetaWebReceipt.semantic_state_sha256,
    founderBetaWebReceipt,
    sourceExecution: {
      operationPayloadSha256: payloadHash,
      originalImageFingerprints,
      recognitionImageFingerprints,
      providerClientRequestId: boundProviderClientRequestId,
      providerResponseId,
      tenantId,
      recognitionSessionId
    }
  });
  const tcgGrammarContextClaimReceipt = buildTcgGrammarContextClaimReceipt({
    fields: raw,
    fieldSourceAuthorityReceipt: tcgFieldSourceAuthorityReceipt
  });
  const parsed = parseCanonicalFields(raw, {
    semantics: CANONICAL_FIELDS_PARSER_SEMANTICS.WEB_V3_TCG_CONTEXT,
    tcgFieldSourceAuthorityReceipt,
    tcgGrammarContextClaimReceipt
  });
  const externalIdentityContext = verifiedOriginalImageSha256 == null
    ? null : { originalImageSha256: verifiedOriginalImageSha256 };
  const verifiedResolution = tcgGrammarContextClaimReceipt.status === "APPLIED"
    || externalIdentityContext == null
    ? null
    : resolveVerifiedOriginalObservation(parsed.fields, externalIdentityContext, {
        releaseId: writer.verified_original_observation_overlay
      });
  const resolvedFields = verifiedResolution?.fields || parsed.fields;
  const finished = finishCanonicalFields(resolvedFields, { writerContract: writer });
  const setCardNameRelationReceipt = {
    schema_version: "set-card-name-relations-v1",
    set: resolvedFields.set ? {
      predicate: "CURRENT_CARD_MEMBER_OF_SET",
      value: resolvedFields.set
    } : null,
    card_name: null
  };
  const externalResolution = tcgGrammarContextClaimReceipt.status === "APPLIED"
    ? null
    : resolveExternalIdentitySupportForRelease(resolvedFields, {
        registryReleaseId: writer.external_identity.registry_release_id,
        externalIdentityContext
      });
  const resolutionContract = tcgGrammarContextClaimReceipt.status === "APPLIED"
    ? TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT
    : verifiedResolution
      ? COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3
      : EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3;
  const rows = buildCsmStageRows({
    tenantId,
    recognitionSessionId,
    fields: resolvedFields,
    observedFields: parsed.observed_fields,
    externalIdentitySupport: externalResolution?.receipt,
    verifiedOriginalObservationSupport: verifiedResolution?.receipt,
    composed: {
      grammar: finished.grammar,
      brackets: finished.brackets,
      bracket_text: finished.bracket_text,
      dropped: finished.dropped_brackets,
      suppressed: finished.suppressed_brackets,
      restored: finished.restored_brackets,
      truncated: finished.truncated,
      input_empty_fields: finished.input_empty_fields,
      normalization_reasons: finished.normalization_reasons,
      character_budget: finished.character_budget,
      length: finished.length,
      composer_version: finished.composer_version,
      marketplace_profile_version: finished.marketplace_profile_version,
      canonical_naming_trace: finished.canonical_naming_trace,
      canonical_naming_publishable: finished.canonical_naming_publishable,
      publication_coverage: finished.publication_coverage,
      lot_quantity_unresolved: finished.lot_quantity_unresolved,
      lot_single_card: finished.lot_single_card,
      lot_unshared_attributes: finished.lot_unshared_attributes,
      lot_publishable: finished.lot_publishable,
      lot_publication_failure_code: finished.lot_publication_failure_code
    },
    founderBetaWebReceipt,
    setCardNameRelationReceipt,
    tcgFieldSourceAuthorityReceipt,
    tcgGrammarContextClaimReceipt,
    ...(tcgGrammarContextClaimReceipt.status === "APPLIED" ? {
      registryReleaseId: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id
    } : {}),
    contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
    title: finished.title
  });
  const executionContract = buildCsmModelExecutionContract({
    model: CSM_THIN_RUNTIME_CONTRACT.model,
    requestedEffort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    imageDetail: "high",
    semanticPromptVersion: writer.canonical_fields.semantic_prompt_version,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(1),
    writerContract: writer
  });
  const result = {
    ...finished,
    fields: resolvedFields,
    observed_fields: parsed.observed_fields,
    raw_provider_output: rawProviderOutput,
    founder_beta_web_receipt: founderBetaWebReceipt,
    set_card_name_relation_receipt: setCardNameRelationReceipt,
    tcg_field_source_authority_receipt: tcgFieldSourceAuthorityReceipt,
    tcg_grammar_context_claim_receipt: tcgGrammarContextClaimReceipt,
    ...(externalResolution ? { external_identity_support: externalResolution.receipt } : {}),
    ...(verifiedResolution ? {
      verified_original_observation_support: verifiedResolution.receipt
    } : {}),
    resolution_contract_sha256: resolutionContract.contract_sha256,
    resolution_contract: resolutionContract,
    execution_contract_sha256: sha256ExecutionContractValue(executionContract),
    execution_contract: executionContract,
    prompt_version: writer.canonical_fields.semantic_prompt_version,
    request_builder_version: writer.canonical_fields.request_builder_version,
    response_parser_version: writer.canonical_fields.response_parser_version,
    provider_attempt_number: providerAttemptNumber,
    provider_retry_count: Math.max(0, providerAttemptNumber - 1),
    provider_client_request_id: boundProviderClientRequestId,
    provider_response_id: providerResponseId,
    csm_rows: rows
  };
  result.accuracy_loss_ledger = buildAccuracyLossLedger({
    rawProviderOutput,
    result,
    semantics: writer.accuracy_loss_ledger_semantics
  });
  return result;
}

const lotFixture = tcgGrammarContextCheckpointFixture({
  recognitionSessionId: "session-tcg-grammar-context-v4-lot",
  grammar: "lot",
  set: "2023 Prizm Draft Picks",
  cardNumber: "DP-1",
  operationKey: "csm-tcg-grammar-context-v4-lot",
  payloadHash: "9".repeat(64),
  providerResponseId: "resp-tcg-grammar-context-v4-lot"
});
const lotArgs = {
  tenantId: "tenant-1",
  operationKey: "csm-tcg-grammar-context-v4-lot",
  payloadHash: "9".repeat(64),
  recognitionSessionId: "session-tcg-grammar-context-v4-lot",
  executionContractSha256: lotFixture.execution_contract_sha256,
  resolutionContractSha256: lotFixture.resolution_contract_sha256,
  originalImageFingerprints: [`sha256:${"a".repeat(64)}`],
  recognitionImageFingerprints: [`sha256:${"a".repeat(64)}`]
};
const lotCheckpoint = buildCsmPersistenceCheckpoint({
  prepared: lotFixture,
  tenantId: lotArgs.tenantId,
  operationKey: lotArgs.operationKey,
  payloadHash: lotArgs.payloadHash,
  recognitionSessionId: lotArgs.recognitionSessionId,
  executionContractSha256: lotArgs.executionContractSha256,
  resolutionContractSha256: lotArgs.resolutionContractSha256,
  originalImageFingerprints: lotArgs.originalImageFingerprints,
  recognitionImageFingerprints: lotArgs.recognitionImageFingerprints,
  projectionActivation: futureTcgGrammarContextV4Projection
});
assert.equal(validateCsmPersistenceCheckpoint(lotCheckpoint, lotArgs).title,
  lotFixture.title,
"a lot checkpoint must validate end to end");
const lotObservedSplice = structuredClone(lotCheckpoint);
lotObservedSplice.tcg_grammar_context_claim_receipt.normalized_set =
  "Spliced Set Name";
lotObservedSplice.csm_rows.output.structured_output
  .tcg_grammar_context_claim_receipt.normalized_set = "Spliced Set Name";
lotObservedSplice.csm_persistence_checkpoint.tcg_grammar_context_claim_receipt
  .normalized_set = "Spliced Set Name";
lotObservedSplice.csm_rows.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(lotObservedSplice.csm_rows).csm_recognition_packet_sha256;
lotObservedSplice.csm_rows.output.resolution_packet_sha256 =
  computeCsmPacketHashes(lotObservedSplice.csm_rows).csm_resolution_packet_sha256;
lotObservedSplice.csm_rows.session_hashes =
  computeCsmPacketHashes(lotObservedSplice.csm_rows);
lotObservedSplice.csm_persistence_checkpoint.packet_hashes =
  lotObservedSplice.csm_rows.session_hashes;
assert.equal(
  validateCsmPersistenceCheckpoint(lotObservedSplice, lotArgs).title,
  lotFixture.title,
"a lot observed-field/claim-receipt divergence must not fail the checkpoint");
console.log("LOT checkpoint regression tests passed");
