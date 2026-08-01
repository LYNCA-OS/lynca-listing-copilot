// Direct CSM thin path. No queue, Cloud Run, vector service, OCR sidecar, web
// search, or second model round participates in this request.

import { createHash } from "node:crypto";

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { readJsonPayload, sendJson } from "../lib/http-handler-utils.mjs";
import { instrumentProductionRequest, bindProductionRequestContext } from "../lib/observability/production-events.mjs";
import { readCanonicalListingImageReferences } from "../lib/listing/storage/canonical-image-references.mjs";
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

export function buildCsmPersistenceCheckpoint({
  prepared, tenantId, operationKey, payloadHash, recognitionSessionId
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
  return {
    ...prepared,
    csm_persistence_checkpoint: {
      schema_version: CSM_PERSISTENCE_CHECKPOINT_VERSION,
      state: "PERSISTENCE_PENDING",
      tenant_id: tenant,
      operation_key: operation,
      payload_sha256: payload,
      recognition_session_id: session,
      packet_hashes: hashes
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
  const latencyStages = {
    preflight_ms: Date.now() - readinessStartedAt
  };

  const imageManifestStartedAt = Date.now();
  const canonical = await readImages({ tenantId: tenant, assetId: asset, env, fetchImpl });
  latencyStages.image_manifest_ms = Date.now() - imageManifestStartedAt;
  const originals = canonical.images.filter((image) => image.derived !== true).slice(0, 2);
  if (!originals.length) {
    throw Object.assign(new Error("canonical_original_image_missing"), { statusCode: 409 });
  }

  const task = {
    tenant_id: tenant,
    intent_id: intent,
    asset_id: canonical.asset_id || asset,
    model: MODEL,
    detail,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: originals.map((image) => `sha256:${requiredText(
      image.content_sha256 || image.contentSha256,
      "image_content_sha256"
    ).toLowerCase()}`)
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

  let durableResult = null;
  if (manualRetry === true) {
    const durable = await authority.lookupOperationResult({
      tenantId: tenant,
      operationKey,
      payloadHash
    });
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
    const attemptStages = { ...latencyStages };
    const sessionId = deterministicCsmSessionId(dispatched.operation_key);
    const providerClientRequestId = deterministicProviderClientRequestId({
      operationKey: dispatched.operation_key,
      payloadHash: dispatched.payload_hash,
      attempt: dispatched.attempt
    });
    try {
      const signedUrlStartedAt = Date.now();
      imageUrls = await Promise.all(originals.map((image) => signImage({
        objectPath: image.objectPath,
        bucket: image.bucket,
        tenantId: tenant,
        env,
        fetchImpl
      })));
      attemptStages.signed_url_ms = Date.now() - signedUrlStartedAt;
      const recognitionSessionStartedAt = Date.now();
      const session = await createSession({
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
          provider: MODEL,
          mode: "csm_thin_direct"
        },
        routePlan: { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" },
        env,
        fetchImpl
      });
      attemptStages.recognition_session_ms = Date.now() - recognitionSessionStartedAt;
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
    const prepared = await preparePath({
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
    attemptStages.provider_prepare_ms = Date.now() - providerStartedAt;
    if (Number.isFinite(Number(prepared?.latency_ms))) {
      attemptStages.provider_ms = Number(prepared.latency_ms);
    }
    return buildCsmPersistenceCheckpoint({
      prepared: { ...prepared, latency_stages_ms: attemptStages },
      tenantId: tenant,
      operationKey: dispatched.operation_key,
      payloadHash: dispatched.payload_hash,
      recognitionSessionId: sessionId
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
  if (alreadyPersisted(settled, sessionId)) return publicPersistedResult(settled);
  const preparedWithDispatchStages = {
    ...settled,
    latency_stages_ms: {
      ...(settled.latency_stages_ms || {}),
      authority_dispatch_ms: Date.now() - dispatchStartedAt
    }
  };
  const prepared = validateCsmPersistenceCheckpoint(preparedWithDispatchStages, {
    tenantId: tenant,
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId
  });
  const persistenceStartedAt = Date.now();
  const persisted = await persistPath({
    tenantId: tenant,
    recognitionSessionId: sessionId,
    prepared,
    imageDetail: detail,
    model: MODEL,
    effort: EFFORT,
    promptVersion: CSM_DIRECT_PROMPT_VERSION,
    env,
    fetchImpl
  });
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

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/csm-listing-title" });
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, message: "Method not allowed" });
  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.CREATE_JOB });
    bindProductionRequestContext(res, context);
  } catch (error) {
    return sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "csm_listing_title", limit: 600, windowMs: 60_000,
    identifier: `${context.tenantId}:${context.userId}`,
    message: "Too many recognition requests. Please try again shortly."
  })) return;

  try {
    const payload = await readJsonPayload(req, { maxBytes: 16 * 1024 });
    const result = await runDirectCsmAsset({
      tenantId: context.tenantId,
      userId: context.userId,
      assetId: payload.asset_id || payload.assetId,
      intentId: payload.intent_id || payload.intentId,
      imageDetail: payload.image_detail || "high",
      manualRetry: payload.manual_retry === true
    });
    return sendJson(res, 200, {
      ok: true,
      route: "CSM_THIN_DIRECT",
      cloud_run_calls: 0,
      vector_calls: 0,
      recognition_session_id: result.csm_rows.resolution.recognition_session_id,
      trace_status: "PERSISTED",
      ...result
    });
  } catch (error) {
    const status = responseStatus(error);
    return sendJson(res, status, {
      ok: false,
      code: String(error?.message || "csm_thin_path_failed").split(":")[0],
      retryable: error?.retryable === true || status >= 500,
      message: String(error?.message || "CSM thin path failed").slice(0, 240)
    });
  }
}
