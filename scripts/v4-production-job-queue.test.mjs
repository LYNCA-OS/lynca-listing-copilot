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
  requestV4RecognitionJobRecovery,
  releaseV4ProviderCapacityForJob,
  releasePairedV4FinalJob,
  tryAcquireV4QueueKick,
  v4JobLeaseHeartbeatEnabled,
  v4JobLeaseHeartbeatIntervalMs,
  v4JobLanes,
  v4JobTypes,
  v4JobStatuses,
  v4QueueSubmissionConcurrency
} from "../lib/listing/v4/jobs/production-job-queue.mjs";
import {
  payloadForV4ProductionJob,
  runWithV4JobLeaseHeartbeat,
  v4JobFailureCode
} from "../api/v4/listing-job-worker.js";
import {
  authorizeFreshManualRetryJobs,
  canonicalizeQueueJobs,
  createQueueRequestBatchId,
  queueJobsRequireCreatePermission,
  queueJobsRequireRetryPermission
} from "../api/v4/listing-job-enqueue.js";
import { isV4CronRequest, isV4WorkerRequest, workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";
import { persistV4WriterReadyAndReleaseCapacity } from "../lib/listing/v4/session/session-store.mjs";

const originalDefaultCreateL1 = process.env.V4_QUEUE_DEFAULT_CREATE_L1;

assert.equal(
  v4QueueSubmissionConcurrency({}),
  2,
  "queue submission should default to the measured stable provider capacity"
);
assert.equal(
  v4QueueSubmissionConcurrency({ V4_QUEUE_SUBMISSION_CONCURRENCY: "6" }),
  2,
  "queue submission capacity must remain pinned to the measured stable contract"
);
assert.equal(
  v4QueueSubmissionConcurrency({ V4_QUEUE_SUBMISSION_CONCURRENCY: "99" }),
  2,
  "unsafe queue submission overrides must not bypass the measured contract"
);

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

const selfExclusionFeedbackId = "feedback-current-card";
const selfExclusionAssetId = "asset_33333333-3333-4333-8333-333333333333";
const selfExclusionGenerationId = "asset_44444444-4444-4444-8444-444444444444";
const canonicalizedSelfExclusionJob = await canonicalizeQueueJobs({
  tenantId: "tenant-stage",
  jobs: [{
    asset_id: selfExclusionAssetId,
    image_generation_id: selfExclusionGenerationId,
    payload: {
      asset_id: selfExclusionAssetId,
      image_generation_id: selfExclusionGenerationId,
      source_feedback_id: selfExclusionFeedbackId,
      images: [{ url: "data:image/jpeg;base64,client-transport-must-be-replaced" }]
    }
  }],
  readCanonical: async () => ({
    image_generation_id: selfExclusionGenerationId,
    image_set_sha256: "canonical-image-set-sha",
    expected_original_count: 2,
    images: [
      { image_id: "front", bucket: "listing-feedback-images", object_path: "feedback/current/front.jpg" },
      { image_id: "back", bucket: "listing-feedback-images", object_path: "feedback/current/back.jpg" }
    ],
    image_references: [],
    image_paths: {}
  })
});
assert.equal(
  canonicalizedSelfExclusionJob[0].payload.source_feedback_id,
  selfExclusionFeedbackId,
  "canonical image rebinding must preserve the blind-eval self-exclusion identity"
);
assert.equal(canonicalizedSelfExclusionJob[0].payload.images.length, 2);

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

const freshRetryAssetId = "asset_11111111-1111-4111-8111-111111111111";
assert.equal(
  queueJobsRequireRetryPermission([{ payload: { retry_of_job_id: "v4job_failed_prior" } }]),
  true,
  "a nested retry reference must require the explicit RETRY_JOB permission even without a browser boolean"
);
assert.equal(
  queueJobsRequireRetryPermission([{ asset_id: freshRetryAssetId, payload: {} }]),
  false,
  "ordinary creates must not be reclassified as retries"
);
assert.equal(queueJobsRequireCreatePermission([{ asset_id: freshRetryAssetId, payload: {} }]), true);
assert.equal(queueJobsRequireCreatePermission([{ asset_id: freshRetryAssetId, retry_of_job_id: "v4job_failed_prior" }]), false);
const streamedBatchA = createQueueRequestBatchId({
  clientBatchToken: "client-batch",
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  jobs: [{ asset_id: freshRetryAssetId }]
});
const streamedBatchARepeat = createQueueRequestBatchId({
  clientBatchToken: "client-batch",
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  jobs: [{ asset_id: freshRetryAssetId }]
});
const streamedBatchB = createQueueRequestBatchId({
  clientBatchToken: "client-batch",
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  jobs: [{ asset_id: "asset_22222222-2222-4222-8222-222222222222" }]
});
assert.equal(streamedBatchA, streamedBatchARepeat, "the same streamed card must keep an idempotent batch id");
assert.notEqual(streamedBatchA, streamedBatchB, "different streamed cards must not contend for one immutable batch row");
await assert.rejects(() => authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  permissionContext: { role: "MANAGER", userId: "operator-stage" },
  jobs: [{ asset_id: freshRetryAssetId, manual_retry: true, payload: {} }],
  readRows: async () => ({ ok: true, rows: [] })
}), /manual_retry_reference_required/, "a browser boolean alone must never authorize interactive priority");

const authorizedManualRetryJobs = await authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  permissionContext: { role: "MANAGER", userId: "operator-stage" },
  jobs: [{
    asset_id: freshRetryAssetId,
    priority: 0,
    manual_retry: true,
    retry_of_job_id: "v4job_failed_prior",
    force_l2_only: true,
    queue_tags: {
      manual_retry_requested_by_user_id: "forged-requester",
      manual_retry_original_operator_id: "forged-original"
    },
    payload: { force_l2_only: true, manual_retry: true, retry_of_job_id: "v4job_failed_prior", images: [] }
  }],
  readRows: async ({ search }) => {
    assert.equal(search.tenant_id, "eq.tenant-stage");
    assert.equal("operator_id" in search, false, "a tenant retry manager must not be restricted to jobs they originally created");
    return {
      ok: true,
      rows: [{
        id: "v4job_failed_prior",
        tenant_id: "tenant-stage",
        operator_id: "operator-original",
        assigned_to_user_id: "operator-original",
        asset_id: freshRetryAssetId,
        status: "FAILED"
      }]
    };
  }
});
assert.equal(authorizedManualRetryJobs[0].trusted_manual_retry, true);
assert.equal(authorizedManualRetryJobs[0].queue_tags.manual_retry_requested_by_user_id, "operator-stage");
assert.equal(authorizedManualRetryJobs[0].queue_tags.manual_retry_original_operator_id, "operator-original");
const freshManualRetryJobs = expandV4RecognitionStageJobs({
  batchId: "batch-fresh-manual-retry",
  operatorId: "operator-stage",
  tenantId: "tenant-stage",
  priority: 0,
  jobs: authorizedManualRetryJobs
});
assert.equal(freshManualRetryJobs.length, 1);
assert.equal(freshManualRetryJobs[0].job_type, v4JobTypes.FINAL_ASSISTED_TITLE);
assert.equal(freshManualRetryJobs[0].lane, v4JobLanes.INTERACTIVE, "a fresh writer retry must not fall back into the background lane");
assert.equal(freshManualRetryJobs[0].priority, 0, "priority zero must survive normalization");
assert.equal(freshManualRetryJobs[0].queue_tags.manual_retry_queue_policy, "interactive_priority_zero");
assert.equal(freshManualRetryJobs[0].queue_tags.manual_retry_requested_by_user_id, "operator-stage");
assert.equal(freshManualRetryJobs[0].queue_tags.manual_retry_original_operator_id, "operator-original");

await assert.rejects(() => authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  permissionContext: { role: "MANAGER", userId: "operator-stage" },
  jobs: authorizedManualRetryJobs.map(({ trusted_manual_retry: _trusted, ...job }) => ({ ...job, manual_retry: true })),
  readRows: async () => ({
    ok: true,
    rows: [{
      id: "v4job_failed_prior",
      tenant_id: "tenant-other",
      operator_id: "operator-original",
      asset_id: freshRetryAssetId,
      status: "FAILED"
    }]
  })
}), /manual_retry_reference_not_retryable/, "a service-role response from another tenant must fail closed even when the job id and asset match");

await assert.rejects(() => authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  permissionContext: { role: "MANAGER", userId: "operator-stage" },
  jobs: authorizedManualRetryJobs.map(({ trusted_manual_retry: _trusted, ...job }) => ({ ...job, manual_retry: true })),
  readRows: async () => ({
    ok: true,
    rows: [{
      id: "v4job_failed_prior",
      tenant_id: "tenant-stage",
      operator_id: "operator-stage",
      asset_id: "asset_99999999-9999-4999-8999-999999999999",
      status: "FAILED"
    }]
  })
}), /manual_retry_reference_not_retryable/, "a retry reference from another asset must fail closed");

await assert.rejects(() => authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "operator-stage",
  permissionContext: { role: "MANAGER", userId: "operator-stage" },
  jobs: authorizedManualRetryJobs.map(({ trusted_manual_retry: _trusted, ...job }) => ({ ...job, manual_retry: true })),
  readRows: async () => ({
    ok: true,
    rows: [{
      id: "v4job_failed_prior",
      tenant_id: "tenant-stage",
      operator_id: "operator-original",
      asset_id: freshRetryAssetId,
      status: "RUNNING"
    }]
  })
}), /manual_retry_reference_not_retryable/, "an active job must never be promoted as a fresh priority retry");

const writerAuthorizedRetry = await authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "writer-stage",
  permissionContext: { role: "WRITER", userId: "writer-stage" },
  jobs: [{
    asset_id: freshRetryAssetId,
    manual_retry: true,
    retry_of_job_id: "v4job_writer_failed",
    payload: { manual_retry: true, retry_of_job_id: "v4job_writer_failed" }
  }],
  readRows: async () => ({
    ok: true,
    rows: [{
      id: "v4job_writer_failed",
      tenant_id: "tenant-stage",
      operator_id: "operator-original",
      assigned_to_user_id: "writer-stage",
      asset_id: freshRetryAssetId,
      status: "FAILED"
    }]
  })
});
assert.equal(writerAuthorizedRetry[0].trusted_manual_retry, true, "a writer may retry their assigned failed card");
await assert.rejects(() => authorizeFreshManualRetryJobs({
  tenantId: "tenant-stage",
  operatorId: "writer-other",
  permissionContext: { role: "WRITER", userId: "writer-other" },
  jobs: [{
    asset_id: freshRetryAssetId,
    manual_retry: true,
    retry_of_job_id: "v4job_writer_failed",
    payload: { manual_retry: true, retry_of_job_id: "v4job_writer_failed" }
  }],
  readRows: async () => ({
    ok: true,
    rows: [{
      id: "v4job_writer_failed",
      tenant_id: "tenant-stage",
      operator_id: "operator-original",
      assigned_to_user_id: "writer-stage",
      asset_id: freshRetryAssetId,
      status: "FAILED"
    }]
  })
}), /manual_retry_permission_denied/, "a writer must not retry another writer's failed card");

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
function atomicEnqueueResponse(request = {}, overrides = {}) {
  const body = JSON.parse(request.body || "{}");
  const jobs = Array.isArray(body.p_jobs) ? body.p_jobs : [];
  return {
    saved: true,
    batch_id: body.p_batch?.id,
    jobs: jobs.map((job) => ({
      saved: true,
      row: { ...job },
      error: null,
      deduplicated: false,
      ...overrides.job
    })),
    accepted_count: jobs.length,
    queued_count: jobs.length,
    inserted_count: jobs.length,
    deduplicated_count: 0,
    session_rows_written: Array.isArray(body.p_sessions) ? body.p_sessions.length : 0,
    job_rows_written: jobs.length,
    ...overrides.transaction
  };
}
const fetchForWrites = async (url, request = {}) => {
  writes.push({ url: String(url), request });
  if (String(url).includes("/rest/v1/rpc/enqueue_v4_recognition_batch_atomic")) {
    return jsonResponse(atomicEnqueueResponse(request));
  }
  return jsonResponse({ message: "unexpected call" }, { ok: false, status: 500 });
};
const enqueue = await enqueueV4RecognitionJobs({
  batchId: "batch-enqueue",
  operatorId: "operator-2",
  tenantId: "tenant-2",
  jobs: [
    {
      asset_id: "asset_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      payload: { client_asset_ref: "asset-a", images: [] }
    },
    {
      asset_id: "asset_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      payload: { client_asset_ref: "asset-b", images: [] }
    }
  ],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: fetchForWrites
});
assert.equal(enqueue.batchId, "batch-enqueue");
assert.equal(enqueue.queued_count, 2);
assert.equal(enqueue.persistence_mode, "atomic_rpc");
assert.equal(writes.length, 1);
assert.ok(writes[0].url.endsWith("/rest/v1/rpc/enqueue_v4_recognition_batch_atomic"));
const atomicBody = JSON.parse(writes[0].request.body);
assert.equal(atomicBody.p_tenant_id, "tenant-2");
assert.equal(atomicBody.p_operator_id, "operator-2");
assert.equal(atomicBody.p_sessions.length, 2);
assert.equal(atomicBody.p_jobs.length, 2);
assert.equal(atomicBody.p_jobs[0].payload.client_asset_ref, "asset-a");

const existingQueuedJob = normalizeV4JobInput({
  batchId: "batch-dedup",
  operatorId: "operator-dedup",
  tenantId: "tenant-dedup",
  job: {
    asset_id: "asset_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    payload: { client_asset_ref: "asset-dedup", images: [] }
  }
});
const dedupWrites = [];
const dedupEnqueue = await enqueueV4RecognitionJobs({
  batchId: "batch-dedup",
  operatorId: "operator-dedup",
  tenantId: "tenant-dedup",
  jobs: [{
    asset_id: "asset_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    payload: { client_asset_ref: "asset-dedup", images: [] }
  }],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    dedupWrites.push({ url: String(url), request });
    if (String(url).includes("/rest/v1/rpc/enqueue_v4_recognition_batch_atomic")) {
      return jsonResponse(atomicEnqueueResponse(request, {
        transaction: {
          inserted_count: 0,
          deduplicated_count: 1,
          session_rows_written: 0,
          job_rows_written: 0
        },
        job: {
          row: { ...existingQueuedJob, status: v4JobStatuses.RUNNING },
          deduplicated: true
        }
      }));
    }
    return jsonResponse({ message: "unexpected call" }, { ok: false, status: 500 });
  }
});
assert.equal(dedupEnqueue.queued_count, 1);
assert.equal(dedupEnqueue.inserted_count, 0);
assert.equal(dedupEnqueue.deduplicated_count, 1);
assert.equal(dedupEnqueue.jobs[0].row.status, v4JobStatuses.RUNNING, "duplicate enqueue must preserve the active job");
assert.equal(dedupWrites.filter((entry) => entry.url.includes("/rest/v1/rpc/enqueue_v4_recognition_batch_atomic")).length, 1);

const rejectedEnqueue = await enqueueV4RecognitionJobs({
  batchId: "batch-rejected",
  operatorId: "operator-rejected",
  tenantId: "tenant-rejected",
  jobs: [{
    asset_id: "asset_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    payload: { client_asset_ref: "asset-rejected", images: [] }
  }],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (_url, request = {}) => jsonResponse(atomicEnqueueResponse(request, {
    transaction: {
      saved: false,
      reason: "root_listing_asset_not_found",
      jobs: []
    }
  }))
});
assert.equal(rejectedEnqueue.queued_count, 0);
assert.equal(rejectedEnqueue.persistence_mode, "atomic_rpc_rejected");
assert.match(rejectedEnqueue.jobs[0].error, /root_listing_asset_not_found/);

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
    OPENAI_API_KEY: "key-one",
    V4_SUPABASE_READ_ATTEMPTS: "1"
  },
  fetchImpl: async (url, request = {}) => {
    hardFailureCalls.push({ url: String(url), request });
    return jsonResponse({ message: "database unavailable" }, { ok: false, status: 503 });
  }
});
assert.equal(hardFailureClaim.ok, false);
assert.equal(hardFailureClaim.rpc_mode, "balanced_capacity");
assert.equal(hardFailureCalls.length, 2, "a failed claim should perform one durable ownership readback before failing closed");
assert.ok(hardFailureCalls[1].url.includes("/rest/v1/v4_recognition_jobs"));

const reconciledClaimCalls = [];
const reconciledClaim = await claimV4RecognitionJobs({
  workerId: "worker-response-lost",
  tenantId: "tenant-response-lost",
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    OPENAI_API_KEY: "key-one"
  },
  fetchImpl: async (url, request = {}) => {
    reconciledClaimCalls.push({ url: String(url), request });
    if (String(url).includes("/rest/v1/rpc/")) {
      return jsonResponse({ message: "upstream response lost" }, { ok: false, status: 503 });
    }
    return jsonResponse([{
      id: "v4job-response-lost",
      tenant_id: "tenant-response-lost",
      status: "RUNNING",
      lease_owner: "worker-response-lost"
    }]);
  }
});
assert.equal(reconciledClaim.ok, true);
assert.equal(reconciledClaim.rpc_mode, "balanced_capacity_reconciled");
assert.equal(reconciledClaim.rows[0].id, "v4job-response-lost");
assert.equal(reconciledClaimCalls.length, 2, "a committed claim with a lost response must not issue a second claim");

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
assert.equal(releasedCapacity.release_attempts, 1);
assert.equal(releasedCapacity.recovered_after_retry, false);
assert.ok(capacityRpcCalls[0].url.endsWith("/rest/v1/rpc/release_v4_provider_capacity_for_job"));
assert.ok(capacityRpcCalls[0].request.body.includes('"p_job_id":"v4job-claimed"'));

const transientCapacityReleaseCalls = [];
const recoveredCapacityRelease = await releaseV4ProviderCapacityForJob({
  jobId: "v4job-release-retry",
  workerId: "worker-a",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    transientCapacityReleaseCalls.push({ url: String(url), request });
    if (transientCapacityReleaseCalls.length === 1) {
      return jsonResponse({ message: "temporary postgrest outage" }, { ok: false, status: 503 });
    }
    return jsonResponse(1);
  }
});
assert.equal(recoveredCapacityRelease.released, true);
assert.equal(recoveredCapacityRelease.release_attempts, 2);
assert.equal(recoveredCapacityRelease.recovered_after_retry, true);
assert.equal(transientCapacityReleaseCalls.length, 2);

const permanentCapacityReleaseCalls = [];
const rejectedCapacityRelease = await releaseV4ProviderCapacityForJob({
  jobId: "v4job-release-rejected",
  workerId: "worker-a",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    permanentCapacityReleaseCalls.push({ url: String(url), request });
    return jsonResponse({ message: "permission denied" }, { ok: false, status: 403 });
  }
});
assert.equal(rejectedCapacityRelease.released, false);
assert.equal(rejectedCapacityRelease.release_attempts, 1);
assert.equal(permanentCapacityReleaseCalls.length, 1, "non-transient release failures must fail closed without retries");

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
let resolveSecondHeartbeat;
const secondHeartbeat = new Promise((resolve) => {
  resolveSecondHeartbeat = resolve;
});
const heartbeatRun = await runWithV4JobLeaseHeartbeat({
  job: { id: "v4job-long", lease_owner: "worker-long" },
  leaseSeconds: 300,
  intervalMs: 5,
  heartbeat: async () => {
    heartbeatPulses += 1;
    if (heartbeatPulses >= 2) resolveSecondHeartbeat();
    return { extended: true, skipped: false, error: null };
  },
  task: async () => {
    await Promise.race([
      secondHeartbeat,
      new Promise((_, reject) => setTimeout(() => reject(new Error("heartbeat_test_timeout")), 250))
    ]);
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

const recoveryRpcCalls = [];
const recovery = await requestV4RecognitionJobRecovery({
  jobId: "v4job-stalled",
  tenantId: "tenant-a",
  requestedByUserId: "writer-a",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    recoveryRpcCalls.push({ url: String(url), request });
    return jsonResponse({
      action: "REQUEUED_EXPIRED_LEASE",
      job_id: "v4job-stalled",
      job_status: "RETRYING",
      priority: 0
    });
  }
});
assert.equal(recovery.ok, true);
assert.equal(recovery.action, "REQUEUED_EXPIRED_LEASE");
assert.ok(recoveryRpcCalls[0].url.endsWith("/rest/v1/rpc/request_v4_recognition_job_recovery"));
assert.deepEqual(JSON.parse(recoveryRpcCalls[0].request.body), {
  p_job_id: "v4job-stalled",
  p_tenant_id: "tenant-a",
  p_requested_by_user_id: "writer-a"
});

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

const completionReadbackCalls = [];
const completionReadback = await completeV4RecognitionJob({
  jobId: "v4job-completion-readback",
  tenantId: "tenant-completion-readback",
  workerId: "worker-completion-readback",
  result: { final_title: "Committed despite a lost response" },
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    V4_JOB_COMPLETION_WRITE_ATTEMPTS: "3",
    V4_JOB_COMPLETION_RETRY_BASE_MS: "1"
  },
  fetchImpl: async (url, request = {}) => {
    completionReadbackCalls.push({ url: String(url), request });
    if ((request.method || "GET") === "PATCH") {
      return jsonResponse({ message: "response lost" }, { ok: false, status: 503 });
    }
    return jsonResponse([{
      id: "v4job-completion-readback",
      tenant_id: "tenant-completion-readback",
      status: "L2_READY",
      lease_owner: null,
      completed_at: "2026-07-18T00:00:00.000Z",
      result: { final_title: "Committed despite a lost response" },
      timing: {}
    }]);
  }
});
assert.equal(completionReadback.saved, true);
assert.equal(completionReadback.completion_mode, "durable_readback_reconciled");
assert.equal(completionReadbackCalls.length, 2, "completion readback must prevent a duplicate terminal write");

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
    lease_owner: "worker-retry",
    error: { attempt_history: [{ attempt: 0, message: "earlier failure" }] }
  },
  error: { message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    assert.ok(String(url).includes("/rpc/fail_v4_recognition_job"));
    retryPatchBody = JSON.parse(request.body);
    return jsonResponse([{ id: "v4job-retry", status: "RETRYING", lease_owner: null }]);
  }
});
assert.equal(retry.saved, true);
assert.equal(retry.transition_mode, "atomic_failure_rpc");
assert.equal(retry.capacity_release_handled, true);
assert.equal(retryPatchBody.p_error.attempt_history.length, 2);
assert.equal(retryPatchBody.p_error.attempt_history[0].message, "earlier failure");
assert.equal(retryPatchBody.p_error.attempt_history[1].message, "provider timeout");
assert.equal(retryPatchBody.p_retryable, true);
assert.equal(retryPatchBody.p_worker_id, "worker-retry");

const finalFail = await failV4RecognitionJob({
  job: { id: "v4job-fail", attempt_count: 2, max_attempts: 2, lease_owner: "worker-final" },
  error: { message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    assert.ok(String(url).includes("/rpc/fail_v4_recognition_job"));
    assert.equal(JSON.parse(request.body).p_retryable, true);
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
assert.equal(schemaFailureBody.p_retryable, true, "one fresh provider response may recover a malformed structured response");
assert.equal(schemaFailureBody.p_error.retryable, true);
assert.equal(schemaFailureBody.p_error.http_status, 200);

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
assert.equal(hiddenL1FailureBody.p_force_final_failure, true, "a failed hidden L1 must hand off to L2 instead of re-entering the provider queue");

let fallbackFetchCount = 0;
const compatibilityFallback = await failV4RecognitionJob({
  job: { id: "v4job-rpc-missing", attempt_count: 1, max_attempts: 4, lease_owner: "worker-fallback" },
  error: { code: "PROVIDER_TIMEOUT", message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url, request = {}) => {
    fallbackFetchCount += 1;
    if (String(url).includes("/rpc/fail_v4_recognition_job")) {
      return jsonResponse({ code: "PGRST202", message: "Could not find fail_v4_recognition_job in the schema cache" }, { ok: false, status: 404 });
    }
    const body = JSON.parse(request.body);
    assert.equal(body.status, "RETRYING");
    return jsonResponse([{ id: "v4job-rpc-missing", status: "RETRYING" }]);
  }
});
assert.equal(fallbackFetchCount, 2);
assert.equal(compatibilityFallback.saved, true);
assert.equal(compatibilityFallback.transition_mode, "rest_compatibility_fallback");
assert.equal(compatibilityFallback.capacity_release_handled, false);

let ambiguousCommitCalls = 0;
const ambiguousCommit = await failV4RecognitionJob({
  job: {
    id: "v4job-ambiguous-commit",
    tenant_id: "tenant-runtime",
    attempt_count: 1,
    max_attempts: 4,
    lease_owner: "worker-ambiguous"
  },
  error: { code: "PROVIDER_TIMEOUT", message: "provider timeout" },
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url) => {
    ambiguousCommitCalls += 1;
    if (String(url).includes("/rpc/fail_v4_recognition_job")) {
      return jsonResponse({ message: "response lost after commit" }, { ok: false, status: 503 });
    }
    return jsonResponse([{
      id: "v4job-ambiguous-commit",
      tenant_id: "tenant-runtime",
      status: "RETRYING",
      lease_owner: null,
      not_before: "2026-07-17T00:00:10.000Z"
    }]);
  }
});
assert.equal(ambiguousCommit.saved, true);
assert.equal(ambiguousCommit.transition_mode, "atomic_failure_rpc_reconciled");
assert.equal(ambiguousCommit.capacity_release_handled, true);
assert.equal(ambiguousCommitCalls, 2, "an ambiguous RPC response must be reconciled before any retry");

let transientTransitionCalls = 0;
const transientTransition = await failV4RecognitionJob({
  job: {
    id: "v4job-transient-transition",
    tenant_id: "tenant-runtime",
    attempt_count: 1,
    max_attempts: 4,
    lease_owner: "worker-transient"
  },
  error: { code: "PROVIDER_TIMEOUT", message: "provider timeout" },
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    V4_JOB_FAILURE_TRANSITION_RETRY_BASE_MS: "10"
  },
  fetchImpl: async (url) => {
    transientTransitionCalls += 1;
    if (String(url).includes("/rpc/fail_v4_recognition_job")) {
      const rpcAttempt = transientTransitionCalls === 1;
      return rpcAttempt
        ? jsonResponse({ message: "database temporarily unavailable" }, { ok: false, status: 503 })
        : jsonResponse([{ id: "v4job-transient-transition", status: "RETRYING", lease_owner: null }]);
    }
    return jsonResponse([{
      id: "v4job-transient-transition",
      tenant_id: "tenant-runtime",
      status: "RUNNING",
      lease_owner: "worker-transient"
    }]);
  }
});
assert.equal(transientTransition.saved, true);
assert.equal(transientTransition.transition_mode, "atomic_failure_rpc");
assert.equal(transientTransition.transition_attempts, 2);
assert.equal(transientTransitionCalls, 3, "one state read must separate two bounded atomic attempts");

const reads = [];
await readV4RecognitionJobs({
  batchId: "batch-read",
  operatorId: "operator-read",
  tenantId: "tenant-read",
  select: "id,status",
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
  fetchImpl: async (url) => {
    reads.push(String(url));
    return jsonResponse([]);
  }
});
assert.ok(reads[0].includes("batch_id=eq.batch-read"));
assert.equal(new URL(reads[0]).searchParams.get("operator_id"), "eq.operator-read");
assert.equal(new URL(reads[0]).searchParams.get("tenant_id"), "eq.tenant-read");
assert.equal(
  new URL(reads[0]).searchParams.get("select"),
  "tenant_id,id,status",
  "status callers must exclude large queue payloads while retaining the tenant fence"
);

const missingReadTenant = await readV4RecognitionJobs({ batchId: "batch-read" });
assert.equal(missingReadTenant.ok, false);
assert.equal(missingReadTenant.error, "tenant_id_required");

assert.equal(isV4WorkerRequest({ headers: { [workerSecretHeader]: "secret" } }, { V4_JOB_WORKER_SECRET: "secret" }), true);
assert.equal(isV4WorkerRequest({ headers: { [workerSecretHeader]: "wrong" } }, { V4_JOB_WORKER_SECRET: "secret" }), false);
assert.equal(isV4WorkerRequest({ headers: { [workerSecretHeader]: "secret" } }, {}), false);
assert.equal(isV4CronRequest({ headers: { authorization: "Bearer cron-secret" } }, { CRON_SECRET: "cron-secret" }), true);
assert.equal(isV4CronRequest({ headers: { authorization: "Bearer wrong" } }, { CRON_SECRET: "cron-secret" }), false);

console.log("v4 production job queue tests passed");
