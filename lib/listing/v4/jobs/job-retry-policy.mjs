export const v4JobRetryPolicy = Object.freeze({
  maxRetries: 3,
  maxAttempts: 4,
  backoffSeconds: Object.freeze([10, 30, 120])
});

export const v4CanonicalJobStates = Object.freeze({
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCESS: "SUCCESS",
  RETRYABLE_FAILED: "RETRYABLE_FAILED",
  FAILED_FINAL: "FAILED_FINAL"
});

const retryableHttpStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const nonRetryableCodes = new Set([
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_FAILED",
  "CONTENT_POLICY_VIOLATION",
  "FORBIDDEN",
  "IMAGE_INPUT_UNSUPPORTED",
  "INVALID_PAYLOAD",
  "NOT_FOUND",
  "PROVIDER_INPUT_UNSUPPORTED",
  "QUEUE_LEASE_LOST",
  "REQUEST_TOO_LARGE",
  "UNAUTHORIZED"
]);

const retryableCodes = new Set([
  "CONNECTION_RESET",
  "ECONNRESET",
  "ETIMEDOUT",
  "FETCH_FAILED",
  "HTTP_408",
  "HTTP_409",
  "HTTP_425",
  "HTTP_429",
  "HTTP_500",
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
  "PROVIDER_OVERLOADED",
  "PROVIDER_TIMEOUT",
  "QUEUE_COMPLETION_WRITE_FAILED",
  "RATE_LIMITED",
  "TIMEOUT"
]);

function boundedInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeErrorCode(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 120);
}

function numericHttpStatus(error = {}) {
  for (const value of [error?.http_status, error?.statusCode, error?.status]) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  const code = normalizeErrorCode(error?.code);
  const match = code.match(/^HTTP_(\d{3})$/);
  return match ? Number(match[1]) : null;
}

export function canonicalV4JobState(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "QUEUED":
      return v4CanonicalJobStates.QUEUED;
    case "RUNNING":
      return v4CanonicalJobStates.RUNNING;
    case "L1_READY":
    case "L2_READY":
      return v4CanonicalJobStates.SUCCESS;
    case "RETRYING":
      return v4CanonicalJobStates.RETRYABLE_FAILED;
    case "FAILED":
    case "CANCELLED":
    default:
      return v4CanonicalJobStates.FAILED_FINAL;
  }
}

export function withCanonicalV4JobState(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return {
    ...row,
    canonical_state: canonicalV4JobState(row.status)
  };
}

export function retryDelaySecondsForAttempt(attemptCount) {
  const attempt = boundedInteger(attemptCount, 1, { min: 1, max: 10_000 });
  return v4JobRetryPolicy.backoffSeconds[attempt - 1] ?? null;
}

export function classifyV4JobError(error = {}) {
  const input = error && typeof error === "object" ? error : { message: String(error || "") };
  const code = normalizeErrorCode(
    input.code ||
    input.error_code ||
    input.type ||
    (typeof input.status === "string" && !/^\d{3}$/.test(input.status) ? input.status : "")
  );
  const httpStatus = numericHttpStatus(input);
  const message = String(input.message || input.error || "").trim().toLowerCase();

  if (input.retryable === true || input.recoverable === true) {
    return { retryable: true, code: code || "EXPLICIT_RETRYABLE", category: "explicit", httpStatus };
  }
  if (input.retryable === false || input.recoverable === false) {
    return { retryable: false, code: code || "EXPLICIT_NON_RETRYABLE", category: "explicit", httpStatus };
  }
  if (nonRetryableCodes.has(code)) {
    return { retryable: false, code, category: "permanent_code", httpStatus };
  }
  if (retryableCodes.has(code)) {
    return { retryable: true, code, category: "transient_code", httpStatus };
  }
  if (httpStatus !== null) {
    if (retryableHttpStatuses.has(httpStatus)) {
      return { retryable: true, code: code || `HTTP_${httpStatus}`, category: "transient_http", httpStatus };
    }
    if (httpStatus >= 400 && httpStatus < 500) {
      return { retryable: false, code: code || `HTTP_${httpStatus}`, category: "permanent_http", httpStatus };
    }
  }
  if (/invalid payload|unsupported image|unsupported input|permission denied|unauthori[sz]ed|forbidden/.test(message)) {
    return { retryable: false, code: code || "PERMANENT_INPUT_ERROR", category: "permanent_message", httpStatus };
  }
  if (/timeout|timed out|rate.?limit|too many requests|temporar|overload|connection reset|fetch failed|network/.test(message)) {
    return { retryable: true, code: code || "TRANSIENT_PROVIDER_ERROR", category: "transient_message", httpStatus };
  }

  // Unknown worker/provider failures remain retryable within the bounded
  // attempt budget. This preserves availability without creating an infinite
  // loop because the schedule has exactly three retry slots.
  return { retryable: true, code: code || "UNCLASSIFIED_ERROR", category: "bounded_default", httpStatus };
}

export function planV4JobRetry({
  attemptCount = 0,
  maxAttempts = v4JobRetryPolicy.maxAttempts,
  error = {},
  forceFinalFailure = false
} = {}) {
  const attempt = boundedInteger(attemptCount, 0, { min: 0, max: 10_000 });
  const attemptBudget = boundedInteger(maxAttempts, v4JobRetryPolicy.maxAttempts, { min: 1, max: 10_000 });
  const classification = classifyV4JobError(error);
  const retryDelaySeconds = retryDelaySecondsForAttempt(Math.max(1, attempt));
  const retriesUsed = Math.max(0, attempt - 1);
  const retriesAllowed = Math.max(0, Math.min(v4JobRetryPolicy.maxRetries, attemptBudget - 1));
  const shouldRetry = forceFinalFailure !== true &&
    classification.retryable &&
    attempt < attemptBudget &&
    retryDelaySeconds !== null;

  return {
    attemptCount: attempt,
    maxAttempts: attemptBudget,
    retriesUsed,
    retriesRemaining: Math.max(0, retriesAllowed - retriesUsed),
    shouldRetry,
    retryDelaySeconds: shouldRetry ? retryDelaySeconds : null,
    finalFailure: !shouldRetry,
    classification
  };
}
