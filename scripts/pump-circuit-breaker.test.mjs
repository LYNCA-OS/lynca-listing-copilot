import test from "node:test";
import assert from "node:assert/strict";

import {
  pumpDisabled,
  shouldRetryInvocation,
  slowFailureThresholdMs
} from "../lib/listing/v4/jobs/pump-circuit-breaker.mjs";

test("the kill switch is off unless explicitly set", () => {
  assert.equal(pumpDisabled({}), false);
  assert.equal(pumpDisabled({ V4_QUEUE_PUMP_DISABLED: "" }), false);
  assert.equal(pumpDisabled({ V4_QUEUE_PUMP_DISABLED: "false" }), false);
  assert.equal(pumpDisabled({ V4_QUEUE_PUMP_DISABLED: "true" }), true);
  assert.equal(pumpDisabled({ V4_QUEUE_PUMP_DISABLED: "1" }), true);
  assert.equal(pumpDisabled({ V4_QUEUE_PUMP_DISABLED: "on" }), true);
});

test("the slow-failure threshold is configurable and defaults to 5s", () => {
  assert.equal(slowFailureThresholdMs({}), 5_000);
  assert.equal(slowFailureThresholdMs({ V4_QUEUE_PUMP_SLOW_FAILURE_MS: "1200" }), 1_200);
  assert.equal(slowFailureThresholdMs({ V4_QUEUE_PUMP_SLOW_FAILURE_MS: "nonsense" }), 5_000);
  assert.equal(slowFailureThresholdMs({ V4_QUEUE_PUMP_SLOW_FAILURE_MS: "0" }), 5_000);
});

test("a fast 500 is still retried", () => {
  const decision = shouldRetryInvocation({ statusCode: 500, latencyMs: 300, attempt: 1, maxAttempts: 2, env: {} });
  assert.equal(decision.retry, true);
  assert.equal(decision.reason, "fast_transient_failure");
});

test("a fast transport failure is still retried", () => {
  const decision = shouldRetryInvocation({ statusCode: 0, latencyMs: 50, attempt: 1, maxAttempts: 2, env: {} });
  assert.equal(decision.retry, true);
});

// The observed incident: two lanes each burning 52s, then retrying for another
// 52s, every minute, against a database that was already out of connections.
test("a slow 500 is not retried, because the backend is the bottleneck", () => {
  const decision = shouldRetryInvocation({ statusCode: 500, latencyMs: 52_373, attempt: 1, maxAttempts: 2, env: {} });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "slow_failure_suspected_backend_saturation");
});

test("a failure exactly at the threshold counts as slow", () => {
  const decision = shouldRetryInvocation({ statusCode: 500, latencyMs: 5_000, attempt: 1, maxAttempts: 2, env: {} });
  assert.equal(decision.retry, false);
});

test("a 4xx is never retried regardless of latency", () => {
  assert.equal(shouldRetryInvocation({ statusCode: 401, latencyMs: 10, attempt: 1, maxAttempts: 2, env: {} }).retry, false);
  assert.equal(shouldRetryInvocation({ statusCode: 429, latencyMs: 10, attempt: 1, maxAttempts: 2, env: {} }).retry, false);
});

test("a success is not retried", () => {
  assert.equal(shouldRetryInvocation({ statusCode: 200, latencyMs: 10, attempt: 1, maxAttempts: 2, env: {} }).retry, false);
});

test("the last attempt never retries", () => {
  const decision = shouldRetryInvocation({ statusCode: 500, latencyMs: 10, attempt: 2, maxAttempts: 2, env: {} });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, "max_attempts_reached");
});

console.log("pump circuit breaker tests passed");
