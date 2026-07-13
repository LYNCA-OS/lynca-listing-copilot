#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  triggerReleasedProviderCapacityRefill,
  triggerWriterReadyCapacityRefill
} from "../lib/listing/v4/jobs/writer-ready-capacity-refill.mjs";

const env = {
  V4_JOB_WORKER_SECRET: "worker-secret",
  V4_WRITER_READY_CAPACITY_REFILL_ENABLED: "true"
};
const req = {
  headers: {
    "x-forwarded-host": "listing.example.test",
    "x-forwarded-proto": "https"
  }
};
let request = null;
let scheduled = null;
const triggered = triggerWriterReadyCapacityRefill(req, {
  payload: {
    v4_queue_job_id: "job-1",
    v4_queue_lane: "background"
  },
  capacityRelease: { released: true },
  env,
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
assert.equal(request.url, "https://listing.example.test/api/v4/listing-job-worker");
assert.deepEqual(JSON.parse(request.init.body), {
  lane: "background",
  tenant_id: null,
  limit: 1,
  process_concurrency: 1,
  retry_delay_seconds: 8,
  worker_id: "v4-refill-job-1",
  reason: "writer_ready_capacity_refill"
});
assert.equal(triggered.release_boundary, "writer_ready");
assert.equal((await scheduled).claimed_count, 1);

let fallbackUrl = null;
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
  fetchImpl: async (url) => {
    fallbackUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, claimed_count: 1, processed_count: 1 })
    };
  },
  waitUntilImpl: () => {}
});
assert.equal(providerDoneTriggered.triggered, true);
assert.equal(providerDoneTriggered.release_boundary, "provider_done");
assert.equal(fallbackUrl, "https://listing.example.test/api/v4/listing-job-worker");

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
