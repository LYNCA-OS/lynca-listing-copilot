#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  statusPollQueueSelfHealPlan,
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
const releasedPostProvider = {
  status: "RUNNING",
  queue_tags: {
    provider_capacity_released: true,
    provider_capacity_released_at: "2026-07-20T00:00:20Z"
  }
};
const releasedPlan = statusPollQueueSelfHealPlan([
  staleQueued,
  releasedPostProvider,
  { status: "RUNNING" }
], { nowMs, processConcurrency: 2 });
assert.equal(releasedPlan.trigger, true, "post-provider work must not strand a free provider slot");
assert.equal(releasedPlan.running_count, 1);
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
assert.equal(request.body.cycles, 1);
console.log("v4 status poll queue self-heal tests passed");
