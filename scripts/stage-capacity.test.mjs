import assert from "node:assert/strict";
import {
  listingStageCapacityPlan,
  listingStageIds,
  ocrPerAssetConcurrencyPlan,
  runWithListingStageCapacity
} from "../lib/listing/v4/orchestration/stage-capacity.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role"
};

const plan = listingStageCapacityPlan({
  ...env,
  PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED: "true",
  RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED: "true",
  VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED: "true"
});
assert.equal(plan.ocr.global_capacity, 8);
assert.equal(plan.ocr.per_asset_capacity, 2);
assert.equal(plan.ocr.anchor_concurrency, 6);
assert.equal(plan.ocr.detail_concurrency, 2);
assert.equal(plan.ocr.local_concurrency, 2);
assert.deepEqual(ocrPerAssetConcurrencyPlan(plan.ocr, { anchorJobCount: 6, detailJobCount: 4 }), {
  per_asset_capacity: 2,
  anchor_concurrency: 1,
  detail_concurrency: 1,
  local_concurrency: 2
});
assert.deepEqual(ocrPerAssetConcurrencyPlan(plan.ocr, { anchorJobCount: 6, detailJobCount: 0 }), {
  per_asset_capacity: 2,
  anchor_concurrency: 2,
  detail_concurrency: 0,
  local_concurrency: 2
});
assert.equal(plan.catalog.stage_id, listingStageIds.CATALOG_RETRIEVAL);
assert.equal(plan.catalog.global_capacity, 4);
assert.equal(plan.catalog.query_concurrency, 4);
assert.equal(plan.vector.stage_id, listingStageIds.VECTOR_EMBEDDING);
assert.equal(plan.vector.global_capacity, 4);
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
