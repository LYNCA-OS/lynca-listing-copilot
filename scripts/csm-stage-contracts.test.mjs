import assert from "node:assert/strict";
import {
  CSM_STAGE_CONTRACT_VERSION,
  CsmStageContractError,
  assertMarketplacePacket,
  assertRecognitionPacket,
  assertResolutionPacket,
  csmEmpty,
  csmGrammar,
  csmValue
} from "../lib/listing/csm/contracts/csm-stage-contracts.mjs";
import { semCanonicalEditableFields } from "../lib/listing/csm/sem-definition.mjs";

const registryHash = "a".repeat(64);
const envelope = {
  contract_version: CSM_STAGE_CONTRACT_VERSION,
  run_id: "run_1",
  registry_version: "registry-v1",
  registry_content_sha256: registryHash,
  recognition_pipeline_fingerprint: "f".repeat(64),
  grammar: csmGrammar.NON_TCG
};

const recognition = {
  ...envelope,
  packet_type: "RECOGNITION_PACKET",
  recognition_version: "recognition-v1",
  provider_version: "gpt-5-mini-2026-07",
  prompt_version: "observation-v1",
  ocr_provider_version: "google-vision-v1",
  ocr_model_version: "document-text-v1",
  image_preprocess_version: "preprocess-v1",
  crop_policy_version: "crop-v1",
  evidence_schema_version: "evidence-v1",
  normalization_version: "normalization-v1",
  candidate_schema_version: "candidate-v1",
  grammar_confidence: 0.99,
  evidence: [{
    id: "evidence_year_1",
    bracket: "year",
    raw_value: "2024",
    normalized_value: "2024",
    modality: "CARD_TEXT_OCR",
    source_ref: { image_side: "BACK", object_sha256: "b".repeat(64) },
    confidence: 0.96,
    normalization: { version: "normalization-v1", outcome: "KEPT", reason_code: "YEAR_EXACT" }
  }],
  candidates: [{
    id: "candidate_year_1",
    bracket: "year",
    value: csmValue("2024"),
    supporting_evidence_ids: ["evidence_year_1"],
    contradicting_evidence_ids: [],
    source_trust: "CARD_TEXT",
    confidence: 0.96
  }]
};

assert.equal(assertRecognitionPacket(recognition), recognition);
assert.equal(assertRecognitionPacket({ ...recognition, grammar: csmGrammar.TCG }).grammar, "TCG");
assert.throws(
  () => assertRecognitionPacket({ ...recognition, grammar: "UNKNOWN" }),
  (error) => error instanceof CsmStageContractError && error.code === "INVALID_GRAMMAR"
);
assert.throws(
  () => assertRecognitionPacket({
    ...recognition,
    candidates: [{ ...recognition.candidates[0], supporting_evidence_ids: ["missing"] }]
  }),
  (error) => error instanceof CsmStageContractError && error.code === "UNKNOWN_EVIDENCE_REFERENCE"
);

const resolution = {
  ...envelope,
  packet_type: "RESOLUTION_PACKET",
  resolver_version: "resolver-v1",
  conflict_policy_version: "csm-conflict-v1",
  recognition_packet_sha256: "c".repeat(64),
  fields: {
    ...Object.fromEntries(semCanonicalEditableFields.map((bracket) => [bracket, {
      selected: csmEmpty(),
      selected_candidate_id: null,
      alternate_candidate_ids: [],
      rationale_codes: ["INSUFFICIENT_EVIDENCE"],
      confidence: 0.99
    }])),
    year: {
      selected: csmValue("2024"),
      selected_candidate_id: "candidate_year_1",
      alternate_candidate_ids: [],
      rationale_codes: ["SUPPORTED_BY_CARD_TEXT"],
      confidence: 0.96
    },
    product: {
      selected: csmEmpty(),
      selected_candidate_id: null,
      alternate_candidate_ids: [],
      rationale_codes: ["INSUFFICIENT_EVIDENCE"],
      confidence: 0.99
    }
  }
};

assert.equal(assertResolutionPacket(resolution), resolution);
const { year: _omittedYear, ...resolutionWithoutYear } = resolution.fields;
assert.throws(
  () => assertResolutionPacket({ ...resolution, fields: resolutionWithoutYear }),
  (error) => error instanceof CsmStageContractError && error.code === "MISSING_RESOLVED_BRACKET"
);
assert.throws(
  () => assertResolutionPacket({ ...resolution, title: "forbidden" }),
  (error) => error instanceof CsmStageContractError && error.code === "RESOLUTION_LAYER_OWNS_CANONICAL_ONLY"
);
assert.throws(
  () => assertResolutionPacket({
    ...resolution,
    fields: {
      ...resolution.fields,
      product: { ...resolution.fields.product, selected_candidate_id: "candidate_product_1" }
    }
  }),
  (error) => error instanceof CsmStageContractError && error.code === "EMPTY_CANNOT_SELECT_CANDIDATE"
);

const marketplace = {
  ...envelope,
  packet_type: "MARKETPLACE_PACKET",
  resolution_revision_id: "resolution_1",
  resolution_packet_sha256: "d".repeat(64),
  composer_version: "composer-v1",
  marketplace_profile_version: "ebay-en-80-v1",
  marketplace: "EBAY",
  title: "2024 Example Card",
  structured_output: { year: "2024", product: null },
  included_brackets: ["year"],
  dropped: [{ bracket: "product", reason_code: "EMPTY" }]
};

assert.equal(assertMarketplacePacket(marketplace), marketplace);
assert.throws(
  () => assertMarketplacePacket({ ...marketplace, provider_response: {} }),
  (error) => error instanceof CsmStageContractError
    && error.code === "MARKETPLACE_LAYER_CANNOT_READ_UPSTREAM_RAW_DATA"
);
assert.throws(
  () => assertMarketplacePacket({ ...marketplace, title: "X".repeat(81) }),
  (error) => error instanceof CsmStageContractError && error.code === "MARKETPLACE_TITLE_TOO_LONG"
);

console.log("csm stage contracts tests passed");
