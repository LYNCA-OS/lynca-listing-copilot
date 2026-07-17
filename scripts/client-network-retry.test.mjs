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
  const result = await fetchWithBoundedRetry("/retryable", {}, {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(503) : response(200);
    },
    sleep: async (delay) => delays.push(delay),
    random: () => 0.5,
    now: () => 1000
  });
  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.response.status, 200);
  assert.deepEqual(delays, [250]);
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

console.log("client network retry tests passed");
