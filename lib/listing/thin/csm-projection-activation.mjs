import { createHash } from "node:crypto";

import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "./canonical-naming-adapter.mjs";
import {
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2
} from "./csm-persistence.mjs";
import {
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  externalIdentityReplayReleaseForReceipt
} from "../knowledge/csm-external-identity-support.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT,
  verifiedOriginalObservationComposerContractForReceipt
} from "./verified-original-observation-support.mjs";
import { isCapturedE1aeReplayTuple } from "./csm-replay.mjs";

export const CSM_PROJECTION_STATE_DORMANT = "DORMANT_FORWARD_READER_BRIDGE";
export const CSM_PROJECTION_STATE_ACTIVE = "ACTIVE_V3_VERIFIED_OVERLAY";
export const CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID =
  "captured-production-e1ae-v1";
// The activation child changes this one selection. Every executable writer
// axis lives in the selected closed value below, so a partial rollback cannot
// silently pair an old durable tuple with a newer provider or Composer.
export const ACTIVE_WRITER_CONTRACT_ID =
  CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function standardReaderDescriptor(contract) {
  return {
    composer_version: contract.composer_version,
    marketplace_profile_version: contract.marketplace_profile_version,
    release_contract_schema_version: contract.schema_version,
    profile_id: contract.profile_id,
    profile_version: contract.profile_version
  };
}

const ACTIVE_EXTERNAL_IDENTITY_WRITER = deepFreeze({
  registry_release_id: "registry_thin_external_identity_high_risers_v2",
  resolution_contract_sha256:
    "407f69668256c799b0beeae8bd9dbdbe3073f86b6f6367c8216417973d6b691f",
  resolver_version: "thin-path-exact-external-identity-v3",
  conflict_policy_version: "verified-original-set-four-anchor-release-correction-v3",
  composer_version: "thin-marketplace-composer-v4-verified-external-identity",
  marketplace_profile_version: "ebay-verified-external-identity-v2"
});
if (stableJson(ACTIVE_EXTERNAL_IDENTITY_WRITER) !== stableJson({
  registry_release_id: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.registry_release_id,
  resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
  resolver_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.resolver_version,
  conflict_policy_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.conflict_policy_version,
  composer_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.composer_version,
  marketplace_profile_version:
    EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.marketplace_profile_version
})) {
  throw new Error("captured_external_identity_writer_contract_mismatch");
}

export const CSM_WRITER_PROJECTION_CONTRACTS = deepFreeze({
  rollback_compatible: {
    contract_id: CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID,
    canonical_fields: {
      semantic_prompt_version: "csm-canonical-fields-v1",
      request_builder_version: "canonical-fields-request-v1",
      response_parser_version: "canonical-output-v2-strict-observed-or-null",
      parser_semantics: "CAPTURED_E1AE_V1",
      finish_admission_semantics: "CAPTURED_E1AE_V1"
    },
    durable_projection_contract_version: CSM_STAGE_LEGACY_CONTRACT_VERSION,
    web_search_tools_enabled: false,
    reconcile_set_card_name_relations: false,
    durable_founder_beta_web_receipt: false,
    durable_set_card_name_relation_receipt: false,
    public_durable_projection_receipts: false,
    owner_optional_receipt_policy: "OMIT",
    accuracy_loss_ledger_semantics: "CAPTURED_E1AE_V1",
    pipeline_fingerprint_semantics: "CAPTURED_E1AE_V1",
    provider_dispatch: {
      retry_policy: "CAPTURED_E1AE_GENERIC_TRANSIENT_V1",
      maximum_attempts: 3,
      durable_transport_retry_receipt: false
    },
    composition_features: {
      publication_coverage: false,
      durable_lot_terminal_shared_only: false,
      enforce_global_mandatory_subject: false
    },
    resolution_view_projector: "E1AE_STANDARD_V02",
    standard: {
      composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
      marketplace_profile_version:
        CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
    },
    verified_original_observation_overlay:
      VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID,
    external_identity: ACTIVE_EXTERNAL_IDENTITY_WRITER
  },
  future_v3: {
    contract_id: "stage-v3-web-v2-writer-v1",
    canonical_fields: {
      semantic_prompt_version: "csm-canonical-fields-web-v2",
      request_builder_version: "canonical-fields-web-request-v2",
      response_parser_version: "canonical-output-v5-web-receipt-outcome",
      parser_semantics: "WEB_V2",
      finish_admission_semantics: "CURRENT"
    },
    durable_projection_contract_version: CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
    web_search_tools_enabled: true,
    reconcile_set_card_name_relations: true,
    durable_founder_beta_web_receipt: true,
    durable_set_card_name_relation_receipt: true,
    public_durable_projection_receipts: true,
    owner_optional_receipt_policy: "SEAL",
    accuracy_loss_ledger_semantics: "CURRENT",
    pipeline_fingerprint_semantics: "CURRENT",
    provider_dispatch: {
      retry_policy: "DEFINITIVE_502_ONLY_V1",
      maximum_attempts: 2,
      durable_transport_retry_receipt: true
    },
    composition_features: {
      publication_coverage: true,
      durable_lot_terminal_shared_only: true,
      enforce_global_mandatory_subject: true
    },
    resolution_view_projector: "CURRENT_STANDARD_V03",
    standard: {
      composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V3.composer_version,
      marketplace_profile_version:
        CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version
    },
    verified_original_observation_overlay: VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
    external_identity: ACTIVE_EXTERNAL_IDENTITY_WRITER
  }
});

function storedWriterContractError(detail) {
  return Object.assign(new TypeError("csm_stored_writer_contract_invalid"), {
    code: "csm_stored_writer_contract_invalid",
    detail
  });
}

// Select persistence semantics from the immutable prepared packet, never from
// today's active writer and never from a caller override. Checkpoint recovery
// can legitimately outlive an activation; its already-paid result must retain
// the pipeline fingerprint and owner receipt shape of the contract it proves.
export function writerProjectionContractForPreparedResult(result, {
  historicalReplay = false
} = {}) {
  const output = result?.csm_rows?.output;
  const resolution = result?.csm_rows?.resolution;
  const structured = output?.structured_output;
  let matches = Object.values(CSM_WRITER_PROJECTION_CONTRACTS).filter((writer) => (
    result?.prompt_version === writer.canonical_fields.semantic_prompt_version
      && result?.request_builder_version === writer.canonical_fields.request_builder_version
      && result?.response_parser_version === writer.canonical_fields.response_parser_version
      && output?.contract_version === writer.durable_projection_contract_version
  ));
  const legacyCheckpointVersion = result?.csm_persistence_checkpoint?.schema_version;
  const capturedLegacyCheckpoint = historicalReplay
    && result?.prompt_version === "csm-canonical-fields-v1"
    && result?.request_builder_version == null
    && result?.response_parser_version == null
    && output?.contract_version === CSM_STAGE_LEGACY_CONTRACT_VERSION
    && output?.marketplace_profile_version === EBAY_PROFILE_VERSION
    && ((legacyCheckpointVersion === "csm-persistence-checkpoint-v1"
        && output?.composer_version === THIN_COMPOSER_VERSION_V1)
      || (legacyCheckpointVersion === "csm-persistence-checkpoint-v2"
        && output?.composer_version === THIN_COMPOSER_VERSION_V2))
    && isCapturedE1aeReplayTuple(output, resolution);
  if (matches.length === 0 && capturedLegacyCheckpoint) {
    matches = [CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible];
  }
  if (matches.length !== 1) {
    throw storedWriterContractError("writer_contract_binding_invalid");
  }
  const writer = matches[0];
  const capturedReplayTuple = isCapturedE1aeReplayTuple(output, resolution);
  if ((output?.contract_version === CSM_STAGE_LEGACY_CONTRACT_VERSION
      || resolution?.contract_version === CSM_STAGE_LEGACY_CONTRACT_VERSION)
      && !capturedReplayTuple) {
    throw storedWriterContractError("writer_contract_stored_replay_tuple_invalid");
  }
  const capturedStoredReplay = historicalReplay && capturedReplayTuple;
  const external = structured?.external_identity_support;
  const verified = structured?.verified_original_observation_support;
  const expectedResolutionGrammar = structured?.composition_grammar === "tcg"
    ? "TCG" : ["standard", "lot"].includes(structured?.composition_grammar)
      ? "NON_TCG" : null;
  if (!expectedResolutionGrammar || resolution?.grammar !== expectedResolutionGrammar) {
    throw storedWriterContractError("writer_contract_resolution_grammar_mismatch");
  }
  if (external != null && verified != null) {
    throw storedWriterContractError("writer_contract_resolution_overlap");
  }
  let expectedComposer;
  if (external != null) {
    const release = externalIdentityReplayReleaseForReceipt(external);
    expectedComposer = release?.output;
    if (!release
        || Object.entries(release.receipt).some(([field, value]) => external[field] !== value)
        || (!capturedStoredReplay && (
          release.receipt.registry_release_id !== writer.external_identity.registry_release_id
            || release.receipt.resolution_contract_sha256
              !== writer.external_identity.resolution_contract_sha256
        ))
        || resolution?.resolver_version !== release.resolution.resolver_version
        || resolution?.conflict_policy_version !== release.resolution.conflict_policy_version) {
      throw storedWriterContractError("writer_contract_external_identity_mismatch");
    }
  } else if (verified != null) {
    expectedComposer = verifiedOriginalObservationComposerContractForReceipt(verified);
    if (!expectedComposer || (!capturedStoredReplay
      && verified.release_id !== writer.verified_original_observation_overlay)) {
      throw storedWriterContractError("writer_contract_verified_original_mismatch");
    }
  } else if (capturedStoredReplay) {
    expectedComposer = {
      composer_version: output?.composer_version,
      marketplace_profile_version: output?.marketplace_profile_version
    };
  } else if (structured?.composition_grammar === "standard") {
    expectedComposer = writer.standard;
  } else if (["tcg", "lot"].includes(structured?.composition_grammar)) {
    expectedComposer = {
      composer_version: THIN_COMPOSER_VERSION_V2,
      marketplace_profile_version: EBAY_PROFILE_VERSION
    };
  }
  if (!expectedComposer
      || output?.composer_version !== expectedComposer.composer_version
      || output?.marketplace_profile_version !== expectedComposer.marketplace_profile_version) {
    throw storedWriterContractError("writer_contract_composer_mismatch");
  }
  const futureReceipts = [
    structured?.publication_coverage,
    structured?.founder_beta_web_receipt,
    structured?.set_card_name_relation_receipt
  ];
  if (writer.durable_founder_beta_web_receipt) {
    if (futureReceipts.some((receipt) => receipt == null)) {
      throw storedWriterContractError("writer_contract_durable_receipt_missing");
    }
  } else if (futureReceipts.some((receipt) => receipt != null)
      || structured?.lot_terminal != null) {
    throw storedWriterContractError("writer_contract_durable_receipt_unexpected");
  }
  return writer;
}

const ACTIVATION_BODY = {
  schema_version: "csm-projection-activation.v2",
  activation_id: "writer-old-reader-new-v1",
  active_writer: Object.values(CSM_WRITER_PROJECTION_CONTRACTS).find(
    ({ contract_id: contractId }) => contractId === ACTIVE_WRITER_CONTRACT_ID
  ),
  forward_readers: {
    durable_projection_contract_versions: [
      CSM_STAGE_LEGACY_CONTRACT_VERSION,
      CSM_DURABLE_PROJECTION_CONTRACT_VERSION
    ],
    founder_beta_web_receipt_schema_versions: [
      "founder-beta-web-receipt-v1",
      "founder-beta-web-receipt-v2"
    ],
    standard: [
      standardReaderDescriptor(CANONICAL_NAMING_RELEASE_CONTRACT_V1),
      standardReaderDescriptor(CANONICAL_NAMING_RELEASE_CONTRACT_V2),
      standardReaderDescriptor(CANONICAL_NAMING_RELEASE_CONTRACT_V3)
    ],
    verified_original_observation_overlay: {
      replay_registry_schema_version:
        VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.schema_version,
      release_ids: Object.keys(
        VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases
      ).sort(),
      resolution_contract_schema_version:
        VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.schema_version,
      resolution_contract_sha256:
        VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
      resolver_version: VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.resolver_version,
      conflict_policy_version:
        VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.conflict_policy_version
    },
    external_identity: {
      registry_release_ids: Object.keys(
        EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
      ).sort()
    }
  }
};

export function validateCsmWriterProjectionContract(value) {
  const writerJson = stableJson(value);
  const rollback = writerJson
    === stableJson(CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible);
  const future = writerJson === stableJson(CSM_WRITER_PROJECTION_CONTRACTS.future_v3);
  if (rollback === future) {
    throw Object.assign(new TypeError("csm_projection_activation_atomicity_invalid"), {
      code: "csm_projection_activation_atomicity_invalid"
    });
  }
  const writer = rollback
    ? CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible
    : CSM_WRITER_PROJECTION_CONTRACTS.future_v3;
  return writer;
}

export function validateCsmProjectionActivation(value) {
  const writer = validateCsmWriterProjectionContract(value?.active_writer);
  return Object.freeze({
    state: writer.contract_id === CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID
      ? CSM_PROJECTION_STATE_DORMANT : CSM_PROJECTION_STATE_ACTIVE,
    ...writer
  });
}

validateCsmProjectionActivation(ACTIVATION_BODY);

export const CSM_PROJECTION_ACTIVATION = deepFreeze({
  ...ACTIVATION_BODY,
  activation_sha256: createHash("sha256").update(stableJson(ACTIVATION_BODY)).digest("hex")
});

export function activeStandardWriterProjection() {
  return validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION).standard;
}

export function activeWriterProjectionContract() {
  validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION);
  return CSM_PROJECTION_ACTIVATION.active_writer;
}

export function activeVerifiedOriginalObservationReleaseId() {
  return validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION)
    .verified_original_observation_overlay;
}
