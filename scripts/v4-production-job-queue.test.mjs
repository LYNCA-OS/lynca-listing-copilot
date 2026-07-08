#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  failV4RecognitionJob,
  normalizeV4JobInput,
  readV4RecognitionJobs,
  releasePairedV4FinalJob,
  v4JobLanes,
  v4JobTypes,
  v4JobStatuses
} from "../lib/listing/v4/jobs/production-job-queue.mjs";
import { payloadForV4ProductionJob } from "../api/v4/listing-job-worker.js";
import { isV4WorkerRequest, workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";

const originalDefaultCreateL1 = process.env.V4_QUEUE_DEFAULT_CREATE_L1;

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status || 200,
    async text() {
      return JSON.stringify(body);
    }
  };
}

const row = normalizeV4JobInput({
  batchId: "batch-test",
  operatorId: "operator-1",
  job: {
    asset_id: "asset-1",
    payload: {
      images: [{ url: "https://example.test/front.jpg" }]
    }
  }
});
assert.equal(row.batch_id, "batch-test");
assert.equal(row.asset_id, "asset-1");
assert.equal(row.status, v4JobStatuses.QUEUED);
assert.equal(row.lane, v4JobLanes.BACKGROUND);
assert.equal(row.job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
assert.equal(row.payload.recognition_session_id, row.recognition_session_id);
assert.ok(row.id.startsWith("v4job_"));
assert.ok(row.recognition_session_id.startsWith("v4sess_"));

const stageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-staged",
  operatorId: "operator-stage",
  jobs: [{ asset_id: "asset-stage", payload: { images: [{ url: "https://example.test/a.jpg" }] } }]
});
assert.equal(stageJobs.length, 2);
assert.equal(stageJobs[0].job_type, v4JobTypes.FAST_SCOUT_DRAFT);
assert.equal(stageJobs[0].lane, v4JobLanes.INTERACTIVE);
assert.equal(stageJobs[1].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
assert.equal(stageJobs[1].lane, v4JobLanes.BACKGROUND);

const optInStageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-staged",
  operatorId: "operator-stage",
  jobs: [{ asset_id: "asset-stage", enable_queue_fast_scout: true, payload: { images: [{ url: "https://example.test/a.jpg" }] } }]
});
assert.equal(optInStageJobs.length, 2);
assert.equal(optInStageJobs[0].job_type, v4JobTypes.FAST_SCOUT_DRAFT);
assert.equal(optInStageJobs[0].lane, v4JobLanes.INTERACTIVE);
assert.equal(optInStageJobs[1].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
assert.equal(optInStageJobs[1].lane, v4JobLanes.BACKGROUND);
assert.equal(optInStageJobs[0].recognition_session_id, optInStageJobs[1].recognition_session_id);
assert.equal(optInStageJobs[0].paired_job_id, optInStageJobs[1].id);
assert.equal(optInStageJobs[1].parent_job_id, optInStageJobs[0].id);
assert.ok(Date.parse(optInStageJobs[1].not_before) > Date.now() + 60_000, "paired L2 should wait for its L1 release when fast scout is explicitly enabled");

const l2OnlyJobs = expandV4RecognitionStageJobs({
  jobs: [{ payload: { force_l2_only: true, images: [] } }]
});
assert.equal(l2OnlyJobs.length, 1);
assert.equal(l2OnlyJobs[0].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);

process.env.V4_QUEUE_DEFAULT_CREATE_L1 = "false";
const envDefaultL2Jobs = expandV4RecognitionStageJobs({
  jobs: [{ payload: { images: [] } }]
});
assert.equal(envDefaultL2Jobs.length, 1);
assert.equal(envDefaultL2Jobs[0].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
const envOverrideL1Jobs = expandV4RecognitionStageJobs({
  jobs: [{ payload: { create_l1_job: true, images: [] } }]
});
assert.equal(envOverrideL1Jobs.length, 2);
if (originalDefaultCreateL1 === undefined) {
  delete process.env.V4_QUEUE_DEFAULT_CREATE_L1;
} else {
  process.env.V4_QUEUE_DEFAULT_CREATE_L1 = originalDefaultCreateL1;
}

const l1Payload = payloadForV4ProductionJob(optInStageJobs[0]);
assert.equal(l1Payload.v4_queue_l1_only, true);
assert.equal(l1Payload.v4_return_l1_writer_safe_draft, undefined);
assert.equal(l1Payload.v4_force_l2_direct, false);
assert.equal(l1Payload.disable_fast_scout_l1, false);
const l2Payload = payloadForV4ProductionJob(optInStageJobs[1]);
assert.equal(l2Payload.v4_force_l2_direct, true);
assert.equal(l2Payload.disable_fast_scout_l1, true);

const writes = [];
const fetchForWrites = async (url, request = {}) => {
  writes.push({ url: String(url), request });
  if (request.method === "GET") return jsonResponse([]);
  return jsonResponse([{ id: "v4job-test", recognition_session_id: "v4sess-test", status: "QUEUED" }]);
};
const enqueue = await enqueueV4RecognitionJobs({
  batchId: "batch-enqueue",
  operatorId: "operator-2",
  jobs: [
    { asset_id: "asset-a", payload: { images: [] } },
    { asset_id: "asset-b", payload: { images: [] } }
  ],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: fetchForWrites
});
assert.equal(enqueue.batchId, "batch-enqueue");
assert.equal(enqueue.queued_count, 2);
assert.equal(writes.filter((entry) => entry.url.includes("/v4_recognition_sessions") && entry.request.method === "POST").length, 2);
assert.equal(writes.filter((entry) => entry.url.includes("/v4_recognition_jobs")).length, 2);
assert.ok(writes.find((entry) => entry.url.includes("/v4_recognition_jobs")).request.body.includes('"status":"QUEUED"'));

const rpcCalls = [];
const claim = await claimV4RecognitionJobs({
  limit: 3,
  workerId: "worker-a",
  leaseSeconds: 120,
  lane: v4JobLanes.INTERACTIVE,
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    rpcCalls.push({ url: String(url), request });
    return jsonResponse([{ id: "v4job-claimed", status: "RUNNING", attempt_count: 1 }]);
  }
});
assert.equal(claim.ok, true);
assert.equal(claim.rows[0].id, "v4job-claimed");
assert.ok(rpcCalls[0].url.endsWith("/rest/v1/rpc/claim_v4_recognition_jobs"));
assert.ok(rpcCalls[0].request.body.includes('"p_limit":3'));
assert.ok(rpcCalls[0].request.body.includes('"p_lane":"interactive"'));

const patches = [];
await completeV4RecognitionJob({
  jobId: "v4job-done",
  result: { final_title: "Title" },
  timing: { worker_total_ms: 123 },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    patches.push({ url: String(url), request });
    return jsonResponse([{ id: "v4job-done", status: "L2_READY" }]);
  }
});
assert.ok(patches[0].url.includes("/rest/v1/v4_recognition_jobs?id=eq.v4job-done"));
assert.ok(patches[0].request.body.includes('"status":"L2_READY"'));
assert.ok(patches[0].request.body.includes('"lease_owner":null'));

const l1Patches = [];
await completeV4RecognitionJob({
  jobId: "v4job-l1-done",
  status: v4JobStatuses.L1_READY,
  result: { final_title: "Fast Title" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    l1Patches.push({ url: String(url), request });
    return jsonResponse([{ id: "v4job-l1-done", status: "L1_READY" }]);
  }
});
assert.ok(l1Patches[0].request.body.includes('"status":"L1_READY"'));
assert.ok(l1Patches[0].request.body.includes('"stage_result"'));

const releasePatches = [];
const release = await releasePairedV4FinalJob({
  job: optInStageJobs[0],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    releasePatches.push({ url: String(url), request });
    return jsonResponse([{ id: optInStageJobs[1].id, status: "QUEUED" }]);
  }
});
assert.equal(release.saved, true);
assert.ok(releasePatches[0].url.includes(`/v4_recognition_jobs?id=eq.${optInStageJobs[1].id}`));
assert.ok(releasePatches[0].request.body.includes('"not_before"'));
assert.ok(releasePatches[0].request.body.includes('"released_by_parent_job_id"'));

const multiStageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-no-l2-barrier",
  operatorId: "operator-stage",
  jobs: [
    { asset_id: "asset-a", enable_queue_fast_scout: true, payload: { images: [{ url: "https://example.test/a.jpg" }] } },
    { asset_id: "asset-b", enable_queue_fast_scout: true, payload: { images: [{ url: "https://example.test/b.jpg" }] } }
  ]
});
const multiReleasePatches = [];
const firstL1 = multiStageJobs.find((job) => job.asset_id === "asset-a" && job.job_type === v4JobTypes.FAST_SCOUT_DRAFT);
const firstL2 = multiStageJobs.find((job) => job.parent_job_id === firstL1.id);
const secondL2 = multiStageJobs.find((job) => job.asset_id === "asset-b" && job.job_type === v4JobTypes.FINAL_ASSISTED_TITLE);
await releasePairedV4FinalJob({
  job: firstL1,
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    multiReleasePatches.push({ url: String(url), request });
    return jsonResponse([{ id: firstL2.id, status: "QUEUED" }]);
  }
});
assert.equal(multiReleasePatches.length, 1);
assert.ok(multiReleasePatches[0].url.includes(`/v4_recognition_jobs?id=eq.${firstL2.id}`), "each L1 must release its own paired L2 immediately");
assert.ok(!multiReleasePatches[0].url.includes(secondL2.id), "one completed L1 must not wait for or release other cards' L2 jobs");

const retry = await failV4RecognitionJob({
  job: { id: "v4job-retry", attempt_count: 1, max_attempts: 2 },
  error: { message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async () => jsonResponse([{ id: "v4job-retry", status: "RETRYING" }])
});
assert.equal(retry.saved, true);

const finalFail = await failV4RecognitionJob({
  job: { id: "v4job-fail", attempt_count: 2, max_attempts: 2 },
  error: { message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    assert.ok(request.body.includes('"status":"FAILED"'));
    return jsonResponse([{ id: "v4job-fail", status: "FAILED" }]);
  }
});
assert.equal(finalFail.saved, true);

const reads = [];
await readV4RecognitionJobs({
  batchId: "batch-read",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url) => {
    reads.push(String(url));
    return jsonResponse([]);
  }
});
assert.ok(reads[0].includes("batch_id=eq.batch-read"));

assert.equal(isV4WorkerRequest({ headers: { [workerSecretHeader]: "secret" } }, { V4_JOB_WORKER_SECRET: "secret" }), true);
assert.equal(isV4WorkerRequest({ headers: { [workerSecretHeader]: "wrong" } }, { V4_JOB_WORKER_SECRET: "secret" }), false);
assert.equal(isV4WorkerRequest({ headers: { [workerSecretHeader]: "secret" } }, {}), false);

console.log("v4 production job queue tests passed");
