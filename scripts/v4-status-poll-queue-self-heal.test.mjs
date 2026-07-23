#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  statusPollQueueSelfHealPlan,
  triggerStatusBackendRecovery,
  triggerStatusPollQueueSelfHeal
} from "../lib/listing/v4/jobs/status-poll-queue-self-heal.mjs";

const nowMs = Date.parse("2026-07-20T00:00:30Z");
const staleQueued = {
  id: "job-queued",
  batch_id: "batch-a",
  tenant_id: "tenant-a",
  lane: "background",
  status: "QUEUED",
  created_at: "2026-07-20T00:00:00Z"
};
assert.equal(statusPollQueueSelfHealPlan([staleQueued], { nowMs, processConcurrency: 2 }).trigger, true);
assert.equal(statusPollQueueSelfHealPlan([staleQueued, { status: "RUNNING" }, { status: "RUNNING" }], {
  nowMs,
  processConcurrency: 2
}).reason, "worker_capacity_full");
const expiredRunning = {
  ...staleQueued,
  id: "job-expired-running",
  status: "RUNNING",
  lease_expires_at: "2026-07-20T00:00:20Z"
};
const expiredPlan = statusPollQueueSelfHealPlan([expiredRunning], { nowMs, processConcurrency: 2 });
assert.equal(expiredPlan.trigger, true, "an expired RUNNING lease must be reclaimed instead of faking full capacity");
assert.equal(expiredPlan.running_count, 0);
assert.equal(expiredPlan.stale_running_count, 1);
const readyRetry = {
  ...staleQueued,
  id: "job-retrying",
  status: "RETRYING",
  not_before: "2026-07-20T00:00:20Z"
};
assert.equal(statusPollQueueSelfHealPlan([readyRetry], { nowMs, processConcurrency: 2 }).trigger, true);
assert.equal(statusPollQueueSelfHealPlan([{ ...readyRetry, not_before: "2026-07-20T00:01:00Z" }], {
  nowMs,
  processConcurrency: 2
}).trigger, false);
assert.equal(statusPollQueueSelfHealPlan([{ ...staleQueued, created_at: "2026-07-20T00:00:25Z" }], {
  nowMs,
  processConcurrency: 2
}).reason, "queue_age_below_self_heal_floor");

let scheduled = null;
let request = null;
const triggered = triggerStatusPollQueueSelfHeal([staleQueued], {
  nowMs,
  env: { V4_JOB_WORKER_SECRET: "secret", V4_INTERNAL_BASE_URL: "https://listing.example.test" },
  acquireKick: async () => ({ ok: true, acquired: true }),
  fetchImpl: async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ ok: true, claimed_count: 1, processed_count: 1 }) };
  },
  defer: (promise) => { scheduled = promise; }
});
assert.equal(triggered.triggered, true);
await scheduled;
assert.equal(request.url, "https://listing.example.test/api/v4/listing-job-pump");
assert.equal(request.body.process_concurrency, 2);
assert.equal(request.body.background_only, true);
assert.equal(request.body.cycles, 30);
assert.equal(request.body.max_continuation_depth, 0);

scheduled = null;
request = null;
const backendRecovery = triggerStatusBackendRecovery({
  tenantId: "tenant-a",
  nowMs,
  env: { V4_JOB_WORKER_SECRET: "secret", V4_INTERNAL_BASE_URL: "https://listing.example.test" },
  acquireKick: async () => ({ ok: true, acquired: true }),
  fetchImpl: async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 202, json: async () => ({ ok: true, accepted: true }) };
  },
  defer: (promise) => { scheduled = promise; }
});
assert.equal(backendRecovery.triggered, true);
await scheduled;
assert.equal(request.url, "https://listing.example.test/api/v4/listing-job-pump");
assert.equal(request.body.self_heal_source_tenant_id, "tenant-a");
assert.equal(request.body.parallel_lanes, false);
assert.equal(request.body.cycles, 30);
assert.equal(request.body.max_continuation_depth, 0);

scheduled = null;
request = null;
triggerStatusBackendRecovery({
  tenantId: "tenant-a",
  nowMs,
  env: { V4_JOB_WORKER_SECRET: "secret", V4_INTERNAL_BASE_URL: "https://listing.example.test" },
  acquireKick: async () => ({ ok: false, error: "v4_supabase_timeout" }),
  fetchImpl: async () => {
    request = { unexpected: true };
    return { ok: true, status: 202, json: async () => ({ ok: true }) };
  },
  defer: (promise) => { scheduled = promise; }
});
const suppressedRecovery = await scheduled;
assert.equal(request, null, "a status outage must not amplify a failed database lock into another pump");
assert.equal(suppressedRecovery.reason, "wake_dedup_backend_unavailable");
console.log("v4 status poll queue self-heal tests passed");
