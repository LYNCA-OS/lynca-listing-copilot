import { createHash } from "node:crypto";

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const AMBIGUOUS_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET"
]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EAI_AGAIN"
]);
const AMBIGUOUS_LOOKUP_RETRY_DELAYS_MS = Object.freeze([150, 450]);
export const LUNA_DEFINITIVE_502_TRANSPORT_RETRY_RECEIPT_VERSION =
  "luna-definitive-502-transport-retry-receipt-v1";
export const LUNA_DEFINITIVE_502_TRANSPORT_RETRY_POLICY =
  "definitive-complete-http-502-no-output-no-token-v1";
export const LUNA_DEFINITIVE_502_TRANSPORT_RETRY_ELAPSED_LIMIT_MS = 15_000;

// Durable namespace salt for the ordinary production lane. These are the
// exact values used by the already-deployed v2 key. They deliberately do not
// follow the active model profile: execution changes belong in payload
// identity, while one tenant/intent/asset must keep one paid-operation key.
const ORDINARY_V2_OPERATION_NAMESPACE = Object.freeze({
  model: "gpt-5.6-luna",
  detail: "high",
  prompt_version: "csm-canonical-fields-v1"
});
const ORDINARY_EXECUTION_PAYLOAD_CONTRACT = "ordinary-execution-bound-v1";
const ORDINARY_EXECUTION_RESOLUTION_ORIGINAL_SET_PAYLOAD_CONTRACT =
  "ordinary-execution-resolution-original-set-bound-v3";
const ORDINARY_LEGACY_REASONING_EFFORT = "low";
// Staged recognition has not shipped before this contract. Freeze its logical
// user-operation namespace now: model detail and transport lane are execution
// choices and must only change payload identity, never create a second paid
// operation for the same intent and exact originals.
const DERIVED_USER_OPERATION_NAMESPACE = "derived-checkpoint-user-operation-v1";

export class LunaDirectDispatchError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "LunaDirectDispatchError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.ambiguous = options.ambiguous === true;
    this.status = Number.isFinite(options.status) ? options.status : null;
  }
}

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_TASK_INVALID",
      `missing_${name}`
    );
  }
  return text;
}

function requiredSha256(value, name) {
  const digest = requiredText(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_TASK_INVALID",
      `invalid_${name}`
    );
  }
  return digest;
}

function requiredFingerprints(value, name) {
  const fingerprints = Array.from(value || [], (entry) => String(entry).toLowerCase());
  if (!fingerprints.length
      || fingerprints.some((entry) => !/^sha256:[0-9a-f]{64}$/.test(entry))) {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_TASK_INVALID",
      `invalid_${name}`
    );
  }
  return fingerprints;
}

function normalizeTask(input = {}) {
  const operationScope = String(input.operation_scope || "").trim();
  const resolutionContractSha256 = input.resolution_contract_sha256 == null
    ? null
    : requiredSha256(input.resolution_contract_sha256, "resolution_contract_sha256");
  const originalSetSha256 = input.original_set_sha256 == null
    ? null
    : requiredSha256(input.original_set_sha256, "original_set_sha256");
  if (originalSetSha256 && !resolutionContractSha256) {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_TASK_INVALID",
      "original_set_sha256_requires_resolution_contract"
    );
  }
  return {
    ...input,
    ...(operationScope ? { operation_scope: operationScope } : {}),
    tenant_id: requiredText(input.tenant_id, "tenant_id"),
    intent_id: requiredText(input.intent_id, "intent_id"),
    asset_id: requiredText(input.asset_id, "asset_id"),
    model: requiredText(input.model, "model"),
    detail: requiredText(input.detail, "detail").toLowerCase(),
    reasoning_effort: requiredText(
      input.reasoning_effort ?? input.effort,
      "reasoning_effort"
    ).toLowerCase(),
    prompt_version: requiredText(input.prompt_version, "prompt_version"),
    execution_contract_sha256: requiredSha256(
      input.execution_contract_sha256,
      "execution_contract_sha256"
    ),
    resolution_contract_sha256: resolutionContractSha256,
    original_set_sha256: originalSetSha256,
    recognition_fingerprints: requiredFingerprints(
      input.recognition_fingerprints,
      "recognition_fingerprints"
    ),
    estimated_tokens: (() => {
      const value = Number(input.estimated_tokens);
      if (!Number.isInteger(value) || value < 1) {
        throw new LunaDirectDispatchError(
          "LUNA_DIRECT_TASK_INVALID",
          "invalid_estimated_tokens"
        );
      }
      return value;
    })()
  };
}

function operationIdentity(task) {
  if (task.operation_scope === "derived_checkpoint") {
    const manifest = requiredText(task.original_manifest_sha256, "original_manifest_sha256").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(manifest)) {
      throw new LunaDirectDispatchError("LUNA_DIRECT_TASK_INVALID", "invalid_original_manifest_sha256");
    }
    return [
      ["operation_namespace", DERIVED_USER_OPERATION_NAMESPACE],
      ["tenant_id", task.tenant_id],
      ["intent_id", task.intent_id],
      ["asset_id", task.asset_id],
      ["image_fingerprints", Array.from(task.image_fingerprints || [], String)],
      ["original_manifest_sha256", manifest]
    ];
  }
  return [
    ["tenant_id", task.tenant_id],
    ["intent_id", task.intent_id],
    ["asset_id", task.asset_id],
    ["model", ORDINARY_V2_OPERATION_NAMESPACE.model],
    ["detail", ORDINARY_V2_OPERATION_NAMESPACE.detail],
    ["prompt_version", ORDINARY_V2_OPERATION_NAMESPACE.prompt_version]
  ];
}

export function buildLunaDirectOperationKey(input) {
  const task = normalizeTask(input);
  const digest = createHash("sha256")
    .update(JSON.stringify(operationIdentity(task)))
    .digest("hex");
  return `luna-direct:v2:${digest}`;
}

export function buildLunaDirectPayloadHash(input) {
  const task = normalizeTask(input);
  if (task.operation_scope === "derived_checkpoint") {
    return createHash("sha256")
      .update(JSON.stringify([
        ...operationIdentity(task),
        ["checkpoint_payload_contract", task.resolution_contract_sha256
          ? "derived-checkpoint-execution-resolution-original-set-bound-v3"
          : "derived-checkpoint-execution-bound-v1"],
        ["detail", task.detail],
        ["lane_version", requiredText(task.lane_version, "lane_version")],
        ["execution_contract_sha256", task.execution_contract_sha256],
        ...(task.resolution_contract_sha256
          ? [
              ["resolution_contract_sha256", task.resolution_contract_sha256],
              ["original_set_sha256", task.original_set_sha256]
            ]
          : []),
        ["recognition_fingerprints", task.recognition_fingerprints]
      ]))
      .digest("hex");
  }
  return createHash("sha256")
    .update(JSON.stringify([
      ...operationIdentity(task),
      ["payload_contract", task.resolution_contract_sha256
        ? ORDINARY_EXECUTION_RESOLUTION_ORIGINAL_SET_PAYLOAD_CONTRACT
        : ORDINARY_EXECUTION_PAYLOAD_CONTRACT],
      ["execution_contract_sha256", task.execution_contract_sha256],
      ...(task.resolution_contract_sha256
        ? [
            ["resolution_contract_sha256", task.resolution_contract_sha256],
            ["original_set_sha256", task.original_set_sha256]
          ]
        : []),
      ["recognition_fingerprints", task.recognition_fingerprints]
    ]))
    .digest("hex");
}

// Exact payload identity used by the release immediately before the complete
// execution digest. The effort is a historical constant, not today's active
// profile, so a future profile can still recover an already-paid v2 result.
export function buildLegacyCurrentLunaDirectPayloadHash(input) {
  const task = normalizeTask(input);
  if (task.operation_scope === "derived_checkpoint") {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_LEGACY_PAYLOAD_INELIGIBLE",
      "legacy_payload_recovery_requires_ordinary_operation"
    );
  }
  const stableImages = Array.from(task.image_fingerprints || [], (value) => String(value));
  const imageIdentity = stableImages.length > 0
    ? stableImages
    : Array.from(task.image_urls || [], (value) => String(value));
  return createHash("sha256")
    .update(JSON.stringify([
      ...operationIdentity(task),
      ["reasoning_effort", ORDINARY_LEGACY_REASONING_EFFORT],
      ["image_identity", imageIdentity]
    ]))
    .digest("hex");
}

// Compatibility receipt for checkpoints written before reasoning effort was
// added to payload identity. It intentionally uses the frozen historical
// namespace even when today's task runs another profile.
export function buildLegacyLowLunaDirectPayloadHash(input) {
  const task = normalizeTask(input);
  if (task.operation_scope === "derived_checkpoint") {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_LEGACY_PAYLOAD_INELIGIBLE",
      "legacy_payload_recovery_requires_ordinary_operation"
    );
  }
  const stableImages = Array.from(task.image_fingerprints || [], (value) => String(value));
  const imageIdentity = stableImages.length > 0
    ? stableImages
    : Array.from(task.image_urls || [], (value) => String(value));
  return createHash("sha256")
    .update(JSON.stringify([
      ...operationIdentity(task),
      ["image_identity", imageIdentity]
    ]))
    .digest("hex");
}

function assetIdentity(task) {
  return JSON.stringify([task.tenant_id, task.intent_id, task.asset_id]);
}

function numericStatus(error) {
  for (const value of [error?.status, error?.statusCode, error?.response?.status]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function errorCode(error) {
  return String(error?.code || error?.cause?.code || "").trim().toUpperCase();
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

function nullableSafeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return /^[a-zA-Z0-9._:\-/\[\]]{1,240}$/.test(text) ? text : null;
}

function providerClientRequestId(operationKey, payloadHash, attempt) {
  return `lynca-${createHash("sha256")
    .update(`${operationKey}\u0000${payloadHash}\u0000${attempt}`)
    .digest("hex")}`;
}

export function definitive502TransportRetryEligible(error, {
  failedAttempt = 1,
  maximumAttempts = 2,
  operationKey = null,
  payloadHash = null,
  estimatedTokens = null,
  elapsedMs = 0
} = {}) {
  const failure = error?.provider_failure_result;
  const settlement = error?.provider_failure_settlement;
  const firstClientRequestId = nullableSafeText(failure?.provider_client_request_id);
  return Number(failedAttempt) === 1
    && Number(maximumAttempts) === 2
    && Number.isFinite(Number(elapsedMs))
    && Number(elapsedMs) >= 0
    && Number(elapsedMs) <= LUNA_DEFINITIVE_502_TRANSPORT_RETRY_ELAPSED_LIMIT_MS
    && error?.provider_attempt_started === true
    && error?.ambiguous === false
    && numericStatus(error) === 502
    && error?.returned_http_response === true
    && error?.response_body_complete === true
    && error?.provider_output_present === false
    && error?.provider_contract_failure === false
    && error?.provider_business_failure === false
    && error?.definitive_response === true
    && error?.safe_to_retry === true
    && failure?.error_name === "CanonicalProviderError"
    && Number(failure?.status) === 502
    && failure?.actual_tokens === null
    && failure?.ambiguous === false
    && failure?.returned_http_response === true
    && failure?.response_body_complete === true
    && failure?.provider_output_present === false
    && failure?.provider_contract_failure === false
    && failure?.provider_business_failure === false
    && failure?.definitive_response === true
    && failure?.safe_to_retry === true
    && firstClientRequestId !== null
    && (operationKey === null || payloadHash === null
      || firstClientRequestId === providerClientRequestId(operationKey, payloadHash, 1))
    && Number(settlement?.attempt) === 1
    && settlement?.attempt_class === "fresh"
    && /^[0-9a-f]{64}$/.test(String(settlement?.operation_key_sha256 || ""))
    && /^[0-9a-f]{64}$/.test(String(settlement?.payload_sha256 || ""))
    && Number.isInteger(Number(settlement?.estimated_tokens))
    && Number(settlement.estimated_tokens) > 0
    && (operationKey === null || settlement.operation_key_sha256
      === createHash("sha256").update(String(operationKey)).digest("hex"))
    && (payloadHash === null || settlement.payload_sha256 === String(payloadHash))
    && (estimatedTokens === null
      || Number(settlement.estimated_tokens) === Number(estimatedTokens))
    && ["settled", "exact_replay"].includes(settlement?.settle_code)
    && settlement?.operation_status === "FAILED";
}

function buildDefinitive502TransportRetryReceipt(record, error) {
  if (!definitive502TransportRetryEligible(error, {
    failedAttempt: record.attempts,
    maximumAttempts: 2,
    operationKey: record.operationKey,
    payloadHash: record.payloadHash,
    estimatedTokens: record.task.estimated_tokens,
    elapsedMs: record.retryElapsedMs
  })) {
    throw new LunaDirectDispatchError(
      "LUNA_DIRECT_TRANSPORT_RETRY_INELIGIBLE",
      "definitive_502_transport_retry_ineligible"
    );
  }
  const failure = error.provider_failure_result;
  const settlement = error.provider_failure_settlement;
  const body = {
    schema_version: LUNA_DEFINITIVE_502_TRANSPORT_RETRY_RECEIPT_VERSION,
    operation_key_sha256: createHash("sha256").update(record.operationKey).digest("hex"),
    payload_sha256: record.payloadHash,
    provider: record.task.provider || "openai",
    model: record.task.model,
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
    provider_request_id: nullableSafeText(failure.provider_request_id),
    provider_client_request_id: nullableSafeText(failure.provider_client_request_id),
    retry_provider_client_request_id: providerClientRequestId(
      record.operationKey,
      record.payloadHash,
      2
    ),
    provider_error_code: nullableSafeText(failure.provider_error_code),
    provider_error_type: nullableSafeText(failure.provider_error_type),
    provider_error_param: nullableSafeText(failure.provider_error_param),
    provider_ms: failure.provider_ms !== null
      && Number.isFinite(Number(failure.provider_ms))
      ? Math.max(0, Math.round(Number(failure.provider_ms)))
      : null,
    settle_code: settlement.settle_code,
    operation_status: "FAILED",
    retry_attempt: 2,
    retry_attempt_class: "retry"
  };
  return Object.freeze({
    ...body,
    receipt_sha256: createHash("sha256").update(stableJson(body)).digest("hex")
  });
}

export function validateDefinitive502TransportRetryReceipt(value, {
  operationKey = null,
  payloadHash = null
} = {}) {
  const expectedKeys = [
    "schema_version", "operation_key_sha256", "payload_sha256", "provider", "model",
    "failed_attempt", "failed_attempt_class", "http_status", "ambiguous",
    "returned_http_response", "response_body_complete", "provider_output_present",
    "provider_contract_failure", "provider_business_failure", "actual_tokens",
    "provider_request_id",
    "provider_client_request_id", "provider_error_code", "provider_error_type",
    "provider_error_param", "retry_provider_client_request_id", "provider_ms",
    "settle_code", "operation_status",
    "retry_attempt", "retry_attempt_class", "receipt_sha256"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\u0000") !== expectedKeys.sort().join("\u0000")) {
    throw new TypeError("invalid_definitive_502_transport_retry_receipt_shape");
  }
  const { receipt_sha256: receiptSha256, ...body } = value;
  const validNullableText = (entry) => entry === null || nullableSafeText(entry) === entry;
  if (value.schema_version !== LUNA_DEFINITIVE_502_TRANSPORT_RETRY_RECEIPT_VERSION
      || !/^[0-9a-f]{64}$/.test(value.operation_key_sha256)
      || !/^[0-9a-f]{64}$/.test(value.payload_sha256)
      || !String(value.provider || "").trim()
      || !String(value.model || "").trim()
      || value.failed_attempt !== 1
      || value.failed_attempt_class !== "fresh"
      || value.http_status !== 502
      || value.ambiguous !== false
      || value.returned_http_response !== true
      || value.response_body_complete !== true
      || value.provider_output_present !== false
      || value.provider_contract_failure !== false
      || value.provider_business_failure !== false
      || value.actual_tokens !== null
      || nullableSafeText(value.provider_client_request_id)
        !== value.provider_client_request_id
      || nullableSafeText(value.retry_provider_client_request_id)
        !== value.retry_provider_client_request_id
      || value.provider_client_request_id === value.retry_provider_client_request_id
      || ![value.provider_request_id, value.provider_error_code, value.provider_error_type,
        value.provider_error_param].every(validNullableText)
      || !(value.provider_ms === null
        || (Number.isInteger(value.provider_ms) && value.provider_ms >= 0))
      || !["settled", "exact_replay"].includes(value.settle_code)
      || value.operation_status !== "FAILED"
      || value.retry_attempt !== 2
      || value.retry_attempt_class !== "retry"
      || receiptSha256 !== createHash("sha256").update(stableJson(body)).digest("hex")
      || (operationKey !== null
        && value.operation_key_sha256
          !== createHash("sha256").update(String(operationKey)).digest("hex"))
      || (payloadHash !== null && value.payload_sha256 !== String(payloadHash))
      || (operationKey !== null && payloadHash !== null
        && (value.provider_client_request_id
          !== providerClientRequestId(String(operationKey), String(payloadHash), 1)
          || value.retry_provider_client_request_id
            !== providerClientRequestId(String(operationKey), String(payloadHash), 2)))) {
    throw new TypeError("invalid_definitive_502_transport_retry_receipt_contract");
  }
  return Object.freeze(structuredClone(value));
}

export function classifyLunaDirectFailure(error) {
  const status = numericStatus(error);
  if (status !== null) {
    const explicitlySafe = error?.safe_to_retry === true
      || headerValue(error?.response?.headers || error?.headers, "x-lynca-retry-safe").toLowerCase() === "true";
    const explicitlyDefinitive = error?.definitive_response === true;
    const explicitlyClassified = error?.ambiguous === false
      && (error?.retryable === false || explicitlyDefinitive);
    return {
      retryable: error?.retryable === true
        || (TRANSIENT_HTTP_STATUSES.has(status) && !explicitlyDefinitive),
      ambiguous: [502, 503, 504].includes(status)
        && !explicitlySafe && !explicitlyDefinitive && !explicitlyClassified,
      kind: "http",
      status
    };
  }

  const code = errorCode(error);
  const message = String(error?.message || "");
  const ambiguous = error?.ambiguous === true
    || error?.timeout === true
    || AMBIGUOUS_NETWORK_CODES.has(code)
    || /(?:timed?\s*out|timeout)/i.test(message);
  if (ambiguous) {
    return { retryable: true, ambiguous: true, kind: "network", status: null };
  }

  const network = error?.before_request === true
    || TRANSIENT_NETWORK_CODES.has(code)
    || (error?.name === "TypeError" && /(?:fetch failed|failed to fetch|networkerror|network request failed)/i.test(message));
  const unknownFetchBoundary = error?.name === "TypeError"
    && /(?:fetch failed|failed to fetch|networkerror|network request failed)/i.test(message)
    && error?.before_request !== true;
  return {
    retryable: network,
    ambiguous: unknownFetchBoundary,
    kind: network ? "network" : "terminal",
    status: null
  };
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(match?.[1] || "");
}

export function retryAfterMs(error, { nowMs = Date.now(), maxDelayMs = 30_000 } = {}) {
  const headers = error?.response?.headers || error?.headers;
  const raw = headerValue(headers, "retry-after").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  const parsed = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(raw) - nowMs;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(maxDelayMs, Math.max(0, Math.ceil(parsed)));
}

export function lunaRetryDelayMs({
  error,
  failedAttempt,
  baseDelayMs = 250,
  maxDelayMs = 30_000,
  jitterRatio = 0.2,
  random = Math.random,
  nowMs = Date.now()
} = {}) {
  const attempt = Math.max(1, Number(failedAttempt) || 1);
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
  const retryAfter = retryAfterMs(error, { nowMs, maxDelayMs });
  const floor = Math.max(exponential, retryAfter ?? 0);
  const jitter = floor * Math.max(0, jitterRatio) * Math.max(0, Math.min(1, random()));
  return Math.min(maxDelayMs, Math.round(floor + jitter));
}

function httpFailure(response) {
  return new LunaDirectDispatchError(
    "LUNA_DIRECT_HTTP_FAILED",
    `luna_direct_http_${response.status}`,
    { status: Number(response.status), retryable: TRANSIENT_HTTP_STATUSES.has(Number(response.status)) }
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function lookupUnavailable(cause) {
  return new LunaDirectDispatchError(
    "LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE",
    "ambiguous_result_lookup_unavailable",
    { cause, retryable: false, ambiguous: true }
  );
}

export function createLunaDirectDispatcher({
  executeTask,
  providerAdmission,
  lookupOperationResult,
  csmDirectConcurrency,
  maxAttempts = 3,
  retryPolicy = null,
  baseDelayMs = 250,
  maxDelayMs = 30_000,
  jitterRatio = 0.2,
  random = Math.random,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = Date.now
} = {}) {
  if (typeof executeTask !== "function") throw new TypeError("missing_execute_task");
  if (!Number.isInteger(csmDirectConcurrency) || csmDirectConcurrency < 1) {
    throw new TypeError("invalid_csm_direct_concurrency");
  }
  if (
    typeof providerAdmission?.enqueueAttempt !== "function"
    || typeof providerAdmission?.runAttempt !== "function"
  ) {
    throw new TypeError("missing_luna_global_attempt_admission");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("invalid_max_attempts");
  const effectiveRetryPolicy = retryPolicy || (maxAttempts === 3
    ? "CAPTURED_E1AE_GENERIC_TRANSIENT_V1"
    : "DEFINITIVE_502_ONLY_V1");
  if (!["CAPTURED_E1AE_GENERIC_TRANSIENT_V1", "DEFINITIVE_502_ONLY_V1"]
    .includes(effectiveRetryPolicy)) {
    throw new TypeError("invalid_luna_retry_policy");
  }

  const queue = [];
  const operations = new Map();
  const assetOperations = new Map();
  const idleWaiters = new Set();
  let active = 0;
  let waitingRetries = 0;

  function attemptMetadata(record, attempt, attemptClass) {
    return {
      tenantId: record.task.tenant_id,
      operationKey: record.operationKey,
      payloadHash: buildLunaDirectPayloadHash(record.task),
      attempt,
      attemptClass,
      estimatedTokens: record.task.estimated_tokens
    };
  }

  function prepareAttempt(record, attempt, attemptClass) {
    try {
      return Promise.resolve(providerAdmission.enqueueAttempt(
        attemptMetadata(record, attempt, attemptClass)
      )).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
    } catch (error) {
      return Promise.resolve({ error });
    }
  }

  async function consumePreparedAttempt(record, attempt, attemptClass) {
    const prepared = await (record.nextAdmission || prepareAttempt(record, attempt, attemptClass));
    record.nextAdmission = null;
    if (prepared.error) throw prepared.error;
    return prepared.value;
  }

  function isIdle() {
    return active === 0 && queue.length === 0 && waitingRetries === 0;
  }

  function notifyIdle() {
    if (!isIdle()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function finish(record, state, value) {
    record.state = state;
    if (state === "succeeded") {
      record.result = value;
      record.resolve(value);
    } else {
      record.error = value;
      record.reject(value);
    }
  }

  async function lookupAmbiguous(record, error) {
    if (typeof lookupOperationResult !== "function") throw lookupUnavailable(error);
    for (let lookupAttempt = 0; ; lookupAttempt += 1) {
      let outcome;
      try {
        outcome = await lookupOperationResult({
          ...record.task,
          operation_key: record.operationKey,
          payload_hash: buildLunaDirectPayloadHash(record.task),
          ambiguous_error: error
        });
      } catch (lookupError) {
        const delayMs = AMBIGUOUS_LOOKUP_RETRY_DELAYS_MS[lookupAttempt];
        if (delayMs === undefined) throw lookupUnavailable(lookupError);
        await sleep(delayMs);
        continue;
      }
      if (outcome?.status === "found") return { found: true, result: outcome.result };
      if (outcome?.status === "not_found") return { found: false, result: undefined };
      const delayMs = AMBIGUOUS_LOOKUP_RETRY_DELAYS_MS[lookupAttempt];
      if (delayMs === undefined) throw lookupUnavailable(new Error("ambiguous_result_lookup_invalid"));
      await sleep(delayMs);
    }
  }

  function scheduleRetry(record, error) {
    record.state = "waiting";
    const delayMs = lunaRetryDelayMs({
      error,
      failedAttempt: record.attempts,
      baseDelayMs,
      maxDelayMs,
      jitterRatio,
      random,
      nowMs: now()
    });
    waitingRetries += 1;
    Promise.resolve()
      .then(() => sleep(delayMs))
      .then(() => {
        waitingRetries -= 1;
        record.nextAdmission = prepareAttempt(record, record.attempts + 1, "retry");
        record.state = "queued";
        queue.push(record);
        drain();
      })
      .catch((errorDuringWait) => {
        waitingRetries -= 1;
        finish(record, "failed", errorDuringWait);
        notifyIdle();
      });
  }

  async function attempt(record) {
    try {
      if (record.lookupBeforeFirstAttempt) {
        const outcome = await lookupAmbiguous(record, record.lookupBeforeFirstAttempt);
        record.lookupBeforeFirstAttempt = null;
        if (outcome.found) {
          finish(record, "succeeded", outcome.result);
          return;
        }
      }

      record.state = "running";
      const attempt = record.attempts + 1;
      const attemptClass = record.manualRetry || attempt > 1 ? "retry" : "fresh";
      const queuedAttempt = consumePreparedAttempt(record, attempt, attemptClass);
      const result = await providerAdmission.runAttempt({
        queuedAttempt,
        execute: async () => {
          record.attempts = attempt;
          const outcome = await executeTask({
            ...record.task,
            operation_key: record.operationKey,
            payload_hash: buildLunaDirectPayloadHash(record.task),
            attempt,
            attempt_class: attemptClass,
            manual_retry: record.manualRetry,
            ...(record.transportRetryReceipt ? {
              provider_transport_retry_receipt: record.transportRetryReceipt
            } : {})
          });
          if (outcome && outcome.ok === false && Number.isInteger(Number(outcome.status))) {
            const error = httpFailure(outcome);
            error.response = outcome;
            throw error;
          }
          return outcome;
        }
      });
      finish(record, "succeeded", result);
    } catch (error) {
      if (error?.provider_attempt_started === false) {
        finish(record, "failed", error);
        return;
      }
      if (error?.code === "LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE") {
        record.lookupBeforeFirstAttempt ||= record.lastAmbiguousError || error;
        finish(record, "failed", error);
        return;
      }
      const failure = classifyLunaDirectFailure(error);
      if (failure.ambiguous) {
        record.lastAmbiguousError = error;
        try {
          const outcome = await lookupAmbiguous(record, error);
          if (outcome.found) {
            finish(record, "succeeded", outcome.result);
            return;
          }
        } catch (lookupError) {
          record.lookupBeforeFirstAttempt = error;
          finish(record, "failed", lookupError);
          return;
        }
      }

      if (effectiveRetryPolicy === "CAPTURED_E1AE_GENERIC_TRANSIENT_V1"
          && failure.retryable && record.attempts < maxAttempts) {
        scheduleRetry(record, error);
        return;
      }
      const retryElapsedMs = now() - record.startedAtMs;
      if (effectiveRetryPolicy === "DEFINITIVE_502_ONLY_V1"
          && maxAttempts === 2 && definitive502TransportRetryEligible(error, {
        failedAttempt: record.attempts,
        maximumAttempts: maxAttempts,
        operationKey: record.operationKey,
        payloadHash: record.payloadHash,
        estimatedTokens: record.task.estimated_tokens,
        elapsedMs: retryElapsedMs
      })) {
        record.retryElapsedMs = retryElapsedMs;
        record.transportRetryReceipt = buildDefinitive502TransportRetryReceipt(record, error);
        scheduleRetry(record, error);
        return;
      }
      finish(record, "failed", error);
    }
  }

  function drain() {
    // A durable global queue must have a claim waiter for every eligible entry;
    // otherwise a locally hidden fair head can block behind this process's
    // arbitrary prefix. The local cap is only a single-process/test fallback.
    const claimWaiterLimit = providerAdmission.globallyEnforced === true
      ? Number.POSITIVE_INFINITY
      : csmDirectConcurrency;
    while (active < claimWaiterLimit && queue.length > 0) {
      const record = queue.shift();
      active += 1;
      attempt(record).finally(() => {
        active -= 1;
        drain();
        notifyIdle();
      });
    }
    notifyIdle();
  }

  function enqueue(input, { manualRetry = false } = {}) {
    const task = normalizeTask(input);
    const operationKey = buildLunaDirectOperationKey(task);
    const payloadHash = buildLunaDirectPayloadHash(task);
    const assetKey = assetIdentity(task);
    const assetOperation = assetOperations.get(assetKey);
    if (assetOperation && assetOperation !== operationKey) {
      throw new LunaDirectDispatchError(
        "LUNA_DIRECT_ASSET_OPERATION_CONFLICT",
        "same_intent_asset_has_different_direct_operation"
      );
    }

    const existing = operations.get(operationKey);
    if (existing && existing.payloadHash !== payloadHash) {
      throw new LunaDirectDispatchError(
        "LUNA_DIRECT_OPERATION_PAYLOAD_CONFLICT",
        "same_direct_operation_has_different_payload"
      );
    }
    if (existing && (!manualRetry || existing.state !== "failed")) return existing.promise;

    const pending = deferred();
    const durablePriorAttempts = Number(task.prior_attempts);
    if (manualRetry && !existing
      && (!Number.isInteger(durablePriorAttempts) || durablePriorAttempts < 1)) {
      throw new LunaDirectDispatchError(
        "LUNA_DIRECT_MANUAL_RETRY_INVALID",
        "manual_retry_requires_durable_prior_attempt"
      );
    }
    const record = {
      ...pending,
      task,
      operationKey,
      payloadHash,
      state: "queued",
      attempts: manualRetry
        ? Number(existing?.attempts || durablePriorAttempts)
        : 0,
      result: undefined,
      error: null,
      manualRetry,
      lastAmbiguousError: null,
      lookupBeforeFirstAttempt: manualRetry ? existing?.lastAmbiguousError || existing?.lookupBeforeFirstAttempt : null,
      nextAdmission: null,
      transportRetryReceipt: null,
      startedAtMs: now(),
      retryElapsedMs: null
    };
    if (!record.lookupBeforeFirstAttempt) {
      record.nextAdmission = prepareAttempt(
        record,
        record.attempts + 1,
        manualRetry ? "retry" : "fresh"
      );
    }
    operations.set(operationKey, record);
    assetOperations.set(assetKey, operationKey);
    queue.push(record);
    drain();
    return record.promise;
  }

  return Object.freeze({
    csmDirectConcurrency,
    enqueue: (task) => enqueue(task),
    append: (tasks = []) => Array.from(tasks, (task) => enqueue(task)),
    manualRetry: (task) => enqueue(task, { manualRetry: true }),
    whenIdle: () => isIdle()
      ? Promise.resolve()
      : new Promise((resolve) => idleWaiters.add(resolve)),
    snapshot: () => ({
      csm_direct_concurrency: csmDirectConcurrency,
      globally_enforced_admission: providerAdmission.globallyEnforced === true,
      queued: queue.length,
      active,
      waiting_retries: waitingRetries,
      operations: operations.size
    })
  });
}
