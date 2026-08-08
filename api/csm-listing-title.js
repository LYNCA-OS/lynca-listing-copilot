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
import {
  checkCsmProviderAdmissionReadiness,
  createCsmSupabaseProviderAdmissionAuthority
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
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

const MODEL = CSM_THIN_RUNTIME_CONTRACT.model;
const EFFORT = CSM_THIN_RUNTIME_CONTRACT.reasoningEffort;
export const CSM_DIRECT_PROMPT_VERSION = CSM_THIN_RUNTIME_CONTRACT.promptVersion;
export const CSM_DIRECT_ESTIMATED_TOKENS = CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt;
// The Supabase authority owns the absolute 120-slot / 440k-token ceilings and
// the 43-attempt working baseline. With this route's 5,300-token reservation,
// the independent token wall remains an 83-attempt last-resort bound. This
// local value is only a process/test fallback; one HTTP request normally
// dispatches one asset.
export const CSM_DIRECT_LOCAL_FALLBACK_CONCURRENCY = CSM_THIN_RUNTIME_CONTRACT.localFallbackConcurrency;
export const CSM_DIRECT_MAX_ATTEMPTS = CSM_THIN_RUNTIME_CONTRACT.maximumAttempts;
// 145s queue wait + 120s provider deadline leaves 35s inside Vercel's 300s
// function budget for storage reads, signing, CSM persistence and response.
export const CSM_DIRECT_CLAIM_POLL_MS = CSM_THIN_RUNTIME_CONTRACT.claimPollMs;
export const CSM_DIRECT_CLAIM_TIMEOUT_MS = CSM_THIN_RUNTIME_CONTRACT.claimTimeoutMs;
export const CSM_DIRECT_PROVIDER_TIMEOUT_MS = CSM_THIN_RUNTIME_CONTRACT.providerTimeoutMs;
export const CSM_PERSISTENCE_CHECKPOINT_VERSION = "csm-persistence-checkpoint-v1";
export const CSM_CHECKPOINT_RECEIPT_VERSION = "csm-checkpoint-receipt-v1";
export const CSM_PERSISTENCE_READINESS_CACHE_TTL_MS = 30_000;
export const CSM_CHECKPOINT_STATE = "STAGED";
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

function normalizedFingerprint(value) {
  const fingerprint = String(value || "").trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    throw Object.assign(new Error("invalid_image_fingerprint"), { statusCode: 400 });
  }
  return fingerprint;
}

function imageFingerprints(images = []) {
  return Array.from(images, (image) => normalizedFingerprint(`sha256:${requiredText(
    image?.content_sha256 || image?.contentSha256,
    "image_content_sha256"
  )}`));
}

function normalizedCheckpointTaskIdentity(value = {}) {
  const fingerprints = Array.isArray(value.image_fingerprints)
    ? value.image_fingerprints.map(normalizedFingerprint)
    : [];
  if (!fingerprints.length || fingerprints.length > 2) {
    throw persistenceCheckpointError("receipt_image_fingerprints_invalid");
  }
  const operationScope = String(value.operation_scope || "").trim();
  if (operationScope && operationScope !== "derived_checkpoint") {
    throw persistenceCheckpointError("receipt_operation_scope_invalid");
  }
  const laneVersion = String(value.lane_version || "").trim();
  if (operationScope === "derived_checkpoint" && !laneVersion) {
    throw persistenceCheckpointError("receipt_lane_version_missing");
  }
  return {
    asset_id: requiredText(value.asset_id, "receipt_asset_id"),
    intent_id: requiredText(value.intent_id, "receipt_intent_id"),
    model: requiredText(value.model, "receipt_model"),
    reasoning_effort: requiredText(value.reasoning_effort, "receipt_reasoning_effort"),
    detail: normalizedDetail(requiredText(value.detail, "receipt_detail")),
    prompt_version: requiredText(value.prompt_version, "receipt_prompt_version"),
    image_fingerprints: fingerprints,
    ...(operationScope ? { operation_scope: operationScope, lane_version: laneVersion } : {})
  };
}

function checkpointTask({ tenantId, identity }) {
  return {
    tenant_id: requiredText(tenantId, "tenant_id"),
    ...normalizedCheckpointTaskIdentity(identity),
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS
  };
}

export function buildCsmCheckpointReceipt({
  tenantId, taskIdentity, operationKey = null, payloadHash = null
} = {}) {
  const identity = normalizedCheckpointTaskIdentity(taskIdentity);
  const task = checkpointTask({ tenantId, identity });
  const computedOperationKey = buildLunaDirectOperationKey(task);
  const computedPayloadHash = buildLunaDirectPayloadHash(task);
  if (operationKey !== null && requiredText(operationKey, "operation_key") !== computedOperationKey) {
    throw persistenceCheckpointError("receipt_operation_key_mismatch");
  }
  if (payloadHash !== null
      && requiredText(payloadHash, "payload_hash").toLowerCase() !== computedPayloadHash) {
    throw persistenceCheckpointError("receipt_payload_sha256_mismatch");
  }
  return {
    schema_version: CSM_CHECKPOINT_RECEIPT_VERSION,
    operation_key: computedOperationKey,
    payload_sha256: computedPayloadHash,
    task: identity
  };
}

function validatePresentedCheckpointReceipt(value, {
  tenantId, assetId, intentId, detail, imageFingerprints: expectedFingerprints
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema_version !== CSM_CHECKPOINT_RECEIPT_VERSION) {
    throw persistenceCheckpointError("receipt_missing_or_invalid");
  }
  const receipt = buildCsmCheckpointReceipt({
    tenantId,
    taskIdentity: value.task,
    operationKey: value.operation_key,
    payloadHash: value.payload_sha256
  });
  if (receipt.task.asset_id !== assetId
      || receipt.task.intent_id !== intentId
      || receipt.task.detail !== detail
      || receipt.task.image_fingerprints.join("\u001f") !== expectedFingerprints.join("\u001f")) {
    throw persistenceCheckpointError("receipt_request_identity_mismatch");
  }
  return receipt;
}

function normalizedRecognitionInput(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount || expectedCount < 1) {
    throw persistenceCheckpointError("recognition_input_count_mismatch");
  }
  const expectedRoles = ["front_original", "back_original"];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw persistenceCheckpointError("recognition_input_invalid");
    }
    const role = String(entry.image_role || "").trim();
    const read = String(entry.read || "").trim();
    const bytes = Number(entry.bytes);
    if (role !== expectedRoles[index]
        || !["original", "readability_derived", "readability_derived_inline"].includes(read)
        || !Number.isInteger(bytes)
        || bytes < 1) {
      throw persistenceCheckpointError("recognition_input_invalid");
    }
    const originalBytes = entry.original_bytes === null || entry.original_bytes === undefined
      ? null
      : Number(entry.original_bytes);
    const derivedBytes = entry.derived_bytes === null || entry.derived_bytes === undefined
      ? null
      : Number(entry.derived_bytes);
    if ((originalBytes !== null && (!Number.isInteger(originalBytes) || originalBytes < 1))
        || (derivedBytes !== null && (!Number.isInteger(derivedBytes) || derivedBytes < 1))) {
      throw persistenceCheckpointError("recognition_input_bytes_invalid");
    }
    const optionalText = (name) => {
      const text = String(entry[name] || "").trim();
      return text ? { [name]: text.slice(0, 240) } : {};
    };
    return {
      image_role: role,
      read,
      bytes,
      original_bytes: originalBytes,
      derived_available: entry.derived_available === true,
      derived_bytes: derivedBytes,
      ...optionalText("source_image_id"),
      ...optionalText("transform_version"),
      ...optionalText("lane_version"),
      ...optionalText("content_sha256"),
      ...optionalText("original_content_sha256")
    };
  });
}

function validateRecognitionSourceBindings(recognitionInput, originals) {
  const ledger = normalizedRecognitionInput(recognitionInput, originals.length);
  for (let index = 0; index < originals.length; index += 1) {
    const sourceImageId = String(originals[index]?.image_id || originals[index]?.id || "").trim();
    if (!sourceImageId || ledger[index].source_image_id !== sourceImageId) {
      throw Object.assign(new Error("csm_recognition_input_source_mismatch"), {
        code: "csm_recognition_input_source_mismatch",
        statusCode: 409,
        retryable: false
      });
    }
  }
  return ledger;
}

export function buildCsmPersistenceCheckpoint({
  prepared, tenantId, operationKey, payloadHash, recognitionSessionId,
  recognitionInput, taskIdentity
} = {}) {
  const tenant = requiredText(tenantId, "tenant_id");
  const operation = requiredText(operationKey, "operation_key");
  const payload = requiredText(payloadHash, "payload_hash").toLowerCase();
  const session = requiredText(recognitionSessionId, "recognition_session_id");
  if (!/^[0-9a-f]{64}$/.test(payload)) throw persistenceCheckpointError("payload_hash_invalid");
  const hashes = prepared?.csm_rows?.session_hashes;
  if (!exactPacketHashes(hashes)) {
    throw persistenceCheckpointError("packet_hashes_invalid");
  }
  const recognition = normalizedRecognitionInput(
    recognitionInput,
    Number(recognitionInput?.length || 0)
  );
  const receipt = buildCsmCheckpointReceipt({
    tenantId: tenant,
    taskIdentity,
    operationKey: operation,
    payloadHash: payload
  });
  return {
    ...prepared,
    csm_persistence_checkpoint: {
      schema_version: CSM_PERSISTENCE_CHECKPOINT_VERSION,
      state: "PERSISTENCE_PENDING",
      tenant_id: tenant,
      operation_key: operation,
      payload_sha256: payload,
      recognition_session_id: session,
      packet_hashes: hashes,
      recognition_input: recognition,
      checkpoint_receipt: receipt
    }
  };
}

export function validateCsmPersistenceCheckpoint(result, {
  tenantId, operationKey, payloadHash, recognitionSessionId,
  recognitionInputCount = null, checkpointReceipt = null
} = {}) {
  const checkpoint = result?.csm_persistence_checkpoint;
  const expected = {
    tenant_id: requiredText(tenantId, "tenant_id"),
    operation_key: requiredText(operationKey, "operation_key"),
    payload_sha256: requiredText(payloadHash, "payload_hash").toLowerCase(),
    recognition_session_id: requiredText(recognitionSessionId, "recognition_session_id")
  };
  if (!/^[0-9a-f]{64}$/.test(expected.payload_sha256)) {
    throw persistenceCheckpointError("payload_hash_invalid");
  }
  if (checkpoint?.schema_version !== CSM_PERSISTENCE_CHECKPOINT_VERSION
      || checkpoint?.state !== "PERSISTENCE_PENDING") {
    throw persistenceCheckpointError("marker_missing");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (checkpoint[name] !== value) throw persistenceCheckpointError(`${name}_mismatch`);
  }
  const rows = result?.csm_rows;
  if (rows?.resolution?.tenant_id !== expected.tenant_id
      || rows?.resolution?.recognition_session_id !== expected.recognition_session_id
      || rows?.output?.title !== result?.title) {
    throw persistenceCheckpointError("prepared_result_mismatch");
  }
  const hashes = rows?.session_hashes || {};
  const checkpointHashes = checkpoint.packet_hashes || {};
  if (!exactPacketHashes(hashes)
      || !exactPacketHashes(checkpointHashes)
      || CSM_PACKET_HASH_KEYS.some((name) => hashes[name] !== checkpointHashes[name])) {
    throw persistenceCheckpointError("packet_hash_mismatch");
  }
  normalizedRecognitionInput(
    checkpoint.recognition_input,
    recognitionInputCount === null
      ? checkpoint.recognition_input?.length
      : Number(recognitionInputCount)
  );
  const storedReceipt = buildCsmCheckpointReceipt({
    tenantId: expected.tenant_id,
    taskIdentity: checkpoint.checkpoint_receipt?.task,
    operationKey: checkpoint.checkpoint_receipt?.operation_key,
    payloadHash: checkpoint.checkpoint_receipt?.payload_sha256
  });
  if (storedReceipt.operation_key !== expected.operation_key
      || storedReceipt.payload_sha256 !== expected.payload_sha256
      || (checkpointReceipt
        && JSON.stringify(storedReceipt) !== JSON.stringify(checkpointReceipt))) {
    throw persistenceCheckpointError("checkpoint_receipt_mismatch");
  }
  return result;
}

function alreadyPersisted(result, recognitionSessionId) {
  return result?.csm_persistence?.ok === true
    && result?.csm_persistence?.atomic === true
    && result?.csm_persistence?.session?.saved === true
    && result?.csm_rows?.resolution?.recognition_session_id === recognitionSessionId;
}

function publicPersistedResult(result) {
  const { csm_persistence_checkpoint: _checkpoint, ...publicResult } = result || {};
  return publicResult;
}

function publicCheckpointedResult(result) {
  const { csm_persistence_checkpoint: checkpoint, ...publicResult } = result || {};
  return {
    ...publicResult,
    checkpoint_state: CSM_CHECKPOINT_STATE,
    trace_status: "CHECKPOINTED",
    pending_recognition_session_id: checkpoint?.recognition_session_id || null,
    checkpoint_receipt: checkpoint?.checkpoint_receipt || null
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
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("openai_api_key_unconfigured");
  const operation = requiredText(operationKey, "operation_key");
  const payload = requiredText(payloadHash, "payload_hash").toLowerCase();
  const attemptNumber = Number(attempt);
  if (!/^[0-9a-f]{64}$/.test(payload)) throw new TypeError("invalid_payload_hash");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new TypeError("invalid_attempt");
  const opaqueOperation = createHash("sha256").update(operation).digest("hex");
  return (request) => fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(CSM_DIRECT_PROVIDER_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-client-request-id": requiredText(clientRequestId, "client_request_id")
    },
    body: JSON.stringify({
      ...request,
      store: true,
      metadata: {
        ...(request?.metadata && typeof request.metadata === "object" ? request.metadata : {}),
        lynca_operation_sha256: opaqueOperation,
        lynca_payload_sha256: payload,
        lynca_attempt: String(attemptNumber)
      }
    })
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
  checkpointOnly = false, checkpointRequired = false, checkpointReceipt = null,
  clientTiming = null, serverPrologueStages = null,
  env = process.env, fetchImpl = globalThis.fetch, callProvider = null,
  dependencies = {}
} = {}) {
  const routeStartedAt = Date.now();
  const tenant = requiredText(tenantId, "tenant_id");
  const user = requiredText(userId, "user_id");
  const asset = requiredText(assetId, "asset_id");
  const intent = requiredText(intentId, "intent_id");
  const detail = normalizedDetail(imageDetail);
  const checkReadiness = dependencies.checkReadiness || null;
  const readImages = dependencies.readImages || readCanonicalListingImageReferences;
  const signImage = dependencies.signImage || createListingImageSignedReadUrl;
  const createSession = dependencies.createSession || createCsmRecognitionSession;
  const readSessionImages = dependencies.readSessionImages || null;
  const preparePath = dependencies.preparePath || prepareCanonicalListingPath;
  const persistPath = dependencies.persistPath || persistPreparedCanonicalListingPath;
  const createAuthority = dependencies.createAuthority || createCsmSupabaseProviderAdmissionAuthority;
  const createDispatcher = dependencies.createDispatcher || createLunaDirectDispatcher;

  // Fail before the paid provider boundary unless both the replay store and
  // the durable provider authority/pacer are live. A usable title without its
  // CSM lineage or globally paced claim is not an acceptable production asset.
  const readinessStartedAt = Date.now();
  const readiness = checkReadiness
    ? await checkReadiness({ env, fetchImpl })
    : await checkCachedCsmPersistenceReadiness({ env, fetchImpl });
  if (!readiness.ready) throw Object.assign(new Error(`csm_persistence_not_ready:${readiness.reason}`), { statusCode: 503 });
  // The client's own stages come first, so the record covers the whole journey
  // rather than only the part that happens after the request arrives. Without
  // them the six production cards run on 2026-08-06 reported 6.1-9.6s of server
  // work against a writer-observed ~23s, and the difference had nowhere to be.
  // The ingest endpoint already accepted these; this one -- the endpoint the
  // writer flow actually calls -- did not.
  const latencyStages = {
    ...safeClientTiming(clientTiming),
    ...safeLatencyStages(serverPrologueStages),
    preflight_ms: Date.now() - readinessStartedAt
  };

  const imageManifestStartedAt = Date.now();
  const canonical = await readImages({ tenantId: tenant, assetId: asset, env, fetchImpl });
  latencyStages.image_manifest_ms = Date.now() - imageManifestStartedAt;
  const originals = Array.isArray(canonical?.images)
    ? canonical.images.filter((image) => image.derived !== true).slice(0, 2)
    : [];
  const suppliedFingerprints = dependencies.imageFingerprints;
  if (!originals.length && !Array.isArray(suppliedFingerprints)) {
    throw Object.assign(new Error("canonical_original_image_missing"), { statusCode: 409 });
  }
  // COS-53: Recognition may read a stored bounded DOWNSCALE when one exists for
  // an original and is actually smaller. The originals remain the system of
  // record and are still what must exist -- the check above is unchanged and
  // deliberately still asks for them.
  //
  // The operation key and payload hash stay keyed on the ORIGINALS' bytes. The
  // derived image is a function of its original, so keying on it would make a
  // retry that fell back to the original look like a different task and buy a
  // second model call for the same card.
  const recognition = selectRecognitionImages(canonical?.images, { slots: 2 });
  const recognitionImages = Array.isArray(dependencies.recognitionImages)
    ? dependencies.recognitionImages
    : recognition.images.length ? recognition.images : originals;
  if (!recognitionImages.length || recognitionImages.length > 2) {
    throw Object.assign(new Error("recognition_image_count_invalid"), { statusCode: 400 });
  }
  const fingerprints = Array.isArray(suppliedFingerprints)
    ? suppliedFingerprints.map(normalizedFingerprint)
    : imageFingerprints(originals);
  if (fingerprints.length !== recognitionImages.length) {
    throw Object.assign(new Error("recognition_image_identity_count_mismatch"), { statusCode: 400 });
  }
  const recognitionInput = normalizedRecognitionInput(
    dependencies.recognitionInput || recognition.read.map((entry, index) => ({
      ...entry,
      source_image_id: originals[index]?.image_id || originals[index]?.id || ""
    })),
    fingerprints.length
  );
  const stageOnly = checkpointOnly === true || dependencies.checkpointOnly === true;

  const currentTaskIdentity = {
    intent_id: intent,
    asset_id: canonical.asset_id || asset,
    model: MODEL,
    reasoning_effort: EFFORT,
    detail,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    image_fingerprints: fingerprints,
    ...(dependencies.operationScope ? {
      operation_scope: String(dependencies.operationScope),
      lane_version: requiredText(dependencies.laneVersion, "lane_version")
    } : {})
  };
  const presentedReceipt = checkpointRequired === true
    ? validatePresentedCheckpointReceipt(checkpointReceipt, {
        tenantId: tenant,
        assetId: asset,
        intentId: intent,
        detail,
        imageFingerprints: fingerprints
      })
    : null;
  const taskIdentity = presentedReceipt?.task || currentTaskIdentity;
  const task = checkpointTask({ tenantId: tenant, identity: taskIdentity });
  const operationKey = buildLunaDirectOperationKey(task);
  const payloadHash = buildLunaDirectPayloadHash(task);
  const authority = dependencies.providerAdmission || createAuthority({
    env,
    fetchImpl,
    claimPollMs: CSM_DIRECT_CLAIM_POLL_MS,
    claimTimeoutMs: CSM_DIRECT_CLAIM_TIMEOUT_MS,
    maximumProviderDurationMs: CSM_DIRECT_PROVIDER_TIMEOUT_MS
  });

  let durableResult = null;
  const stablePreviewLookup = stageOnly && task.operation_scope === "derived_checkpoint";
  if (manualRetry === true || checkpointRequired === true || stablePreviewLookup) {
    const durable = await authority.lookupOperationResult({
      tenantId: tenant,
      operationKey,
      payloadHash
    });
    if (durable.status === "found") durableResult = durable.result;
    const explicitFailedRetry = stablePreviewLookup
      && durable.status === "failed"
      && manualRetry === true;
    if (stablePreviewLookup
        && !["found", "not_found"].includes(durable.status)
        && !explicitFailedRetry) {
      const retryable = ["pending", "ambiguous", "failed"].includes(durable.status);
      throw Object.assign(new Error(`csm_checkpoint_${durable.status || "not_retriable"}`), {
        code: `csm_checkpoint_${durable.status || "not_retriable"}`,
        statusCode: 409,
        // Retrying the lookup is safe, but this response never authorizes a
        // new paid attempt. FAILED needs an explicit writer manualRetry.
        retryable,
        provider_attempt_started: false
      });
    }
    if (checkpointRequired === true && durable.status !== "found") {
      throw Object.assign(new Error(`csm_checkpoint_${durable.status || "not_found"}`), {
        code: `csm_checkpoint_${durable.status || "not_found"}`,
        statusCode: 409,
        retryable: false,
        provider_attempt_started: false
      });
    }
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

  let providerPathExecuted = false;
  const executeTask = async (dispatched) => {
    let imageUrls;
    const attemptStages = { ...latencyStages };
    const sessionId = deterministicCsmSessionId(dispatched.operation_key);
    const providerClientRequestId = deterministicProviderClientRequestId({
      operationKey: dispatched.operation_key,
      payloadHash: dispatched.payload_hash,
      attempt: dispatched.attempt
    });
    try {
      const signedUrlStartedAt = Date.now();
      imageUrls = await Promise.all(recognitionImages.map((image) => signImage({
        image,
        objectPath: image.objectPath || image.object_path,
        bucket: image.bucket,
        tenantId: tenant,
        env,
        fetchImpl
      })));
      attemptStages.signed_url_ms = Date.now() - signedUrlStartedAt;
    } catch (error) {
      error.before_request = true;
      error.safe_to_retry = true;
      error.retryable = Number(error?.statusCode || error?.status || 503) >= 500;
      error.provider_attempt_started = false;
      throw error;
    }

    const providerStartedAt = Date.now();
    let prepared;
    try {
      providerPathExecuted = true;
      prepared = await preparePath({
        tenantId: tenant,
        recognitionSessionId: sessionId,
        imageUrls,
        imageDetail: task.detail,
        model: task.model,
        effort: task.reasoning_effort,
        promptVersion: task.prompt_version,
        providerClientRequestId,
        callProvider: callProvider || ((request) => createResponsesProviderCaller({
          env,
          fetchImpl,
          operationKey: dispatched.operation_key,
          payloadHash: dispatched.payload_hash,
          attempt: dispatched.attempt,
          clientRequestId: providerClientRequestId
        })(request)),
        env,
        fetchImpl
      });
    } catch (error) {
      attemptStages.provider_prepare_ms = Date.now() - providerStartedAt;
      attemptStages.provider_ms = Number.isFinite(Number(error?.provider_ms))
        ? Number(error.provider_ms)
        : attemptStages.provider_prepare_ms;
      error.latency_stages_ms = { ...attemptStages };
      error.recognition_session_id = sessionId;
      throw error;
    }
    attemptStages.provider_prepare_ms = Date.now() - providerStartedAt;
    if (Number.isFinite(Number(prepared?.latency_ms))) {
      attemptStages.provider_ms = Number(prepared.latency_ms);
    }
    return buildCsmPersistenceCheckpoint({
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
      recognitionInput,
      taskIdentity
    });
  };

  const dispatcher = createDispatcher({
    executeTask,
    providerAdmission: authority,
    lookupOperationResult: authority.lookupOperationResult,
    csmDirectConcurrency: CSM_DIRECT_LOCAL_FALLBACK_CONCURRENCY,
    maxAttempts: CSM_DIRECT_MAX_ATTEMPTS
  });
  const sessionId = deterministicCsmSessionId(operationKey);
  const dispatchStartedAt = Date.now();
  const settled = durableResult || await (
    manualRetry === true && Number(task.prior_attempts) > 0
      ? dispatcher.manualRetry(task)
      : dispatcher.enqueue(task)
  );
  if (alreadyPersisted(settled, sessionId)) {
    return {
      ...publicPersistedResult(settled),
      ...(checkpointRequired === true ? { provider_calls: 0, provider_replayed: true } : {})
    };
  }
  const preparedWithDispatchStages = {
    ...settled,
    provider_calls: providerPathExecuted ? 1 : 0,
    provider_replayed: providerPathExecuted !== true,
    latency_stages_ms: {
      ...(settled.latency_stages_ms || {}),
      authority_dispatch_ms: Date.now() - dispatchStartedAt
    }
  };
  const prepared = validateCsmPersistenceCheckpoint(preparedWithDispatchStages, {
    tenantId: tenant,
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    recognitionInputCount: fingerprints.length,
    checkpointReceipt: presentedReceipt
  });
  if (stageOnly) return publicCheckpointedResult(prepared);

  const sessionCanonical = readSessionImages
    ? await readSessionImages({
        tenantId: tenant,
        assetId: asset,
        env,
        fetchImpl,
        canonical
      })
    : canonical;
  const sessionOriginals = Array.isArray(sessionCanonical?.images)
    ? sessionCanonical.images.filter((image) => image.derived !== true).slice(0, 2)
    : [];
  if (!sessionOriginals.length
      || imageFingerprints(sessionOriginals).join("\u001f") !== fingerprints.join("\u001f")) {
    throw Object.assign(new Error("csm_session_original_fingerprint_mismatch"), {
      code: "csm_session_original_fingerprint_mismatch",
      statusCode: 409,
      retryable: false
    });
  }
  const checkpointRecognitionInput = validateRecognitionSourceBindings(
    prepared.csm_persistence_checkpoint.recognition_input,
    sessionOriginals
  );
  const sessionReferences = Array.isArray(sessionCanonical?.image_references)
    ? sessionCanonical.image_references
    : [];
  if (!sessionReferences.length
      || String(sessionCanonical.asset_id || "") !== asset
      || Number(sessionCanonical.expected_original_count) !== fingerprints.length) {
    throw Object.assign(new Error("csm_session_canonical_image_set_invalid"), {
      code: "csm_session_canonical_image_set_invalid",
      statusCode: 409,
      retryable: false
    });
  }
  const recognitionSessionStartedAt = Date.now();
  const session = await createSession({
    sessionId,
    tenantId: tenant,
    userId: user,
    operatorId: user,
    payload: {
      asset_id: sessionCanonical.asset_id,
      client_asset_ref: sessionCanonical.asset_id,
      images: sessionReferences,
      image_references: sessionReferences,
      image_generation_id: sessionCanonical.image_generation_id,
      image_set_sha256: sessionCanonical.image_set_sha256,
      expected_original_count: sessionCanonical.expected_original_count,
      // This is the immutable ledger settled with the paid result. A replay may
      // now see stored originals, but the session must state what Luna actually
      // read on the paid attempt rather than recomputing that fact.
      recognition_input: checkpointRecognitionInput,
      provider: task.model,
      reasoning_effort: task.reasoning_effort,
      mode: "csm_thin_direct"
    },
    routePlan: { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" },
    env,
    fetchImpl
  });
  const preparedForPersistence = {
    ...prepared,
    latency_stages_ms: {
      ...(prepared.latency_stages_ms || {}),
      recognition_session_ms: Date.now() - recognitionSessionStartedAt
    }
  };
  if (session.persistence?.recognition_session?.saved !== true) {
    throw Object.assign(new Error("csm_recognition_session_not_persisted"), {
      statusCode: 503
    });
  }
  const persistenceStartedAt = Date.now();
  const persisted = await persistPath({
    tenantId: tenant,
    recognitionSessionId: sessionId,
    prepared: preparedForPersistence,
    imageDetail: task.detail,
    model: task.model,
    effort: task.reasoning_effort,
    promptVersion: task.prompt_version,
    env,
    fetchImpl
  });
  const persistedWithLatency = persisted && typeof persisted === "object"
    ? {
        ...persisted,
        latency_stages_ms: {
          ...(persisted.latency_stages_ms || preparedForPersistence.latency_stages_ms || {}),
          csm_persistence_ms: Date.now() - persistenceStartedAt,
          request_total_ms: Date.now() - routeStartedAt
        }
      }
    : persisted;
  if (persistedWithLatency?.csm_persistence?.ok !== true
      || persistedWithLatency?.csm_persistence?.atomic !== true
      || persistedWithLatency?.csm_persistence?.session?.saved !== true) {
    const code = persistedWithLatency?.csm_persistence?.ok === true
      ? "csm_persistence_incomplete"
      : String(persistedWithLatency?.csm_persistence?.code || "csm_persistence_failed");
    throw Object.assign(new Error(code), {
      code,
      statusCode: persistedWithLatency?.csm_persistence?.ok === true
        ? 503
        : Number(persistedWithLatency?.csm_persistence?.statusCode || 503),
      retryable: Number(persistedWithLatency?.csm_persistence?.statusCode || 503) >= 500
    });
  }
  return publicPersistedResult(persistedWithLatency);
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
      imageDetail: payload.image_detail || "high",
      manualRetry: payload.manual_retry === true,
      checkpointRequired: payload.checkpoint_required === true,
      checkpointReceipt: payload.checkpoint_receipt || null,
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
      cloud_run_calls: 0,
      vector_calls: 0,
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
    const status = responseStatus(error);
    const providerFailureReceipt = buildProviderFailureReceipt(error);
    if (providerFailureReceipt) {
      console.error(JSON.stringify({
        event: "csm_provider_attempt_failed",
        request_id: telemetry.requestId,
        recognition_session_id: safeReceiptText(error?.recognition_session_id),
        ...providerFailureReceipt
      }));
    }
    return sendJson(res, status, {
      ok: false,
      route: "CSM_THIN_DIRECT",
      cloud_run_calls: 0,
      vector_calls: 0,
      code: String(error?.message || "csm_thin_path_failed").split(":")[0],
      error_type: providerFailureReceipt ? "CSM_PROVIDER_ATTEMPT_FAILED" : "CSM_THIN_PATH_FAILED",
      retryable: error?.retryable === true || status >= 500,
      message: String(error?.message || "CSM thin path failed").slice(0, 240),
      recognition_session_id: safeReceiptText(error?.recognition_session_id),
      ...(providerFailureReceipt ? {
        provider_failure_receipt: providerFailureReceipt,
        latency_stages_ms: providerFailureReceipt.latency_stages_ms
      } : {})
    });
  }
}
