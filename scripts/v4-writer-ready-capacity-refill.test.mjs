#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  triggerReleasedProviderCapacityRefill,
  triggerWriterReadyCapacityRefill
} from "../lib/listing/v4/jobs/writer-ready-capacity-refill.mjs";

const env = {
  V4_JOB_WORKER_SECRET: "worker-secret",
  V4_WRITER_READY_CAPACITY_REFILL_ENABLED: "true",
  V4_INTERNAL_BASE_URL: "https://listing.example.test"
};
const req = {
  headers: {
    "x-forwarded-host": "listing.example.test",
    "x-forwarded-proto": "https"
  }
};
let request = null;
let scheduled = null;
let acquireKickCalled = false;
const triggered = triggerWriterReadyCapacityRefill(req, {
  payload: {
    v4_queue_job_id: "job-1",
    v4_queue_lane: "background"
  },
  capacityRelease: { released: true },
  env,
  acquireKick: async () => {
    acquireKickCalled = true;
    return { ok: true, acquired: false };
  },
  fetchImpl: async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, claimed_count: 1, processed_count: 1 })
    };
  },
  waitUntilImpl: (promise) => {
    scheduled = promise;
  }
});
assert.equal(triggered.triggered, true);
const triggeredCompletion = await scheduled;
assert.equal(acquireKickCalled, false, "every real provider release must wake without short-window dedup");
assert.equal(request.url, "https://listing.example.test/api/v4/listing-job-pump");
assert.deepEqual(JSON.parse(request.init.body), {
  background_only: true,
  continuation_cycles: 1,
  cycles: 1,
  detached: true,
  idle_cycles_before_stop: 1,
  background_idle_cycles: 1,
  lease_seconds: 120,
  limit: 2,
  max_continuation_depth: 100,
  max_runtime_ms: 120000,
  process_concurrency: 2,
  refill_source_tenant_id: null,
  tenant_id: null,
  reason: "writer_ready_capacity_refill"
});
assert.equal(triggered.release_boundary, "writer_ready");
assert.equal(triggeredCompletion.pump_claimed_count, 1);

let fallbackUrl = null;
let fallbackScheduled = null;
const providerDoneTriggered = triggerReleasedProviderCapacityRefill({ headers: {} }, {
  payload: {
    v4_queue_job_id: "job-provider-done",
    v4_queue_lane: "background"
  },
  capacityRelease: { released: true },
  releaseBoundary: "provider_done",
  env: {
    ...env,
    VERCEL_PROJECT_PRODUCTION_URL: "listing.example.test"
  },
  acquireKick: async () => ({ ok: true, acquired: true }),
  fetchImpl: async (url) => {
    fallbackUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, claimed_count: 1, processed_count: 1 })
    };
  },
  waitUntilImpl: (promise) => {
    fallbackScheduled = promise;
  }
});
assert.equal(providerDoneTriggered.triggered, true);
assert.equal(providerDoneTriggered.release_boundary, "provider_done");
await fallbackScheduled;
assert.equal(fallbackUrl, "https://listing.example.test/api/v4/listing-job-pump");

assert.deepEqual(triggerWriterReadyCapacityRefill(req, {
  payload: { v4_queue_job_id: "job-2" },
  capacityRelease: { released: false },
  env
}), { triggered: false, reason: "capacity_not_released" });

assert.deepEqual(triggerWriterReadyCapacityRefill(req, {
  payload: { v4_queue_job_id: "job-3" },
  capacityRelease: { released: true },
  env: { ...env, V4_WRITER_READY_CAPACITY_REFILL_ENABLED: "false" }
}), { triggered: false, reason: "capacity_refill_disabled" });

console.log("v4 writer-ready capacity refill tests passed");
