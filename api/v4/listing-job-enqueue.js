import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import {
  createV4BatchId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  tryAcquireV4QueueKick,
  v4QueueGlobalDrainEnabled,
  v4QueueKickDedupMs,
  v4QueueConfigured,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function jobsFromPayload(payload = {}) {
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (payload.payload && typeof payload.payload === "object") return [{ payload: payload.payload }];
  return [payload];
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

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function envFlag(env, key, fallback = true) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function triggerV4QueuePumpAfterEnqueue(req, {
  tenantId,
  batchId,
  queuedCount
} = {}) {
  if (!queuedCount) return { triggered: false, reason: "no_jobs_queued" };
  if (!envFlag(process.env, "V4_QUEUE_AUTOKICK_ENABLED", true)) return { triggered: false, reason: "autokick_disabled" };
  const secret = configuredWorkerSecret(process.env);
  if (!secret) return { triggered: false, reason: "worker_secret_missing" };
  const origin = requestOrigin(req);
  if (!origin) return { triggered: false, reason: "request_origin_missing" };
  const stableConcurrency = v4WorkerProcessConcurrency(process.env);
  const perWorkerLimit = positiveInteger(process.env.V4_QUEUE_AUTOKICK_LIMIT_PER_WORKER, 2, { min: 1, max: 10 });
  const interactiveWorkers = positiveInteger(process.env.V4_QUEUE_AUTOKICK_INTERACTIVE_WORKERS, 5, { min: 1, max: 32 });
  const backgroundWorkers = positiveInteger(process.env.V4_QUEUE_AUTOKICK_BACKGROUND_WORKERS, 2, { min: 1, max: 32 });
  const interactiveLimit = positiveInteger(process.env.V4_PUMP_INTERACTIVE_CONCURRENCY, interactiveWorkers * perWorkerLimit, { min: 1, max: 96 });
  const backgroundLimit = positiveInteger(process.env.V4_PUMP_BACKGROUND_CONCURRENCY, backgroundWorkers * perWorkerLimit, { min: 1, max: 96 });
  const interactiveConcurrency = Math.min(stableConcurrency, interactiveLimit);
  const backgroundConcurrency = Math.min(stableConcurrency, backgroundLimit);

  const body = {
    tenant_id: v4QueueGlobalDrainEnabled(process.env) ? null : tenantId || batchId || null,
    kick_source_tenant_id: tenantId || batchId || null,
    limit: interactiveLimit,
    process_concurrency: interactiveConcurrency,
    interactive_limit: interactiveLimit,
    interactive_process_concurrency: interactiveConcurrency,
    background_limit: backgroundLimit,
    background_process_concurrency: backgroundConcurrency,
    cycles: 2,
    max_runtime_ms: 240_000,
    lease_seconds: 240,
    retry_delay_seconds: 8,
    parallel_lanes: true,
    idle_delay_ms: 0,
    idle_cycles_before_stop: 1,
    background_idle_cycles: 1,
    continuation_cycles: 2,
    max_continuation_depth: 20,
    reason: "post_enqueue"
  };
  const kickOwner = `enqueue-${String(batchId || tenantId || "batch").slice(0, 72)}-${Date.now().toString(36)}`;
  waitUntil((async () => {
    const kick = await tryAcquireV4QueueKick({
      scope: "global",
      owner: kickOwner,
      leaseMs: v4QueueKickDedupMs(process.env)
    });
    if (kick.ok && !kick.acquired) return null;
    return fetch(`${origin}/api/v4/listing-job-pump`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [workerSecretHeader]: secret
      },
      body: JSON.stringify(body)
    }).catch(() => null);
  })());
  return {
    triggered: true,
    reason: "post_enqueue_deduplicated_kick_scheduled",
    tenant_id: body.tenant_id,
    global_drain: body.tenant_id === null
  };
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
    scope: "v4_listing_job_enqueue",
    limit: 600,
    windowMs: 60_000,
    message: "Too many V4 job enqueue requests. Please try again shortly."
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

  const batchId = payload.batch_id || payload.batchId || createV4BatchId("v4batch");
  const operatorId = operatorIdFromRequest(req);
  const tenantId = payload.tenant_id || payload.tenantId || batchId;
  const sourceJobs = jobsFromPayload(payload);
  const stageJobs = expandV4RecognitionStageJobs({
    jobs: sourceJobs,
    batchId,
    operatorId,
    tenantId,
    priority: payload.priority || 100
  });
  const result = await enqueueV4RecognitionJobs({
    jobs: stageJobs,
    batchId,
    operatorId,
    tenantId,
    priority: payload.priority || 100
  });
  const pump = triggerV4QueuePumpAfterEnqueue(req, {
    tenantId,
    batchId: result.batchId,
    queuedCount: result.queued_count
  });

  sendJson(res, 200, withV4Version({
    ok: result.queued_count > 0,
    batch_id: result.batchId,
    tenant_id: tenantId,
    queued_count: result.queued_count,
    persistence_mode: result.persistence_mode,
    session_rows_written: result.session_rows_written,
    job_rows_written: result.job_rows_written,
    pump_triggered: pump.triggered,
    pump_reason: pump.reason,
    pump_global_drain: pump.global_drain === true,
    jobs: result.jobs.map((entry) => ({
      ok: entry.saved,
      job_id: entry.row?.id || null,
      lane: entry.row?.lane || null,
      job_type: entry.row?.job_type || null,
      parent_job_id: entry.row?.parent_job_id || null,
      paired_job_id: entry.row?.paired_job_id || null,
      recognition_session_id: entry.row?.recognition_session_id || null,
      asset_id: entry.row?.asset_id || null,
      status: entry.row?.status || null,
      error: entry.error || null
    }))
  }));
}
