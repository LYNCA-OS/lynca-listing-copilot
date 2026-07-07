#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  enqueueV4RecognitionJobs,
  failV4RecognitionJob,
  normalizeV4JobInput,
  readV4RecognitionJobs,
  v4JobStatuses
} from "../lib/listing/v4/jobs/production-job-queue.mjs";
import { isV4WorkerRequest, workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";

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
assert.equal(row.payload.recognition_session_id, row.recognition_session_id);
assert.ok(row.id.startsWith("v4job_"));
assert.ok(row.recognition_session_id.startsWith("v4sess_"));

const writes = [];
const fetchForWrites = async (url, request = {}) => {
  writes.push({ url: String(url), request });
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
assert.equal(writes.length, 2);
assert.ok(writes[0].request.body.includes('"status":"QUEUED"'));

const rpcCalls = [];
const claim = await claimV4RecognitionJobs({
  limit: 3,
  workerId: "worker-a",
  leaseSeconds: 120,
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
