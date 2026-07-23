#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pumpHandler, {
  runV4QueuePump,
  triggerV4QueuePumpContinuation
} from "../api/v4/listing-job-pump.js";
import { runPostEnqueueQueueKick } from "../api/v4/listing-job-enqueue.js";
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
assert.equal(pump.continuation_needed, false, "an idle observation after useful work must stop continuation churn");
assert.deepEqual(calls.map((entry) => entry.payload.lane), ["interactive", "background", "interactive", "background"]);
assert.equal(calls[0].payload.tenant_id, "tenant-batch-1");
assert.equal(calls[0].payload.limit, 2);
assert.equal(calls[0].payload.process_concurrency, 2);
assert.equal(calls[1].payload.limit, 4);
assert.equal(calls[1].payload.process_concurrency, 4);
assert.equal(calls[0].payload.pump_managed_drain, true);
assert.equal(calls[1].payload.pump_managed_drain, true);
assert.equal(calls[0].workerSecret, "secret");

const failedPump = await runV4QueuePump({
  payload: { background_only: true, cycles: 1 },
  env: { V4_JOB_WORKER_SECRET: "secret" },
  invokeWorker: async () => ({
    statusCode: 500,
    body: { ok: false, message: "Unable to claim V4 jobs." }
  })
});
assert.equal(failedPump.ok, false, "a failed worker call must make the pump fail instead of returning a false-green 200");
assert.equal(failedPump.failed_call_count, 1);
assert.equal(failedPump.failed_calls[0].message, "Unable to claim V4 jobs.");
assert.equal(failedPump.worker_invocation_retry_count, 1);
assert.equal(failedPump.worker_invocation_recovery_count, 0);

let transientInvocationAttempts = 0;
const recoveredPump = await runV4QueuePump({
  payload: { background_only: true, cycles: 1 },
  env: { V4_JOB_WORKER_SECRET: "secret" },
  invokeWorker: async () => {
    transientInvocationAttempts += 1;
    if (transientInvocationAttempts === 1) {
      throw new Error("temporary database connection reset");
    }
    return {
      statusCode: 200,
      body: { ok: true, claimed_count: 1, processed_count: 1 }
    };
  }
});
assert.equal(recoveredPump.ok, true);
assert.equal(transientInvocationAttempts, 2);
assert.equal(recoveredPump.worker_invocation_retry_count, 1);
assert.equal(recoveredPump.worker_invocation_recovery_count, 1);
assert.equal(recoveredPump.transient_worker_failure_count, 1);
assert.equal(recoveredPump.calls[0].invocation_attempt_count, 2);
assert.equal(recoveredPump.calls[0].invocation_recovered_after_retry, true);
assert.equal(recoveredPump.continuation_needed, true);

let nonRetryableInvocationAttempts = 0;
const nonRetryablePump = await runV4QueuePump({
  payload: { background_only: true, cycles: 1 },
  env: { V4_JOB_WORKER_SECRET: "secret" },
  invokeWorker: async () => {
    nonRetryableInvocationAttempts += 1;
    return {
      statusCode: 400,
      body: { ok: false, message: "invalid worker payload" }
    };
  }
});
assert.equal(nonRetryablePump.ok, false);
assert.equal(nonRetryableInvocationAttempts, 1, "a valid business rejection must never be replayed");
assert.equal(nonRetryablePump.worker_invocation_retry_count, 0);

const saturatedPump = await runV4QueuePump({
  payload: { background_only: true, cycles: 1 },
  env: { V4_JOB_WORKER_SECRET: "secret" },
  invokeWorker: async () => ({
    statusCode: 200,
    body: { ok: true, claimed_count: 1, processed_count: 1 }
  })
});
assert.equal(saturatedPump.continuation_needed, true, "a pump that ends while still claiming work must continue");
assert.equal(triggerV4QueuePumpContinuation(null, {}, pump, {
  V4_JOB_WORKER_SECRET: "secret",
  V4_INTERNAL_BASE_URL: "https://listing.example.test"
}).triggered, false, "an idle-observed pump must not schedule a redundant invocation");

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

const followupAcquisitions = [
  { ok: true, acquired: false },
  { ok: true, acquired: true }
];
const followupSleeps = [];
const followupFetches = [];
const delayedFollowup = await runPostEnqueueQueueKick({
  origin: "https://listing.example.test",
  secret: "secret",
  body: { reason: "post_enqueue", limit: 4 },
  kickOwner: "enqueue-batch",
  leaseMs: 1200,
  acquireKick: async () => followupAcquisitions.shift(),
  sleep: async (ms) => followupSleeps.push(ms),
  fetchImpl: async (url, init) => {
    followupFetches.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  }
});
assert.equal(delayedFollowup.phase, "followup");
assert.equal(delayedFollowup.acquired, true);
assert.deepEqual(followupSleeps, [1300]);
assert.equal(followupFetches.length, 1);
assert.equal(followupFetches[0].body.reason, "post_enqueue_deduplicated_followup");

let immediateSlept = false;
const immediateKick = await runPostEnqueueQueueKick({
  origin: "https://listing.example.test",
  secret: "secret",
  body: { reason: "post_enqueue" },
  kickOwner: "enqueue-immediate",
  leaseMs: 1200,
  acquireKick: async () => ({ ok: true, acquired: true }),
  sleep: async () => { immediateSlept = true; },
  fetchImpl: async () => ({ ok: true, status: 200 })
});
assert.equal(immediateKick.phase, "initial");
assert.equal(immediateSlept, false);

const failedKick = await runPostEnqueueQueueKick({
  origin: "https://listing.example.test",
  secret: "secret",
  body: { reason: "post_enqueue" },
  kickOwner: "enqueue-failed-pump",
  leaseMs: 1200,
  acquireKick: async () => ({ ok: true, acquired: true }),
  fetchImpl: async () => ({
    ok: false,
    status: 503,
    async json() {
      return {
        ok: false,
        failed_call_count: 1,
        claimed_count: 0,
        processed_count: 0,
        failed_calls: [{ message: "Unable to claim V4 jobs." }]
      };
    }
  })
});
assert.equal(failedKick.ok, false);
assert.equal(failedKick.error, "Unable to claim V4 jobs.");
assert.equal(failedKick.pump_failed_call_count, 1);

const enqueueSource = readFileSync(new URL("../api/v4/listing-job-enqueue.js", import.meta.url), "utf8");
assert.match(enqueueSource, /V4_PUMP_INTERACTIVE_CONCURRENCY/);
assert.match(enqueueSource, /V4_PUMP_BACKGROUND_CONCURRENCY/);
assert.match(enqueueSource, /V4_QUEUE_AUTOKICK_LIMIT_PER_WORKER/);
assert.match(enqueueSource, /V4_QUEUE_AUTOKICK_INTERACTIVE_WORKERS/);
assert.match(enqueueSource, /V4_QUEUE_AUTOKICK_BACKGROUND_WORKERS/);
assert.match(enqueueSource, /tryAcquireV4QueueKick/);
assert.match(enqueueSource, /v4QueueGlobalDrainEnabled/);
assert.match(enqueueSource, /post_enqueue_deduplicated_kick_scheduled/);
assert.match(enqueueSource, /post_enqueue_deduplicated_followup/);
assert.match(enqueueSource, /kick_source_tenant_id/);
assert.match(enqueueSource, /const stableConcurrency = v4WorkerProcessConcurrency\(env\)/);
assert.match(enqueueSource, /interactiveWorkers \* perWorkerLimit/);
assert.match(enqueueSource, /backgroundWorkers \* perWorkerLimit/);
assert.match(enqueueSource, /const interactiveConcurrency = Math\.min\(stableConcurrency, interactiveLimit\)/);
assert.match(enqueueSource, /const backgroundConcurrency = Math\.min\(stableConcurrency, backgroundLimit\)/);
assert.match(enqueueSource, /v4DurableQueueDrainContract/);
assert.doesNotMatch(enqueueSource, /cycles:\s*1/);
assert.match(enqueueSource, /background_limit: backgroundLimit/);
assert.match(enqueueSource, /interactive_limit: interactiveLimit/);
assert.match(enqueueSource, /interactive_process_concurrency: interactiveConcurrency/);

const workerSource = readFileSync(new URL("../api/v4/listing-job-worker.js", import.meta.url), "utf8");
assert.match(workerSource, /triggerV4BackgroundWorkerAfterL1Release/);
assert.match(workerSource, /l1_ready_wake_l2/);
assert.match(workerSource, /pairedRelease\.saved !== true/);
assert.match(workerSource, /background_only:\s*true/);
assert.match(workerSource, /V4_L2_WAKE_BACKGROUND_CONCURRENCY/);
assert.match(workerSource, /const globalFallback = v4WorkerProcessConcurrency\(process\.env\)/);
assert.match(workerSource, /positiveInteger\(process\.env\[laneKey\], globalFallback, \{ min: 1, max: 96 \}\)/);
assert.match(workerSource, /v4WorkerProcessConcurrency\(env\),\s*\{\s*min:\s*1,\s*max:\s*96\s*\}/);
assert.match(workerSource, /scheduleTrustedV4QueuePump/);
assert.match(workerSource, /dedupScope:\s*`l2-release:/);
assert.doesNotMatch(workerSource, /fetchImpl\(`\$\{origin\}\/api\/v4\/listing-job-worker`/);
assert.match(workerSource, /releaseV4ProviderCapacityForJob/);
assert.match(workerSource, /runWithV4JobLeaseHeartbeat/);
assert.match(workerSource, /v4_job_lease_heartbeat_degraded/);
assert.match(workerSource, /openai_preferred_key_slot/);
assert.match(workerSource, /provider_capacity_released/);
assert.match(workerSource, /forceFinalFailure: hiddenL1Job/, "a failed hidden L1 must release its final L2 without scheduling another paid L1 attempt");
assert.match(workerSource, /const maxBatches = 1/, "each serverless worker must own one short durable batch");
assert.match(workerSource, /V4_JOB_EXECUTION_TIMEOUT_MS/);
assert.match(workerSource, /V4_JOB_EXECUTION_TIMEOUT/);
assert.match(workerSource, /short_batch_continuation:\s*true/);

const pumpSource = readFileSync(new URL("../api/v4/listing-job-pump.js", import.meta.url), "utf8");
assert.match(pumpSource, /triggerV4QueuePumpContinuation/);
assert.match(pumpSource, /continuation_depth/);
assert.match(pumpSource, /continuation_triggered/);
assert.match(pumpSource, /lease_seconds: leaseSeconds/);
assert.match(pumpSource, /max_batches_per_invocation:\s*1/);

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

const balancedCapacityMigration = readFileSync(new URL("../supabase/migrations/20260712170000_v4_balanced_provider_key_slots.sql", import.meta.url), "utf8");
assert.match(balancedCapacityMigration, /claim_v4_recognition_jobs_with_balanced_capacity/);
assert.match(balancedCapacityMigration, /p_provider_key_count integer default 1/);
assert.match(balancedCapacityMigration, /\(\(slot_no - 1\) % provider_key_count\) \+ 1/);
assert.match(balancedCapacityMigration, /least\([\s\S]*provider_key_count \* per_key_concurrency/);
assert.match(balancedCapacityMigration, /'provider_key_assignment', 'balanced_round_robin_v1'/);
assert.match(balancedCapacityMigration, /for update of jobs skip locked/);
assert.match(balancedCapacityMigration, /revoke all on function public\.claim_v4_recognition_jobs_with_balanced_capacity/);
assert.match(balancedCapacityMigration, /notify pgrst, 'reload schema'/);

const tenantFairQueueMigration = readFileSync(new URL("../supabase/migrations/20260713224500_v4_tenant_fair_provider_queue.sql", import.meta.url), "utf8");
assert.match(tenantFairQueueMigration, /partition by coalesce\(nullif\(jobs\.tenant_id, ''\), nullif\(jobs\.batch_id, ''\), jobs\.id\)/);
assert.match(tenantFairQueueMigration, /'scheduling_fairness_scope'/);
assert.match(tenantFairQueueMigration, /'scheduling_fairness_key'/);
assert.match(tenantFairQueueMigration, /claim_v4_recognition_jobs_with_capacity[\s\S]*claim_v4_recognition_jobs_with_balanced_capacity/);
assert.match(tenantFairQueueMigration, /notify pgrst, 'reload schema'/);

const queueSchemaRefreshMigration = readFileSync(new URL("../supabase/migrations/20260712183000_refresh_v4_queue_rpc_schema.sql", import.meta.url), "utf8");
assert.match(queueSchemaRefreshMigration, /notify pgrst, 'reload schema'/);

const deploymentAffinityMigration = readFileSync(new URL("../supabase/migrations/20260719205025_v4_queue_deployment_affinity.sql", import.meta.url), "utf8");
assert.match(deploymentAffinityMigration, /current_setting\(''lynca\.deployment_affinity''/);
assert.match(deploymentAffinityMigration, /claim_v4_recognition_jobs_with_balanced_capacity_for_deployment/);
assert.match(deploymentAffinityMigration, /nullif\(jobs\.queue_tags ->> ''deployment_affinity''/);
assert.match(deploymentAffinityMigration, /grant execute[\s\S]*to service_role/);
assert.match(deploymentAffinityMigration, /notify pgrst, 'reload schema'/);

const assetLeasePruningMigration = readFileSync(new URL("../supabase/migrations/20260723022000_prune_asset_scoped_capacity_leases.sql", import.meta.url), "utf8");
assert.match(assetLeasePruningMigration, /v4_provider_capacity_active_job_idx[\s\S]*where job_id is not null/);
assert.match(assetLeasePruningMigration, /preingestion_jobs_status_type_priority_idx/);
assert.match(assetLeasePruningMigration, /create or replace function public\.release_v4_provider_capacity_for_job/);
assert.match(assetLeasePruningMigration, /stage:paddle_ocr:asset:/);
assert.match(assetLeasePruningMigration, /and leases\.job_id is null[\s\S]*and leases\.lease_owner is null[\s\S]*and leases\.lease_expires_at is null/);

const heartbeatSecurityMigration = readFileSync(new URL("../supabase/migrations/20260711194540_harden_public_function_security_and_queue_heartbeat.sql", import.meta.url), "utf8");
assert.match(heartbeatSecurityMigration, /create or replace function public\.heartbeat_v4_recognition_job/);
assert.match(heartbeatSecurityMigration, /jobs\.status = 'RUNNING'/);
assert.match(heartbeatSecurityMigration, /jobs\.lease_owner = p_worker_id/);
assert.match(heartbeatSecurityMigration, /update public\.v4_provider_capacity_leases/);
assert.match(heartbeatSecurityMigration, /revoke execute on all functions in schema public from public, anon, authenticated/);
assert.match(heartbeatSecurityMigration, /alter default privileges in schema public revoke execute on functions from public/);
assert.match(heartbeatSecurityMigration, /alter function %s set search_path = pg_catalog, public, extensions/);
assert.match(heartbeatSecurityMigration, /drop index if exists public\.catalog_cards_players_gin_idx/);

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
