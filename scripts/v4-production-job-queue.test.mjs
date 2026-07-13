#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  claimV4RecognitionJobs,
  completeV4RecognitionJob,
  createV4DeterministicJobId,
  createV4DeterministicSessionId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  failV4RecognitionJob,
  heartbeatV4RecognitionJob,
  normalizeV4JobInput,
  readV4RecognitionJobs,
  releaseV4ProviderCapacityForJob,
  releasePairedV4FinalJob,
  tryAcquireV4QueueKick,
  v4JobLeaseHeartbeatEnabled,
  v4JobLeaseHeartbeatIntervalMs,
  v4JobLanes,
  v4JobTypes,
  v4JobStatuses
} from "../lib/listing/v4/jobs/production-job-queue.mjs";
import {
  payloadForV4ProductionJob,
  runWithV4JobLeaseHeartbeat,
  v4JobFailureCode
} from "../api/v4/listing-job-worker.js";
import { isV4CronRequest, isV4WorkerRequest, workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";
import { persistV4WriterReadyAndReleaseCapacity } from "../lib/listing/v4/session/session-store.mjs";

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

const repeatedRow = normalizeV4JobInput({
  batchId: "batch-test",
  operatorId: "operator-1",
  job: {
    asset_id: "asset-1",
    payload: { images: [{ url: "https://example.test/front.jpg" }] }
  }
});
assert.equal(repeatedRow.id, row.id, "same batch, asset and stage must reuse one paid job id");
assert.equal(repeatedRow.recognition_session_id, row.recognition_session_id);
assert.notEqual(createV4DeterministicJobId({ batchId: "other-batch", assetId: "asset-1" }), row.id);
assert.notEqual(createV4DeterministicSessionId({ batchId: "other-batch", assetId: "asset-1" }), row.recognition_session_id);

const stageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-staged",
  operatorId: "operator-stage",
  jobs: [{ asset_id: "asset-stage", payload: { images: [{ url: "https://example.test/a.jpg" }] } }]
});
assert.equal(stageJobs.length, 1);
assert.equal(stageJobs[0].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
assert.equal(stageJobs[0].lane, v4JobLanes.BACKGROUND);

const optInStageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-staged",
  operatorId: "operator-stage",
  jobs: [{ asset_id: "asset-stage", create_l1_job: true, payload: { images: [{ url: "https://example.test/a.jpg" }] } }]
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
const repeatedStageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-staged",
  operatorId: "operator-stage",
  jobs: [{ asset_id: "asset-stage", create_l1_job: true, payload: { images: [{ url: "https://example.test/a.jpg" }] } }]
});
assert.deepEqual(repeatedStageJobs.map((job) => job.id), optInStageJobs.map((job) => job.id));

const l2OnlyJobs = expandV4RecognitionStageJobs({
  jobs: [{ payload: { force_l2_only: true, images: [] } }]
});
assert.equal(l2OnlyJobs.length, 1);
assert.equal(l2OnlyJobs[0].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);

process.env.V4_QUEUE_DEFAULT_CREATE_L1 = "true";
const envDefaultL2Jobs = expandV4RecognitionStageJobs({
  jobs: [{ payload: { images: [] } }]
});
assert.equal(envDefaultL2Jobs.length, 2);
assert.equal(envDefaultL2Jobs[0].job_type, v4JobTypes.FAST_SCOUT_DRAFT);
const envOverrideL1Jobs = expandV4RecognitionStageJobs({
  jobs: [{ payload: { create_l1_job: false, images: [] } }]
});
assert.equal(envOverrideL1Jobs.length, 1);
assert.equal(envOverrideL1Jobs[0].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
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
const capacityLeasedPayload = payloadForV4ProductionJob({
  ...optInStageJobs[1],
  lease_owner: "worker-capacity-2",
  queue_tags: {
    ...optInStageJobs[1].queue_tags,
    provider_capacity_slot: 4,
    provider_key_slot: 2
  }
});
assert.equal(capacityLeasedPayload.openai_preferred_key_slot, 2);
assert.equal(capacityLeasedPayload.provider_capacity_slot, 4);
assert.equal(capacityLeasedPayload.v4_queue_worker_id, "worker-capacity-2");

const writes = [];
const fetchForWrites = async (url, request = {}) => {
  writes.push({ url: String(url), request });
  if (!request.method || request.method === "GET") return jsonResponse([]);
  const body = JSON.parse(request.body);
  return jsonResponse((Array.isArray(body) ? body : [body]).map((entry) => ({ ...entry })));
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
assert.equal(enqueue.persistence_mode, "bulk");
assert.equal(writes.filter((entry) => entry.url.includes("/v4_recognition_sessions") && entry.request.method === "POST").length, 1);
assert.equal(writes.filter((entry) => entry.url.includes("/v4_recognition_jobs") && entry.request.method === "POST").length, 1);
assert.equal(JSON.parse(writes.find((entry) => entry.url.includes("/v4_recognition_sessions") && entry.request.method === "POST").request.body).length, 2);
const jobWrite = writes.find((entry) => entry.url.includes("/v4_recognition_jobs") && entry.request.method === "POST");
assert.equal(JSON.parse(jobWrite.request.body).length, 2);
assert.ok(jobWrite.request.body.includes('"status":"QUEUED"'));
assert.match(jobWrite.request.headers.prefer, /resolution=ignore-duplicates/);

const existingQueuedJob = normalizeV4JobInput({
  batchId: "batch-dedup",
  operatorId: "operator-dedup",
  job: { asset_id: "asset-dedup", payload: { images: [] } }
});
const dedupWrites = [];
const dedupEnqueue = await enqueueV4RecognitionJobs({
  batchId: "batch-dedup",
  operatorId: "operator-dedup",
  jobs: [{ asset_id: "asset-dedup", payload: { images: [] } }],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    dedupWrites.push({ url: String(url), request });
    if ((!request.method || request.method === "GET") && String(url).includes("/v4_recognition_jobs")) {
      return jsonResponse([{ ...existingQueuedJob, status: v4JobStatuses.RUNNING }]);
    }
    if ((!request.method || request.method === "GET") && String(url).includes("/v4_recognition_sessions")) {
      return jsonResponse([{ id: existingQueuedJob.recognition_session_id }]);
    }
    return jsonResponse([]);
  }
});
assert.equal(dedupEnqueue.queued_count, 1);
assert.equal(dedupEnqueue.inserted_count, 0);
assert.equal(dedupEnqueue.deduplicated_count, 1);
assert.equal(dedupEnqueue.jobs[0].row.status, v4JobStatuses.RUNNING, "duplicate enqueue must preserve the active job");
assert.equal(dedupWrites.filter((entry) => entry.request.method === "POST").length, 0);

let sessionBatchFailed = false;
const fallbackWrites = [];
const fallbackEnqueue = await enqueueV4RecognitionJobs({
  batchId: "batch-fallback",
  operatorId: "operator-fallback",
  jobs: [
    { asset_id: "asset-fallback-a", payload: { images: [] } },
    { asset_id: "asset-fallback-b", payload: { images: [] } }
  ],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    fallbackWrites.push({ url: String(url), request });
    if (!request.method || request.method === "GET") return jsonResponse([]);
    const body = JSON.parse(request.body);
    if (String(url).includes("/v4_recognition_sessions") && Array.isArray(body) && !sessionBatchFailed) {
      sessionBatchFailed = true;
      return jsonResponse({ message: "temporary batch failure" }, { ok: false, status: 503 });
    }
    return jsonResponse((Array.isArray(body) ? body : [body]).map((entry) => ({ ...entry })));
  }
});
assert.equal(fallbackEnqueue.queued_count, 2);
assert.equal(fallbackEnqueue.persistence_mode, "bulk_with_row_fallback");
assert.equal(fallbackWrites.filter((entry) => entry.url.includes("/v4_recognition_sessions") && entry.request.method === "POST").length, 3);
assert.equal(fallbackWrites.filter((entry) => entry.url.includes("/v4_recognition_jobs") && entry.request.method === "POST").length, 1);

const rpcCalls = [];
const claim = await claimV4RecognitionJobs({
  limit: 3,
  workerId: "worker-a",
  leaseSeconds: 120,
  lane: v4JobLanes.INTERACTIVE,
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    OPENAI_API_KEY_1: "key-one",
    OPENAI_API_KEY_2: "key-two"
  },
  fetchImpl: async (url, request = {}) => {
    rpcCalls.push({ url: String(url), request });
    return jsonResponse([{ id: "v4job-claimed", status: "RUNNING", attempt_count: 1 }]);
  }
});
assert.equal(claim.ok, true);
assert.equal(claim.rows[0].id, "v4job-claimed");
assert.ok(rpcCalls[0].url.endsWith("/rest/v1/rpc/claim_v4_recognition_jobs_with_balanced_capacity"));
assert.ok(rpcCalls[0].request.body.includes('"p_limit":3'));
assert.ok(rpcCalls[0].request.body.includes('"p_lane":"interactive"'));
assert.ok(rpcCalls[0].request.body.includes('"p_provider_capacity":2'));
assert.ok(rpcCalls[0].request.body.includes('"p_per_key_concurrency":2'));
assert.ok(rpcCalls[0].request.body.includes('"p_provider_key_count":2'));

const schemaFallbackCalls = [];
const schemaFallbackClaim = await claimV4RecognitionJobs({
  limit: 2,
  workerId: "worker-schema-fallback",
  lane: v4JobLanes.BACKGROUND,
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    OPENAI_API_KEY: "key-one"
  },
  fetchImpl: async (url, request = {}) => {
    schemaFallbackCalls.push({ url: String(url), request });
    if (String(url).endsWith("/claim_v4_recognition_jobs_with_balanced_capacity")) {
      return jsonResponse({
        code: "PGRST202",
        message: "Could not find the function public.claim_v4_recognition_jobs_with_balanced_capacity in the schema cache"
      }, { ok: false, status: 404 });
    }
    return jsonResponse([{ id: "v4job-schema-fallback", status: "RUNNING" }]);
  }
});
assert.equal(schemaFallbackClaim.ok, true);
assert.equal(schemaFallbackClaim.rpc_mode, "capacity_schema_cache_fallback");
assert.equal(schemaFallbackClaim.fallback_reason, "balanced_capacity_rpc_not_visible");
assert.equal(schemaFallbackCalls.length, 2);
assert.ok(schemaFallbackCalls[1].url.endsWith("/rest/v1/rpc/claim_v4_recognition_jobs_with_capacity"));
assert.ok(!schemaFallbackCalls[1].request.body.includes("p_provider_key_count"));

const hardFailureCalls = [];
const hardFailureClaim = await claimV4RecognitionJobs({
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    OPENAI_API_KEY: "key-one"
  },
  fetchImpl: async (url, request = {}) => {
    hardFailureCalls.push({ url: String(url), request });
    return jsonResponse({ message: "database unavailable" }, { ok: false, status: 503 });
  }
});
assert.equal(hardFailureClaim.ok, false);
assert.equal(hardFailureClaim.rpc_mode, "balanced_capacity");
assert.equal(hardFailureCalls.length, 1, "arbitrary database failures must fail closed instead of bypassing capacity control");

const capacityRpcCalls = [];
const releasedCapacity = await releaseV4ProviderCapacityForJob({
  jobId: "v4job-claimed",
  workerId: "worker-a",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    capacityRpcCalls.push({ url: String(url), request });
    return jsonResponse(1);
  }
});
assert.equal(releasedCapacity.released, true);
assert.equal(releasedCapacity.released_count, 1);
assert.ok(capacityRpcCalls[0].url.endsWith("/rest/v1/rpc/release_v4_provider_capacity_for_job"));
assert.ok(capacityRpcCalls[0].request.body.includes('"p_job_id":"v4job-claimed"'));

const writerReadyCapacityCalls = [];
const writerReadyCapacity = await persistV4WriterReadyAndReleaseCapacity({
  sessionId: "v4sess-writer-ready",
  patch: {
    status: "DRAFT_READY",
    l2_status: "READY",
    l2_title: "Writer title",
    provider_result_summary: { writer_ready_capacity_release_mode: "writer_ready_atomic" }
  },
  jobId: "v4job-writer-ready",
  workerId: "worker-capacity-2",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    writerReadyCapacityCalls.push({ url: String(url), request });
    return jsonResponse({
      session_saved: true,
      provider_capacity_released: true,
      provider_capacity_released_count: 1,
      release_boundary: "writer_ready_atomic"
    });
  }
});
assert.equal(writerReadyCapacity.saved, true);
assert.equal(writerReadyCapacity.released, true);
assert.equal(writerReadyCapacity.released_count, 1);
assert.ok(writerReadyCapacityCalls[0].url.endsWith("/rest/v1/rpc/persist_v4_writer_ready_and_release_capacity"));
assert.deepEqual(JSON.parse(writerReadyCapacityCalls[0].request.body), {
  p_session_id: "v4sess-writer-ready",
  p_session_patch: {
    status: "DRAFT_READY",
    l2_status: "READY",
    l2_title: "Writer title",
    provider_result_summary: { writer_ready_capacity_release_mode: "writer_ready_atomic" }
  },
  p_job_id: "v4job-writer-ready",
  p_worker_id: "worker-capacity-2"
});

assert.equal(v4JobLeaseHeartbeatEnabled({}), true);
assert.equal(v4JobLeaseHeartbeatEnabled({ V4_JOB_LEASE_HEARTBEAT_ENABLED: "false" }), false);
assert.equal(v4JobLeaseHeartbeatIntervalMs({ leaseSeconds: 120, env: {} }), 40_000);
assert.equal(v4JobLeaseHeartbeatIntervalMs({ leaseSeconds: 300, env: {} }), 60_000);
assert.equal(v4JobLeaseHeartbeatIntervalMs({
  leaseSeconds: 30,
  env: { V4_JOB_LEASE_HEARTBEAT_INTERVAL_MS: "120000" }
}), 15_000, "a misconfigured heartbeat interval must remain below the active lease");

const heartbeatRpcCalls = [];
const heartbeat = await heartbeatV4RecognitionJob({
  jobId: "v4job-claimed",
  workerId: "worker-a",
  leaseSeconds: 300,
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    heartbeatRpcCalls.push({ url: String(url), request });
    return jsonResponse(true);
  }
});
assert.equal(heartbeat.extended, true);
assert.ok(heartbeatRpcCalls[0].url.endsWith("/rest/v1/rpc/heartbeat_v4_recognition_job"));
assert.deepEqual(JSON.parse(heartbeatRpcCalls[0].request.body), {
  p_job_id: "v4job-claimed",
  p_worker_id: "worker-a",
  p_lease_seconds: 300
});

let heartbeatPulses = 0;
const heartbeatRun = await runWithV4JobLeaseHeartbeat({
  job: { id: "v4job-long", lease_owner: "worker-long" },
  leaseSeconds: 300,
  intervalMs: 5,
  heartbeat: async () => {
    heartbeatPulses += 1;
    return { extended: true, skipped: false, error: null };
  },
  task: async () => {
    await new Promise((resolve) => setTimeout(resolve, 24));
    return "done";
  }
});
assert.equal(heartbeatRun.value, "done");
assert.ok(heartbeatRun.heartbeat.success_count >= 2);
const pulsesAfterCompletion = heartbeatPulses;
await new Promise((resolve) => setTimeout(resolve, 12));
assert.equal(heartbeatPulses, pulsesAfterCompletion, "heartbeat timer must stop when the job finishes");

assert.equal(v4JobFailureCode({
  statusCode: 200,
  body: { ok: false, message: "Provider response schema validation failed: unknown field" }
}), "SCHEMA_VALIDATION_FAILED", "a semantic failure returned over HTTP 200 must not be recorded as error code 200");
assert.equal(v4JobFailureCode({
  statusCode: 200,
  body: { ok: false, provider_result: { provider_error_type: "response_format_invalid" } }
}), "RESPONSE_FORMAT_INVALID");
assert.equal(v4JobFailureCode({ statusCode: 429, body: { ok: false } }), "HTTP_429");
assert.equal(v4JobFailureCode({ statusCode: 200, body: { ok: false } }), "V4_RESULT_NOT_OK");

const kickRpcCalls = [];
const kick = await tryAcquireV4QueueKick({
  scope: "global",
  owner: "enqueue-batch",
  leaseMs: 1200,
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    kickRpcCalls.push({ url: String(url), request });
    return jsonResponse(true);
  }
});
assert.equal(kick.ok, true);
assert.equal(kick.acquired, true);
assert.ok(kickRpcCalls[0].url.endsWith("/rest/v1/rpc/try_acquire_v4_queue_kick"));

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

const ownedCompletionCalls = [];
const staleOwnedCompletion = await completeV4RecognitionJob({
  jobId: "v4job-owned",
  workerId: "worker-original",
  result: { final_title: "Must not overwrite a reclaimed job" },
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    V4_JOB_COMPLETION_WRITE_ATTEMPTS: "3",
    V4_JOB_COMPLETION_RETRY_BASE_MS: "1"
  },
  fetchImpl: async (url, request = {}) => {
    ownedCompletionCalls.push({ url: String(url), request });
    return jsonResponse([]);
  }
});
const ownedCompletionUrl = new URL(ownedCompletionCalls[0].url);
assert.equal(ownedCompletionUrl.searchParams.get("status"), "eq.RUNNING");
assert.equal(ownedCompletionUrl.searchParams.get("lease_owner"), "eq.worker-original");
assert.equal(ownedCompletionCalls.length, 1, "a lost lease cannot recover through blind completion retries");
assert.equal(staleOwnedCompletion.saved, false);
assert.equal(staleOwnedCompletion.error, "row_not_matched");

const nulCompletionPatches = [];
const nulCompletion = await completeV4RecognitionJob({
  jobId: "v4job-nul-safe",
  result: {
    final_title: "Safe Title",
    raw_provider_fields: { product: "Topps\u0000 Chrome" }
  },
  timing: { worker_total_ms: 321 },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    nulCompletionPatches.push({ url: String(url), request });
    return jsonResponse([{ id: "v4job-nul-safe", status: "L2_READY" }]);
  }
});
assert.equal(nulCompletion.saved, true);
assert.equal(nulCompletion.write_attempts, 1, "an illegal Postgres NUL must be sanitized before the first completion write");
assert.equal(nulCompletion.completion_payload_sanitized_nul_count, 2, "result and stage_result each contain the source value");
assert.equal(nulCompletionPatches.length, 1);
assert.equal(nulCompletionPatches[0].request.body.includes("\\u0000"), false);
const nulCompletionBody = JSON.parse(nulCompletionPatches[0].request.body);
assert.equal(nulCompletionBody.result.raw_provider_fields.product, "Topps Chrome");
assert.equal(nulCompletionBody.timing.completion_payload_sanitized_nul_count, 2);

const completionRetryPatches = [];
const completionAfterRetry = await completeV4RecognitionJob({
  jobId: "v4job-completion-retry",
  result: { final_title: "Recovered completion" },
  previousError: {
    message: "first worker attempt failed",
    attempt_history: [{ attempt: 1, message: "first worker attempt failed" }]
  },
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    V4_JOB_COMPLETION_WRITE_ATTEMPTS: "3",
    V4_JOB_COMPLETION_RETRY_BASE_MS: "1"
  },
  fetchImpl: async (url, request = {}) => {
    completionRetryPatches.push({ url: String(url), request });
    if (completionRetryPatches.length === 1) {
      return jsonResponse({ message: "temporary postgrest error" }, { ok: false, status: 503 });
    }
    return jsonResponse([{ id: "v4job-completion-retry", status: "L2_READY" }]);
  }
});
assert.equal(completionAfterRetry.saved, true);
assert.equal(completionAfterRetry.write_attempts, 2);
assert.equal(completionRetryPatches.length, 2);
const completionRetryBody = JSON.parse(completionRetryPatches[1].request.body);
assert.equal(completionRetryBody.timing.completion_write_attempts, 2);
assert.equal(completionRetryBody.error.resolved, true);
assert.equal(completionRetryBody.error.attempt_history[0].message, "first worker attempt failed");

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
  job: {
    ...optInStageJobs[0],
    queue_tags: {
      ...optInStageJobs[0].queue_tags,
      provider_capacity_slot: 1,
      provider_key_slot: 1,
      provider_capacity_lease_owner: "l1-worker"
    }
  },
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
assert.ok(releasePatches[0].request.body.includes('"paired_l1_released_at"'));
assert.ok(!releasePatches[0].request.body.includes('"provider_capacity_slot"'), "paired L2 must not inherit the completed L1 capacity lease");

const multiStageJobs = expandV4RecognitionStageJobs({
  batchId: "batch-no-l2-barrier",
  operatorId: "operator-stage",
  jobs: [
    { asset_id: "asset-a", create_l1_job: true, payload: { images: [{ url: "https://example.test/a.jpg" }] } },
    { asset_id: "asset-b", create_l1_job: true, payload: { images: [{ url: "https://example.test/b.jpg" }] } }
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

let retryPatchBody = null;
const retry = await failV4RecognitionJob({
  job: {
    id: "v4job-retry",
    attempt_count: 1,
    max_attempts: 2,
    error: { attempt_history: [{ attempt: 0, message: "earlier failure" }] }
  },
  error: { message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    retryPatchBody = JSON.parse(request.body);
    return jsonResponse([{ id: "v4job-retry", status: "RETRYING" }]);
  }
});
assert.equal(retry.saved, true);
assert.equal(retryPatchBody.error.attempt_history.length, 2);
assert.equal(retryPatchBody.error.attempt_history[0].message, "earlier failure");
assert.equal(retryPatchBody.error.attempt_history[1].message, "provider timeout");

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

let schemaFailureBody = null;
await failV4RecognitionJob({
  job: { id: "v4job-schema-retry", attempt_count: 1, max_attempts: 2 },
  error: {
    message: "Provider response schema validation failed",
    code: "schema_validation_failed",
    http_status: 200,
    retryable: true
  },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    schemaFailureBody = JSON.parse(request.body);
    return jsonResponse([{ id: "v4job-schema-retry", status: "RETRYING" }]);
  }
});
assert.equal(schemaFailureBody.status, "RETRYING", "one fresh provider response may recover a malformed structured response");
assert.equal(schemaFailureBody.error.retryable, true);
assert.equal(schemaFailureBody.error.http_status, 200);
assert.equal(schemaFailureBody.completed_at, null);

let hiddenL1FailureBody = null;
await failV4RecognitionJob({
  job: { id: "v4job-l1-no-retry", attempt_count: 1, max_attempts: 2 },
  error: { message: "hidden scout failed" },
  forceFinalFailure: true,
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    hiddenL1FailureBody = JSON.parse(request.body);
    return jsonResponse([{ id: "v4job-l1-no-retry", status: "FAILED" }]);
  }
});
assert.equal(hiddenL1FailureBody.status, "FAILED", "a failed hidden L1 must hand off to L2 instead of re-entering the provider queue");
assert.equal(hiddenL1FailureBody.completed_at !== null, true);

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
assert.equal(isV4CronRequest({ headers: { authorization: "Bearer cron-secret" } }, { CRON_SECRET: "cron-secret" }), true);
assert.equal(isV4CronRequest({ headers: { authorization: "Bearer wrong" } }, { CRON_SECRET: "cron-secret" }), false);

console.log("v4 production job queue tests passed");
