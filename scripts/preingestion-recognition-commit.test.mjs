#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  claimPreingestionRecognitionCommitIntents,
  commitPreingestionWorkForRecognition,
  enqueueRecognitionPreingestionOcrJobs,
  reconcilePreingestionRecognitionCommitIntents
} from "../lib/listing/preingestion/recognition-commit.mjs";
import { preingestionOcrJobKeyPrefix } from "../lib/listing/preingestion/preingestion-bundle.mjs";
import preingestionWorkerHandler from "../api/v4/listing-preingest-worker.js";

const assetId = "asset_22222222-2222-4222-8222-222222222222";
const baseBundle = {
  tenant_id: "tenant_a",
  asset_id: assetId,
  bundle_id: "bundle-current",
  quality_summary: {
    capture_quality: { image_generation_hash: "a".repeat(64) }
  },
  crop_plan: [{
    role: "serial_crop",
    source_image_id: "front",
    source_object_path: "tenants/tenant_a/listing-assets/2026-07-28/asset_22222222-2222-4222-8222-222222222222/front.jpg",
    source_region: "serial_number",
    crop_metadata: {
      crop_id: "front-serial",
      source_side: "front",
      source_width: 900,
      source_height: 1260
    }
  }]
};
const env = {
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
  PADDLE_OCR_WORKER_URL: "https://ocr.test",
  PADDLE_OCR_WORKER_TOKEN: "ocr-token",
  OCR_WORKER_REVISION: "ocr-worker-rev-current"
};
const callOrder = [];
let queuedJobs = [];
const committed = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  expectedImageSetSha256: "a".repeat(64),
  env,
  readLatest: async () => baseBundle,
  enqueueJobs: async ({ jobs }) => {
    callOrder.push("enqueue");
    queuedJobs = jobs;
    return { enqueued: jobs.length, attempted: jobs.length, durable: true };
  },
  invokeWorker: async ({ tenantId, assetId: invokedAssetId, bundleId }) => {
    callOrder.push("wake");
    assert.equal(tenantId, "tenant_a");
    assert.equal(invokedAssetId, assetId);
    assert.equal(bundleId, "bundle-current");
    return { invoked: true, ok: true, status: 200, error: null };
  }
});
assert.equal(committed.committed, true);
assert.deepEqual(callOrder, ["enqueue", "wake"], "durable OCR enqueue must precede the internal worker wake");
assert.equal(queuedJobs.length, 1);
assert.equal(queuedJobs[0].job_type, "ocr_crop_verification");
assert.match(
  queuedJobs[0].job_key,
  new RegExp(`^${preingestionOcrJobKeyPrefix({ ocrWorkerRevision: env.OCR_WORKER_REVISION })}bundle-current:`)
);

const replayCacheKey = "c".repeat(64);
const replayGenerationHash = "d".repeat(64);
let cacheReplayBundleReads = 0;
let cacheReplayEnqueues = 0;
const cachedTerminalReplay = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  expectedImageSetSha256: "a".repeat(64),
  identityResultCacheKey: replayCacheKey,
  identityCacheImageGenerationHash: replayGenerationHash,
  env,
  readWriterFinal: async () => ({ hit: false, reason: "writer_final_missing" }),
  readIdentityCache: async ({ cacheKey, imageGenerationHash }) => {
    assert.equal(cacheKey, replayCacheKey);
    assert.equal(imageGenerationHash, replayGenerationHash);
    return { hit: true, result: { title: "cached" } };
  },
  readLatest: async () => {
    cacheReplayBundleReads += 1;
    return baseBundle;
  },
  enqueueJobs: async () => {
    cacheReplayEnqueues += 1;
    return { durable: true };
  }
});
assert.equal(cachedTerminalReplay.reason, "terminal_replay_available");
assert.equal(cachedTerminalReplay.replay_class, "AI_TERMINAL_L2_REPLAY");
assert.equal(cachedTerminalReplay.provider_call_skipped, true);
assert.equal(cacheReplayBundleReads, 0, "a terminal identity replay must skip bundle materialization");
assert.equal(cacheReplayEnqueues, 0, "a terminal identity replay must schedule zero OCR Provider work");

let writerReplayBundleReads = 0;
const writerTerminalReplay = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  identityCacheImageGenerationHash: replayGenerationHash,
  env,
  readWriterFinal: async ({ tenantId, imageGenerationHash }) => {
    assert.equal(tenantId, "tenant_a");
    assert.equal(imageGenerationHash, replayGenerationHash);
    return { hit: true, title: "writer final" };
  },
  readIdentityCache: async () => ({ hit: false }),
  readLatest: async () => {
    writerReplayBundleReads += 1;
    return baseBundle;
  }
});
assert.equal(writerTerminalReplay.reason, "terminal_replay_available");
assert.equal(writerTerminalReplay.replay_class, "WRITER_FINAL_REPLAY");
assert.equal(writerTerminalReplay.provider_call_skipped, true);
assert.equal(writerReplayBundleReads, 0);

let bypassProbeCalls = 0;
const coldBenchmarkBypass = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  expectedImageSetSha256: "a".repeat(64),
  identityResultCacheKey: replayCacheKey,
  identityCacheImageGenerationHash: replayGenerationHash,
  identityCacheReadAllowed: false,
  writerFinalReplayAllowed: false,
  env,
  readWriterFinal: async () => {
    bypassProbeCalls += 1;
    return { hit: true };
  },
  readIdentityCache: async () => {
    bypassProbeCalls += 1;
    return { hit: true };
  },
  readLatest: async () => baseBundle,
  enqueueJobs: async ({ jobs }) => ({ enqueued: jobs.length, attempted: jobs.length, durable: true }),
  invokeWorker: async () => ({ invoked: true, ok: true })
});
assert.equal(bypassProbeCalls, 0, "cold_algorithm must not silently consume replay shortcuts");
assert.equal(coldBenchmarkBypass.committed, true);
assert.equal(coldBenchmarkBypass.enqueued, 1);

let mismatchedGenerationEnqueueCalled = false;
const mismatchedGeneration = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  expectedImageSetSha256: "b".repeat(64),
  env,
  readLatest: async () => baseBundle,
  enqueueJobs: async () => {
    mismatchedGenerationEnqueueCalled = true;
    return { durable: true };
  }
});
assert.equal(mismatchedGeneration.committed, false);
assert.equal(mismatchedGeneration.reason, "preingestion_bundle_generation_superseded");
assert.equal(mismatchedGenerationEnqueueCalled, false, "a superseded image generation must schedule zero paid OCR work");

let unavailableEnqueueCalled = false;
const unavailable = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  env: {},
  readLatest: async () => baseBundle,
  enqueueJobs: async () => {
    unavailableEnqueueCalled = true;
    return { durable: true };
  }
});
assert.equal(unavailable.committed, false);
assert.equal(unavailable.reason, "ocr_feature_disabled");
assert.equal(unavailableEnqueueCalled, false);

let incompleteRuntimeEnqueueCalled = false;
const incompleteRuntime = await commitPreingestionWorkForRecognition({
  tenantId: "tenant_a",
  assetId,
  expectedImageSetSha256: "a".repeat(64),
  env: { ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true" },
  readLatest: async () => baseBundle,
  enqueueJobs: async () => {
    incompleteRuntimeEnqueueCalled = true;
    return { durable: true };
  }
});
assert.equal(incompleteRuntime.reason, "ocr_runtime_not_ready");
assert.equal(incompleteRuntimeEnqueueCalled, false);

const outboxRow = {
  outbox_id: 41,
  tenant_id: "tenant_a",
  asset_id: assetId,
  image_set_sha256: "a".repeat(64)
};
const retrySettlements = [];
const bundleNotReadyReplay = await reconcilePreingestionRecognitionCommitIntents({
  tenantId: "tenant_a",
  assetId,
  claim: async () => ({ ok: true, lease_owner: "lease-bundle-not-ready", rows: [outboxRow] }),
  commit: async () => ({ committed: false, reason: "preingestion_bundle_not_found", enqueued: 0 }),
  settle: async (input) => {
    retrySettlements.push(input);
    return { ok: true, settled: true, status: "queued" };
  }
});
assert.equal(bundleNotReadyReplay.ok, true);
assert.equal(bundleNotReadyReplay.retry_scheduled, 1);
assert.equal(retrySettlements[0].completed, false);
assert.equal(retrySettlements[0].retryAfterSeconds, 5);

let replayMaterializeCalls = 0;
const replayAfterBundleReady = await reconcilePreingestionRecognitionCommitIntents({
  tenantId: "tenant_a",
  assetId,
  claim: async () => ({ ok: true, lease_owner: "lease-bundle-ready", rows: [outboxRow] }),
  commit: async ({ expectedImageSetSha256 }) => {
    replayMaterializeCalls += 1;
    assert.equal(expectedImageSetSha256, "a".repeat(64));
    return { committed: true, enqueued: 1 };
  },
  settle: async ({ completed }) => ({ ok: true, settled: completed, status: "completed" })
});
assert.equal(replayAfterBundleReady.ok, true);
assert.equal(replayAfterBundleReady.completed, 1);
assert.equal(replayMaterializeCalls, 1, "the cron reconciliation path must materialize a durable intent without waitUntil");

const authorizedRetryForwarding = await reconcilePreingestionRecognitionCommitIntents({
  claim: async () => ({
    ok: true,
    lease_owner: "lease-authorized-retry",
    rows: [{
      ...outboxRow,
      outbox_id: 42,
      authorized_retry_of_job_id: "v4job_failed_prior"
    }]
  }),
  commit: async ({ authorizedRetryOfJobId }) => {
    assert.equal(authorizedRetryOfJobId, "v4job_failed_prior");
    return { committed: true, enqueued: 1 };
  },
  settle: async ({ completed }) => ({ ok: true, settled: completed, status: "completed" })
});
assert.equal(authorizedRetryForwarding.ok, true);
assert.equal(authorizedRetryForwarding.results[0].ocr_enqueued_count, 1);

const terminalReplaySettlement = await reconcilePreingestionRecognitionCommitIntents({
  claim: async () => ({ ok: true, lease_owner: "lease-replay", rows: [outboxRow] }),
  commit: async () => ({
    committed: false,
    reason: "terminal_replay_available",
    replay_class: "AI_TERMINAL_L2_REPLAY",
    provider_call_skipped: true,
    enqueued: 0
  }),
  settle: async ({ completed }) => ({ ok: true, settled: completed, status: "completed" })
});
assert.equal(terminalReplaySettlement.ok, true);
assert.equal(terminalReplaySettlement.results[0].provider_call_skipped, true);
assert.equal(terminalReplaySettlement.results[0].replay_class, "AI_TERMINAL_L2_REPLAY");
assert.equal(terminalReplaySettlement.results[0].ocr_enqueued_count, 0);

const transientSettlements = [];
const transientReplay = await reconcilePreingestionRecognitionCommitIntents({
  claim: async () => ({ ok: true, lease_owner: "lease-transient", rows: [outboxRow] }),
  commit: async () => { throw new Error("Supabase 503"); },
  settle: async (input) => {
    transientSettlements.push(input);
    return { ok: true, settled: true, status: "queued" };
  }
});
assert.equal(transientReplay.retry_scheduled, 1);
assert.equal(transientSettlements[0].completed, false);
assert.match(transientSettlements[0].error, /Supabase 503/);

const claimBodies = [];
let claimAttempts = 0;
const claimedAfterLostResponse = await claimPreingestionRecognitionCommitIntents({
  tenantId: "tenant_a",
  assetId,
  leaseOwner: "stable-lease-owner",
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    V4_SUPABASE_WRITE_TIMEOUT_MS: "1000"
  },
  fetchImpl: async (_url, request) => {
    claimBodies.push(JSON.parse(request.body));
    claimAttempts += 1;
    if (claimAttempts === 1) throw new TypeError("response lost");
    return new Response(JSON.stringify([outboxRow]), { status: 200 });
  }
});
assert.equal(claimedAfterLostResponse.ok, true);
assert.equal(claimBodies.length, 2);
assert.equal(claimBodies[0].p_lease_owner, claimBodies[1].p_lease_owner, "claim response loss must retry one idempotent lease owner");

const queueMigration = readFileSync(
  new URL("../supabase/migrations/20260728120000_v4_queue_unique_stage_identity.sql", import.meta.url),
  "utf8"
);
assert.match(queueMigration, /create table if not exists public\.preingestion_recognition_commit_outbox/i);
assert.match(queueMigration, /claim_preingestion_recognition_commit_outbox/i);
assert.match(queueMigration, /settle_preingestion_recognition_commit_outbox/i);
assert.match(queueMigration, /enqueue_recognition_preingestion_ocr_jobs/i);
assert.match(queueMigration, /authorized_retry_lineage_id/i);
assert.match(queueMigration, /existing\.status in \('failed', 'cancelled'\)/i);
assert.match(queueMigration, /existing\.lease_owner is null/i);
assert.match(queueMigration, /insert into public\.preingestion_recognition_commit_outbox[\s\S]*select[\s\S]*p_tenant_id/i);
assert.match(queueMigration, /select public\.enqueue_v4_recognition_batch_atomic_impl_20260728[\s\S]*insert into public\.preingestion_recognition_commit_outbox/i);

const recognitionOcrJob = {
  tenant_id: "tenant_a",
  asset_id: assetId,
  bundle_id: "11111111-1111-4111-8111-111111111111",
  job_key: "ocr:ocr-crop-v21:vision-revision-stable:bundle:front",
  job_type: "ocr_crop_verification",
  priority: 20,
  payload: { crop: { role: "card_code_crop" } }
};
const retryRpcBodies = [];
const authorizedRetryQueue = await enqueueRecognitionPreingestionOcrJobs({
  jobs: [recognitionOcrJob],
  authorizedRetryLineageId: "v4job_failed_prior",
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, request) => {
    assert.match(String(url), /enqueue_recognition_preingestion_ocr_jobs$/);
    retryRpcBodies.push(JSON.parse(request.body));
    return new Response(JSON.stringify({
      saved: true,
      attempted_count: 1,
      inserted_count: 0,
      requeued_count: 1,
      runnable_count: 1,
      succeeded_count: 0,
      blocked_terminal_count: 0,
      authorized_retry_lineage_applied: true
    }), { status: 200 });
  }
});
assert.equal(authorizedRetryQueue.durable, true);
assert.equal(authorizedRetryQueue.enqueued, 1);
assert.equal(authorizedRetryQueue.requeued, 1);
assert.equal(authorizedRetryQueue.authorized_retry_lineage_applied, true);
assert.equal(retryRpcBodies[0].p_authorized_retry_lineage_id, "v4job_failed_prior");

const ordinaryTerminalRepeat = await enqueueRecognitionPreingestionOcrJobs({
  jobs: [recognitionOcrJob],
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async () => new Response(JSON.stringify({
    saved: false,
    reason: "ocr_terminal_retry_authorization_required",
    attempted_count: 1,
    inserted_count: 0,
    requeued_count: 0,
    runnable_count: 0,
    succeeded_count: 0,
    blocked_terminal_count: 1,
    authorized_retry_lineage_applied: false
  }), { status: 200 })
});
assert.equal(ordinaryTerminalRepeat.durable, false);
assert.equal(ordinaryTerminalRepeat.enqueued, 0);
assert.equal(ordinaryTerminalRepeat.reason, "ocr_terminal_retry_authorization_required");

const unauthorizedResponse = {
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(key, value) { this.headers[key] = value; },
  end(value = "") { this.body = String(value); }
};
await preingestionWorkerHandler({ method: "POST", headers: {} }, unauthorizedResponse);
assert.equal(unauthorizedResponse.statusCode, 401, "a tenant/browser request must not execute the OCR worker");
assert.equal(JSON.parse(unauthorizedResponse.body).code, "preingestion_worker_auth_required");

console.log("preingestion recognition commit tests passed");
