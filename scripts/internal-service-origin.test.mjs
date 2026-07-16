import assert from "node:assert/strict";
import { triggerV4QueuePumpAfterEnqueue } from "../api/v4/listing-job-enqueue.js";
import { triggerPump as triggerPrewarmPump } from "../api/v4/listing-job-prewarm.js";
import { triggerV4QueuePumpContinuation } from "../api/v4/listing-job-pump.js";
import { triggerV4BackgroundWorkerAfterL1Release } from "../api/v4/listing-job-worker.js";
import { trustedInternalServiceOrigin } from "../lib/listing/v4/jobs/internal-service-origin.mjs";
import { workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";

const secret = "track-c-internal-worker-secret";
const trustedOrigin = "https://lynca-preview.example";
const hostileRequest = {
  headers: {
    host: "attacker.example",
    "x-forwarded-host": "attacker.example",
    "x-forwarded-proto": "https",
    [workerSecretHeader]: secret
  }
};
const env = {
  V4_JOB_WORKER_SECRET: secret,
  V4_INTERNAL_BASE_URL: trustedOrigin,
  V4_QUEUE_GLOBAL_DRAIN_ENABLED: "false",
  V4_QUEUE_KICK_DEDUP_MS: "1",
  V4_JOB_WORKER_PROCESS_CONCURRENCY: "1"
};

assert.equal(trustedInternalServiceOrigin(env), trustedOrigin);
assert.equal(trustedInternalServiceOrigin({ VERCEL_URL: "safe-preview.vercel.app" }), "https://safe-preview.vercel.app");
assert.equal(trustedInternalServiceOrigin({ V4_INTERNAL_BASE_URL: "http://attacker.example" }), "");
assert.equal(trustedInternalServiceOrigin({ V4_INTERNAL_BASE_URL: "https://safe.example/path" }), "");

function recorder() {
  const calls = [];
  const deferred = [];
  return {
    calls,
    deferred,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, claimed_count: 1, processed_count: 1 })
      };
    },
    defer: (promise) => deferred.push(Promise.resolve(promise)),
    settle: async () => Promise.all(deferred)
  };
}

function assertSecretStayedOnTrustedOrigin(calls, expectedPath) {
  assert.ok(calls.length >= 1, "an internal wake call should be scheduled");
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, trustedOrigin);
    assert.equal(url.pathname, expectedPath);
    assert.equal(call.init.headers[workerSecretHeader], secret);
    assert.doesNotMatch(call.url, /attacker\.example/);
  }
}

{
  const recorded = recorder();
  const result = triggerV4QueuePumpAfterEnqueue(hostileRequest, {
    tenantId: "tenant_a",
    batchId: "batch_a",
    queuedCount: 1,
    env,
    fetchImpl: recorded.fetchImpl,
    defer: recorded.defer,
    acquireKick: async () => ({ ok: true, acquired: true }),
    sleep: async () => {}
  });
  assert.equal(result.triggered, true);
  await recorded.settle();
  assertSecretStayedOnTrustedOrigin(recorded.calls, "/api/v4/listing-job-pump");
}

{
  const recorded = recorder();
  const result = triggerPrewarmPump(hostileRequest, {
    tenantId: "tenant_a",
    env,
    fetchImpl: recorded.fetchImpl,
    defer: recorded.defer
  });
  assert.equal(result.triggered, true);
  await recorded.settle();
  assertSecretStayedOnTrustedOrigin(recorded.calls, "/api/v4/listing-job-pump");
}

{
  const recorded = recorder();
  const result = triggerV4QueuePumpContinuation(
    hostileRequest,
    { continuation_depth: 0, max_continuation_depth: 2 },
    { claimed_count: 1 },
    env,
    recorded.fetchImpl,
    recorded.defer
  );
  assert.equal(result.triggered, true);
  await recorded.settle();
  assertSecretStayedOnTrustedOrigin(recorded.calls, "/api/v4/listing-job-pump");
}

{
  const recorded = recorder();
  const result = triggerV4BackgroundWorkerAfterL1Release(hostileRequest, {
    job: { id: "job_l1", tenant_id: "tenant_a" },
    pairedRelease: { saved: true },
    env,
    fetchImpl: recorded.fetchImpl,
    defer: recorded.defer
  });
  assert.equal(result.triggered, true);
  await recorded.settle();
  assertSecretStayedOnTrustedOrigin(recorded.calls, "/api/v4/listing-job-worker");
}

console.log("trusted internal service origin tests passed");
