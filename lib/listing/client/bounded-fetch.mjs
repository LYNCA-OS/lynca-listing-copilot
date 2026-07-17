const retryableStatuses = new Set([408, 425, 429]);

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  return String(headers[name] || headers[name.toLowerCase()] || "");
}

export function isRetryableClientFetchStatus(status) {
  const normalized = Number(status);
  return retryableStatuses.has(normalized) || normalized >= 500;
}

export function retryAfterDelayMs(response, {
  now = Date.now(),
  fallbackMs = 250,
  maxDelayMs = 5000
} = {}) {
  const raw = headerValue(response?.headers, "retry-after").trim();
  if (!raw) return Math.min(maxDelayMs, Math.max(0, fallbackMs));

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.min(maxDelayMs, Math.max(0, Math.round(seconds * 1000)));
  }

  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return Math.min(maxDelayMs, Math.max(0, fallbackMs));
  return Math.min(maxDelayMs, Math.max(0, retryAt - now));
}

function annotatedFetchError(error, { attempts, elapsedMs, timedOut }) {
  const result = error instanceof Error ? error : new Error(String(error || "client_fetch_failed"));
  result.attempts = attempts;
  result.elapsed_ms = elapsedMs;
  if (timedOut) {
    result.code = "CLIENT_FETCH_TIMEOUT";
    result.timed_out = true;
  }
  return result;
}

function attemptSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener?.("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("client_fetch_timeout")), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", forwardAbort);
    }
  };
}

/**
 * Retries only transport failures and explicitly retryable HTTP responses.
 * The caller still owns response parsing and business-level failures.
 */
export async function fetchWithBoundedRetry(url, init = {}, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  maxAttempts = 3,
  retryNetworkErrors = true,
  baseDelayMs = 250,
  maxDelayMs = 5000,
  jitterRatio = 0.15,
  random = Math.random,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = () => Date.now()
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const attemptsLimit = positiveInteger(maxAttempts, 3, { min: 1, max: 5 });
  const perAttemptTimeoutMs = positiveInteger(timeoutMs, 15000, { min: 100, max: 120000 });
  const startedAt = now();
  let lastError = null;

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    if (init.signal?.aborted) {
      throw annotatedFetchError(init.signal.reason || new Error("client_fetch_aborted"), {
        attempts: attempt - 1,
        elapsedMs: Math.max(0, now() - startedAt),
        timedOut: false
      });
    }

    const boundedSignal = attemptSignal(init.signal, perAttemptTimeoutMs);
    let response = null;
    let timedOut = false;
    try {
      response = await fetchImpl(url, {
        ...init,
        signal: boundedSignal.signal
      });
    } catch (error) {
      timedOut = boundedSignal.signal.aborted && !init.signal?.aborted;
      lastError = error;
    } finally {
      boundedSignal.cleanup();
    }

    const elapsedMs = Math.max(0, now() - startedAt);
    if (response) {
      const shouldRetry = isRetryableClientFetchStatus(response.status) && attempt < attemptsLimit;
      if (!shouldRetry) {
        return {
          response,
          attempts: attempt,
          elapsed_ms: elapsedMs,
          retried: attempt > 1
        };
      }

      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const retryDelay = retryAfterDelayMs(response, {
        now: now(),
        fallbackMs: exponentialDelay,
        maxDelayMs
      });
      const jitter = Math.round(retryDelay * Math.max(0, jitterRatio) * ((random() * 2) - 1));
      await sleep(Math.max(0, retryDelay + jitter));
      continue;
    }

    if (!retryNetworkErrors || attempt >= attemptsLimit || init.signal?.aborted) {
      throw annotatedFetchError(lastError, {
        attempts: attempt,
        elapsedMs,
        timedOut
      });
    }

    const retryDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
    const jitter = Math.round(retryDelay * Math.max(0, jitterRatio) * ((random() * 2) - 1));
    await sleep(Math.max(0, retryDelay + jitter));
  }

  throw annotatedFetchError(lastError, {
    attempts: attemptsLimit,
    elapsedMs: Math.max(0, now() - startedAt),
    timedOut: false
  });
}
