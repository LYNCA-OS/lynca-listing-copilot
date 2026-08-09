import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT } from "../scripts/build-large-internal-writer-fixture.mjs";
import {
  buildCsmModelExecutionContractSha256,
  csmExecutionContractImageUrls,
  CSM_ACTIVE_MODEL_PROFILE
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { resolveCsmProviderAdapter } from "../lib/listing/thin/csm-provider-adapter.mjs";
import { CSM_STAGED_TRANSPORT_PROFILE } from "../lib/listing/thin/staged-recognition-input.mjs";

const expectedExecutionContractSha256ByImageCount = Object.freeze(Object.fromEntries(
  [1, 2].map((count) => [String(count), buildCsmModelExecutionContractSha256({
    imageUrls: csmExecutionContractImageUrls(count)
  })])
));
const expectedProviderAdapterVersion = resolveCsmProviderAdapter(
  CSM_ACTIVE_MODEL_PROFILE.provider
).contract.id;

const artifactDir = path.resolve("artifacts/production-writer-journey");
const evidencePath = path.join(artifactDir, "evidence.json");
const recognitionPaths = new Set(["/api/csm-listing-title", "/api/csm-listing-title-ingest"]);
const productionOrigin = "https://listing.lyncafei.team";
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
  FEEDBACK_EXCHANGE_MISMATCH: "FEEDBACK_EXCHANGE_MISMATCH",
  FEEDBACK_SESSION_MISMATCH: "FEEDBACK_SESSION_MISMATCH",
  FEEDBACK_ACTION_MISMATCH: "FEEDBACK_ACTION_MISMATCH",
  FEEDBACK_REQUEST_TITLE_MISMATCH: "FEEDBACK_REQUEST_TITLE_MISMATCH",
  FEEDBACK_RESPONSE_TITLE_MISMATCH: "FEEDBACK_RESPONSE_TITLE_MISMATCH",
  RUNTIME_CONTRACT_MISMATCH: "RUNTIME_CONTRACT_MISMATCH",
  LARGE_FIXTURE_INVALID: "LARGE_FIXTURE_INVALID",
  LARGE_OWNER_REQUIRED: "LARGE_OWNER_REQUIRED",
  LARGE_PRESPEND_GATE_FAILED: "LARGE_PRESPEND_GATE_FAILED",
  LARGE_RELAY_CONTRACT_MISMATCH: "LARGE_RELAY_CONTRACT_MISMATCH",
  LARGE_RESPONSE_CONTRACT_MISMATCH: "LARGE_RESPONSE_CONTRACT_MISMATCH",
  LARGE_FEEDBACK_POLICY_MISMATCH: "LARGE_FEEDBACK_POLICY_MISMATCH"
});
const allowedVerifierErrorCodes = new Set(Object.values(verifierErrorCodes));

function verifierFailure(code) {
  const safeCode = allowedVerifierErrorCodes.has(code) ? code : verifierErrorCodes.GENERIC;
  return Object.assign(new Error(safeCode), { verifier_error_code: safeCode });
}

function requireInvariant(value, code) {
  if (!value) throw verifierFailure(code);
}

function sanitizedFailureCode(error) {
  const code = String(error?.verifier_error_code || "").trim();
  return allowedVerifierErrorCodes.has(code) ? code : verifierErrorCodes.GENERIC;
}

function titleSha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
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

function assertNoPrivateFixtureKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivateFixtureKeys);
    return;
  }
  if (!exactObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:title|writer_title|canonical_title|ground_truth|label|labels|grammar|accuracy_claim)$/i.test(key)) {
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
    || receipt.fixture_id !== "large-internal-writer-fixture-v1"
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
    || receipt.limits?.original_total_min_bytes_exclusive !== contract.original_total_min_bytes_exclusive
    || receipt.limits?.original_each_max_bytes !== contract.original_each_max_bytes
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
    maxBytes: contract.original_each_max_bytes
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

function deploymentId(health = {}) {
  return health?.deployment?.deployment_id
    || health?.deployment?.git_commit_sha
    || health?.deployment_id
    || null;
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
  phaseComplete = false
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
    "idempotencyKey", "imageDetail", "images", "intentId", "laneVersion",
    "originalImages", "recognitionInputOnly", "resumeOnly", "stagedResumeReceipt"
  ])
    || metadata.recognitionInputOnly !== true
    || metadata.laneVersion !== LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.staged_lane_version
    || metadata.imageDetail !== "high"
    || metadata.expectedOriginalCount !== 2
    || !Array.isArray(metadata.originalImages) || metadata.originalImages.length !== 2
    || !Array.isArray(metadata.images) || metadata.images.length !== 2) {
    throw verifierFailure(verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
  }
  const timing = metadata.clientTiming;
  const firstRequest = priorRequests.length === 0;
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
    resume_only: metadata.resumeOnly === true
  };
}

async function validateLargeRelayResponse(response, fixture) {
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
    browser_body_bytes: expected.bytes
  };
}

function validateLargeRecognitionResponse(payload, fixture, ingestRequests, relayReceipts) {
  const stages = payload?.latency_stages_ms || {};
  const firstRequest = ingestRequests[0];
  const relayAssetIds = new Set(relayReceipts.map((entry) => entry.asset_id));
  const owner = payload?.csm_owner_versions;
  const servedEffortAttested = payload?.served_effort_attested === true;
  const ownerEffortAttested = owner?.reasoning_effort_attested === true;
  const servedEffortHonest = servedEffortAttested === ownerEffortAttested
    && (servedEffortAttested
      ? payload?.served_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
        && owner?.reasoning_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
      : payload?.served_effort == null && owner?.reasoning_effort == null);
  const relayByRole = new Map(relayReceipts.map((entry) => [entry.role, entry]));
  const relayMatchesManifest = originalRoles.every((role, index) => {
    const relay = relayByRole.get(role);
    const original = firstRequest?.original_manifest?.[index];
    return relay?.role === role
      && original?.role === role
      && relay?.image_id === original?.image_id
      && relay?.browser_body_bytes === original?.bytes;
  });
  if (payload?.ok !== true
    || payload?.route !== "CSM_THIN_DIRECT_INGEST"
    || payload?.recognition_input !== "readability_derived_inline"
    || payload?.originals_verified !== true
    || payload?.trace_status !== "PERSISTED"
    || payload?.provider_attempt_number !== 1
    || payload?.provider_retry_count !== 0
    || payload?.model !== CSM_ACTIVE_MODEL_PROFILE.model
    || payload?.requested_effort !== CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
    || !servedEffortHonest
    || !exactObject(owner)
    || owner?.effort !== CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
    || owner?.requested_model !== CSM_ACTIVE_MODEL_PROFILE.model
    || payload?.image_detail !== "high"
    || payload?.cloud_run_calls !== 0
    || payload?.vector_calls !== 0
    || payload?.csm_persistence?.ok !== true
    || payload?.csm_persistence?.atomic !== true
    || payload?.csm_persistence?.session?.saved !== true
    || payload?.ingest_timing?.body_bytes !== fixture.derivedTotal
    || stages.ingest_body_bytes !== fixture.derivedTotal
    || stages.client_recognition_body_bytes !== fixture.derivedTotal
    || stages.client_upload_bytes !== fixture.originalTotal
    || !Number.isFinite(Number(stages.staged_original_sync_ms))
    || !Number.isFinite(Number(stages.csm_persistence_ms))
    || ingestRequests.length < 1 || ingestRequests.length > 2
    || firstRequest?.body_bytes !== fixture.derivedTotal
    || firstRequest?.overlap_observed !== true
    || payload?.client_asset_ref !== firstRequest?.identity?.client_asset_ref
    || payload?.staged_resume_receipt !== firstRequest?.identity?.staged_resume_receipt
    || relayReceipts.length !== 2
    || relayAssetIds.size !== 1 || !relayAssetIds.has(payload?.asset_id)
    || relayByRole.size !== 2
    || !relayMatchesManifest) {
    throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
  }
  return {
    original_upload_bytes: fixture.originalTotal,
    recognition_body_bytes: fixture.derivedTotal,
    overlap_observed: true,
    staged_original_sync_ms: Number(stages.staged_original_sync_ms),
    csm_persistence_ms: Number(stages.csm_persistence_ms),
    client_staged_transform_ms: Number(stages.client_staged_transform_ms),
    ingest_request_count: ingestRequests.length,
    recovery: ingestRequests.length === 1
      ? "CLEAN"
      : ingestRequests[1].resume_only ? "RESUME_ONLY" : "FRESH_RECEIPT"
  };
}

function validateSourceCasesManifest(manifest) {
  if (manifest?.schema_version !== "writer-journey-cases-v2"
    || manifest?.evidence_scope !== "LIVE_CONTRACT_RECEIPT_ONLY"
    || manifest?.accuracy_claim !== null
    || !Array.isArray(manifest.cases) || manifest.cases.length !== 2
    || new Set(manifest.cases.map((entry) => entry?.case_id)).size !== 2
    || new Set(manifest.cases.map((entry) => entry?.expected_grammar)).size !== 2) {
    throw new Error("WRITER_JOURNEY_CASES_MANIFEST invalid");
  }
  for (const entry of manifest.cases) {
    if (!["NON_TCG", "TCG"].includes(entry.case_id)
      || (entry.case_id === "NON_TCG" && entry.expected_grammar !== "NON_TCG")
      || (entry.case_id === "TCG" && entry.expected_grammar !== "TCG")
      || entry.evaluation_cohort !== "INTERNAL_REVIEWED_GT"
      || !entry.source_feedback_id || !entry.hash_provenance
      || !Array.isArray(entry.files) || entry.files.length !== 2
      || entry.image_count !== entry.files.length
      || entry.files[0]?.role !== "front_original"
      || entry.files[1]?.role !== "back_original") {
      throw new Error("WRITER_JOURNEY_CASES_MANIFEST case invalid");
    }
  }
  return manifest.cases;
}

async function localSourceCases(filePath) {
  const manifest = JSON.parse(await readFile(filePath, "utf8"));
  const cases = [];
  for (const entry of validateSourceCasesManifest(manifest)) {
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
  return cases;
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

async function cookieHeaderFromStorageState(filePath, target) {
  if (!filePath) return "";
  const state = JSON.parse(await readFile(filePath, "utf8"));
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
  const resolver = String(owner.resolver || rowResolver).trim();
  const composer = String(owner.composer || rowComposer).trim();
  if (recognition?.csm_owner_versions != null) {
    requireInvariant(Boolean(owner.resolver) && Boolean(owner.composer),
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
  return {
    resolution_view_schema: view.schema_version,
    csm_contract: contract,
    resolver,
    composer
  };
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
  test.setTimeout(20 * 60 * 1000);
  await mkdir(artifactDir, { recursive: true });
  const baseUrl = cleanBaseUrl(process.env.WRITER_JOURNEY_BASE_URL);
  const expectedSha = requiredEnv("WRITER_JOURNEY_EXPECTED_SHA");
  const username = requiredEnv("METAVERSE_USERNAME");
  const password = requiredEnv("METAVERSE_PASSWORD");
  const initialStorageState = String(
    process.env.WRITER_JOURNEY_INITIAL_STORAGE_STATE || ""
  ).trim() || undefined;
  const healthUrl = `${baseUrl}/api/health`;
  const initialCookieHeader = await cookieHeaderFromStorageState(initialStorageState, healthUrl);
  const sourceCases = await localSourceCases(requiredEnv("WRITER_JOURNEY_CASES_MANIFEST"));
  const largeFixture = await localLargeFixture(requiredEnv("WRITER_JOURNEY_LARGE_FIXTURE_RECEIPT"));
  const evidence = {
    schema_version: "production-writer-journey-evidence-v3",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    field_ground_truth_available: false,
    accuracy_claim: null,
    passed: false,
    launch_ready_mutated: false,
    base_url: baseUrl,
    started_at: new Date().toISOString(),
    deployment_id: null,
    request_ids: [],
    asset_ids: [],
    batch_ids: [],
    job_ids: [],
    session_ids: [],
    cases: [],
    stages: {}
  };
  const ids = {
    asset_id: new Set(),
    batch_id: new Set(),
    job_id: new Set(),
    session_id: new Set()
  };
  const requestIds = new Set();
  const apiPaths = new Set();
  const resolutionRequests = [];
  const responseCaptureTasks = new Set();
  const largeTransport = {
    active: false,
    phase_complete: false,
    violation: null,
    ingest_requests: [],
    ingest_responses: [],
    response_promises: [],
    recovery_authorization: null,
    relay_receipts: [],
    external_storage_puts: 0,
    capture_tasks: new Set()
  };
  largeTransport.violation_signal = new Promise((resolve) => {
    largeTransport.signal_violation = resolve;
  });
  let loginContext;
  let loginPage;
  let journeyContext;

  try {
    const healthResponse = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
        ...(initialCookieHeader ? { cookie: initialCookieHeader } : {})
      }
    });
    const health = await healthResponse.json();
    expect(healthResponse.ok, "production health must be reachable").toBeTruthy();
    expect(health?.deployment?.environment,
      "ordinary Preview deployments are not production-target candidates").toBe("production");
    expect(health?.deployment?.git_commit_sha, "production target must match the release under test")
      .toBe(expectedSha);
    requireInvariant(health?.ready === true
      && health?.active_path === "CSM_THIN_DIRECT"
      && health?.model === CSM_ACTIVE_MODEL_PROFILE.model
      && health?.reasoning_effort === CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
      && health?.runtime?.model_profile_id === CSM_ACTIVE_MODEL_PROFILE.id
      && health?.runtime?.provider_adapter_version === expectedProviderAdapterVersion
      && health?.runtime?.execution_contract_sha256_by_image_count?.["1"]
        === expectedExecutionContractSha256ByImageCount["1"]
      && health?.runtime?.execution_contract_sha256_by_image_count?.["2"]
        === expectedExecutionContractSha256ByImageCount["2"]
      && health?.runtime?.max_output_tokens === CSM_ACTIVE_MODEL_PROFILE.max_output_tokens
      && health?.runtime?.transport_profile?.id === CSM_STAGED_TRANSPORT_PROFILE.id
      && health?.runtime?.transport_profile?.lane_version === CSM_STAGED_TRANSPORT_PROFILE.lane_version
      && health?.runtime?.retired_capabilities_disabled === true
      && health?.runtime?.cloud_run_calls === 0
      && health?.runtime?.vector_calls === 0
      && health?.runtime?.generic_ocr_calls === 0,
    verifierErrorCodes.RUNTIME_CONTRACT_MISMATCH);
    evidence.deployment_id = deploymentId(health);
    evidence.deployment_git_commit_sha = health.deployment.git_commit_sha;
    evidence.deployment_environment = health.deployment.environment;
    const healthRequestId = healthResponse.headers.get("x-request-id") || healthResponse.headers.get("x-vercel-id");
    if (healthRequestId) requestIds.add(healthRequestId);
    evidence.stages.health = { passed: true, http_status: healthResponse.status };

    // Login is isolated from uploaded artifacts so credentials never enter a trace.
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
    await journeyContext.route("**/api/csm-listing-title**", async (route) => {
      if (!largeTransport.active) {
        await route.continue();
        return;
      }
      try {
        const requestIndex = largeTransport.ingest_requests.length;
        const recoveryAuthorization = requestIndex === 1
          ? await largeTransport.recovery_authorization
          : null;
        const responsePromise = route.request().response();
        const receipt = validateLargeIngestRequest(
          route.request(), largeFixture, largeTransport.ingest_requests, {
            recoveryAuthorization,
            phaseComplete: largeTransport.phase_complete
          }
        );
        largeTransport.ingest_requests.push(receipt);
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
          if (requestIndex === 0) {
            return validateLargeRecoveryAuthorization(responseReceipt, receipt);
          }
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
        if (requestIndex === 0) largeTransport.recovery_authorization = capturedResponse;
      } catch {
        markLargeTransportViolation(largeTransport, verifierErrorCodes.LARGE_PRESPEND_GATE_FAILED);
        await route.abort("blockedbyclient");
      }
    });
    const journeyPage = await journeyContext.newPage();
    journeyPage.on("request", (request) => {
      const url = new URL(request.url());
      if (largeTransport.active && request.method() === "PUT" && url.origin !== productionOrigin) {
        largeTransport.external_storage_puts += 1;
      }
      if (url.pathname === "/api/csm-resolution-view") {
        resolutionRequests.push({ method: request.method(), asset_id: url.searchParams.get("asset_id") });
      }
    });
    journeyPage.on("response", (response) => {
      const task = (async () => {
        const requestId = responseRequestId(response);
        if (requestId) requestIds.add(requestId);
        const pathname = new URL(response.url()).pathname;
        if (!pathname.startsWith("/api/")) return;
        apiPaths.add(pathname);
        const payload = await jsonOrNull(response);
        if (payload) addIds(payload, ids);
      })();
      responseCaptureTasks.add(task);
      void task.finally(() => responseCaptureTasks.delete(task));

      if (largeTransport.active) {
        const pathname = new URL(response.url()).pathname;
        if (pathname === uploadRelayPath) {
          const largeTask = (async () => {
            try {
              largeTransport.relay_receipts.push(
                await validateLargeRelayResponse(response, largeFixture)
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
    const uploadInput = journeyPage.getByTestId("image-upload-input");
    await expect(journeyPage.getByTestId("start-recognition")).toBeHidden();

    for (const sourceCase of sourceCases) {
      const uploadStartedAt = Date.now();
      const recognitionResponsePromise = journeyPage.waitForResponse((response) => (
        response.request().method() === "POST"
        && recognitionPaths.has(new URL(response.url()).pathname)
      ), { timeout: 6 * 60 * 1000 });
      const resolutionResponsePromise = journeyPage.waitForResponse((response) => (
        response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/csm-resolution-view"
      ), { timeout: 6 * 60 * 1000 });
      await uploadInput.setInputFiles(sourceCase.images);

      const recognitionResponse = await recognitionResponsePromise;
      const recognitionPayload = await recognitionResponse.json();
      addIds(recognitionPayload, ids);
      expect(recognitionResponse.ok(), "direct CSM recognition must succeed").toBeTruthy();
      expect(recognitionPayload?.trace_status, "recognition trace must be durable").toBe("PERSISTED");
      expect(recognitionPayload?.provider_attempt_number, "live verifier requires the first provider attempt")
        .toBe(1);
      expect(recognitionPayload?.provider_retry_count, "live verifier excludes provider retries").toBe(0);
      expect(String(recognitionPayload?.asset_id || "")).not.toBe("");
      expect(String(recognitionPayload?.recognition_session_id || "")).not.toBe("");

      const result = journeyPage.getByTestId("writer-title-result").first();
      const titleInput = result.getByTestId("writer-title-input");
      await expect(titleInput).toBeEnabled({ timeout: 6 * 60 * 1000 });
      await expect.poll(
        async () => /^(?!标题暂不可用$).{1,80}$/.test((await titleInput.inputValue()).trim()),
        { timeout: 6 * 60 * 1000, intervals: [250, 500, 1_000, 2_000] }
      ).toBe(true).catch(() => { throw verifierFailure(verifierErrorCodes.TITLE_NOT_READY); });
      const titleBeforePanel = await titleInput.inputValue();
      const generatedTitleSha256 = titleSha256(recognitionPayload.title);
      const panelTitleSha256 = titleSha256(titleBeforePanel);
      requireInvariant(panelTitleSha256 === generatedTitleSha256,
        verifierErrorCodes.TITLE_UI_RECOGNITION_MISMATCH);

      const resolutionResponse = await resolutionResponsePromise;
      const resolutionView = await resolutionResponse.json();
      addIds(resolutionView, ids);
      expect(resolutionResponse.ok(), "resolution view must be readable in the live writer journey").toBeTruthy();
      expect(resolutionView?.asset_id).toBe(recognitionPayload.asset_id);
      expect(resolutionView?.recognition_session_id).toBe(recognitionPayload.recognition_session_id);
      expect(resolutionView?.grammar?.value).toBe(sourceCase.expected_grammar);
      const versions = recognitionVersionReceipt(recognitionPayload, resolutionView);
      requireInvariant(titleSha256(resolutionView?.composer?.stored_title) === generatedTitleSha256,
        verifierErrorCodes.TITLE_STORED_UI_MISMATCH);
      expect(resolutionView?.composer?.recomposed_matches_stored).toBe(true);
      expect(resolutionView?.composer?.trace_reliable).toBe(true);
      expect(Array.isArray(resolutionView?.brackets)).toBe(true);
      expect(resolutionView.brackets.length).toBeGreaterThan(0);

      const glassBox = result.locator("details.glass-box");
      await expect(glassBox, "Glass Box panel must render after its GET completes").toBeAttached();
      await glassBox.locator("summary").click();
      await expect(glassBox.locator("tbody tr")).toHaveCount(resolutionView.brackets.length);
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
      await titleInput.fill(titleBeforePanel);
      const persistenceRequestPromise = journeyPage.waitForRequest((request) => (
        request.method() === "POST"
        && new URL(request.url()).pathname === "/api/v4/listing-feedback"
      ), { timeout: 45_000 });
      const persistenceResponsePromise = journeyPage.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v4/listing-feedback"
      ), { timeout: 45_000 });
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
      expect(persistenceResponse.ok(), "feedback persistence request must succeed").toBeTruthy();
      expect(persistencePayload?.v4_persistence?.transaction?.saved,
        "feedback transaction must be durable").toBe(true);

      evidence.cases.push({
        case_id: sourceCase.case_id,
        expected_grammar: sourceCase.expected_grammar,
        source_feedback_id: sourceCase.source_feedback_id,
        hash_provenance: sourceCase.hash_provenance,
        image_sha256: sourceCase.files.map(({ role, content_sha256: contentSha256 }) => ({
          role,
          content_sha256: contentSha256
        })),
        recognition_route: new URL(recognitionResponse.url()).pathname,
        asset_id: recognitionPayload.asset_id,
        recognition_session_id: recognitionPayload.recognition_session_id,
        trace_status: recognitionPayload.trace_status,
        provider_attempt_number: recognitionPayload.provider_attempt_number,
        provider_retry_count: recognitionPayload.provider_retry_count,
        resolution_http_method: assetResolutionRequests[0].method,
        resolution_request_count: assetResolutionRequests.length,
        glass_box_rendered: true,
        bracket_count: resolutionView.brackets.length,
        trace_reliable: resolutionView.composer.trace_reliable,
        recomposed_matches_stored: resolutionView.composer.recomposed_matches_stored,
        versions,
        ...titleEvidenceReceipt({
          titleBeforePanel,
          titleAfterPanel,
          expectedTitleSha256: generatedTitleSha256,
          feedback
        }),
        feedback_saved: persistencePayload.v4_persistence.transaction.saved,
        upload_to_feedback_ms: Date.now() - uploadStartedAt
      });
      await expect(journeyPage.getByTestId("writer-title-result")).toHaveCount(0, { timeout: 45_000 });
    }

    const ownerResponse = await journeyContext.request.get(`${baseUrl}/api/session`, {
      headers: { accept: "application/json" }
    });
    const ownerSession = await ownerResponse.json();
    requireInvariant(ownerResponse.ok()
      && ownerSession?.authenticated === true
      && ownerSession?.role === "OWNER",
    verifierErrorCodes.LARGE_OWNER_REQUIRED);

    const largeUploadStartedAt = Date.now();
    largeTransport.active = true;
    const largeRecognitionResponsePromise = journeyPage.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === stagedRecognitionPath
      && response.ok()
    ), { timeout: 6 * 60 * 1000 });
    const largeResolutionResponsePromise = journeyPage.waitForResponse((response) => (
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/csm-resolution-view"
    ), { timeout: 6 * 60 * 1000 });
    await uploadInput.setInputFiles(largeFixture.images);

    const recognitionOutcome = await Promise.race([
      largeRecognitionResponsePromise.then((response) => ({ response })),
      largeTransport.violation_signal.then((code) => ({ violation: code }))
    ]);
    if (recognitionOutcome.violation) throw verifierFailure(recognitionOutcome.violation);
    const largeRecognitionResponse = recognitionOutcome.response;
    const largeRecognitionPayload = await largeRecognitionResponse.json();
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
      && new Set(largeTransport.relay_receipts.map((entry) => entry.role)).size === 2
      && largeTransport.relay_receipts.reduce(
        (total, entry) => total + entry.browser_body_bytes, 0
      ) === largeFixture.originalTotal,
    verifierErrorCodes.LARGE_RELAY_CONTRACT_MISMATCH);
    const transportReceipt = validateLargeRecognitionResponse(
      largeRecognitionPayload,
      largeFixture,
      largeTransport.ingest_requests,
      largeTransport.relay_receipts
    );
    if (largeTransport.ingest_requests.length === 2) {
      await expect.poll(() => largeTransport.ingest_responses.length, {
        timeout: 10_000,
        intervals: [100, 250]
      }).toBe(2).catch(() => {
        throw verifierFailure(verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
      });
      const first = largeTransport.ingest_responses[0]?.payload;
      const action = String(first?.recovery_action || "").toUpperCase();
      requireInvariant(
        action === "STAGED_RESUME_ONLY"
          || (action === "STAGED_FRESH_RETRY" && first?.provider_attempt_started === false),
        verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH
      );
    }

    const largeResult = journeyPage.getByTestId("writer-title-result").first();
    const largeTitleInput = largeResult.getByTestId("writer-title-input");
    await expect(largeTitleInput).toBeEnabled({ timeout: 6 * 60 * 1000 });
    await expect.poll(
      async () => /^(?!标题暂不可用$).{1,80}$/.test((await largeTitleInput.inputValue()).trim()),
      { timeout: 6 * 60 * 1000, intervals: [250, 500, 1_000, 2_000] }
    ).toBe(true).catch(() => { throw verifierFailure(verifierErrorCodes.TITLE_NOT_READY); });
    const largeTitleBeforePanel = await largeTitleInput.inputValue();
    const largeGeneratedTitleSha256 = titleSha256(largeRecognitionPayload.title);
    const largePanelTitleSha256 = titleSha256(largeTitleBeforePanel);
    requireInvariant(largePanelTitleSha256 === largeGeneratedTitleSha256,
      verifierErrorCodes.TITLE_UI_RECOGNITION_MISMATCH);

    const largeResolutionResponse = await largeResolutionResponsePromise;
    const largeResolutionView = await largeResolutionResponse.json();
    addIds(largeResolutionView, ids);
    requireInvariant(largeResolutionResponse.ok()
      && largeResolutionView?.asset_id === largeRecognitionPayload.asset_id
      && largeResolutionView?.recognition_session_id === largeRecognitionPayload.recognition_session_id,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    const largeVersions = recognitionVersionReceipt(largeRecognitionPayload, largeResolutionView);
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

    await largeTitleInput.fill(largeTitleBeforePanel);
    const largePersistenceRequestPromise = journeyPage.waitForRequest((request) => (
      request.method() === "POST"
      && new URL(request.url()).pathname === "/api/v4/listing-feedback"
    ), { timeout: 45_000 });
    const largePersistenceResponsePromise = journeyPage.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v4/listing-feedback"
    ), { timeout: 45_000 });
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
    requireInvariant(largePersistenceResponse.ok()
      && largePersistencePayload?.v4_persistence?.transaction?.saved === true
      && largePersistencePayload?.feedback_data_use === "ADMIN_TEST_ONLY"
      && largePersistencePayload?.dataset_disposition === "ADMIN_TEST_ONLY"
      && largePersistencePayload?.training_eligible === false
      && largePersistencePayload?.production_promotion_eligible === false,
    verifierErrorCodes.LARGE_FEEDBACK_POLICY_MISMATCH);

    evidence.cases.push({
      case_id: "LARGE_STAGED_TRANSPORT",
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
      ...titleEvidenceReceipt({
        titleBeforePanel: largeTitleBeforePanel,
        titleAfterPanel: largeTitleAfterPanel,
        expectedTitleSha256: largeGeneratedTitleSha256,
        feedback: largeFeedback
      }),
      ...transportReceipt,
      relay_request_count: largeTransport.relay_receipts.length,
      feedback_saved: true,
      feedback_data_use: "ADMIN_TEST_ONLY",
      training_eligible: false,
      production_promotion_eligible: false,
      upload_to_feedback_ms: Date.now() - largeUploadStartedAt
    });
    largeTransport.phase_complete = true;
    await expect(journeyPage.getByTestId("writer-title-result")).toHaveCount(0, { timeout: 45_000 });
    await journeyPage.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => null);
    await Promise.all(largeTransport.response_promises);
    await Promise.allSettled([...responseCaptureTasks]);
    await journeyContext.close();
    journeyContext = null;
    requireInvariant(!largeTransport.violation
      && largeTransport.ingest_requests.length === largeTransport.ingest_responses.length
      && largeTransport.ingest_requests.length >= 1
      && largeTransport.ingest_requests.length <= 2,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);

    const finalHealthResponse = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
        ...(initialCookieHeader ? { cookie: initialCookieHeader } : {})
      }
    });
    const finalHealth = await finalHealthResponse.json();
    expect(finalHealthResponse.ok, "production health must remain reachable").toBeTruthy();
    expect(finalHealth?.deployment?.environment).toBe("production");
    expect(finalHealth?.deployment?.git_commit_sha, "production target changed during Writer Journey")
      .toBe(expectedSha);
    requireInvariant(finalHealth?.runtime?.model_profile_id === CSM_ACTIVE_MODEL_PROFILE.id
      && finalHealth?.runtime?.provider_adapter_version === expectedProviderAdapterVersion
      && finalHealth?.runtime?.execution_contract_sha256_by_image_count?.["1"]
        === expectedExecutionContractSha256ByImageCount["1"]
      && finalHealth?.runtime?.execution_contract_sha256_by_image_count?.["2"]
        === expectedExecutionContractSha256ByImageCount["2"]
      && finalHealth?.runtime?.max_output_tokens === CSM_ACTIVE_MODEL_PROFILE.max_output_tokens
      && finalHealth?.runtime?.transport_profile?.id === CSM_STAGED_TRANSPORT_PROFILE.id
      && finalHealth?.runtime?.transport_profile?.lane_version === CSM_STAGED_TRANSPORT_PROFILE.lane_version,
    verifierErrorCodes.RUNTIME_CONTRACT_MISMATCH);
    evidence.stages.release_stability = { passed: true, git_commit_sha: expectedSha };

    requireInvariant(!largeTransport.violation
      && largeTransport.ingest_requests.length === largeTransport.ingest_responses.length,
    verifierErrorCodes.LARGE_RESPONSE_CONTRACT_MISMATCH);
    expect(apiPaths.has("/api/csm-listing-title") || apiPaths.has("/api/csm-listing-title-ingest"),
      "the UI must receive direct CSM recognition before feedback").toBe(true);
    expect(resolutionRequests).toHaveLength(3);
    expect(resolutionRequests.every((request) => request.method === "GET")).toBe(true);
    expect(evidence.cases.map((entry) => entry.case_id).sort())
      .toEqual(["LARGE_STAGED_TRANSPORT", "NON_TCG", "TCG"]);
    expect(ids.asset_id.size, "asset_id must be captured").toBeGreaterThanOrEqual(3);
    expect(ids.session_id.size, "recognition_session_id must be captured").toBeGreaterThanOrEqual(3);
    expect(requestIds.size, "request_id must be captured").toBeGreaterThan(0);
    evidence.stages.live_contract = { passed: true, case_count: evidence.cases.length };
    evidence.passed = true;
  } catch (error) {
    const errorCode = sanitizedFailureCode(error);
    evidence.error_code = errorCode;
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

test("offline verifier boundaries redact titles and reject identity drift @offline", async () => {
  const hash = "a".repeat(64);
  const manifest = {
    schema_version: "writer-journey-cases-v2",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    accuracy_claim: null,
    cases: [
      { case_id: "NON_TCG", expected_grammar: "NON_TCG" },
      { case_id: "TCG", expected_grammar: "TCG" }
    ].map((entry) => ({
      ...entry,
      source_feedback_id: `source-${entry.case_id}`,
      evaluation_cohort: "INTERNAL_REVIEWED_GT",
      hash_provenance: "TEST_EXACT_BYTES",
      image_count: 2,
      files: ["front_original", "back_original"].map((role) => ({
        path: `/not-read/${entry.case_id}/${role}.jpg`,
        role,
        content_type: "image/jpeg",
        content_sha256: hash
      }))
    }))
  };
  requireInvariant(validateSourceCasesManifest(manifest).every((entry) => (
    entry.files.map((file) => file.role).join(",") === "front_original,back_original"
  )), verifierErrorCodes.GENERIC);
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

  const nowSeconds = 1_800_000_000;
  const cookieState = { cookies: [
    { name: "valid", value: "kept", domain: "listing.lyncafei.team", path: "/api", secure: true, expires: nowSeconds + 60 },
    { name: "domain", value: "kept", domain: ".lyncafei.team", path: "/api", secure: true, expires: -1 },
    { name: "evil", value: "drop", domain: "listing.lyncafei.team.evil", path: "/api", secure: true, expires: nowSeconds + 60 },
    { name: "expired", value: "drop", domain: "listing.lyncafei.team", path: "/api", secure: true, expires: nowSeconds - 1 },
    { name: "wrong_path", value: "drop", domain: "listing.lyncafei.team", path: "/app", secure: true, expires: nowSeconds + 60 },
    { name: "path_prefix", value: "drop", domain: "listing.lyncafei.team", path: "/apiary", secure: true, expires: nowSeconds + 60 }
  ] };
  requireInvariant(cookieHeaderForUrl(cookieState, `${productionOrigin}/api/health`, { nowSeconds })
    === "valid=kept; domain=kept", verifierErrorCodes.GENERIC);
  requireInvariant(cookieHeaderForUrl({ cookies: [{
    name: "secure_only", value: "drop", domain: "listing.lyncafei.team", path: "/api",
    secure: true, expires: nowSeconds + 60
  }] }, "http://listing.lyncafei.team/api/health", { nowSeconds }) === "",
  verifierErrorCodes.GENERIC);
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
    csm_owner_versions: { resolver: "resolver-v-test", composer: "composer-v-test" },
    csm_rows: {
      resolution: { contract_version: "csm-stage-v-test", resolver_version: "resolver-v-test" },
      output: { contract_version: "csm-stage-v-test", composer_version: "composer-v-test" }
    }
  };
  const view = {
    schema_version: "csm-resolution-view-v1",
    grammar: { contract_version: "csm-resolution-view-v1", resolver_version: "resolver-v-test" },
    composer: { composer_version: "composer-v-test" }
  };
  const versions = recognitionVersionReceipt(recognition, view);
  requireInvariant(versions.resolver === "resolver-v-test"
    && versions.composer === "composer-v-test", verifierErrorCodes.GENERIC);
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
    imageDetail: "high",
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
  const accepted = validateLargeIngestRequest(makeIngestRequest(), fixture, []);
  requireInvariant(accepted.overlap_observed === true
    && accepted.body_bytes === fixture.derivedTotal,
  verifierErrorCodes.GENERIC);
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
    browser_body_bytes: fixture.originals[index].bytes
  }));
  const recognitionPayload = {
    ok: true,
    route: "CSM_THIN_DIRECT_INGEST",
    recognition_input: "readability_derived_inline",
    originals_verified: true,
    trace_status: "PERSISTED",
    provider_attempt_number: 1,
    provider_retry_count: 0,
    model: "gpt-5.6-luna",
    requested_effort: "low",
    served_effort: null,
    served_effort_attested: false,
    csm_owner_versions: {
      effort: "low",
      requested_model: "gpt-5.6-luna",
      reasoning_effort: null,
      reasoning_effort_attested: false
    },
    image_detail: "high",
    cloud_run_calls: 0,
    vector_calls: 0,
    asset_id: "asset-test",
    client_asset_ref: ingestMetadata.clientAssetRef,
    staged_resume_receipt: ingestMetadata.stagedResumeReceipt,
    csm_persistence: { ok: true, atomic: true, session: { saved: true } },
    ingest_timing: { body_bytes: fixture.derivedTotal },
    latency_stages_ms: {
      ingest_body_bytes: fixture.derivedTotal,
      client_recognition_body_bytes: fixture.derivedTotal,
      client_upload_bytes: fixture.originalTotal,
      staged_original_sync_ms: 10,
      csm_persistence_ms: 5,
      client_staged_transform_ms: 3
    }
  };
  requireInvariant(validateLargeRecognitionResponse(
    recognitionPayload, fixture, [accepted], relayReceipts
  ).recognition_body_bytes === fixture.derivedTotal, verifierErrorCodes.GENERIC);
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
    }
  ]) {
    let rejected = false;
    try { validateLargeRecognitionResponse(drifted, fixture, [accepted], relayReceipts); } catch {
      rejected = true;
    }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }

  let swappedRelayRejected = false;
  try {
    validateLargeRecognitionResponse(recognitionPayload, fixture, [accepted], [
      { ...relayReceipts[0], image_id: relayReceipts[1].image_id },
      { ...relayReceipts[1], image_id: relayReceipts[0].image_id }
    ]);
  } catch {
    swappedRelayRejected = true;
  }
  requireInvariant(swappedRelayRejected, verifierErrorCodes.GENERIC);

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
    try { validateLargeIngestRequest(request, fixture, []); } catch { blocked = true; }
    requireInvariant(blocked, verifierErrorCodes.GENERIC);
  }
});
