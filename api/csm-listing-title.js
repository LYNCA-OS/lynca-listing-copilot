// Direct CSM thin path. No queue, Cloud Run, vector service, OCR sidecar, web
// search, or second model round participates in this request.

import { createHash } from "node:crypto";

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { readJsonPayload, sendJson } from "../lib/http-handler-utils.mjs";
import { instrumentProductionRequest, bindProductionRequestContext, safeClientTiming, safeLatencyStages } from "../lib/observability/production-events.mjs";
import {
  readCanonicalListingImageReferences,
  selectRecognitionImages
} from "../lib/listing/storage/canonical-image-references.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import {
  persistPreparedCanonicalListingPath,
  prepareCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import { validateAccuracyLossLedger } from "../lib/listing/thin/accuracy-loss-ledger.mjs";
import {
  checkCsmProviderAdmissionReadiness,
  createCsmSupabaseProviderAdmissionAuthority,
  validateCsmProviderAuthorityReceipt
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import {
  buildCsmModelExecutionContractSha256,
  csmExecutionContractImageUrls,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_ACTIVE_MODEL_PROFILE,
  CSM_STAGED_TRANSPORT_PROFILE,
  resolveCsmRecognitionTransportReceipt,
  validateCsmModelExecutionContract
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { resolveCsmProviderAdapter } from "../lib/listing/thin/csm-provider-adapter.mjs";
import { createCsmRecognitionSession } from "../lib/listing/thin/csm-session-store.mjs";
import { checkCsmPersistenceReadiness } from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash,
  createLunaDirectDispatcher
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";
import { requireTenantAccess } from "../lib/tenant/access.mjs";
import { publicTenantAuthError } from "../lib/tenant/errors.mjs";
import { TENANT_PERMISSIONS } from "../lib/tenant/permissions.mjs";
import {
  computeVerifiedOriginalSetSha256,
  externalIdentityReplayReleaseForReceipt,
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  validateExternalIdentityDecisionObservation,
  validateExternalIdentityFieldDecisions,
  validateExternalIdentitySourceProvenance,
  validatePostObservationResolutionContract
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  validateCsmProjectionActivation
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  verifyReplay
} from "../lib/listing/thin/csm-replay.mjs";
import {
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT,
  postObservationResolutionContractForVerifiedOriginals,
  validatePostObservationResolutionContractSelection,
  validateVerifiedOriginalObservationReceipt,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  LOT_PUBLICATION_FAILURE,
  validateLotTerminalReceipt
} from "../lib/listing/thin/lot-terminal-contract.mjs";

const MODEL = CSM_THIN_RUNTIME_CONTRACT.model;
const EFFORT = CSM_THIN_RUNTIME_CONTRACT.reasoningEffort;
const activeProviderAdapter = resolveCsmProviderAdapter(CSM_ACTIVE_MODEL_PROFILE.provider);
export const CSM_DIRECT_PROMPT_VERSION = CSM_THIN_RUNTIME_CONTRACT.promptVersion;
export const CSM_DIRECT_ESTIMATED_TOKENS = CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt;
// The Supabase authority owns the absolute 120-slot / 440k-token ceilings and
// the 43-attempt working baseline. The active model profile owns the per-call
// reservation, so a model swap cannot leave scheduler accounting behind. This
// local value is only a process/test fallback; one HTTP request normally
// dispatches one asset.
export const CSM_DIRECT_LOCAL_FALLBACK_CONCURRENCY = CSM_THIN_RUNTIME_CONTRACT.localFallbackConcurrency;
export const CSM_DIRECT_MAX_ATTEMPTS = CSM_THIN_RUNTIME_CONTRACT.maximumAttempts;
// 145s queue wait + 120s provider deadline leaves 35s inside Vercel's 300s
// function budget for storage reads, signing, CSM persistence and response.
export const CSM_DIRECT_CLAIM_POLL_MS = CSM_THIN_RUNTIME_CONTRACT.claimPollMs;
export const CSM_DIRECT_CLAIM_TIMEOUT_MS = CSM_THIN_RUNTIME_CONTRACT.claimTimeoutMs;
export const CSM_DIRECT_PROVIDER_TIMEOUT_MS = CSM_THIN_RUNTIME_CONTRACT.providerTimeoutMs;
export const CSM_PERSISTENCE_CHECKPOINT_VERSION = "csm-persistence-checkpoint-v2";
export const CSM_PERSISTENCE_CHECKPOINT_LEGACY_VERSION = "csm-persistence-checkpoint-v1";
export const CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION =
  "csm-persistence-checkpoint-ordinary-execution-v2";
export const CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION =
  "csm-persistence-checkpoint-derived-v2";
export const CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION =
  "csm-persistence-checkpoint-ordinary-execution-v3";
export const CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION =
  "csm-persistence-checkpoint-derived-v3";
const CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_LEGACY_VERSION =
  "csm-persistence-checkpoint-ordinary-execution-v1";
const CSM_PERSISTENCE_CHECKPOINT_DERIVED_LEGACY_VERSION =
  "csm-persistence-checkpoint-derived-v1";
export const CSM_PERSISTENCE_READINESS_CACHE_TTL_MS = 30_000;
const CSM_PACKET_HASH_KEYS = Object.freeze([
  "csm_recognition_packet_sha256",
  "csm_resolution_packet_sha256",
  "csm_marketplace_packet_sha256"
]);
let csmPersistenceReadinessCache = null;

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw Object.assign(new Error(`missing_${name}`), { statusCode: 400 });
  }
  return text;
}

function normalizedDetail(value) {
  const detail = String(value || "high").trim().toLowerCase();
  if (!["high", "original"].includes(detail)) {
    throw Object.assign(new Error("invalid_image_detail"), { statusCode: 400 });
  }
  return detail;
}

function externalIdentityFromVerifiedOriginals(originals) {
  if (!Array.isArray(originals) || originals.length !== 2) {
    return { context: null, originalSetSha256: null };
  }
  const originalImageSha256 = originals.map((image) => String(
    image?.content_sha256 || image?.contentSha256 || ""
  ).trim().toLowerCase());
  let originalSetSha256;
  try {
    originalSetSha256 = computeVerifiedOriginalSetSha256(originalImageSha256);
  } catch {
    return { context: null, originalSetSha256: null };
  }
  originalImageSha256.sort();
  return {
    context: { originalImageSha256 },
    originalSetSha256
  };
}

export function selectCsmPostObservationResolutionContract({
  originalImageSha256 = null,
  projectionActivation = CSM_PROJECTION_ACTIVATION
} = {}) {
  let projection;
  try {
    projection = validateCsmProjectionActivation(projectionActivation);
  } catch {
    throw Object.assign(new Error("csm_projection_activation_invalid"), {
      code: "csm_projection_activation_invalid",
      statusCode: 409,
      retryable: false
    });
  }
  const context = {
    activeReleaseId: projection.verified_original_observation_overlay,
    originalImageSha256
  };
  const selection = postObservationResolutionContractForVerifiedOriginals(context);
  if (!validatePostObservationResolutionContractSelection(selection, context)) {
    throw Object.assign(new Error("csm_post_observation_resolution_selection_invalid"), {
      code: "csm_post_observation_resolution_selection_invalid",
      statusCode: 409,
      retryable: false
    });
  }
  return Object.freeze(structuredClone(selection));
}

export function deterministicCsmSessionId(operationKey) {
  return `csmsess_${createHash("sha256").update(requiredText(operationKey, "operation_key")).digest("hex").slice(0, 40)}`;
}

function persistenceCheckpointError(detail) {
  return Object.assign(new Error("csm_persistence_checkpoint_invalid"), {
    code: "csm_persistence_checkpoint_invalid",
    statusCode: 409,
    retryable: false,
    detail: String(detail || "invalid")
  });
}

function exactPacketHashes(value) {
  return value && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === CSM_PACKET_HASH_KEYS.length
    && CSM_PACKET_HASH_KEYS.every((name) => /^[0-9a-f]{64}$/.test(String(value[name] || "")));
}

function assertPreparedResultIdentity(result, { tenantId, recognitionSessionId } = {}) {
  const rows = result?.csm_rows;
  if (rows?.resolution?.tenant_id !== tenantId
      || rows?.resolution?.recognition_session_id !== recognitionSessionId
      || rows?.output?.title !== result?.title) {
    throw persistenceCheckpointError("prepared_result_mismatch");
  }
  return rows;
}

function optionalSha256(value, name) {
  if (value == null) return null;
  const digest = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw persistenceCheckpointError(`${name}_invalid`);
  }
  return digest;
}

function normalizedCheckpointRecognitionInput(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw persistenceCheckpointError("recognition_input_invalid");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw persistenceCheckpointError("recognition_input_invalid");
    }
    const expectedRole = index === 0 ? "front_original" : "back_original";
    const read = String(entry.read || "").trim();
    const bytes = Number(entry.bytes);
    const originalBytes = Number(entry.original_bytes);
    const derivedBytes = entry.derived_bytes == null ? null : Number(entry.derived_bytes);
    if (String(entry.image_role || "").trim() !== expectedRole
        || !["original", "readability_derived"].includes(read)
        || !Number.isInteger(bytes) || bytes < 1
        || !Number.isInteger(originalBytes) || originalBytes < 1
        || (derivedBytes !== null && (!Number.isInteger(derivedBytes) || derivedBytes < 1))) {
      throw persistenceCheckpointError("recognition_input_invalid");
    }
    const optional = (name, pattern = null) => {
      const text = String(entry[name] || "").trim();
      if (!text) return {};
      if (pattern && !pattern.test(text)) throw persistenceCheckpointError(`recognition_input_${name}_invalid`);
      return { [name]: text };
    };
    return {
      image_role: expectedRole,
      read,
      bytes,
      original_bytes: originalBytes,
      derived_available: entry.derived_available === true,
      derived_bytes: derivedBytes,
      ...optional("source_image_id"),
      ...optional("transform_version"),
      ...optional("lane_version"),
      ...optional("content_sha256", /^[0-9a-f]{64}$/),
      ...optional("original_content_sha256", /^[0-9a-f]{64}$/)
    };
  });
}

function normalizedExternalIdentityCheckpointReceipt(result, {
  requestOriginalSetSha256 = null,
  resolutionContractSha256,
  requireActiveRelease = false
} = {}) {
  const requestDigest = optionalSha256(requestOriginalSetSha256, "request_original_set_sha256");
  const resolutionDigest = optionalSha256(
    resolutionContractSha256,
    "external_identity_resolution_contract_sha256"
  );
  if (!resolutionDigest) throw persistenceCheckpointError("external_identity_resolution_contract_missing");
  const support = result?.external_identity_support;
  if (!support || !["APPLIED", "ABSTAINED"].includes(support.status)) {
    throw persistenceCheckpointError("external_identity_support_receipt_missing");
  }
  const release = externalIdentityReplayReleaseForReceipt(support);
  if (!release) {
    throw persistenceCheckpointError("external_identity_registry_release_unsupported");
  }
  if (requireActiveRelease
      && release.receipt.registry_release_id !== EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID) {
    throw persistenceCheckpointError("external_identity_registry_release_not_active");
  }
  if (release.receipt.resolution_contract_sha256 !== resolutionDigest) {
    throw persistenceCheckpointError("external_identity_resolution_contract_sha256_mismatch");
  }
  const releaseFields = {
    pack_id: release.receipt.pack_id,
    pack_version: release.receipt.pack_version,
    pack_sha256: release.receipt.pack_sha256,
    index_id: release.receipt.index_id,
    index_version: release.receipt.index_version,
    index_sha256: release.receipt.index_sha256,
    registry_release_id: release.receipt.registry_release_id,
    resolution_contract_sha256: release.receipt.resolution_contract_sha256
  };
  if (support.schema_version !== release.receipt.schema_version) {
    throw persistenceCheckpointError("external_identity_schema_version_mismatch");
  }
  for (const [field, value] of Object.entries(releaseFields)) {
    if (support[field] !== value) {
      throw persistenceCheckpointError(`external_identity_${field}_mismatch`);
    }
  }

  const receipt = {
    schema_version: "csm-external-identity-checkpoint-receipt.v1",
    status: support.status,
    request_original_set_sha256: requestDigest,
    ...releaseFields
  };
  const stored = result?.csm_rows?.output?.structured_output?.external_identity_support ?? null;
  if (support.status === "ABSTAINED") {
    if (stored !== null) throw persistenceCheckpointError("external_identity_rows_unexpected");
    return {
      ...receipt,
      reason: requiredText(support.reason, "external_identity_abstain_reason")
    };
  }

  const matchMode = String(support.match_mode || "").trim();
  if (!release.match_modes.includes(matchMode)) {
    throw persistenceCheckpointError("external_identity_match_mode_invalid");
  }
  if (!validateExternalIdentityFieldDecisions(support)) {
    throw persistenceCheckpointError("external_identity_field_decisions_invalid");
  }
  if (!validateExternalIdentitySourceProvenance(support)) {
    throw persistenceCheckpointError("external_identity_source_provenance_invalid");
  }
  if (!validateExternalIdentityDecisionObservation(
    support,
    result?.observed_fields,
    result?.fields
  )) {
    throw persistenceCheckpointError("external_identity_decision_observation_mismatch");
  }
  const originalSetSha256 = optionalSha256(
    support.original_set_sha256,
    "external_identity_original_set_sha256"
  );
  if (matchMode === "VERIFIED_ORIGINAL_SET") {
    if (!originalSetSha256 || originalSetSha256 !== requestDigest) {
      throw persistenceCheckpointError("external_identity_original_set_sha256_mismatch");
    }
  } else if (originalSetSha256) {
    throw persistenceCheckpointError("external_identity_original_set_sha256_unexpected");
  }
  const applied = {
    ...receipt,
    match_mode: matchMode,
    original_set_sha256: originalSetSha256,
    record_id: requiredText(support.record_id, "external_identity_record_id")
  };
  for (const field of [
    "pack_id", "pack_version", "pack_sha256", "index_id", "index_version", "index_sha256",
    "registry_release_id", "resolution_contract_sha256", "match_mode", "record_id"
  ]) {
    if (stored?.[field] !== applied[field]) {
      throw persistenceCheckpointError(`external_identity_rows_${field}_mismatch`);
    }
  }
  if (stored?.schema_version !== release.receipt.schema_version
      || JSON.stringify(stored?.field_decisions) !== JSON.stringify(support.field_decisions)) {
    throw persistenceCheckpointError("external_identity_rows_field_decisions_mismatch");
  }
  if ((stored?.original_set_sha256 ?? null) !== originalSetSha256) {
    throw persistenceCheckpointError("external_identity_rows_original_set_sha256_mismatch");
  }
  return applied;
}

function normalizedVerifiedOriginalCheckpointReceipt(result, {
  requestOriginalSetSha256 = null,
  resolutionContractSha256,
  requireActiveRelease = false,
  projectionActivation = CSM_PROJECTION_ACTIVATION
} = {}) {
  const requestDigest = optionalSha256(
    requestOriginalSetSha256,
    "verified_original_request_original_set_sha256"
  );
  const resolutionDigest = optionalSha256(
    resolutionContractSha256,
    "verified_original_post_observation_resolution_contract_sha256"
  );
  if (!requestDigest) {
    throw persistenceCheckpointError("verified_original_request_original_set_sha256_missing");
  }
  if (resolutionDigest !== COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256) {
    throw persistenceCheckpointError("verified_original_post_observation_resolution_contract_mismatch");
  }
  const support = result?.verified_original_observation_support;
  if (!validateVerifiedOriginalObservationReceipt(support, {
    observedFields: result?.observed_fields,
    resolvedFields: result?.fields
  }) || support.status !== "APPLIED") {
    throw persistenceCheckpointError("verified_original_observation_receipt_invalid");
  }
  if (support.original_set_sha256 !== requestDigest) {
    throw persistenceCheckpointError("verified_original_observation_original_set_sha256_mismatch");
  }
  if (requireActiveRelease) {
    const active = validateCsmProjectionActivation(projectionActivation);
    if (active.verified_original_observation_overlay !== support.release_id
        || support.release_id !== VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID) {
      throw persistenceCheckpointError("verified_original_observation_release_not_active");
    }
  }
  const stored = result?.csm_rows?.output?.structured_output
    ?.verified_original_observation_support ?? null;
  if (JSON.stringify(stored) !== JSON.stringify(support)) {
    throw persistenceCheckpointError("verified_original_observation_rows_receipt_mismatch");
  }
  const output = result?.csm_rows?.output;
  if (output?.composer_version
        !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version
      || output?.marketplace_profile_version
        !== CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version) {
    throw persistenceCheckpointError("verified_original_observation_output_tuple_mismatch");
  }
  const replay = verifyReplay(result?.csm_rows, result?.title);
  if (replay?.ok !== true) {
    throw persistenceCheckpointError("verified_original_observation_replay_packet_invalid");
  }
  return {
    schema_version: "csm-verified-original-observation-checkpoint-receipt.v1",
    status: support.status,
    release_id: support.release_id,
    pack_id: support.pack_id,
    pack_version: support.pack_version,
    pack_sha256: support.pack_sha256,
    resolver_version: support.resolver_version,
    conflict_policy_version: support.conflict_policy_version,
    resolution_contract_sha256: support.resolution_contract_sha256,
    post_observation_resolution_contract_sha256: resolutionDigest,
    record_id: support.record_id,
    original_set_sha256: support.original_set_sha256,
    observed_fields_sha256: support.observed_fields_sha256,
    resolved_fields_sha256: support.resolved_fields_sha256
  };
}

function normalizedPostObservationCheckpointReceipts(result, {
  requestOriginalSetSha256 = null,
  resolutionContractSha256,
  requireActiveRelease = false,
  projectionActivation = CSM_PROJECTION_ACTIVATION
} = {}) {
  const resolutionDigest = optionalSha256(
    resolutionContractSha256,
    "post_observation_resolution_contract_sha256"
  );
  if (!resolutionDigest) {
    throw persistenceCheckpointError("post_observation_resolution_contract_missing");
  }
  const verified = result?.verified_original_observation_support ?? null;
  const combined = resolutionDigest
    === COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256;
  if (combined !== (verified?.status === "APPLIED")) {
    throw persistenceCheckpointError("post_observation_resolution_mode_mismatch");
  }
  if (!combined && verified !== null) {
    throw persistenceCheckpointError("verified_original_observation_receipt_unexpected");
  }
  if (combined && result?.external_identity_support?.status !== "ABSTAINED") {
    throw persistenceCheckpointError("combined_external_identity_must_abstain");
  }
  if (combined && (result?.csm_rows?.output?.structured_output
    ?.external_identity_support ?? null) !== null) {
    throw persistenceCheckpointError("combined_external_identity_rows_unexpected");
  }
  const externalIdentityReceipt = normalizedExternalIdentityCheckpointReceipt(result, {
    requestOriginalSetSha256,
    resolutionContractSha256: combined
      ? EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
      : resolutionDigest,
    requireActiveRelease
  });
  if (combined && externalIdentityReceipt.status !== "ABSTAINED") {
    throw persistenceCheckpointError("combined_external_identity_must_abstain");
  }
  const verifiedOriginalObservationReceipt = combined
    ? normalizedVerifiedOriginalCheckpointReceipt(result, {
        requestOriginalSetSha256,
        resolutionContractSha256: resolutionDigest,
        requireActiveRelease,
        projectionActivation
      })
    : null;
  return { externalIdentityReceipt, verifiedOriginalObservationReceipt };
}

export function buildCsmPersistenceCheckpoint({
  prepared, tenantId, operationKey, payloadHash, recognitionSessionId,
  recognitionSessionDeferred = false, recognitionInput = null,
  executionContractSha256 = null, resolutionContractSha256 = null,
  originalSetSha256 = null,
  operationScope = "",
  projectionActivation = CSM_PROJECTION_ACTIVATION
} = {}) {
  const tenant = requiredText(tenantId, "tenant_id");
  const operation = requiredText(operationKey, "operation_key");
  const payload = requiredText(payloadHash, "payload_hash").toLowerCase();
  const session = requiredText(recognitionSessionId, "recognition_session_id");
  if (!/^[0-9a-f]{64}$/.test(payload)) throw persistenceCheckpointError("payload_hash_invalid");
  assertPreparedResultIdentity(prepared, {
    tenantId: tenant,
    recognitionSessionId: session
  });
  const executionContract = optionalSha256(
    executionContractSha256,
    "execution_contract_sha256"
  );
  const resolutionContract = optionalSha256(
    resolutionContractSha256,
    "resolution_contract_sha256"
  );
  const derivedCheckpoint = String(operationScope || "").trim() === "derived_checkpoint";
  if (operationScope && !derivedCheckpoint) {
    throw persistenceCheckpointError("operation_scope_invalid");
  }
  if (derivedCheckpoint && !executionContract) {
    throw persistenceCheckpointError("execution_contract_sha256_invalid");
  }
  if (executionContract) {
    const preparedExecutionContract = optionalSha256(
      prepared?.execution_contract_sha256,
      "prepared_execution_contract_sha256"
    );
    if (preparedExecutionContract !== executionContract) {
      throw persistenceCheckpointError("prepared_execution_contract_sha256_mismatch");
    }
  } else if (prepared?.execution_contract_sha256 != null) {
    throw persistenceCheckpointError("legacy_result_contains_execution_contract");
  }
  if (resolutionContract) {
    const preparedResolutionContract = optionalSha256(
      prepared?.resolution_contract_sha256,
      "prepared_resolution_contract_sha256"
    );
    if (preparedResolutionContract !== resolutionContract) {
      throw persistenceCheckpointError("prepared_resolution_contract_sha256_mismatch");
    }
    try {
      validatePostObservationResolutionContract(prepared?.resolution_contract, {
        expectedSha256: resolutionContract
      });
    } catch {
      throw persistenceCheckpointError("prepared_resolution_contract_invalid");
    }
  }
  const checkpointReceipts = resolutionContract
    ? normalizedPostObservationCheckpointReceipts(prepared, {
        requestOriginalSetSha256: originalSetSha256,
        resolutionContractSha256: resolutionContract,
        requireActiveRelease: true,
        projectionActivation
      })
    : null;
  const externalIdentityReceipt = checkpointReceipts?.externalIdentityReceipt || null;
  const verifiedOriginalObservationReceipt =
    checkpointReceipts?.verifiedOriginalObservationReceipt || null;
  const hashes = prepared?.csm_rows?.session_hashes;
  if (!exactPacketHashes(hashes)) {
    throw persistenceCheckpointError("packet_hashes_invalid");
  }
  let accuracyLossLedger;
  try {
    accuracyLossLedger = validateAccuracyLossLedger(prepared?.accuracy_loss_ledger, { result: prepared });
  } catch {
    throw persistenceCheckpointError("accuracy_loss_ledger_invalid");
  }
  return {
    ...prepared,
    csm_persistence_checkpoint: {
      schema_version: executionContract
        ? derivedCheckpoint
          ? verifiedOriginalObservationReceipt
            ? CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION
            : resolutionContract
            ? CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION
            : CSM_PERSISTENCE_CHECKPOINT_DERIVED_LEGACY_VERSION
          : verifiedOriginalObservationReceipt
            ? CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION
            : resolutionContract
            ? CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION
            : CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_LEGACY_VERSION
        : CSM_PERSISTENCE_CHECKPOINT_VERSION,
      state: "PERSISTENCE_PENDING",
      tenant_id: tenant,
      operation_key: operation,
      payload_sha256: payload,
      recognition_session_id: session,
      recognition_session_deferred: recognitionSessionDeferred === true,
      ...(executionContract ? {
        execution_contract_sha256: executionContract
      } : {}),
      ...(recognitionInput ? {
        recognition_input: normalizedCheckpointRecognitionInput(recognitionInput)
      } : {}),
      ...(externalIdentityReceipt ? {
        external_identity_receipt: externalIdentityReceipt
      } : {}),
      ...(verifiedOriginalObservationReceipt ? {
        verified_original_observation_receipt: verifiedOriginalObservationReceipt
      } : {}),
      packet_hashes: hashes,
      accuracy_loss_ledger_version: accuracyLossLedger.version,
      accuracy_loss_ledger_sha256: accuracyLossLedger.ledger_sha256
    }
  };
}

export function validateCsmPersistenceCheckpoint(result, {
  tenantId, operationKey, payloadHash, recognitionSessionId,
  executionContractSha256 = null, resolutionContractSha256 = null,
  originalSetSha256 = null,
  operationScope = ""
} = {}) {
  const checkpoint = result?.csm_persistence_checkpoint;
  const executionContract = optionalSha256(
    executionContractSha256,
    "execution_contract_sha256"
  );
  const resolutionContract = optionalSha256(
    resolutionContractSha256,
    "resolution_contract_sha256"
  );
  const derivedCheckpoint = String(operationScope || "").trim() === "derived_checkpoint";
  if (operationScope && !derivedCheckpoint) {
    throw persistenceCheckpointError("operation_scope_invalid");
  }
  const expected = {
    tenant_id: requiredText(tenantId, "tenant_id"),
    operation_key: requiredText(operationKey, "operation_key"),
    payload_sha256: requiredText(payloadHash, "payload_hash").toLowerCase(),
    recognition_session_id: requiredText(recognitionSessionId, "recognition_session_id")
  };
  if (!/^[0-9a-f]{64}$/.test(expected.payload_sha256)) {
    throw persistenceCheckpointError("payload_hash_invalid");
  }
  const checkpointVersion = checkpoint?.schema_version;
  const allowedCheckpointVersions = executionContract
    ? [derivedCheckpoint
        ? CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION
        : CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION,
      derivedCheckpoint
        ? CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION
        : CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION,
      derivedCheckpoint
        ? CSM_PERSISTENCE_CHECKPOINT_DERIVED_LEGACY_VERSION
        : CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_LEGACY_VERSION]
    : derivedCheckpoint
      ? []
      : [CSM_PERSISTENCE_CHECKPOINT_VERSION, CSM_PERSISTENCE_CHECKPOINT_LEGACY_VERSION];
  if (!allowedCheckpointVersions.includes(checkpointVersion)
      || checkpoint?.state !== "PERSISTENCE_PENDING") {
    throw persistenceCheckpointError("marker_missing");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (checkpoint[name] !== value) throw persistenceCheckpointError(`${name}_mismatch`);
  }
  if (executionContract
      && checkpoint.execution_contract_sha256 !== executionContract) {
    throw persistenceCheckpointError("execution_contract_sha256_mismatch");
  }
  if (executionContract) {
    if (optionalSha256(
      result?.execution_contract_sha256,
      "result_execution_contract_sha256"
    ) !== executionContract) {
      throw persistenceCheckpointError("result_execution_contract_sha256_mismatch");
    }
  } else if (result?.execution_contract_sha256 != null) {
    throw persistenceCheckpointError("legacy_result_contains_execution_contract");
  }
  if (!executionContract && checkpoint?.execution_contract_sha256 != null) {
    throw persistenceCheckpointError("legacy_checkpoint_contains_execution_contract");
  }
  if (resolutionContract) {
    if (optionalSha256(
      result?.resolution_contract_sha256,
      "result_resolution_contract_sha256"
    ) !== resolutionContract) {
      throw persistenceCheckpointError("result_resolution_contract_sha256_mismatch");
    }
    try {
      validatePostObservationResolutionContract(result?.resolution_contract, {
        expectedSha256: resolutionContract
      });
    } catch {
      throw persistenceCheckpointError("result_resolution_contract_invalid");
    }
  }
  const verifiedOriginalCheckpoint = checkpointVersion
      === CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION;
  const identityReceiptCheckpoint = verifiedOriginalCheckpoint
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION;
  if (identityReceiptCheckpoint && resolutionContract) {
    const expectedReceipts = normalizedPostObservationCheckpointReceipts(result, {
      requestOriginalSetSha256: originalSetSha256,
      resolutionContractSha256: resolutionContract
    });
    if (JSON.stringify(checkpoint.external_identity_receipt)
        !== JSON.stringify(expectedReceipts.externalIdentityReceipt)) {
      throw persistenceCheckpointError("external_identity_receipt_mismatch");
    }
    if (verifiedOriginalCheckpoint) {
      if (JSON.stringify(checkpoint.verified_original_observation_receipt)
          !== JSON.stringify(expectedReceipts.verifiedOriginalObservationReceipt)) {
        throw persistenceCheckpointError("verified_original_observation_receipt_mismatch");
      }
    } else if (expectedReceipts.verifiedOriginalObservationReceipt !== null) {
      throw persistenceCheckpointError("verified_original_observation_checkpoint_version_mismatch");
    }
  } else if (checkpoint?.external_identity_receipt != null) {
    throw persistenceCheckpointError("external_identity_receipt_unexpected");
  }
  if (!verifiedOriginalCheckpoint
      && checkpoint?.verified_original_observation_receipt != null) {
    throw persistenceCheckpointError("verified_original_observation_receipt_unexpected");
  }
  const currentCheckpoint = checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_VERSION
    || checkpointVersion
      === CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_LEGACY_VERSION
    || checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_DERIVED_LEGACY_VERSION;
  if (currentCheckpoint
      && checkpoint.recognition_session_deferred != null
      && typeof checkpoint.recognition_session_deferred !== "boolean") {
    throw persistenceCheckpointError("recognition_session_deferred_invalid");
  }
  const recognitionInput = checkpoint.recognition_input == null
    ? null
    : normalizedCheckpointRecognitionInput(checkpoint.recognition_input);
  const rows = assertPreparedResultIdentity(result, {
    tenantId: expected.tenant_id,
    recognitionSessionId: expected.recognition_session_id
  });
  const hashes = rows?.session_hashes || {};
  const checkpointHashes = checkpoint.packet_hashes || {};
  if (!exactPacketHashes(hashes)
      || !exactPacketHashes(checkpointHashes)
      || CSM_PACKET_HASH_KEYS.some((name) => hashes[name] !== checkpointHashes[name])) {
    throw persistenceCheckpointError("packet_hash_mismatch");
  }
  if (currentCheckpoint) {
    let ledger;
    try {
      ledger = validateAccuracyLossLedger(result?.accuracy_loss_ledger, { result });
    } catch {
      throw persistenceCheckpointError("accuracy_loss_ledger_invalid");
    }
    if (checkpoint.accuracy_loss_ledger_version !== ledger.version) {
      throw persistenceCheckpointError("accuracy_loss_ledger_version_mismatch");
    }
    if (checkpoint.accuracy_loss_ledger_sha256 !== ledger.ledger_sha256) {
      throw persistenceCheckpointError("accuracy_loss_ledger_mismatch");
    }
  } else if (result?.accuracy_loss_ledger != null
      || checkpoint?.accuracy_loss_ledger_version != null
      || checkpoint?.accuracy_loss_ledger_sha256 != null) {
    throw persistenceCheckpointError("legacy_checkpoint_contains_accuracy_loss_ledger");
  }
  return recognitionInput ? {
    ...result,
    csm_persistence_checkpoint: {
      ...checkpoint,
      recognition_input: recognitionInput
    }
  } : result;
}

function alreadyPersisted(result, recognitionSessionId) {
  return result?.csm_persistence?.ok === true
    && result?.csm_persistence?.atomic === true
    && result?.csm_persistence?.session?.saved === true
    && result?.csm_rows?.resolution?.recognition_session_id === recognitionSessionId;
}

function lotReviewRequiredError(result, recognitionSessionId) {
  const receipt = result?.csm_rows?.output?.structured_output?.lot_terminal ?? null;
  if (receipt == null) {
    if (result?.lot_publishable === false) {
      throw persistenceCheckpointError("lot_terminal_receipt_missing");
    }
    return null;
  }
  try {
    validateLotTerminalReceipt(receipt, {
      lotCount: result?.csm_rows?.output?.structured_output?.lot_count,
      unsharedAttributes: result?.lot_unshared_attributes
    });
  } catch {
    throw persistenceCheckpointError("lot_terminal_receipt_invalid");
  }
  if (result?.lot_quantity_unresolved !== receipt.lot_quantity_unresolved
      || result?.lot_single_card !== receipt.lot_single_card
      || result?.lot_publishable !== receipt.publishable
      || result?.lot_publication_failure_code !== receipt.failure_code) {
    throw persistenceCheckpointError("lot_terminal_public_receipt_mismatch");
  }
  if (receipt.publishable) return null;
  const code = receipt.failure_code;
  if (!Object.values(LOT_PUBLICATION_FAILURE).includes(code)) {
    throw persistenceCheckpointError("lot_publication_failure_code_invalid");
  }
  return Object.assign(new Error(code), {
    code,
    statusCode: 409,
    retryable: false,
    provider_attempt_started: false,
    recognition_session_id: requiredText(recognitionSessionId, "recognition_session_id"),
    review_required: true,
    trace_status: "PERSISTED_REVIEW_REQUIRED"
  });
}

function historicalPayloadRecoveryError(status, cause = null) {
  const normalized = String(status || "unavailable").toLowerCase();
  return Object.assign(new Error(`csm_legacy_payload_${normalized}`), {
    code: `csm_legacy_payload_${normalized}`,
    statusCode: 409,
    retryable: ["pending", "ambiguous"].includes(normalized),
    provider_attempt_started: false,
    ...(cause ? { cause } : {})
  });
}

function historicalExecutionContractSha256(result) {
  const executionContract = result?.execution_contract ?? null;
  const rawSha256 = result?.execution_contract_sha256 ?? null;
  if (executionContract === null && rawSha256 === null) return null;
  if (executionContract === null || rawSha256 === null) {
    throw persistenceCheckpointError("historical_execution_receipt_incomplete");
  }
  const executionContractSha256 = optionalSha256(
    rawSha256,
    "historical_execution_contract_sha256"
  );
  try {
    validateCsmModelExecutionContract(executionContract, {
      expectedSha256: executionContractSha256
    });
  } catch {
    throw persistenceCheckpointError("historical_execution_receipt_invalid");
  }
  return executionContractSha256;
}

function historicalResolutionContractSha256(result) {
  const contract = result?.resolution_contract ?? null;
  const rawSha256 = result?.resolution_contract_sha256 ?? null;
  if (contract === null && rawSha256 === null) return null;
  if (contract === null || rawSha256 === null) {
    throw persistenceCheckpointError("historical_resolution_receipt_incomplete");
  }
  const sha256 = optionalSha256(rawSha256, "historical_resolution_contract_sha256");
  try {
    validatePostObservationResolutionContract(contract, { expectedSha256: sha256 });
  } catch {
    throw persistenceCheckpointError("historical_resolution_receipt_invalid");
  }
  return sha256;
}

function historicalOriginalSetSha256(result) {
  const receipt = result?.csm_persistence_checkpoint?.external_identity_receipt;
  if (receipt == null) return null;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw persistenceCheckpointError("historical_external_identity_receipt_invalid");
  }
  return optionalSha256(
    receipt.request_original_set_sha256,
    "historical_request_original_set_sha256"
  );
}

const PUBLIC_PERSISTED_RESULT_FIELDS = Object.freeze([
  "title", "fields", "field_defects", "unreadable_fields", "low_confidence_fields",
  "grammar", "brackets", "dropped_brackets", "suppressed_brackets", "restored_brackets",
  "truncated", "input_empty_fields", "normalization_reasons", "character_budget", "length",
  "raw_length", "provider", "model", "requested_model", "served_model",
  "served_model_attested", "provider_response_status", "provider_response_status_attested",
  "provider_response_incomplete", "requested_effort", "served_effort",
  "served_effort_attested", "served_effort_conflict", "image_detail", "input_tokens",
  "cached_input_tokens", "output_tokens", "reasoning_tokens", "total_tokens",
  "total_tokens_source", "latency_ms", "provider_http_status", "provider_response_id",
  "provider_request_id", "provider_client_request_id", "prompt_version", "max_output_tokens",
  "model_profile_id", "provider_adapter_version", "request_builder_version",
  "response_parser_version", "optimization_pack_id", "optimization_pack_sha256",
  "execution_contract_sha256", "execution_contract", "transport_profile_id",
  "transport_profile_sha256", "provider_attempt_number", "provider_retry_count",
  "csm_contract_version", "csm_owner_versions", "latency_stages_ms"
]);

function publicCsmRows(rows) {
  const resolution = rows?.resolution;
  const output = rows?.output;
  const recognitionSessionId = requiredText(
    resolution?.recognition_session_id,
    "public_recognition_session_id"
  );
  const optionalText = (value) => String(value || "").trim();
  const resolutionContractVersion = optionalText(resolution?.contract_version);
  const resolverVersion = optionalText(resolution?.resolver_version);
  const outputContractVersion = optionalText(output?.contract_version);
  const composerVersion = optionalText(output?.composer_version);
  const marketplaceProfileVersion = optionalText(output?.marketplace_profile_version);
  const canonicalNamingTuple = [
    CANONICAL_NAMING_RELEASE_CONTRACT_V1,
    CANONICAL_NAMING_RELEASE_CONTRACT_V2
  ].some((contract) => (
    composerVersion === contract.composer_version
      && marketplaceProfileVersion === contract.marketplace_profile_version
  ));
  const publicOutput = {
    ...(outputContractVersion ? { contract_version: outputContractVersion } : {}),
    ...(composerVersion ? { composer_version: composerVersion } : {}),
    ...(canonicalNamingTuple ? {
      marketplace_profile_version: marketplaceProfileVersion
    } : {})
  };
  return {
    resolution: {
      recognition_session_id: recognitionSessionId,
      ...(resolutionContractVersion ? { contract_version: resolutionContractVersion } : {}),
      ...(resolverVersion ? { resolver_version: resolverVersion } : {})
    },
    ...(Object.keys(publicOutput).length ? { output: publicOutput } : {})
  };
}

function publicCsmPersistence(value) {
  if (value == null) return null;
  if (value?.ok !== true || value?.atomic !== true || value?.session?.saved !== true) {
    throw persistenceCheckpointError("public_csm_persistence_invalid");
  }
  return {
    ok: true,
    atomic: true,
    ...(value.replayed === true ? { replayed: true } : {}),
    session: { saved: true }
  };
}

export function publicPersistedResult(result, executionOrigin = null, canonicalAssetId = null) {
  const checkpoint = result?.csm_persistence_checkpoint;
  const providerAuthorityReceipt = result?.provider_authority_receipt;
  const publicResult = Object.fromEntries(PUBLIC_PERSISTED_RESULT_FIELDS.flatMap((key) => (
    Object.prototype.hasOwnProperty.call(result || {}, key) ? [[key, result[key]]] : []
  )));
  const publicLotTerminal = result?.grammar === "lot" ? Object.fromEntries([
    "lot_quantity_unresolved", "lot_single_card", "lot_unshared_attributes",
    "lot_publishable", "lot_publication_failure_code"
  ].flatMap((key) => Object.prototype.hasOwnProperty.call(result || {}, key)
    ? [[key, result[key]]] : [])) : {};
  const csmRows = publicCsmRows(result?.csm_rows);
  const csmPersistence = publicCsmPersistence(result?.csm_persistence);
  let freshAuthorityReceipt = null;
  if (executionOrigin === "FRESH_CURRENT") {
    const authorityOperationKey = String(checkpoint?.operation_key || "").trim();
    const authorityAttempt = Number(result?.provider_attempt_number);
    if (!authorityOperationKey || !Number.isInteger(authorityAttempt) || authorityAttempt < 1) {
      throw persistenceCheckpointError("provider_authority_receipt_binding_missing");
    }
    try {
      freshAuthorityReceipt = validateCsmProviderAuthorityReceipt(providerAuthorityReceipt, {
        operationKey: authorityOperationKey,
        attempt: authorityAttempt
      });
    } catch {
      throw persistenceCheckpointError("provider_authority_receipt_invalid");
    }
  }
  // This is request provenance, not part of the provider execution contract.
  // In particular, a later replay must not inherit the original request's
  // FRESH_CURRENT label or authority claim from its durable checkpoint.
  return {
    ...publicResult,
    ...publicLotTerminal,
    csm_rows: csmRows,
    ...(csmPersistence ? { csm_persistence: csmPersistence } : {}),
    ...(canonicalAssetId === null ? {} : {
      asset_id: requiredText(canonicalAssetId, "canonical_asset_id")
    }),
    ...(freshAuthorityReceipt ? {
      provider_authority_receipt: freshAuthorityReceipt
    } : {}),
    ...(executionOrigin === null ? {} : { execution_origin: executionOrigin })
  };
}

export function deterministicProviderClientRequestId({ operationKey, payloadHash, attempt } = {}) {
  const operation = requiredText(operationKey, "operation_key");
  const payload = requiredText(payloadHash, "payload_hash").toLowerCase();
  const attemptNumber = Number(attempt);
  if (!/^[0-9a-f]{64}$/.test(payload)) throw new TypeError("invalid_payload_hash");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new TypeError("invalid_attempt");
  const digest = createHash("sha256")
    .update(`${operation}\u0000${payload}\u0000${attemptNumber}`)
    .digest("hex");
  return `lynca-${digest}`;
}

// `X-Client-Request-Id` is an observability receipt, not an idempotency key.
// The authority still fails closed whenever the provider outcome is unknown.
// Explicit storage and opaque operation metadata make a returned response
// diagnosable/retrievable without leaking tenant, user or asset identifiers.
export function createResponsesProviderCaller({
  env = process.env,
  fetchImpl = globalThis.fetch,
  operationKey,
  payloadHash,
  attempt,
  clientRequestId = deterministicProviderClientRequestId({ operationKey, payloadHash, attempt })
} = {}) {
  return activeProviderAdapter.createCaller({
    env,
    fetchImpl,
    operationKey,
    payloadHash,
    attempt,
    clientRequestId,
    timeoutMs: CSM_DIRECT_PROVIDER_TIMEOUT_MS
  });
}

export function resetCsmPersistenceReadinessCache() {
  csmPersistenceReadinessCache = null;
}

export async function checkCsmDirectPreSpendReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  checkPersistence = checkCsmPersistenceReadiness,
  checkProviderAuthority = checkCsmProviderAdmissionReadiness
} = {}) {
  const [persistence, providerAuthority] = await Promise.all([
    checkPersistence({ env, fetchImpl }),
    checkProviderAuthority({ env, fetchImpl })
  ]);
  if (persistence?.ready !== true) {
    return { ready: false, reason: persistence?.reason || "persistence_unknown" };
  }
  if (providerAuthority?.ready !== true) {
    return { ready: false, reason: providerAuthority?.reason || "provider_authority_unknown" };
  }
  return { ready: true, reason: null };
}

// Schema readiness is global to one Supabase project, not card-specific. Share
// both the in-flight probe and its short success receipt inside a warm function
// instance so a 120-card burst does not multiply the registry, persistence,
// product-projection, authority and pacer probes into per-card RPC traffic.
// Failures are never cached, so applying/fixing a migration heals immediately.
export async function checkCachedCsmPersistenceReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  checkReadiness = checkCsmDirectPreSpendReadiness,
  now = Date.now,
  ttlMs = CSM_PERSISTENCE_READINESS_CACHE_TTL_MS
} = {}) {
  const projectUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const enabled = String(env.CSM_PERSISTENCE_ENABLED || "").trim().toLowerCase();
  const key = `${projectUrl}|${enabled}`;
  const timestamp = now();
  if (csmPersistenceReadinessCache?.key === key
      && csmPersistenceReadinessCache.expiresAt > timestamp) {
    return csmPersistenceReadinessCache.promise;
  }
  const promise = Promise.resolve().then(() => checkReadiness({ env, fetchImpl }));
  csmPersistenceReadinessCache = {
    key,
    expiresAt: timestamp + Math.max(1, Number(ttlMs) || CSM_PERSISTENCE_READINESS_CACHE_TTL_MS),
    promise
  };
  try {
    const readiness = await promise;
    if (readiness?.ready !== true && csmPersistenceReadinessCache?.promise === promise) {
      csmPersistenceReadinessCache = null;
    }
    return readiness;
  } catch (error) {
    if (csmPersistenceReadinessCache?.promise === promise) csmPersistenceReadinessCache = null;
    throw error;
  }
}

export async function runDirectCsmAsset({
  tenantId, userId, assetId, intentId, imageDetail = "high", manualRetry = false,
  resumeOnly = false,
  clientTiming = null, serverPrologueStages = null,
  env = process.env, fetchImpl = globalThis.fetch, callProvider = null,
  dependencies = {}
} = {}) {
  const now = typeof dependencies.now === "function" ? dependencies.now : Date.now;
  const routeStartedAt = now();
  const tenant = requiredText(tenantId, "tenant_id");
  const user = requiredText(userId, "user_id");
  const asset = requiredText(assetId, "asset_id");
  const intent = requiredText(intentId, "intent_id");
  const detail = normalizedDetail(imageDetail);
  const checkReadiness = dependencies.checkReadiness || null;
  const readImages = dependencies.readImages || readCanonicalListingImageReferences;
  const signImage = dependencies.signImage || createListingImageSignedReadUrl;
  const createSession = dependencies.createSession || createCsmRecognitionSession;
  const preparePath = dependencies.preparePath || prepareCanonicalListingPath;
  const persistPath = dependencies.persistPath || persistPreparedCanonicalListingPath;
  const synchronizeBeforePersistence = dependencies.synchronizeBeforePersistence || null;
  const chooseRecognitionImages = dependencies.chooseRecognitionImages
    || (({ canonical: input }) => selectRecognitionImages(input.images, { slots: 2 }));
  const createAuthority = dependencies.createAuthority || createCsmSupabaseProviderAdmissionAuthority;
  const createDispatcher = dependencies.createDispatcher || createLunaDirectDispatcher;
  const operationScope = String(dependencies.operationScope || "").trim();
  if (operationScope && operationScope !== "derived_checkpoint") {
    throw Object.assign(new Error("csm_operation_scope_invalid"), { statusCode: 400, retryable: false });
  }
  const transportProfile = resolveCsmRecognitionTransportReceipt(
    dependencies.transportProfile || CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
  );
  if (operationScope === "derived_checkpoint") {
    if (transportProfile.id !== CSM_STAGED_TRANSPORT_PROFILE.id
        || String(dependencies.laneVersion || "").trim() !== transportProfile.lane_version) {
      throw Object.assign(new Error("staged_transport_receipt_mismatch"), {
        statusCode: 400,
        retryable: false
      });
    }
  } else if (transportProfile.id === CSM_STAGED_TRANSPORT_PROFILE.id) {
    throw Object.assign(new Error("staged_transport_scope_missing"), {
      statusCode: 400,
      retryable: false
    });
  }
  const markStagedResumeRecovery = (error) => {
    if (operationScope === "derived_checkpoint" && error && typeof error === "object") {
      error.staged_resume_checkpoint_available = true;
      error.recovery_action = "STAGED_RESUME_ONLY";
    }
    return error;
  };
  const markStagedLookupRecovery = (error) => {
    if (operationScope === "derived_checkpoint" && error && typeof error === "object") {
      error.recovery_action = "STAGED_RESUME_ONLY";
    }
    return error;
  };
  const markStagedFreshRecovery = (error) => {
    if (operationScope === "derived_checkpoint" && error && typeof error === "object") {
      error.provider_attempt_started = false;
      error.recovery_action = "STAGED_FRESH_RETRY";
    }
    return error;
  };
  if (resumeOnly === true && manualRetry === true) {
    throw Object.assign(new Error("csm_resume_mode_conflict"), {
      statusCode: 400,
      retryable: false,
      provider_attempt_started: false
    });
  }

  // Fail before the paid provider boundary unless both the replay store and
  // the durable provider authority/pacer are live. A usable title without its
  // CSM lineage or globally paced claim is not an acceptable production asset.
  const readinessStartedAt = now();
  let readiness;
  try {
    readiness = checkReadiness
      ? await checkReadiness({ env, fetchImpl })
      : await checkCachedCsmPersistenceReadiness({ env, fetchImpl });
  } catch (error) {
    throw markStagedFreshRecovery(error);
  }
  if (!readiness.ready) {
    throw markStagedFreshRecovery(Object.assign(
      new Error(`csm_persistence_not_ready:${readiness.reason}`),
      { statusCode: 503, retryable: true }
    ));
  }
  // The client's own stages come first, so the record covers the whole journey
  // rather than only the part that happens after the request arrives. Without
  // them the six production cards run on 2026-08-06 reported 6.1-9.6s of server
  // work against a writer-observed ~23s, and the difference had nowhere to be.
  // The ingest endpoint already accepted these; this one -- the endpoint the
  // writer flow actually calls -- did not.
  const latencyStages = {
    ...safeClientTiming(clientTiming),
    ...safeLatencyStages(serverPrologueStages),
    preflight_ms: now() - readinessStartedAt
  };

  const imageManifestStartedAt = now();
  const canonical = await readImages({ tenantId: tenant, assetId: asset, env, fetchImpl });
  latencyStages.image_manifest_ms = now() - imageManifestStartedAt;
  const canonicalAssetId = requiredText(canonical?.asset_id, "canonical_asset_id");
  if (canonicalAssetId !== asset) {
    throw Object.assign(new Error("canonical_asset_identity_mismatch"), {
      statusCode: 409,
      retryable: false
    });
  }
  const canonicalOriginals = canonical.images.filter((image) => image.derived !== true);
  const originals = canonicalOriginals.slice(0, 2);
  if (!originals.length) {
    throw Object.assign(new Error("canonical_original_image_missing"), { statusCode: 409 });
  }
  // readCanonicalListingImageReferences has already enforced tenant/asset
  // scope plus object/content verification. Only that server-owned original
  // set can open the reviewed image-identity seam; recognition derivatives and
  // client payload values never participate.
  const externalIdentity = externalIdentityFromVerifiedOriginals(canonicalOriginals);
  const resolutionSelection = selectCsmPostObservationResolutionContract({
    originalImageSha256: externalIdentity.context?.originalImageSha256 || null,
    projectionActivation:
      dependencies.projectionActivation || CSM_PROJECTION_ACTIVATION
  });
  // COS-53: Recognition may read a stored bounded DOWNSCALE when one exists for
  // an original and is actually smaller. The originals remain the system of
  // record and are still what must exist -- the check above is unchanged and
  // deliberately still asks for them.
  //
  // The ordinary user-operation key stays in its historical tenant/intent/asset
  // namespace. Its execution-bound payload hash binds the ordered recognition
  // fingerprints below, so a transport/profile change conflicts before provider
  // use without manufacturing a second logical operation for the same card.
  const recognition = chooseRecognitionImages({ canonical, originals });
  if (!Array.isArray(recognition?.images) || recognition.images.length !== originals.length) {
    throw Object.assign(new Error("recognition_image_selection_invalid"), {
      statusCode: 409,
      retryable: false
    });
  }
  const recognitionImages = recognition.images.length ? recognition.images : originals;
  const recognitionReads = recognition.read.map((entry) => String(entry?.read || "").trim());
  if (transportProfile.id === CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE.id
      && recognitionReads.some((read) => read !== "original")) {
    throw Object.assign(new Error("original_inline_transport_source_mismatch"), {
      statusCode: 409,
      retryable: false
    });
  }
  if (transportProfile.id === CSM_STAGED_TRANSPORT_PROFILE.id
      && recognitionReads.some((read) => read !== "readability_derived")) {
    throw Object.assign(new Error("staged_transport_source_mismatch"), {
      statusCode: 409,
      retryable: false
    });
  }
  const executionContractSha256 = buildCsmModelExecutionContractSha256({
    provider: CSM_THIN_RUNTIME_CONTRACT.provider,
    model: MODEL,
    requestedEffort: EFFORT,
    imageDetail: detail,
    maxOutputTokens: CSM_THIN_RUNTIME_CONTRACT.maxOutputTokens,
    semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
    transportProfile,
    imageUrls: csmExecutionContractImageUrls(recognitionImages.length)
  });

  const task = {
    tenant_id: tenant,
    intent_id: intent,
    asset_id: canonical.asset_id || asset,
    model: MODEL,
    detail,
    reasoning_effort: EFFORT,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: originals.map((image) => `sha256:${requiredText(
      image.content_sha256 || image.contentSha256,
      "image_content_sha256"
    ).toLowerCase()}`),
    recognition_fingerprints: recognitionImages.map((image) => `sha256:${requiredText(
      image.content_sha256 || image.contentSha256,
      "recognition_image_content_sha256"
    ).toLowerCase()}`),
    execution_contract_sha256: executionContractSha256,
    resolution_contract_sha256: resolutionSelection.resolution_contract_sha256,
    original_set_sha256: externalIdentity.originalSetSha256,
    ...(operationScope ? {
      operation_scope: operationScope,
      lane_version: requiredText(dependencies.laneVersion, "lane_version"),
      original_manifest_sha256: requiredText(
        dependencies.originalManifestSha256,
        "original_manifest_sha256"
      ).toLowerCase()
    } : {})
  };
  const operationKey = buildLunaDirectOperationKey(task);
  const payloadHash = buildLunaDirectPayloadHash(task);
  const authority = dependencies.providerAdmission || createAuthority({
    env,
    fetchImpl,
    claimPollMs: CSM_DIRECT_CLAIM_POLL_MS,
    claimTimeoutMs: CSM_DIRECT_CLAIM_TIMEOUT_MS,
    maximumProviderDurationMs: CSM_DIRECT_PROVIDER_TIMEOUT_MS
  });
  let sessionInitializedThisRequest = false;

  const initializeRecognitionSession = async (sessionId, {
    recognitionInput = recognition.read,
    provider = MODEL,
    reuseExistingSnapshot = false
  } = {}) => {
    const created = await createSession({
      sessionId,
      tenantId: tenant,
      userId: user,
      operatorId: user,
      payload: {
        asset_id: canonical.asset_id,
        client_asset_ref: canonical.asset_id,
        images: canonical.image_references,
        image_references: canonical.image_references,
        image_generation_id: canonical.image_generation_id,
        image_set_sha256: canonical.image_set_sha256,
        expected_original_count: canonical.expected_original_count,
        recognition_input: recognitionInput,
        provider,
        mode: "csm_thin_direct"
      },
      routePlan: { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" },
      reuseExistingSnapshot,
      env,
      fetchImpl
    });
    if (created.persistence?.recognition_session?.saved !== true) {
      throw Object.assign(new Error("csm_recognition_session_not_persisted"), {
        statusCode: 503
      });
    }
    sessionInitializedThisRequest = true;
    return created;
  };

  let durableResult = null;
  let durablePayloadHash = payloadHash;
  let durableExecutionContractSha256 = task.execution_contract_sha256;
  let durableResolutionContractSha256 = task.resolution_contract_sha256;
  let durableOriginalSetSha256 = task.original_set_sha256;
  let historicalPayloadRecovered = false;
  let freshProviderAttemptStarted = false;
  let currentRequestCheckpoint = null;

  const recoverHistoricalPayloadConflict = async (conflictError) => {
    if (conflictError?.code !== "operation_payload_conflict") throw conflictError;
    if (typeof authority.lookupOperationResultByKey !== "function") {
      throw historicalPayloadRecoveryError("unavailable");
    }
    let historical;
    try {
      historical = await authority.lookupOperationResultByKey({
        tenantId: tenant,
        operationKey
      });
    } catch (error) {
      throw historicalPayloadRecoveryError("unavailable", error);
    }
    if (historical.status === "found") {
      const storedPayloadHash = optionalSha256(
        historical.payloadHash,
        "historical_payload_hash"
      );
      if (!storedPayloadHash) {
        throw persistenceCheckpointError("historical_payload_hash_missing");
      }
      if (storedPayloadHash === payloadHash) {
        throw persistenceCheckpointError("historical_payload_hash_not_conflicting");
      }
      return {
        result: historical.result,
        payloadHash: storedPayloadHash,
        executionContractSha256: historicalExecutionContractSha256(historical.result),
        resolutionContractSha256: historicalResolutionContractSha256(historical.result),
        originalSetSha256: historicalOriginalSetSha256(historical.result)
      };
    }
    // Every matched non-success state is authoritative. In particular FAILED,
    // PENDING and AMBIGUOUS are not a licence to create a fresh execution under
    // today's profile. This branch has no enqueue/provider capability.
    throw historicalPayloadRecoveryError(historical.status || "not_found");
  };

  if (resumeOnly === true) {
    let durable;
    try {
      durable = await authority.lookupOperationResult({
        tenantId: tenant,
        operationKey,
        payloadHash
      });
    } catch (error) {
      try {
        const recovered = await recoverHistoricalPayloadConflict(error);
        durable = { status: "found", result: recovered.result };
        durablePayloadHash = recovered.payloadHash;
        durableExecutionContractSha256 = recovered.executionContractSha256;
        durableResolutionContractSha256 = recovered.resolutionContractSha256;
        durableOriginalSetSha256 = recovered.originalSetSha256;
        historicalPayloadRecovered = true;
      } catch (recoveryError) {
        throw markStagedLookupRecovery(recoveryError);
      }
    }
    if (durable.status === "found") {
      durableResult = durable.result;
    } else {
      const code = `csm_resume_${durable.status || "not_found"}`;
      const stagedNotFound = operationScope === "derived_checkpoint"
        && (durable.status || "not_found") === "not_found";
      throw Object.assign(new Error(code), {
        code,
        statusCode: 409,
        retryable: stagedNotFound || ["pending", "ambiguous"].includes(durable.status),
        provider_attempt_started: false,
        ...(operationScope === "derived_checkpoint" ? {
          recovery_action: stagedNotFound ? "STAGED_FRESH_RETRY" : "STAGED_RESUME_ONLY"
        } : {})
      });
    }
  } else if (manualRetry === true) {
    let durable;
    try {
      durable = await authority.lookupOperationResult({
        tenantId: tenant,
        operationKey,
        payloadHash
      });
    } catch (error) {
      const recovered = await recoverHistoricalPayloadConflict(error);
      durable = { status: "found", result: recovered.result };
      durablePayloadHash = recovered.payloadHash;
      durableExecutionContractSha256 = recovered.executionContractSha256;
      durableResolutionContractSha256 = recovered.resolutionContractSha256;
      durableOriginalSetSha256 = recovered.originalSetSha256;
      historicalPayloadRecovered = true;
    }
    if (durable.status === "found") durableResult = durable.result;
    if (durable.status === "failed") {
      if (durable.result?.failure_phase === "CSM_PERSISTENCE") {
        throw Object.assign(new Error("csm_persistence_checkpoint_missing"), {
          code: "csm_persistence_checkpoint_missing",
          statusCode: 409,
          retryable: false
        });
      }
      task.prior_attempts = durable.latestAttempt;
    } else if (durable.status !== "not_found" && durable.status !== "found") {
      throw Object.assign(new Error(`csm_operation_${durable.status || "not_retriable"}`), {
        statusCode: 409,
        retryable: false
      });
    }
  }

  const executeTask = async (dispatched) => {
    let imageUrls;
    let recognitionSessionDeferred = false;
    const attemptStages = { ...latencyStages };
    const sessionId = deterministicCsmSessionId(dispatched.operation_key);
    const providerClientRequestId = deterministicProviderClientRequestId({
      operationKey: dispatched.operation_key,
      payloadHash: dispatched.payload_hash,
      attempt: dispatched.attempt
    });
    try {
      const [signedUrls, session] = await Promise.all([
        (async () => {
          const signedUrlStartedAt = now();
          const urls = await Promise.all(recognitionImages.map((image) => signImage({
            objectPath: image.objectPath,
            bucket: image.bucket,
            tenantId: tenant,
            env,
            fetchImpl
          })));
          attemptStages.signed_url_ms = now() - signedUrlStartedAt;
          return urls;
        })(),
        (async () => {
          const recognitionSessionStartedAt = now();
          const created = await initializeRecognitionSession(sessionId);
          attemptStages.recognition_session_ms = now() - recognitionSessionStartedAt;
          return created;
        })()
      ]);
      imageUrls = signedUrls;
      recognitionSessionDeferred = session.persistence?.recognition_session?.deferred === true;
      if (session.persistence?.recognition_session?.saved !== true) {
        throw Object.assign(new Error("csm_recognition_session_not_persisted"), {
          statusCode: 503
        });
      }
    } catch (error) {
      error.before_request = true;
      error.safe_to_retry = true;
      error.retryable = Number(error?.statusCode || error?.status || 503) >= 500;
      error.provider_attempt_started = false;
      throw error;
    }

    const providerStartedAt = now();
    let prepared;
    try {
      // Constructing the caller can still fail before a paid boundary (for
      // example an absent key).  Mark fresh only immediately before invoking
      // the already-constructed caller, so a compile/setup failure can never
      // be reported as a current provider execution.
      let providerCaller = callProvider;
      prepared = await preparePath({
        tenantId: tenant,
        recognitionSessionId: sessionId,
        imageUrls,
        imageDetail: detail,
        provider: CSM_THIN_RUNTIME_CONTRACT.provider,
        model: MODEL,
        effort: EFFORT,
        maxOutputTokens: CSM_THIN_RUNTIME_CONTRACT.maxOutputTokens,
        transportProfile,
        promptVersion: CSM_DIRECT_PROMPT_VERSION,
        providerClientRequestId,
        externalIdentityContext: externalIdentity.context,
        callProvider: async (request) => {
          providerCaller ||= createResponsesProviderCaller({
            env,
            fetchImpl,
            operationKey: dispatched.operation_key,
            payloadHash: dispatched.payload_hash,
            attempt: dispatched.attempt,
            clientRequestId: providerClientRequestId
          });
          freshProviderAttemptStarted = true;
          return providerCaller(request);
        },
        env,
        fetchImpl
      });
    } catch (error) {
      attemptStages.provider_prepare_ms = now() - providerStartedAt;
      attemptStages.provider_ms = Number.isFinite(Number(error?.provider_ms))
        ? Number(error.provider_ms)
        : attemptStages.provider_prepare_ms;
      error.latency_stages_ms = { ...attemptStages };
      error.recognition_session_id = sessionId;
      throw error;
    }
    attemptStages.provider_prepare_ms = now() - providerStartedAt;
    if (Number.isFinite(Number(prepared?.latency_ms))) {
      attemptStages.provider_ms = Number(prepared.latency_ms);
    }
    const checkpoint = buildCsmPersistenceCheckpoint({
      prepared: {
        ...prepared,
        provider_attempt_number: Number(dispatched.attempt),
        provider_retry_count: Math.max(0, Number(dispatched.attempt) - 1),
        latency_stages_ms: attemptStages
      },
      tenantId: tenant,
      operationKey: dispatched.operation_key,
      payloadHash: dispatched.payload_hash,
      recognitionSessionId: sessionId,
      recognitionSessionDeferred,
      recognitionInput: recognition.read,
      executionContractSha256: dispatched.execution_contract_sha256 || null,
      resolutionContractSha256: dispatched.resolution_contract_sha256 || null,
      originalSetSha256: dispatched.original_set_sha256 || null,
      operationScope,
      projectionActivation:
        dependencies.projectionActivation || CSM_PROJECTION_ACTIVATION
    });
    currentRequestCheckpoint = checkpoint;
    return checkpoint;
  };

  const dispatcher = createDispatcher({
    executeTask,
    providerAdmission: authority,
    lookupOperationResult: authority.lookupOperationResult,
    csmDirectConcurrency: CSM_DIRECT_LOCAL_FALLBACK_CONCURRENCY,
    // The staged lane buys latency with scheduling, never with extra paid
    // attempts. Its receipt can recover only an already-settled checkpoint.
    maxAttempts: operationScope === "derived_checkpoint" ? 1 : CSM_DIRECT_MAX_ATTEMPTS
  });
  const sessionId = deterministicCsmSessionId(operationKey);
  const dispatchStartedAt = now();
  let settled = durableResult;
  if (!settled) {
    try {
      settled = await (
        manualRetry === true && Number(task.prior_attempts) > 0
          ? dispatcher.manualRetry(task)
          : dispatcher.enqueue(task)
      );
    } catch (error) {
      if (operationScope === "derived_checkpoint") {
        // Once durable admission has been touched, an HTTP/claim/provider
        // failure cannot prove absence. Recovery first performs the exact
        // provider-incapable lookup; only its authoritative `not_found` may
        // later issue a fresh staged receipt.
        try {
          const recovered = await recoverHistoricalPayloadConflict(error);
          settled = recovered.result;
          durablePayloadHash = recovered.payloadHash;
          durableExecutionContractSha256 = recovered.executionContractSha256;
          durableResolutionContractSha256 = recovered.resolutionContractSha256;
          durableOriginalSetSha256 = recovered.originalSetSha256;
          historicalPayloadRecovered = true;
        } catch (recoveryError) {
          throw markStagedLookupRecovery(recoveryError);
        }
      } else {
        const recovered = await recoverHistoricalPayloadConflict(error);
        settled = recovered.result;
        durablePayloadHash = recovered.payloadHash;
        durableExecutionContractSha256 = recovered.executionContractSha256;
        durableResolutionContractSha256 = recovered.resolutionContractSha256;
        durableOriginalSetSha256 = recovered.originalSetSha256;
        historicalPayloadRecovered = true;
      }
    }
  }
  // Production authority appends its own latency stages with a top-level
  // shallow copy after settlement.  The nested checkpoint identity survives
  // that copy, while a recovered/JSON-decoded receipt does not.
  const settledCurrentRequestCheckpoint = Boolean(
    currentRequestCheckpoint?.csm_persistence_checkpoint
  ) && settled?.csm_persistence_checkpoint
    === currentRequestCheckpoint.csm_persistence_checkpoint;
  const executionOrigin = historicalPayloadRecovered
    ? "HISTORICAL_KEY_RECOVERY"
    : freshProviderAttemptStarted && settledCurrentRequestCheckpoint
      ? "FRESH_CURRENT"
      : freshProviderAttemptStarted
        ? "AMBIGUOUS_PROVIDER_RECOVERY"
      : "EXACT_REPLAY";
  if (!historicalPayloadRecovered && alreadyPersisted(settled, sessionId)) {
    const reviewRequired = lotReviewRequiredError(settled, sessionId);
    if (reviewRequired) throw reviewRequired;
    return publicPersistedResult(settled, executionOrigin, canonicalAssetId);
  }
  const preparedWithDispatchStages = {
    ...settled,
    latency_stages_ms: {
      ...(settled.latency_stages_ms || {}),
      // A resume request arrives after the same original upload has settled.
      // Merge its now-final client duration into the durable provider receipt
      // without replacing the first request's provider/authority stages.
      ...safeClientTiming(clientTiming),
      authority_dispatch_ms: now() - dispatchStartedAt
    }
  };
  let prepared = validateCsmPersistenceCheckpoint(preparedWithDispatchStages, {
    tenantId: tenant,
    operationKey,
    payloadHash: durablePayloadHash,
    recognitionSessionId: sessionId,
    executionContractSha256: durableExecutionContractSha256,
    resolutionContractSha256: durableResolutionContractSha256,
    originalSetSha256: durableOriginalSetSha256,
    operationScope
  });
  if (typeof synchronizeBeforePersistence === "function") {
    const originalSyncStartedAt = now();
    try {
      await synchronizeBeforePersistence({
        tenantId: tenant,
        recognitionSessionId: sessionId,
        prepared,
        env,
        fetchImpl
      });
    } catch (error) {
      error.latency_stages_ms = {
        ...(prepared.latency_stages_ms || {}),
        staged_original_sync_ms: now() - originalSyncStartedAt
      };
      throw markStagedResumeRecovery(error);
    }
    prepared = {
      ...prepared,
      latency_stages_ms: {
        ...(prepared.latency_stages_ms || {}),
        staged_original_sync_ms: now() - originalSyncStartedAt
      }
    };
  }
  if ((prepared.csm_persistence_checkpoint.recognition_session_deferred === true
        || dependencies.deferRecognitionSessionUntilPersistence === true)
      && !sessionInitializedThisRequest) {
    const recognitionSessionReplayStartedAt = now();
    try {
      await initializeRecognitionSession(sessionId, {
        recognitionInput: prepared.csm_persistence_checkpoint.recognition_input || recognition.read,
        provider: prepared.model || MODEL,
        // A durable paid checkpoint must resume against the session identity
        // first persisted for this deterministic ID. Later support-only crops
        // may expand the asset's current canonical projection, but cannot
        // rewrite what the paid operation was bound to.
        reuseExistingSnapshot: true
      });
    } catch (error) {
      throw markStagedResumeRecovery(error);
    }
    prepared = {
      ...prepared,
      latency_stages_ms: {
        ...(prepared.latency_stages_ms || {}),
        recognition_session_replay_ms: now() - recognitionSessionReplayStartedAt
      }
    };
  }
  const persistenceStartedAt = now();
  let persisted;
  try {
    persisted = await persistPath({
      tenantId: tenant,
      recognitionSessionId: sessionId,
      prepared,
      imageDetail: prepared.image_detail || detail,
      provider: prepared.provider || CSM_THIN_RUNTIME_CONTRACT.provider,
      model: prepared.model || MODEL,
      effort: prepared.requested_effort || EFFORT,
      promptVersion: Object.prototype.hasOwnProperty.call(prepared, "prompt_version")
        ? prepared.prompt_version
        : CSM_DIRECT_PROMPT_VERSION,
      env,
      fetchImpl
    });
  } catch (error) {
    throw markStagedResumeRecovery(error);
  }
  const persistedWithLatency = persisted && typeof persisted === "object"
    ? {
        ...persisted,
        latency_stages_ms: {
          ...(persisted.latency_stages_ms || prepared.latency_stages_ms || {}),
          csm_persistence_ms: now() - persistenceStartedAt,
          request_total_ms: now() - routeStartedAt
        }
      }
    : persisted;
  if (persistedWithLatency?.csm_persistence?.ok !== true
      || persistedWithLatency?.csm_persistence?.atomic !== true
      || persistedWithLatency?.csm_persistence?.session?.saved !== true) {
    const code = persistedWithLatency?.csm_persistence?.ok === true
      ? "csm_persistence_incomplete"
      : String(persistedWithLatency?.csm_persistence?.code || "csm_persistence_failed");
    throw markStagedResumeRecovery(Object.assign(new Error(code), {
      code,
      statusCode: persistedWithLatency?.csm_persistence?.ok === true
        ? 503
        : Number(persistedWithLatency?.csm_persistence?.statusCode || 503),
      retryable: Number(persistedWithLatency?.csm_persistence?.statusCode || 503) >= 500
    }));
  }
  const reviewRequired = lotReviewRequiredError(persistedWithLatency, sessionId);
  if (reviewRequired) throw reviewRequired;
  return publicPersistedResult(persistedWithLatency, executionOrigin, canonicalAssetId);
}

function responseStatus(error) {
  for (const candidate of [error?.statusCode, error?.status]) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return 503;
}

function safeReceiptText(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9._:\-/\[\]]{1,240}$/.test(text) ? text : null;
}

export function buildProviderFailureReceipt(error) {
  if (error?.provider_attempt_started !== true) return null;
  const stages = error?.latency_stages_ms && typeof error.latency_stages_ms === "object"
    ? Object.fromEntries(Object.entries(error.latency_stages_ms).flatMap(([name, value]) => (
        /^[a-z][a-z0-9_]*_ms$/.test(name) && Number.isFinite(Number(value))
          ? [[name, Math.max(0, Number(value))]]
          : []
      )))
    : {};
  return {
    schema_version: "csm-provider-failure-receipt-v1",
    stage: "provider_attempt",
    outcome: error?.ambiguous === true ? "unknown" : "definitive_response",
    http_status: responseStatus(error),
    provider_request_id: safeReceiptText(error?.provider_request_id),
    provider_client_request_id: safeReceiptText(error?.provider_client_request_id),
    provider_error_code: safeReceiptText(error?.provider_error_code),
    provider_error_type: safeReceiptText(error?.provider_error_type),
    provider_error_param: safeReceiptText(error?.provider_error_param),
    provider_ms: Number.isFinite(Number(error?.provider_ms))
      ? Math.max(0, Number(error.provider_ms))
      : null,
    latency_stages_ms: stages
  };
}

export function buildCsmDirectFailureResponse(error) {
  const status = responseStatus(error);
  const providerFailureReceipt = buildProviderFailureReceipt(error);
  const retryable = error?.retryable === false
    ? false
    : error?.retryable === true || status >= 500;
  return {
    status,
    providerFailureReceipt,
    body: {
      ok: false,
      route: "CSM_THIN_DIRECT",
      code: String(error?.message || "csm_thin_path_failed").split(":")[0],
      error_type: error?.review_required === true
        ? "CSM_REVIEW_REQUIRED"
        : providerFailureReceipt ? "CSM_PROVIDER_ATTEMPT_FAILED" : "CSM_THIN_PATH_FAILED",
      retryable,
      message: String(error?.message || "CSM thin path failed").slice(0, 240),
      recognition_session_id: safeReceiptText(error?.recognition_session_id),
      ...(error?.review_required === true ? {
        review_required: true,
        trace_status: "PERSISTED_REVIEW_REQUIRED"
      } : {}),
      ...(providerFailureReceipt ? {
        provider_failure_receipt: providerFailureReceipt,
        latency_stages_ms: providerFailureReceipt.latency_stages_ms
      } : {})
    }
  };
}

export default async function handler(req, res) {
  // Everything before `runDirectCsmAsset` was unmeasured, and it is not free:
  // production request logs put a successful request at ~5.4s p50 while the
  // stages recorded inside the route account for ~3.5s. The missing ~1.9s sat
  // in this prologue -- tenant access is a database round trip -- with nothing
  // to attribute it to. These three timers close the request from arrival to
  // response, so the breakdown sums to the number the log already reports.
  const handlerStartedAt = Date.now();
  const prologueStages = {};
  const telemetry = instrumentProductionRequest(req, res, { api: "/api/csm-listing-title" });
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, message: "Method not allowed" });
  let context;
  try {
    const tenantAccessStartedAt = Date.now();
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.CREATE_JOB });
    prologueStages.tenant_access_ms = Date.now() - tenantAccessStartedAt;
    bindProductionRequestContext(res, context);
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
  }
  const rateLimitStartedAt = Date.now();
  if (!enforceApiRateLimit(req, res, {
    scope: "csm_listing_title", limit: 600, windowMs: 60_000,
    identifier: `${context.tenantId}:${context.userId}`,
    message: "Too many recognition requests. Please try again shortly."
  })) return;
  prologueStages.rate_limit_ms = Date.now() - rateLimitStartedAt;

  try {
    const payloadStartedAt = Date.now();
    const payload = await readJsonPayload(req, { maxBytes: 16 * 1024 });
    prologueStages.payload_read_ms = Date.now() - payloadStartedAt;
    const result = await runDirectCsmAsset({
      tenantId: context.tenantId,
      userId: context.userId,
      assetId: payload.asset_id || payload.assetId,
      intentId: payload.intent_id || payload.intentId,
      // Production owns model knobs. Client payloads may carry legacy detail
      // telemetry, but cannot silently create a second execution profile.
      imageDetail: CSM_THIN_RUNTIME_CONTRACT.imageDetail,
      manualRetry: payload.manual_retry === true,
      clientTiming: payload.client_timing || payload.clientTiming || null,
      // Same reason as clientTiming: everything below is assembled AFTER the
      // run has already written latency_stages_ms to the session, so stages
      // added there decorate the reply and never reach a column. These three
      // were added earlier in the same sitting and never landed once --
      // `with_prologue_stages` was 0 across every row in production.
      //
      // `handler_total_ms` stays out on purpose: it cannot be known before
      // persistence, because it measures the request that contains it.
      serverPrologueStages: { ...prologueStages }
    });
    return sendJson(res, 200, {
      ok: true,
      route: "CSM_THIN_DIRECT",
      recognition_session_id: result.csm_rows.resolution.recognition_session_id,
      trace_status: "PERSISTED",
      ...result,
      latency_stages_ms: {
        ...prologueStages,
        ...(result?.latency_stages_ms || {}),
        handler_total_ms: Date.now() - handlerStartedAt
      }
    });
  } catch (error) {
    const { status, providerFailureReceipt, body } = buildCsmDirectFailureResponse(error);
    if (providerFailureReceipt) {
      console.error(JSON.stringify({
        event: "csm_provider_attempt_failed",
        request_id: telemetry.requestId,
        recognition_session_id: safeReceiptText(error?.recognition_session_id),
        ...providerFailureReceipt
      }));
    }
    return sendJson(res, status, body);
  }
}
