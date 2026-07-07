#!/usr/bin/env node

import assert from "node:assert/strict";
import pumpHandler, { runV4QueuePump } from "../api/v4/listing-job-pump.js";
import { workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";
import { callJsonHandler } from "../lib/listing/v4/session/http-handler-utils.mjs";

const missingSecret = await runV4QueuePump({
  payload: { cycles: 2 },
  env: {},
  invokeWorker: async () => {
    throw new Error("should_not_call_worker");
  }
});
assert.equal(missingSecret.ok, false);
assert.equal(missingSecret.cycles_run, 0);

const calls = [];
const sequence = [
  { claimed_count: 1, processed_count: 1 },
  { claimed_count: 1, processed_count: 1 },
  { claimed_count: 0, processed_count: 0 },
  { claimed_count: 0, processed_count: 0 }
];
const pump = await runV4QueuePump({
  payload: {
    tenant_id: "tenant-batch-1",
    limit: 2,
    process_concurrency: 2,
    cycles: 5,
    max_runtime_ms: 30_000
  },
  env: {
    V4_JOB_WORKER_SECRET: "secret",
    V4_JOB_WORKER_PROCESS_CONCURRENCY: "2"
  },
  invokeWorker: async (payload, { workerSecret }) => {
    calls.push({ payload, workerSecret });
    return {
      statusCode: 200,
      body: {
        ok: true,
        ...(sequence.shift() || { claimed_count: 0, processed_count: 0 })
      }
    };
  }
});

assert.equal(pump.ok, true);
assert.equal(pump.tenant_id, "tenant-batch-1");
assert.equal(pump.cycles_run, 2);
assert.equal(pump.claimed_count, 2);
assert.equal(pump.processed_count, 2);
assert.deepEqual(calls.map((entry) => entry.payload.lane), ["interactive", "background", "interactive", "background"]);
assert.equal(calls[0].payload.tenant_id, "tenant-batch-1");
assert.equal(calls[0].payload.limit, 2);
assert.equal(calls[0].payload.process_concurrency, 2);
assert.equal(calls[0].workerSecret, "secret");

const interactiveOnlyCalls = [];
await runV4QueuePump({
  payload: { interactive_only: true, cycles: 1 },
  env: { V4_JOB_WORKER_SECRET: "secret" },
  invokeWorker: async (payload) => {
    interactiveOnlyCalls.push(payload);
    return { statusCode: 200, body: { ok: true, claimed_count: 0, processed_count: 0 } };
  }
});
assert.deepEqual(interactiveOnlyCalls.map((entry) => entry.lane), ["interactive"]);

const previousSecret = process.env.V4_JOB_WORKER_SECRET;
try {
  delete process.env.V4_JOB_WORKER_SECRET;
  const unauthorized = await callJsonHandler(pumpHandler, {
    method: "GET",
    headers: {},
    payload: {}
  });
  assert.equal(unauthorized.statusCode, 401);

  process.env.V4_JOB_WORKER_SECRET = "secret";
  const wrongSecret = await callJsonHandler(pumpHandler, {
    method: "GET",
    headers: { [workerSecretHeader]: "wrong" },
    payload: {}
  });
  assert.equal(wrongSecret.statusCode, 401);
} finally {
  if (previousSecret === undefined) {
    delete process.env.V4_JOB_WORKER_SECRET;
  } else {
    process.env.V4_JOB_WORKER_SECRET = previousSecret;
  }
}

console.log("v4 production job pump tests passed");
