import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import {
  createV4BatchId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  readV4RecognitionJobs,
  v4JobStatuses,
  v4JobTypes,
  v4QueueConfigured,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { createV4SessionId } from "../../lib/listing/v4/session/session-store.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { trustedInternalServiceOrigin } from "../../lib/listing/v4/jobs/internal-service-origin.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
import { ensureTenantListingAssets, normalizeListingAssetId } from "../../lib/tenant/assets.mjs";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function assetsFromPayload(payload = {}) {
  if (Array.isArray(payload.assets)) return payload.assets;
  if (Array.isArray(payload.jobs)) return payload.jobs.map((job) => job.payload || job);
  if (payload.asset_id || payload.assetId || payload.images) return [payload];
  return [];
}

function imageHash(images = []) {
  return (Array.isArray(images) ? images : [])
    .map((image) => image.content_sha256 || image.contentSha256 || image.object_path || image.objectPath || image.image_id || image.id || image.url)
    .filter(Boolean)
    .join("|")
    .slice(0, 500);
}

function stableId(...parts) {
  const source = parts.map(clean).filter(Boolean).join("|");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(31, hash) + source.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function terminalOrActive(status = "") {
  return [
    v4JobStatuses.QUEUED,
    v4JobStatuses.RETRYING,
    v4JobStatuses.RUNNING,
    v4JobStatuses.L1_READY,
    v4JobStatuses.L2_READY
  ].includes(String(status || "").toUpperCase());
}

export function triggerPump(_req, {
  tenantId = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil
} = {}) {
  const secret = configuredWorkerSecret(env);
  const origin = trustedInternalServiceOrigin(env);
  if (!secret || !origin) return { triggered: false, reason: !secret ? "worker_secret_missing" : "internal_origin_missing" };
  const stableConcurrency = v4WorkerProcessConcurrency(env);
  const body = {
    tenant_id: tenantId,
    limit: stableConcurrency,
    process_concurrency: stableConcurrency,
    interactive_limit: stableConcurrency,
    interactive_process_concurrency: stableConcurrency,
    background_limit: stableConcurrency,
    background_process_concurrency: stableConcurrency,
    cycles: 2,
    max_runtime_ms: 240_000,
    retry_delay_seconds: 8,
    parallel_lanes: true,
    idle_cycles_before_stop: 1,
    background_idle_cycles: 1,
    continuation_cycles: 2,
    max_continuation_depth: 20,
    reason: "prewarm"
  };
  defer(fetchImpl(`${origin}/api/v4/listing-job-pump`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [workerSecretHeader]: secret
    },
    body: JSON.stringify(body)
  }).catch(() => null));
  return { triggered: true, reason: "prewarm" };
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-prewarm" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    requirePermission(context, TENANT_PERMISSIONS.CREATE_JOB);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_prewarm",
    limit: 600,
    windowMs: 60_000,
    message: "Too many V4 job prewarm requests. Please try again shortly."
  })) return;
  if (!v4QueueConfigured(process.env)) {
    sendJson(res, 503, withV4Version({ ok: false, message: "V4 production queue is not configured." }));
    return;
  }

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const startedAt = Date.now();
  const batchId = payload.batch_id || payload.batchId || createV4BatchId("v4prewarm");
  const tenantId = context.tenantId;
  const createL2Jobs = payload.create_l2_jobs !== false && payload.createL2Jobs !== false;
  const operatorId = context.userId;
  const assets = assetsFromPayload(payload).slice(0, 200);
  if (!assets.length) {
    sendJson(res, 400, withV4Version({ ok: false, retryable: false, message: "At least one asset is required." }));
    return;
  }
  let assetIds;
  try {
    assetIds = assets.map((asset) => normalizeListingAssetId(
      asset.asset_id || asset.assetId || asset.source_record_id || asset.sourceRecordId
    ));
    await ensureTenantListingAssets({ tenantId, assetIds });
  } catch {
    sendJson(res, 409, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_PREWARM_ASSET_SCOPE_CONFLICT",
      message: "One or more assets are unavailable in this tenant."
    }));
    return;
  }
  const staged = [];
  const sessionByAsset = new Map();

  for (const [assetIndex, asset] of assets.entries()) {
    const assetId = assetIds[assetIndex];
    const hash = imageHash(asset.images || asset.payload?.images || []);
    const sessionId = asset.recognition_session_id || createV4SessionId("v4sess_prewarm");
    const baseJobId = stableId(tenantId, assetId, hash || "nohash");
    const jobs = expandV4RecognitionStageJobs({
      jobs: [{
        id: `v4job_prewarm_l1_${baseJobId}`,
        l1_job_id: `v4job_prewarm_l1_${baseJobId}`,
        l2_job_id: `v4job_prewarm_l2_${baseJobId}`,
        asset_id: assetId,
        tenant_id: tenantId,
        create_l1_job: true,
        create_l2_job: createL2Jobs,
        priority: asset.priority || payload.priority || 100,
        payload: {
          ...(asset.payload && typeof asset.payload === "object" ? asset.payload : asset),
          asset_id: assetId,
          tenant_id: tenantId,
          operator_id: operatorId,
          created_by_user_id: operatorId,
          assigned_to_user_id: operatorId,
          recognition_session_id: sessionId,
          create_l1_job: true,
          create_l2_job: createL2Jobs,
          provider: "openai_legacy",
          provider_id: "openai_legacy",
          vision_provider: "openai_legacy"
        }
      }],
      batchId,
      operatorId,
      tenantId,
      priority: payload.priority || 100
    });
    staged.push(...jobs);
    sessionByAsset.set(assetId, { asset_id: assetId, recognition_session_id: sessionId, job_ids: jobs.map((job) => job.id) });
  }

  const existing = staged.length
    ? await readV4RecognitionJobs({
      jobIds: staged.map((job) => job.id),
      tenantId,
      limit: staged.length
    })
    : { ok: true, rows: [] };
  if (!existing.ok) {
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      error_code: "V4_PREWARM_JOB_READ_FAILED",
      message: "Existing prewarm jobs could not be verified."
    }));
    return;
  }
  const existingById = new Map((existing.rows || []).map((row) => [row.id, row]));
  const jobsToQueue = staged.filter((job) => !terminalOrActive(existingById.get(job.id)?.status));
  const result = jobsToQueue.length
    ? await enqueueV4RecognitionJobs({
      jobs: jobsToQueue,
      batchId,
      operatorId,
      tenantId,
      priority: payload.priority || 100
    })
    : { batchId, jobs: [], queued_count: 0 };

  const persistedById = new Map((existing.rows || []).map((row) => [row.id, row]));
  for (const entry of result.jobs || []) {
    if (entry.saved === true && entry.row?.id) persistedById.set(entry.row.id, entry.row);
  }
  const reusedCount = staged.length - jobsToQueue.length;
  const persistenceFailed = jobsToQueue.length > 0 && Number(result.queued_count || 0) === 0;

  if (persistenceFailed) {
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      error_code: "V4_PREWARM_PERSISTENCE_FAILED",
      message: "No prewarm job was persisted; retry is safe because job ids are idempotent.",
      prewarm_batch_id: batchId,
      batch_id: batchId,
      tenant_id: tenantId,
      queued_count: 0,
      reused_count: reusedCount
    }));
    return;
  }

  if (result.queued_count > 0 && payload.autokick_workers !== false && payload.autokickWorkers !== false) {
    triggerPump(req, { tenantId });
  }

  sendJson(res, 200, withV4Version({
    ok: true,
    prewarm_batch_id: batchId,
    batch_id: batchId,
    tenant_id: tenantId,
    queued_count: result.queued_count,
    reused_count: reusedCount,
    prewarm_ack_ms: Date.now() - startedAt,
    sessions: [...sessionByAsset.values()].map((session) => ({
      ...session,
      persisted: session.job_ids.every((id) => persistedById.has(id)),
      l1_status: persistedById.get(session.job_ids.find((id) => id.includes("_l1_")))?.status || "NOT_PERSISTED",
      l2_status: createL2Jobs
        ? persistedById.get(session.job_ids.find((id) => id.includes("_l2_")))?.status || "NOT_PERSISTED"
        : "SKIPPED"
    }))
  }));
}
