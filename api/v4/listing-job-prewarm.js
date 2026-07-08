import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import {
  createV4BatchId,
  createV4SessionId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  readV4RecognitionJobs,
  v4JobStatuses,
  v4JobTypes,
  v4QueueConfigured,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

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

function headerValue(req, name) {
  const lower = String(name || "").toLowerCase();
  const value = req?.headers?.[lower] ?? req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function requestOrigin(req) {
  const host = headerValue(req, "x-forwarded-host") || headerValue(req, "host");
  if (!host) return "";
  const proto = headerValue(req, "x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

function triggerPump(req, payload = {}) {
  const secret = configuredWorkerSecret(process.env);
  const origin = requestOrigin(req);
  if (!secret || !origin) return { triggered: false, reason: !secret ? "worker_secret_missing" : "request_origin_missing" };
  const stableConcurrency = v4WorkerProcessConcurrency(process.env);
  const body = {
    tenant_id: payload.tenant_id || payload.tenantId || payload.batch_id || null,
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
  waitUntil(fetch(`${origin}/api/v4/listing-job-pump`, {
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
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
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
  const tenantId = payload.tenant_id || payload.tenantId || batchId;
  const createL2Jobs = payload.create_l2_jobs !== false && payload.createL2Jobs !== false;
  const operatorId = operatorIdFromRequest(req);
  const assets = assetsFromPayload(payload).slice(0, 200);
  const staged = [];
  const sessionByAsset = new Map();

  for (const asset of assets) {
    const assetId = clean(asset.asset_id || asset.assetId || asset.source_record_id || asset.sourceRecordId);
    if (!assetId) continue;
    const hash = imageHash(asset.images || asset.payload?.images || []);
    const sessionId = asset.recognition_session_id || createV4SessionId("v4sess_prewarm");
    const baseJobId = stableId(tenantId, assetId, hash || "nohash");
    const jobs = expandV4RecognitionStageJobs({
      jobs: [{
        id: `v4job_prewarm_l1_${baseJobId}`,
        l1_job_id: `v4job_prewarm_l1_${baseJobId}`,
        l2_job_id: `v4job_prewarm_l2_${baseJobId}`,
        asset_id: assetId,
        tenant_id: asset.tenant_id || tenantId,
        create_l1_job: true,
        create_l2_job: createL2Jobs,
        priority: asset.priority || payload.priority || 100,
        payload: {
          ...(asset.payload && typeof asset.payload === "object" ? asset.payload : asset),
          asset_id: assetId,
          tenant_id: asset.tenant_id || tenantId,
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
    ? await readV4RecognitionJobs({ jobIds: staged.map((job) => job.id), limit: staged.length })
    : { ok: true, rows: [] };
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

  if (result.queued_count > 0 && payload.autokick_workers !== false && payload.autokickWorkers !== false) {
    triggerPump(req, {
      batch_id: batchId,
      tenant_id: tenantId,
      jobs: []
    });
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
