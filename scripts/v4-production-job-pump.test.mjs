#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    background_limit: 4,
    background_process_concurrency: 4,
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
assert.equal(pump.parallel_lanes, true);
assert.equal(pump.cycles_run, 2);
assert.equal(pump.claimed_count, 2);
assert.equal(pump.processed_count, 2);
assert.deepEqual(calls.map((entry) => entry.payload.lane), ["interactive", "background", "interactive", "background"]);
assert.equal(calls[0].payload.tenant_id, "tenant-batch-1");
assert.equal(calls[0].payload.limit, 2);
assert.equal(calls[0].payload.process_concurrency, 2);
assert.equal(calls[1].payload.limit, 4);
assert.equal(calls[1].payload.process_concurrency, 4);
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

const waitForReleasedL2Calls = [];
const l2WaitingPump = await runV4QueuePump({
  payload: {
    tenant_id: "tenant-wait-l2",
    cycles: 3,
    background_idle_cycles: 3,
    idle_delay_ms: 0
  },
  env: { V4_JOB_WORKER_SECRET: "secret" },
  invokeWorker: async (payload) => {
    waitForReleasedL2Calls.push(payload);
    if (payload.lane === "interactive") {
      return { statusCode: 200, body: { ok: true, claimed_count: waitForReleasedL2Calls.filter((call) => call.lane === "interactive").length === 1 ? 1 : 0, processed_count: 1 } };
    }
    const backgroundAttempt = waitForReleasedL2Calls.filter((call) => call.lane === "background").length;
    return {
      statusCode: 200,
      body: {
        ok: true,
        claimed_count: backgroundAttempt === 2 ? 1 : 0,
        processed_count: backgroundAttempt === 2 ? 1 : 0
      }
    };
  }
});
assert.equal(l2WaitingPump.claimed_count, 2);
assert.ok(waitForReleasedL2Calls.filter((call) => call.lane === "background").length >= 2, "background lane must wait for L1-released L2 work instead of exiting after one empty claim");

const enqueueSource = readFileSync(new URL("../api/v4/listing-job-enqueue.js", import.meta.url), "utf8");
assert.match(enqueueSource, /V4_PUMP_INTERACTIVE_CONCURRENCY/);
assert.match(enqueueSource, /V4_PUMP_BACKGROUND_CONCURRENCY/);
assert.match(enqueueSource, /V4_QUEUE_AUTOKICK_LIMIT_PER_WORKER/);
assert.match(enqueueSource, /V4_QUEUE_AUTOKICK_INTERACTIVE_WORKERS/);
assert.match(enqueueSource, /V4_QUEUE_AUTOKICK_BACKGROUND_WORKERS/);
assert.match(enqueueSource, /tryAcquireV4QueueKick/);
assert.match(enqueueSource, /v4QueueGlobalDrainEnabled/);
assert.match(enqueueSource, /post_enqueue_deduplicated_kick_scheduled/);
assert.match(enqueueSource, /kick_source_tenant_id/);
assert.match(enqueueSource, /const stableConcurrency = v4WorkerProcessConcurrency\(process\.env\)/);
assert.match(enqueueSource, /interactiveWorkers \* perWorkerLimit/);
assert.match(enqueueSource, /backgroundWorkers \* perWorkerLimit/);
assert.match(enqueueSource, /const interactiveConcurrency = Math\.min\(stableConcurrency, interactiveLimit\)/);
assert.match(enqueueSource, /const backgroundConcurrency = Math\.min\(stableConcurrency, backgroundLimit\)/);
assert.match(enqueueSource, /cycles:\s*2/);
assert.match(enqueueSource, /lease_seconds:\s*240/);
assert.match(enqueueSource, /continuation_cycles:\s*2/);
assert.match(enqueueSource, /max_continuation_depth:\s*20/);
assert.match(enqueueSource, /background_limit: backgroundLimit/);
assert.match(enqueueSource, /interactive_limit: interactiveLimit/);
assert.match(enqueueSource, /interactive_process_concurrency: interactiveConcurrency/);

const workerSource = readFileSync(new URL("../api/v4/listing-job-worker.js", import.meta.url), "utf8");
assert.match(workerSource, /triggerV4BackgroundWorkerAfterL1Release/);
assert.match(workerSource, /l1_ready_wake_l2/);
assert.match(workerSource, /pairedRelease\.saved !== true/);
assert.match(workerSource, /lane: v4JobLanes\.BACKGROUND/);
assert.match(workerSource, /V4_L2_WAKE_BACKGROUND_CONCURRENCY/);
assert.match(workerSource, /v4WorkerProcessConcurrency\(process\.env\),\s*\{\s*min:\s*1,\s*max:\s*96\s*\}/);
assert.match(workerSource, /callJsonHandler\(handler/);
assert.match(workerSource, /releaseV4ProviderCapacityForJob/);
assert.match(workerSource, /openai_preferred_key_slot/);
assert.match(workerSource, /provider_capacity_released/);

const pumpSource = readFileSync(new URL("../api/v4/listing-job-pump.js", import.meta.url), "utf8");
assert.match(pumpSource, /triggerV4QueuePumpContinuation/);
assert.match(pumpSource, /continuation_depth/);
assert.match(pumpSource, /continuation_triggered/);
assert.match(pumpSource, /lease_seconds: leaseSeconds/);

const reclaimMigration = readFileSync(new URL("../supabase/migrations/20260708043000_v4_queue_reclaim_expired_running_jobs.sql", import.meta.url), "utf8");
assert.match(reclaimMigration, /status = 'RUNNING' and lease_expires_at is not null and lease_expires_at < now\(\)/);
assert.match(reclaimMigration, /where status in \('QUEUED', 'RETRYING', 'RUNNING'\)/);

const executionControlMigration = readFileSync(new URL("../supabase/migrations/20260710055802_v4_execution_control_plane_v1.sql", import.meta.url), "utf8");
assert.match(executionControlMigration, /create table if not exists public\.v4_provider_capacity_leases/);
assert.match(executionControlMigration, /claim_v4_recognition_jobs_with_capacity/);
assert.match(executionControlMigration, /row_number\(\) over/);
assert.match(executionControlMigration, /partition by coalesce\(nullif\(jobs\.batch_id, ''\), nullif\(jobs\.tenant_id, ''\), jobs\.id\)/);
assert.match(executionControlMigration, /provider_key_slot/);
assert.match(executionControlMigration, /for update of jobs skip locked/);
assert.match(executionControlMigration, /release_v4_provider_capacity_for_job/);
assert.match(executionControlMigration, /try_acquire_v4_queue_kick/);

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
