import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import {
  createV4BatchId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  readV4RecognitionJobs,
  v4JobIdentityMatches,
  v4JobStatuses,
  v4JobTypes,
  v4QueueConfigured,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { scheduleTrustedV4QueuePump } from "../../lib/listing/v4/jobs/internal-queue-wake.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

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
  const canonical = (Array.isArray(images) ? images : [])
    .map((image = {}) => ({
      role: clean(image.role || image.image_role),
      bucket: clean(image.bucket),
      object_path: clean(image.object_path || image.objectPath),
      content_sha256: clean(image.content_sha256 || image.contentSha256).toLowerCase(),
      image_id: clean(image.image_id || image.id)
    }))
    .filter((image) => Object.values(image).some(Boolean))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return canonical.length
    ? crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
    : "";
}

function stableId(...parts) {
  const source = parts.map(clean).filter(Boolean).join("|");
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
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

function withoutUntrustedBundleIdentity(payload = {}) {
  const sanitized = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload }
    : {};
  for (const key of [
    "preingestion_bundle_id", "preingestionBundleId", "preingestion_bundle",
    "preingestion_bundle_used", "preingestion_bundle_status",
    "preingestion_summary", "preingestion_initial_evidence",
    "preingestion_evidence_patches"
  ]) delete sanitized[key];
  return sanitized;
}

export function triggerPump(_req, {
  tenantId = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil
} = {}) {
  const stableConcurrency = v4WorkerProcessConcurrency(env);
  const body = {
    tenant_id: tenantId,
    limit: stableConcurrency,
    process_concurrency: stableConcurrency,
    interactive_limit: stableConcurrency,
    interactive_process_concurrency: stableConcurrency,
    background_limit: stableConcurrency,
    background_process_concurrency: stableConcurrency,
    cycles: 1,
    max_runtime_ms: 120_000,
    parallel_lanes: true,
    idle_cycles_before_stop: 1,
    background_idle_cycles: 1,
    continuation_cycles: 1,
    max_continuation_depth: 100,
    reason: "prewarm"
  };
  const scheduled = scheduleTrustedV4QueuePump({
    payload: body,
    reason: "prewarm",
    env,
    fetchImpl,
    defer
  });
  return { triggered: scheduled.triggered, reason: scheduled.reason };
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
  const batchId = createV4BatchId("v4prewarm");
  const operatorId = context.userId;
  const tenantId = context.tenantId;
  const createL2Jobs = payload.create_l2_jobs !== false && payload.createL2Jobs !== false;
  const assets = assetsFromPayload(payload).slice(0, 200);
  const staged = [];
  const sessionByAsset = new Map();

  for (const asset of assets) {
    const assetId = clean(asset.asset_id || asset.assetId || asset.source_record_id || asset.sourceRecordId);
    if (!assetId) continue;
    const hash = imageHash(asset.images || asset.payload?.images || []);
    const baseJobId = stableId(tenantId, operatorId, assetId, hash || "nohash");
    const sessionId = `v4sess_prewarm_${baseJobId}`;
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
          ...withoutUntrustedBundleIdentity(
            asset.payload && typeof asset.payload === "object" ? asset.payload : asset
          ),
          asset_id: assetId,
          tenant_id: tenantId,
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
    sessionByAsset.set(baseJobId, {
      asset_id: assetId,
      image_identity_sha256: hash || null,
      recognition_session_id: sessionId,
      job_ids: jobs.map((job) => job.id)
    });
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
      error_code: "V4_PREWARM_IDENTITY_READ_FAILED",
      message: "Unable to verify existing prewarm job identity."
    }));
    return;
  }
  const existingById = new Map((existing.rows || []).map((row) => [row.id, row]));
  const identityConflicts = staged.filter((job) => {
    const existingJob = existingById.get(job.id);
    return existingJob && !v4JobIdentityMatches(existingJob, job);
  });
  if (identityConflicts.length) {
    sendJson(res, 409, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_PREWARM_JOB_IDENTITY_CONFLICT",
      message: "A prewarm idempotency identity is already bound to a different tenant, operator, or canonical payload."
    }));
    return;
  }
  const terminalFailures = staged.filter((job) => {
    const status = String(existingById.get(job.id)?.status || "").toUpperCase();
    return [v4JobStatuses.FAILED, v4JobStatuses.CANCELLED].includes(status);
  });
  if (terminalFailures.length) {
    sendJson(res, 409, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_PREWARM_RETRY_REQUIRED",
      message: "A matching prewarm job is terminal; use the controlled retry workflow."
    }));
    return;
  }
  const jobsToQueue = staged.filter((job) => !terminalOrActive(existingById.get(job.id)?.status));
  for (const session of sessionByAsset.values()) {
    const existingJob = session.job_ids.map((id) => existingById.get(id)).find(Boolean);
    if (existingJob?.recognition_session_id) {
      session.recognition_session_id = existingJob.recognition_session_id;
    }
  }
  const result = jobsToQueue.length
    ? await enqueueV4RecognitionJobs({
      jobs: jobsToQueue,
      batchId,
      operatorId,
      tenantId,
      priority: payload.priority || 100
    })
    : { batchId, jobs: [], queued_count: 0 };
  const enqueueFailures = (result.jobs || []).filter((entry) => !entry.saved);
  if (jobsToQueue.length && Number(result.accepted_count || 0) === 0) {
    const conflict = enqueueFailures.some((entry) => (
      /identity_conflict|terminal_retry_required/.test(String(entry.error || ""))
    ));
    sendJson(res, conflict ? 409 : 503, withV4Version({
      ok: false,
      retryable: !conflict,
      error_code: conflict
        ? "V4_PREWARM_ENQUEUE_IDENTITY_CONFLICT"
        : "V4_PREWARM_ENQUEUE_FAILED",
      message: enqueueFailures.map((entry) => entry.error).filter(Boolean).slice(0, 3).join("; ")
        || "Unable to persist prewarm jobs."
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
    reused_count: staged.length - jobsToQueue.length,
    prewarm_ack_ms: Date.now() - startedAt,
    sessions: [...sessionByAsset.values()].map((session) => ({
      ...session,
      l1_status: existingById.get(session.job_ids.find((id) => id.includes("_l1_")))?.status || "QUEUED",
      l2_status: existingById.get(session.job_ids.find((id) => id.includes("_l2_")))?.status || (createL2Jobs ? "QUEUED" : "SKIPPED")
    }))
  }));
}
