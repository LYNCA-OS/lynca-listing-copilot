#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  invokeTrustedV4QueuePump,
  scheduleTrustedV4QueuePump
} from "../lib/listing/v4/jobs/internal-queue-wake.mjs";
import { triggerV4RetryWake } from "../api/v4/listing-job-worker.js";
import { workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";

const env = {
  V4_JOB_WORKER_SECRET: "worker-secret",
  V4_INTERNAL_BASE_URL: "https://listing.internal.test",
  V4_JOB_WORKER_PROCESS_CONCURRENCY: "2"
};

const directCalls = [];
const direct = await invokeTrustedV4QueuePump({
  payload: { reason: "unit_direct" },
  env,
  fetchImpl: async (url, init = {}) => {
    directCalls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 202,
      async json() {
        return { ok: true, accepted: true, detached: true };
      }
    };
  }
});
assert.equal(direct.ok, true);
assert.equal(direct.accepted, true);
assert.equal(directCalls[0].url, "https://listing.internal.test/api/v4/listing-job-pump");
assert.equal(directCalls[0].init.headers[workerSecretHeader], "worker-secret");
assert.equal(directCalls[0].body.detached, true, "internal wakes must use fast-ack detached pumps");

let untrustedFetchCalled = false;
const failClosed = await invokeTrustedV4QueuePump({
  payload: {},
  env: { V4_JOB_WORKER_SECRET: "secret" },
  fetchImpl: async () => {
    untrustedFetchCalled = true;
    throw new Error("must_not_fetch");
  }
});
assert.equal(failClosed.ok, false);
assert.equal(failClosed.error, "trusted_internal_origin_missing");
assert.equal(untrustedFetchCalled, false);

const dedupDeferred = [];
let dedupFetchCalled = false;
const deduplicated = scheduleTrustedV4QueuePump({
  payload: {},
  reason: "dedup_test",
  dedupScope: "retry:background",
  dedupOwner: "retry-job-a",
  acquireKick: async () => ({ ok: true, acquired: false }),
  env,
  fetchImpl: async () => {
    dedupFetchCalled = true;
    throw new Error("must_not_fetch");
  },
  defer: (promise) => dedupDeferred.push(promise),
  logger: null
});
assert.equal(deduplicated.triggered, true);
assert.equal((await dedupDeferred[0]).deduplicated, true);
assert.equal(dedupFetchCalled, false, "a coalesced retry wake must not start a duplicate pump");

const retrySleeps = [];
const retryDeferred = [];
const retryCalls = [];
const retryWake = triggerV4RetryWake({
  job: { id: "job-timeout", lane: "background" },
  failure: {
    saved: true,
    retry_plan: { shouldRetry: true, retryDelaySeconds: 30 }
  },
  env,
  sleep: async (ms) => retrySleeps.push(ms),
  acquireKick: async ({ scope }) => {
    assert.equal(scope, "retry:background");
    return { ok: true, acquired: true };
  },
  fetchImpl: async (url, init = {}) => {
    retryCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 202,
      async json() {
        return { ok: true, accepted: true };
      }
    };
  },
  defer: (promise) => retryDeferred.push(promise)
});
assert.equal(retryWake.triggered, true);
assert.equal(retryWake.retry_delay_seconds, 30);
await retryDeferred[0];
assert.deepEqual(retrySleeps, [30_100]);
assert.equal(retryCalls.length, 1);
assert.equal(retryCalls[0].body.background_only, true);
assert.equal(retryCalls[0].body.detached, true);
assert.equal(retryCalls[0].body.retry_job_id, "job-timeout");

let finalDeferred = false;
const finalWake = triggerV4RetryWake({
  job: { id: "job-final", lane: "background" },
  failure: { saved: true, retry_plan: { shouldRetry: false } },
  env,
  defer: () => { finalDeferred = true; }
});
assert.equal(finalWake.triggered, false);
assert.equal(finalDeferred, false, "final failures must never schedule another queue cycle");

console.log("v4 internal queue wake tests passed");
