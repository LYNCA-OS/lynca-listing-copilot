import { createHash, randomUUID } from "node:crypto";

import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";
import { CSM_ACTIVE_MODEL_PROFILE } from "./csm-model-profile.mjs";

export const CSM_PROVIDER_AUTHORITY_SCOPE = Object.freeze({
  provider: CSM_ACTIVE_MODEL_PROFILE.provider,
  accountScope: CSM_ACTIVE_MODEL_PROFILE.account_scope,
  model: CSM_ACTIVE_MODEL_PROFILE.model
});

export const CSM_PROVIDER_AUTHORITY_LIMITS = Object.freeze({
  // 120 is the absolute scheduler/count authority, not the normal working
  // window. The additive pacer migration caps AIMD recovery at 43; the separate
  // 440k wall remains an independent last-resort token bound in addition to
  // the attempt cap; the active profile owns each attempt's reservation.
  maximumActiveAttempts: 120,
  maximumActiveEstimatedTokens: 440_000,
  baselineWorkingActiveAttempts: 43,
  pacerEstimatedTokensPerSecond: 60_000,
  pacerBurstEstimatedTokens: 66_000,
  retryFractionWhileFreshQueued: 0.2,
  rollingWindowSeconds: 60,
  targetRequestsPerWindow: 4_500,
  hardRequestsPerWindow: 5_000,
  targetEstimatedTokensPerWindow: 3_600_000,
  hardTokensPerWindow: 4_000_000
});

export const CSM_PROVIDER_AUTHORITY_RPCS = Object.freeze({
  enqueue: "enqueue_csm_thin_provider_attempt_v1",
  claim: "claim_csm_thin_provider_attempt_v1",
  heartbeat: "heartbeat_csm_thin_provider_attempt_v1",
  settle: "settle_csm_thin_provider_attempt_v1",
  cancel: "cancel_csm_thin_provider_operation_v1",
  lookup: "lookup_csm_thin_provider_operation_v1",
  lookupByKey: "lookup_csm_thin_provider_operation_by_key_v1",
  pacerReadiness: "check_csm_thin_provider_pacer_v1"
});

// Every authority request crosses PostgREST. Keep a single stalled socket from
// defeating the route's bounded queue/provider budget. The queue wait has its
// own larger wall-clock deadline; this is the ceiling for one RPC within it.
export const CSM_PROVIDER_AUTHORITY_RPC_TIMEOUT_MS = 5_000;
export const CSM_PROVIDER_READINESS_BUDGET_MS = 8_000;
export const CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION =
  "csm-provider-authority-receipt-v1";

const CSM_PROVIDER_AUTHORITY_RECEIPT_KEYS = Object.freeze([
  "schema_version",
  "operation_key_sha256",
  "attempt",
  "attempt_class",
  "estimated_tokens",
  "claim_code",
  "settle_code",
  "operation_status"
]);

const CSM_PROVIDER_READINESS_LOOKUP_HASH = "0".repeat(64);

const AMBIGUOUS_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"
]);

export class CsmProviderAdmissionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "CsmProviderAdmissionError";
    this.code = code;
    this.status = Number.isInteger(options.status) ? options.status : null;
    this.retryable = options.retryable === true;
    this.ambiguous = options.ambiguous === true;
    this.provider_attempt_started = options.providerAttemptStarted === true;
    if (options.providerAttemptStarted === false) this.provider_attempt_started = false;
  }
}

function text(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`missing_${name}`);
  return normalized;
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`invalid_${name}`);
  }
  return normalized;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Validate the public projection of one successfully claimed and settled
 * physical provider attempt. The reservation comes from the database claim
 * receipt, never from the active profile or health payload.
 */
export function validateCsmProviderAuthorityReceipt(value, {
  operationKey = null,
  attempt = null
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== CSM_PROVIDER_AUTHORITY_RECEIPT_KEYS.length
      || !CSM_PROVIDER_AUTHORITY_RECEIPT_KEYS.every((key) => Object.hasOwn(value, key))) {
    throw new TypeError("invalid_provider_authority_receipt_shape");
  }
  const operationKeySha256 = String(value.operation_key_sha256 || "").toLowerCase();
  const attemptNumber = positiveInteger(value.attempt, "provider_authority_receipt_attempt");
  const attemptClass = String(value.attempt_class || "").toLowerCase();
  const estimatedTokens = positiveInteger(
    value.estimated_tokens,
    "provider_authority_receipt_estimated_tokens",
    CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
  );
  const claimCode = String(value.claim_code || "");
  const settleCode = String(value.settle_code || "");
  if (value.schema_version !== CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION
      || !/^[0-9a-f]{64}$/.test(operationKeySha256)
      || !["fresh", "retry"].includes(attemptClass)
      || !["admitted", "claim_receipt_replayed"].includes(claimCode)
      || !["settled", "exact_replay"].includes(settleCode)
      || value.operation_status !== "SUCCEEDED"
      || (operationKey !== null && operationKeySha256 !== sha256(operationKey))
      || (attempt !== null && attemptNumber !== positiveInteger(
        attempt,
        "expected_provider_authority_receipt_attempt"
      ))) {
    throw new TypeError("invalid_provider_authority_receipt_contract");
  }
  return Object.freeze({
    schema_version: CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION,
    operation_key_sha256: operationKeySha256,
    attempt: attemptNumber,
    attempt_class: attemptClass,
    estimated_tokens: estimatedTokens,
    claim_code: claimCode,
    settle_code: settleCode,
    operation_status: "SUCCEEDED"
  });
}

function normalizeScope(scope = {}) {
  return Object.freeze({
    provider: text(scope.provider ?? CSM_PROVIDER_AUTHORITY_SCOPE.provider, "provider"),
    accountScope: text(
      scope.accountScope ?? CSM_PROVIDER_AUTHORITY_SCOPE.accountScope,
      "account_scope"
    ),
    model: text(scope.model ?? CSM_PROVIDER_AUTHORITY_SCOPE.model, "model")
  });
}

function normalizeAttempt(metadata = {}, scope) {
  const payloadHash = text(metadata.payloadHash, "payload_hash").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(payloadHash)) throw new TypeError("invalid_payload_hash");
  const attemptClass = text(metadata.attemptClass, "attempt_class").toLowerCase();
  if (!new Set(["fresh", "retry"]).has(attemptClass)) {
    throw new TypeError("invalid_attempt_class");
  }
  return Object.freeze({
    tenantId: text(metadata.tenantId, "tenant_id"),
    operationKey: text(metadata.operationKey, "operation_key"),
    payloadHash,
    attempt: positiveInteger(metadata.attempt, "attempt"),
    attemptClass,
    estimatedTokens: positiveInteger(
      metadata.estimatedTokens,
      "estimated_tokens",
      CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
    ),
    tenantWeight: Number(metadata.tenantWeight ?? 1),
    notBefore: metadata.notBefore ? new Date(metadata.notBefore).toISOString() : null,
    ...scope
  });
}

function serviceKey(env) {
  return text(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, "supabase_service_key");
}

function statusOf(error) {
  for (const candidate of [error?.status, error?.statusCode, error?.response?.status]) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function providerFailureIsAmbiguous(error) {
  if (error?.ambiguous === true || error?.timeout === true) return true;
  if (error?.definitive_response === true) return false;
  if (error?.before_request === true || error?.safe_to_retry === true) return false;
  // AbortSignal.timeout() rejects fetch with a DOMException named
  // "TimeoutError" (code 23 in Node), not with ETIMEDOUT.
  if (error?.name === "TimeoutError" || error?.cause?.name === "TimeoutError") return true;
  const status = statusOf(error);
  if ([502, 503, 504].includes(status)) return true;
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (AMBIGUOUS_CODES.has(code)) return true;
  return error?.name === "TypeError"
    && /(?:fetch failed|failed to fetch|networkerror|network request failed)/i
      .test(String(error?.message || ""));
}

function requestTimedOut(error) {
  return [error, error?.cause].some((candidate) => (
    candidate?.name === "TimeoutError"
    || candidate?.name === "AbortError"
    || candidate?.code === "ABORT_ERR"
  ));
}

function readinessTimeout(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function csmProviderPacerReadinessMatches(receipt) {
  return receipt?.ok === true
    && receipt?.code === "pacer_ready"
    && Number(receipt.max_active) === CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts
    && Number(receipt.max_active_tokens)
      === CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
    && Number(receipt.baseline_working_max_active)
      === CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts
    && Number(receipt.effective_max_active) >= 1
    && Number(receipt.effective_max_active)
      <= CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts
    && Number(receipt.pacer_tokens_per_second)
      === CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond
    && Number(receipt.pacer_burst_tokens)
      === CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens
    && Number(receipt.token_window_target)
      === CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow
    && Number(receipt.token_window_hard_limit)
      === CSM_PROVIDER_AUTHORITY_LIMITS.hardTokensPerWindow;
}

/**
 * Pre-spend proof for the durable provider boundary.
 *
 * The lookup probe proves the authority RPC family is live, while the pacer
 * probe validates the exact production limits installed on its global scope.
 * Both calls are read-only. Callers should cache only successful receipts.
 */
export async function checkCsmProviderAdmissionReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  scope,
  requestTimeoutMs = CSM_PROVIDER_AUTHORITY_RPC_TIMEOUT_MS,
  maximumDurationMs = CSM_PROVIDER_READINESS_BUDGET_MS,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== "function") return { ready: false, reason: "provider_authority_missing_fetch" };
  if (typeof now !== "function") return { ready: false, reason: "provider_authority_invalid_now" };

  let baseUrl;
  let key;
  let resolvedScope;
  try {
    baseUrl = text(env.SUPABASE_URL, "supabase_url").replace(/\/+$/, "");
    key = serviceKey(env);
    resolvedScope = normalizeScope(scope);
  } catch (error) {
    return { ready: false, reason: `provider_authority_unconfigured:${String(error?.message || error)}` };
  }

  const perRequestTimeoutMs = readinessTimeout(
    requestTimeoutMs,
    CSM_PROVIDER_AUTHORITY_RPC_TIMEOUT_MS,
    60_000
  );
  const totalBudgetMs = readinessTimeout(
    maximumDurationMs,
    CSM_PROVIDER_READINESS_BUDGET_MS,
    60_000
  );
  const deadlineMs = now() + totalBudgetMs;
  const headers = supabaseServiceHeaders(key, { "content-type": "application/json" });

  async function probe(name, body, phase) {
    const remainingMs = Math.floor(deadlineMs - now());
    if (remainingMs < 1) return { ok: false, reason: `${phase}_timeout` };
    let response;
    let raw;
    try {
      response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers,
        redirect: "error",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(perRequestTimeoutMs, remainingMs)))
      });
      raw = await response.text();
    } catch (error) {
      return {
        ok: false,
        reason: requestTimedOut(error)
          ? `${phase}_timeout`
          : `${phase}_failed:${String(error?.message || error).slice(0, 120)}`
      };
    }
    let result = null;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      return { ok: false, reason: `${phase}_invalid_response` };
    }
    return response.ok
      ? { ok: true, result }
      : { ok: false, reason: `${phase}_${response.status}` };
  }

  // These are independent, read-only proofs. Running them together removes
  // one Supabase round-trip from every cold instance/cache expiry without
  // weakening the fail-closed contract: all receipts still have to match
  // their exact production limits before a paid attempt is admitted.
  const [authority, operationKeyRecovery, pacer] = await Promise.all([
    probe(CSM_PROVIDER_AUTHORITY_RPCS.lookup, {
      p_tenant_id: "__csm_readiness__",
      p_operation_key: "__csm_readiness__",
      p_payload_sha256: CSM_PROVIDER_READINESS_LOOKUP_HASH
    }, "provider_authority_probe"),
    probe(CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey, {
      p_tenant_id: "__csm_readiness__",
      p_operation_key: "__csm_readiness__"
    }, "provider_operation_key_recovery_probe"),
    probe(CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness, {
      p_provider: resolvedScope.provider,
      p_account_scope: resolvedScope.accountScope,
      p_model: resolvedScope.model
    }, "provider_pacer_probe")
  ]);
  if (!authority.ok) return { ready: false, reason: authority.reason };
  if (authority.result?.ok !== true
      || authority.result?.code !== "not_found"
      || authority.result?.found !== false) {
    return { ready: false, reason: "provider_authority_probe_contract_mismatch" };
  }

  if (!operationKeyRecovery.ok) {
    return { ready: false, reason: operationKeyRecovery.reason };
  }
  const operationKeyRecoveryReceipt = operationKeyRecovery.result;
  if (operationKeyRecoveryReceipt?.ok !== true
      || operationKeyRecoveryReceipt?.code !== "not_found"
      || Number(operationKeyRecoveryReceipt?.status_code) !== 200
      || operationKeyRecoveryReceipt?.found !== false
      || Object.hasOwn(operationKeyRecoveryReceipt || {}, "payload_sha256")
      || Object.hasOwn(operationKeyRecoveryReceipt || {}, "result")) {
    return { ready: false, reason: "provider_operation_key_recovery_contract_mismatch" };
  }

  if (!pacer.ok) return { ready: false, reason: pacer.reason };
  const pacerReady = csmProviderPacerReadinessMatches(pacer.result);
  return pacerReady
    ? { ready: true, reason: null }
    : { ready: false, reason: "provider_pacer_probe_contract_mismatch" };
}

function providerErrorResult(error, ambiguous) {
  return {
    error_name: String(error?.name || "Error").slice(0, 80),
    error_code: String(error?.code || "PROVIDER_ATTEMPT_FAILED").slice(0, 120),
    status: statusOf(error),
    actual_tokens: actualTokens(error?.response || error),
    retry_after_ms: retryAfterMs(error),
    ambiguous,
    returned_http_response: error?.returned_http_response === true,
    response_body_complete: error?.response_body_complete === true,
    provider_output_present: error?.provider_output_present === true,
    provider_contract_failure: error?.provider_contract_failure === true,
    provider_business_failure: error?.provider_business_failure === true,
    definitive_response: error?.definitive_response === true,
    safe_to_retry: error?.safe_to_retry === true,
    provider_request_id: safeProviderReceiptText(error?.provider_request_id),
    provider_client_request_id: safeProviderReceiptText(error?.provider_client_request_id),
    provider_error_code: safeProviderReceiptText(error?.provider_error_code),
    provider_error_type: safeProviderReceiptText(error?.provider_error_type),
    provider_error_param: safeProviderReceiptText(error?.provider_error_param),
    provider_ms: finiteNonnegative(error?.provider_ms),
    failure_phase: error?.csm_persistence ? "CSM_PERSISTENCE" : "PROVIDER_OR_PRECONDITION",
    persistence_code: error?.csm_persistence?.code || null,
    persistence_error: error?.csm_persistence?.error
      ? String(error.csm_persistence.error).slice(0, 500)
      : null
  };
}

function safeProviderReceiptText(value) {
  const normalized = String(value || "").trim();
  return /^[a-zA-Z0-9._:\-/\[\]]{1,240}$/.test(normalized) ? normalized : null;
}

function finiteNonnegative(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function actualTokens(value) {
  for (const usage of [
    value?.usage,
    value?.provider_usage,
    value?.response?.usage,
    value?.meta?.usage
  ]) {
    const total = finiteNonnegative(usage?.total_tokens);
    if (total !== null) return total;
    const input = finiteNonnegative(usage?.input_tokens);
    const output = finiteNonnegative(usage?.output_tokens);
    if (input !== null || output !== null) return (input || 0) + (output || 0);
  }
  const directTotal = finiteNonnegative(value?.total_tokens);
  if (directTotal !== null) return directTotal;
  const input = finiteNonnegative(value?.input_tokens);
  const output = finiteNonnegative(value?.output_tokens);
  return input !== null || output !== null ? (input || 0) + (output || 0) : null;
}

function retryAfterMs(error) {
  const headers = error?.response?.headers || error?.headers;
  const raw = typeof headers?.get === "function"
    ? String(headers.get("retry-after") || "")
    : String(Object.entries(headers || {}).find(([name]) => (
      name.toLowerCase() === "retry-after"
    ))?.[1] || "");
  if (!raw.trim()) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function executionError(error, ambiguous) {
  const wrapped = new CsmProviderAdmissionError(
    String(error?.code || "CSM_PROVIDER_ATTEMPT_FAILED"),
    String(error?.message || "provider_attempt_failed"),
    {
      cause: error,
      status: statusOf(error),
      retryable: error?.retryable === true || statusOf(error) === 429,
      ambiguous,
      providerAttemptStarted: error?.provider_attempt_started !== false
    }
  );
  wrapped.response = error?.response;
  for (const name of [
    "provider_request_id",
    "provider_client_request_id",
    "provider_error_code",
    "provider_error_type",
    "provider_error_param",
    "provider_ms",
    "recognition_session_id"
  ]) {
    if (error?.[name] !== undefined) wrapped[name] = error[name];
  }
  for (const name of [
    "returned_http_response", "response_body_complete", "provider_output_present",
    "provider_contract_failure", "provider_business_failure",
    "definitive_response", "safe_to_retry"
  ]) {
    if (error?.[name] !== undefined) wrapped[name] = error[name] === true;
  }
  if (error?.latency_stages_ms && typeof error.latency_stages_ms === "object") {
    wrapped.latency_stages_ms = { ...error.latency_stages_ms };
  }
  return wrapped;
}

function authorityFailure(body, context, status = null, options = {}) {
  return new CsmProviderAdmissionError(
    String(body?.code || `CSM_PROVIDER_AUTHORITY_${context.toUpperCase()}_FAILED`),
    String(body?.message || body?.code || `${context}_failed`),
    {
      status: Number(body?.status_code) || status,
      retryable: options.retryable === true || Number(body?.status_code || status) >= 500,
      ambiguous: options.ambiguous === true,
      providerAttemptStarted: options.providerAttemptStarted
    }
  );
}

export function createCsmSupabaseProviderAdmissionAuthority({
  env = process.env,
  fetchImpl = globalThis.fetch,
  scope,
  workerId = `csm-thin-${randomUUID()}`,
  leaseSeconds = 180,
  maximumProviderDurationMs = 120_000,
  queueTtlSeconds = 300,
  claimPollMs = 250,
  claimTimeoutMs = 180_000,
  rpcTimeoutMs = CSM_PROVIDER_AUTHORITY_RPC_TIMEOUT_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = Date.now,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("missing_fetch");
  const resolvedScope = normalizeScope(scope);
  const resolvedWorkerId = text(workerId, "worker_id");
  const resolvedLeaseSeconds = positiveInteger(leaseSeconds, "lease_seconds", 300);
  if (resolvedLeaseSeconds < 5) throw new TypeError("invalid_lease_seconds");
  const providerDurationMs = positiveInteger(
    maximumProviderDurationMs,
    "maximum_provider_duration_ms",
    299_999
  );
  if (providerDurationMs >= resolvedLeaseSeconds * 1_000) {
    throw new TypeError("provider_duration_must_be_shorter_than_lease");
  }
  const resolvedQueueTtlSeconds = positiveInteger(queueTtlSeconds, "queue_ttl_seconds", 900);
  if (resolvedQueueTtlSeconds < 30) throw new TypeError("invalid_queue_ttl_seconds");
  const pollMs = positiveInteger(claimPollMs, "claim_poll_ms", 10_000);
  const timeoutMs = positiveInteger(claimTimeoutMs, "claim_timeout_ms");
  const resolvedRpcTimeoutMs = positiveInteger(rpcTimeoutMs, "rpc_timeout_ms", 60_000);
  if (typeof now !== "function") throw new TypeError("invalid_now");
  const baseUrl = text(env.SUPABASE_URL, "supabase_url").replace(/\/+$/, "");
  const key = serviceKey(env);

  async function rpc(name, body, {
    providerAttemptStarted = false,
    timeoutMs: requestTimeoutMs = resolvedRpcTimeoutMs
  } = {}) {
    const boundedTimeoutMs = Math.min(
      resolvedRpcTimeoutMs,
      positiveInteger(requestTimeoutMs, "rpc_request_timeout_ms", 60_000)
    );
    let response;
    let raw;
    try {
      response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: supabaseServiceHeaders(key, { "content-type": "application/json" }),
        redirect: "error",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(boundedTimeoutMs)
      });
      // Reading the receipt belongs to the same timeout boundary as receiving
      // its headers. A server that sends headers and stalls the body is still a
      // stalled authority call.
      raw = await response.text();
    } catch (error) {
      const timedOut = requestTimedOut(error);
      throw new CsmProviderAdmissionError(
        timedOut
          ? "CSM_PROVIDER_AUTHORITY_TIMEOUT"
          : "CSM_PROVIDER_AUTHORITY_TRANSPORT_FAILED",
        `${name}:${timedOut ? "timeout" : "transport_failed"}`,
        {
          cause: error,
          retryable: true,
          ambiguous: providerAttemptStarted,
          providerAttemptStarted
        }
      );
    }
    let result = null;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      throw authorityFailure(null, name, response.status, {
        retryable: true,
        ambiguous: providerAttemptStarted,
        providerAttemptStarted
      });
    }
    if (!response.ok || !result || result.ok !== true) {
      throw authorityFailure(result, name, response.status, {
        ambiguous: providerAttemptStarted && response.status >= 500,
        providerAttemptStarted
      });
    }
    return result;
  }

  async function enqueueAttempt(metadata) {
    const attempt = normalizeAttempt(metadata, resolvedScope);
    const enqueueStartedAt = now();
    const result = await rpc(CSM_PROVIDER_AUTHORITY_RPCS.enqueue, {
      p_tenant_id: attempt.tenantId,
      p_operation_key: attempt.operationKey,
      p_payload_sha256: attempt.payloadHash,
      p_provider: attempt.provider,
      p_account_scope: attempt.accountScope,
      p_model: attempt.model,
      p_attempt_no: attempt.attempt,
      p_attempt_class: attempt.attemptClass,
      p_estimated_tokens: attempt.estimatedTokens,
      p_tenant_weight: attempt.tenantWeight,
      p_not_before: attempt.notBefore,
      p_queue_owner: resolvedWorkerId,
      p_queue_ttl_seconds: resolvedQueueTtlSeconds
    });
    return Object.freeze({
      ...attempt,
      authorityEnqueueMs: Math.max(0, Math.round(now() - enqueueStartedAt)),
      replayed: result.replayed === true,
      operationStatus: String(result.operation_status || "QUEUED"),
      attemptState: String(result.attempt_state || "QUEUED"),
      queueOwner: String(result.queue_owner || resolvedWorkerId),
      latestAttempt: Number(result.latest_attempt_no) || attempt.attempt,
      latestAttemptState: String(result.latest_attempt_state || result.attempt_state || "QUEUED"),
      result: result.result
    });
  }

  async function claimAttempt(ticket, options = {}) {
    return rpc(CSM_PROVIDER_AUTHORITY_RPCS.claim, {
      p_provider: ticket.provider,
      p_account_scope: ticket.accountScope,
      p_model: ticket.model,
      p_tenant_id: ticket.tenantId,
      p_operation_key: ticket.operationKey,
      p_attempt_no: ticket.attempt,
      p_worker_id: resolvedWorkerId,
      p_lease_seconds: resolvedLeaseSeconds
    }, options);
  }

  async function heartbeatAttempt(lease) {
    return rpc(CSM_PROVIDER_AUTHORITY_RPCS.heartbeat, {
      p_tenant_id: lease.tenantId,
      p_operation_key: lease.operationKey,
      p_attempt_no: lease.attempt,
      p_worker_id: resolvedWorkerId,
      p_lease_fence: lease.leaseFence,
      p_lease_seconds: resolvedLeaseSeconds
    }, { providerAttemptStarted: true });
  }

  async function settleAttempt(lease, outcome, result, actualTokenCount = actualTokens(result)) {
    return rpc(CSM_PROVIDER_AUTHORITY_RPCS.settle, {
      p_provider: lease.provider,
      p_account_scope: lease.accountScope,
      p_model: lease.model,
      p_tenant_id: lease.tenantId,
      p_operation_key: lease.operationKey,
      p_attempt_no: lease.attempt,
      p_worker_id: resolvedWorkerId,
      p_lease_fence: lease.leaseFence,
      p_outcome: outcome,
      p_result: result ?? null,
      p_actual_tokens: actualTokenCount
    }, { providerAttemptStarted: true });
  }

  async function lookupOperationResult(input = {}, options = {}) {
    const payloadHash = text(
      input.payloadHash ?? input.payload_hash,
      "payload_hash"
    ).toLowerCase();
    const result = await rpc(CSM_PROVIDER_AUTHORITY_RPCS.lookup, {
      p_tenant_id: text(input.tenantId ?? input.tenant_id, "tenant_id"),
      p_operation_key: text(input.operationKey ?? input.operation_key, "operation_key"),
      p_payload_sha256: payloadHash
    }, options);
    if (result.found !== true) return { status: "not_found" };
    const status = String(result.operation_status || "").toUpperCase();
    const attempt = {
      latestAttempt: Number(result.latest_attempt_no) || 0,
      latestAttemptState: String(result.latest_attempt_state || "")
    };
    if (status === "SUCCEEDED") return { status: "found", result: result.result, ...attempt };
    if (status === "FAILED") return { status: "failed", result: result.result, ...attempt };
    if (["AMBIGUOUS", "CANCEL_REQUESTED"].includes(status)) {
      return { status: "ambiguous", operationStatus: status, ...attempt };
    }
    if (status === "CANCELLED") return { status: "cancelled", operationStatus: status, ...attempt };
    return { status: "pending", operationStatus: status, ...attempt };
  }

  async function lookupOperationResultByKey(input = {}, options = {}) {
    const result = await rpc(CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey, {
      p_tenant_id: text(input.tenantId ?? input.tenant_id, "tenant_id"),
      p_operation_key: text(input.operationKey ?? input.operation_key, "operation_key")
    }, options);
    if (result.found !== true) {
      if (result.code !== "not_found"
          || Object.hasOwn(result, "payload_sha256")
          || Object.hasOwn(result, "result")) {
        throw authorityFailure(
          { code: "operation_key_lookup_contract_mismatch", status_code: 409 },
          "lookup_by_key",
          409,
          { providerAttemptStarted: false }
        );
      }
      return { status: "not_found" };
    }

    const status = String(result.operation_status || "").toUpperCase();
    const attempt = {
      latestAttempt: Number(result.latest_attempt_no) || 0,
      latestAttemptState: String(result.latest_attempt_state || "")
    };
    if (status === "SUCCEEDED") {
      const payloadHash = String(result.payload_sha256 || "").toLowerCase();
      if (result.code !== "found_succeeded"
          || !/^[0-9a-f]{64}$/.test(payloadHash)
          || !result.result
          || typeof result.result !== "object"
          || Array.isArray(result.result)) {
        throw authorityFailure(
          { code: "operation_key_success_contract_mismatch", status_code: 409 },
          "lookup_by_key",
          409,
          { providerAttemptStarted: false }
        );
      }
      return {
        status: "found",
        payloadHash,
        result: result.result,
        ...attempt
      };
    }

    if (result.code !== "found_non_success"
        || Object.hasOwn(result, "payload_sha256")
        || Object.hasOwn(result, "result")) {
      throw authorityFailure(
        { code: "operation_key_non_success_contract_mismatch", status_code: 409 },
        "lookup_by_key",
        409,
        { providerAttemptStarted: false }
      );
    }
    if (status === "FAILED") return { status: "failed", ...attempt };
    if (["AMBIGUOUS", "CANCEL_REQUESTED"].includes(status)) {
      return { status: "ambiguous", operationStatus: status, ...attempt };
    }
    if (status === "CANCELLED") {
      return { status: "cancelled", operationStatus: status, ...attempt };
    }
    if (["QUEUED", "RUNNING"].includes(status)) {
      return { status: "pending", operationStatus: status, ...attempt };
    }
    throw authorityFailure(
      { code: "operation_key_status_invalid", status_code: 409 },
      "lookup_by_key",
      409,
      { providerAttemptStarted: false }
    );
  }

  async function cancelOperation(input = {}, options = {}) {
    return rpc(CSM_PROVIDER_AUTHORITY_RPCS.cancel, {
      p_provider: resolvedScope.provider,
      p_account_scope: resolvedScope.accountScope,
      p_model: resolvedScope.model,
      p_tenant_id: text(input.tenantId ?? input.tenant_id, "tenant_id"),
      p_operation_key: text(input.operationKey ?? input.operation_key, "operation_key"),
      p_payload_sha256: text(input.payloadHash ?? input.payload_hash, "payload_hash")
    }, options);
  }

  async function resolveReplay(ticket, options = {}) {
    const replay = await lookupOperationResult(ticket, options);
    if (replay.status === "found") return { replayResult: replay.result };
    if (replay.status === "pending") return null;
    const details = {
      latestAttempt: replay.latestAttempt || ticket.attempt,
      latestAttemptState: replay.latestAttemptState || ticket.attemptState
    };
    if (replay.status === "failed") {
      const error = authorityFailure(
        { code: "operation_previous_attempt_failed", status_code: 409 },
        "claim",
        409,
        { providerAttemptStarted: false }
      );
      Object.assign(error, details, { previous_result: replay.result });
      throw error;
    }
    if (replay.status === "cancelled") {
      const error = authorityFailure(
        { code: "operation_cancelled", status_code: 409 },
        "claim",
        409,
        { providerAttemptStarted: false }
      );
      Object.assign(error, details);
      throw error;
    }
    throw Object.assign(authorityFailure(
      {
        code: replay.status === "ambiguous"
          ? "operation_result_ambiguous"
          : "operation_replay_lookup_lost",
        status_code: 409
      },
      "claim",
      409,
      {
        ambiguous: replay.status === "ambiguous",
        providerAttemptStarted: false
      }
    ), details);
  }

  async function waitForLease(ticket) {
    const deadlineMs = now() + timeoutMs;
    const remainingMs = () => Math.max(0, deadlineMs - now());
    while (remainingMs() > 0) {
      let claim;
      try {
        claim = await claimAttempt(ticket, {
          timeoutMs: Math.max(1, Math.min(resolvedRpcTimeoutMs, remainingMs()))
        });
      } catch (error) {
        if (error?.provider_attempt_started === false && error?.retryable === true) {
          const delayMs = Math.min(pollMs, remainingMs());
          if (delayMs > 0) await sleep(delayMs);
          continue;
        }
        if (!ticket.replayed) throw error;
        const replayTimeoutMs = remainingMs();
        if (replayTimeoutMs <= 0) break;
        const replay = await resolveReplay(ticket, {
          timeoutMs: Math.max(1, Math.min(resolvedRpcTimeoutMs, replayTimeoutMs))
        });
        if (replay) return replay;
        const delayMs = Math.min(pollMs, remainingMs());
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }
      if (claim.admitted === true) {
        let claimCode;
        let claimAttempt;
        let claimAttemptClass;
        let claimEstimatedTokens;
        try {
          claimCode = text(claim.code, "claim_code");
          claimAttempt = positiveInteger(claim.attempt, "claim_attempt");
          claimAttemptClass = text(claim.attempt_class, "claim_attempt_class").toLowerCase();
          claimEstimatedTokens = positiveInteger(
            claim.estimated_tokens,
            "claim_estimated_tokens",
            CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
          );
        } catch {
          throw authorityFailure(
            { code: "claim_receipt_contract_mismatch", status_code: 409 },
            "claim",
            409,
            { providerAttemptStarted: false }
          );
        }
        const replayedClaim = claimCode === "claim_receipt_replayed";
        if (!new Set(["admitted", "claim_receipt_replayed"]).has(claimCode)
            || claim.tenant_id !== ticket.tenantId
            || claim.operation_key !== ticket.operationKey
            || claimAttempt !== ticket.attempt
            || claimAttemptClass !== ticket.attemptClass
            || claimEstimatedTokens !== ticket.estimatedTokens
            || claim.worker_id !== resolvedWorkerId
            || (replayedClaim ? claim.replayed !== true : claim.replayed === true)) {
          throw authorityFailure(
            { code: "claim_receipt_contract_mismatch", status_code: 409 },
            "claim",
            409,
            { providerAttemptStarted: false }
          );
        }
        return Object.freeze({
          ...ticket,
          workerId: resolvedWorkerId,
          leaseFence: positiveInteger(claim.lease_fence, "lease_fence"),
          leaseExpiresAt: text(claim.lease_expires_at, "lease_expires_at"),
          authorityClaim: Object.freeze({
            operationKey: claim.operation_key,
            attempt: claimAttempt,
            attemptClass: claimAttemptClass,
            estimatedTokens: claimEstimatedTokens,
            claimCode
          })
        });
      }
      if (ticket.replayed) {
        const replayTimeoutMs = remainingMs();
        if (replayTimeoutMs <= 0) break;
        const replay = await resolveReplay(ticket, {
          timeoutMs: Math.max(1, Math.min(resolvedRpcTimeoutMs, replayTimeoutMs))
        });
        if (replay) return replay;
      }
      const delayMs = Math.min(
        Math.max(pollMs, Number(claim.retry_after_ms) || 0),
        remainingMs()
      );
      if (delayMs > 0) await sleep(delayMs);
    }
    try {
      // Cancellation is cleanup after the queue deadline, not an extension of
      // that deadline. Bound it tightly; the queue-owner TTL remains the
      // crash-safe fallback if this receipt is unavailable.
      await cancelOperation(ticket, {
        timeoutMs: Math.min(resolvedRpcTimeoutMs, 1_000)
      });
    } catch {
      // The database queue-owner TTL remains the crash-safe cleanup path.
    }
    throw new CsmProviderAdmissionError(
      "CSM_PROVIDER_CLAIM_TIMEOUT",
      "provider_attempt_remains_durably_queued",
      { retryable: true, providerAttemptStarted: false }
    );
  }

  async function runAttempt({ queuedAttempt, execute } = {}) {
    if (typeof execute !== "function") throw new TypeError("missing_execute");
    const ticket = await queuedAttempt;
    if (ticket.operationStatus === "SUCCEEDED") return ticket.result;
    if (ticket.operationStatus === "FAILED") {
      const error = authorityFailure(
        { code: "operation_previous_attempt_failed", status_code: 409 },
        "run",
        409,
        { providerAttemptStarted: false }
      );
      error.previous_result = ticket.result;
      error.latest_attempt = ticket.attempt;
      error.latestAttempt = ticket.latestAttempt;
      error.latestAttemptState = ticket.latestAttemptState;
      throw error;
    }
    if (["AMBIGUOUS", "CANCEL_REQUESTED", "CANCELLED"].includes(ticket.operationStatus)) {
      throw authorityFailure(
        { code: "operation_not_executable", status_code: 409 },
        "run",
        409,
        { ambiguous: ticket.operationStatus === "AMBIGUOUS", providerAttemptStarted: false }
      );
    }

    // Keep the global-dispatch receipt useful for production diagnosis.  The
    // route already records the whole authority dispatch wall; these two
    // additive fields separate scheduler claim wait from the final durable
    // settle RPC, so a future concurrency change can be judged against the
    // actual bottleneck rather than an inferred one.
    const claimStartedAt = now();
    const lease = await waitForLease(ticket);
    const authorityClaimMs = Math.max(0, Math.round(now() - claimStartedAt));
    if (Object.hasOwn(lease, "replayResult")) return lease.replayResult;

    let heartbeatError = null;
    let heartbeatBusy = false;
    const heartbeatTimer = setIntervalImpl(async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        await heartbeatAttempt(lease);
      } catch (error) {
        heartbeatError = error;
      } finally {
        heartbeatBusy = false;
      }
    }, Math.max(1_000, Math.floor(resolvedLeaseSeconds * 1_000 / 3)));
    heartbeatTimer?.unref?.();

    try {
      let result;
      try {
        result = await execute();
      } catch (error) {
        const ambiguous = providerFailureIsAmbiguous(error);
        let failureResult = null;
        let failureSettlement = null;
        try {
          failureResult = providerErrorResult(error, ambiguous);
          failureSettlement = await settleAttempt(
            lease,
            statusOf(error) === 429 ? "RATE_LIMITED" : ambiguous ? "AMBIGUOUS" : "FAILED",
            failureResult,
            failureResult.actual_tokens
          );
        } catch (settleError) {
          throw new CsmProviderAdmissionError(
            "CSM_PROVIDER_SETTLE_UNCERTAIN",
            "provider_attempt_finished_but_settle_is_uncertain",
            {
              cause: settleError,
              retryable: false,
              ambiguous: true,
              providerAttemptStarted: true
            }
          );
        }
        const wrapped = executionError(error, ambiguous);
        wrapped.provider_failure_result = failureResult;
        wrapped.provider_failure_settlement = Object.freeze({
          operation_key_sha256: sha256(ticket.operationKey),
          payload_sha256: ticket.payloadHash,
          attempt: lease.authorityClaim.attempt,
          attempt_class: lease.authorityClaim.attemptClass,
          estimated_tokens: lease.authorityClaim.estimatedTokens,
          settle_code: String(failureSettlement?.code || ""),
          operation_status: String(failureSettlement?.operation_status || "").toUpperCase()
        });
        throw wrapped;
      }

      let authoritySettleMs = null;
      let settlement = null;
      try {
        const settleStartedAt = now();
        settlement = await settleAttempt(lease, "SUCCEEDED", result);
        authoritySettleMs = Math.max(0, Math.round(now() - settleStartedAt));
        if (!["settled", "exact_replay"].includes(String(settlement?.code || ""))
            || String(settlement?.operation_status || "").toUpperCase() !== "SUCCEEDED") {
          throw new TypeError("successful_settle_receipt_contract_mismatch");
        }
      } catch (settleError) {
        throw new CsmProviderAdmissionError(
          "CSM_PROVIDER_SETTLE_UNCERTAIN",
          "provider_attempt_finished_but_settle_is_uncertain",
          {
            cause: settleError,
            retryable: false,
            ambiguous: true,
            providerAttemptStarted: true
          }
        );
      }
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const providerAuthorityReceipt = validateCsmProviderAuthorityReceipt({
          schema_version: CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION,
          operation_key_sha256: sha256(lease.authorityClaim.operationKey),
          attempt: lease.authorityClaim.attempt,
          attempt_class: lease.authorityClaim.attemptClass,
          // This value is the selected database row returned by claim, not the
          // request profile value used to enqueue it.
          estimated_tokens: lease.authorityClaim.estimatedTokens,
          claim_code: lease.authorityClaim.claimCode,
          settle_code: settlement.code,
          operation_status: String(settlement.operation_status).toUpperCase()
        }, {
          operationKey: ticket.operationKey,
          attempt: ticket.attempt
        });
        return {
          ...result,
          provider_authority_receipt: providerAuthorityReceipt,
          latency_stages_ms: {
            ...(result.latency_stages_ms && typeof result.latency_stages_ms === "object"
              ? result.latency_stages_ms
            : {}),
            authority_claim_ms: authorityClaimMs,
            ...(authoritySettleMs === null ? {} : { authority_settle_ms: authoritySettleMs }),
            authority_enqueue_ms: Number.isFinite(Number(ticket.authorityEnqueueMs))
              ? Math.max(0, Math.round(Number(ticket.authorityEnqueueMs)))
              : 0
          }
        };
      }
      return result;
    } finally {
      clearIntervalImpl(heartbeatTimer);
      if (heartbeatError?.code === "lease_lost") {
        // The settle fence above remains authoritative.  This local signal is
        // intentionally not allowed to manufacture a second provider call.
      }
    }
  }

  return Object.freeze({
    globallyEnforced: true,
    scope: resolvedScope,
    limits: CSM_PROVIDER_AUTHORITY_LIMITS,
    enqueueAttempt,
    claimAttempt,
    heartbeatAttempt,
    settleAttempt,
    lookupOperationResult,
    lookupOperationResultByKey,
    cancelOperation,
    runAttempt
  });
}
