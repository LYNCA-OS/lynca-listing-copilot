import { createHash } from "node:crypto";

import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "./canonical-naming-adapter.mjs";
import {
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2
} from "./csm-persistence.mjs";
import {
  TCG_GRAMMAR_CONTEXT_CANONICAL_REQUEST_BUILDER_VERSION,
  TCG_GRAMMAR_CONTEXT_CANONICAL_RESPONSE_PARSER_VERSION
} from "./csm-provider-adapter.mjs";
import {
  TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION,
  TCG_GRAMMAR_CONTEXT_CLAIM_RECEIPT_VERSION,
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT
} from "./tcg-grammar-context-authority.mjs";
import {
  EXTERNAL_IDENTITY_CAPTURED_ROLLBACK_RELEASE_IDS,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3,
  externalIdentityReplayReleaseForReceipt
} from "../knowledge/csm-external-identity-support.mjs";
import {
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3,
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT,
  externalIdentityResolutionContractForPostObservationSha256,
  verifiedOriginalObservationComposerContractForReceipt
} from "./verified-original-observation-support.mjs";
import { isCapturedE1aeReplayTuple } from "./csm-replay.mjs";

export const CSM_PROJECTION_STATE_DORMANT = "DORMANT_FORWARD_READER_BRIDGE";
export const CSM_PROJECTION_STATE_ACTIVE = "ACTIVE_V3_VERIFIED_OVERLAY";
export const CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_STATE_DORMANT =
  "DORMANT_V4_TCG_GRAMMAR_CONTEXT_FORWARD_READER";
export const CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_STATE_ACTIVE =
  "ACTIVE_V4_TCG_GRAMMAR_CONTEXT";
export const CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID =
  "captured-production-e1ae-v1";
// The activation child changes this one selection. Every executable writer
// axis lives in the selected closed value below, so a partial rollback cannot
// silently pair an old durable tuple with a newer provider or Composer.
export const ACTIVE_WRITER_CONTRACT_ID =
  "stage-v4-web-v3-tcg-grammar-context-external-identity-v3-writer-v1";

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

const FORWARD_EXTERNAL_IDENTITY_V3_WRITER = deepFreeze({
  registry_release_id: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.registry_release_id,
  resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.contract_sha256,
  resolver_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.resolver_version,
  conflict_policy_version:
    EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.conflict_policy_version,
  composer_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.composer_version,
  marketplace_profile_version:
    EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.marketplace_profile_version
});

const BASE_CSM_WRITER_PROJECTION_CONTRACTS = deepFreeze({
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

export const CSM_WRITER_PROJECTION_CONTRACTS = deepFreeze({
  ...BASE_CSM_WRITER_PROJECTION_CONTRACTS,
  future_external_identity_v3: {
    ...BASE_CSM_WRITER_PROJECTION_CONTRACTS.future_v3,
    contract_id: "stage-v3-web-v2-external-identity-v3-writer-v1",
    external_identity: FORWARD_EXTERNAL_IDENTITY_V3_WRITER
  },
  future_tcg_grammar_context_v4: {
    ...BASE_CSM_WRITER_PROJECTION_CONTRACTS.future_v3,
    contract_id: "stage-v4-web-v3-tcg-grammar-context-external-identity-v3-writer-v1",
    canonical_fields: {
      ...BASE_CSM_WRITER_PROJECTION_CONTRACTS.future_v3.canonical_fields,
      request_builder_version:
        TCG_GRAMMAR_CONTEXT_CANONICAL_REQUEST_BUILDER_VERSION,
      response_parser_version:
        TCG_GRAMMAR_CONTEXT_CANONICAL_RESPONSE_PARSER_VERSION,
      parser_semantics: "WEB_V3_TCG_CONTEXT"
    },
    durable_projection_contract_version:
      CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
    durable_tcg_grammar_context_receipts: true,
    tcg_grammar_context: {
      registry_release_id: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
      registry_content_sha256: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256,
      resolution_contract_sha256:
        TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.contract_sha256,
      resolver_version: TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.resolver_version,
      conflict_policy_version:
        TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.conflict_policy_version,
      field_source_authority_receipt_schema_version:
        TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION,
      grammar_context_claim_receipt_schema_version:
        TCG_GRAMMAR_CONTEXT_CLAIM_RECEIPT_VERSION
    },
    external_identity: FORWARD_EXTERNAL_IDENTITY_V3_WRITER
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
  if (matches.length > 1) {
    const externalContract =
      externalIdentityResolutionContractForPostObservationSha256(
        result?.resolution_contract_sha256
      );
    matches = externalContract ? matches.filter((writer) => (
      writer.external_identity.registry_release_id
        === externalContract.registry_release_id
        && writer.external_identity.resolution_contract_sha256
          === externalContract.contract_sha256
    )) : [];
  }
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
  const capturedExternalReleaseCompatible = (release) => capturedStoredReplay
    && EXTERNAL_IDENTITY_CAPTURED_ROLLBACK_RELEASE_IDS.includes(
      release?.receipt.registry_release_id
    );
  const preparedExternal = result?.external_identity_support;
  if (preparedExternal != null) {
    const release = externalIdentityReplayReleaseForReceipt(preparedExternal);
    if (!release || (!capturedExternalReleaseCompatible(release) && (
      release.receipt.registry_release_id !== writer.external_identity.registry_release_id
        || release.receipt.resolution_contract_sha256
          !== writer.external_identity.resolution_contract_sha256
    ))) {
      throw storedWriterContractError("writer_contract_external_identity_mismatch");
    }
  }
  const external = structured?.external_identity_support;
  const verified = structured?.verified_original_observation_support;
  const tcgFieldSourceAuthority =
    structured?.tcg_field_source_authority_receipt;
  const tcgGrammarContextClaim =
    structured?.tcg_grammar_context_claim_receipt;
  const expectedResolutionGrammar = structured?.composition_grammar === "tcg"
    ? "TCG" : ["standard", "lot"].includes(structured?.composition_grammar)
      ? "NON_TCG" : null;
  if (!expectedResolutionGrammar || resolution?.grammar !== expectedResolutionGrammar) {
    throw storedWriterContractError("writer_contract_resolution_grammar_mismatch");
  }
  if (external != null && verified != null) {
    throw storedWriterContractError("writer_contract_resolution_overlap");
  }
  const tcgGrammarContextApplied = tcgGrammarContextClaim?.status === "APPLIED";
  if (writer.durable_tcg_grammar_context_receipts === true) {
    if (tcgFieldSourceAuthority == null || tcgGrammarContextClaim == null) {
      throw storedWriterContractError("writer_contract_tcg_grammar_receipt_missing");
    }
    if (tcgGrammarContextApplied && (external != null || verified != null
        || structured?.observed_composition_grammar !== "standard"
        || structured?.composition_grammar !== "tcg"
        || result?.resolution_contract_sha256
          !== TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.contract_sha256
        || resolution?.registry_release_id
          !== TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id
        || resolution?.resolver_version
          !== TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.resolver_version
        || resolution?.conflict_policy_version
          !== TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.conflict_policy_version)) {
      throw storedWriterContractError("writer_contract_tcg_grammar_transition_mismatch");
    }
  } else if (tcgFieldSourceAuthority != null || tcgGrammarContextClaim != null
      || structured?.observed_composition_grammar != null) {
    throw storedWriterContractError("writer_contract_tcg_grammar_receipt_unexpected");
  }
  let expectedComposer;
  if (external != null) {
    const release = externalIdentityReplayReleaseForReceipt(external);
    expectedComposer = release?.output;
    if (!release
        || Object.entries(release.receipt).some(([field, value]) => external[field] !== value)
        || (!capturedExternalReleaseCompatible(release) && (
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

const FUTURE_PENDING_CHECKPOINT_DESCRIPTOR_PAYLOAD = {
  schema_version: "csm-future-pending-checkpoint-reader.v1",
  writer: {
    contract_id:
      CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3.contract_id,
    writer_contract_sha256: createHash("sha256").update(stableJson(
      CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
    )).digest("hex"),
    durable_projection_contract_version:
      CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
        .durable_projection_contract_version,
    semantic_prompt_version:
      CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
        .canonical_fields.semantic_prompt_version,
    request_builder_version:
      CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
        .canonical_fields.request_builder_version,
    response_parser_version:
      CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
        .canonical_fields.response_parser_version,
    verified_original_observation_release_id:
      VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
  },
  external_identity: {
    ...FORWARD_EXTERNAL_IDENTITY_V3_WRITER,
    receipt_schema_version: "csm-external-identity-support-receipt.v3",
    verified_original_hard_anchors: ["manufacturer", "subjects", "card_number"],
    verified_original_public_actions: {
      manufacturer: ["CORROBORATE"],
      subjects: ["CORROBORATE"],
      card_number: ["CORROBORATE", "NORMALIZE_ALIAS"]
    },
    source_provenance_policy:
      "EXACT_RELEASE_SCOPED_SOURCE_SNAPSHOT_FIELD_MAP_AND_DECISION_V1"
  },
  combined_post_observation_resolution_contract: {
    contract_id:
      COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3.contract_id,
    contract_sha256:
      COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3.contract_sha256,
    external_identity_contract_sha256:
      COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3
        .external_identity_contract_sha256,
    verified_original_observation_contract_sha256:
      COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT_EXTERNAL_V3
        .verified_original_observation_contract_sha256
  },
  checkpoint_schema_versions: [
    "csm-persistence-checkpoint-ordinary-execution-v2",
    "csm-persistence-checkpoint-derived-v2",
    "csm-persistence-checkpoint-ordinary-execution-v3",
    "csm-persistence-checkpoint-derived-v3"
  ]
};

export const CSM_FUTURE_PENDING_CHECKPOINT_READER = deepFreeze({
  ...FUTURE_PENDING_CHECKPOINT_DESCRIPTOR_PAYLOAD,
  descriptor_sha256: createHash("sha256")
    .update(stableJson(FUTURE_PENDING_CHECKPOINT_DESCRIPTOR_PAYLOAD)).digest("hex")
});

const TCG_GRAMMAR_CONTEXT_PENDING_CHECKPOINT_DESCRIPTOR_PAYLOAD = {
  schema_version: "csm-tcg-grammar-context-pending-checkpoint-reader.v1",
  writer: {
    contract_id:
      CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4.contract_id,
    writer_contract_sha256: createHash("sha256").update(stableJson(
      CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4
    )).digest("hex"),
    durable_projection_contract_version:
      CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
    semantic_prompt_version:
      CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4
        .canonical_fields.semantic_prompt_version,
    request_builder_version:
      TCG_GRAMMAR_CONTEXT_CANONICAL_REQUEST_BUILDER_VERSION,
    response_parser_version:
      TCG_GRAMMAR_CONTEXT_CANONICAL_RESPONSE_PARSER_VERSION
  },
  grammar_context: {
    registry_release_id: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
    registry_content_sha256: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256,
    resolution_contract_sha256:
      TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.contract_sha256,
    resolver_version: TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.resolver_version,
    conflict_policy_version:
      TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.conflict_policy_version,
    field_source_authority_receipt_schema_version:
      TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION,
    grammar_context_claim_receipt_schema_version:
      TCG_GRAMMAR_CONTEXT_CLAIM_RECEIPT_VERSION
  },
  checkpoint_schema_versions: [
    "csm-persistence-checkpoint-ordinary-execution-v4",
    "csm-persistence-checkpoint-derived-v4"
  ]
};

export const CSM_TCG_GRAMMAR_CONTEXT_PENDING_CHECKPOINT_READER = deepFreeze({
  ...TCG_GRAMMAR_CONTEXT_PENDING_CHECKPOINT_DESCRIPTOR_PAYLOAD,
  descriptor_sha256: createHash("sha256").update(stableJson(
    TCG_GRAMMAR_CONTEXT_PENDING_CHECKPOINT_DESCRIPTOR_PAYLOAD
  )).digest("hex")
});

const ACTIVATION_BODY = {
  schema_version: "csm-projection-activation.v3",
  activation_id: "tcg-grammar-context-forward-reader-bridge-v1",
  active_writer: Object.values(CSM_WRITER_PROJECTION_CONTRACTS).find(
    ({ contract_id: contractId }) => contractId === ACTIVE_WRITER_CONTRACT_ID
  ),
  forward_readers: {
    durable_projection_contract_versions: [
      CSM_STAGE_LEGACY_CONTRACT_VERSION,
      CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
      CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
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
    },
    future_pending_checkpoint: CSM_FUTURE_PENDING_CHECKPOINT_READER,
    tcg_grammar_context_pending_checkpoint:
      CSM_TCG_GRAMMAR_CONTEXT_PENDING_CHECKPOINT_READER
  }
};

export function validateCsmWriterProjectionContract(value) {
  const writerJson = stableJson(value);
  const matches = Object.values(CSM_WRITER_PROJECTION_CONTRACTS).filter((writer) => (
    writerJson === stableJson(writer)
  ));
  if (matches.length !== 1) {
    throw Object.assign(new TypeError("csm_projection_activation_atomicity_invalid"), {
      code: "csm_projection_activation_atomicity_invalid"
    });
  }
  return matches[0];
}

export function validateCsmProjectionActivation(value) {
  if (value?.schema_version !== ACTIVATION_BODY.schema_version
      || value?.activation_id !== ACTIVATION_BODY.activation_id
      || stableJson(value?.forward_readers) !== stableJson(ACTIVATION_BODY.forward_readers)) {
    throw Object.assign(new TypeError("csm_projection_activation_atomicity_invalid"), {
      code: "csm_projection_activation_atomicity_invalid"
    });
  }
  const writer = validateCsmWriterProjectionContract(value?.active_writer);
  return Object.freeze({
    state: writer.contract_id === CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID
      ? CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_STATE_DORMANT
      : writer.contract_id
        === CSM_WRITER_PROJECTION_CONTRACTS.future_tcg_grammar_context_v4.contract_id
        ? CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_STATE_ACTIVE
        : CSM_PROJECTION_STATE_ACTIVE,
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
