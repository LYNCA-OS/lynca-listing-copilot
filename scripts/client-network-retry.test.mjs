import assert from "node:assert/strict";
import {
  fetchWithBoundedRetry,
  isRetryableClientFetchStatus,
  retryAfterDelayMs
} from "../lib/listing/client/bounded-fetch.mjs";

function response(status, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || "";
      }
    }
  };
}

assert.equal(isRetryableClientFetchStatus(408), true);
assert.equal(isRetryableClientFetchStatus(429), true);
assert.equal(isRetryableClientFetchStatus(503), true);
assert.equal(isRetryableClientFetchStatus(400), false);
assert.equal(retryAfterDelayMs(response(429, { "retry-after": "2" }), { maxDelayMs: 5000 }), 2000);

{
  let calls = 0;
  const delays = [];
  let cancelled = 0;
  const result = await fetchWithBoundedRetry("/retryable", {}, {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? { ...response(503), body: { async cancel() { cancelled += 1; } } }
        : response(200);
    },
    sleep: async (delay) => delays.push(delay),
    random: () => 0.5,
    now: () => 1000
  });
  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.response.status, 200);
  assert.deepEqual(delays, [250]);
  assert.equal(cancelled, 1, "an unread retry response must release its body before the next attempt");
}

{
  let calls = 0;
  const result = await fetchWithBoundedRetry("/not-retryable", {}, {
    fetchImpl: async () => {
      calls += 1;
      return response(400);
    },
    sleep: async () => assert.fail("400 must not sleep or retry"),
    now: () => 1000
  });
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.response.status, 400);
}

{
  let calls = 0;
  const result = await fetchWithBoundedRetry("/network-retry", {}, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("socket closed");
      return response(200);
    },
    sleep: async () => {},
    random: () => 0.5,
    now: () => 1000
  });
  assert.equal(calls, 2);
  assert.equal(result.response.status, 200);
}

{
  let calls = 0;
  await assert.rejects(
    () => fetchWithBoundedRetry("/uncertain-put", {}, {
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError("connection reset after request write");
      },
      retryNetworkErrors: false,
      sleep: async () => assert.fail("uncertain writes must not retry"),
      now: () => 1000
    }),
    (error) => error.attempts === 1 && /connection reset/.test(error.message)
  );
  assert.equal(calls, 1);
}

async function observeHardTimeout(requestedTimeoutMs) {
  let scheduledMs = null;
  let fireTimeout = null;
  let cleared = 0;
  const pending = fetchWithBoundedRetry("/slow-authority", {}, {
    timeoutMs: requestedTimeoutMs,
    maxAttempts: 1,
    retryNetworkErrors: false,
    now: () => 1_000,
    setTimeoutImpl(callback, delayMs) {
      scheduledMs = delayMs;
      fireTimeout = callback;
      return "fake-timeout";
    },
    clearTimeoutImpl(timer) {
      assert.equal(timer, "fake-timeout");
      cleared += 1;
    },
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  await Promise.resolve();
  assert.equal(typeof fireTimeout, "function");
  fireTimeout();
  await assert.rejects(
    pending,
    (error) => error.code === "CLIENT_FETCH_TIMEOUT" && error.timed_out === true
  );
  assert.equal(cleared, 1, "the hard timeout must be cleaned after abort settles");
  return scheduledMs;
}

assert.equal(await observeHardTimeout(290_000), 290_000,
  "the 290s browser contract must not be silently truncated to the 120s provider budget");
assert.equal(await observeHardTimeout(Number.MAX_SAFE_INTEGER), 300_000,
  "even an unbounded caller remains capped by the 300s function boundary");

console.log("client network retry tests passed");
