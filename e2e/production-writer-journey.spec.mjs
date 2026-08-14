import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT } from "../scripts/build-large-internal-writer-fixture.mjs";
import {
  buildCsmModelExecutionContract,
  buildCsmModelExecutionContractSha256,
  csmExecutionContractImageUrls,
  CSM_ACTIVE_MODEL_PROFILE,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_RECOGNITION_TRANSPORT_PROFILES,
  CSM_STAGED_TRANSPORT_PROFILE,
  sha256CsmRecognitionTransportReceipt,
  validateCsmModelExecutionContract
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { resolveCsmProviderAdapter } from "../lib/listing/thin/csm-provider-adapter.mjs";
import {
  validateCsmProviderAuthorityReceipt
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import {
  CSM_OWNER_EXECUTION_RECEIPT_VERSION,
  computeCsmOwnerExecutionReceiptSha256,
  sealCsmOwnerExecutionReceipt
} from "../lib/listing/thin/csm-owner-execution-receipt.mjs";
import {
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  validateDefinitive502TransportRetryReceipt
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";
import {
  ADMIN_TEST_DATASET_DISPOSITION,
  FEEDBACK_DATASET_DISPOSITION
} from "../lib/listing/feedback/feedback-capture.mjs";
import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT,
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  governedIdentityAuthorityUrl,
  validateFounderBetaWebReceipt
} from "../lib/listing/thin/csm-forward-reader-bridge.mjs";
import {
  CARD_NAME_PREDICATE,
  SET_MEMBERSHIP_PREDICATE,
  validateSetCardNameRelationReceipt
} from "../lib/listing/thin/set-card-name-contract.mjs";
import {
  validateVerifiedOriginalObservationPublicReceipt,
  VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT,
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS,
  WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT,
  WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS,
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "../scripts/materialize-writer-journey-source.mjs";
import {
  PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT,
  productionStandardP0EvidenceProofValid,
  productionStandardP0ResolutionProof,
  productionStandardP0ResolutionProofValid,
  standardP0TitleIdentityExact
} from "../scripts/production-standard-p0-verifier.mjs";
import {
  PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX,
  productionPublicCompositionProjectionForOwner
} from "../scripts/production-public-composition-projection.mjs";
import {
  COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_MARKER,
  COMPATIBILITY_BRIDGE_RELEASE_CLASS,
  COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
  COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_V2_MARKER,
  COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE,
  COMPATIBILITY_BRIDGE_V3_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
  COMPATIBILITY_BRIDGE_V4_MANIFEST_VERSION,
  COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
  EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_DESCRIPTOR_ID,
  EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_MARKER,
  EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_DESCRIPTOR_ID,
  EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_MARKER,
  compatibilityBridgeWriterProjectionMode,
  ORDINARY_RELEASE_CLASS
} from "../scripts/compatibility-bridge-release.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_WRITER_PROJECTION_CONTRACTS
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  buildProductionForwardReadbackExpectation,
  classifyFounderWebSearch,
  FOUNDER_WEB_SEARCH_CLASSIFICATION,
  WEB_IDENTITY_CONTENT_ACCEPTANCE,
  webIdentityContentProjectionProof,
  webIdentityQueryHasVisibleAnchors,
  writeProductionForwardReadbackExpectation
} from "../scripts/production-forward-readback.mjs";
import {
  buildWriterEditableTitleLatencyReceipt,
  summarizeWriterEditableTitleLatency
} from "../scripts/production-writer-title-latency.mjs";
import {
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V2,
  THIN_RESOLVER_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";

const expectedExecutionContractByTransportLaneAndImageCount = Object.freeze(Object.fromEntries(
  CSM_RECOGNITION_TRANSPORT_PROFILES.map((transportProfile) => [
    transportProfile.lane_version,
    Object.freeze(Object.fromEntries([1, 2].map((count) => [String(count),
      buildCsmModelExecutionContract({
        transportProfile,
        imageUrls: csmExecutionContractImageUrls(count)
      })
    ])))
  ])
));
const expectedExecutionContractSha256ByTransportLaneAndImageCount = Object.freeze(
  Object.fromEntries(CSM_RECOGNITION_TRANSPORT_PROFILES.map((transportProfile) => [
    transportProfile.lane_version,
    Object.freeze(Object.fromEntries([1, 2].map((count) => [String(count),
      buildCsmModelExecutionContractSha256({
        transportProfile,
        imageUrls: csmExecutionContractImageUrls(count)
      })
    ])))
  ]))
);
const expectedProviderAdapterContract = resolveCsmProviderAdapter(
  CSM_ACTIVE_MODEL_PROFILE.provider
).contract;
const expectedProviderAdapterVersion = expectedProviderAdapterContract.id;
const expectedMaxOutputTokens = 8192;
const expectedEstimatedTokensPerAttempt = 6_500;
const serverStageRoundingToleranceMs = 4;
const monotonicNowMs = () => Math.round(performance.now());
const CODEX_PARITY_EXPECTED_TITLE =
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls";
const ORDINARY_WRITER_PROJECTION_MODE =
  "ordinary-current-standard-v3-v03-verified-overlay-v2-active-v1";

const artifactDir = path.resolve("artifacts/production-writer-journey");
const evidencePath = path.join(artifactDir, "evidence.json");
const recognitionPaths = new Set(["/api/csm-listing-title", "/api/csm-listing-title-ingest"]);
const canonicalProductionOrigin = "https://listing.lyncafei.team";
const productionOrigin = (() => {
  const raw = String(process.env.WRITER_JOURNEY_BASE_URL || canonicalProductionOrigin).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WRITER_JOURNEY_BASE_URL invalid");
  }
  const candidate = /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)
    && Boolean(String(process.env.WRITER_JOURNEY_INITIAL_STORAGE_STATE || "").trim());
  if (url.protocol !== "https:" || url.origin !== raw || url.pathname !== "/"
    || url.search || url.hash || url.username || url.password
    || (url.origin !== canonicalProductionOrigin && !candidate)) {
    throw new Error("WRITER_JOURNEY_BASE_URL invalid");
  }
  return url.origin;
})();
const stagedRecognitionPath = "/api/csm-listing-title-ingest";
const uploadRelayPath = "/api/listing-image-upload-relay";
const stagedRecognitionRole = "readability_derived";
const originalRoles = Object.freeze(["image_1_original", "image_2_original"]);
const verifierErrorCodes = Object.freeze({
  GENERIC: "WRITER_JOURNEY_FAILED",
  TITLE_NOT_READY: "TITLE_NOT_READY",
  TITLE_UI_RECOGNITION_MISMATCH: "TITLE_UI_RECOGNITION_MISMATCH",
  TITLE_STORED_UI_MISMATCH: "TITLE_STORED_UI_MISMATCH",
  TITLE_CHANGED_AFTER_GLASS_BOX: "TITLE_CHANGED_AFTER_GLASS_BOX",
  VERSION_CONTRACT_MISMATCH: "VERSION_CONTRACT_MISMATCH",
  VERSION_RESOLVER_MISMATCH: "VERSION_RESOLVER_MISMATCH",
  VERSION_COMPOSER_MISMATCH: "VERSION_COMPOSER_MISMATCH",
  STANDARD_P0_IDENTITY_MISMATCH: "STANDARD_P0_IDENTITY_MISMATCH",
  FEEDBACK_EXCHANGE_MISMATCH: "FEEDBACK_EXCHANGE_MISMATCH",
  FEEDBACK_SESSION_MISMATCH: "FEEDBACK_SESSION_MISMATCH",
  FEEDBACK_ACTION_MISMATCH: "FEEDBACK_ACTION_MISMATCH",
  FEEDBACK_REQUEST_TITLE_MISMATCH: "FEEDBACK_REQUEST_TITLE_MISMATCH",
  FEEDBACK_RESPONSE_TITLE_MISMATCH: "FEEDBACK_RESPONSE_TITLE_MISMATCH",
  RUNTIME_CONTRACT_MISMATCH: "RUNTIME_CONTRACT_MISMATCH",
  LIVE_EXECUTION_RECEIPT_MISMATCH: "LIVE_EXECUTION_RECEIPT_MISMATCH",
  CODEX_PARITY_MISMATCH: "CODEX_PARITY_MISMATCH",
  EXTERNAL_IDENTITY_SUPPORT_MISMATCH: "EXTERNAL_IDENTITY_SUPPORT_MISMATCH",
  ROUTE_COVERAGE_MISMATCH: "ROUTE_COVERAGE_MISMATCH",
  LARGE_FIXTURE_INVALID: "LARGE_FIXTURE_INVALID",
  LARGE_OWNER_REQUIRED: "LARGE_OWNER_REQUIRED",
  LARGE_PRESPEND_GATE_FAILED: "LARGE_PRESPEND_GATE_FAILED",
  LARGE_RELAY_CONTRACT_MISMATCH: "LARGE_RELAY_CONTRACT_MISMATCH",
  LARGE_RESPONSE_CONTRACT_MISMATCH: "LARGE_RESPONSE_CONTRACT_MISMATCH",
  FEEDBACK_POLICY_MISMATCH: "FEEDBACK_POLICY_MISMATCH",
  ACTIVATION_RECEIPT_MISMATCH: "ACTIVATION_RECEIPT_MISMATCH",
  WRITER_TITLE_LATENCY_HARD_LIMIT_EXCEEDED: "WRITER_TITLE_LATENCY_HARD_LIMIT_EXCEEDED"
});
const allowedVerifierErrorCodes = new Set(Object.values(verifierErrorCodes));
const liveFailureCaseIds = new Set([
  "NON_TCG", "TCG", "EXTERNAL_IDENTITY", "NON_TCG_WEB_IDENTITY",
  "LOT_SHARED_ONLY", "LARGE_STAGED_TRANSPORT"
]);
const liveFailurePhases = new Set([
  "HEALTH",
  "LOGIN",
  "PAGE_READY",
  "RECOGNITION_RESPONSE",
  "EXECUTION_RECEIPT",
  "ROUTE_COVERAGE",
  "TITLE_UI",
  "RESOLUTION_VIEW",
  "EXTERNAL_IDENTITY_SUPPORT",
  "GLASS_BOX",
  "FEEDBACK",
  "CASE_COMPLETE",
  "OWNER_AUTHORIZATION",
  "LARGE_RECOGNITION",
  "LARGE_RESOLUTION",
  "LARGE_FEEDBACK",
  "FINAL_SEAL"
]);

function verifierFailure(code) {
  const safeCode = allowedVerifierErrorCodes.has(code) ? code : verifierErrorCodes.GENERIC;
  return Object.assign(new Error(safeCode), { verifier_error_code: safeCode });
}

function requireInvariant(value, code) {
  if (!value) throw verifierFailure(code);
}

function codexParityTitleMatches({ recognitionTitle, uiTitle, storedTitle = null } = {}) {
  return recognitionTitle === CODEX_PARITY_EXPECTED_TITLE
    && uiTitle === CODEX_PARITY_EXPECTED_TITLE
    && (storedTitle === null || storedTitle === CODEX_PARITY_EXPECTED_TITLE);
}

function sanitizedFailureCode(error) {
  const code = String(error?.verifier_error_code || "").trim();
  return allowedVerifierErrorCodes.has(code) ? code : verifierErrorCodes.GENERIC;
}

function titleSha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

async function waitForExactEditableTitle(titleInput, expectedTitleSha256) {
  await expect(titleInput).toBeEnabled({ timeout: 6 * 60 * 1000 });
  let titleEditableAtMs = null;
  await expect.poll(async () => {
    const currentTitle = await titleInput.inputValue();
    if (/^(?!标题暂不可用$).{1,80}$/u.test(currentTitle)
        && titleSha256(currentTitle) === expectedTitleSha256) {
      titleEditableAtMs ??= monotonicNowMs();
      return true;
    }
    return false;
  }, {
    timeout: 6 * 60 * 1000,
    intervals: [250, 500, 1_000, 2_000]
  }).toBe(true).catch(() => { throw verifierFailure(verifierErrorCodes.TITLE_NOT_READY); });
  if (titleEditableAtMs === null) throw verifierFailure(verifierErrorCodes.TITLE_NOT_READY);
  return titleEditableAtMs;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function healthRecognitionTransportContractMatches(runtime) {
  return CSM_RECOGNITION_TRANSPORT_PROFILES.every((profile) => {
    const lane = profile.lane_version;
    return stableJson(runtime?.recognition_transport_profiles?.[lane]) === stableJson({
      ...profile,
      sha256: sha256CsmRecognitionTransportReceipt(profile)
    })
      && runtime?.execution_contract_sha256_by_transport_lane_and_image_count?.[lane]?.["1"]
        === expectedExecutionContractSha256ByTransportLaneAndImageCount[lane]["1"]
      && runtime?.execution_contract_sha256_by_transport_lane_and_image_count?.[lane]?.["2"]
        === expectedExecutionContractSha256ByTransportLaneAndImageCount[lane]["2"];
  });
}

function healthExternalIdentityContractMatches(runtime) {
  return stableJson(runtime?.external_identity) === stableJson(EXTERNAL_IDENTITY_RELEASE_CONTRACT);
}

function capturedProductionWriterMode(writerProjectionMode) {
  return writerProjectionMode === COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE;
}

function expectedCanonicalNamingContract(writerProjectionMode) {
  return capturedProductionWriterMode(writerProjectionMode)
    ? CANONICAL_NAMING_RELEASE_CONTRACT_V2
    : CANONICAL_NAMING_RELEASE_CONTRACT;
}

function expectedVerifiedOriginalObservationHealthReceipt(writerProjectionMode) {
  return capturedProductionWriterMode(writerProjectionMode)
    ? VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT
    : VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT;
}

function healthCanonicalNamingContractMatches(runtime, writerProjectionMode) {
  return stableJson(runtime?.canonical_naming_target)
    === stableJson(expectedCanonicalNamingContract(writerProjectionMode));
}

function healthVerifiedOriginalObservationContractMatches(runtime, writerProjectionMode) {
  return stableJson(runtime?.verified_original_observation)
    === stableJson(expectedVerifiedOriginalObservationHealthReceipt(writerProjectionMode));
}

function healthProjectionActivationMatches(runtime, writerProjectionMode) {
  if (!capturedProductionWriterMode(writerProjectionMode)) return true;
  return stableJson(runtime?.projection_activation) === stableJson(CSM_PROJECTION_ACTIVATION)
    && stableJson(runtime?.active_writer)
      === stableJson(CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible)
    && stableJson(runtime?.forward_readers)
      === stableJson(CSM_PROJECTION_ACTIVATION.forward_readers);
}

function writerJourneyHealthReceipt({
  httpOk = false,
  health = null,
  expectedSha = "",
  expectedOrigin = "",
  responseUrl = "",
  writerProjectionMode = ORDINARY_WRITER_PROJECTION_MODE
} = {}) {
  const expectedHealthUrl = `${expectedOrigin}/api/health`;
  let observedOrigin = "UNEXPECTED";
  try {
    const observedUrl = new URL(responseUrl);
    if (observedUrl.href === expectedHealthUrl) observedOrigin = observedUrl.origin;
  } catch {
    // Keep the sanitized sentinel.
  }
  const receipt = {
    http_ok: httpOk === true,
    ready: health?.ready === true,
    active_path: health?.active_path,
    model: health?.model,
    reasoning_effort: health?.reasoning_effort,
    deployment_origin: observedOrigin,
    deployment_identity: `${observedOrigin}#${expectedSha}`,
    deployment_git_commit_sha: health?.deployment?.git_commit_sha,
    deployment_environment: health?.deployment?.environment,
    canonical_naming_contract_valid:
      healthCanonicalNamingContractMatches(health?.runtime, writerProjectionMode),
    canonical_naming_release_contract: health?.runtime?.canonical_naming_target,
    verified_original_observation_release_receipt:
      health?.runtime?.verified_original_observation,
    runtime_contract_valid: health?.runtime?.model_profile_id === CSM_ACTIVE_MODEL_PROFILE.id
      && health?.runtime?.provider_adapter_version === expectedProviderAdapterVersion
      && health?.runtime?.request_builder_version
        === expectedProviderAdapterContract.request_builder_version
      && healthRecognitionTransportContractMatches(health?.runtime)
      && healthExternalIdentityContractMatches(health?.runtime)
      && healthCanonicalNamingContractMatches(health?.runtime, writerProjectionMode)
      && healthVerifiedOriginalObservationContractMatches(
        health?.runtime, writerProjectionMode
      )
      && healthProjectionActivationMatches(health?.runtime, writerProjectionMode)
      && health?.runtime?.max_output_tokens === CSM_ACTIVE_MODEL_PROFILE.max_output_tokens
      && health?.runtime?.retired_capabilities_disabled === true
  };
  requireInvariant(receipt.http_ok
    && receipt.ready
    && receipt.active_path === "CSM_THIN_DIRECT"
    && receipt.model === CSM_ACTIVE_MODEL_PROFILE.model
    && receipt.reasoning_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
    && expectedOrigin === productionOrigin
    && responseUrl === `${productionOrigin}/api/health`
    && receipt.deployment_origin === productionOrigin
    && receipt.deployment_identity === `${productionOrigin}#${expectedSha}`
    && receipt.deployment_git_commit_sha === expectedSha
    && receipt.deployment_environment === "production"
    && stableJson(receipt.canonical_naming_release_contract)
      === stableJson(expectedCanonicalNamingContract(writerProjectionMode))
    && stableJson(receipt.verified_original_observation_release_receipt)
      === stableJson(expectedVerifiedOriginalObservationHealthReceipt(writerProjectionMode))
    && receipt.runtime_contract_valid,
  verifierErrorCodes.RUNTIME_CONTRACT_MISMATCH);
  return Object.freeze(receipt);
}

function feedbackPolicyReceipt({ httpOk = false, payload = null } = {}) {
  const receipt = {
    feedback_http_ok: httpOk === true,
    feedback_saved: payload?.v4_persistence?.transaction?.saved === true,
    feedback_data_use: payload?.feedback_data_use === ADMIN_TEST_DATASET_DISPOSITION
      ? ADMIN_TEST_DATASET_DISPOSITION
      : "UNEXPECTED",
    dataset_disposition: payload?.dataset_disposition === FEEDBACK_DATASET_DISPOSITION
      ? FEEDBACK_DATASET_DISPOSITION
      : "UNEXPECTED",
    durable_dataset_disposition:
      payload?.v4_persistence?.transaction?.transaction?.dataset_disposition
        === FEEDBACK_DATASET_DISPOSITION
        ? FEEDBACK_DATASET_DISPOSITION
        : "UNEXPECTED",
    training_eligible: payload?.training_eligible === false ? false : null,
    production_promotion_eligible: payload?.production_promotion_eligible === false ? false : null
  };
  return Object.freeze({
    ...receipt,
    feedback_policy_passed: receipt.feedback_http_ok
      && receipt.feedback_saved
      && receipt.feedback_data_use === ADMIN_TEST_DATASET_DISPOSITION
      && receipt.dataset_disposition === FEEDBACK_DATASET_DISPOSITION
      && receipt.durable_dataset_disposition === FEEDBACK_DATASET_DISPOSITION
      && receipt.training_eligible === false
      && receipt.production_promotion_eligible === false
  });
}

function decodeBase64UrlJson(value, code) {
  try {
    const encoded = String(value || "").trim();
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("invalid");
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid");
    return decoded;
  } catch {
    throw verifierFailure(code);
  }
}

function exactObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return exactObject(value)
    && Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

const liveExecutionEvidenceKeys = Object.freeze([
  "execution_origin",
  "model_profile_id",
  "optimization_pack_id",
  "optimization_pack_sha256",
  "provider_adapter_version",
  "request_builder_version",
  "response_parser_version",
  "transport_profile_id",
  "transport_profile_sha256",
  "execution_contract_sha256",
  "max_output_tokens",
  "owner_execution_receipt_version",
  "owner_execution_receipt_sha256",
  "provider_authority_receipt",
  "provider_transport_retry_receipt",
  "provider_response_completed",
  "provider_response_status_attested",
  "provider_response_incomplete",
  "provider_response_id_present",
  "provider_response_id_sha256",
  "response_session_patch_fields_match",
  "execution_contract_embedded_valid",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
  "safe_token_usage",
  "positive_token_usage",
  "provider_attempt_number",
  "provider_retry_count",
  "served_model_attested",
  "served_model_consistent",
  "served_model_unknown",
  "served_effort_attested",
  "served_effort_consistent",
  "served_effort_unknown",
  "served_effort_conflict",
  "server_stages_ms"
]);

const requiredServerStageNames = Object.freeze([
  "authority_enqueue_ms",
  "authority_claim_ms",
  "authority_settle_ms",
  "authority_dispatch_ms",
  "provider_ms",
  "csm_persistence_ms",
  "request_total_ms"
]);

const durableOwnerReadbackEvidenceKeys = Object.freeze([
  "version", "sha256", "durable_read_after_write"
]);

const providerAuthorityReceiptEvidenceKeys = Object.freeze([
  "schema_version",
  "operation_key_sha256",
  "attempt",
  "attempt_class",
  "estimated_tokens",
  "claim_code",
  "settle_code",
  "operation_status"
]);

function providerAttemptsForWriter(writerProjectionMode) {
  return capturedProductionWriterMode(writerProjectionMode) ? [1, 2, 3] : [1, 2];
}

function providerAuthorityReceiptProof(payload, owner, code, writerProjectionMode) {
  const attempt = Number(payload?.provider_attempt_number);
  let receipt;
  try {
    receipt = validateCsmProviderAuthorityReceipt(payload?.provider_authority_receipt, {
      attempt
    });
  } catch {
    throw verifierFailure(code);
  }
  requireInvariant(CSM_ACTIVE_MODEL_PROFILE.estimated_tokens_per_attempt
    === expectedEstimatedTokensPerAttempt
    && hasExactKeys(receipt, providerAuthorityReceiptEvidenceKeys)
    && receipt.schema_version === "csm-provider-authority-receipt-v1"
    && /^[0-9a-f]{64}$/.test(receipt.operation_key_sha256)
    && providerAttemptsForWriter(writerProjectionMode).includes(attempt)
    && receipt.attempt === attempt
    && receipt.attempt_class === (attempt === 1 ? "fresh" : "retry")
    && receipt.estimated_tokens === expectedEstimatedTokensPerAttempt
    && ["admitted", "claim_receipt_replayed"].includes(receipt.claim_code)
    && ["settled", "exact_replay"].includes(receipt.settle_code)
    && receipt.operation_status === "SUCCEEDED"
    && payload?.recognition_session_id
      === `csmsess_${receipt.operation_key_sha256.slice(0, 40)}`
    && !Object.prototype.hasOwnProperty.call(owner, "provider_authority_receipt"),
  code);
  return receipt;
}

function providerTransportRetryReceiptProof(
  payload,
  owner,
  authorityReceipt,
  code,
  writerProjectionMode
) {
  if (capturedProductionWriterMode(writerProjectionMode)) {
    requireInvariant(providerAttemptsForWriter(writerProjectionMode).includes(
      payload?.provider_attempt_number
    )
      && payload?.provider_retry_count === payload.provider_attempt_number - 1
      && !Object.prototype.hasOwnProperty.call(payload, "provider_transport_retry_receipt")
      && !Object.prototype.hasOwnProperty.call(owner, "provider_transport_retry_receipt")
      && authorityReceipt.attempt === payload.provider_attempt_number,
    code);
    return null;
  }
  const firstAttempt = payload?.provider_attempt_number === 1
    && payload?.provider_retry_count === 0;
  const retryAttempt = payload?.provider_attempt_number === 2
    && payload?.provider_retry_count === 1;
  requireInvariant(firstAttempt || retryAttempt, code);
  if (firstAttempt) {
    requireInvariant(!Object.prototype.hasOwnProperty.call(
      payload, "provider_transport_retry_receipt"
    ) && owner?.provider_transport_retry_receipt === null, code);
    return null;
  }
  let receipt;
  try {
    receipt = validateDefinitive502TransportRetryReceipt(
      payload?.provider_transport_retry_receipt
    );
  } catch {
    throw verifierFailure(code);
  }
  requireInvariant(receipt.operation_key_sha256 === authorityReceipt.operation_key_sha256
    && receipt.model === CSM_ACTIVE_MODEL_PROFILE.model
    && receipt.provider === CSM_ACTIVE_MODEL_PROFILE.provider
    && receipt.retry_attempt === authorityReceipt.attempt
    && authorityReceipt.attempt_class === "retry"
    && stableJson(owner?.provider_transport_retry_receipt) === stableJson(receipt)
    && payload?.provider_client_request_id === receipt.retry_provider_client_request_id
    && owner?.provider_client_request_id === receipt.retry_provider_client_request_id
    && receipt.provider_client_request_id !== receipt.retry_provider_client_request_id,
  code);
  return receipt;
}

function durableOwnerExecutionReadbackProof(executionReceipt, resolutionView) {
  const code = verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH;
  const readback = resolutionView?.owner_execution_receipt;
  requireInvariant(hasExactKeys(readback, ["version", "sha256"])
    && readback.version === CSM_OWNER_EXECUTION_RECEIPT_VERSION
    && /^[0-9a-f]{64}$/.test(String(readback.sha256 || ""))
    && readback.version === executionReceipt?.owner_execution_receipt_version
    && readback.sha256 === executionReceipt?.owner_execution_receipt_sha256,
  code);
  const proof = Object.freeze({
    version: readback.version,
    sha256: readback.sha256,
    durable_read_after_write: true
  });
  requireInvariant(hasExactKeys(proof, durableOwnerReadbackEvidenceKeys), code);
  return proof;
}

const WEB_IDENTITY_FIELDS = new Set([
  "year", "manufacturer", "product", "set", "card_name", "subjects"
]);

function activationProjectionProof(sourceCase, resolutionView, title) {
  const code = verifierErrorCodes.ACTIVATION_RECEIPT_MISMATCH;
  let webReceipt;
  let relationReceipt;
  try {
    webReceipt = validateFounderBetaWebReceipt(
      resolutionView?.founder_beta_web_receipt
    );
    const relationFields = {
      set: resolutionView?.set_card_name_relation_receipt?.set?.value || "",
      card_name:
        resolutionView?.set_card_name_relation_receipt?.card_name?.value || ""
    };
    relationReceipt = validateSetCardNameRelationReceipt(
      resolutionView?.set_card_name_relation_receipt,
      relationFields
    );
  } catch {
    throw verifierFailure(code);
  }
  requireInvariant(webReceipt.provider_request_count === 1
    && webReceipt.isolated_model_call_count === 0
    && relationReceipt?.set?.predicate === SET_MEMBERSHIP_PREDICATE
    && relationReceipt?.card_name?.predicate === CARD_NAME_PREDICATE,
  code);
  const setText = relationReceipt.set.value;
  const cardNameText = relationReceipt.card_name.value;
  requireInvariant(setText === WEB_IDENTITY_CONTENT_ACCEPTANCE.set
    && cardNameText === WEB_IDENTITY_CONTENT_ACCEPTANCE.card_name
    && title === resolutionView?.composer?.stored_title
    && webIdentityContentProjectionProof(resolutionView),
  code);
  return Object.freeze({
    web_search_used: webReceipt.web_search_used,
    web_search_call_count: webReceipt.web_search_call_count,
    query_visible_anchor_match: !webReceipt.web_search_used
      || webIdentityQueryHasVisibleAnchors(webReceipt.queries),
    source_url_count: webReceipt.urls.length,
    source_authority_fields: webReceipt.field_evidence.map((entry) => entry.field),
    set_predicate: relationReceipt.set.predicate,
    card_name_predicate: relationReceipt.card_name.predicate,
    card_name_before_subject: true
  });
}

function activationProjectionProofForCase(sourceCase, resolutionView, title) {
  if (sourceCase.case_id !== "NON_TCG_WEB_IDENTITY") return null;
  return activationProjectionProof(sourceCase, resolutionView, title);
}

function capturedProductionProjectionReceiptsOmitted(resolutionView) {
  return exactObject(resolutionView)
    && [
      "founder_beta_web_receipt",
      "set_card_name_relation_receipt",
      "publication_coverage",
      "lot_terminal"
    ].every((key) => !Object.prototype.hasOwnProperty.call(resolutionView, key))
    && (resolutionView.brackets || []).every((bracket) => (
      !Object.prototype.hasOwnProperty.call(bracket || {}, "publication_coverage")
    ));
}

function publicProjectionSupportOmitted(resolutionView, keys) {
  return keys.every((key) => !Object.prototype.hasOwnProperty.call(
    resolutionView || {}, key
  ));
}

function founderWebSearchProof(sourceCase, resolutionView, {
  writerProjectionMode = ORDINARY_WRITER_PROJECTION_MODE
} = {}) {
  const code = verifierErrorCodes.ACTIVATION_RECEIPT_MISMATCH;
  if (capturedProductionWriterMode(writerProjectionMode)) {
    requireInvariant(capturedProductionProjectionReceiptsOmitted(resolutionView), code);
    return null;
  }
  let receipt;
  try {
    receipt = validateFounderBetaWebReceipt(
      resolutionView?.founder_beta_web_receipt
    );
  } catch {
    throw verifierFailure(code);
  }
  const actualSearch = receipt.web_search_used;
  const visibleAnchorContract = WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.find(
    (contract) => contract.case_id === "NON_TCG_WEB_IDENTITY"
  );
  const visibleAnchorCase = sourceCase.original_set_sha256
    === visibleAnchorContract?.original_set_sha256;
  const governedSupportRows = receipt.field_evidence.filter((entry) => (
    WEB_IDENTITY_FIELDS.has(entry.field) && entry.support_urls.length > 0
    && entry.support_urls.every(governedIdentityAuthorityUrl)
  ));
  const classification = classifyFounderWebSearch(receipt, resolutionView, {
    originalSetSha256: sourceCase.original_set_sha256
  });
  requireInvariant(receipt.provider_request_count === 1
    && receipt.isolated_model_call_count === 0
    && classification != null
    && (!actualSearch || (
      receipt.web_search_call_count >= 1
      && receipt.web_search_call_count <= CANONICAL_WEB_SEARCH_MAX_TOOL_CALLS
      && (!visibleAnchorCase || receipt.queries.length === 0
        || webIdentityQueryHasVisibleAnchors(receipt.queries))
    )),
  code);
  return Object.freeze({
    web_search_used: receipt.web_search_used,
    web_search_call_count: receipt.web_search_call_count,
    query_recorded: receipt.queries.length > 0,
    query_visible_anchor_match: !actualSearch || !visibleAnchorCase
      || receipt.queries.length === 0
      || webIdentityQueryHasVisibleAnchors(receipt.queries),
    source_url_count: receipt.urls.length,
    governed_support_url_count: new Set(governedSupportRows.flatMap(
      (entry) => entry.support_urls
    )).size,
    governed_support_fields: governedSupportRows.map((entry) => entry.field),
    classification: classification.classification,
    governed_applied_support: classification.governed_applied_support,
    strict_no_search: classification.strict_no_search,
    used_without_governed_applied_support:
      classification.used_without_governed_applied_support,
    unresolved_authority_fields: receipt.field_evidence.filter(
      (entry) => entry.unresolved_urls.length > 0 || (
        entry.support_urls.length === 0
        && entry.conflict_urls.length === 0
        && entry.unresolved_urls.length === 0
      )
    ).map((entry) => entry.field)
  });
}

function lotSharedOnlyProjectionProof(sourceCase, resolutionView, title) {
  const code = verifierErrorCodes.ACTIVATION_RECEIPT_MISMATCH;
  const terminal = resolutionView?.lot_terminal;
  const lotCount = resolutionView?.brackets?.find(
    (entry) => entry?.canonical_field === "lot_count" || entry?.bracket === "lot"
  );
  const subjectText = resolutionView?.brackets?.find(
    (entry) => entry?.bracket === "subject"
  )?.rendered_text || "";
  const expectedSubjects = ["Sam Petersen", "Luis Cova", "David Davalillo"];
  requireInvariant(terminal?.applicable === true
    && terminal?.publishable === true
    && terminal?.failure_code == null
    && terminal?.lot_quantity_unresolved === false
    && terminal?.lot_single_card === false
    && String(lotCount?.value || "") === sourceCase.expected_lot_count
    && title.startsWith(`Lot*${sourceCase.expected_lot_count} `)
    && expectedSubjects.every((subject) => subjectText.includes(subject)
      && title.includes(subject))
    && !/(?:034\/499|132\/250|018\/125|\/499|\/250|\/125)/u.test(title),
  code);
  return Object.freeze({
    expected_lot_count: sourceCase.expected_lot_count,
    marker_exact: true,
    publishable: true,
    individual_serials_withheld: true,
    lot_unshared_attributes: terminal.lot_unshared_attributes
  });
}

function externalIdentityParityProof(resolutionView) {
  const code = verifierErrorCodes.EXTERNAL_IDENTITY_SUPPORT_MISMATCH;
  const support = resolutionView?.external_identity_support;
  const release = EXTERNAL_IDENTITY_RELEASE_CONTRACT;
  const expectedSources = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map((source) => ({
    provider: source.source_id.startsWith("tcdb.")
      ? "TCDB"
      : source.source_id.startsWith("psa.") ? "PSA" : "Beckett",
    source_id: source.source_id,
    url: source.url,
    retrieved_at: source.retrieved_at,
    fact_sha256: source.fact_sha256
  }));
  const actualSources = Array.isArray(support?.sources) ? support.sources : [];
  const expectedFields = [
    "card_number", "manufacturer", "product", "set", "subjects", "team", "year"
  ];
  requireInvariant(support?.schema_version === "csm-external-identity-public-receipt.v1"
    && support?.status === "APPLIED"
    && support?.match_basis === "VERIFIED_ORIGINAL_SET"
    && !Object.prototype.hasOwnProperty.call(support, "original_set_sha256")
    && support?.registry_release?.id === release.registry_release.id
    && support?.registry_release?.registry_version
      === THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.registry_version
    && support?.registry_release?.content_sha256 === release.registry_release.content_sha256
    && support?.registry_release?.sem_standard_version
      === THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT.sem_standard_version
    && support?.resolver_version === release.resolution_contract.resolver_version
    && support?.conflict_policy_version === release.resolution_contract.conflict_policy_version
    && support?.composer_version === release.resolution_contract.composer_version
    && support?.marketplace_profile_version
      === release.resolution_contract.marketplace_profile_version
    && support?.resolution_contract_sha256 === release.resolution_contract.sha256
    && support?.pack?.id === release.support_pack.id
    && support?.pack?.version === release.support_pack.version
    && support?.pack?.sha256 === release.support_pack.sha256
    && support?.index?.id === release.index.id
    && support?.index?.version === release.index.version
    && support?.index?.sha256 === release.index.sha256
    && support?.record_id === "tcdb-2551-hr14"
    && ["FILL", "CORROBORATE", "NORMALIZE_ALIAS"]
      .includes(support?.field_decisions?.card_number?.action)
    && [...(support?.supported_fields || [])].sort().join("\0") === expectedFields.join("\0")
    && Object.keys(support?.field_decisions || {}).sort().join("\0")
      === expectedFields.join("\0")
    && Object.entries(support.field_decisions).every(([field, decision]) => (
      ["FILL", "CORROBORATE", "NORMALIZE_ALIAS", "CORRECT_CONFLICT"].includes(decision?.action)
      && (decision?.action !== "CORRECT_CONFLICT" || ["year", "set"].includes(field))
      && Array.isArray(decision?.source_ids)
      && decision.source_ids.length > 0
    ))
    && actualSources.length === expectedSources.length
    && expectedSources.every((expected) => actualSources.some((actual) => (
      actual?.provider === expected.provider
      && actual?.source_id === expected.source_id
      && actual?.url === expected.url
      && actual?.retrieved_at === expected.retrieved_at
      && actual?.fact_sha256 === expected.fact_sha256
      && Array.isArray(actual?.fields)
      && actual.fields.length > 0
    ))),
  code);
  return Object.freeze({
    applied: true,
    match_basis: support.match_basis,
    record_id: support.record_id,
    registry_release_id: support.registry_release.id,
    registry_release_sha256: support.registry_release.content_sha256,
    pack_id: support.pack.id,
    pack_sha256: support.pack.sha256,
    index_id: support.index.id,
    index_sha256: support.index.sha256,
    resolution_contract_sha256: support.resolution_contract_sha256,
    supported_fields: expectedFields,
    source_count: actualSources.length,
    source_ids: actualSources.map((source) => source.source_id).sort()
  });
}

function liveServerStageReceipt(payload, code) {
  const stages = payload?.latency_stages_ms;
  requireInvariant(exactObject(stages)
    && requiredServerStageNames.every((name) => (
      Object.prototype.hasOwnProperty.call(stages, name)
    )),
  code);
  const receipt = Object.fromEntries(requiredServerStageNames.map((name) => {
    const value = stages[name];
    requireInvariant(typeof value === "number" && Number.isFinite(value) && value >= 0, code);
    return [name, value];
  }));
  requireInvariant(hasExactKeys(receipt, requiredServerStageNames), code);
  const childStageNames = requiredServerStageNames.filter((name) => name !== "request_total_ms");
  const authoritySequentialMs = [
    "authority_enqueue_ms", "authority_claim_ms", "provider_ms", "authority_settle_ms"
  ].reduce((total, name) => total + receipt[name], 0);
  requireInvariant(childStageNames.every((name) => (
    receipt.request_total_ms >= receipt[name]
  ))
    && receipt.authority_dispatch_ms >= receipt.provider_ms
    && receipt.authority_dispatch_ms + serverStageRoundingToleranceMs
      >= authoritySequentialMs
    && receipt.request_total_ms
      >= receipt.authority_dispatch_ms + receipt.csm_persistence_ms,
  code);
  return Object.freeze(receipt);
}

function warmupResponseReceipt(requests) {
  const responses = requests.filter((entry) => (
    entry.response_observed === true
    && Number.isInteger(entry.response_status)
    && entry.response_status >= 100
    && entry.response_status <= 599
    && Number.isSafeInteger(entry.request_sequence)
    && Number.isSafeInteger(entry.response_sequence)
    && entry.response_sequence > entry.request_sequence
  ));
  requireInvariant(responses.length >= 1, verifierErrorCodes.RUNTIME_CONTRACT_MISMATCH);
  return Object.freeze({
    passed: true,
    request_count: requests.length,
    response_count: responses.length,
    http_statuses: [...new Set(responses.map((entry) => entry.response_status))].sort()
  });
}

function recognitionPostSeal(recognitionPosts, evidenceCases) {
  const continued = recognitionPosts.filter((entry) => entry.continued === true);
  const aborted = recognitionPosts.filter((entry) => entry.aborted_before_network === true);
  const expectedContinued = evidenceCases.length;
  requireInvariant(expectedContinued >= 1
    && new Set(evidenceCases.map((entry) => entry.case_id)).size === expectedContinued
    && recognitionPosts.length === expectedContinued + 1
    && continued.length === expectedContinued
    && aborted.length === 1
    && continued.length + aborted.length === recognitionPosts.length
    && recognitionPosts.every((entry) => (
      entry.continued === !entry.aborted_before_network
    ))
    && new Set(continued.map((entry) => entry.recognition_session_id)).size === expectedContinued
    && new Set(continued.map((entry) => entry.provider_response_id_sha256)).size
      === expectedContinued
    && continued.every((entry) => (
      entry.response_observed === true
      && entry.response_status === 200
      && evidenceCases.some((caseEvidence) => (
        caseEvidence.case_id === entry.case_id
        && caseEvidence.recognition_session_id === entry.recognition_session_id
        && caseEvidence.execution_receipt?.provider_response_id_sha256
          === entry.provider_response_id_sha256
        ))
    ))
    && evidenceCases.every((caseEvidence) => continued.filter((entry) => (
      caseEvidence.case_id === entry.case_id
      && caseEvidence.recognition_session_id === entry.recognition_session_id
      && caseEvidence.execution_receipt?.provider_response_id_sha256
        === entry.provider_response_id_sha256
    )).length === 1),
  verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
  return Object.freeze({
    recognition_post_count: recognitionPosts.length,
    network_continued_provider_requests: continued.length,
    extra_provider_recovery_requests: 0
  });
}

function publicRecognitionPayloadBoundary(payload, owner, code) {
  const forbiddenTopLevel = [
    "external_identity_support", "csm_persistence_checkpoint", "accuracy_loss_ledger",
    "observed_fields", "resolution_contract"
  ];
  const serialized = JSON.stringify(payload);
  const projection = productionPublicCompositionProjectionForOwner(owner);
  const publicOutput = payload?.csm_rows?.output;
  requireInvariant(exactObject(payload)
    && exactObject(projection)
    && forbiddenTopLevel.every((key) => !Object.prototype.hasOwnProperty.call(payload, key))
    && !serialized.includes('"original_set_sha256"')
    && !serialized.includes('"source_ref"')
    && hasExactKeys(payload.csm_rows, ["output", "resolution"])
    && hasExactKeys(payload.csm_rows.resolution, [
      "contract_version", "recognition_session_id", "resolver_version"
    ])
    && hasExactKeys(publicOutput, projection.public_output_keys)
    && publicOutput.composer_version === owner.composer
    && (projection.marketplace_profile_public
      ? publicOutput.marketplace_profile_version === owner.marketplace_profile
      : !Object.prototype.hasOwnProperty.call(publicOutput, "marketplace_profile_version"))
    && hasExactKeys(payload.csm_persistence, ["atomic", "ok", "session"])
    && payload.csm_persistence.ok === true
    && payload.csm_persistence.atomic === true
    && hasExactKeys(payload.csm_persistence.session, ["saved"])
    && payload.csm_persistence.session.saved === true,
  code);
}

function liveExecutionReceiptProof(payload, {
  imageCount = 2,
  transportProfile,
  writerProjectionMode = ORDINARY_WRITER_PROJECTION_MODE
} = {}) {
  const code = verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH;
  const owner = payload?.csm_owner_versions;
  const laneVersion = String(transportProfile?.lane_version || "");
  const expectedExecutionContract =
    expectedExecutionContractByTransportLaneAndImageCount[laneVersion]?.[String(imageCount)];
  const expectedExecutionContractSha256 =
    expectedExecutionContractSha256ByTransportLaneAndImageCount[laneVersion]?.[String(imageCount)];
  requireInvariant(exactObject(owner)
    && CSM_RECOGNITION_TRANSPORT_PROFILES.includes(transportProfile)
    && exactObject(expectedExecutionContract)
    && /^[0-9a-f]{64}$/.test(String(expectedExecutionContractSha256 || ""))
    && CSM_ACTIVE_MODEL_PROFILE.max_output_tokens === expectedMaxOutputTokens,
  code);
  // Request provenance is deliberately HTTP-only. A replay must never inherit
  // FRESH_CURRENT from a persisted session patch, so do not compare this to
  // csm_owner_versions or persist it as an execution-contract field. The
  // complete model receipt still needs a separate DB readback hash before it
  // may be described as read-after-write evidence.
  requireInvariant(payload?.execution_origin === "FRESH_CURRENT"
    && !Object.prototype.hasOwnProperty.call(owner, "execution_origin"),
  code);
  const ownerExecutionReceiptVersion = owner?.owner_execution_receipt_version;
  const ownerExecutionReceiptSha256 = owner?.owner_execution_receipt_sha256;
  let computedOwnerExecutionReceiptSha256 = null;
  try {
    computedOwnerExecutionReceiptSha256 = computeCsmOwnerExecutionReceiptSha256(owner);
  } catch {
    throw verifierFailure(code);
  }
  requireInvariant(ownerExecutionReceiptVersion === CSM_OWNER_EXECUTION_RECEIPT_VERSION
    && /^[0-9a-f]{64}$/.test(String(ownerExecutionReceiptSha256 || ""))
    && computedOwnerExecutionReceiptSha256 === ownerExecutionReceiptSha256,
  code);
  publicRecognitionPayloadBoundary(payload, owner, code);
  const providerAuthorityReceipt = providerAuthorityReceiptProof(
    payload, owner, code, writerProjectionMode
  );
  const providerTransportRetryReceipt = providerTransportRetryReceiptProof(
    payload, owner, providerAuthorityReceipt, code, writerProjectionMode
  );

  const expectedVersionFields = {
    model_profile_id: CSM_ACTIVE_MODEL_PROFILE.id,
    optimization_pack_id: CSM_ACTIVE_MODEL_PROFILE.optimization_pack_id,
    optimization_pack_sha256: CSM_ACTIVE_MODEL_PROFILE.optimization_pack_sha256,
    provider_adapter_version: expectedProviderAdapterVersion,
    request_builder_version: expectedProviderAdapterContract.request_builder_version,
    response_parser_version: expectedProviderAdapterContract.response_parser_version,
    transport_profile_id: transportProfile.id,
    transport_profile_sha256: sha256CsmRecognitionTransportReceipt(transportProfile),
    execution_contract_sha256: expectedExecutionContractSha256,
    max_output_tokens: expectedMaxOutputTokens
  };
  for (const [key, expected] of Object.entries(expectedVersionFields)) {
    if (key === "transport_profile_id" || key === "transport_profile_sha256") continue;
    requireInvariant(payload?.[key] === expected && owner?.[key] === expected, code);
  }
  requireInvariant(payload?.provider === CSM_ACTIVE_MODEL_PROFILE.provider
    && owner?.provider === CSM_ACTIVE_MODEL_PROFILE.provider
    && payload?.model === CSM_ACTIVE_MODEL_PROFILE.model
    && payload?.requested_model === CSM_ACTIVE_MODEL_PROFILE.model
    && owner?.model === CSM_ACTIVE_MODEL_PROFILE.model
    && owner?.requested_model === CSM_ACTIVE_MODEL_PROFILE.model
    && payload?.requested_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
    && owner?.effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
    && payload?.image_detail === CSM_ACTIVE_MODEL_PROFILE.image_detail
    && owner?.image_detail === CSM_ACTIVE_MODEL_PROFILE.image_detail,
  code);

  try {
    validateCsmModelExecutionContract(payload?.execution_contract, {
      expectedSha256: expectedExecutionContractSha256
    });
    validateCsmModelExecutionContract(owner?.execution_contract, {
      expectedSha256: expectedExecutionContractSha256
    });
  } catch {
    throw verifierFailure(code);
  }
  requireInvariant(stableJson(payload.execution_contract) === stableJson(expectedExecutionContract)
    && stableJson(owner.execution_contract) === stableJson(expectedExecutionContract),
  code);

  requireInvariant(payload?.provider_response_status_attested === true
    && owner?.provider_response_status_attested === true
    && payload?.provider_response_status === "completed"
    && owner?.provider_response_status === "completed"
    && payload?.provider_response_incomplete === false
    && owner?.provider_response_incomplete === false,
  code);
  const providerResponseId = typeof payload?.provider_response_id === "string"
    ? payload.provider_response_id.trim()
    : "";
  requireInvariant(/^\S{1,240}$/.test(providerResponseId)
    && owner?.provider_response_id === providerResponseId,
  code);

  const tokenKeys = [
    "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens", "total_tokens"
  ];
  for (const key of tokenKeys) {
    requireInvariant(Number.isSafeInteger(payload?.[key])
      && payload[key] >= 0
      && owner?.[key] === payload[key],
    code);
  }
  requireInvariant(payload.input_tokens > 0
    && payload.output_tokens > 0
    && payload.total_tokens > 0
    && payload.cached_input_tokens <= payload.input_tokens
    && payload.reasoning_tokens <= payload.output_tokens
    && Number.isSafeInteger(payload.input_tokens + payload.output_tokens)
    && payload.total_tokens >= payload.input_tokens + payload.output_tokens,
  code);
  requireInvariant(providerAttemptsForWriter(writerProjectionMode).includes(
    payload?.provider_attempt_number
  )
    && owner?.provider_attempt_number === payload.provider_attempt_number
    && payload?.provider_retry_count === payload.provider_attempt_number - 1
    && owner?.provider_retry_count === payload.provider_retry_count,
  code);

  requireInvariant(typeof payload?.served_model_attested === "boolean"
    && owner?.served_model_attested === payload.served_model_attested,
  code);
  if (payload.served_model_attested) {
    const servedModel = typeof payload?.served_model === "string"
      ? payload.served_model.trim()
      : "";
    requireInvariant(Boolean(servedModel)
      && owner?.served_model === servedModel
      && (servedModel === CSM_ACTIVE_MODEL_PROFILE.model
        || servedModel.startsWith(`${CSM_ACTIVE_MODEL_PROFILE.model}-`)),
    code);
  } else {
    requireInvariant(payload?.served_model === null && owner?.served_model === null, code);
  }

  requireInvariant(typeof payload?.served_effort_attested === "boolean"
    && owner?.reasoning_effort_attested === payload.served_effort_attested
    && typeof payload?.served_effort_conflict === "boolean"
    && owner?.served_effort_conflict === payload.served_effort_conflict,
  code);
  if (payload.served_effort_attested) {
    requireInvariant(payload?.served_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
      && owner?.reasoning_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
      && payload.served_effort_conflict === false,
    code);
  } else {
    requireInvariant(payload?.served_effort === null && owner?.reasoning_effort === null, code);
  }

  const proof = {
    execution_origin: "FRESH_CURRENT",
    ...expectedVersionFields,
    owner_execution_receipt_version: ownerExecutionReceiptVersion,
    owner_execution_receipt_sha256: ownerExecutionReceiptSha256,
    provider_authority_receipt: providerAuthorityReceipt,
    provider_transport_retry_receipt: providerTransportRetryReceipt,
    provider_response_completed: true,
    provider_response_status_attested: true,
    provider_response_incomplete: false,
    provider_response_id_present: true,
    provider_response_id_sha256: sha256(providerResponseId),
    response_session_patch_fields_match: true,
    execution_contract_embedded_valid: true,
    input_tokens: payload.input_tokens,
    cached_input_tokens: payload.cached_input_tokens,
    output_tokens: payload.output_tokens,
    reasoning_tokens: payload.reasoning_tokens,
    total_tokens: payload.total_tokens,
    safe_token_usage: true,
    positive_token_usage: true,
    provider_attempt_number: payload.provider_attempt_number,
    provider_retry_count: payload.provider_retry_count,
    served_model_attested: payload.served_model_attested,
    served_model_consistent: true,
    served_model_unknown: !payload.served_model_attested,
    served_effort_attested: payload.served_effort_attested,
    served_effort_consistent: true,
    served_effort_unknown: !payload.served_effort_attested,
    served_effort_conflict: payload.served_effort_conflict,
    server_stages_ms: liveServerStageReceipt(payload, code)
  };
  requireInvariant(hasExactKeys(proof, liveExecutionEvidenceKeys), code);
  return proof;
}

function assertNoPrivateFixtureKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivateFixtureKeys);
    return;
  }
  if (!exactObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:title|writer_title|canonical_title|ground_truth|label|labels|grammar|accuracy_claim|expected_card_number|expected_serial|card_number|serial)$/i.test(key)) {
      throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
    }
    assertNoPrivateFixtureKeys(nested);
  }
}

function relativeFixtureFile(value) {
  const file = String(value || "").trim();
  return file && path.basename(file) === file && !file.includes("\0") ? file : null;
}

function validateFixtureImage(entry, {
  file, role, sourceRole, width, height, maxBytes
}) {
  if (!exactObject(entry)
    || relativeFixtureFile(entry.file) !== file
    || entry.file_mode !== "0600"
    || entry.role !== role
    || entry.source_role !== sourceRole
    || entry.content_type !== "image/jpeg"
    || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > maxBytes
    || entry.width !== width || entry.height !== height
    || !/^[0-9a-f]{64}$/.test(String(entry.content_sha256 || ""))) {
    throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
  }
  return entry;
}

function validateLargeFixtureReceipt(receipt) {
  const contract = LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT;
  const receiptKeys = [
    "allowed_use", "builder", "derived", "derived_total_bytes", "executor", "fixture_id",
    "forbidden_uses", "limits", "original_total_bytes", "originals", "output_directory_mode",
    "provider_calls", "receipt_file_mode", "receipt_hash_scope", "receipt_sha256", "schema_version",
    "source", "source_class", "transform"
  ];
  assertNoPrivateFixtureKeys(receipt);
  if (!hasExactKeys(receipt, receiptKeys)
    || receipt.schema_version !== contract.schema_version
    || receipt.fixture_id !== "large-internal-writer-fixture-v2"
    || receipt.source_class !== contract.source_class
    || receipt.allowed_use !== contract.allowed_use
    || receipt.provider_calls !== 0
    || receipt.receipt_hash_scope !== "LEXICOGRAPHIC_SORTED_JSON_WITHOUT_RECEIPT_SHA256"
    || !/^[0-9a-f]{64}$/.test(String(receipt.receipt_sha256 || ""))
    || receipt.executor?.matches_playwright_default_executor !== true
    || receipt.executor?.playwright_version !== contract.playwright_version
    || receipt.executor?.chromium_revision !== receipt.executor?.playwright_expected_chromium_revision
    || receipt.executor?.chromium_version !== receipt.executor?.playwright_expected_chromium_version
    || receipt.transform?.staged_lane_version !== contract.staged_lane_version
    || receipt.transform?.staged_long_edge !== contract.staged_long_edge
    || receipt.transform?.staged_jpeg_quality !== contract.staged_jpeg_quality
    || !hasExactKeys(receipt.source, [
      "source_kind", "source_record_id", "source_asset_id", "evaluation_cohort",
      "hash_provenance", "manifest_contract_sha256", "images"
    ])
    || receipt.source.source_kind !== "PRODUCTION_ASSET"
    || receipt.source.source_record_id !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_record_id
    || receipt.source.source_asset_id !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_asset_id
    || receipt.source.evaluation_cohort
      !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.evaluation_cohort
    || receipt.source.hash_provenance
      !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.hash_provenance
    || !/^[0-9a-f]{64}$/.test(String(receipt.source.manifest_contract_sha256 || ""))
    || !Array.isArray(receipt.source.images) || receipt.source.images.length !== 2
    || receipt.source.images.some((image, index) => (
      image?.image_id !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images[index].image_id
      || image?.role !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images[index].role
      || image?.content_type
        !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images[index].content_type
      || image?.content_sha256
        !== WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images[index].content_sha256
    ))
    || receipt.limits?.original_total_min_bytes_exclusive !== contract.original_total_min_bytes_exclusive
    || receipt.limits?.original_each_max_bytes !== contract.original_each_max_bytes
    || receipt.limits?.original_each_relay_max_bytes !== contract.original_each_relay_max_bytes
    || receipt.limits?.derived_total_max_bytes !== contract.derived_total_max_bytes
    || !Array.isArray(receipt.originals) || receipt.originals.length !== 2
    || !Array.isArray(receipt.derived) || receipt.derived.length !== 2) {
    throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
  }
  const { receipt_sha256: claimedReceiptSha256, ...receiptBody } = receipt;
  if (sha256(Buffer.from(stableJson(receiptBody))) !== claimedReceiptSha256) {
    throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
  }
  const expectedDerivedWidth = Math.round(
    contract.output_width * contract.staged_long_edge / contract.output_height
  );
  const originals = receipt.originals.map((entry, index) => validateFixtureImage(entry, {
    file: `${index + 1}-${index === 0 ? "front" : "back"}-original.jpg`,
    role: originalRoles[index],
    sourceRole: index === 0 ? "front_original" : "back_original",
    width: contract.output_width,
    height: contract.output_height,
    maxBytes: Math.min(contract.original_each_max_bytes, contract.original_each_relay_max_bytes)
  }));
  const derived = receipt.derived.map((entry, index) => validateFixtureImage(entry, {
    file: `${index + 1}-${index === 0 ? "front" : "back"}-readability-derived.jpg`,
    role: stagedRecognitionRole,
    sourceRole: originalRoles[index],
    width: expectedDerivedWidth,
    height: contract.staged_long_edge,
    maxBytes: contract.derived_total_max_bytes
  }));
  const originalTotal = originals.reduce((total, entry) => total + entry.bytes, 0);
  const derivedTotal = derived.reduce((total, entry) => total + entry.bytes, 0);
  if (originalTotal !== receipt.original_total_bytes
    || originalTotal <= contract.original_total_min_bytes_exclusive
    || derivedTotal !== receipt.derived_total_bytes
    || derivedTotal > contract.derived_total_max_bytes
    || derived.some((entry, index) => entry.bytes >= originals[index].bytes)) {
    throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
  }
  return { receipt, originals, derived, originalTotal, derivedTotal };
}

async function localLargeFixture(receiptPath) {
  const absoluteReceiptPath = path.resolve(String(receiptPath || ""));
  const fixture = validateLargeFixtureReceipt(JSON.parse(await readFile(absoluteReceiptPath, "utf8")));
  const fixtureDirectory = path.dirname(absoluteReceiptPath);
  const images = [];
  for (const entry of fixture.originals) {
    const filePath = path.join(fixtureDirectory, entry.file);
    const bytes = await readFile(filePath);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.content_sha256) {
      throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
    }
    images.push({ name: entry.file, mimeType: entry.content_type, buffer: bytes });
  }
  for (const entry of fixture.derived) {
    const bytes = await readFile(path.join(fixtureDirectory, entry.file));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.content_sha256) {
      throw verifierFailure(verifierErrorCodes.LARGE_FIXTURE_INVALID);
    }
  }
  return { ...fixture, images };
}

function requestExchangeReceipt(request) {
  return {
    method: request.method(),
    url: request.url(),
    body_sha256: titleSha256(request.postData() || "")
  };
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cleanBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || productionOrigin));
  } catch {
    throw verifierFailure(verifierErrorCodes.GENERIC);
  }
  if (url.origin !== productionOrigin || url.pathname !== "/" || url.search || url.hash
    || url.username || url.password) {
    throw verifierFailure(verifierErrorCodes.GENERIC);
  }
  return productionOrigin;
}

function responseRequestId(response) {
  const headers = response.headers();
  return headers["x-request-id"] || headers["x-vercel-id"] || headers["x-lynca-request-id"] || null;
}

function addIds(value, ids) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => addIds(item, ids));
    return;
  }
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    const normalized = nestedKey.toLowerCase();
    if (["asset_id", "batch_id", "job_id", "session_id", "recognition_session_id"].includes(normalized)) {
      const target = normalized === "recognition_session_id" ? "session_id" : normalized;
      const text = String(nestedValue || "").trim();
      if (text) ids[target].add(text);
    }
    addIds(nestedValue, ids);
  }
}

async function jsonOrNull(response) {
  try {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json")) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function markLargeTransportViolation(transport, code) {
  const safeCode = allowedVerifierErrorCodes.has(code)
    ? code
    : verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH;
  transport.violation ||= safeCode;
  transport.signal_violation?.(transport.violation);
}

function validateLargeRecoveryAuthorization(responseReceipt, firstRequest) {
  const payload = responseReceipt?.payload;
  if (responseReceipt?.ok === true && payload?.ok === true) {
    return Object.freeze({ action: "COMPLETE", allows_second_request: false });
  }
  const action = String(payload?.recovery_action || "").trim().toUpperCase();
  if (action === "STAGED_RESUME_ONLY"
    && payload?.staged_resume_receipt === firstRequest?.identity?.staged_resume_receipt) {
    return Object.freeze({
      action,
      allows_second_request: true,
      resume_only: true
    });
  }
  if (action === "STAGED_FRESH_RETRY" && payload?.provider_attempt_started === false) {
    return Object.freeze({
      action,
      allows_second_request: true,
      resume_only: false
    });
  }
  throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
}

function validateLargeIngestRequest(request, fixture, priorRequests, {
  recoveryAuthorization = null,
  phaseComplete = false,
  relayTimelineSnapshot = null
} = {}) {
  const url = new URL(request.url());
  const body = request.postDataBuffer();
  if (url.origin !== productionOrigin
    || url.pathname !== stagedRecognitionPath
    || url.search || url.hash
    || request.method() !== "POST"
    || !body?.length
    || body.length > LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.derived_total_max_bytes
    || priorRequests.length >= 2
    || phaseComplete) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  const metadata = decodeBase64UrlJson(
    request.headers()["x-lynca-ingest-metadata"],
    verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED
  );
  if (!hasExactKeys(metadata, [
    "captureProfileId", "clientAssetRef", "clientTiming", "expectedOriginalCount",
    "idempotencyKey", "images", "intentId", "laneVersion",
    "originalImages", "recognitionInputOnly", "resumeOnly", "stagedResumeReceipt"
  ])
    || metadata.recognitionInputOnly !== true
    || metadata.laneVersion !== LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.staged_lane_version
    || metadata.expectedOriginalCount !== 2
    || !Array.isArray(metadata.originalImages) || metadata.originalImages.length !== 2
    || !Array.isArray(metadata.images) || metadata.images.length !== 2) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  const timing = metadata.clientTiming;
  const firstRequest = priorRequests.length === 0;
  if (firstRequest && (!exactObject(relayTimelineSnapshot)
    || !Number.isSafeInteger(relayTimelineSnapshot.upload_pipeline_request_sequence)
    || !hasExactKeys(relayTimelineSnapshot.upload_pipeline_identity, [
      "capture_profile_id", "client_asset_ref", "expected_original_count", "idempotency_key"
    ])
    || !Number.isSafeInteger(relayTimelineSnapshot.started_count)
    || !Number.isSafeInteger(relayTimelineSnapshot.completed_count)
    || !Number.isSafeInteger(relayTimelineSnapshot.incomplete_count)
    || !Number.isSafeInteger(relayTimelineSnapshot.recognition_request_sequence)
    || relayTimelineSnapshot.upload_pipeline_request_sequence < 1
    || relayTimelineSnapshot.upload_pipeline_request_sequence
      >= relayTimelineSnapshot.recognition_request_sequence
    || relayTimelineSnapshot.started_count < 0
    || relayTimelineSnapshot.completed_count < 0
    || relayTimelineSnapshot.incomplete_count < 0
    || relayTimelineSnapshot.completed_count + relayTimelineSnapshot.incomplete_count
      !== relayTimelineSnapshot.started_count)) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  if (!exactObject(timing)
    || timing.client_upload_bytes !== fixture.originalTotal
    || timing.client_recognition_body_bytes !== body.length
    || !Number.isFinite(Number(timing.client_staged_transform_ms))
    || (firstRequest && (!Number.isFinite(Number(timing.client_original_upload_elapsed_at_dispatch_ms))
      || Number(timing.client_original_upload_elapsed_at_dispatch_ms) <= 0
      || Object.prototype.hasOwnProperty.call(timing, "client_original_upload_ms")))) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  let offset = 0;
  const originalImageIds = [];
  const derivedImageIds = [];
  const originalManifest = [];
  const derivedManifest = [];
  for (let index = 0; index < 2; index += 1) {
    const original = metadata.originalImages[index];
    const derived = metadata.images[index];
    const expectedOriginal = fixture.originals[index];
    const expectedDerived = fixture.derived[index];
    if (!hasExactKeys(original, [
      "contentSha256", "contentType", "height", "imageId", "role", "size",
      "storageFirst", "width"
    ])
      || !hasExactKeys(derived, [
        "contentSha256", "contentType", "fileName", "height", "imageId", "role",
        "signatureHex", "size", "sourceImageId", "width"
      ])
      || original.storageFirst !== true
      || original.role !== expectedOriginal.role
      || original.contentType !== expectedOriginal.content_type
      || original.size !== expectedOriginal.bytes
      || original.width !== expectedOriginal.width
      || original.height !== expectedOriginal.height
      || original.contentSha256 !== expectedOriginal.content_sha256
      || !String(original.imageId || "").trim()
      || derived.role !== stagedRecognitionRole
      || derived.sourceImageId !== original.imageId
      || derived.contentType !== expectedDerived.content_type
      || derived.size !== expectedDerived.bytes
      || derived.width !== expectedDerived.width
      || derived.height !== expectedDerived.height
      || derived.contentSha256 !== expectedDerived.content_sha256
      || !String(derived.imageId || "").trim()
      || !String(derived.fileName || "").trim()
      || !/^[0-9a-f]+$/i.test(String(derived.signatureHex || ""))) {
      throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
    }
    originalImageIds.push(original.imageId);
    derivedImageIds.push(derived.imageId);
    originalManifest.push({
      image_id: original.imageId,
      role: original.role,
      content_type: original.contentType,
      bytes: original.size,
      width: original.width,
      height: original.height,
      content_sha256: original.contentSha256
    });
    derivedManifest.push({
      image_id: derived.imageId,
      source_image_id: derived.sourceImageId,
      role: derived.role,
      file_name: derived.fileName,
      content_type: derived.contentType,
      bytes: derived.size,
      width: derived.width,
      height: derived.height,
      signature_hex: derived.signatureHex,
      content_sha256: derived.contentSha256
    });
    const segment = body.subarray(offset, offset + derived.size);
    if (segment.length !== derived.size || sha256(segment) !== expectedDerived.content_sha256) {
      throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
    }
    offset += derived.size;
  }
  if (offset !== body.length
    || new Set(originalImageIds).size !== 2
    || new Set(derivedImageIds).size !== 2
    || derivedImageIds.some((imageId) => originalImageIds.includes(imageId))) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  const immutableManifest = {
    body_bytes: body.length,
    body_sha256: sha256(body),
    originals: originalManifest,
    derived: derivedManifest
  };
  const identity = {
    capture_profile_id: String(metadata.captureProfileId || ""),
    client_asset_ref: String(metadata.clientAssetRef || ""),
    idempotency_key: String(metadata.idempotencyKey || ""),
    intent_id: String(metadata.intentId || ""),
    staged_resume_receipt: String(metadata.stagedResumeReceipt || ""),
    immutable_manifest_sha256: sha256(Buffer.from(stableJson(immutableManifest)))
  };
  if (Object.values(identity).some((value) => !value)) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  if (firstRequest && (relayTimelineSnapshot.upload_pipeline_identity.capture_profile_id
      !== identity.capture_profile_id
    || relayTimelineSnapshot.upload_pipeline_identity.client_asset_ref
      !== identity.client_asset_ref
    || relayTimelineSnapshot.upload_pipeline_identity.idempotency_key
      !== identity.idempotency_key
    || relayTimelineSnapshot.upload_pipeline_identity.expected_original_count !== 2)) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  if (priorRequests.length && stableJson(priorRequests[0].identity) !== stableJson(identity)) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  if ((firstRequest && metadata.resumeOnly !== false)
    || (!firstRequest && (recoveryAuthorization?.allows_second_request !== true
      || metadata.resumeOnly !== recoveryAuthorization.resume_only))) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  return {
    identity,
    body_bytes: body.length,
    original_bytes: fixture.originalTotal,
    original_image_ids: originalImageIds,
    original_manifest: originalManifest,
    derived_manifest: derivedManifest,
    immutable_manifest_sha256: identity.immutable_manifest_sha256,
    overlap_observed: firstRequest,
    upload_pipeline_started_before_recognition: firstRequest,
    upload_pipeline_identity_bound: firstRequest,
    upload_pipeline_request_sequence: firstRequest
      ? relayTimelineSnapshot.upload_pipeline_request_sequence
      : null,
    relay_started_at_dispatch: firstRequest ? relayTimelineSnapshot.started_count : null,
    relay_completed_at_dispatch: firstRequest ? relayTimelineSnapshot.completed_count : null,
    relay_incomplete_at_dispatch: firstRequest ? relayTimelineSnapshot.incomplete_count : null,
    recognition_request_sequence: firstRequest
      ? relayTimelineSnapshot.recognition_request_sequence
      : null,
    resume_only: metadata.resumeOnly === true
  };
}

async function validateLargeRelayResponse(response, fixture, timeline) {
  const request = response.request();
  const url = new URL(response.url());
  const body = request.postDataBuffer();
  const metadata = decodeBase64UrlJson(
    request.headers()["x-lynca-upload-metadata"],
    verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH
  );
  const index = originalRoles.indexOf(metadata.role);
  if (url.origin !== productionOrigin || url.pathname !== uploadRelayPath || url.search || url.hash
    || request.method() !== "POST" || index < 0 || !body?.length) {
    throw verifierFailure(verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
  }
  const expected = fixture.originals[index];
  const assetId = String(metadata.assetId || "").trim();
  const imageId = String(metadata.imageId || "").trim();
  if (!assetId || !imageId
    || metadata.contentType !== expected.content_type
    || metadata.size !== expected.bytes
    || metadata.width !== expected.width
    || metadata.height !== expected.height
    || metadata.contentSha256 !== expected.content_sha256
    || body.length !== expected.bytes
    || sha256(body) !== expected.content_sha256) {
    throw verifierFailure(verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
  }
  const payload = await response.json();
  if (!response.ok() || payload?.ok !== true
    || payload?.asset_id !== assetId
    || payload?.relay_timing?.browser_body_bytes !== expected.bytes
    || payload?.upload?.image_id !== imageId
    || payload?.upload?.storage_role !== expected.role
    || payload?.verification?.content_sha256 !== expected.content_sha256
    || payload?.verification?.size !== expected.bytes
    || payload?.verification?.object_verified !== true
    || payload?.verification?.content_hash_verified !== true
    || payload?.verification_record?.saved !== true
    || payload?.verification_record?.durable !== true) {
    throw verifierFailure(verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
  }
  return {
    role: expected.role,
    asset_id: assetId,
    image_id: imageId,
    browser_body_bytes: expected.bytes,
    started_sequence: timeline?.started_sequence,
    durable_response_sequence: timeline?.response_sequence
  };
}

function validateLargeRecognitionResponse(payload, fixture, ingestRequests, relayReceipts, {
  recognitionResponseSequence = null,
  uploadPipelineReceipt = null,
  writerProjectionMode = ORDINARY_WRITER_PROJECTION_MODE
} = {}) {
  const stages = payload?.latency_stages_ms || {};
  const firstRequest = ingestRequests[0];
  const relayAssetIds = new Set(relayReceipts.map((entry) => entry.asset_id));
  const executionReceipt = liveExecutionReceiptProof(payload, {
    imageCount: 2,
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
    writerProjectionMode
  });
  const relayByRole = new Map(relayReceipts.map((entry) => [entry.role, entry]));
  const relayMatchesManifest = originalRoles.every((role, index) => {
    const relay = relayByRole.get(role);
    const original = firstRequest?.original_manifest?.[index];
    return relay?.role === role
      && original?.role === role
      && relay?.image_id === original?.image_id
      && relay?.browser_body_bytes === original?.bytes;
  });
  const relayDurableBeforeRecognition = Number.isSafeInteger(recognitionResponseSequence)
    && relayReceipts.every((relay) => Number.isSafeInteger(relay?.started_sequence)
      && Number.isSafeInteger(relay?.durable_response_sequence)
      && relay.started_sequence < relay.durable_response_sequence
      && relay.durable_response_sequence < recognitionResponseSequence);
  const stagedOriginalSyncMs = Number(stages.staged_original_sync_ms);
  const stagedServerStages = executionReceipt.server_stages_ms;
  if (payload?.ok !== true
    || payload?.route !== "CSM_THIN_DIRECT_INGEST"
    || payload?.recognition_input !== "readability_derived_inline"
    || payload?.originals_verified !== true
    || payload?.trace_status !== "PERSISTED"
    || !providerAttemptsForWriter(writerProjectionMode).includes(
      payload?.provider_attempt_number
    )
    || payload?.provider_retry_count !== payload.provider_attempt_number - 1
    || payload?.model !== CSM_ACTIVE_MODEL_PROFILE.model
    || payload?.requested_effort !== CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
    || payload?.image_detail !== "high"
    || payload?.csm_persistence?.ok !== true
    || payload?.csm_persistence?.atomic !== true
    || payload?.csm_persistence?.session?.saved !== true
    || payload?.ingest_timing?.body_bytes !== fixture.derivedTotal
    || stages.ingest_body_bytes !== fixture.derivedTotal
    || stages.client_recognition_body_bytes !== fixture.derivedTotal
    || stages.client_upload_bytes !== fixture.originalTotal
    || !Number.isFinite(stagedOriginalSyncMs)
    || stagedOriginalSyncMs < 0
    || !Number.isFinite(Number(stages.csm_persistence_ms))
    || stagedServerStages.request_total_ms + serverStageRoundingToleranceMs
      < stagedServerStages.authority_dispatch_ms
        + stagedOriginalSyncMs
        + stagedServerStages.csm_persistence_ms
    || ingestRequests.length < 1 || ingestRequests.length > 2
    || firstRequest?.body_bytes !== fixture.derivedTotal
    || firstRequest?.overlap_observed !== true
    || firstRequest?.upload_pipeline_started_before_recognition !== true
    || firstRequest?.upload_pipeline_identity_bound !== true
    || !Number.isSafeInteger(firstRequest?.upload_pipeline_request_sequence)
    || firstRequest.upload_pipeline_request_sequence >= firstRequest.recognition_request_sequence
    || firstRequest?.relay_completed_at_dispatch
      + firstRequest?.relay_incomplete_at_dispatch !== firstRequest?.relay_started_at_dispatch
    || uploadPipelineReceipt?.asset_id !== payload?.asset_id
    || uploadPipelineReceipt?.client_asset_ref !== firstRequest?.identity?.client_asset_ref
    || uploadPipelineReceipt?.idempotency_key !== firstRequest?.identity?.idempotency_key
    || uploadPipelineReceipt?.expected_original_count !== 2
    || payload?.client_asset_ref !== firstRequest?.identity?.client_asset_ref
    || payload?.staged_resume_receipt !== firstRequest?.identity?.staged_resume_receipt
    || relayReceipts.length !== 2
    || relayAssetIds.size !== 1 || !relayAssetIds.has(payload?.asset_id)
    || relayByRole.size !== 2
    || !relayMatchesManifest
    || !relayDurableBeforeRecognition) {
    throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
  }
  return {
    execution_receipt: executionReceipt,
    original_upload_bytes: fixture.originalTotal,
    recognition_body_bytes: fixture.derivedTotal,
    overlap_observed: true,
    upload_pipeline_started_before_recognition: true,
    upload_pipeline_identity_bound: true,
    upload_pipeline_asset_bound: true,
    upload_pipeline_request_sequence: firstRequest.upload_pipeline_request_sequence,
    recognition_request_sequence: firstRequest.recognition_request_sequence,
    relay_started_at_first_staged_post: firstRequest.relay_started_at_dispatch,
    relay_completed_at_first_staged_post: firstRequest.relay_completed_at_dispatch,
    relay_incomplete_at_first_staged_post: firstRequest.relay_incomplete_at_dispatch,
    relay_durable_before_recognition_response: true,
    staged_original_sync_ms: stagedOriginalSyncMs,
    csm_persistence_ms: Number(stages.csm_persistence_ms),
    client_staged_transform_ms: Number(stages.client_staged_transform_ms),
    ingest_request_count: ingestRequests.length,
    recovery: ingestRequests.length === 1
      ? "CLEAN"
      : ingestRequests[1].resume_only ? "RESUME_ONLY" : "FRESH_RECEIPT"
  };
}

function containsVerifierOnlyMetadata(value) {
  if (Array.isArray(value)) return value.some(containsVerifierOnlyMetadata);
  if (!exactObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    /^(?:expected_card_number|expected_serial|card_number|serial|source_kind|source_record_id|source_asset_id)$/i.test(key)
    || containsVerifierOnlyMetadata(nested)
  ));
}

function validateOrdinaryIngestRequest(request, sourceCase) {
  const url = new URL(request.url());
  const body = request.postDataBuffer();
  const metadata = decodeBase64UrlJson(
    request.headers()["x-lynca-ingest-metadata"],
    verifierErrorCodes.ROUTE_COVERAGE_MISMATCH
  );
  const expectedBytes = sourceCase.images.reduce((total, image) => total + image.buffer.length, 0);
  requireInvariant(url.origin === productionOrigin
    && url.pathname === stagedRecognitionPath
    && !url.search
    && !url.hash
    && request.method() === "POST"
    && body?.length === expectedBytes
    && hasExactKeys(metadata, [
      "captureProfileId", "clientAssetRef", "clientTiming", "idempotencyKey", "images", "intentId"
    ])
    && !containsVerifierOnlyMetadata(metadata)
    && metadata?.recognitionInputOnly !== true
    && !Object.prototype.hasOwnProperty.call(metadata || {}, "originalImages")
    && !Object.prototype.hasOwnProperty.call(metadata || {}, "laneVersion")
    && Array.isArray(metadata?.images)
    && metadata.images.length === sourceCase.image_count
    && metadata.images.every((image) => hasExactKeys(image, [
      "contentSha256", "contentType", "fileName", "height", "imageId", "role",
      "signatureHex", "size", "width"
    ]) && !Object.prototype.hasOwnProperty.call(image || {}, "sourceImageId")),
  verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
  return Object.freeze({ original_inline: true });
}

function normalRouteCoverageReceipt({ sourceCase, payload, responseUrl, attempts }) {
  const caseAttempts = attempts.filter((attempt) => attempt.case_id === sourceCase.case_id);
  const code = verifierErrorCodes.ROUTE_COVERAGE_MISMATCH;
  if (sourceCase.case_id !== "TCG") {
    const [ingest] = caseAttempts;
    requireInvariant(payload?.recognition_input === "original_inline"
      && caseAttempts.length === 1
      && ingest?.recognition_route === stagedRecognitionPath
      && ingest?.continued === true
      && ingest?.response_observed === true
      && ingest?.original_inline === true,
    code);
    return Object.freeze({
      route: "ORDINARY_INGEST_ORIGINAL_INLINE",
      initial_ordinary_ingest_aborted: false,
      aborted_ingest_response_observed: false,
      direct_fallback_observed: false,
      route_contract_passed: true
    });
  }
  const [abortedIngest, direct] = caseAttempts;
  requireInvariant(caseAttempts.length === 2
    && abortedIngest?.recognition_route === stagedRecognitionPath
    && abortedIngest?.aborted_before_network === true
    && abortedIngest?.response_observed === false
    && abortedIngest?.original_inline === true
    && direct?.recognition_route === "/api/csm-listing-title"
    && direct?.continued === true
    && direct?.response_observed === true
    && new URL(responseUrl).pathname === "/api/csm-listing-title",
  code);
  return Object.freeze({
    route: "DIRECT_AFTER_ABORTED_ORDINARY_INGEST",
    initial_ordinary_ingest_aborted: true,
    aborted_ingest_response_observed: false,
    direct_fallback_observed: true,
    route_contract_passed: true
  });
}

function validateSourceCasesManifest(manifest, {
  releaseClass = ORDINARY_RELEASE_CLASS,
  expectedGitSha = null
} = {}) {
  const compatibilityBridgeV1 = releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && hasExactKeys(manifest, [
      "schema_version", "release_class", "bridge_marker", "git_sha",
      "evidence_scope", "accuracy_claim", "cases"
    ])
    && manifest.schema_version === COMPATIBILITY_BRIDGE_MANIFEST_VERSION
    && manifest.bridge_marker === COMPATIBILITY_BRIDGE_MARKER;
  const compatibilityBridgeV2 = releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && hasExactKeys(manifest, [
      "schema_version", "release_class", "bridge_descriptor_id", "bridge_marker", "git_sha",
      "evidence_scope", "accuracy_claim", "cases"
    ])
    && manifest.schema_version === COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION
    && manifest.bridge_descriptor_id === COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID
    && manifest.bridge_marker === COMPATIBILITY_BRIDGE_V2_MARKER;
  const compatibilityBridgeV3 = releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && hasExactKeys(manifest, [
      "schema_version", "release_class", "bridge_descriptor_id", "bridge_marker", "git_sha",
      "writer_projection_mode", "evidence_scope", "accuracy_claim", "cases"
    ])
    && manifest.schema_version === COMPATIBILITY_BRIDGE_V3_MANIFEST_VERSION
    && manifest.bridge_descriptor_id
      === EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_DESCRIPTOR_ID
    && manifest.bridge_marker
      === EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_MARKER
    && compatibilityBridgeWriterProjectionMode(manifest, { expectedGitSha })
      === COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE;
  const compatibilityBridgeV4 = releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS
    && hasExactKeys(manifest, [
      "schema_version", "release_class", "bridge_descriptor_id", "bridge_marker", "git_sha",
      "writer_projection_mode", "evidence_scope", "accuracy_claim", "cases"
    ])
    && manifest.schema_version === COMPATIBILITY_BRIDGE_V4_MANIFEST_VERSION
    && manifest.bridge_descriptor_id
      === EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_DESCRIPTOR_ID
    && manifest.bridge_marker === EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_MARKER
    && compatibilityBridgeWriterProjectionMode(manifest, { expectedGitSha })
      === COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE;
  if (![ORDINARY_RELEASE_CLASS, COMPATIBILITY_BRIDGE_RELEASE_CLASS].includes(releaseClass)
    || manifest?.evidence_scope !== "LIVE_CONTRACT_RECEIPT_ONLY"
    || manifest?.accuracy_claim !== null
    || !Array.isArray(manifest.cases) || manifest.cases.length !== 2
    || new Set(manifest.cases.map((entry) => entry?.case_id)).size !== 2
    || new Set(manifest.cases.map((entry) => entry?.expected_grammar)).size !== 2
    || (releaseClass === ORDINARY_RELEASE_CLASS && (
      manifest?.schema_version !== "writer-journey-cases-v4"
      || !hasExactKeys(manifest, [
        "schema_version", "evidence_scope", "accuracy_claim", "cases", "parity_case",
        "activation_cases"
      ])
      || !exactObject(manifest.parity_case)
      || !Array.isArray(manifest.activation_cases)
      || manifest.activation_cases.length !== 2
    ))
    || (releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS && (
      manifest.release_class !== COMPATIBILITY_BRIDGE_RELEASE_CLASS
      || (!compatibilityBridgeV1 && !compatibilityBridgeV2
        && !compatibilityBridgeV3 && !compatibilityBridgeV4)
      || !/^[0-9a-f]{40}$/.test(String(expectedGitSha || ""))
      || manifest.git_sha !== expectedGitSha
    ))) {
    throw new Error("WRITER_JOURNEY_CASES_MANIFEST invalid");
  }
  const tcgContract = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS.find(
    (entry) => entry.case_id === "TCG"
  );
  const fileKeys = ["path", "role", "bytes", "content_type", "content_sha256"];
  for (const entry of manifest.cases) {
    const productionStandard = entry?.case_id === "NON_TCG";
    const expectedContract = productionStandard
      ? WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
      : tcgContract;
    const expectedKeys = productionStandard
      ? [
        "case_id", "expected_grammar", "source_kind", "source_record_id", "source_asset_id",
        "evaluation_cohort", "hash_provenance", "image_count", "files"
      ]
      : [
        "case_id", "expected_grammar", "source_feedback_id", "evaluation_cohort",
        "hash_provenance", "image_count", "files"
      ];
    if (!expectedContract
      || !hasExactKeys(entry, expectedKeys)
      || !Array.isArray(entry.files) || entry.files.length !== 2
      || entry.image_count !== 2
      || entry.files.some((file) => !hasExactKeys(file, fileKeys))
      || entry.expected_grammar !== expectedContract.expected_grammar
      || entry.evaluation_cohort !== expectedContract.evaluation_cohort
      || entry.hash_provenance !== expectedContract.hash_provenance
      || entry.files[0]?.role !== "front_original"
      || entry.files[1]?.role !== "back_original"
      || (productionStandard ? (
        entry.source_kind !== expectedContract.source_kind
        || entry.source_record_id !== expectedContract.source_record_id
        || entry.source_asset_id !== expectedContract.source_asset_id
        || entry.files.some((file, index) => (
          file.content_type !== expectedContract.images[index].content_type
          || file.bytes !== expectedContract.images[index].bytes
          || file.content_sha256 !== expectedContract.images[index].content_sha256
        ))
      ) : (
        entry.source_feedback_id !== expectedContract.source_feedback_id
        || entry.files.some((file, index) => (
          file.content_sha256 !== expectedContract.image_sha256[
            `${expectedContract.source_feedback_id}_${index === 0 ? "front" : "back"}`
          ]
        ))
      ))) {
      throw new Error("WRITER_JOURNEY_CASES_MANIFEST case invalid");
    }
  }
  if (releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS) return [...manifest.cases];
  const parity = manifest.parity_case;
  if (!hasExactKeys(parity, [
    "case_id", "expected_grammar", "source_kind", "source_record_id", "source_asset_id",
    "evaluation_cohort", "hash_provenance", "image_count", "files"
  ])
    || parity.case_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.case_id
    || parity.expected_grammar !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.expected_grammar
    || parity.source_kind !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_kind
    || parity.source_record_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_record_id
    || parity.source_asset_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_asset_id
    || parity.evaluation_cohort
      !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.evaluation_cohort
    || parity.hash_provenance !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.hash_provenance
    || !Array.isArray(parity.files) || parity.files.length !== 2
    || parity.image_count !== parity.files.length
    || parity.files[0]?.role !== "front_original"
    || parity.files[1]?.role !== "back_original"
    || parity.files.some((file, index) => (
      file?.content_sha256
        !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images[index].content_sha256
    ))) {
    throw new Error("WRITER_JOURNEY_CASES_MANIFEST parity case invalid");
  }
  const activationById = new Map(WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map(
    (contract) => [contract.case_id, contract]
  ));
  if (new Set(manifest.activation_cases.map((entry) => entry?.case_id)).size !== 2) {
    throw new Error("WRITER_JOURNEY_CASES_MANIFEST activation cases invalid");
  }
  for (const entry of manifest.activation_cases) {
    const contract = activationById.get(entry?.case_id);
    const identityCase = entry?.case_id === "NON_TCG_WEB_IDENTITY";
    const expectedKeys = [
      "case_id", "expected_grammar", "source_feedback_id", "evaluation_cohort",
      "hash_provenance", "image_count", "files", "original_set_sha256",
      ...(identityCase
        ? []
        : ["expected_lot_count"])
    ];
    if (!contract || !hasExactKeys(entry, expectedKeys)
      || entry.expected_grammar !== contract.expected_grammar
      || entry.source_feedback_id !== contract.source_feedback_id
      || entry.evaluation_cohort !== contract.evaluation_cohort
      || entry.hash_provenance !== contract.hash_provenance
      || entry.original_set_sha256 !== contract.original_set_sha256
      || (!identityCase && entry.expected_lot_count !== contract.expected_lot_count)
      || !Array.isArray(entry.files) || entry.files.length !== 2
      || entry.image_count !== 2
      || entry.files.some((file) => !hasExactKeys(file, fileKeys))
      || entry.files[0]?.role !== "front_original"
      || entry.files[1]?.role !== "back_original"
      || entry.files.some((file, index) => (
        file.content_sha256 !== contract.image_sha256[
          `${contract.source_feedback_id}_${index === 0 ? "front" : "back"}`
        ]
      ))) {
      throw new Error("WRITER_JOURNEY_CASES_MANIFEST activation case invalid");
    }
  }
  return [...manifest.cases, parity, ...manifest.activation_cases];
}

async function localSourceCases(filePath, options) {
  const manifest = JSON.parse(await readFile(filePath, "utf8"));
  const cases = [];
  for (const entry of validateSourceCasesManifest(manifest, options)) {
    const images = [];
    for (const [index, file] of entry.files.entries()) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.content_type)) {
        throw new Error("WRITER_JOURNEY_CASES_MANIFEST content type invalid");
      }
      const bytes = await readFile(file.path);
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      if (!/^[0-9a-f]{64}$/.test(file.content_sha256) || file.content_sha256 !== contentSha256) {
        throw new Error("WRITER_JOURNEY_CASES_MANIFEST hash mismatch");
      }
      images.push({
        name: path.basename(file.path) || `image-${index + 1}.jpg`,
        mimeType: file.content_type,
        buffer: bytes
      });
    }
    cases.push({ ...entry, images });
  }
  const compatibility = options?.releaseClass === COMPATIBILITY_BRIDGE_RELEASE_CLASS;
  return Object.freeze({
    cases: Object.freeze(cases),
    bridgeMarker: compatibility ? manifest.bridge_marker : null,
    writerProjectionMode: compatibility
      ? compatibilityBridgeWriterProjectionMode(manifest, {
        expectedGitSha: options?.expectedGitSha
      })
      : ORDINARY_WRITER_PROJECTION_MODE
  });
}

function cookieDomainMatches(hostname, domain) {
  const normalized = String(domain || "").trim().toLowerCase();
  if (!normalized) return false;
  const bare = normalized.replace(/^\./, "");
  return hostname === bare || (normalized.startsWith(".") && hostname.endsWith(`.${bare}`));
}

function cookiePathMatches(pathname, cookiePath) {
  const normalized = String(cookiePath || "/");
  if (!normalized.startsWith("/") || !pathname.startsWith(normalized)) return false;
  return normalized.endsWith("/") || pathname.length === normalized.length
    || pathname[normalized.length] === "/";
}

function cookieHeaderForUrl(state, target, { nowSeconds = Date.now() / 1000 } = {}) {
  const url = new URL(target);
  return (state?.cookies || []).flatMap((cookie) => {
    const name = String(cookie?.name || "");
    const value = String(cookie?.value || "");
    const expires = Number(cookie?.expires);
    const unexpired = expires === -1 || (Number.isFinite(expires) && expires > nowSeconds);
    const safe = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      && value && !/[\u0000-\u001f\u007f;]/.test(value);
    return safe && unexpired
      && cookieDomainMatches(url.hostname, cookie.domain)
      && cookiePathMatches(url.pathname, cookie.path)
      && (!cookie.secure || url.protocol === "https:")
      ? [`${name}=${value}`] : [];
  }).join("; ");
}

function candidateStorageStateBoundToTarget(state, target) {
  const url = new URL(target);
  return url.origin === canonicalProductionOrigin
    || (Array.isArray(state?.cookies) && state.cookies.length > 0
      && (state.origins || []).length === 0
      && state.cookies.every((cookie) => (
        String(cookie?.domain || "").toLowerCase() === url.hostname
        && cookie?.path === "/"
        && cookie?.secure === true
      )));
}

async function cookieHeaderFromStorageState(filePath, target) {
  if (!filePath) return "";
  const state = JSON.parse(await readFile(filePath, "utf8"));
  if (!candidateStorageStateBoundToTarget(state, target)) {
    throw verifierFailure(verifierErrorCodes.GENERIC);
  }
  return cookieHeaderForUrl(state, target);
}

function recognitionVersionReceipt(recognition, view) {
  const rows = recognition?.csm_rows || {};
  const rowContract = String(rows.output?.contract_version || "").trim();
  const resolutionContract = String(rows.resolution?.contract_version || "").trim();
  const owner = recognition?.csm_owner_versions || {};
  const contract = String(recognition?.csm_contract_version || rowContract).trim();
  const rowResolver = String(rows.resolution?.resolver_version || "").trim();
  const rowComposer = String(rows.output?.composer_version || "").trim();
  const rowMarketplaceProfile = String(
    rows.output?.marketplace_profile_version || ""
  ).trim();
  const resolver = String(owner.resolver || rowResolver).trim();
  const composer = String(owner.composer || rowComposer).trim();
  const marketplaceProfile = String(
    owner.marketplace_profile || rowMarketplaceProfile
  ).trim();
  if (recognition?.csm_owner_versions != null) {
    requireInvariant(Boolean(owner.resolver) && Boolean(owner.composer)
      && Boolean(owner.marketplace_profile),
      verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  }
  requireInvariant(Boolean(contract) && contract === rowContract && contract === resolutionContract,
    verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  if (recognition?.csm_contract_version) {
    requireInvariant(recognition.csm_contract_version === contract,
      verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  }
  requireInvariant(view?.schema_version === "csm-resolution-view-v1"
    && view.schema_version === view?.grammar?.contract_version,
    verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  requireInvariant(Boolean(resolver) && resolver === rowResolver
    && view?.grammar?.resolver_version === resolver,
    verifierErrorCodes.VERSION_RESOLVER_MISMATCH);
  requireInvariant(Boolean(composer) && composer === rowComposer
    && view?.composer?.composer_version === composer,
  verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
  const publicProjection = productionPublicCompositionProjectionForOwner({
    composer,
    marketplace_profile: marketplaceProfile
  });
  const publicRowProfileMatches = exactObject(publicProjection)
    && (publicProjection.marketplace_profile_public
      ? rowMarketplaceProfile === marketplaceProfile
      : rowMarketplaceProfile === ""
        && !Object.prototype.hasOwnProperty.call(rows.output, "marketplace_profile_version"));
  const viewHasMarketplaceProfile = Object.prototype.hasOwnProperty.call(
    view?.composer || {}, "marketplace_profile_version"
  );
  const publicViewProfileMatches = exactObject(publicProjection)
    && (publicProjection.marketplace_profile_public
      ? viewHasMarketplaceProfile
        && view.composer.marketplace_profile_version === marketplaceProfile
      : !viewHasMarketplaceProfile);
  requireInvariant(Boolean(marketplaceProfile)
    && publicRowProfileMatches
    && publicViewProfileMatches,
  verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
  if (composer === CANONICAL_NAMING_RELEASE_CONTRACT.composer_version) {
    requireInvariant(
      [
        CANONICAL_NAMING_RELEASE_CONTRACT_V1.marketplace_profile_version,
        CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version,
        CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version
      ].includes(marketplaceProfile),
      verifierErrorCodes.VERSION_COMPOSER_MISMATCH
    );
  }
  return {
    resolution_view_schema: view.schema_version,
    csm_contract: contract,
    resolver,
    composer,
    marketplace_profile: marketplaceProfile
  };
}

function standardP0LiveEvidence({ recognitionTitle, uiTitle, resolutionView }) {
  return Object.freeze({
    ...productionStandardP0ResolutionProof(resolutionView),
    recognition_title_exact: standardP0TitleIdentityExact(recognitionTitle),
    ui_title_exact: standardP0TitleIdentityExact(uiTitle)
  });
}

function canonicalNamingVersionActive(versions) {
  return versions?.composer === CANONICAL_NAMING_RELEASE_CONTRACT_V3.composer_version
    && versions?.marketplace_profile
      === CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version;
}

function capturedProductionStandardVersionActive(versions) {
  return versions?.csm_contract === "csm-stage-shadow-v2"
    && versions?.composer === CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version
    && versions?.marketplace_profile
      === CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version;
}

function compatibilityBridgeStandardVersionActive(versions) {
  return versions?.composer === THIN_COMPOSER_VERSION_V2
    && versions?.marketplace_profile === EBAY_PROFILE_VERSION;
}

function observationLegacyVersionActive(versions) {
  return versions?.resolver === THIN_RESOLVER_VERSION
    && compatibilityBridgeStandardVersionActive(versions);
}

function capturedProductionTcgVersionActive(versions) {
  return versions?.csm_contract === "csm-stage-shadow-v2"
    && observationLegacyVersionActive(versions);
}

function observationCanonicalV3VersionActive(versions) {
  return versions?.resolver === THIN_RESOLVER_VERSION
    && canonicalNamingVersionActive(versions);
}

function verifiedOriginalObservationVersionActive(versions, support = null) {
  const tupleActive = versions?.resolver === VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
    && canonicalNamingVersionActive(versions);
  if (support == null) return tupleActive;
  return tupleActive
    && validateVerifiedOriginalObservationPublicReceipt(support)
    && support?.release_id === VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.release_id
    && support?.pack_sha256 === VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.pack_sha256
    && support?.resolver_version === versions.resolver
    && support?.resolution_contract_sha256
      === VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.resolution_contract_sha256;
}

function capturedProductionVerifiedOriginalObservationVersionActive(
  versions,
  support = null
) {
  const receipt = VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT;
  const tupleActive = versions?.resolver === VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
    && capturedProductionStandardVersionActive(versions);
  if (support == null) return tupleActive;
  return tupleActive
    && validateVerifiedOriginalObservationPublicReceipt(support)
    && support?.release_id === receipt.release_id
    && support?.pack_sha256 === receipt.pack_sha256
    && support?.resolver_version === versions.resolver
    && support?.resolution_contract_sha256 === receipt.resolution_contract_sha256;
}

function currentStandardWriterProjectionMode(writerProjectionMode) {
  return writerProjectionMode === ORDINARY_WRITER_PROJECTION_MODE
    || writerProjectionMode === COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE;
}

function standardNonTcgWriterProjectionActive({
  writerProjectionMode,
  versions,
  verifiedOriginalObservationSupport
} = {}) {
  if (currentStandardWriterProjectionMode(writerProjectionMode)) {
    return verifiedOriginalObservationSupport != null
      && verifiedOriginalObservationVersionActive(
      versions, verifiedOriginalObservationSupport
      );
  }
  if (capturedProductionWriterMode(writerProjectionMode)) {
    return verifiedOriginalObservationSupport != null
      && capturedProductionVerifiedOriginalObservationVersionActive(
        versions, verifiedOriginalObservationSupport
      );
  }
  if (writerProjectionMode === COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE) {
    return observationLegacyVersionActive(versions)
      && verifiedOriginalObservationSupport == null;
  }
  return false;
}

function largeStandardWriterProjectionActive({
  writerProjectionMode,
  versions,
  grammar,
  verifiedOriginalObservationSupport,
  externalIdentitySupport
} = {}) {
  if (currentStandardWriterProjectionMode(writerProjectionMode)) {
    return observationCanonicalV3VersionActive(versions)
      && verifiedOriginalObservationSupport == null
      && externalIdentitySupport == null;
  }
  if (capturedProductionWriterMode(writerProjectionMode)) {
    return grammar?.value === "NON_TCG"
      && grammar?.raw === "standard"
      && versions?.resolver === THIN_RESOLVER_VERSION
      && capturedProductionStandardVersionActive(versions)
      && verifiedOriginalObservationSupport == null
      && externalIdentitySupport == null;
  }
  if (writerProjectionMode === COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE) {
    return observationLegacyVersionActive(versions);
  }
  return false;
}

function standardNonTcgWriterProjectionEvidenceActive({
  writerProjectionMode,
  evidence
} = {}) {
  if (currentStandardWriterProjectionMode(writerProjectionMode)) {
    return evidence?.canonical_naming_active === true
      && evidence?.compatibility_bridge_standard_active === false
      && evidence?.verified_original_observation_active === true
      && productionStandardP0EvidenceProofValid(evidence?.standard_p0_identity)
      && verifiedOriginalObservationVersionActive(evidence?.versions);
  }
  if (capturedProductionWriterMode(writerProjectionMode)) {
    return evidence?.canonical_naming_active === false
      && evidence?.compatibility_bridge_standard_active === false
      && evidence?.verified_original_observation_active === true
      && productionStandardP0EvidenceProofValid(evidence?.standard_p0_identity)
      && capturedProductionVerifiedOriginalObservationVersionActive(evidence?.versions);
  }
  if (writerProjectionMode === COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE) {
    return evidence?.canonical_naming_active === false
      && evidence?.compatibility_bridge_standard_active === true
      && evidence?.verified_original_observation_active === false
      && evidence?.standard_p0_identity == null
      && observationLegacyVersionActive(evidence?.versions);
  }
  return false;
}

function ordinaryActivationSeal({
  writerProjectionMode,
  standardCaseEvidence,
  tcgCaseEvidence,
  largeCaseEvidence,
  parityCaseEvidence,
  webCaseEvidence,
  lotCaseEvidence,
  semanticCases,
  webReceiptClaimsMatchViews,
  qualifiedGovernedWebCases,
  strictNoSearchCases,
  usedWithoutGovernedAppliedSupportCases,
  governedWebCaseEvidence
} = {}) {
  return writerProjectionMode === ORDINARY_WRITER_PROJECTION_MODE
    && standardNonTcgWriterProjectionEvidenceActive({
      writerProjectionMode,
      evidence: standardCaseEvidence
    })
    && observationLegacyVersionActive(tcgCaseEvidence?.versions)
    && largeCaseEvidence?.overlap_observed === true
    && largeStandardWriterProjectionActive({
      writerProjectionMode,
      versions: largeCaseEvidence?.versions,
      verifiedOriginalObservationSupport: null,
      externalIdentitySupport: null
    })
    && largeCaseEvidence?.relay_durable_before_recognition_response === true
    && parityCaseEvidence?.codex_parity_exact_match === true
    && registeredExternalIdentityVersionActive(parityCaseEvidence?.versions)
    && parityCaseEvidence?.external_identity_support?.applied === true
    && parityCaseEvidence?.external_identity_support?.match_basis
      === "VERIFIED_ORIGINAL_SET"
    && parityCaseEvidence?.external_identity_support?.source_count === 3
    && webReceiptClaimsMatchViews === true
    && qualifiedGovernedWebCases?.length + strictNoSearchCases?.length
      + usedWithoutGovernedAppliedSupportCases?.length === semanticCases?.length
    && strictNoSearchCases?.length >= 1
    && qualifiedGovernedWebCases?.length === 1
    && governedWebCaseEvidence?.case_id === qualifiedGovernedWebCases[0]?.case_id
    && webCaseEvidence?.activation_projection?.set_predicate === SET_MEMBERSHIP_PREDICATE
    && webCaseEvidence?.activation_projection?.card_name_predicate === CARD_NAME_PREDICATE
    && webCaseEvidence?.activation_projection?.card_name_before_subject === true
    && observationCanonicalV3VersionActive(webCaseEvidence?.versions)
    && lotCaseEvidence?.lot_shared_only?.marker_exact === true
    && lotCaseEvidence?.lot_shared_only?.publishable === true
    && lotCaseEvidence?.lot_shared_only?.individual_serials_withheld === true
    && observationLegacyVersionActive(lotCaseEvidence?.versions);
}

function compatibilityBridgeSeal({
  writerProjectionMode,
  evidenceCases,
  standardCaseEvidence,
  tcgCaseEvidence,
  largeCaseEvidence,
  parityCaseEvidence,
  webCaseEvidence,
  lotCaseEvidence,
  semanticCases,
  transportOnlyCases,
  webReceiptClassifications,
  webReceiptClaimsMatchViews,
  qualifiedGovernedWebCases,
  strictNoSearchCases,
  usedWithoutGovernedAppliedSupportCases,
  governedWebCaseEvidence
} = {}) {
  const expectedCaseIds = ["LARGE_STAGED_TRANSPORT", "NON_TCG", "TCG"];
  const semanticCaseIds = Array.isArray(semanticCases)
    ? semanticCases.map((entry) => entry?.case_id).sort()
    : [];
  const classifiedCaseIds = Array.isArray(webReceiptClassifications)
    ? webReceiptClassifications.map(({ entry }) => entry?.case_id).sort()
    : [];
  const partitionCaseIds = [
    ...(qualifiedGovernedWebCases || []),
    ...(strictNoSearchCases || []),
    ...(usedWithoutGovernedAppliedSupportCases || [])
  ].map((entry) => entry?.case_id).sort();
  if (capturedProductionWriterMode(writerProjectionMode)) {
    return Array.isArray(evidenceCases)
      && evidenceCases.map((entry) => entry?.case_id).sort().join("\0")
        === expectedCaseIds.join("\0")
      && evidenceCases.every((entry) => (
        entry?.versions?.csm_contract === "csm-stage-shadow-v2"
        && !Object.prototype.hasOwnProperty.call(entry || {}, "founder_web_search")
      ))
      && Array.isArray(semanticCases)
      && semanticCaseIds.join("\0") === "NON_TCG\0TCG"
      && semanticCases.every((entry) => entry?.transport_only !== true)
      && Array.isArray(transportOnlyCases)
      && transportOnlyCases.length === 1
      && transportOnlyCases[0]?.case_id === "LARGE_STAGED_TRANSPORT"
      && Array.isArray(webReceiptClassifications)
      && webReceiptClassifications.length === 0
      && webReceiptClaimsMatchViews === true
      && qualifiedGovernedWebCases?.length === 0
      && strictNoSearchCases?.length === 0
      && usedWithoutGovernedAppliedSupportCases?.length === 0
      && governedWebCaseEvidence == null
      && parityCaseEvidence == null
      && webCaseEvidence == null
      && lotCaseEvidence == null
      && standardNonTcgWriterProjectionEvidenceActive({
        writerProjectionMode,
        evidence: standardCaseEvidence
      })
      && capturedProductionTcgVersionActive(tcgCaseEvidence?.versions)
      && tcgCaseEvidence?.captured_e1ae_standard_active === false
      && tcgCaseEvidence?.canonical_naming_active === false
      && tcgCaseEvidence?.compatibility_bridge_standard_active === true
      && tcgCaseEvidence?.verified_original_observation_active === false
      && largeCaseEvidence?.overlap_observed === true
      && largeCaseEvidence?.captured_e1ae_standard_active === true
      && largeCaseEvidence?.canonical_naming_active === false
      && largeStandardWriterProjectionActive({
        writerProjectionMode,
        versions: largeCaseEvidence?.versions,
        grammar: {
          value: largeCaseEvidence?.expected_grammar,
          raw: "standard"
        },
        verifiedOriginalObservationSupport: null,
        externalIdentitySupport: null
      })
      && largeCaseEvidence?.relay_durable_before_recognition_response === true
      && evidenceCases.filter((entry) => (
        entry?.captured_e1ae_standard_active === true
      )).length === 2
      && evidenceCases.filter((entry) => entry?.canonical_naming_active === true).length === 0
      && evidenceCases.filter((entry) => (
        entry?.compatibility_bridge_standard_active === true
      )).length === 1
      && evidenceCases.filter((entry) => (
        entry?.verified_original_observation_active === true
      )).length === 1
      && evidenceCases.filter((entry) => (
        productionStandardP0EvidenceProofValid(entry?.standard_p0_identity)
      )).length === 1;
  }
  return Array.isArray(evidenceCases)
    && evidenceCases.map((entry) => entry?.case_id).sort().join("\0")
      === expectedCaseIds.join("\0")
    && Array.isArray(semanticCases)
    && semanticCaseIds.join("\0") === "NON_TCG\0TCG"
    && semanticCases.every((entry) => entry?.transport_only !== true)
    && Array.isArray(transportOnlyCases)
    && transportOnlyCases.length === 1
    && transportOnlyCases[0]?.case_id === "LARGE_STAGED_TRANSPORT"
    && Array.isArray(webReceiptClassifications)
    && webReceiptClassifications.length === semanticCases.length
    && webReceiptClassifications.every(({ entry }) => entry?.transport_only !== true)
    && classifiedCaseIds.join("\0") === semanticCaseIds.join("\0")
    && partitionCaseIds.join("\0") === semanticCaseIds.join("\0")
    && new Set(partitionCaseIds).size === semanticCaseIds.length
    && webReceiptClaimsMatchViews === true
    && qualifiedGovernedWebCases?.length === 0
    && strictNoSearchCases?.length >= 1
    && strictNoSearchCases.length + usedWithoutGovernedAppliedSupportCases?.length
      === semanticCases.length
    && governedWebCaseEvidence == null
    && parityCaseEvidence == null
    && webCaseEvidence == null
    && lotCaseEvidence == null
    && standardNonTcgWriterProjectionEvidenceActive({
      writerProjectionMode,
      evidence: standardCaseEvidence
    })
    && observationLegacyVersionActive(tcgCaseEvidence?.versions)
    && largeCaseEvidence?.overlap_observed === true
    && largeStandardWriterProjectionActive({
      writerProjectionMode,
      versions: largeCaseEvidence?.versions,
      verifiedOriginalObservationSupport: null,
      externalIdentitySupport: null
    })
    && largeCaseEvidence?.relay_durable_before_recognition_response === true;
}

function registeredExternalIdentityVersionActive(versions) {
  const contract = EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract;
  return versions?.resolver === contract.resolver_version
    && versions?.composer === contract.composer_version
    && versions?.marketplace_profile === contract.marketplace_profile_version;
}

function feedbackReceipt({
  requestPayload,
  responsePayload,
  requestMatchesResponse,
  recognitionSessionId,
  expectedTitleSha256
}) {
  requireInvariant(requestMatchesResponse, verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
  requireInvariant(Boolean(requestPayload?.feedback_submission_id)
    && responsePayload?.feedback_submission_id === requestPayload.feedback_submission_id,
    verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
  requireInvariant(requestPayload?.recognition_session_id === recognitionSessionId
    && responsePayload?.recognition_session_id === recognitionSessionId,
    verifierErrorCodes.FEEDBACK_SESSION_MISMATCH);
  requireInvariant(requestPayload?.action === "ACCEPT",
    verifierErrorCodes.FEEDBACK_ACTION_MISMATCH);
  requireInvariant(titleSha256(requestPayload?.writer_final_title) === expectedTitleSha256,
    verifierErrorCodes.FEEDBACK_REQUEST_TITLE_MISMATCH);
  requireInvariant(titleSha256(responsePayload?.writer_final_title) === expectedTitleSha256,
    verifierErrorCodes.FEEDBACK_RESPONSE_TITLE_MISMATCH);
  return {
    action: "ACCEPT",
    exchange_bound: true,
    session_matches: true,
    request_title_matches: true,
    response_title_matches: true
  };
}

function titleEvidenceReceipt({ titleBeforePanel, titleAfterPanel, expectedTitleSha256, feedback }) {
  return {
    title_length: titleBeforePanel.length,
    title_unchanged: titleSha256(titleAfterPanel) === expectedTitleSha256,
    feedback_action: feedback.action,
    feedback_exchange_bound: feedback.exchange_bound,
    feedback_session_matches: feedback.session_matches,
    feedback_request_title_matches: feedback.request_title_matches,
    feedback_response_title_matches: feedback.response_title_matches
  };
}

test("production writer journey verifies Glass Box and staged large-image transport", async ({ browser }, testInfo) => {
  test.setTimeout(25 * 60 * 1000);
  await mkdir(artifactDir, { recursive: true });
  const baseUrl = cleanBaseUrl(process.env.WRITER_JOURNEY_BASE_URL);
  const expectedSha = requiredEnv("WRITER_JOURNEY_EXPECTED_SHA");
  const releaseClass = requiredEnv("WRITER_JOURNEY_RELEASE_CLASS");
  requireInvariant([
    ORDINARY_RELEASE_CLASS, COMPATIBILITY_BRIDGE_RELEASE_CLASS
  ].includes(releaseClass), verifierErrorCodes.GENERIC);
  const parityRequired = releaseClass === ORDINARY_RELEASE_CLASS;
  const username = requiredEnv("METAVERSE_USERNAME");
  const password = requiredEnv("METAVERSE_PASSWORD");
  const initialStorageState = String(
    process.env.WRITER_JOURNEY_INITIAL_STORAGE_STATE || ""
  ).trim() || undefined;
  const healthUrl = `${baseUrl}/api/health`;
  const initialCookieHeader = await cookieHeaderFromStorageState(initialStorageState, healthUrl);
  const sourceManifest = await localSourceCases(requiredEnv("WRITER_JOURNEY_CASES_MANIFEST"), {
    releaseClass,
    expectedGitSha: expectedSha
  });
  const sourceCases = sourceManifest.cases;
  const writerProjectionMode = sourceManifest.writerProjectionMode;
  const largeFixture = await localLargeFixture(requiredEnv("WRITER_JOURNEY_LARGE_FIXTURE_RECEIPT"));
  const evidence = {
    schema_version: "production-writer-journey-evidence-v7",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    field_ground_truth_available: false,
    accuracy_claim: null,
    passed: false,
    launch_ready_mutated: false,
    release_class: releaseClass,
    compatibility_bridge_marker: sourceManifest.bridgeMarker,
    writer_projection_mode: writerProjectionMode,
    base_url: baseUrl,
    started_at: new Date().toISOString(),
    deployment_origin: null,
    deployment_identity: null,
    request_ids: [],
    asset_ids: [],
    batch_ids: [],
    job_ids: [],
    session_ids: [],
    cases: [],
    stages: {}
  };
  const feedbackPolicyChecks = [];
  const writerEditableTitleLatencyReceipts = [];
  const recordWriterEditableTitleLatency = (input) => {
    const receipt = buildWriterEditableTitleLatencyReceipt(input);
    writerEditableTitleLatencyReceipts.push(receipt);
    evidence.stages.writer_editable_title_latency = summarizeWriterEditableTitleLatency(
      writerEditableTitleLatencyReceipts,
      { cohortId: `writer-journey-${expectedSha.slice(0, 12)}` }
    );
    requireInvariant(receipt.hard_limit_passed,
      verifierErrorCodes.WRITER_TITLE_LATENCY_HARD_LIMIT_EXCEEDED);
    return receipt;
  };
  const requireFeedbackPolicy = ({ caseId, httpOk, payload }) => {
    const receipt = feedbackPolicyReceipt({ httpOk, payload });
    feedbackPolicyChecks.push(Object.freeze({ case_id: caseId, ...receipt }));
    evidence.stages.feedback_policy = {
      checked_count: feedbackPolicyChecks.length,
      last_check: feedbackPolicyChecks.at(-1)
    };
    requireInvariant(receipt.feedback_policy_passed,
      verifierErrorCodes.FEEDBACK_POLICY_MISMATCH);
    return receipt;
  };
  const ids = {
    asset_id: new Set(),
    batch_id: new Set(),
    job_id: new Set(),
    session_id: new Set()
  };
  const requestIds = new Set();
  const resolutionRequests = [];
  let standardResolutionView = null;
  const resolutionViewsByCaseId = new Map();
  const responseCaptureTasks = new Set();
  const pendingPageWaits = new Set();
  const ownPageWait = (promise) => {
    pendingPageWaits.add(promise);
    void promise.then(
      () => pendingPageWaits.delete(promise),
      () => pendingPageWaits.delete(promise)
    );
    return promise;
  };
  let networkSequence = 0;
  const recognitionPosts = [];
  const warmupTransport = {
    requests: []
  };
  const normalTransport = {
    active_case_id: null,
    attempts: [],
    violation: null
  };
  const largeTransport = {
    active: false,
    phase_complete: false,
    violation: null,
    ingest_requests: [],
    ingest_responses: [],
    response_promises: [],
    upload_pipeline_requests: [],
    relay_requests: [],
    relay_receipts: [],
    recognition_response_events: [],
    external_storage_puts: 0,
    capture_tasks: new Set()
  };
  largeTransport.violation_signal = new Promise((resolve) => {
    largeTransport.signal_violation = resolve;
  });
  let loginContext;
  let loginPage;
  let journeyContext;
  let failureCaseId = null;
  let failurePhase = "HEALTH";

  try {
    const healthResponse = await fetch(healthUrl, {
      redirect: "error",
      headers: {
        accept: "application/json",
        ...(initialCookieHeader ? { cookie: initialCookieHeader } : {})
      }
    });
    const health = await healthResponse.json();
    const initialHealthReceipt = writerJourneyHealthReceipt({
      httpOk: healthResponse.ok,
      health,
      expectedSha,
      expectedOrigin: productionOrigin,
      responseUrl: healthResponse.url,
      writerProjectionMode
    });
    evidence.deployment_origin = initialHealthReceipt.deployment_origin;
    evidence.deployment_identity = initialHealthReceipt.deployment_identity;
    evidence.deployment_git_commit_sha = initialHealthReceipt.deployment_git_commit_sha;
    evidence.deployment_environment = initialHealthReceipt.deployment_environment;
    const healthRequestId = healthResponse.headers.get("x-request-id") || healthResponse.headers.get("x-vercel-id");
    if (healthRequestId) requestIds.add(healthRequestId);
    evidence.stages.health = {
      passed: true,
      http_status: healthResponse.status,
      ...initialHealthReceipt
    };

    // Login is isolated from uploaded artifacts so credentials never enter a trace.
    failurePhase = "LOGIN";
    loginContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
      ...(initialStorageState ? { storageState: initialStorageState } : {})
    });
    loginPage = await loginContext.newPage();
    await loginPage.goto("/app/login.html?next=%2Fapp%2F", { waitUntil: "domcontentloaded" });
    await loginPage.getByTestId("login-username").fill(username);
    await loginPage.getByTestId("login-password").fill(password);
    await loginPage.getByTestId("login-submit").click();
    await loginPage.waitForURL((url) => !url.pathname.endsWith("/login.html"), { timeout: 45_000 });
    await expect(loginPage.getByTestId("image-upload-input")).toBeAttached();
    const storageState = await loginContext.storageState();
    evidence.stages.login = { passed: true, final_path: new URL(loginPage.url()).pathname };
    await loginContext.close();
    loginContext = null;
    loginPage = null;

    journeyContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
      storageState,
      serviceWorkers: "block"
    });
    await journeyContext.route("**/api/listing-image-upload-relay", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (largeTransport.active
        && request.method() === "POST"
        && url.origin === productionOrigin
        && url.pathname === uploadRelayPath
        && !url.search
        && !url.hash) {
        if (largeTransport.relay_requests.length >= 2) {
          markLargeTransportViolation(
            largeTransport,
            verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH
          );
          await route.abort("blockedbyclient");
          return;
        }
        largeTransport.relay_requests.push({
          request,
          started_sequence: ++networkSequence,
          response_observed: false,
          response_sequence: null
        });
      }
      await route.continue();
    });
    await journeyContext.route("**/api/csm-listing-title**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();
      if (pathname === "/api/csm-listing-title" && method === "GET") {
        warmupTransport.requests.push({
          request,
          request_sequence: ++networkSequence,
          response_observed: false,
          response_status: null
        });
        await route.continue();
        return;
      }
      const recognitionPost = method === "POST" && recognitionPaths.has(pathname)
        ? {
            request,
            recognition_route: pathname,
            case_id: null,
            continued: false,
            aborted_before_network: false,
            response_observed: false,
            response_status: null,
            recognition_session_id: null,
            provider_response_id_sha256: null
          }
        : null;
      if (recognitionPost) recognitionPosts.push(recognitionPost);
      const activeCaseId = normalTransport.active_case_id;
      if (activeCaseId && method === "POST"
        && (pathname === stagedRecognitionPath || pathname === "/api/csm-listing-title")) {
        const sourceCase = sourceCases.find((entry) => entry.case_id === activeCaseId);
        const attempt = Object.assign(recognitionPost, {
          case_id: activeCaseId,
          original_inline: false
        });
        normalTransport.attempts.push(attempt);
        try {
          if (!sourceCase) throw verifierFailure(verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
          if (pathname === stagedRecognitionPath) {
            attempt.original_inline = validateOrdinaryIngestRequest(route.request(), sourceCase).original_inline;
            const caseAttempts = normalTransport.attempts.filter((entry) => (
              entry.case_id === activeCaseId
            ));
            if (activeCaseId !== "TCG" && caseAttempts.length !== 1) {
              throw verifierFailure(verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
            }
            if (activeCaseId === "TCG") {
              const priorOrdinaryIngests = normalTransport.attempts.filter((entry) => (
                entry.case_id === activeCaseId && entry.recognition_route === stagedRecognitionPath
              ));
              if (priorOrdinaryIngests.length !== 1) {
                throw verifierFailure(verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
              }
              attempt.aborted_before_network = true;
              await route.abort("blockedbyclient");
              return;
            }
          } else if (activeCaseId !== "TCG"
              || normalTransport.attempts.filter((entry) => (
                entry.case_id === activeCaseId && entry.aborted_before_network === true
              )).length !== 1
              || normalTransport.attempts.filter((entry) => (
                entry.case_id === activeCaseId && entry.recognition_route === "/api/csm-listing-title"
              )).length !== 1) {
            throw verifierFailure(verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
          }
          attempt.continued = true;
          await route.continue();
          return;
        } catch (error) {
          normalTransport.violation = sanitizedFailureCode(error);
          attempt.aborted_before_network = true;
          await route.abort("blockedbyclient");
          return;
        }
      }
      if (!largeTransport.active) {
        if (recognitionPost) {
          normalTransport.violation ||= verifierErrorCodes.ROUTE_COVERAGE_MISMATCH;
          recognitionPost.aborted_before_network = true;
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
        return;
      }
      if (method !== "POST" || pathname !== stagedRecognitionPath) {
        if (recognitionPost) {
          recognitionPost.aborted_before_network = true;
          markLargeTransportViolation(
            largeTransport,
            verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH
          );
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
        return;
      }
      try {
        recognitionPost.case_id = "LARGE_STAGED_TRANSPORT";
        const requestIndex = largeTransport.ingest_requests.length;
        if (requestIndex !== 0) {
          throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
        }
        const uploadPipelineRequest = largeTransport.upload_pipeline_requests[0];
        const relayStarted = largeTransport.relay_requests.length;
        const relayCompleted = largeTransport.relay_requests.filter(
          (entry) => entry.response_observed === true
        ).length;
        const receipt = validateLargeIngestRequest(
          route.request(), largeFixture, largeTransport.ingest_requests, {
            phaseComplete: largeTransport.phase_complete,
            relayTimelineSnapshot: {
              upload_pipeline_request_sequence: uploadPipelineRequest?.request_sequence,
              upload_pipeline_identity: uploadPipelineRequest?.identity,
              started_count: relayStarted,
              completed_count: relayCompleted,
              incomplete_count: relayStarted - relayCompleted,
              recognition_request_sequence: ++networkSequence
            }
          }
        );
        largeTransport.ingest_requests.push(receipt);
        const responsePromise = route.request().response();
        recognitionPost.continued = true;
        await route.continue();
        const capturedResponse = (async () => {
          const response = await responsePromise;
          if (!response) throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
          const responseReceipt = {
            ok: response.ok(),
            status: response.status(),
            payload: await jsonOrNull(response)
          };
          largeTransport.ingest_responses.push(responseReceipt);
          if (responseReceipt.ok !== true || responseReceipt.payload?.ok !== true) {
            throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
          }
          return Object.freeze({ action: "COMPLETE", allows_second_request: false });
        })().catch((error) => {
          markLargeTransportViolation(
            largeTransport,
            sanitizedFailureCode(error) === verifierErrorCodes.GENERIC
              ? verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH
              : sanitizedFailureCode(error)
          );
          return null;
        });
        largeTransport.response_promises.push(capturedResponse);
      } catch {
        if (recognitionPost) recognitionPost.aborted_before_network = true;
        markLargeTransportViolation(largeTransport, verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
        await route.abort("blockedbyclient");
      }
    });
    const journeyPage = await journeyContext.newPage();
    journeyPage.on("request", (request) => {
      const url = new URL(request.url());
      if (largeTransport.active
          && request.method() === "POST"
          && url.origin === productionOrigin
          && url.pathname === "/api/listing-asset-create"
          && !url.search && !url.hash) {
        let identity = null;
        try {
          const payload = request.postDataJSON();
          if (hasExactKeys(payload, [
            "capture_profile_id", "client_asset_ref", "expected_original_count", "idempotency_key"
          ])
            && typeof payload.capture_profile_id === "string"
            && typeof payload.client_asset_ref === "string"
            && typeof payload.idempotency_key === "string"
            && Number.isSafeInteger(payload.expected_original_count)) {
            identity = payload;
          }
        } catch {}
        if (largeTransport.upload_pipeline_requests.length >= 1) {
          markLargeTransportViolation(
            largeTransport,
            verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED
          );
        } else if (!identity) {
          markLargeTransportViolation(
            largeTransport,
            verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED
          );
        } else {
          largeTransport.upload_pipeline_requests.push({
            request,
            identity,
            request_sequence: ++networkSequence,
            response_observed: false,
            response_status: null,
            response_sequence: null,
            response_receipt: null
          });
        }
      }
      if (largeTransport.active && request.method() === "PUT" && url.origin !== productionOrigin) {
        largeTransport.external_storage_puts += 1;
      }
      if (url.pathname === "/api/csm-resolution-view") {
        resolutionRequests.push({ method: request.method(), asset_id: url.searchParams.get("asset_id") });
      }
    });
    journeyPage.on("response", (response) => {
      const normalAttempt = normalTransport.attempts.find((attempt) => (
        attempt.request === response.request()
      ));
      if (normalAttempt) normalAttempt.response_observed = true;
      const recognitionPost = recognitionPosts.find((entry) => (
        entry.request === response.request()
      ));
      if (recognitionPost) {
        recognitionPost.response_observed = true;
        recognitionPost.response_status = response.status();
      }
      const warmupRequest = warmupTransport.requests.find((entry) => (
        entry.request === response.request()
      ));
      if (warmupRequest) {
        warmupRequest.response_observed = true;
        warmupRequest.response_status = response.status();
        warmupRequest.response_sequence = ++networkSequence;
      }
      const responsePathname = new URL(response.url()).pathname;
      const uploadPipelineRequest = largeTransport.upload_pipeline_requests.find((entry) => (
        entry.request === response.request()
      ));
      if (uploadPipelineRequest) {
        uploadPipelineRequest.response_observed = true;
        uploadPipelineRequest.response_status = response.status();
        uploadPipelineRequest.response_sequence = ++networkSequence;
        const uploadPipelineTask = (async () => {
          const payload = await jsonOrNull(response);
          if (response.status() < 200 || response.status() >= 300
            || payload?.ok !== true
            || String(payload?.client_asset_ref || "")
              !== uploadPipelineRequest.identity.client_asset_ref
            || String(payload?.idempotency_key || "")
              !== uploadPipelineRequest.identity.idempotency_key
            || Number(payload?.expected_original_count) !== 2
            || !String(payload?.asset_id || "").trim()) {
            throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
          }
          uploadPipelineRequest.response_receipt = Object.freeze({
            asset_id: String(payload.asset_id),
            client_asset_ref: String(payload.client_asset_ref),
            idempotency_key: String(payload.idempotency_key),
            expected_original_count: Number(payload.expected_original_count)
          });
        })().catch(() => {
          markLargeTransportViolation(
            largeTransport,
            verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED
          );
        });
        largeTransport.capture_tasks.add(uploadPipelineTask);
        void uploadPipelineTask.finally(() => largeTransport.capture_tasks.delete(uploadPipelineTask));
      }
      if (largeTransport.active
        && response.request().method() === "POST"
        && responsePathname === stagedRecognitionPath) {
        largeTransport.recognition_response_events.push({
          request: response.request(),
          status: response.status(),
          response_sequence: ++networkSequence
        });
      }
      const task = (async () => {
        const requestId = responseRequestId(response);
        if (requestId) requestIds.add(requestId);
        const pathname = new URL(response.url()).pathname;
        if (!pathname.startsWith("/api/")) return;
        const payload = await jsonOrNull(response);
        if (payload) addIds(payload, ids);
      })();
      responseCaptureTasks.add(task);
      void task.finally(() => responseCaptureTasks.delete(task));

      if (largeTransport.active) {
        const pathname = new URL(response.url()).pathname;
        if (pathname === uploadRelayPath) {
          const relayTimeline = largeTransport.relay_requests.find((entry) => (
            entry.request === response.request()
          ));
          if (relayTimeline) {
            relayTimeline.response_observed = true;
            relayTimeline.response_sequence = ++networkSequence;
          }
          const largeTask = (async () => {
            try {
              if (!relayTimeline) {
                throw verifierFailure(verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
              }
              largeTransport.relay_receipts.push(
                await validateLargeRelayResponse(response, largeFixture, relayTimeline)
              );
            } catch {
              markLargeTransportViolation(
                largeTransport,
                verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH
              );
            }
          })();
          largeTransport.capture_tasks.add(largeTask);
          void largeTask.finally(() => largeTransport.capture_tasks.delete(largeTask));
        }
      }
    });

    await journeyPage.goto("/app/", { waitUntil: "domcontentloaded" });
    await journeyPage.waitForLoadState("networkidle");
    failurePhase = "PAGE_READY";
    const uploadInput = journeyPage.getByTestId("image-upload-input");
    await expect(journeyPage.getByTestId("start-recognition")).toBeHidden();

    failureCaseId = null;
    failurePhase = "OWNER_AUTHORIZATION";
    const ownerResponse = await journeyContext.request.get(`${baseUrl}/api/session`, {
      headers: { accept: "application/json" }
    });
    const ownerSession = await ownerResponse.json();
    requireInvariant(ownerResponse.ok()
      && ownerSession?.authenticated === true
      && ownerSession?.role === "OWNER",
    verifierErrorCodes.LARGE_OWNER_REQUIRED);

    for (const sourceCase of sourceCases) {
      failureCaseId = sourceCase.case_id;
      failurePhase = "RECOGNITION_RESPONSE";
      normalTransport.active_case_id = sourceCase.case_id;
      const uploadStartedAt = monotonicNowMs();
      const result = journeyPage.getByTestId("writer-title-result").first();
      const titleInput = result.getByTestId("writer-title-input");
      const recognitionResponsePromise = ownPageWait(journeyPage.waitForResponse((response) => (
        response.request().method() === "POST"
        && recognitionPaths.has(new URL(response.url()).pathname)
      ), { timeout: 6 * 60 * 1000 }).then((response) => ({
        response,
        responseAtMs: monotonicNowMs()
      })));
      const resolutionResponsePromise = ownPageWait(journeyPage.waitForResponse((response) => (
        response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/csm-resolution-view"
      ), { timeout: 6 * 60 * 1000 }));
      await uploadInput.setInputFiles(sourceCase.images);

      const {
        response: recognitionResponse,
        responseAtMs: recognitionResponseAtMs
      } = await recognitionResponsePromise;
      const recognitionPayload = await recognitionResponse.json();
      const generatedTitleSha256 = titleSha256(recognitionPayload.title);
      const titleEditableAtPromise = ownPageWait(
        waitForExactEditableTitle(titleInput, generatedTitleSha256)
      );
      const responseAttempt = normalTransport.attempts.find((attempt) => (
        attempt.request === recognitionResponse.request()
      ));
      requireInvariant(Boolean(responseAttempt), verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
      responseAttempt.response_observed = true;
      requireInvariant(!normalTransport.violation,
        verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
      addIds(recognitionPayload, ids);
      expect(recognitionResponse.ok(), "direct CSM recognition must succeed").toBeTruthy();
      expect(recognitionPayload?.trace_status, "recognition trace must be durable").toBe("PERSISTED");
      expect(providerAttemptsForWriter(writerProjectionMode),
        "live verifier allows only attempts admitted by the selected writer")
        .toContain(recognitionPayload?.provider_attempt_number);
      expect(recognitionPayload?.provider_retry_count,
        "live verifier binds retry count to the physical attempt").toBe(
          recognitionPayload.provider_attempt_number - 1
        );
      expect(String(recognitionPayload?.asset_id || "")).not.toBe("");
      expect(String(recognitionPayload?.recognition_session_id || "")).not.toBe("");
      failurePhase = "EXECUTION_RECEIPT";
      const executionReceipt = liveExecutionReceiptProof(recognitionPayload, {
        imageCount: sourceCase.image_count,
        transportProfile: sourceCase.case_id !== "TCG"
          ? CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE
          : CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
        writerProjectionMode
      });
      failurePhase = "ROUTE_COVERAGE";
      const routeCoverage = normalRouteCoverageReceipt({
        sourceCase,
        payload: recognitionPayload,
        responseUrl: recognitionResponse.url(),
        attempts: normalTransport.attempts
      });
      responseAttempt.recognition_session_id = recognitionPayload.recognition_session_id;
      responseAttempt.provider_response_id_sha256 =
        executionReceipt.provider_response_id_sha256;
      let externalIdentityReceipt = null;
      let standardP0Identity = null;
      let activationProjectionReceipt = null;
      let founderWebSearchReceipt = null;
      let lotSharedOnlyReceipt = null;

      failurePhase = "TITLE_UI";
      const titleEditableAtMs = await titleEditableAtPromise;
      const titleBeforePanel = await titleInput.inputValue();
      const writerEditableTitleLatency = recordWriterEditableTitleLatency({
        caseId: sourceCase.case_id,
        lane: "NORMAL",
        sampleIdSha256: sha256(recognitionPayload.recognition_session_id),
        uploadStartedAtMs: uploadStartedAt,
        recognitionResponseAtMs,
        titleEditableAtMs,
        executionOrigin: executionReceipt.execution_origin,
        providerAttemptNumber: recognitionPayload.provider_attempt_number,
        providerRetryCount: recognitionPayload.provider_retry_count
      });
      if (sourceCase.case_id === "EXTERNAL_IDENTITY") {
        requireInvariant(codexParityTitleMatches({
          recognitionTitle: recognitionPayload?.title,
          uiTitle: titleBeforePanel
        }),
        verifierErrorCodes.CODEX_PARITY_MISMATCH);
      }
      const panelTitleSha256 = titleSha256(titleBeforePanel);
      requireInvariant(panelTitleSha256 === generatedTitleSha256,
        verifierErrorCodes.TITLE_UI_RECOGNITION_MISMATCH);

      failurePhase = "RESOLUTION_VIEW";
      const resolutionResponse = await resolutionResponsePromise;
      const resolutionView = await resolutionResponse.json();
      resolutionViewsByCaseId.set(sourceCase.case_id, structuredClone(resolutionView));
      addIds(resolutionView, ids);
      expect(resolutionResponse.ok(), "resolution view must be readable in the live writer journey").toBeTruthy();
      expect(resolutionView?.asset_id).toBe(recognitionPayload.asset_id);
      expect(resolutionView?.recognition_session_id).toBe(recognitionPayload.recognition_session_id);
      expect(resolutionView?.grammar?.value).toBe(sourceCase.expected_grammar);
      const versions = recognitionVersionReceipt(recognitionPayload, resolutionView);
      if (sourceCase.case_id === "TCG") {
        requireInvariant((!capturedProductionWriterMode(writerProjectionMode)
          && observationLegacyVersionActive(versions))
          || (capturedProductionWriterMode(writerProjectionMode)
            && capturedProductionTcgVersionActive(versions)
            && publicProjectionSupportOmitted(resolutionView, [
              "verified_original_observation_support", "external_identity_support"
            ])),
          verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
      }
      if (sourceCase.case_id === "NON_TCG_WEB_IDENTITY") {
        requireInvariant(resolutionView?.grammar?.raw === "standard"
          && observationCanonicalV3VersionActive(versions),
        verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
      }
      if (sourceCase.case_id === "LOT_SHARED_ONLY") {
        requireInvariant(resolutionView?.grammar?.raw === "lot"
          && observationLegacyVersionActive(versions),
        verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
      }
      if (sourceCase.case_id === "NON_TCG") {
        requireInvariant(resolutionView?.grammar?.raw === "standard"
          && (!capturedProductionWriterMode(writerProjectionMode)
            || publicProjectionSupportOmitted(
              resolutionView, ["external_identity_support"]
            ))
          && standardNonTcgWriterProjectionActive({
            writerProjectionMode,
            versions,
            verifiedOriginalObservationSupport:
              resolutionView?.verified_original_observation_support
          }),
        verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
        standardResolutionView = structuredClone(resolutionView);
        if (currentStandardWriterProjectionMode(writerProjectionMode)
            || capturedProductionWriterMode(writerProjectionMode)) {
          const sourceIdentityExact = sourceCase.source_kind === "PRODUCTION_ASSET"
            && sourceCase.source_asset_id
              === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.source_asset_id;
          standardP0Identity = standardP0LiveEvidence({
            recognitionTitle: recognitionPayload?.title,
            uiTitle: titleBeforePanel,
            resolutionView
          });
          evidence.stages.standard_p0_identity = Object.freeze({
            source_identity_exact: sourceIdentityExact,
            ...standardP0Identity
          });
          requireInvariant(sourceIdentityExact
            && productionStandardP0EvidenceProofValid(standardP0Identity),
          verifierErrorCodes.STANDARD_P0_IDENTITY_MISMATCH);
        }
      }
      const ownerExecutionReadback = durableOwnerExecutionReadbackProof(
        executionReceipt, resolutionView
      );
      founderWebSearchReceipt = founderWebSearchProof(sourceCase, resolutionView, {
        writerProjectionMode
      });
      activationProjectionReceipt = activationProjectionProofForCase(
        sourceCase, resolutionView, titleBeforePanel
      );
      if (sourceCase.case_id === "LOT_SHARED_ONLY") {
        lotSharedOnlyReceipt = lotSharedOnlyProjectionProof(
          sourceCase, resolutionView, titleBeforePanel
        );
      }
      if (sourceCase.case_id === "EXTERNAL_IDENTITY") {
        failurePhase = "EXTERNAL_IDENTITY_SUPPORT";
        requireInvariant(registeredExternalIdentityVersionActive(versions),
          verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
        requireInvariant(codexParityTitleMatches({
          recognitionTitle: recognitionPayload?.title,
          uiTitle: titleBeforePanel,
          storedTitle: resolutionView?.composer?.stored_title
        }),
          verifierErrorCodes.CODEX_PARITY_MISMATCH);
        externalIdentityReceipt = externalIdentityParityProof(resolutionView);
      }
      requireInvariant(titleSha256(resolutionView?.composer?.stored_title) === generatedTitleSha256,
        verifierErrorCodes.TITLE_STORED_UI_MISMATCH);
      expect(resolutionView?.composer?.recomposed_matches_stored).toBe(true);
      expect(resolutionView?.composer?.trace_reliable).toBe(true);
      expect(Array.isArray(resolutionView?.brackets)).toBe(true);
      expect(resolutionView.brackets.length).toBeGreaterThan(0);

      failurePhase = "GLASS_BOX";
      const glassBox = result.locator("details.glass-box");
      await expect(glassBox, "Glass Box panel must render after its GET completes").toBeAttached();
      await glassBox.locator("summary").click();
      await expect(glassBox.locator("tbody tr")).toHaveCount(resolutionView.brackets.length);
      if (externalIdentityReceipt) {
        const renderedSources = (await glassBox.locator(".glass-box-external-sources a")
          .evaluateAll((links) => links.map((link) => link.href))).sort();
        const expectedSources = EXTERNAL_IDENTITY_SUPPORT_PACK.sources
          .map((source) => source.url).sort();
        requireInvariant(renderedSources.join("\0") === expectedSources.join("\0"),
          verifierErrorCodes.EXTERNAL_IDENTITY_SUPPORT_MISMATCH);
      }
      const titleAfterPanel = await titleInput.inputValue();
      requireInvariant(titleSha256(titleAfterPanel) === generatedTitleSha256,
        verifierErrorCodes.TITLE_CHANGED_AFTER_GLASS_BOX);

      const assetResolutionRequests = resolutionRequests.filter((request) => (
        request.asset_id === recognitionPayload.asset_id
      ));
      expect(assetResolutionRequests).toHaveLength(1);
      expect(assetResolutionRequests[0].method).toBe("GET");
      expect(resolutionRequests.some((request) => request.method !== "GET"),
        "the writer journey must never submit a semantic review").toBe(false);

      // Persist the unchanged generated title as writer feedback.
      failurePhase = "FEEDBACK";
      await titleInput.fill(titleBeforePanel);
      const persistenceRequestPromise = ownPageWait(journeyPage.waitForRequest((request) => (
        request.method() === "POST"
        && new URL(request.url()).pathname === "/api/v4/listing-feedback"
      ), { timeout: 45_000 }));
      const persistenceResponsePromise = ownPageWait(journeyPage.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v4/listing-feedback"
      ), { timeout: 45_000 }));
      await result.getByTestId("accept-writer-title").click();
      const [persistenceRequest, persistenceResponse] = await Promise.all([
        persistenceRequestPromise,
        persistenceResponsePromise
      ]);
      let persistenceRequestPayload;
      try {
        persistenceRequestPayload = persistenceRequest.postDataJSON();
      } catch {
        throw verifierFailure(verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
      }
      const persistencePayload = await persistenceResponse.json();
      addIds(persistencePayload, ids);
      const responseRequest = persistenceResponse.request();
      const feedback = feedbackReceipt({
        requestPayload: persistenceRequestPayload,
        responsePayload: persistencePayload,
        requestMatchesResponse: persistenceRequest === responseRequest
          && JSON.stringify(requestExchangeReceipt(persistenceRequest))
            === JSON.stringify(requestExchangeReceipt(responseRequest)),
        recognitionSessionId: recognitionPayload.recognition_session_id,
        expectedTitleSha256: panelTitleSha256
      });
      const feedbackPolicy = requireFeedbackPolicy({
        caseId: sourceCase.case_id,
        httpOk: persistenceResponse.ok(),
        payload: persistencePayload
      });

      evidence.cases.push({
        case_id: sourceCase.case_id,
        expected_grammar: sourceCase.expected_grammar,
        ...(sourceCase.source_kind === "PRODUCTION_ASSET" ? {
          source_kind: sourceCase.source_kind,
          source_record_id: sourceCase.source_record_id,
          source_asset_id: sourceCase.source_asset_id
        } : { source_feedback_id: sourceCase.source_feedback_id }),
        hash_provenance: sourceCase.hash_provenance,
        ...(sourceCase.original_set_sha256 ? {
          original_set_sha256: sourceCase.original_set_sha256
        } : {}),
        image_sha256: sourceCase.files.map(({ role, content_sha256: contentSha256 }) => ({
          role,
          content_sha256: contentSha256
        })),
        recognition_route: new URL(recognitionResponse.url()).pathname,
        route_coverage: routeCoverage,
        asset_id: recognitionPayload.asset_id,
        recognition_session_id: recognitionPayload.recognition_session_id,
        trace_status: recognitionPayload.trace_status,
        provider_attempt_number: recognitionPayload.provider_attempt_number,
        provider_retry_count: recognitionPayload.provider_retry_count,
        execution_receipt: executionReceipt,
        owner_execution_readback: ownerExecutionReadback,
        resolution_http_method: assetResolutionRequests[0].method,
        resolution_request_count: assetResolutionRequests.length,
        glass_box_rendered: true,
        bracket_count: resolutionView.brackets.length,
        trace_reliable: resolutionView.composer.trace_reliable,
        recomposed_matches_stored: resolutionView.composer.recomposed_matches_stored,
        versions,
        canonical_naming_active: canonicalNamingVersionActive(versions),
        compatibility_bridge_standard_active:
          observationLegacyVersionActive(versions),
        ...(capturedProductionWriterMode(writerProjectionMode) ? {
          captured_e1ae_standard_active:
            capturedProductionStandardVersionActive(versions)
        } : {}),
        verified_original_observation_active:
          resolutionView?.verified_original_observation_support?.status === "APPLIED",
        ...(standardP0Identity ? { standard_p0_identity: standardP0Identity } : {}),
        ...(externalIdentityReceipt ? {
          codex_parity_exact_match: true,
          external_identity_support: externalIdentityReceipt
        } : {}),
        ...(activationProjectionReceipt ? {
          activation_projection: activationProjectionReceipt
        } : {}),
        ...(founderWebSearchReceipt ? {
          founder_web_search: founderWebSearchReceipt
        } : {}),
        ...(lotSharedOnlyReceipt ? {
          lot_shared_only: lotSharedOnlyReceipt
        } : {}),
        ...titleEvidenceReceipt({
          titleBeforePanel,
          titleAfterPanel,
          expectedTitleSha256: generatedTitleSha256,
          feedback
        }),
        ...feedbackPolicy,
        writer_editable_title_latency: writerEditableTitleLatency,
        upload_to_feedback_ms: monotonicNowMs() - uploadStartedAt
      });
      failurePhase = "CASE_COMPLETE";
      await expect(journeyPage.getByTestId("writer-title-result")).toHaveCount(0, { timeout: 45_000 });
      normalTransport.active_case_id = null;
    }

    failureCaseId = "LARGE_STAGED_TRANSPORT";
    failurePhase = "LARGE_RECOGNITION";
    const largeUploadStartedAt = monotonicNowMs();
    const largeResult = journeyPage.getByTestId("writer-title-result").first();
    const largeTitleInput = largeResult.getByTestId("writer-title-input");
    largeTransport.active = true;
    const largeRecognitionResponsePromise = ownPageWait(journeyPage.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === stagedRecognitionPath
    ), { timeout: 6 * 60 * 1000 }).then((response) => ({
      response,
      responseAtMs: monotonicNowMs()
    })));
    const largeResolutionResponsePromise = ownPageWait(journeyPage.waitForResponse((response) => (
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/csm-resolution-view"
    ), { timeout: 6 * 60 * 1000 }));
    await uploadInput.setInputFiles(largeFixture.images);

    const recognitionOutcome = await Promise.race([
      largeRecognitionResponsePromise,
      largeTransport.violation_signal.then((code) => ({ violation: code }))
    ]);
    if (recognitionOutcome.violation) throw verifierFailure(recognitionOutcome.violation);
    const largeRecognitionResponse = recognitionOutcome.response;
    const largeRecognitionResponseAtMs = recognitionOutcome.responseAtMs;
    requireInvariant(largeRecognitionResponse.status() === 200 && largeRecognitionResponse.ok(),
      verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    const largeRecognitionPayload = await largeRecognitionResponse.json();
    const largeGeneratedTitleSha256 = titleSha256(largeRecognitionPayload.title);
    const largeTitleEditableAtPromise = ownPageWait(
      waitForExactEditableTitle(largeTitleInput, largeGeneratedTitleSha256)
    );
    addIds(largeRecognitionPayload, ids);
    await Promise.all(largeTransport.response_promises);
    await Promise.allSettled([...largeTransport.capture_tasks]);
    await expect.poll(() => largeTransport.relay_receipts.length, {
      timeout: 30_000,
      intervals: [100, 250, 500]
    }).toBe(2).catch(() => {
      throw verifierFailure(verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
    });
    requireInvariant(!largeTransport.violation
      && largeTransport.external_storage_puts === 0
      && largeTransport.upload_pipeline_requests.length === 1
      && largeTransport.upload_pipeline_requests[0].response_observed === true
      && largeTransport.upload_pipeline_requests[0].response_status >= 200
      && largeTransport.upload_pipeline_requests[0].response_status < 300
      && largeTransport.upload_pipeline_requests[0].response_receipt?.asset_id
        === largeRecognitionPayload.asset_id
      && new Set(largeTransport.relay_receipts.map((entry) => entry.role)).size === 2
      && largeTransport.relay_receipts.reduce(
        (total, entry) => total + entry.browser_body_bytes, 0
      ) === largeFixture.originalTotal,
    verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
    const transportReceipt = validateLargeRecognitionResponse(
      largeRecognitionPayload,
      largeFixture,
      largeTransport.ingest_requests,
      largeTransport.relay_receipts,
      {
        recognitionResponseSequence: largeTransport.recognition_response_events.find((entry) => (
          entry.request === largeRecognitionResponse.request()
        ))?.response_sequence,
        uploadPipelineReceipt: largeTransport.upload_pipeline_requests[0]?.response_receipt,
        writerProjectionMode
      }
    );
    const largeRecognitionPost = recognitionPosts.find((entry) => (
      entry.request === largeRecognitionResponse.request()
    ));
    requireInvariant(Boolean(largeRecognitionPost),
      verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    largeRecognitionPost.recognition_session_id = largeRecognitionPayload.recognition_session_id;
    largeRecognitionPost.provider_response_id_sha256 =
      transportReceipt.execution_receipt.provider_response_id_sha256;

    const largeTitleEditableAtMs = await largeTitleEditableAtPromise;
    const largeTitleBeforePanel = await largeTitleInput.inputValue();
    const largeWriterEditableTitleLatency = recordWriterEditableTitleLatency({
      caseId: "LARGE_STAGED_TRANSPORT",
      lane: "LARGE_STAGED_TRANSPORT",
      sampleIdSha256: sha256(largeRecognitionPayload.recognition_session_id),
      uploadStartedAtMs: largeUploadStartedAt,
      recognitionResponseAtMs: largeRecognitionResponseAtMs,
      titleEditableAtMs: largeTitleEditableAtMs,
      executionOrigin: transportReceipt.execution_receipt.execution_origin,
      providerAttemptNumber: largeRecognitionPayload.provider_attempt_number,
      providerRetryCount: largeRecognitionPayload.provider_retry_count
    });
    const largePanelTitleSha256 = titleSha256(largeTitleBeforePanel);
    requireInvariant(largePanelTitleSha256 === largeGeneratedTitleSha256,
      verifierErrorCodes.TITLE_UI_RECOGNITION_MISMATCH);

    failurePhase = "LARGE_RESOLUTION";
    const largeResolutionResponse = await largeResolutionResponsePromise;
    const largeResolutionView = await largeResolutionResponse.json();
    addIds(largeResolutionView, ids);
    requireInvariant(largeResolutionResponse.ok()
      && largeResolutionView?.asset_id === largeRecognitionPayload.asset_id
      && largeResolutionView?.recognition_session_id === largeRecognitionPayload.recognition_session_id,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    const largeVersions = recognitionVersionReceipt(largeRecognitionPayload, largeResolutionView);
    requireInvariant((!capturedProductionWriterMode(writerProjectionMode)
      || (capturedProductionProjectionReceiptsOmitted(largeResolutionView)
        && publicProjectionSupportOmitted(largeResolutionView, [
          "verified_original_observation_support", "external_identity_support"
        ])))
      && largeStandardWriterProjectionActive({
      writerProjectionMode,
      versions: largeVersions,
      grammar: largeResolutionView?.grammar,
      verifiedOriginalObservationSupport:
        largeResolutionView?.verified_original_observation_support,
      externalIdentitySupport: largeResolutionView?.external_identity_support
    }),
    verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
    const largeOwnerExecutionReadback = durableOwnerExecutionReadbackProof(
      transportReceipt.execution_receipt, largeResolutionView
    );
    requireInvariant(titleSha256(largeResolutionView?.composer?.stored_title) === largeGeneratedTitleSha256,
      verifierErrorCodes.TITLE_STORED_UI_MISMATCH);
    requireInvariant(largeResolutionView?.composer?.recomposed_matches_stored === true
      && largeResolutionView?.composer?.trace_reliable === true
      && Array.isArray(largeResolutionView?.brackets)
      && largeResolutionView.brackets.length > 0,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    const largeGlassBox = largeResult.locator("details.glass-box");
    await expect(largeGlassBox).toBeAttached();
    await largeGlassBox.locator("summary").click();
    await expect(largeGlassBox.locator("tbody tr")).toHaveCount(largeResolutionView.brackets.length);
    const largeTitleAfterPanel = await largeTitleInput.inputValue();
    requireInvariant(titleSha256(largeTitleAfterPanel) === largeGeneratedTitleSha256,
      verifierErrorCodes.TITLE_CHANGED_AFTER_GLASS_BOX);

    const largeAssetResolutionRequests = resolutionRequests.filter((request) => (
      request.asset_id === largeRecognitionPayload.asset_id
    ));
    requireInvariant(largeAssetResolutionRequests.length === 1
      && largeAssetResolutionRequests[0].method === "GET",
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);

    failurePhase = "LARGE_FEEDBACK";
    await largeTitleInput.fill(largeTitleBeforePanel);
    const largePersistenceRequestPromise = ownPageWait(journeyPage.waitForRequest((request) => (
      request.method() === "POST"
      && new URL(request.url()).pathname === "/api/v4/listing-feedback"
    ), { timeout: 45_000 }));
    const largePersistenceResponsePromise = ownPageWait(journeyPage.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v4/listing-feedback"
    ), { timeout: 45_000 }));
    await largeResult.getByTestId("accept-writer-title").click();
    const [largePersistenceRequest, largePersistenceResponse] = await Promise.all([
      largePersistenceRequestPromise,
      largePersistenceResponsePromise
    ]);
    let largePersistenceRequestPayload;
    try {
      largePersistenceRequestPayload = largePersistenceRequest.postDataJSON();
    } catch {
      throw verifierFailure(verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
    }
    const largePersistencePayload = await largePersistenceResponse.json();
    addIds(largePersistencePayload, ids);
    const largeResponseRequest = largePersistenceResponse.request();
    const largeFeedback = feedbackReceipt({
      requestPayload: largePersistenceRequestPayload,
      responsePayload: largePersistencePayload,
      requestMatchesResponse: largePersistenceRequest === largeResponseRequest
        && stableJson(requestExchangeReceipt(largePersistenceRequest))
          === stableJson(requestExchangeReceipt(largeResponseRequest)),
      recognitionSessionId: largeRecognitionPayload.recognition_session_id,
      expectedTitleSha256: largePanelTitleSha256
    });
    const largeFeedbackPolicy = requireFeedbackPolicy({
      caseId: "LARGE_STAGED_TRANSPORT",
      httpOk: largePersistenceResponse.ok(),
      payload: largePersistencePayload
    });

    evidence.cases.push({
      case_id: "LARGE_STAGED_TRANSPORT",
      expected_grammar: "NON_TCG",
      transport_only: true,
      accuracy_claim: null,
      fixture_id: largeFixture.receipt.fixture_id,
      fixture_receipt_sha256: largeFixture.receipt.receipt_sha256,
      recognition_route: new URL(largeRecognitionResponse.url()).pathname,
      asset_id: largeRecognitionPayload.asset_id,
      recognition_session_id: largeRecognitionPayload.recognition_session_id,
      trace_status: largeRecognitionPayload.trace_status,
      provider_attempt_number: largeRecognitionPayload.provider_attempt_number,
      provider_retry_count: largeRecognitionPayload.provider_retry_count,
      glass_box_rendered: true,
      bracket_count: largeResolutionView.brackets.length,
      trace_reliable: largeResolutionView.composer.trace_reliable,
      recomposed_matches_stored: largeResolutionView.composer.recomposed_matches_stored,
      versions: largeVersions,
      canonical_naming_active: canonicalNamingVersionActive(largeVersions),
      ...(capturedProductionWriterMode(writerProjectionMode) ? {
        captured_e1ae_standard_active:
          capturedProductionStandardVersionActive(largeVersions)
      } : {}),
      owner_execution_readback: largeOwnerExecutionReadback,
      ...titleEvidenceReceipt({
        titleBeforePanel: largeTitleBeforePanel,
        titleAfterPanel: largeTitleAfterPanel,
        expectedTitleSha256: largeGeneratedTitleSha256,
        feedback: largeFeedback
      }),
      ...transportReceipt,
      relay_request_count: largeTransport.relay_receipts.length,
      ...largeFeedbackPolicy,
      writer_editable_title_latency: largeWriterEditableTitleLatency,
      upload_to_feedback_ms: monotonicNowMs() - largeUploadStartedAt
    });
    failurePhase = "FINAL_SEAL";
    largeTransport.phase_complete = true;
    await expect(journeyPage.getByTestId("writer-title-result")).toHaveCount(0, { timeout: 45_000 });
    await journeyPage.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => null);
    await Promise.all(largeTransport.response_promises);
    await Promise.allSettled([...responseCaptureTasks]);
    await journeyContext.close();
    journeyContext = null;
    requireInvariant(!largeTransport.violation
      && largeTransport.ingest_requests.length === largeTransport.ingest_responses.length
      && largeTransport.ingest_requests.length === 1,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);

    const finalHealthResponse = await fetch(healthUrl, {
      redirect: "error",
      headers: {
        accept: "application/json",
        ...(initialCookieHeader ? { cookie: initialCookieHeader } : {})
      }
    });
    const finalHealth = await finalHealthResponse.json();
    const finalHealthReceipt = writerJourneyHealthReceipt({
      httpOk: finalHealthResponse.ok,
      health: finalHealth,
      expectedSha,
      expectedOrigin: productionOrigin,
      responseUrl: finalHealthResponse.url,
      writerProjectionMode
    });
    requireInvariant(finalHealthReceipt.deployment_identity === evidence.deployment_identity
      && finalHealthReceipt.deployment_origin === evidence.deployment_origin,
      verifierErrorCodes.RUNTIME_CONTRACT_MISMATCH);
    evidence.stages.release_stability = {
      passed: true,
      ...finalHealthReceipt
    };

    requireInvariant(!largeTransport.violation
      && largeTransport.ingest_requests.length === 1
      && largeTransport.ingest_responses.length === 1
      && largeTransport.recognition_response_events.length === 1
      && largeTransport.recognition_response_events[0].status === 200
      && largeTransport.upload_pipeline_requests.length === 1
      && largeTransport.upload_pipeline_requests[0].response_observed === true
      && largeTransport.relay_requests.length === 2
      && largeTransport.relay_requests.every((entry) => entry.response_observed === true)
      && largeTransport.relay_receipts.length === 2,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    requireInvariant(!normalTransport.violation
      && normalTransport.attempts.filter((entry) => entry.aborted_before_network === true).length === 1
      && normalTransport.attempts.filter((entry) => entry.aborted_before_network === true)
        .every((entry) => entry.response_observed === false),
    verifierErrorCodes.ROUTE_COVERAGE_MISMATCH);
    const expectedCaseIds = parityRequired
      ? [
        "EXTERNAL_IDENTITY", "LARGE_STAGED_TRANSPORT", "LOT_SHARED_ONLY", "NON_TCG",
        "NON_TCG_WEB_IDENTITY", "TCG"
      ]
      : ["LARGE_STAGED_TRANSPORT", "NON_TCG", "TCG"];
    const expectedProviderCaseCount = expectedCaseIds.length;
    expect(resolutionRequests).toHaveLength(expectedProviderCaseCount);
    expect(resolutionRequests.every((request) => request.method === "GET")).toBe(true);
    expect(evidence.cases.map((entry) => entry.case_id).sort())
      .toEqual(expectedCaseIds);
    requireInvariant(feedbackPolicyChecks.length === expectedProviderCaseCount
      && feedbackPolicyChecks.map((entry) => entry.case_id).sort().join("\0")
        === expectedCaseIds.join("\0")
      && evidence.cases.every((entry) => entry.feedback_policy_passed === true
        && entry.feedback_saved === true
        && entry.feedback_data_use === ADMIN_TEST_DATASET_DISPOSITION
        && entry.dataset_disposition === FEEDBACK_DATASET_DISPOSITION
        && entry.durable_dataset_disposition === FEEDBACK_DATASET_DISPOSITION
        && entry.training_eligible === false
        && entry.production_promotion_eligible === false),
    verifierErrorCodes.FEEDBACK_POLICY_MISMATCH);
    evidence.stages.feedback_policy = {
      passed: true,
      checked_count: feedbackPolicyChecks.length,
      feedback_data_use: ADMIN_TEST_DATASET_DISPOSITION,
      dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
      durable_dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
      training_eligible: false,
      production_promotion_eligible: false
    };
    const providerResponseReceiptHashes = evidence.cases.map(
      (entry) => entry?.execution_receipt?.provider_response_id_sha256
    );
    const providerAuthorityOperationHashes = evidence.cases.map(
      (entry) => entry?.execution_receipt?.provider_authority_receipt?.operation_key_sha256
    );
    requireInvariant(providerResponseReceiptHashes.every((value) => /^[0-9a-f]{64}$/.test(value))
      && providerResponseReceiptHashes.length === expectedProviderCaseCount
      && new Set(providerResponseReceiptHashes).size === evidence.cases.length
      && providerAuthorityOperationHashes.every((value) => /^[0-9a-f]{64}$/.test(value))
      && new Set(providerAuthorityOperationHashes).size === evidence.cases.length
      && evidence.cases.every((entry) => providerAttemptsForWriter(
        writerProjectionMode
      ).includes(entry.provider_attempt_number)
        && entry.provider_retry_count === entry.provider_attempt_number - 1
        && (capturedProductionWriterMode(writerProjectionMode)
          ? entry.execution_receipt?.provider_transport_retry_receipt === null
          : entry.provider_attempt_number === 1
          ? entry.execution_receipt?.provider_transport_retry_receipt === null
          : entry.execution_receipt?.provider_transport_retry_receipt
            ?.schema_version === "luna-definitive-502-transport-retry-receipt-v1")
        && entry.execution_receipt?.execution_origin === "FRESH_CURRENT"
        && entry.recognition_session_id === `csmsess_${
          entry.execution_receipt?.provider_authority_receipt?.operation_key_sha256.slice(0, 40)
        }`),
    verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH);
    requireInvariant(
      evidence.stages.writer_editable_title_latency?.sample_count === expectedProviderCaseCount
      && evidence.stages.writer_editable_title_latency?.hard_limit_passed === true
      && evidence.stages.writer_editable_title_latency?.diagnostic_only === true
      && evidence.stages.writer_editable_title_latency?.optimization_sample_eligible === false,
    verifierErrorCodes.WRITER_TITLE_LATENCY_HARD_LIMIT_EXCEEDED);
    const recognitionPostReceipt = recognitionPostSeal(recognitionPosts, evidence.cases);
    evidence.stages.warmup = warmupResponseReceipt(warmupTransport.requests);
    expect(ids.asset_id.size, "asset_id must be captured")
      .toBeGreaterThanOrEqual(expectedProviderCaseCount);
    expect(ids.session_id.size, "recognition_session_id must be captured")
      .toBeGreaterThanOrEqual(expectedProviderCaseCount);
    expect(requestIds.size, "request_id must be captured").toBeGreaterThan(0);
    const largeCaseEvidence = evidence.cases.find((entry) => (
      entry.case_id === "LARGE_STAGED_TRANSPORT"
    ));
    const parityCaseEvidence = evidence.cases.find((entry) => (
      entry.case_id === "EXTERNAL_IDENTITY"
    ));
    const standardCaseEvidence = evidence.cases.find((entry) => (
      entry.case_id === "NON_TCG"
    ));
    const tcgCaseEvidence = evidence.cases.find((entry) => entry.case_id === "TCG");
    const webCaseEvidence = evidence.cases.find(
      (entry) => entry.case_id === "NON_TCG_WEB_IDENTITY"
    );
    const transportOnlyCases = evidence.cases.filter((entry) => entry.transport_only === true);
    const semanticCases = evidence.cases.filter((entry) => entry.transport_only !== true);
    const webReceiptClassifications = capturedProductionWriterMode(writerProjectionMode)
      ? [] : semanticCases.map((entry) => {
        const view = resolutionViewsByCaseId.get(entry.case_id);
        return Object.freeze({
          entry,
          proof: classifyFounderWebSearch(
            view?.founder_beta_web_receipt, view, {
              originalSetSha256: entry.original_set_sha256
            }
          )
        });
      });
    const qualifiedGovernedWebCases = webReceiptClassifications.filter(
      ({ proof }) => proof?.classification
        === FOUNDER_WEB_SEARCH_CLASSIFICATION.GOVERNED_APPLIED_SUPPORT
    ).map((classification) => classification.entry);
    const strictNoSearchCases = webReceiptClassifications.filter(
      ({ proof }) => proof?.classification
        === FOUNDER_WEB_SEARCH_CLASSIFICATION.STRICT_NO_SEARCH
    ).map((classification) => classification.entry);
    const usedWithoutGovernedAppliedSupportCases = webReceiptClassifications.filter(
      ({ proof }) => proof?.classification
        === FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT
    ).map((classification) => classification.entry);
    const governedWebCaseEvidence = qualifiedGovernedWebCases[0];
    const webReceiptClaimsMatchViews = capturedProductionWriterMode(writerProjectionMode)
      ? semanticCases.every((entry) => !Object.prototype.hasOwnProperty.call(
        entry || {}, "founder_web_search"
      )
        && capturedProductionProjectionReceiptsOmitted(
          resolutionViewsByCaseId.get(entry.case_id)
        ))
      : webReceiptClassifications.every(({ entry, proof }) => (
        proof != null
        && entry?.founder_web_search?.classification === proof.classification
        && entry?.founder_web_search?.governed_applied_support
          === proof.governed_applied_support
        && entry?.founder_web_search?.strict_no_search === proof.strict_no_search
        && entry?.founder_web_search?.used_without_governed_applied_support
          === proof.used_without_governed_applied_support
      ));
    const lotCaseEvidence = evidence.cases.find(
      (entry) => entry.case_id === "LOT_SHARED_ONLY"
    );
    requireInvariant(evidence.cases.every((entry) => (
      hasExactKeys(entry.execution_receipt?.server_stages_ms, requiredServerStageNames)
      && Object.values(entry.execution_receipt.server_stages_ms).every(
        (value) => Number.isFinite(value) && value >= 0
      )
      && hasExactKeys(
        entry.execution_receipt?.provider_authority_receipt,
        providerAuthorityReceiptEvidenceKeys
      )
      && entry.execution_receipt.provider_authority_receipt.schema_version
        === "csm-provider-authority-receipt-v1"
      && /^[0-9a-f]{64}$/.test(
        entry.execution_receipt.provider_authority_receipt.operation_key_sha256
      )
      && entry.execution_receipt?.provider_authority_receipt?.estimated_tokens
        === expectedEstimatedTokensPerAttempt
      && entry.execution_receipt?.provider_authority_receipt?.attempt
        === entry.provider_attempt_number
      && entry.execution_receipt?.provider_authority_receipt?.attempt_class
        === (entry.provider_attempt_number === 1 ? "fresh" : "retry")
      && ["admitted", "claim_receipt_replayed"].includes(
        entry.execution_receipt?.provider_authority_receipt?.claim_code
      )
      && ["settled", "exact_replay"].includes(
        entry.execution_receipt?.provider_authority_receipt?.settle_code
      )
      && entry.execution_receipt?.provider_authority_receipt?.operation_status === "SUCCEEDED"
      && entry.owner_execution_readback?.durable_read_after_write === true
      && entry.owner_execution_readback?.sha256
        === entry.execution_receipt?.owner_execution_receipt_sha256
    ))
      && standardCaseEvidence?.source_kind === "PRODUCTION_ASSET"
      && standardCaseEvidence?.source_record_id
        === WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_record_id
      && standardCaseEvidence?.source_asset_id
        === PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.source_asset_id
      && transportOnlyCases.length === 1
      && transportOnlyCases[0]?.case_id === "LARGE_STAGED_TRANSPORT"
      && transportOnlyCases[0]?.founder_web_search == null
      && evidence.cases.every((entry) => (
        entry.case_id === "LARGE_STAGED_TRANSPORT"
          ? entry.transport_only === true
          : entry.transport_only !== true
      ))
      && (parityRequired
        ? ordinaryActivationSeal({
          writerProjectionMode,
          standardCaseEvidence,
          tcgCaseEvidence,
          largeCaseEvidence,
          parityCaseEvidence,
          webCaseEvidence,
          lotCaseEvidence,
          semanticCases,
          webReceiptClaimsMatchViews,
          qualifiedGovernedWebCases,
          strictNoSearchCases,
          usedWithoutGovernedAppliedSupportCases,
          governedWebCaseEvidence
        })
        : compatibilityBridgeSeal({
          writerProjectionMode,
          evidenceCases: evidence.cases,
          standardCaseEvidence,
          tcgCaseEvidence,
          largeCaseEvidence,
          parityCaseEvidence,
          webCaseEvidence,
          lotCaseEvidence,
          semanticCases,
          transportOnlyCases,
          webReceiptClassifications,
          webReceiptClaimsMatchViews,
          qualifiedGovernedWebCases,
          strictNoSearchCases,
          usedWithoutGovernedAppliedSupportCases,
          governedWebCaseEvidence
        })),
    verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH);
    evidence.final_seal = {
      provider_case_count: expectedProviderCaseCount,
      fresh_current_case_count: expectedProviderCaseCount,
      distinct_provider_response_receipts: true,
      distinct_provider_authority_operations: true,
      complete_server_stage_receipts: true,
      exact_authority_token_reservation: expectedEstimatedTokensPerAttempt,
      durable_owner_execution_readback_count: expectedProviderCaseCount,
      feedback_policy_receipt_count: expectedProviderCaseCount,
      writer_editable_title_latency_sample_count: expectedProviderCaseCount,
      writer_editable_title_latency_hard_limit_passed: true,
      codex_parity_exact_match_count: parityRequired ? 1 : 0,
      verified_original_set_match_count: parityRequired ? 1 : 0,
      canonical_naming_active_case_count: evidence.cases.filter(
        (entry) => entry.canonical_naming_active === true
      ).length,
      captured_e1ae_standard_active_case_count: evidence.cases.filter(
        (entry) => entry.captured_e1ae_standard_active === true
      ).length,
      standard_p0_exact_case_count: evidence.cases.filter(
        (entry) => productionStandardP0EvidenceProofValid(entry.standard_p0_identity)
      ).length,
      compatibility_bridge_standard_case_count: evidence.cases.filter(
        (entry) => entry.compatibility_bridge_standard_active === true
      ).length,
      verified_original_observation_active_case_count: evidence.cases.filter(
        (entry) => entry.verified_original_observation_active === true
      ).length,
      qualified_governed_web_support_case_count: qualifiedGovernedWebCases.length,
      strict_no_search_case_count: strictNoSearchCases.length,
      used_without_governed_applied_support_case_count:
        usedWithoutGovernedAppliedSupportCases.length,
      semantic_web_case_count: capturedProductionWriterMode(writerProjectionMode)
        ? 0 : semanticCases.length,
      transport_only_web_excluded_case_count: transportOnlyCases.length,
      selected_forward_readback_case_id: capturedProductionWriterMode(writerProjectionMode)
        ? null : governedWebCaseEvidence?.case_id,
      durable_projection_receipts_absent:
        capturedProductionWriterMode(writerProjectionMode),
      durable_projection_receipt_omission_case_count:
        capturedProductionWriterMode(writerProjectionMode) ? evidence.cases.length : 0,
      warmup_real_response_observed: true,
      staged_overlap_observed: true,
      staged_relays_durable_before_recognition_response: true,
      ...recognitionPostReceipt
    };
    evidence.stages.live_contract = { passed: true, case_count: evidence.cases.length };
    evidence.passed = true;
    const forwardReadbackResolutionView = parityRequired
      ? resolutionViewsByCaseId.get(governedWebCaseEvidence?.case_id)
      : standardResolutionView;
    requireInvariant(forwardReadbackResolutionView != null,
      verifierErrorCodes.RESOLUTION_VIEW_MISMATCH);
    const forwardReadbackExpectation = buildProductionForwardReadbackExpectation({
      evidence,
      resolutionView: forwardReadbackResolutionView,
      deploymentUrl: baseUrl,
      gitSha: expectedSha
    });
    await writeProductionForwardReadbackExpectation(
      requiredEnv("WRITER_JOURNEY_FORWARD_READBACK_EXPECTATION"),
      forwardReadbackExpectation
    );
    evidence.stages.forward_readback_expectation = {
      passed: true,
      case_id: forwardReadbackExpectation.case_id,
      asset_id: forwardReadbackExpectation.asset_id,
      recognition_session_id: forwardReadbackExpectation.recognition_session_id,
      provider_calls: 0
    };
  } catch (error) {
    evidence.passed = false;
    const errorCode = sanitizedFailureCode(error);
    evidence.error_code = errorCode;
    evidence.failed_case_id = liveFailureCaseIds.has(failureCaseId) ? failureCaseId : null;
    evidence.failed_phase = liveFailurePhases.has(failurePhase) ? failurePhase : "UNCLASSIFIED";
    throw verifierFailure(errorCode);
  } finally {
    evidence.finished_at = new Date().toISOString();
    await Promise.allSettled([...responseCaptureTasks]);
    evidence.request_ids = [...requestIds];
    evidence.asset_ids = [...ids.asset_id];
    evidence.batch_ids = [...ids.batch_id];
    evidence.job_ids = [...ids.job_id];
    evidence.session_ids = [...ids.session_id];
    await journeyContext?.close().catch(() => {});
    await Promise.allSettled([...pendingPageWaits]);
    await loginContext?.close().catch(() => {});
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (!evidence.passed) {
      await testInfo.attach("writer-journey-evidence", {
        path: evidencePath,
        contentType: "application/json"
      }).catch(() => {});
    }
  }
});

test("offline TCG authority abstention bypasses designated relation proof @offline", () => {
  const unresolvedUrl = "https://example.com/unresolved-collectible-identity";
  const resolutionView = {
    founder_beta_web_receipt: {
      schema_version: "founder-beta-web-receipt-v1",
      provider_request_count: 1,
      isolated_model_call_count: 0,
      provider_model: "gpt-5.6-luna",
      reasoning_effort: "low",
      web_search_used: true,
      web_search_call_count: 1,
      queries: ["unresolved collectible identity"],
      urls: [unresolvedUrl],
      field_evidence: ["product", "set"].map((field) => ({
        field,
        support_urls: [],
        conflict_urls: [],
        unresolved_urls: [unresolvedUrl]
      })),
      semantic_state_sha256: "a".repeat(64)
    },
    set_card_name_relation_receipt: {
      schema_version: "set-card-name-relations-v1",
      set: null,
      card_name: null
    }
  };
  const tcgCase = { case_id: "TCG" };
  const founderProof = founderWebSearchProof(tcgCase, resolutionView);
  expect(founderProof.web_search_used).toBe(true);
  expect(founderProof.classification).toBe(
    FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT
  );
  expect(founderProof.used_without_governed_applied_support).toBe(true);
  expect(founderProof.unresolved_authority_fields).toEqual(["product", "set"]);
  expect(activationProjectionProofForCase(
    tcgCase, resolutionView, "unused"
  )).toBeNull();
  expect(() => activationProjectionProofForCase(
    { case_id: "NON_TCG_WEB_IDENTITY" }, resolutionView, "Anthony Edwards"
  )).toThrow(verifierErrorCodes.ACTIVATION_RECEIPT_MISMATCH);
});

test("offline verifier boundaries redact titles and reject identity drift @offline", async () => {
  const warmupProof = warmupResponseReceipt([{
    request_sequence: 1,
    response_sequence: 2,
    response_observed: true,
    response_status: 405
  }]);
  requireInvariant(warmupProof.response_count === 1
    && warmupProof.http_statuses[0] === 405,
  verifierErrorCodes.GENERIC);
  for (const invalidWarmups of [[], [{
    request_sequence: 1,
    response_sequence: null,
    response_observed: false,
    response_status: null
  }]]) {
    let missingWarmupResponseRejected = false;
    try { warmupResponseReceipt(invalidWarmups); } catch {
      missingWarmupResponseRejected = true;
    }
    requireInvariant(missingWarmupResponseRejected, verifierErrorCodes.GENERIC);
  }

  const offlineSha = "a".repeat(40);
  const offlineHealth = {
    ready: true,
    active_path: "CSM_THIN_DIRECT",
    model: CSM_ACTIVE_MODEL_PROFILE.model,
    reasoning_effort: CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
    deployment: {
      git_commit_sha: offlineSha,
      environment: "production"
    },
    runtime: {
      model_profile_id: CSM_ACTIVE_MODEL_PROFILE.id,
      provider_adapter_version: expectedProviderAdapterVersion,
      request_builder_version: expectedProviderAdapterContract.request_builder_version,
      recognition_transport_profiles: Object.fromEntries(
        CSM_RECOGNITION_TRANSPORT_PROFILES.map((profile) => [profile.lane_version, {
          ...profile,
          sha256: sha256CsmRecognitionTransportReceipt(profile)
        }])
      ),
      execution_contract_sha256_by_transport_lane_and_image_count:
        expectedExecutionContractSha256ByTransportLaneAndImageCount,
      external_identity: EXTERNAL_IDENTITY_RELEASE_CONTRACT,
      canonical_naming_target: CANONICAL_NAMING_RELEASE_CONTRACT,
      verified_original_observation: VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT,
      max_output_tokens: CSM_ACTIVE_MODEL_PROFILE.max_output_tokens,
      retired_capabilities_disabled: true
    }
  };
  requireInvariant(writerJourneyHealthReceipt({
    httpOk: true,
    health: offlineHealth,
    expectedSha: offlineSha,
    expectedOrigin: productionOrigin,
    responseUrl: `${productionOrigin}/api/health`
  }).ready === true, verifierErrorCodes.GENERIC);
  const capturedProductionHealth = structuredClone(offlineHealth);
  capturedProductionHealth.runtime.canonical_naming_target =
    CANONICAL_NAMING_RELEASE_CONTRACT_V2;
  capturedProductionHealth.runtime.verified_original_observation =
    VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT;
  capturedProductionHealth.runtime.projection_activation = CSM_PROJECTION_ACTIVATION;
  capturedProductionHealth.runtime.active_writer =
    CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible;
  capturedProductionHealth.runtime.forward_readers = CSM_PROJECTION_ACTIVATION.forward_readers;
  capturedProductionHealth.runtime.request_builder_version =
    expectedProviderAdapterContract.request_builder_version;
  requireInvariant(writerJourneyHealthReceipt({
    httpOk: true,
    health: capturedProductionHealth,
    expectedSha: offlineSha,
    expectedOrigin: productionOrigin,
    responseUrl: `${productionOrigin}/api/health`,
    writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE
  }).runtime_contract_valid === true, verifierErrorCodes.GENERIC);
  for (const mutate of [
    (health) => { health.runtime.canonical_naming_target = CANONICAL_NAMING_RELEASE_CONTRACT_V3; },
    (health) => {
      health.runtime.verified_original_observation =
        VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT;
    },
    (health) => { health.runtime.active_writer = CSM_WRITER_PROJECTION_CONTRACTS.future_v3; },
    (health) => { health.runtime.forward_readers = {}; },
    (health) => { health.runtime.request_builder_version = "canonical-fields-web-request-v2"; }
  ]) {
    const drifted = structuredClone(capturedProductionHealth);
    mutate(drifted);
    let rejected = false;
    try {
      writerJourneyHealthReceipt({
        httpOk: true,
        health: drifted,
        expectedSha: offlineSha,
        expectedOrigin: productionOrigin,
        responseUrl: `${productionOrigin}/api/health`,
        writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE
      });
    } catch {
      rejected = true;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }
  let deploymentOriginDriftRejected = false;
  try {
    writerJourneyHealthReceipt({
      httpOk: true,
      health: offlineHealth,
      expectedSha: offlineSha,
      expectedOrigin: productionOrigin,
      responseUrl: "https://wrong-deployment.vercel.app/api/health"
    });
  } catch {
    deploymentOriginDriftRejected = true;
  }
  requireInvariant(deploymentOriginDriftRejected, verifierErrorCodes.GENERIC);
  for (const invalidHealth of [
    { ...offlineHealth, ready: false },
    { ...offlineHealth, reasoning_effort: "none" },
    {
      ...offlineHealth,
      runtime: { ...offlineHealth.runtime, retired_capabilities_disabled: false }
    },
    {
      ...offlineHealth,
      runtime: {
        ...offlineHealth.runtime,
        canonical_naming_target: {
          ...CANONICAL_NAMING_RELEASE_CONTRACT,
          composer_version: "thin-marketplace-composer-v2"
        }
      }
    }
  ]) {
    let invalidHealthRejected = false;
    try {
      writerJourneyHealthReceipt({
        httpOk: true,
        health: invalidHealth,
        expectedSha: offlineSha,
        expectedOrigin: productionOrigin,
        responseUrl: `${productionOrigin}/api/health`
      });
    } catch {
      invalidHealthRejected = true;
    }
    requireInvariant(invalidHealthRejected, verifierErrorCodes.GENERIC);
  }

  const offlineFeedbackPayload = {
    feedback_data_use: ADMIN_TEST_DATASET_DISPOSITION,
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
    training_eligible: false,
    production_promotion_eligible: false,
    v4_persistence: {
      transaction: {
        saved: true,
        transaction: {
          dataset_disposition: FEEDBACK_DATASET_DISPOSITION
        }
      }
    }
  };
  requireInvariant(feedbackPolicyReceipt({
    httpOk: true,
    payload: offlineFeedbackPayload
  }).feedback_policy_passed === true, verifierErrorCodes.GENERIC);
  for (const invalidFeedback of [
    { httpOk: false, payload: offlineFeedbackPayload },
    {
      httpOk: true,
      payload: {
        ...offlineFeedbackPayload,
        v4_persistence: {
          transaction: {
            ...offlineFeedbackPayload.v4_persistence.transaction,
            saved: false
          }
        }
      }
    },
    {
      httpOk: true,
      payload: { ...offlineFeedbackPayload, feedback_data_use: FEEDBACK_DATASET_DISPOSITION }
    },
    {
      httpOk: true,
      payload: { ...offlineFeedbackPayload, dataset_disposition: ADMIN_TEST_DATASET_DISPOSITION }
    },
    {
      httpOk: true,
      payload: {
        ...offlineFeedbackPayload,
        v4_persistence: {
          transaction: {
            ...offlineFeedbackPayload.v4_persistence.transaction,
            transaction: {
              ...offlineFeedbackPayload.v4_persistence.transaction.transaction,
              dataset_disposition: ADMIN_TEST_DATASET_DISPOSITION
            }
          }
        }
      }
    },
    { httpOk: true, payload: { ...offlineFeedbackPayload, training_eligible: true } },
    {
      httpOk: true,
      payload: { ...offlineFeedbackPayload, production_promotion_eligible: true }
    }
  ]) {
    requireInvariant(feedbackPolicyReceipt(invalidFeedback).feedback_policy_passed === false,
      verifierErrorCodes.GENERIC);
  }

  const offlineRecognitionCases = [
    "NON_TCG", "TCG", "EXTERNAL_IDENTITY", "LARGE_STAGED_TRANSPORT"
  ].map(
    (caseId, index) => ({
      case_id: caseId,
      recognition_session_id: `session-${index}`,
      execution_receipt: { provider_response_id_sha256: String(index + 1).repeat(64) }
    })
  );
  const offlineRecognitionPosts = [
    ...offlineRecognitionCases.map((caseEvidence) => ({
      case_id: caseEvidence.case_id,
      continued: true,
      aborted_before_network: false,
      response_observed: true,
      response_status: 200,
      recognition_session_id: caseEvidence.recognition_session_id,
      provider_response_id_sha256: caseEvidence.execution_receipt.provider_response_id_sha256
    })),
    {
      case_id: "TCG",
      continued: false,
      aborted_before_network: true,
      response_observed: false,
      response_status: null,
      recognition_session_id: null,
      provider_response_id_sha256: null
    }
  ];
  requireInvariant(recognitionPostSeal(
    offlineRecognitionPosts, offlineRecognitionCases
  ).network_continued_provider_requests === 4, verifierErrorCodes.GENERIC);
  const bridgeRecognitionCases = offlineRecognitionCases.filter(
    (entry) => entry.case_id !== "EXTERNAL_IDENTITY"
  );
  const bridgeRecognitionPosts = offlineRecognitionPosts.filter(
    (entry) => entry.case_id !== "EXTERNAL_IDENTITY"
  );
  const bridgeRecognitionSeal = recognitionPostSeal(
    bridgeRecognitionPosts, bridgeRecognitionCases
  );
  requireInvariant(bridgeRecognitionSeal.recognition_post_count === 4
    && bridgeRecognitionSeal.network_continued_provider_requests === 3,
  verifierErrorCodes.GENERIC);
  for (const invalidPosts of [
    [...offlineRecognitionPosts, { ...offlineRecognitionPosts[0] }],
    offlineRecognitionPosts.map((entry, index) => index === 0
      ? { ...entry, provider_response_id_sha256: "f".repeat(64) }
      : entry),
    offlineRecognitionPosts.map((entry, index) => index === 0
      ? { ...entry, response_status: 500 }
      : entry)
  ]) {
    let recognitionPostDriftRejected = false;
    try { recognitionPostSeal(invalidPosts, offlineRecognitionCases); } catch {
      recognitionPostDriftRejected = true;
    }
    requireInvariant(recognitionPostDriftRejected, verifierErrorCodes.GENERIC);
  }
  for (const invalidBridgePosts of [
    bridgeRecognitionPosts.slice(1),
    [...bridgeRecognitionPosts, { ...bridgeRecognitionPosts[0] }]
  ]) {
    let bridgeRecognitionPostDriftRejected = false;
    try { recognitionPostSeal(invalidBridgePosts, bridgeRecognitionCases); } catch {
      bridgeRecognitionPostDriftRejected = true;
    }
    requireInvariant(bridgeRecognitionPostDriftRejected, verifierErrorCodes.GENERIC);
  }

  const offlineTcgContract = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS.find(
    (entry) => entry.case_id === "TCG"
  );
  const manifest = {
    schema_version: "writer-journey-cases-v4",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    accuracy_claim: null,
    cases: [{
      case_id: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.case_id,
      expected_grammar: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.expected_grammar,
      source_kind: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_kind,
      source_record_id: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_record_id,
      source_asset_id: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.source_asset_id,
      evaluation_cohort: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.evaluation_cohort,
      hash_provenance: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.hash_provenance,
      image_count: 2,
      files: WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images.map((image) => ({
        path: `/not-read/NON_TCG/${image.role}.webp`,
        role: image.role,
        bytes: image.bytes,
        content_type: image.content_type,
        content_sha256: image.content_sha256
      }))
    }, {
      case_id: "TCG",
      expected_grammar: offlineTcgContract.expected_grammar,
      source_feedback_id: offlineTcgContract.source_feedback_id,
      evaluation_cohort: offlineTcgContract.evaluation_cohort,
      hash_provenance: offlineTcgContract.hash_provenance,
      image_count: 2,
      files: ["front", "back"].map((side, index) => ({
        path: `/not-read/TCG/${side}.jpg`,
        role: `${side}_original`,
        bytes: 100 + index,
        content_type: "image/jpeg",
        content_sha256: offlineTcgContract.image_sha256[
          `${offlineTcgContract.source_feedback_id}_${side}`
        ]
      }))
    }],
    parity_case: {
      case_id: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.case_id,
      expected_grammar: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.expected_grammar,
      source_kind: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_kind,
      source_record_id: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_record_id,
      source_asset_id: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_asset_id,
      evaluation_cohort: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.evaluation_cohort,
      hash_provenance: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.hash_provenance,
      image_count: 2,
      files: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images.map((image) => ({
        path: `/not-read/EXTERNAL_IDENTITY/${image.role}.webp`,
        role: image.role,
        content_type: "image/webp",
        content_sha256: image.content_sha256
      }))
    },
    activation_cases: WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map((contract) => ({
      case_id: contract.case_id,
      expected_grammar: contract.expected_grammar,
      ...(contract.case_id === "NON_TCG_WEB_IDENTITY"
        ? {} : { expected_lot_count: contract.expected_lot_count }),
      original_set_sha256: contract.original_set_sha256,
      source_feedback_id: contract.source_feedback_id,
      evaluation_cohort: contract.evaluation_cohort,
      hash_provenance: contract.hash_provenance,
      image_count: 2,
      files: ["front", "back"].map((side) => ({
        path: `/not-read/${contract.case_id}/${side}.jpg`,
        role: `${side}_original`,
        bytes: 200,
        content_type: "image/jpeg",
        content_sha256: contract.image_sha256[
          `${contract.source_feedback_id}_${side}`
        ]
      }))
    }))
  };
  requireInvariant(validateSourceCasesManifest(manifest).length === 5
    && validateSourceCasesManifest(manifest).every((entry) => (
    entry.files.map((file) => file.role).join(",") === "front_original,back_original"
    )), verifierErrorCodes.GENERIC);
  const bridgeGitSha = "b".repeat(40);
  const bridgeManifest = {
    schema_version: COMPATIBILITY_BRIDGE_MANIFEST_VERSION,
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_marker: COMPATIBILITY_BRIDGE_MARKER,
    git_sha: bridgeGitSha,
    evidence_scope: manifest.evidence_scope,
    accuracy_claim: null,
    cases: manifest.cases
  };
  requireInvariant(validateSourceCasesManifest(bridgeManifest, {
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    expectedGitSha: bridgeGitSha
  }).length === 2, verifierErrorCodes.GENERIC);
  const bridgeV2Manifest = {
    schema_version: COMPATIBILITY_BRIDGE_V2_MANIFEST_VERSION,
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID,
    bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER,
    git_sha: bridgeGitSha,
    evidence_scope: manifest.evidence_scope,
    accuracy_claim: null,
    cases: manifest.cases
  };
  requireInvariant(validateSourceCasesManifest(bridgeV2Manifest, {
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    expectedGitSha: bridgeGitSha
  }).length === 2, verifierErrorCodes.GENERIC);
  const bridgeV3Manifest = {
    schema_version: COMPATIBILITY_BRIDGE_V3_MANIFEST_VERSION,
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_descriptor_id:
      EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_DESCRIPTOR_ID,
    bridge_marker: EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_MARKER,
    git_sha: bridgeGitSha,
    writer_projection_mode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
    evidence_scope: manifest.evidence_scope,
    accuracy_claim: null,
    cases: manifest.cases
  };
  requireInvariant(validateSourceCasesManifest(bridgeV3Manifest, {
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    expectedGitSha: bridgeGitSha
  }).length === 2, verifierErrorCodes.GENERIC);
  const bridgeV4Manifest = {
    schema_version: COMPATIBILITY_BRIDGE_V4_MANIFEST_VERSION,
    release_class: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    bridge_descriptor_id:
      EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_DESCRIPTOR_ID,
    bridge_marker: EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_OLD_READER_NEW_MARKER,
    git_sha: bridgeGitSha,
    writer_projection_mode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
    evidence_scope: manifest.evidence_scope,
    accuracy_claim: null,
    cases: manifest.cases
  };
  requireInvariant(validateSourceCasesManifest(bridgeV4Manifest, {
    releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
    expectedGitSha: bridgeGitSha
  }).length === 2, verifierErrorCodes.GENERIC);
  for (const [candidate, options] of [
    [bridgeManifest, { releaseClass: ORDINARY_RELEASE_CLASS }],
    [manifest, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeManifest, git_sha: "c".repeat(40) }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV2Manifest, bridge_descriptor_id: "compatibility-bridge-v3" }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV2Manifest, bridge_marker: COMPATIBILITY_BRIDGE_MARKER }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV3Manifest, writer_projection_mode: null }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV3Manifest, writer_projection_mode: "legacy-or-canonical" }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV3Manifest, bridge_descriptor_id: COMPATIBILITY_BRIDGE_V2_DESCRIPTOR_ID }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV3Manifest, bridge_marker: COMPATIBILITY_BRIDGE_V2_MARKER }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV4Manifest,
      writer_projection_mode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV4Manifest,
      bridge_descriptor_id:
        EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_DESCRIPTOR_ID }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV4Manifest,
      bridge_marker: EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_MARKER }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{ ...bridgeV3Manifest,
      writer_projection_mode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }],
    [{
      ...bridgeV2Manifest,
      bridge_descriptor_id:
        EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_DESCRIPTOR_ID,
      bridge_marker: EXTERNAL_IDENTITY_V3_BRIDGE_WRITER_JOURNEY_MODE_REPAIR_MARKER
    }, {
      releaseClass: COMPATIBILITY_BRIDGE_RELEASE_CLASS,
      expectedGitSha: bridgeGitSha
    }]
  ]) {
    let crossClassManifestRejected = false;
    try { validateSourceCasesManifest(candidate, options); } catch {
      crossClassManifestRejected = true;
    }
    requireInvariant(crossClassManifestRejected, verifierErrorCodes.GENERIC);
  }
  for (const invalidFiles of [
    [manifest.cases[0].files[1], manifest.cases[0].files[0]],
    [manifest.cases[0].files[0], manifest.cases[0].files[0]]
  ]) {
    let roleDriftRejected = false;
    try {
      validateSourceCasesManifest({
        ...manifest,
        cases: [{ ...manifest.cases[0], files: invalidFiles }, manifest.cases[1]]
      });
    } catch {
      roleDriftRejected = true;
    }
    requireInvariant(roleDriftRejected, verifierErrorCodes.GENERIC);
  }
  for (const standardMutation of [
    { source_kind: "SUPABASE_FEEDBACK" },
    { source_record_id: "asset-drift" },
    { source_asset_id: "asset-drift" },
    { expected_card_number: "251" },
    { files: [
      { ...manifest.cases[0].files[0], content_sha256: "f".repeat(64) },
      manifest.cases[0].files[1]
    ] }
  ]) {
    let standardSourceDriftRejected = false;
    try {
      validateSourceCasesManifest({
        ...manifest,
        cases: [{ ...manifest.cases[0], ...standardMutation }, manifest.cases[1]]
      });
    } catch {
      standardSourceDriftRejected = true;
    }
    requireInvariant(standardSourceDriftRejected, verifierErrorCodes.GENERIC);
  }
  const exactStandardP0View = {
    composer: {
      title: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title,
      stored_title: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title
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
    }]
  };
  requireInvariant(productionStandardP0ResolutionProofValid(
    productionStandardP0ResolutionProof(exactStandardP0View)
  ), verifierErrorCodes.GENERIC);
  requireInvariant(!productionStandardP0ResolutionProofValid(
    productionStandardP0ResolutionProof({
      ...exactStandardP0View,
      composer: { title: "#251 50/50", stored_title: "#251 50/50" }
    })
  ), verifierErrorCodes.GENERIC);
  for (const parityMutation of [
    { source_asset_id: "asset-drift" },
    { files: [manifest.parity_case.files[1], manifest.parity_case.files[0]] },
    { files: [
      { ...manifest.parity_case.files[0], content_sha256: "f".repeat(64) },
      manifest.parity_case.files[1]
    ] }
  ]) {
    let parityDriftRejected = false;
    try {
      validateSourceCasesManifest({
        ...manifest,
        parity_case: { ...manifest.parity_case, ...parityMutation }
      });
    } catch {
      parityDriftRejected = true;
    }
    requireInvariant(parityDriftRejected, verifierErrorCodes.GENERIC);
  }

  requireInvariant(codexParityTitleMatches({
    recognitionTitle: CODEX_PARITY_EXPECTED_TITLE,
    uiTitle: CODEX_PARITY_EXPECTED_TITLE,
    storedTitle: CODEX_PARITY_EXPECTED_TITLE
  }) && !codexParityTitleMatches({
    recognitionTitle: CODEX_PARITY_EXPECTED_TITLE,
    uiTitle: `${CODEX_PARITY_EXPECTED_TITLE} drift`,
    storedTitle: CODEX_PARITY_EXPECTED_TITLE
  }), verifierErrorCodes.GENERIC);

  const externalFields = [
    "card_number", "manufacturer", "product", "set", "subjects", "team", "year"
  ];
  const allSourceIds = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map((source) => source.source_id);
  const publicExternalSupport = {
    schema_version: "csm-external-identity-public-receipt.v1",
    status: "APPLIED",
    match_basis: "VERIFIED_ORIGINAL_SET",
    registry_release: { ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT },
    resolver_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.resolver_version,
    conflict_policy_version:
      EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.conflict_policy_version,
    composer_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version,
    marketplace_profile_version:
      EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version,
    resolution_contract_sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.sha256,
    pack: {
      id: EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.id,
      version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.version,
      sha256: EXTERNAL_IDENTITY_RELEASE_CONTRACT.support_pack.sha256
    },
    index: { ...EXTERNAL_IDENTITY_RELEASE_CONTRACT.index },
    record_id: "tcdb-2551-hr14",
    supported_fields: externalFields,
    field_decisions: Object.fromEntries(externalFields.map((field) => [field, {
      action: field === "card_number" ? "FILL" : "CORROBORATE",
      source_ids: allSourceIds
    }])),
    sources: EXTERNAL_IDENTITY_SUPPORT_PACK.sources.map((source) => ({
      provider: source.source_id.startsWith("tcdb.")
        ? "TCDB"
        : source.source_id.startsWith("psa.") ? "PSA" : "Beckett",
      source_id: source.source_id,
      url: source.url,
      retrieved_at: source.retrieved_at,
      fact_sha256: source.fact_sha256,
      fields: ["card_number"]
    }))
  };
  requireInvariant(externalIdentityParityProof({
    external_identity_support: publicExternalSupport
  }).source_count === 3, verifierErrorCodes.GENERIC);
  for (const mutate of [
    (value) => { value.record_id = "tcdb-2551-hr13"; },
    (value) => { value.match_basis = "EXACT_FOUR_ANCHOR"; },
    (value) => { value.original_set_sha256 = "9".repeat(64); },
    (value) => { value.pack.sha256 = "f".repeat(64); },
    (value) => { value.sources[0].url = "https://attacker.example/source"; },
    (value) => { delete value.field_decisions.card_number; }
  ]) {
    const value = structuredClone(publicExternalSupport);
    mutate(value);
    let externalDriftRejected = false;
    try {
      externalIdentityParityProof({ external_identity_support: value });
    } catch {
      externalDriftRejected = true;
    }
    requireInvariant(externalDriftRejected, verifierErrorCodes.GENERIC);
  }

  const nowSeconds = 1_800_000_000;
  const cookieState = { cookies: [
    { name: "valid", value: "kept", domain: "listing.lyncafei.team", path: "/api", secure: true, expires: nowSeconds + 60 },
    { name: "domain", value: "kept", domain: ".lyncafei.team", path: "/api", secure: true, expires: -1 },
    { name: "evil", value: "drop", domain: "listing.lyncafei.team.evil", path: "/api", secure: true, expires: nowSeconds + 60 },
    { name: "expired", value: "drop", domain: "listing.lyncafei.team", path: "/api", secure: true, expires: nowSeconds - 1 },
    { name: "wrong_path", value: "drop", domain: "listing.lyncafei.team", path: "/app", secure: true, expires: nowSeconds + 60 },
    { name: "path_prefix", value: "drop", domain: "listing.lyncafei.team", path: "/apiary", secure: true, expires: nowSeconds + 60 }
  ] };
  requireInvariant(cookieHeaderForUrl(cookieState, `${canonicalProductionOrigin}/api/health`, { nowSeconds })
    === "valid=kept; domain=kept", verifierErrorCodes.GENERIC);
  requireInvariant(cookieHeaderForUrl({ cookies: [{
    name: "secure_only", value: "drop", domain: "listing.lyncafei.team", path: "/api",
    secure: true, expires: nowSeconds + 60
  }] }, "http://listing.lyncafei.team/api/health", { nowSeconds }) === "",
  verifierErrorCodes.GENERIC);
  const candidateOrigin = "https://lynca-candidate-team.vercel.app";
  const exactCandidateState = { cookies: [{
    name: "candidate", value: "kept", domain: "lynca-candidate-team.vercel.app", path: "/",
    secure: true, expires: nowSeconds + 60
  }], origins: [] };
  requireInvariant(candidateStorageStateBoundToTarget(
    exactCandidateState, `${candidateOrigin}/api/health`
  ), verifierErrorCodes.GENERIC);
  for (const unsafeState of [
    { ...exactCandidateState, cookies: [{ ...exactCandidateState.cookies[0], domain: ".vercel.app" }] },
    { ...exactCandidateState, cookies: [{ ...exactCandidateState.cookies[0], domain: "sibling.vercel.app" }] },
    { ...exactCandidateState, origins: [{ origin: "https://sibling.vercel.app", localStorage: [] }] }
  ]) {
    requireInvariant(!candidateStorageStateBoundToTarget(
      unsafeState, `${candidateOrigin}/api/health`
    ), verifierErrorCodes.GENERIC);
  }
  for (const forbiddenBase of [
    "https://listing.lyncafei.team.evil/",
    "https://preview.example.vercel.app/",
    "http://listing.lyncafei.team/",
    "https://listing.lyncafei.team/app/"
  ]) {
    let rejected = false;
    try { cleanBaseUrl(forbiddenBase); } catch { rejected = true; }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }

  const recognition = {
    csm_contract_version: "csm-stage-v-test",
    csm_owner_versions: {
      resolver: "resolver-v-test",
      composer: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version,
      marketplace_profile:
        EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version
    },
    csm_rows: {
      resolution: { contract_version: "csm-stage-v-test", resolver_version: "resolver-v-test" },
      output: {
        contract_version: "csm-stage-v-test",
        composer_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version
      }
    }
  };
  const view = {
    schema_version: "csm-resolution-view-v1",
    grammar: { contract_version: "csm-resolution-view-v1", resolver_version: "resolver-v-test" },
    composer: {
      composer_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version
    }
  };
  const versions = recognitionVersionReceipt(recognition, view);
  requireInvariant(versions.resolver === "resolver-v-test"
    && versions.composer
      === EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version,
  verifierErrorCodes.GENERIC);
  requireInvariant(PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.length === 7
    && PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.every((entry) => (
      productionPublicCompositionProjectionForOwner({
        composer: entry.composer_version,
        marketplace_profile: entry.marketplace_profile_version
      }) === entry
    ))
    && productionPublicCompositionProjectionForOwner({
      composer: "unknown-composer",
      marketplace_profile: "unknown-profile"
    }) == null,
  verifierErrorCodes.GENERIC);
  const canonicalRecognition = structuredClone(recognition);
  canonicalRecognition.csm_owner_versions.composer =
    CANONICAL_NAMING_RELEASE_CONTRACT.composer_version;
  canonicalRecognition.csm_owner_versions.marketplace_profile =
    CANONICAL_NAMING_RELEASE_CONTRACT.marketplace_profile_version;
  canonicalRecognition.csm_rows.output.composer_version =
    CANONICAL_NAMING_RELEASE_CONTRACT.composer_version;
  canonicalRecognition.csm_rows.output.marketplace_profile_version =
    CANONICAL_NAMING_RELEASE_CONTRACT.marketplace_profile_version;
  const canonicalVersions = recognitionVersionReceipt(canonicalRecognition, {
    ...view,
    composer: {
      composer_version: CANONICAL_NAMING_RELEASE_CONTRACT.composer_version,
      marketplace_profile_version:
        CANONICAL_NAMING_RELEASE_CONTRACT.marketplace_profile_version
    }
  });
  requireInvariant(canonicalNamingVersionActive(canonicalVersions),
    verifierErrorCodes.GENERIC);
  const verifiedOriginalVersions = {
    ...canonicalVersions,
    resolver: VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
  };
  const verifiedOriginalSupport = {
    schema_version: "csm-verified-original-closed-projection-public-receipt.v1",
    status: "APPLIED",
    match_basis: "EXACT_VERIFIED_ORIGINAL_SET",
    release_id: VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.release_id,
    pack_id: "lynca.csm.verified-original-closed-projection.subset-a",
    pack_version: VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.pack_version,
    pack_sha256: VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.pack_sha256,
    resolver_version: VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION,
    conflict_policy_version: VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
    resolution_contract_sha256:
      VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.resolution_contract_sha256,
    projection_mode: "CLOSED_WORLD_EXACT",
    closed_world_field_count:
      VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT.closed_world_field_count
  };
  requireInvariant(verifiedOriginalObservationVersionActive(
    verifiedOriginalVersions, verifiedOriginalSupport
  ), verifierErrorCodes.GENERIC);
  for (const [driftedVersions, driftedSupport] of [
    [{ ...verifiedOriginalVersions, resolver: "resolver-drift" }, verifiedOriginalSupport],
    [verifiedOriginalVersions, { ...verifiedOriginalSupport, resolver_version: "resolver-drift" }],
    [verifiedOriginalVersions, { ...verifiedOriginalSupport, release_id: "release-drift" }],
    [verifiedOriginalVersions, { ...verifiedOriginalSupport, pack_sha256: "0".repeat(64) }],
    [verifiedOriginalVersions, {
      ...verifiedOriginalSupport, conflict_policy_version: "policy-drift"
    }],
    [verifiedOriginalVersions, {
      ...verifiedOriginalSupport, original_set_sha256: "0".repeat(64)
    }],
    [verifiedOriginalVersions, { ...verifiedOriginalSupport, projection_mode: "OPEN_WORLD" }]
  ]) {
    requireInvariant(!verifiedOriginalObservationVersionActive(
      driftedVersions, driftedSupport
    ), verifierErrorCodes.GENERIC);
  }
  const bridgeRecognition = structuredClone(recognition);
  bridgeRecognition.csm_owner_versions.composer = THIN_COMPOSER_VERSION_V2;
  bridgeRecognition.csm_owner_versions.marketplace_profile = EBAY_PROFILE_VERSION;
  bridgeRecognition.csm_rows.output.composer_version = THIN_COMPOSER_VERSION_V2;
  delete bridgeRecognition.csm_rows.output.marketplace_profile_version;
  const bridgeVersions = recognitionVersionReceipt(bridgeRecognition, {
    ...view,
    composer: {
      composer_version: THIN_COMPOSER_VERSION_V2
    }
  });
  requireInvariant(compatibilityBridgeStandardVersionActive(bridgeVersions)
    && !canonicalNamingVersionActive(bridgeVersions), verifierErrorCodes.GENERIC);
  const legacyStandardVersions = Object.freeze({
    ...bridgeVersions,
    resolver: THIN_RESOLVER_VERSION
  });
  const canonicalStandardVersions = Object.freeze({
    ...canonicalVersions,
    resolver: THIN_RESOLVER_VERSION
  });
  const capturedStandardVersions = Object.freeze({
    ...canonicalVersions,
    csm_contract: "csm-stage-shadow-v2",
    resolver: VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION,
    composer: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
    marketplace_profile:
      CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
  });
  const capturedLargeVersions = Object.freeze({
    ...capturedStandardVersions,
    resolver: THIN_RESOLVER_VERSION
  });
  const capturedTcgVersions = Object.freeze({
    ...legacyStandardVersions,
    csm_contract: "csm-stage-shadow-v2"
  });
  const capturedLegacyRelease =
    VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases[
      VERIFIED_ORIGINAL_OBSERVATION_LEGACY_HEALTH_RECEIPT.release_id
    ].receipt;
  const capturedVerifiedOriginalSupport = Object.freeze({
    ...verifiedOriginalSupport,
    release_id: capturedLegacyRelease.release_id,
    pack_id: capturedLegacyRelease.pack_id,
    pack_version: capturedLegacyRelease.pack_version,
    pack_sha256: capturedLegacyRelease.pack_sha256,
    resolver_version: capturedLegacyRelease.resolver_version,
    conflict_policy_version: capturedLegacyRelease.conflict_policy_version,
    resolution_contract_sha256: capturedLegacyRelease.resolution_contract_sha256
  });
  requireInvariant([
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: ORDINARY_WRITER_PROJECTION_MODE,
      versions: verifiedOriginalVersions,
      verifiedOriginalObservationSupport: verifiedOriginalSupport
    }),
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      versions: verifiedOriginalVersions,
      verifiedOriginalObservationSupport: verifiedOriginalSupport
    }),
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE,
      versions: legacyStandardVersions,
      verifiedOriginalObservationSupport: null
    }),
    largeStandardWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      versions: canonicalStandardVersions,
      verifiedOriginalObservationSupport: null,
      externalIdentitySupport: null
    }),
    largeStandardWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE,
      versions: legacyStandardVersions,
      verifiedOriginalObservationSupport: null,
      externalIdentitySupport: null
    }),
    observationLegacyVersionActive(legacyStandardVersions)
  ].every(Boolean), verifierErrorCodes.GENERIC);
  requireInvariant([
    capturedProductionVerifiedOriginalObservationVersionActive(
      capturedStandardVersions, capturedVerifiedOriginalSupport
    ),
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
      versions: capturedStandardVersions,
      verifiedOriginalObservationSupport: capturedVerifiedOriginalSupport
    }),
    largeStandardWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
      versions: capturedLargeVersions,
      grammar: { value: "NON_TCG", raw: "standard" },
      verifiedOriginalObservationSupport: null,
      externalIdentitySupport: null
    }),
    capturedProductionTcgVersionActive(capturedTcgVersions)
  ].every(Boolean), verifierErrorCodes.GENERIC);
  for (const [mode, versions, support] of [
    [COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
      { ...capturedStandardVersions, csm_contract: "csm-stage-shadow-v3" },
      capturedVerifiedOriginalSupport],
    [COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
      { ...capturedStandardVersions,
        marketplace_profile: CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version },
      capturedVerifiedOriginalSupport],
    [COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
      capturedStandardVersions, verifiedOriginalSupport],
    [COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
      capturedStandardVersions, null],
    [COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      capturedStandardVersions, capturedVerifiedOriginalSupport]
  ]) {
    requireInvariant(!standardNonTcgWriterProjectionActive({
      writerProjectionMode: mode,
      versions,
      verifiedOriginalObservationSupport: support
    }), verifierErrorCodes.GENERIC);
  }
  requireInvariant(!largeStandardWriterProjectionActive({
    writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
    versions: { ...capturedLargeVersions, csm_contract: "csm-stage-shadow-v3" },
    grammar: { value: "NON_TCG", raw: "standard" },
    verifiedOriginalObservationSupport: null,
    externalIdentitySupport: null
  }) && !largeStandardWriterProjectionActive({
    writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
    versions: capturedLargeVersions,
    grammar: { value: "TCG", raw: "tcg" },
    verifiedOriginalObservationSupport: null,
    externalIdentitySupport: null
  }) && !capturedProductionTcgVersionActive({
    ...capturedTcgVersions,
    csm_contract: "csm-stage-shadow-v3"
  }), verifierErrorCodes.GENERIC);
  requireInvariant([
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      versions: legacyStandardVersions,
      verifiedOriginalObservationSupport: null
    }),
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V2_WRITER_PROJECTION_MODE,
      versions: verifiedOriginalVersions,
      verifiedOriginalObservationSupport: verifiedOriginalSupport
    }),
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      versions: verifiedOriginalVersions,
      verifiedOriginalObservationSupport: null
    }),
    standardNonTcgWriterProjectionActive({
      writerProjectionMode: "legacy-or-canonical",
      versions: legacyStandardVersions,
      verifiedOriginalObservationSupport: null
    }),
    largeStandardWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      versions: verifiedOriginalVersions,
      verifiedOriginalObservationSupport: verifiedOriginalSupport,
      externalIdentitySupport: null
    }),
    largeStandardWriterProjectionActive({
      writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
      versions: canonicalStandardVersions,
      verifiedOriginalObservationSupport: null,
      externalIdentitySupport: {}
    }),
    observationLegacyVersionActive(canonicalStandardVersions)
  ].every((value) => value === false), verifierErrorCodes.GENERIC);
  const exactStandardP0Evidence = standardP0LiveEvidence({
    recognitionTitle: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title,
    uiTitle: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title,
    resolutionView: exactStandardP0View
  });
  const bridgeStandardEvidence = Object.freeze({
    case_id: "NON_TCG",
    versions: verifiedOriginalVersions,
    canonical_naming_active: true,
    compatibility_bridge_standard_active: false,
    verified_original_observation_active: true,
    standard_p0_identity: exactStandardP0Evidence
  });
  const bridgeTcgEvidence = Object.freeze({
    case_id: "TCG",
    versions: legacyStandardVersions
  });
  const bridgeLargeEvidence = Object.freeze({
    case_id: "LARGE_STAGED_TRANSPORT",
    transport_only: true,
    versions: canonicalStandardVersions,
    overlap_observed: true,
    relay_durable_before_recognition_response: true
  });
  const bridgeSemanticCases = Object.freeze([
    bridgeStandardEvidence, bridgeTcgEvidence
  ]);
  const bridgeStrictClassifications = Object.freeze(bridgeSemanticCases.map((entry) => (
    Object.freeze({ entry, proof: Object.freeze({
      classification: entry.case_id === "NON_TCG"
        ? FOUNDER_WEB_SEARCH_CLASSIFICATION.STRICT_NO_SEARCH
        : FOUNDER_WEB_SEARCH_CLASSIFICATION.USED_WITHOUT_GOVERNED_APPLIED_SUPPORT
    }) })
  )));
  const bridgeSealInput = Object.freeze({
    writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE,
    evidenceCases: Object.freeze([
      bridgeStandardEvidence, bridgeTcgEvidence, bridgeLargeEvidence
    ]),
    standardCaseEvidence: bridgeStandardEvidence,
    tcgCaseEvidence: bridgeTcgEvidence,
    largeCaseEvidence: bridgeLargeEvidence,
    parityCaseEvidence: null,
    webCaseEvidence: null,
    lotCaseEvidence: null,
    semanticCases: bridgeSemanticCases,
    transportOnlyCases: Object.freeze([bridgeLargeEvidence]),
    webReceiptClassifications: bridgeStrictClassifications,
    webReceiptClaimsMatchViews: true,
    qualifiedGovernedWebCases: Object.freeze([]),
    strictNoSearchCases: Object.freeze([bridgeStandardEvidence]),
    usedWithoutGovernedAppliedSupportCases: Object.freeze([bridgeTcgEvidence]),
    governedWebCaseEvidence: null
  });
  const historicalUnconditionalActivationSeal = Boolean(
    bridgeSealInput.webCaseEvidence?.activation_projection?.set_predicate
      === SET_MEMBERSHIP_PREDICATE
    && bridgeSealInput.lotCaseEvidence?.lot_shared_only?.marker_exact === true
  );
  requireInvariant(historicalUnconditionalActivationSeal === false
    && compatibilityBridgeSeal(bridgeSealInput), verifierErrorCodes.GENERIC);
  for (const mutation of [{
    evidenceCases: [...bridgeSealInput.evidenceCases, { case_id: "NON_TCG_WEB_IDENTITY" }]
  }, {
    evidenceCases: bridgeSealInput.evidenceCases.filter((entry) => entry.case_id !== "TCG")
  }, {
    parityCaseEvidence: { case_id: "EXTERNAL_IDENTITY" }
  }, {
    webCaseEvidence: { case_id: "NON_TCG_WEB_IDENTITY" }
  }, {
    lotCaseEvidence: { case_id: "LOT_SHARED_ONLY" }
  }, {
    semanticCases: [bridgeStandardEvidence]
  }, {
    strictNoSearchCases: [bridgeStandardEvidence],
    usedWithoutGovernedAppliedSupportCases: []
  }, {
    qualifiedGovernedWebCases: [bridgeStandardEvidence]
  }, {
    usedWithoutGovernedAppliedSupportCases: [bridgeTcgEvidence, bridgeTcgEvidence]
  }, {
    writerProjectionMode: "legacy-or-canonical"
  }]) {
    requireInvariant(!compatibilityBridgeSeal({ ...bridgeSealInput, ...mutation }),
      verifierErrorCodes.GENERIC);
  }
  const capturedStandardEvidence = Object.freeze({
    case_id: "NON_TCG",
    versions: capturedStandardVersions,
    canonical_naming_active: false,
    compatibility_bridge_standard_active: false,
    captured_e1ae_standard_active: true,
    verified_original_observation_active: true,
    standard_p0_identity: exactStandardP0Evidence
  });
  const capturedTcgEvidence = Object.freeze({
    case_id: "TCG",
    versions: capturedTcgVersions,
    canonical_naming_active: false,
    compatibility_bridge_standard_active: true,
    captured_e1ae_standard_active: false,
    verified_original_observation_active: false
  });
  const capturedLargeEvidence = Object.freeze({
    case_id: "LARGE_STAGED_TRANSPORT",
    expected_grammar: "NON_TCG",
    transport_only: true,
    versions: capturedLargeVersions,
    canonical_naming_active: false,
    captured_e1ae_standard_active: true,
    overlap_observed: true,
    relay_durable_before_recognition_response: true
  });
  const capturedSemanticCases = Object.freeze([
    capturedStandardEvidence, capturedTcgEvidence
  ]);
  const capturedSealInput = Object.freeze({
    writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE,
    evidenceCases: Object.freeze([
      capturedStandardEvidence, capturedTcgEvidence, capturedLargeEvidence
    ]),
    standardCaseEvidence: capturedStandardEvidence,
    tcgCaseEvidence: capturedTcgEvidence,
    largeCaseEvidence: capturedLargeEvidence,
    parityCaseEvidence: null,
    webCaseEvidence: null,
    lotCaseEvidence: null,
    semanticCases: capturedSemanticCases,
    transportOnlyCases: Object.freeze([capturedLargeEvidence]),
    webReceiptClassifications: Object.freeze([]),
    webReceiptClaimsMatchViews: true,
    qualifiedGovernedWebCases: Object.freeze([]),
    strictNoSearchCases: Object.freeze([]),
    usedWithoutGovernedAppliedSupportCases: Object.freeze([]),
    governedWebCaseEvidence: null
  });
  requireInvariant(compatibilityBridgeSeal(capturedSealInput), verifierErrorCodes.GENERIC);
  for (const mutation of [{
    writerProjectionMode: COMPATIBILITY_BRIDGE_V3_WRITER_PROJECTION_MODE
  }, {
    evidenceCases: capturedSealInput.evidenceCases.map((entry) => entry.case_id === "NON_TCG"
      ? { ...entry, versions: { ...entry.versions, csm_contract: "csm-stage-shadow-v3" } }
      : entry)
  }, {
    webReceiptClassifications: [{ entry: capturedStandardEvidence, proof: {} }]
  }, {
    strictNoSearchCases: [capturedStandardEvidence]
  }, {
    governedWebCaseEvidence: capturedStandardEvidence
  }, {
    largeCaseEvidence: { ...capturedLargeEvidence, expected_grammar: "TCG" }
  }, {
    evidenceCases: capturedSealInput.evidenceCases.map((entry) => entry.case_id === "TCG"
      ? { ...entry, captured_e1ae_standard_active: true }
      : entry)
  }]) {
    requireInvariant(!compatibilityBridgeSeal({ ...capturedSealInput, ...mutation }),
      verifierErrorCodes.GENERIC);
  }
  const receiptFreeView = { brackets: [{ bracket: "subject" }] };
  requireInvariant(capturedProductionProjectionReceiptsOmitted(receiptFreeView),
    verifierErrorCodes.GENERIC);
  for (const key of [
    "founder_beta_web_receipt", "set_card_name_relation_receipt",
    "publication_coverage", "lot_terminal"
  ]) {
    requireInvariant(!capturedProductionProjectionReceiptsOmitted({
      ...receiptFreeView,
      [key]: null
    }), verifierErrorCodes.GENERIC);
  }
  requireInvariant(!capturedProductionProjectionReceiptsOmitted({
    brackets: [{ bracket: "subject", publication_coverage: null }]
  }), verifierErrorCodes.GENERIC);
  for (const [driftedRecognition, driftedView] of [
    [recognition, {
      ...view,
      composer: {
        composer_version: EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version,
        marketplace_profile_version:
          EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version
      }
    }],
    [{
      ...structuredClone(recognition),
      csm_rows: {
        ...structuredClone(recognition.csm_rows),
        output: {
          ...structuredClone(recognition.csm_rows.output),
          marketplace_profile_version:
            EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version
        }
      }
    }, view],
    [{
      ...structuredClone(canonicalRecognition),
      csm_rows: {
        ...structuredClone(canonicalRecognition.csm_rows),
        output: {
          contract_version: canonicalRecognition.csm_rows.output.contract_version,
          composer_version: canonicalRecognition.csm_rows.output.composer_version
        }
      }
    }, {
      ...view,
      composer: {
        composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
        marketplace_profile_version:
          CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
      }
    }],
    [{
      ...structuredClone(bridgeRecognition),
      csm_rows: {
        ...structuredClone(bridgeRecognition.csm_rows),
        output: {
          ...structuredClone(bridgeRecognition.csm_rows.output),
          marketplace_profile_version: EBAY_PROFILE_VERSION
        }
      }
    }, {
      ...view,
      composer: { composer_version: THIN_COMPOSER_VERSION_V2 }
    }]
  ]) {
    let publicVersionShapeRejected = false;
    try {
      recognitionVersionReceipt(driftedRecognition, driftedView);
    } catch (error) {
      publicVersionShapeRejected = sanitizedFailureCode(error)
        === verifierErrorCodes.VERSION_COMPOSER_MISMATCH;
    }
    requireInvariant(publicVersionShapeRejected, verifierErrorCodes.GENERIC);
  }
  let versionDriftCode = "";
  try {
    recognitionVersionReceipt(recognition, {
      ...view,
      composer: { composer_version: "drifted-composer" }
    });
  } catch (error) {
    versionDriftCode = sanitizedFailureCode(error);
  }
  requireInvariant(versionDriftCode === verifierErrorCodes.VERSION_COMPOSER_MISMATCH,
    verifierErrorCodes.GENERIC);

  const serialDriftView = {
    ...exactStandardP0View,
    composer: {
      title: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title.replace("50/50", "30/50"),
      stored_title: PRODUCTION_STANDARD_P0_VERIFIER_CONTRACT.expected_title.replace("50/50", "30/50")
    },
    brackets: exactStandardP0View.brackets.map((entry) => (
      entry.bracket === "numerical_rarity"
        ? { ...entry, value: "30/50", selected_candidate: "30/50", rendered_text: "30/50" }
        : entry
    ))
  };
  const serialDriftEvidence = standardP0LiveEvidence({
    recognitionTitle: serialDriftView.composer.title,
    uiTitle: serialDriftView.composer.title,
    resolutionView: serialDriftView
  });
  let serialDriftCode = "";
  try {
    requireInvariant(productionStandardP0EvidenceProofValid(serialDriftEvidence),
      verifierErrorCodes.STANDARD_P0_IDENTITY_MISMATCH);
  } catch (error) {
    serialDriftCode = sanitizedFailureCode(error);
  }
  requireInvariant(serialDriftCode === verifierErrorCodes.STANDARD_P0_IDENTITY_MISMATCH
    && serialDriftEvidence.card_number_selected_exact === true
    && serialDriftEvidence.serial_selected_exact === false,
  verifierErrorCodes.GENERIC);

  const expectedTitleHash = titleSha256("PRIVATE FEEDBACK TITLE");
  const validFeedback = {
    recognition_session_id: "session-test",
    feedback_submission_id: "feedback-test",
    action: "ACCEPT",
    writer_final_title: "PRIVATE FEEDBACK TITLE"
  };
  const feedback = feedbackReceipt({
    requestPayload: validFeedback,
    responsePayload: validFeedback,
    requestMatchesResponse: true,
    recognitionSessionId: "session-test",
    expectedTitleSha256: expectedTitleHash
  });
  requireInvariant(feedback.exchange_bound && feedback.session_matches
    && feedback.request_title_matches && feedback.response_title_matches,
    verifierErrorCodes.GENERIC);
  for (const counterexample of [
    { requestMatchesResponse: false, code: verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH },
    {
      requestPayload: { ...validFeedback, action: "EDIT" },
      code: verifierErrorCodes.FEEDBACK_ACTION_MISMATCH
    },
    {
      responsePayload: { ...validFeedback, writer_final_title: "PRIVATE DRIFTED TITLE" },
      code: verifierErrorCodes.FEEDBACK_RESPONSE_TITLE_MISMATCH
    }
  ]) {
    let feedbackFailureCode = "";
    try {
      feedbackReceipt({
        requestPayload: counterexample.requestPayload || validFeedback,
        responsePayload: counterexample.responsePayload || validFeedback,
        requestMatchesResponse: counterexample.requestMatchesResponse ?? true,
        recognitionSessionId: "session-test",
        expectedTitleSha256: expectedTitleHash
      });
    } catch (error) {
      feedbackFailureCode = sanitizedFailureCode(error);
    }
    requireInvariant(feedbackFailureCode === counterexample.code, verifierErrorCodes.GENERIC);
  }

  const expectedTitle = "PRIVATE EXPECTED TITLE";
  const receivedTitle = "PRIVATE RECEIVED TITLE";
  const unsafeMatcherError = new Error(`Expected ${expectedTitle}; received ${receivedTitle}`);
  const failureArtifact = JSON.stringify({ error_code: sanitizedFailureCode(unsafeMatcherError) });
  requireInvariant(!failureArtifact.includes(expectedTitle)
    && !failureArtifact.includes(receivedTitle)
    && failureArtifact === `{"error_code":"${verifierErrorCodes.GENERIC}"}`,
    verifierErrorCodes.GENERIC);
  const titleArtifact = JSON.stringify(titleEvidenceReceipt({
    titleBeforePanel: expectedTitle,
    titleAfterPanel: expectedTitle,
    expectedTitleSha256: titleSha256(expectedTitle),
    feedback
  }));
  requireInvariant(!titleArtifact.includes(expectedTitle)
    && !titleArtifact.includes("title_sha256")
    && !titleArtifact.includes("writer_final_title")
    && !titleArtifact.includes("stored_title"),
    verifierErrorCodes.GENERIC);
  const parityArtifact = JSON.stringify({
    codex_parity_exact_match: true,
    external_identity_support: externalIdentityParityProof({
      external_identity_support: publicExternalSupport
    }),
    ...titleEvidenceReceipt({
      titleBeforePanel: CODEX_PARITY_EXPECTED_TITLE,
      titleAfterPanel: CODEX_PARITY_EXPECTED_TITLE,
      expectedTitleSha256: titleSha256(CODEX_PARITY_EXPECTED_TITLE),
      feedback
    })
  });
  requireInvariant(!parityArtifact.includes(CODEX_PARITY_EXPECTED_TITLE)
    && !parityArtifact.includes("title_sha256")
    && !parityArtifact.includes("writer_final_title")
    && !parityArtifact.includes("stored_title"),
  verifierErrorCodes.GENERIC);

  const derivedBuffers = [Buffer.from("front-derived"), Buffer.from("back-derived")];
  const fixture = {
    originalTotal: 6_100_000,
    derivedTotal: derivedBuffers.reduce((total, bytes) => total + bytes.length, 0),
    originals: originalRoles.map((role, index) => ({
      role,
      source_role: index === 0 ? "front_original" : "back_original",
      content_type: "image/jpeg",
      bytes: 3_050_000,
      width: 3000,
      height: 4200,
      content_sha256: String(index + 1).repeat(64)
    })),
    derived: derivedBuffers.map((bytes, index) => ({
      role: stagedRecognitionRole,
      source_role: originalRoles[index],
      content_type: "image/jpeg",
      bytes: bytes.length,
      width: 1143,
      height: 1600,
      content_sha256: sha256(bytes)
    }))
  };
  const ingestMetadata = {
    clientTiming: {
      client_upload_bytes: fixture.originalTotal,
      client_recognition_body_bytes: fixture.derivedTotal,
      client_staged_transform_ms: 12,
      client_original_upload_elapsed_at_dispatch_ms: 8
    },
    clientAssetRef: "client-asset",
    idempotencyKey: "idempotency-key",
    captureProfileId: "capture-profile-test",
    intentId: "intent-id",
    recognitionInputOnly: true,
    laneVersion: LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.staged_lane_version,
    expectedOriginalCount: 2,
    resumeOnly: false,
    stagedResumeReceipt: `stgr_${"f".repeat(64)}`,
    originalImages: fixture.originals.map((entry, index) => ({
      imageId: `original-${index + 1}`,
      storageFirst: true,
      role: entry.role,
      contentType: entry.content_type,
      size: entry.bytes,
      width: entry.width,
      height: entry.height,
      contentSha256: entry.content_sha256
    })),
    images: fixture.derived.map((entry, index) => ({
      imageId: `derived-${index + 1}`,
      sourceImageId: `original-${index + 1}`,
      role: entry.role,
      fileName: `${index + 1}-derived.jpg`,
      contentType: entry.content_type,
      size: entry.bytes,
      width: entry.width,
      height: entry.height,
      contentSha256: entry.content_sha256,
      signatureHex: "ffd8ffe0"
    }))
  };
  const ingestBody = Buffer.concat(derivedBuffers);
  const makeIngestRequest = ({
    pathname = stagedRecognitionPath,
    metadata = ingestMetadata
  } = {}) => ({
    url: () => `${productionOrigin}${pathname}`,
    method: () => "POST",
    headers: () => ({
      "x-lynca-ingest-metadata": Buffer.from(JSON.stringify(metadata)).toString("base64url")
    }),
    postDataBuffer: () => ingestBody
  });
  const offlineRelayTimelineSnapshot = Object.freeze({
    upload_pipeline_request_sequence: 1,
    upload_pipeline_identity: Object.freeze({
      capture_profile_id: ingestMetadata.captureProfileId,
      client_asset_ref: ingestMetadata.clientAssetRef,
      expected_original_count: ingestMetadata.expectedOriginalCount,
      idempotency_key: ingestMetadata.idempotencyKey
    }),
    started_count: 0,
    completed_count: 0,
    incomplete_count: 0,
    recognition_request_sequence: 3
  });
  const accepted = validateLargeIngestRequest(makeIngestRequest(), fixture, [], {
    relayTimelineSnapshot: offlineRelayTimelineSnapshot
  });
  requireInvariant(accepted.overlap_observed === true
    && accepted.body_bytes === fixture.derivedTotal,
  verifierErrorCodes.GENERIC);
  for (const invalidTimeline of [
    { ...offlineRelayTimelineSnapshot, upload_pipeline_request_sequence: 0 },
    { ...offlineRelayTimelineSnapshot, upload_pipeline_request_sequence: 3 },
    {
      ...offlineRelayTimelineSnapshot,
      upload_pipeline_identity: {
        ...offlineRelayTimelineSnapshot.upload_pipeline_identity,
        client_asset_ref: "different-asset"
      }
    },
    { ...offlineRelayTimelineSnapshot, started_count: 0, incomplete_count: 1 }
  ]) {
    let falseOverlapRejected = false;
    try {
      validateLargeIngestRequest(makeIngestRequest(), fixture, [], {
        relayTimelineSnapshot: invalidTimeline
      });
    } catch {
      falseOverlapRejected = true;
    }
    requireInvariant(falseOverlapRejected, verifierErrorCodes.GENERIC);
  }
  let unauthorizedSecondBlocked = false;
  try {
    validateLargeIngestRequest(makeIngestRequest({
      metadata: { ...ingestMetadata, resumeOnly: true }
    }), fixture, [accepted]);
  } catch {
    unauthorizedSecondBlocked = true;
  }
  requireInvariant(unauthorizedSecondBlocked, verifierErrorCodes.GENERIC);

  const resumeAuthorization = validateLargeRecoveryAuthorization({
    ok: false,
    payload: {
      ok: false,
      recovery_action: "STAGED_RESUME_ONLY",
      staged_resume_receipt: ingestMetadata.stagedResumeReceipt
    }
  }, accepted);
  const authorizedResume = validateLargeIngestRequest(makeIngestRequest({
    metadata: { ...ingestMetadata, resumeOnly: true }
  }), fixture, [accepted], { recoveryAuthorization: resumeAuthorization });
  requireInvariant(authorizedResume.resume_only === true, verifierErrorCodes.GENERIC);
  let authorizedManifestDriftRejected = false;
  try {
    validateLargeIngestRequest(makeIngestRequest({
      metadata: {
        ...ingestMetadata,
        resumeOnly: true,
        images: [
          { ...ingestMetadata.images[0], imageId: "derived-drift" },
          ingestMetadata.images[1]
        ]
      }
    }), fixture, [accepted], { recoveryAuthorization: resumeAuthorization });
  } catch {
    authorizedManifestDriftRejected = true;
  }
  requireInvariant(authorizedManifestDriftRejected, verifierErrorCodes.GENERIC);
  for (const invalidAuthorization of [
    validateLargeRecoveryAuthorization({ ok: true, payload: { ok: true } }, accepted),
    { ...resumeAuthorization, resume_only: false }
  ]) {
    let rejected = false;
    try {
      validateLargeIngestRequest(makeIngestRequest({
        metadata: { ...ingestMetadata, resumeOnly: true }
      }), fixture, [accepted], { recoveryAuthorization: invalidAuthorization });
    } catch {
      rejected = true;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }
  let completedPhaseRejected = false;
  try {
    validateLargeIngestRequest(makeIngestRequest(), fixture, [], { phaseComplete: true });
  } catch {
    completedPhaseRejected = true;
  }
  requireInvariant(completedPhaseRejected, verifierErrorCodes.GENERIC);

  const relayReceipts = originalRoles.map((role, index) => ({
    role,
    asset_id: "asset-test",
    image_id: `original-${index + 1}`,
    browser_body_bytes: fixture.originals[index].bytes,
    started_sequence: index + 4,
    durable_response_sequence: index + 6
  }));
  const offlineRecognitionResponseSequence = 8;
  const offlineProviderResponseId = "resp_offline_writer_journey";
  const offlineExecutionContract = structuredClone(
    expectedExecutionContractByTransportLaneAndImageCount[
      CSM_STAGED_TRANSPORT_PROFILE.lane_version
    ]["2"]
  );
  const offlineExecutionReceipt = {
    execution_origin: "FRESH_CURRENT",
    provider: CSM_ACTIVE_MODEL_PROFILE.provider,
    model: CSM_ACTIVE_MODEL_PROFILE.model,
    requested_model: CSM_ACTIVE_MODEL_PROFILE.model,
    requested_effort: CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
    image_detail: CSM_ACTIVE_MODEL_PROFILE.image_detail,
    model_profile_id: CSM_ACTIVE_MODEL_PROFILE.id,
    optimization_pack_id: CSM_ACTIVE_MODEL_PROFILE.optimization_pack_id,
    optimization_pack_sha256: CSM_ACTIVE_MODEL_PROFILE.optimization_pack_sha256,
    provider_adapter_version: expectedProviderAdapterVersion,
    request_builder_version: expectedProviderAdapterContract.request_builder_version,
    response_parser_version: expectedProviderAdapterContract.response_parser_version,
    execution_contract_sha256: expectedExecutionContractSha256ByTransportLaneAndImageCount[
      CSM_STAGED_TRANSPORT_PROFILE.lane_version
    ]["2"],
    execution_contract: offlineExecutionContract,
    max_output_tokens: expectedMaxOutputTokens,
    provider_response_status: "completed",
    provider_response_status_attested: true,
    provider_response_incomplete: false,
    provider_response_id: offlineProviderResponseId,
    served_model: null,
    served_model_attested: false,
    served_effort: null,
    served_effort_attested: false,
    served_effort_conflict: false,
    input_tokens: 4_100,
    cached_input_tokens: 1_024,
    output_tokens: 320,
    reasoning_tokens: 24,
    total_tokens: 4_420,
    provider_attempt_number: 1,
    provider_retry_count: 0
  };
  const recognitionPayload = {
    ...offlineExecutionReceipt,
    recognition_session_id: `csmsess_${"a".repeat(40)}`,
    provider_authority_receipt: {
      schema_version: "csm-provider-authority-receipt-v1",
      operation_key_sha256: "a".repeat(64),
      attempt: 1,
      attempt_class: "fresh",
      estimated_tokens: expectedEstimatedTokensPerAttempt,
      claim_code: "admitted",
      settle_code: "settled",
      operation_status: "SUCCEEDED"
    },
    ok: true,
    route: "CSM_THIN_DIRECT_INGEST",
    recognition_input: "readability_derived_inline",
    originals_verified: true,
    trace_status: "PERSISTED",
    csm_owner_versions: sealCsmOwnerExecutionReceipt({
      provider: offlineExecutionReceipt.provider,
      model: offlineExecutionReceipt.model,
      requested_model: offlineExecutionReceipt.requested_model,
      served_model: offlineExecutionReceipt.served_model,
      served_model_attested: offlineExecutionReceipt.served_model_attested,
      effort: offlineExecutionReceipt.requested_effort,
      reasoning_effort: null,
      reasoning_effort_attested: false,
      provider_response_status: offlineExecutionReceipt.provider_response_status,
      provider_response_status_attested: offlineExecutionReceipt.provider_response_status_attested,
      provider_response_incomplete: offlineExecutionReceipt.provider_response_incomplete,
      served_effort_conflict: offlineExecutionReceipt.served_effort_conflict,
      provider_http_status: 200,
      image_detail: offlineExecutionReceipt.image_detail,
      model_profile_id: offlineExecutionReceipt.model_profile_id,
      optimization_pack_id: offlineExecutionReceipt.optimization_pack_id,
      optimization_pack_sha256: offlineExecutionReceipt.optimization_pack_sha256,
      account_scope: offlineExecutionContract.account_scope,
      provider_adapter_version: offlineExecutionReceipt.provider_adapter_version,
      request_builder_version: offlineExecutionReceipt.request_builder_version,
      response_parser_version: offlineExecutionReceipt.response_parser_version,
      execution_contract_sha256: offlineExecutionReceipt.execution_contract_sha256,
      execution_contract: structuredClone(offlineExecutionContract),
      prompt_version: null,
      max_output_tokens: offlineExecutionReceipt.max_output_tokens,
      provider_response_id: offlineExecutionReceipt.provider_response_id,
      provider_request_id: "request-offline",
      provider_client_request_id: "client-request-offline",
      provider_attempt_number: offlineExecutionReceipt.provider_attempt_number,
      provider_retry_count: offlineExecutionReceipt.provider_retry_count,
      provider_transport_retry_receipt: null,
      latency_ms: 4,
      latency_stages_ms: { provider_ms: 4 },
      input_tokens: offlineExecutionReceipt.input_tokens,
      cached_input_tokens: offlineExecutionReceipt.cached_input_tokens,
      output_tokens: offlineExecutionReceipt.output_tokens,
      reasoning_tokens: offlineExecutionReceipt.reasoning_tokens,
      total_tokens: offlineExecutionReceipt.total_tokens,
      total_tokens_source: "provider",
      resolver: "resolver-offline",
      composer: THIN_COMPOSER_VERSION_V2,
      marketplace_profile: EBAY_PROFILE_VERSION,
      accuracy_loss_ledger_version: null,
      accuracy_loss_ledger_sha256: null
    }),
    asset_id: "asset-test",
    client_asset_ref: ingestMetadata.clientAssetRef,
    staged_resume_receipt: ingestMetadata.stagedResumeReceipt,
    csm_rows: {
      resolution: {
        recognition_session_id: `csmsess_${"a".repeat(40)}`,
        contract_version: "csm-stage-offline-v1",
        resolver_version: "resolver-offline"
      },
      output: {
        contract_version: "csm-stage-offline-v1",
        composer_version: THIN_COMPOSER_VERSION_V2
      }
    },
    csm_persistence: { ok: true, atomic: true, session: { saved: true } },
    ingest_timing: { body_bytes: fixture.derivedTotal },
    latency_stages_ms: {
      ingest_body_bytes: fixture.derivedTotal,
      client_recognition_body_bytes: fixture.derivedTotal,
      client_upload_bytes: fixture.originalTotal,
      staged_original_sync_ms: 10,
      authority_enqueue_ms: 1,
      authority_claim_ms: 2,
      authority_settle_ms: 1,
      authority_dispatch_ms: 8,
      provider_ms: 4,
      csm_persistence_ms: 5,
      request_total_ms: 20,
      client_staged_transform_ms: 3
    }
  };
  const offlineExecutionProof = liveExecutionReceiptProof(recognitionPayload, {
    imageCount: 2,
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE
  });
  const capturedExecutionPayload = (attempt = 1) => {
    const payload = structuredClone(recognitionPayload);
    const {
      owner_execution_receipt_version: _receiptVersion,
      owner_execution_receipt_sha256: _receiptSha256,
      ...owner
    } = payload.csm_owner_versions;
    delete owner.provider_transport_retry_receipt;
    owner.provider_attempt_number = attempt;
    owner.provider_retry_count = attempt - 1;
    payload.csm_owner_versions = sealCsmOwnerExecutionReceipt(owner);
    payload.provider_attempt_number = attempt;
    payload.provider_retry_count = attempt - 1;
    payload.provider_authority_receipt.attempt = attempt;
    payload.provider_authority_receipt.attempt_class = attempt === 1 ? "fresh" : "retry";
    return payload;
  };
  for (const attempt of [1, 2, 3]) {
    const capturedProof = liveExecutionReceiptProof(
      capturedExecutionPayload(attempt),
      {
        imageCount: 2,
        transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
        writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE
      }
    );
    requireInvariant(capturedProof.provider_attempt_number === attempt
      && capturedProof.provider_transport_retry_receipt === null,
    verifierErrorCodes.GENERIC);
  }
  for (const mutate of [
    (payload) => {
      payload.provider_attempt_number = 4;
      payload.provider_retry_count = 3;
      payload.provider_authority_receipt.attempt = 4;
      payload.provider_authority_receipt.attempt_class = "retry";
    },
    (payload) => { payload.provider_retry_count = 1; },
    (payload) => { payload.provider_transport_retry_receipt = null; },
    (payload) => {
      const {
        owner_execution_receipt_version: _receiptVersion,
        owner_execution_receipt_sha256: _receiptSha256,
        ...owner
      } = payload.csm_owner_versions;
      payload.csm_owner_versions = sealCsmOwnerExecutionReceipt({
        ...owner,
        provider_transport_retry_receipt: null
      });
    }
  ]) {
    const drifted = capturedExecutionPayload(3);
    mutate(drifted);
    let rejected = false;
    try {
      liveExecutionReceiptProof(drifted, {
        imageCount: 2,
        transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
        writerProjectionMode: COMPATIBILITY_BRIDGE_V4_WRITER_PROJECTION_MODE
      });
    } catch {
      rejected = true;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }
  const canonicalPublicPayload = structuredClone(recognitionPayload);
  canonicalPublicPayload.csm_owner_versions.composer =
    CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version;
  canonicalPublicPayload.csm_owner_versions.marketplace_profile =
    CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version;
  canonicalPublicPayload.csm_rows.output = {
    contract_version: "csm-stage-offline-v1",
    composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
    marketplace_profile_version:
      CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
  };
  publicRecognitionPayloadBoundary(
    canonicalPublicPayload,
    canonicalPublicPayload.csm_owner_versions,
    verifierErrorCodes.GENERIC
  );
  const externalPublicPayload = structuredClone(recognitionPayload);
  externalPublicPayload.csm_owner_versions.composer =
    EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version;
  externalPublicPayload.csm_owner_versions.marketplace_profile =
    EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.marketplace_profile_version;
  externalPublicPayload.csm_rows.output.composer_version =
    EXTERNAL_IDENTITY_RELEASE_CONTRACT.resolution_contract.composer_version;
  publicRecognitionPayloadBoundary(
    externalPublicPayload,
    externalPublicPayload.csm_owner_versions,
    verifierErrorCodes.GENERIC
  );
  for (const driftedPublicPayload of [
    {
      ...structuredClone(recognitionPayload),
      csm_rows: {
        ...structuredClone(recognitionPayload.csm_rows),
        output: {
          ...structuredClone(recognitionPayload.csm_rows.output),
          marketplace_profile_version: EBAY_PROFILE_VERSION
        }
      }
    },
    {
      ...structuredClone(canonicalPublicPayload),
      csm_rows: {
        ...structuredClone(canonicalPublicPayload.csm_rows),
        output: {
          contract_version: "csm-stage-offline-v1",
          composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version
        }
      }
    },
    {
      ...structuredClone(recognitionPayload),
      csm_owner_versions: {
        ...structuredClone(recognitionPayload.csm_owner_versions),
        composer: "unknown-composer"
      }
    },
    {
      ...structuredClone(recognitionPayload),
      csm_rows: {
        ...structuredClone(recognitionPayload.csm_rows),
        output: {
          contract_version: "csm-stage-offline-v1",
          composer_version: "row-composer-drift"
        }
      }
    },
    {
      ...structuredClone(recognitionPayload),
      csm_owner_versions: {
        ...structuredClone(recognitionPayload.csm_owner_versions),
        marketplace_profile: ""
      }
    }
  ]) {
    let publicProjectionRejected = false;
    try {
      publicRecognitionPayloadBoundary(
        driftedPublicPayload,
        driftedPublicPayload.csm_owner_versions,
        verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH
      );
    } catch (error) {
      publicProjectionRejected = sanitizedFailureCode(error)
        === verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH;
    }
    requireInvariant(publicProjectionRejected, verifierErrorCodes.GENERIC);
  }
  const offlineOwnerReadback = durableOwnerExecutionReadbackProof(offlineExecutionProof, {
    owner_execution_receipt: {
      version: offlineExecutionProof.owner_execution_receipt_version,
      sha256: offlineExecutionProof.owner_execution_receipt_sha256
    }
  });
  requireInvariant(offlineOwnerReadback.durable_read_after_write === true,
    verifierErrorCodes.GENERIC);
  for (const driftedReadback of [
    null,
    { ...offlineOwnerReadback, sha256: "f".repeat(64) },
    { ...offlineOwnerReadback, version: "owner-receipt-drift" }
  ]) {
    let ownerReadbackDriftRejected = false;
    try {
      durableOwnerExecutionReadbackProof(offlineExecutionProof, {
        owner_execution_receipt: driftedReadback && {
          version: driftedReadback.version,
          sha256: driftedReadback.sha256
        }
      });
    } catch {
      ownerReadbackDriftRejected = true;
    }
    requireInvariant(ownerReadbackDriftRejected, verifierErrorCodes.GENERIC);
  }
  const attestedExecutionPayload = structuredClone(recognitionPayload);
  attestedExecutionPayload.served_model = CSM_ACTIVE_MODEL_PROFILE.model;
  attestedExecutionPayload.served_model_attested = true;
  attestedExecutionPayload.csm_owner_versions.served_model = CSM_ACTIVE_MODEL_PROFILE.model;
  attestedExecutionPayload.csm_owner_versions.served_model_attested = true;
  attestedExecutionPayload.served_effort = CSM_ACTIVE_MODEL_PROFILE.reasoning_effort;
  attestedExecutionPayload.served_effort_attested = true;
  attestedExecutionPayload.csm_owner_versions.reasoning_effort =
    CSM_ACTIVE_MODEL_PROFILE.reasoning_effort;
  attestedExecutionPayload.csm_owner_versions.reasoning_effort_attested = true;
  attestedExecutionPayload.csm_owner_versions = sealCsmOwnerExecutionReceipt(
    attestedExecutionPayload.csm_owner_versions
  );
  const attestedExecutionProof = liveExecutionReceiptProof(attestedExecutionPayload, {
    imageCount: 2,
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE
  });
  requireInvariant(attestedExecutionProof.served_model_attested === true
    && attestedExecutionProof.served_model_unknown === false
    && attestedExecutionProof.served_effort_attested === true
    && attestedExecutionProof.served_effort_unknown === false,
  verifierErrorCodes.GENERIC);
  const offlineExecutionArtifact = JSON.stringify(offlineExecutionProof);
  const executionEvidenceStringKeys = new Set([
    "execution_origin",
    "model_profile_id", "optimization_pack_id", "optimization_pack_sha256",
    "provider_adapter_version", "request_builder_version", "response_parser_version",
    "transport_profile_id", "transport_profile_sha256",
    "execution_contract_sha256", "provider_response_id_sha256",
    "owner_execution_receipt_version", "owner_execution_receipt_sha256"
  ]);
  requireInvariant(hasExactKeys(offlineExecutionProof, liveExecutionEvidenceKeys)
    && Object.entries(offlineExecutionProof).every(([key, value]) => (
      executionEvidenceStringKeys.has(key)
        ? typeof value === "string" && Boolean(value)
        : key === "server_stages_ms"
          ? hasExactKeys(value, requiredServerStageNames)
            && Object.values(value).every((stage) => Number.isFinite(stage) && stage >= 0)
        : key === "provider_authority_receipt"
          ? value.estimated_tokens === expectedEstimatedTokensPerAttempt
            && value.attempt === 1
            && value.attempt_class === "fresh"
            && value.operation_status === "SUCCEEDED"
        : key === "provider_transport_retry_receipt"
          ? value === null
        : typeof value === "boolean" || Number.isSafeInteger(value)
    ))
    && !offlineExecutionArtifact.includes(offlineProviderResponseId)
    && !offlineExecutionArtifact.includes('"provider_response_id":')
    && !offlineExecutionArtifact.includes('"execution_contract":')
    && !offlineExecutionArtifact.includes("PRIVATE")
    && !offlineExecutionArtifact.includes("/not-read/"),
  verifierErrorCodes.GENERIC);
  const offlineRetryReceiptBody = {
    schema_version: "luna-definitive-502-transport-retry-receipt-v1",
    operation_key_sha256: recognitionPayload.provider_authority_receipt.operation_key_sha256,
    payload_sha256: "b".repeat(64),
    provider: CSM_ACTIVE_MODEL_PROFILE.provider,
    model: CSM_ACTIVE_MODEL_PROFILE.model,
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
    provider_request_id: "req-offline-first-502",
    provider_client_request_id: "lynca-offline-first-502",
    retry_provider_client_request_id: "lynca-offline-retry-502",
    provider_error_code: "server_error",
    provider_error_type: "server_error",
    provider_error_param: null,
    provider_ms: 10,
    settle_code: "settled",
    operation_status: "FAILED",
    retry_attempt: 2,
    retry_attempt_class: "retry"
  };
  const offlineRetryReceipt = {
    ...offlineRetryReceiptBody,
    receipt_sha256: sha256(stableJson(offlineRetryReceiptBody))
  };
  const offlineRetryPayload = structuredClone(recognitionPayload);
  offlineRetryPayload.provider_attempt_number = 2;
  offlineRetryPayload.provider_retry_count = 1;
  offlineRetryPayload.provider_client_request_id =
    offlineRetryReceipt.retry_provider_client_request_id;
  offlineRetryPayload.provider_transport_retry_receipt = offlineRetryReceipt;
  offlineRetryPayload.provider_authority_receipt.attempt = 2;
  offlineRetryPayload.provider_authority_receipt.attempt_class = "retry";
  offlineRetryPayload.csm_owner_versions.provider_attempt_number = 2;
  offlineRetryPayload.csm_owner_versions.provider_retry_count = 1;
  offlineRetryPayload.csm_owner_versions.provider_client_request_id =
    offlineRetryReceipt.retry_provider_client_request_id;
  offlineRetryPayload.csm_owner_versions.provider_transport_retry_receipt =
    structuredClone(offlineRetryReceipt);
  offlineRetryPayload.csm_owner_versions = sealCsmOwnerExecutionReceipt(
    offlineRetryPayload.csm_owner_versions
  );
  const offlineRetryExecutionProof = liveExecutionReceiptProof(offlineRetryPayload, {
    imageCount: 2,
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE
  });
  requireInvariant(offlineRetryExecutionProof.provider_attempt_number === 2
    && offlineRetryExecutionProof.provider_retry_count === 1
    && offlineRetryExecutionProof.provider_transport_retry_receipt?.retry_attempt === 2,
  verifierErrorCodes.GENERIC);
  for (const mutate of [
    (value) => { value.provider_client_request_id = "lynca-retry-id-drift"; },
    (value) => {
      value.csm_owner_versions.provider_transport_retry_receipt.provider_error_code = "drift";
    },
    (value) => {
      value.provider_transport_retry_receipt.retry_provider_client_request_id =
        value.provider_transport_retry_receipt.provider_client_request_id;
    }
  ]) {
    const driftedRetry = structuredClone(offlineRetryPayload);
    mutate(driftedRetry);
    let rejected = false;
    try {
      liveExecutionReceiptProof(driftedRetry, {
        imageCount: 2,
        transportProfile: CSM_STAGED_TRANSPORT_PROFILE
      });
    } catch {
      rejected = true;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }
  const offlineUploadPipelineReceipt = Object.freeze({
    asset_id: recognitionPayload.asset_id,
    client_asset_ref: accepted.identity.client_asset_ref,
    idempotency_key: accepted.identity.idempotency_key,
    expected_original_count: 2
  });
  const validateOfflineLargeResponse = (
    payload,
    receipts = relayReceipts,
    uploadPipelineReceipt = offlineUploadPipelineReceipt
  ) => (
    validateLargeRecognitionResponse(payload, fixture, [accepted], receipts, {
      recognitionResponseSequence: offlineRecognitionResponseSequence,
      uploadPipelineReceipt
    })
  );
  requireInvariant(validateOfflineLargeResponse(recognitionPayload).recognition_body_bytes
    === fixture.derivedTotal, verifierErrorCodes.GENERIC);
  let unboundUploadPipelineRejected = false;
  try {
    validateOfflineLargeResponse(recognitionPayload, relayReceipts, {
      ...offlineUploadPipelineReceipt,
      asset_id: "asset-drift"
    });
  } catch {
    unboundUploadPipelineRejected = true;
  }
  requireInvariant(unboundUploadPipelineRejected, verifierErrorCodes.GENERIC);
  for (const drifted of [
    { ...recognitionPayload, asset_id: "asset-drift" },
    { ...recognitionPayload, served_effort: "low", served_effort_attested: false },
    {
      ...recognitionPayload,
      served_effort: "low",
      served_effort_attested: true
    },
    {
      ...recognitionPayload,
      csm_owner_versions: {
        ...recognitionPayload.csm_owner_versions,
        reasoning_effort: "low",
        reasoning_effort_attested: true
      }
    },
    {
      ...recognitionPayload,
      latency_stages_ms: {
        ...recognitionPayload.latency_stages_ms,
        staged_original_sync_ms: 20
      }
    }
  ]) {
    let rejected = false;
    try { validateOfflineLargeResponse(drifted); } catch {
      rejected = true;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }

  const receiptDriftMutators = [
    (value) => { value.execution_origin = "EXACT_REPLAY"; },
    (value) => { delete value.provider_authority_receipt; },
    (value) => { value.provider_authority_receipt.estimated_tokens = 6_499; },
    (value) => { value.provider_authority_receipt.attempt_class = "retry"; },
    (value) => { value.provider_authority_receipt.operation_status = "FAILED"; },
    (value) => { value.recognition_session_id = `csmsess_${"b".repeat(40)}`; },
    (value) => { value.csm_owner_versions.owner_execution_receipt_sha256 = "0".repeat(64); },
    (value) => { value.model_profile_id = "profile-drift"; },
    (value) => { value.csm_owner_versions.model_profile_id = "profile-drift"; },
    (value) => { value.optimization_pack_id = "pack-drift"; },
    (value) => { value.csm_owner_versions.optimization_pack_sha256 = "0".repeat(64); },
    (value) => { value.provider_adapter_version = "adapter-drift"; },
    (value) => { value.csm_owner_versions.request_builder_version = "builder-drift"; },
    (value) => { value.response_parser_version = "parser-drift"; },
    (value) => { value.csm_owner_versions.execution_contract_sha256 = "0".repeat(64); },
    (value) => { value.execution_contract.model = "model-drift"; },
    (value) => { value.max_output_tokens = 8_191; },
    (value) => { value.csm_owner_versions.max_output_tokens = 8_191; },
    (value) => { value.provider_response_status = "incomplete"; },
    (value) => { value.csm_owner_versions.provider_response_status_attested = false; },
    (value) => { value.csm_owner_versions.provider_response_id = "resp_drift"; },
    (value) => { value.input_tokens = 0; },
    (value) => { value.cached_input_tokens = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.csm_owner_versions.output_tokens += 1; },
    (value) => { value.reasoning_tokens = value.output_tokens + 1; },
    (value) => { value.total_tokens = value.input_tokens + value.output_tokens - 1; },
    (value) => { value.provider_attempt_number = 2; },
    (value) => { value.csm_owner_versions.provider_retry_count = 1; },
    (value) => { value.served_model = CSM_ACTIVE_MODEL_PROFILE.model; },
    (value) => {
      value.served_model = "unrelated-model";
      value.served_model_attested = true;
      value.csm_owner_versions.served_model = "unrelated-model";
      value.csm_owner_versions.served_model_attested = true;
    },
    (value) => { value.served_effort = CSM_ACTIVE_MODEL_PROFILE.reasoning_effort; },
    (value) => { value.csm_owner_versions.served_effort_conflict = true; },
    (value) => { value.latency_stages_ms.authority_enqueue_ms = -1; },
    (value) => { delete value.latency_stages_ms.request_total_ms; },
    (value) => { value.latency_stages_ms.request_total_ms = 3; },
    (value) => { value.latency_stages_ms.authority_dispatch_ms = 3; },
    (value) => { value.latency_stages_ms.authority_claim_ms = 20; }
  ];
  for (const mutate of receiptDriftMutators) {
    const drifted = structuredClone(recognitionPayload);
    mutate(drifted);
    let receiptDriftCode = "";
    try {
      liveExecutionReceiptProof(drifted, {
        imageCount: 2,
        transportProfile: CSM_STAGED_TRANSPORT_PROFILE
      });
    } catch (error) {
      receiptDriftCode = sanitizedFailureCode(error);
    }
    requireInvariant(receiptDriftCode === verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH,
      verifierErrorCodes.GENERIC);
  }

  let swappedRelayRejected = false;
  try {
    validateOfflineLargeResponse(recognitionPayload, [
      { ...relayReceipts[0], image_id: relayReceipts[1].image_id },
      { ...relayReceipts[1], image_id: relayReceipts[0].image_id }
    ]);
  } catch {
    swappedRelayRejected = true;
  }
  requireInvariant(swappedRelayRejected, verifierErrorCodes.GENERIC);
  let lateRelayRejected = false;
  try {
    validateOfflineLargeResponse(recognitionPayload, [
      relayReceipts[0],
      { ...relayReceipts[1], durable_response_sequence: offlineRecognitionResponseSequence + 1 }
    ]);
  } catch {
    lateRelayRejected = true;
  }
  requireInvariant(lateRelayRejected, verifierErrorCodes.GENERIC);

  const violationState = { violation: null };
  const violationSignal = new Promise((resolve) => { violationState.signal_violation = resolve; });
  markLargeTransportViolation(violationState, verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  requireInvariant(await violationSignal === verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED,
    verifierErrorCodes.GENERIC);
  for (const request of [
    makeIngestRequest({ pathname: "/api/csm-listing-title" }),
    makeIngestRequest({
      metadata: {
        ...ingestMetadata,
        clientTiming: { ...ingestMetadata.clientTiming, client_original_upload_ms: 0 }
      }
    }),
    makeIngestRequest({
      metadata: {
        ...ingestMetadata,
        images: [
          { ...ingestMetadata.images[0], contentSha256: "0".repeat(64) },
          ingestMetadata.images[1]
        ]
      }
    }),
    makeIngestRequest({
      metadata: {
        ...ingestMetadata,
        resumeOnly: true,
        images: [
          { ...ingestMetadata.images[0], imageId: "derived-drift" },
          ingestMetadata.images[1]
        ]
      }
    })
  ]) {
    let blocked = false;
    try {
      validateLargeIngestRequest(request, fixture, [], {
        relayTimelineSnapshot: offlineRelayTimelineSnapshot
      });
    } catch { blocked = true; }
    requireInvariant(blocked, verifierErrorCodes.GENERIC);
  }
});

test("offline ordinary route coverage rejects an abort that could reach the provider @offline", () => {
  const sourceCase = {
    case_id: "NON_TCG",
    image_count: 2,
    images: [
      { buffer: Buffer.from("front") },
      { buffer: Buffer.from("back") }
    ]
  };
  const ordinaryMetadataObject = {
    captureProfileId: "capture-profile",
    clientAssetRef: "asset-ref",
    clientTiming: {},
    idempotencyKey: "idempotency-key",
    intentId: "intent-id",
    images: ["front", "back"].map((side, index) => ({
      imageId: side,
      role: index === 0 ? "image_1_original" : "image_2_original",
      fileName: `${side}.webp`,
      contentType: "image/webp",
      size: sourceCase.images[index].buffer.length,
      width: 10,
      height: 20,
      signatureHex: "52494646",
      contentSha256: "a".repeat(64)
    }))
  };
  const encodeOrdinaryMetadata = (metadata) => Buffer.from(
    JSON.stringify(metadata)
  ).toString("base64url");
  const ordinaryMetadata = encodeOrdinaryMetadata(ordinaryMetadataObject);
  const ordinaryRequest = {
    url: () => `${productionOrigin}${stagedRecognitionPath}`,
    method: () => "POST",
    postDataBuffer: () => Buffer.concat(sourceCase.images.map((image) => image.buffer)),
    headers: () => ({ "x-lynca-ingest-metadata": ordinaryMetadata })
  };
  requireInvariant(validateOrdinaryIngestRequest(ordinaryRequest, sourceCase).original_inline === true,
    verifierErrorCodes.GENERIC);
  const stagedMetadata = Buffer.from(JSON.stringify({
    clientAssetRef: "asset-ref",
    recognitionInputOnly: true,
    images: [{ imageId: "front", sourceImageId: "original-front" }, { imageId: "back", sourceImageId: "original-back" }]
  })).toString("base64url");
  let stagedRejected = false;
  try {
    validateOrdinaryIngestRequest({
      ...ordinaryRequest,
      headers: () => ({ "x-lynca-ingest-metadata": stagedMetadata })
    }, sourceCase);
  } catch (error) {
    stagedRejected = sanitizedFailureCode(error) === verifierErrorCodes.ROUTE_COVERAGE_MISMATCH;
  }
  requireInvariant(stagedRejected, verifierErrorCodes.GENERIC);
  for (const leaked of [
    { ...ordinaryMetadataObject, expected_card_number: "251" },
    { ...ordinaryMetadataObject, source_asset_id: "asset_hidden" },
    {
      ...ordinaryMetadataObject,
      clientTiming: { expected_serial: "50/50" }
    },
    {
      ...ordinaryMetadataObject,
      images: [
        { ...ordinaryMetadataObject.images[0], card_number: "251" },
        ordinaryMetadataObject.images[1]
      ]
    }
  ]) {
    let leakedMetadataRejected = false;
    try {
      validateOrdinaryIngestRequest({
        ...ordinaryRequest,
        headers: () => ({
          "x-lynca-ingest-metadata": encodeOrdinaryMetadata(leaked)
        })
      }, sourceCase);
    } catch (error) {
      leakedMetadataRejected = sanitizedFailureCode(error)
        === verifierErrorCodes.ROUTE_COVERAGE_MISMATCH;
    }
    requireInvariant(leakedMetadataRejected, verifierErrorCodes.GENERIC);
  }

  const nonTcgCoverage = normalRouteCoverageReceipt({
    sourceCase,
    payload: { recognition_input: "original_inline" },
    responseUrl: `${productionOrigin}${stagedRecognitionPath}`,
    attempts: [{
      case_id: "NON_TCG",
      recognition_route: stagedRecognitionPath,
      continued: true,
      response_observed: true,
      original_inline: true
    }]
  });
  requireInvariant(nonTcgCoverage.route === "ORDINARY_INGEST_ORIGINAL_INLINE"
    && nonTcgCoverage.initial_ordinary_ingest_aborted === false,
  verifierErrorCodes.GENERIC);
  const parityCoverage = normalRouteCoverageReceipt({
    sourceCase: { ...sourceCase, case_id: "EXTERNAL_IDENTITY" },
    payload: { recognition_input: "original_inline" },
    responseUrl: `${productionOrigin}${stagedRecognitionPath}`,
    attempts: [{
      case_id: "EXTERNAL_IDENTITY",
      recognition_route: stagedRecognitionPath,
      continued: true,
      response_observed: true,
      original_inline: true
    }]
  });
  requireInvariant(parityCoverage.route === "ORDINARY_INGEST_ORIGINAL_INLINE"
    && parityCoverage.initial_ordinary_ingest_aborted === false,
  verifierErrorCodes.GENERIC);

  const tcgSourceCase = { ...sourceCase, case_id: "TCG" };
  const validTcgAttempts = [{
    case_id: "TCG",
    recognition_route: stagedRecognitionPath,
    aborted_before_network: true,
    response_observed: false,
    original_inline: true
  }, {
    case_id: "TCG",
    recognition_route: "/api/csm-listing-title",
    continued: true,
    response_observed: true,
    original_inline: false
  }];
  const tcgCoverage = normalRouteCoverageReceipt({
    sourceCase: tcgSourceCase,
    payload: {},
    responseUrl: `${productionOrigin}/api/csm-listing-title`,
    attempts: validTcgAttempts
  });
  requireInvariant(tcgCoverage.route === "DIRECT_AFTER_ABORTED_ORDINARY_INGEST"
    && tcgCoverage.initial_ordinary_ingest_aborted === true
    && tcgCoverage.aborted_ingest_response_observed === false,
  verifierErrorCodes.GENERIC);
  for (const mutate of [
    (attempts) => { attempts[0].response_observed = true; },
    (attempts) => { attempts[1].recognition_route = stagedRecognitionPath; },
    (attempts) => { attempts.push({ ...attempts[1] }); }
  ]) {
    let rejected = false;
    try {
      const attempts = structuredClone(validTcgAttempts);
      mutate(attempts);
      normalRouteCoverageReceipt({
        sourceCase: tcgSourceCase,
        payload: {},
        responseUrl: `${productionOrigin}/api/csm-listing-title`,
        attempts
      });
    } catch (error) {
      rejected = sanitizedFailureCode(error) === verifierErrorCodes.ROUTE_COVERAGE_MISMATCH;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }
});
