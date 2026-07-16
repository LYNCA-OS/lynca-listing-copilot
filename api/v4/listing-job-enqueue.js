import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import {
  createV4BatchId,
  createV4DeterministicBatchId,
  enqueueV4RecognitionJobs,
  expandV4RecognitionStageJobs,
  tryAcquireV4QueueKick,
  v4QueueGlobalDrainEnabled,
  v4QueueKickDedupMs,
  v4QueueConfigured,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { trustedInternalServiceOrigin } from "../../lib/listing/v4/jobs/internal-service-origin.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

function jobsFromPayload(payload = {}) {
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (payload.payload && typeof payload.payload === "object") return [{ payload: payload.payload }];
  return [payload];
}

function withoutClientSessionIdentity(job = {}) {
  const serverOwnedKeys = [
    "id",
    "job_id", "jobId",
    "l1_job_id", "l1JobId",
    "l2_job_id", "l2JobId",
    "parent_job_id", "parentJobId",
    "paired_job_id", "pairedJobId",
    "recognition_session_id", "recognitionSessionId",
    "session_id", "sessionId",
    "batch_id", "batchId",
    "tenant_id", "tenantId",
    "operator_id", "operatorId",
    "created_by_user_id", "assigned_to_user_id",
    "lease_owner", "lease_expires_at",
    "queue_tags", "status",
    "preingestion_bundle_id", "preingestionBundleId", "preingestion_bundle",
    "preingestion_bundle_used", "preingestion_bundle_status",
    "preingestion_summary", "preingestion_initial_evidence",
    "preingestion_evidence_patches"
  ];
  const scoped = { ...job };
  for (const key of serverOwnedKeys) delete scoped[key];
  if (scoped.payload && typeof scoped.payload === "object" && !Array.isArray(scoped.payload)) {
    scoped.payload = { ...scoped.payload };
    for (const key of serverOwnedKeys) delete scoped.payload[key];
  }
  return scoped;
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

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, Number(ms) || 0)));
}

async function invokeQueuePump({
  origin,
  secret,
  body,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const response = await fetchImpl(`${origin}/api/v4/listing-job-pump`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [workerSecretHeader]: secret
      },
      body: JSON.stringify(body)
    });
    let responseBody = null;
    try {
      responseBody = typeof response?.json === "function" ? await response.json() : null;
    } catch {
      responseBody = null;
    }
    return {
      invoked: true,
      ok: response?.ok === true && responseBody?.ok !== false,
      status: response?.status ?? null,
      error: responseBody?.message || responseBody?.failed_calls?.[0]?.message || null,
      pump_failed_call_count: Number(responseBody?.failed_call_count || 0),
      pump_claimed_count: Number(responseBody?.claimed_count || 0),
      pump_processed_count: Number(responseBody?.processed_count || 0)
    };
  } catch (error) {
    return { invoked: true, ok: false, status: null, error: error?.message || "queue_pump_fetch_failed" };
  }
}

export async function runPostEnqueueQueueKick({
  origin,
  secret,
  body,
  kickOwner,
  leaseMs,
  acquireKick = tryAcquireV4QueueKick,
  fetchImpl = globalThis.fetch,
  sleep = delay
} = {}) {
  const acquire = (owner) => acquireKick({
    scope: "global",
    owner,
    leaseMs
  });
  const initial = await acquire(kickOwner);
  if (!initial.ok || initial.acquired) {
    const invocation = await invokeQueuePump({ origin, secret, body, fetchImpl });
    return { phase: "initial", acquired: initial.acquired === true, acquisition_ok: initial.ok === true, ...invocation };
  }

  // A running pump can claim only the jobs visible at its current cycle. When
  // this enqueue loses the short dedup lease, schedule one coalesced follow-up
  // instead of silently stranding new work until the long-running pump exits.
  await sleep(Math.max(250, Number(leaseMs) || 0) + 100);
  const followupOwner = `${kickOwner}-followup`;
  const followup = await acquire(followupOwner);
  if (followup.ok && !followup.acquired) {
    return { phase: "followup", acquired: false, acquisition_ok: true, invoked: false, ok: true, status: null, error: null };
  }
  const invocation = await invokeQueuePump({
    origin,
    secret,
    body: { ...body, reason: "post_enqueue_deduplicated_followup" },
    fetchImpl
  });
  return { phase: "followup", acquired: followup.acquired === true, acquisition_ok: followup.ok === true, ...invocation };
}

export function triggerV4QueuePumpAfterEnqueue(_req, {
  tenantId,
  batchId,
  queuedCount,
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil,
  acquireKick = tryAcquireV4QueueKick,
  sleep = delay
} = {}) {
  if (!queuedCount) return { triggered: false, reason: "no_jobs_queued" };
  if (!envFlag(env, "V4_QUEUE_AUTOKICK_ENABLED", true)) return { triggered: false, reason: "autokick_disabled" };
  const secret = configuredWorkerSecret(env);
  if (!secret) return { triggered: false, reason: "worker_secret_missing" };
  const origin = trustedInternalServiceOrigin(env);
  if (!origin) return { triggered: false, reason: "internal_origin_missing" };
  const stableConcurrency = v4WorkerProcessConcurrency(env);
  const perWorkerLimit = positiveInteger(env.V4_QUEUE_AUTOKICK_LIMIT_PER_WORKER, 2, { min: 1, max: 10 });
  const interactiveWorkers = positiveInteger(env.V4_QUEUE_AUTOKICK_INTERACTIVE_WORKERS, 5, { min: 1, max: 32 });
  const backgroundWorkers = positiveInteger(env.V4_QUEUE_AUTOKICK_BACKGROUND_WORKERS, 2, { min: 1, max: 32 });
  const interactiveLimit = positiveInteger(env.V4_PUMP_INTERACTIVE_CONCURRENCY, interactiveWorkers * perWorkerLimit, { min: 1, max: 96 });
  const backgroundLimit = positiveInteger(env.V4_PUMP_BACKGROUND_CONCURRENCY, backgroundWorkers * perWorkerLimit, { min: 1, max: 96 });
  const interactiveConcurrency = Math.min(stableConcurrency, interactiveLimit);
  const backgroundConcurrency = Math.min(stableConcurrency, backgroundLimit);

  const body = {
    tenant_id: v4QueueGlobalDrainEnabled(env) ? null : tenantId || batchId || null,
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
  const leaseMs = v4QueueKickDedupMs(env);
  defer(runPostEnqueueQueueKick({
    origin,
    secret,
    body,
    kickOwner,
    leaseMs,
    acquireKick,
    fetchImpl,
    sleep
  }).then((diagnostic) => {
    console.log(JSON.stringify({
      level: diagnostic.ok ? "info" : "warn",
      message: "v4_queue_post_enqueue_kick",
      batch_id: batchId || null,
      tenant_id: tenantId || null,
      queued_count: queuedCount,
      lease_ms: leaseMs,
      ...diagnostic
    }));
    return diagnostic;
  }));
  return {
    triggered: true,
    reason: "post_enqueue_deduplicated_kick_scheduled",
    tenant_id: body.tenant_id,
    global_drain: body.tenant_id === null
  };
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-enqueue" });
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
  } catch (error) {
    const status = requestPayloadErrorStatus(error);
    sendJson(res, status, withV4Version({
      ok: false,
      retryable: false,
      error_code: status === 413 ? "V4_QUEUE_REQUEST_TOO_LARGE" : "V4_QUEUE_INVALID_REQUEST",
      message: status === 413 ? "Queue request is too large. Split the batch into smaller requests." : "Invalid request."
    }));
    return;
  }

  const operatorId = context.userId;
  const tenantId = context.tenantId;
  // Scheduling and data ownership use the signed principal. The browser's
  // batch id remains a batch id and cannot impersonate another tenant.
  const clientBatchToken = String(payload.batch_id || payload.batchId || "").trim();
  if (clientBatchToken && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(clientBatchToken)) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_QUEUE_BATCH_TOKEN_INVALID",
      message: "batch_id must be an opaque 1-120 character token."
    }));
    return;
  }
  const batchId = createV4DeterministicBatchId({
    tenantId,
    operatorId,
    idempotencyKey: clientBatchToken
  }) || createV4BatchId("v4batch");
  // Session IDs are ownership-bearing server identifiers. A browser may
  // provide an idempotency key, but it cannot select an existing session.
  const sourceJobs = jobsFromPayload(payload).map(withoutClientSessionIdentity);
  const maxJobsPerRequest = positiveInteger(process.env.V4_QUEUE_MAX_JOBS_PER_REQUEST, 50, { min: 1, max: 250 });
  if (sourceJobs.length > maxJobsPerRequest) {
    sendJson(res, 413, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_QUEUE_BATCH_TOO_LARGE",
      message: `Queue request contains ${sourceJobs.length} jobs; split it into batches of at most ${maxJobsPerRequest}.`,
      max_jobs_per_request: maxJobsPerRequest
    }));
    return;
  }
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

  const failedEntries = result.jobs.filter((entry) => !entry.saved);
  const acceptedCount = Number(result.accepted_count ?? result.jobs.filter((entry) => entry.saved).length);
  const noJobsAccepted = stageJobs.length > 0 && acceptedCount === 0;
  const deterministicConflict = failedEntries.some((entry) => (
    /identity_conflict|terminal_retry_required/.test(String(entry.error || ""))
  ));
  const responseStatus = noJobsAccepted ? deterministicConflict ? 409 : 503 : 200;
  const failureMessage = failedEntries
    .map((entry) => String(entry.error || "queue_job_persistence_failed").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");

  sendJson(res, responseStatus, withV4Version({
    ok: acceptedCount > 0,
    retryable: noJobsAccepted && !deterministicConflict,
    error_code: noJobsAccepted
      ? deterministicConflict ? "V4_QUEUE_IDENTITY_CONFLICT" : "V4_QUEUE_PERSISTENCE_FAILED"
      : null,
    message: noJobsAccepted
      ? failureMessage || "The recognition job was not persisted. Retry is safe because queue IDs are idempotent."
      : null,
    batch_id: result.batchId,
    tenant_id: tenantId,
    accepted_count: acceptedCount,
    queued_count: result.queued_count,
    inserted_count: result.inserted_count,
    deduplicated_count: result.deduplicated_count,
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
      tenant_id: entry.row?.tenant_id || tenantId || null,
      status: entry.row?.status || null,
      deduplicated: entry.deduplicated === true,
      error: entry.error || null
    }))
  }));
}
