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
  createCsmSupabaseProviderAdmissionAuthority
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import { createCsmRecognitionSession } from "../lib/listing/thin/csm-session-store.mjs";
import { checkCsmPersistenceReadiness } from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash,
  buildLegacyLowLunaDirectPayloadHash,
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
export const CSM_PERSISTENCE_CHECKPOINT_VERSION = "csm-persistence-checkpoint-v2";
export const CSM_PERSISTENCE_CHECKPOINT_LEGACY_VERSION = "csm-persistence-checkpoint-v1";
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

export function buildCsmPersistenceCheckpoint({
  prepared, tenantId, operationKey, payloadHash, recognitionSessionId,
  recognitionSessionDeferred = false, recognitionInput = null
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
  let accuracyLossLedger;
  try {
    accuracyLossLedger = validateAccuracyLossLedger(prepared?.accuracy_loss_ledger, { result: prepared });
  } catch {
    throw persistenceCheckpointError("accuracy_loss_ledger_invalid");
  }
  return {
    ...prepared,
    csm_persistence_checkpoint: {
      schema_version: CSM_PERSISTENCE_CHECKPOINT_VERSION,
      state: "PERSISTENCE_PENDING",
      tenant_id: tenant,
      operation_key: operation,
      payload_sha256: payload,
      recognition_session_id: session,
      recognition_session_deferred: recognitionSessionDeferred === true,
      ...(recognitionInput ? {
        recognition_input: normalizedCheckpointRecognitionInput(recognitionInput)
      } : {}),
      packet_hashes: hashes,
      accuracy_loss_ledger_version: accuracyLossLedger.version,
      accuracy_loss_ledger_sha256: accuracyLossLedger.ledger_sha256
    }
  };
}

export function validateCsmPersistenceCheckpoint(result, {
  tenantId, operationKey, payloadHash, recognitionSessionId
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
  const checkpointVersion = checkpoint?.schema_version;
  if (![CSM_PERSISTENCE_CHECKPOINT_VERSION, CSM_PERSISTENCE_CHECKPOINT_LEGACY_VERSION]
    .includes(checkpointVersion) || checkpoint?.state !== "PERSISTENCE_PENDING") {
    throw persistenceCheckpointError("marker_missing");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (checkpoint[name] !== value) throw persistenceCheckpointError(`${name}_mismatch`);
  }
  if (checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_VERSION
      && checkpoint.recognition_session_deferred != null
      && typeof checkpoint.recognition_session_deferred !== "boolean") {
    throw persistenceCheckpointError("recognition_session_deferred_invalid");
  }
  const recognitionInput = checkpoint.recognition_input == null
    ? null
    : normalizedCheckpointRecognitionInput(checkpoint.recognition_input);
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
  if (checkpointVersion === CSM_PERSISTENCE_CHECKPOINT_VERSION) {
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

function legacyPayloadRecoveryError(status, cause = null) {
  const normalized = String(status || "unavailable").toLowerCase();
  return Object.assign(new Error(`csm_legacy_payload_${normalized}`), {
    code: `csm_legacy_payload_${normalized}`,
    statusCode: 409,
    retryable: ["pending", "ambiguous"].includes(normalized),
    provider_attempt_started: false,
    ...(cause ? { cause } : {})
  });
}

export function publicPersistedResult(result) {
  const {
    csm_persistence_checkpoint: _checkpoint,
    accuracy_loss_ledger: _accuracyLossLedger,
    ...publicResult
  } = result || {};
  return publicResult;
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
  resumeOnly = false,
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
  const preparePath = dependencies.preparePath || prepareCanonicalListingPath;
  const persistPath = dependencies.persistPath || persistPreparedCanonicalListingPath;
  const chooseRecognitionImages = dependencies.chooseRecognitionImages
    || (({ canonical: input }) => selectRecognitionImages(input.images, { slots: 2 }));
  const createAuthority = dependencies.createAuthority || createCsmSupabaseProviderAdmissionAuthority;
  const createDispatcher = dependencies.createDispatcher || createLunaDirectDispatcher;
  const operationScope = String(dependencies.operationScope || "").trim();
  if (operationScope && operationScope !== "derived_checkpoint") {
    throw Object.assign(new Error("csm_operation_scope_invalid"), { statusCode: 400, retryable: false });
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
  const readinessStartedAt = Date.now();
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
    preflight_ms: Date.now() - readinessStartedAt
  };

  const imageManifestStartedAt = Date.now();
  const canonical = await readImages({ tenantId: tenant, assetId: asset, env, fetchImpl });
  latencyStages.image_manifest_ms = Date.now() - imageManifestStartedAt;
  const originals = canonical.images.filter((image) => image.derived !== true).slice(0, 2);
  if (!originals.length) {
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
  const recognition = chooseRecognitionImages({ canonical, originals });
  if (!Array.isArray(recognition?.images) || recognition.images.length !== originals.length) {
    throw Object.assign(new Error("recognition_image_selection_invalid"), {
      statusCode: 409,
      retryable: false
    });
  }
  const recognitionImages = recognition.images.length ? recognition.images : originals;

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
    provider = MODEL
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
  let legacyPayloadRecovered = false;

  const recoverLegacyPayloadConflict = async (conflictError) => {
    if (conflictError?.code !== "operation_payload_conflict") throw conflictError;
    if (operationScope) throw conflictError;
    let legacyPayloadHash;
    try {
      legacyPayloadHash = buildLegacyLowLunaDirectPayloadHash(task);
    } catch {
      // Future efforts are intentionally ineligible and keep the original
      // authority conflict classification.
      throw conflictError;
    }
    // This lookup is provider-incapable and exists only on the exact conflict
    // returned for the current hash. The clean path pays no extra Supabase RTT.
    let legacy;
    try {
      legacy = await authority.lookupOperationResult({
        tenantId: tenant,
        operationKey,
        payloadHash: legacyPayloadHash
      });
    } catch (error) {
      throw legacyPayloadRecoveryError("unavailable", error);
    }
    if (legacy.status === "found") {
      return { result: legacy.result, payloadHash: legacyPayloadHash };
    }
    if (["pending", "ambiguous"].includes(legacy.status)) {
      throw legacyPayloadRecoveryError(legacy.status);
    }
    // Historical FAILED/CANCELLED states contain no paid success checkpoint.
    // Recovery remains provider-incapable; an operator may inspect/manual
    // recover them, but this route will not manufacture another Luna attempt.
    throw legacyPayloadRecoveryError(legacy.status || "not_found");
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
      throw markStagedLookupRecovery(error);
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
      const recovered = await recoverLegacyPayloadConflict(error);
      durable = { status: "found", result: recovered.result };
      durablePayloadHash = recovered.payloadHash;
      legacyPayloadRecovered = true;
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
          const signedUrlStartedAt = Date.now();
          const urls = await Promise.all(recognitionImages.map((image) => signImage({
            objectPath: image.objectPath,
            bucket: image.bucket,
            tenantId: tenant,
            env,
            fetchImpl
          })));
          attemptStages.signed_url_ms = Date.now() - signedUrlStartedAt;
          return urls;
        })(),
        (async () => {
          const recognitionSessionStartedAt = Date.now();
          const created = await initializeRecognitionSession(sessionId);
          attemptStages.recognition_session_ms = Date.now() - recognitionSessionStartedAt;
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

    const providerStartedAt = Date.now();
    let prepared;
    try {
      prepared = await preparePath({
        tenantId: tenant,
        recognitionSessionId: sessionId,
        imageUrls,
        imageDetail: detail,
        model: MODEL,
        effort: EFFORT,
        promptVersion: CSM_DIRECT_PROMPT_VERSION,
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
      recognitionSessionDeferred,
      recognitionInput: recognition.read
    });
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
  const dispatchStartedAt = Date.now();
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
        throw markStagedLookupRecovery(error);
      }
      const recovered = await recoverLegacyPayloadConflict(error);
      settled = recovered.result;
      durablePayloadHash = recovered.payloadHash;
      legacyPayloadRecovered = true;
    }
  }
  if (!legacyPayloadRecovered && alreadyPersisted(settled, sessionId)) {
    return publicPersistedResult(settled);
  }
  const preparedWithDispatchStages = {
    ...settled,
    latency_stages_ms: {
      ...(settled.latency_stages_ms || {}),
      authority_dispatch_ms: Date.now() - dispatchStartedAt
    }
  };
  let prepared = validateCsmPersistenceCheckpoint(preparedWithDispatchStages, {
    tenantId: tenant,
    operationKey,
    payloadHash: durablePayloadHash,
    recognitionSessionId: sessionId
  });
  if ((prepared.csm_persistence_checkpoint.recognition_session_deferred === true
        || dependencies.deferRecognitionSessionUntilPersistence === true)
      && !sessionInitializedThisRequest) {
    const recognitionSessionReplayStartedAt = Date.now();
    try {
      await initializeRecognitionSession(sessionId, {
        recognitionInput: prepared.csm_persistence_checkpoint.recognition_input || recognition.read,
        provider: prepared.model || MODEL
      });
    } catch (error) {
      throw markStagedResumeRecovery(error);
    }
    prepared = {
      ...prepared,
      latency_stages_ms: {
        ...(prepared.latency_stages_ms || {}),
        recognition_session_replay_ms: Date.now() - recognitionSessionReplayStartedAt
      }
    };
  }
  const persistenceStartedAt = Date.now();
  let persisted;
  try {
    persisted = await persistPath({
      tenantId: tenant,
      recognitionSessionId: sessionId,
      prepared,
      imageDetail: prepared.image_detail || detail,
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
    throw markStagedResumeRecovery(Object.assign(new Error(code), {
      code,
      statusCode: persistedWithLatency?.csm_persistence?.ok === true
        ? 503
        : Number(persistedWithLatency?.csm_persistence?.statusCode || 503),
      retryable: Number(persistedWithLatency?.csm_persistence?.statusCode || 503) >= 500
    }));
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
      cloud_run_calls: 0,
      vector_calls: 0,
      code: String(error?.message || "csm_thin_path_failed").split(":")[0],
      error_type: providerFailureReceipt ? "CSM_PROVIDER_ATTEMPT_FAILED" : "CSM_THIN_PATH_FAILED",
      retryable,
      message: String(error?.message || "CSM thin path failed").slice(0, 240),
      recognition_session_id: safeReceiptText(error?.recognition_session_id),
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
      imageDetail: payload.image_detail || "high",
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
