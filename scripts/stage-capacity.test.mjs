import assert from "node:assert/strict";
import {
  listingStageCapacityPlan,
  listingStageIds,
  ocrGlobalConcurrencyPlan,
  ocrPerAssetConcurrencyPlan,
  runWithListingStageCapacity,
  startListingStageCapacityHeartbeats
} from "../lib/listing/v4/orchestration/stage-capacity.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role"
};

const plan = listingStageCapacityPlan({
  ...env,
  PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED: "true",
  RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED: "true",
  VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED: "true",
  PREINGESTION_OCR_GLOBAL_CAPACITY: "24",
  PREINGESTION_OCR_PER_ASSET_CAPACITY: "8",
  PREINGESTION_OCR_PER_ASSET_BATCH_SIZE: "8",
  PREINGESTION_OCR_ANCHOR_CONCURRENCY: "24",
  PREINGESTION_OCR_DETAIL_CONCURRENCY: "24",
  RETRIEVAL_CATALOG_GLOBAL_CAPACITY: "8",
  VECTOR_QUERY_GLOBAL_CAPACITY: "12"
});
assert.equal(plan.ocr.global_capacity, 8, "runtime overrides must not exceed the measured OCR knee");
assert.equal(plan.ocr.per_asset_capacity, 1);
assert.equal(plan.ocr.per_asset_batch_size, 3);
assert.equal(plan.ocr.anchor_concurrency, 8);
assert.equal(plan.ocr.detail_concurrency, 2);
assert.equal(plan.ocr.local_concurrency, 1);
assert.equal(plan.ocr.per_asset_capacity, 1, "per-asset OCR concurrency is a frozen measured limit");
assert.equal(plan.ocr.per_asset_batch_size, 3, "per-asset claim batch is a frozen measured limit");
assert.equal(plan.ocr.detail_concurrency, 2, "detail OCR lane cannot be raised above its measured limit");
assert.deepEqual(ocrPerAssetConcurrencyPlan(plan.ocr, { anchorJobCount: 6, detailJobCount: 4 }), {
  per_asset_capacity: 1,
  anchor_concurrency: 1,
  detail_concurrency: 0,
  local_concurrency: 1
});
assert.deepEqual(ocrPerAssetConcurrencyPlan(plan.ocr, { anchorJobCount: 6, detailJobCount: 0 }), {
  per_asset_capacity: 1,
  anchor_concurrency: 1,
  detail_concurrency: 0,
  local_concurrency: 1
});
assert.deepEqual(ocrGlobalConcurrencyPlan(plan.ocr, { anchorJobCount: 8, detailJobCount: 4 }), {
  global_capacity: 8,
  anchor_concurrency: 6,
  detail_concurrency: 2,
  local_concurrency: 8
});
assert.deepEqual(ocrGlobalConcurrencyPlan(plan.ocr, { anchorJobCount: 10, detailJobCount: 0 }), {
  global_capacity: 8,
  anchor_concurrency: 8,
  detail_concurrency: 0,
  local_concurrency: 8
});
assert.deepEqual(ocrGlobalConcurrencyPlan(plan.ocr, { anchorJobCount: 0, detailJobCount: 10 }), {
  global_capacity: 8,
  anchor_concurrency: 0,
  detail_concurrency: 2,
  local_concurrency: 2
});
assert.equal(plan.catalog.stage_id, listingStageIds.CATALOG_RETRIEVAL);
assert.equal(plan.catalog.global_capacity, 1, "runtime overrides must not exceed the measured catalog knee");
assert.equal(plan.catalog.query_concurrency, 4);
assert.equal(plan.vector.stage_id, listingStageIds.VECTOR_EMBEDDING);
assert.equal(plan.vector.global_capacity, 3, "runtime overrides must not exceed the measured vector knee");
assert.equal(plan.vector.index_concurrency, 2);

let disabledTaskCount = 0;
const disabled = await runWithListingStageCapacity({
  plan: listingStageCapacityPlan({}).catalog,
  jobId: "catalog-disabled",
  task: async () => {
    disabledTaskCount += 1;
    return "ok";
  },
  fetchImpl: async () => {
    throw new Error("disabled control must not call Supabase");
  }
});
assert.equal(disabledTaskCount, 1);
assert.equal(disabled.executed, true);
assert.equal(disabled.value, "ok");
assert.equal(disabled.stage_capacity.coordinated, false);

const rpcCalls = [];
let acquireCalls = 0;
const coordinated = await runWithListingStageCapacity({
  plan: {
    ...plan.catalog,
    capacity_wait_ms: 100,
    capacity_poll_ms: 1
  },
  jobId: "catalog-1",
  owner: "test-owner",
  env,
  fetchImpl: async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    rpcCalls.push({ path, body });
    if (path.endsWith("/acquire_v4_stage_capacity")) {
      acquireCalls += 1;
      return new Response(JSON.stringify(acquireCalls === 1 ? null : 2), { status: 200 });
    }
    if (path.endsWith("/release_v4_stage_capacity")) {
      return new Response(JSON.stringify(1), { status: 200 });
    }
    throw new Error(`unexpected RPC ${path}`);
  },
  task: async (capacity) => ({ slot: capacity.slot })
});
assert.equal(coordinated.executed, true);
assert.equal(coordinated.value.slot, 2);
assert.equal(coordinated.stage_capacity.attempts, 2);
assert.equal(coordinated.stage_capacity.released, true);
assert.equal(rpcCalls.at(-1).body.p_job_id, "catalog-1");

let heartbeatAcquireCalls = 0;
let releaseCalls = 0;
const heartbeating = await runWithListingStageCapacity({
  plan: {
    ...plan.ocr,
    capacity_heartbeat_ms: 5
  },
  jobId: "ocr-long-running",
  owner: "heartbeat-owner",
  env,
  fetchImpl: async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/acquire_v4_stage_capacity")) {
      heartbeatAcquireCalls += 1;
      return new Response(JSON.stringify(1), { status: 200 });
    }
    if (path.endsWith("/release_v4_stage_capacity")) {
      releaseCalls += 1;
      if (releaseCalls === 1) return new Response("temporary failure", { status: 503 });
      return new Response(JSON.stringify(1), { status: 200 });
    }
    throw new Error(`unexpected RPC ${path}`);
  },
  task: async () => {
    await new Promise((resolve) => setTimeout(resolve, 24));
    return "renewed";
  }
});
assert.equal(heartbeating.value, "renewed");
assert.ok(heartbeatAcquireCalls >= 2, "a long-running stage must renew its lease before expiry");
assert.ok(heartbeating.stage_capacity.heartbeat_attempts >= 1);
assert.equal(heartbeating.stage_capacity.heartbeat_failures, 0);
assert.equal(heartbeating.stage_capacity.heartbeat_lost_ownership_count, 0);
assert.equal(heartbeating.stage_capacity.released, true);
assert.equal(heartbeating.stage_capacity.release_attempts, 2, "idempotent release retries one transient failure");

let dualLeaseRenewals = 0;
const dualLeaseHeartbeat = startListingStageCapacityHeartbeats({
  leases: [
    { stageId: "paddle_ocr", jobId: "ocr-dual", owner: "ocr-worker", capacity: 8, leaseSeconds: 90 },
    { stageId: "paddle_ocr:asset:asset-1", jobId: "ocr-dual", owner: "ocr-worker", capacity: 1, leaseSeconds: 90 }
  ],
  heartbeatIntervalMs: 5,
  env,
  fetchImpl: async (url) => {
    const path = new URL(String(url)).pathname;
    assert.ok(path.endsWith("/acquire_v4_stage_capacity"));
    dualLeaseRenewals += 1;
    return new Response(JSON.stringify(1), { status: 200 });
  }
});
await new Promise((resolve) => setTimeout(resolve, 18));
const dualLeaseTelemetry = await dualLeaseHeartbeat.stop();
assert.equal(dualLeaseTelemetry.heartbeat_lease_count, 2);
assert.ok(dualLeaseTelemetry.heartbeat_attempts >= 1);
assert.equal(dualLeaseTelemetry.heartbeat_request_count, dualLeaseTelemetry.heartbeat_attempts * 2);
assert.equal(dualLeaseRenewals, dualLeaseTelemetry.heartbeat_request_count);
assert.equal(dualLeaseTelemetry.heartbeat_failures, 0);

let missingConfigTaskCount = 0;
const missingConfig = await runWithListingStageCapacity({
  plan: plan.vector,
  jobId: "vector-1",
  env: {},
  task: async () => {
    missingConfigTaskCount += 1;
  }
});
assert.equal(missingConfig.executed, false);
assert.equal(missingConfigTaskCount, 0);
assert.equal(missingConfig.stage_capacity.configured, false);

let releasedAfterFailure = false;
await assert.rejects(() => runWithListingStageCapacity({
  plan: plan.vector,
  jobId: "vector-failure",
  owner: "test-owner",
  env,
  fetchImpl: async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/acquire_v4_stage_capacity")) {
      return new Response(JSON.stringify(1), { status: 200 });
    }
    if (path.endsWith("/release_v4_stage_capacity")) {
      releasedAfterFailure = true;
      return new Response(JSON.stringify(1), { status: 200 });
    }
    throw new Error(`unexpected RPC ${path}`);
  },
  task: async () => {
    throw new Error("stage task failed");
  }
}), /stage task failed/);
assert.equal(releasedAfterFailure, true);

console.log("stage capacity tests passed");
