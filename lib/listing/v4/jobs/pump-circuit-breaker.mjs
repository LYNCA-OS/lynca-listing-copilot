// Stop the queue pump from adding load to a database that is already failing.
//
// The pump is scheduled every minute and retries a failed worker invocation
// once. When the database saturates, a claim does not fail fast -- it holds a
// connection until the invocation times out (observed: 52s), and the retry
// holds another. Two lanes then keep roughly four connections busy for most of
// every minute, and the next minute's pump starts before the previous one
// finished. Retrying a timeout cannot succeed while the database is the
// bottleneck; it only deepens it.
//
// So: a retry is only worth attempting when the failure was fast. A slow
// failure is evidence of saturation, and the pump should yield until the next
// tick rather than press.
//
// The kill switch is separate and blunt: it stops the pump entirely, for
// stopping the bleeding during an incident without waiting on a deploy.

const DEFAULT_SLOW_FAILURE_MS = 5_000;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function envFlag(value, fallback = false) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function pumpDisabled(env = process.env) {
  return envFlag(env?.V4_QUEUE_PUMP_DISABLED, false);
}

export function slowFailureThresholdMs(env = process.env) {
  return positiveNumber(env?.V4_QUEUE_PUMP_SLOW_FAILURE_MS, DEFAULT_SLOW_FAILURE_MS);
}

// A retry is worth attempting only when the failure came back quickly.
export function shouldRetryInvocation({
  statusCode = 0,
  latencyMs = 0,
  attempt = 1,
  maxAttempts = 2,
  env = process.env
} = {}) {
  if (attempt >= maxAttempts) return { retry: false, reason: "max_attempts_reached" };
  const retryableStatus = statusCode === 0 || statusCode >= 500;
  if (!retryableStatus) return { retry: false, reason: "status_not_retryable" };
  const threshold = slowFailureThresholdMs(env);
  if (Number(latencyMs) >= threshold) {
    // Retrying here would hold a second connection for as long as the first.
    return { retry: false, reason: "slow_failure_suspected_backend_saturation" };
  }
  return { retry: true, reason: "fast_transient_failure" };
}
