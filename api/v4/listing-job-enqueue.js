import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  AssetLifecycleContractError,
  assetRecoveryActions,
  requestedImageGenerationId,
  stripClientImageTransport
} from "../../lib/listing/v4/assets/asset-lifecycle-contract.mjs";
import { v4ProductionStrategy } from "../../lib/listing/v4/policy/production-strategy.mjs";
import {
  CanonicalImageReferenceError,
  readCanonicalListingImageReferences
} from "../../lib/listing/storage/canonical-image-references.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest
} from "../../lib/observability/production-events.mjs";
import { normalizeDurableListingAssetId } from "../../lib/tenant/assets.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
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
import { trustedInternalServiceOrigin } from "../../lib/listing/v4/jobs/internal-service-origin.mjs";
import { invokeTrustedV4QueuePump } from "../../lib/listing/v4/jobs/internal-queue-wake.mjs";
import { configuredWorkerSecret } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";

const queueControlChars = /[\u0000-\u001f\u007f]/g;
class QueueSchedulingIntentError extends Error {
  constructor(code, { statusCode = 409, retryable = false } = {}) {
    super(code);
    this.name = "QueueSchedulingIntentError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function isQueueSchemaDependencyFailure(error) {
  const text = String(error || "").toLowerCase();
  return text.includes("atomic_enqueue_rpc_failed") && (
    (text.includes("relation") && text.includes("does not exist"))
    || text.includes("queue_rpc_not_ready")
    || (text.includes("pgrst202") && text.includes("enqueue_v4_recognition_batch_atomic"))
  );
}

function jobsFromPayload(payload = {}) {
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (payload.payload && typeof payload.payload === "object") return [{ payload: payload.payload }];
  return [payload];
}

function withSanitizedControlText(value = "", fallback = "asset") {
  const trimmed = String(value || "")
    .replace(queueControlChars, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return trimmed || String(fallback || "asset").slice(0, 160);
}

function queueJobIdentity(job = {}) {
  const rawPayload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? job.payload
    : {};
  const sourceAssetId = String(job.asset_id || job.assetId || rawPayload.asset_id || rawPayload.assetId || "").trim();
  const sourceClientRef = String(
    job.client_asset_ref || job.clientAssetRef || rawPayload.client_asset_ref || rawPayload.clientAssetRef || ""
  ).trim();
  const asset_id = normalizeDurableListingAssetId(sourceAssetId);
  const client_asset_ref = withSanitizedControlText(
    sourceClientRef || sourceAssetId || asset_id,
    asset_id
  );
  return { asset_id, client_asset_ref, rawPayload };
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
    "queue_tags", "tags", "status",
    "preingestion_bundle_id", "preingestionBundleId", "preingestion_bundle", "preingestionBundle",
    "preingestion_bundle_used", "preingestionBundleUsed",
    "preingestion_bundle_status", "preingestionBundleStatus",
    "preingestion_summary", "preingestionSummary",
    "preingestion_initial_evidence", "preingestionInitialEvidence",
    "preingestion_evidence_patches", "preingestionEvidencePatches",
    "trusted_manual_retry",
    "manual_retry_requested_by_user_id", "manualRetryRequestedByUserId",
    "manual_retry_original_operator_id", "manualRetryOriginalOperatorId",
    "v4_hard_invariant_snapshot"
  ];
  const scoped = { ...job };
  for (const key of serverOwnedKeys) delete scoped[key];
  if (scoped.payload && typeof scoped.payload === "object" && !Array.isArray(scoped.payload)) {
    scoped.payload = { ...scoped.payload };
    for (const key of serverOwnedKeys) delete scoped.payload[key];
  }
  return scoped;
}

function freshManualRetryIntent(job = {}) {
  const payload = job?.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? job.payload
    : {};
  const retryOfJobId = String(
    job?.retry_of_job_id || job?.retryOfJobId || payload.retry_of_job_id || payload.retryOfJobId || ""
  ).trim();
  return {
    requested: job?.manual_retry === true || payload.manual_retry === true || Boolean(retryOfJobId),
    retryOfJobId
  };
}

export function queueJobsRequireRetryPermission(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).some((job) => freshManualRetryIntent(job).requested);
}

export function queueJobsRequireCreatePermission(jobs = []) {
  const source = Array.isArray(jobs) ? jobs : [];
  return source.length === 0 || source.some((job) => !freshManualRetryIntent(job).requested);
}

export function createQueueRequestBatchId({
  clientBatchToken = "",
  jobs = [],
  tenantId = "",
  operatorId = ""
} = {}) {
  const token = String(clientBatchToken || "").trim();
  if (!token) return createV4BatchId("v4batch");

  // The browser streams each ready card independently so later cards do not
  // wait for the slowest upload. Scope the deterministic batch identity to the
  // assets in this request: retries remain idempotent, while concurrent cards
  // sharing one client batch token cannot race on a single immutable DB row.
  const assetIds = [...new Set((Array.isArray(jobs) ? jobs : [])
    .map((job) => String(job?.asset_id || job?.assetId || job?.payload?.asset_id || job?.payload?.assetId || "").trim())
    .filter(Boolean))]
    .sort();
  const requestIdentity = assetIds.length
    ? `${token}\u001e${assetIds.join("\u001f")}`
    : token;
  return createV4DeterministicBatchId({
    tenantId,
    operatorId,
    idempotencyKey: requestIdentity
  }) || createV4BatchId("v4batch");
}

export async function authorizeFreshManualRetryJobs({
  jobs = [],
  tenantId,
  operatorId,
  permissionContext = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  readRows = readV4Rows
} = {}) {
  const source = Array.isArray(jobs) ? jobs : [];
  const claims = source.map((job, index) => {
    const payload = job?.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? job.payload
      : {};
    const { requested, retryOfJobId } = freshManualRetryIntent(job);
    if (!requested) return null;
    if (!retryOfJobId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(retryOfJobId)) {
      throw new QueueSchedulingIntentError("manual_retry_reference_required", { statusCode: 400 });
    }
    return {
      index,
      retryOfJobId,
      assetId: String(job?.asset_id || payload.asset_id || "").trim()
    };
  }).filter(Boolean);

  if (!claims.length) return source;
  const jobIds = [...new Set(claims.map((claim) => claim.retryOfJobId))];
  const quotedIds = jobIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  const existing = await readRows({
    table: "v4_recognition_jobs",
    select: "id,tenant_id,operator_id,assigned_to_user_id,asset_id,status",
    search: {
      tenant_id: `eq.${tenantId}`,
      id: `in.(${quotedIds})`,
      limit: String(jobIds.length)
    },
    env,
    fetchImpl
  });
  if (!existing?.ok) {
    throw new QueueSchedulingIntentError("manual_retry_verification_unavailable", {
      statusCode: 503,
      retryable: true
    });
  }

  const rowsById = new Map((existing.rows || []).map((row) => [String(row?.id || ""), row]));
  const retryableStatuses = new Set(["FAILED", "CANCELLED"]);
  const claimByIndex = new Map();
  for (const claim of claims) {
    const row = rowsById.get(claim.retryOfJobId);
    const originalOperatorId = String(row?.operator_id || "").trim();
    if (
      !row
      || String(row.tenant_id || "") !== String(tenantId || "")
      || !originalOperatorId
      || String(row.asset_id || "") !== claim.assetId
      || !retryableStatuses.has(String(row.status || "").toUpperCase())
    ) {
      throw new QueueSchedulingIntentError("manual_retry_reference_not_retryable", { statusCode: 409 });
    }
    try {
      requirePermission(permissionContext, TENANT_PERMISSIONS.RETRY_JOB, {
        assignedUserId: String(row.assigned_to_user_id || row.operator_id || "").trim()
      });
    } catch {
      throw new QueueSchedulingIntentError("manual_retry_permission_denied", { statusCode: 403 });
    }
    claimByIndex.set(claim.index, { ...claim, originalOperatorId });
  }

  return source.map((job, index) => {
    const claim = claimByIndex.get(index);
    if (!claim) return job;
    return {
      ...job,
      trusted_manual_retry: true,
      priority: 0,
      retry_of_job_id: claim.retryOfJobId,
      queue_tags: {
        ...(job.queue_tags || job.tags || {}),
        manual_retry_requested_by_user_id: operatorId,
        manual_retry_original_operator_id: claim.originalOperatorId
      },
      payload: {
        ...(job.payload || {}),
        manual_retry: true,
        retry_of_job_id: claim.retryOfJobId
      }
    };
  });
}

export async function canonicalizeQueueJobs({
  jobs = [],
  tenantId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  readCanonical = readCanonicalListingImageReferences
} = {}) {
  const canonicalByAsset = new Map();
  const canonicalForAsset = (assetId) => {
    if (!canonicalByAsset.has(assetId)) {
      canonicalByAsset.set(assetId, readCanonical({
        tenantId,
        assetId,
        env,
        fetchImpl
      }));
    }
    return canonicalByAsset.get(assetId);
  };
  return Promise.all((Array.isArray(jobs) ? jobs : []).map(async (job) => {
    const identity = queueJobIdentity(job);
    const requestedGenerationId = requestedImageGenerationId(job);
    const canonical = await canonicalForAsset(identity.asset_id);
    v4ProductionStrategy.asset_lifecycle.assert_image_generation({
      requestedGenerationId,
      canonicalGenerationId: canonical.image_generation_id
    });
    const scoped = stripClientImageTransport(withoutClientSessionIdentity(job));
    const scopedPayload = stripClientImageTransport(
      scoped.payload && typeof scoped.payload === "object" && !Array.isArray(scoped.payload)
        ? scoped.payload
        : identity.rawPayload
    );
    const images = canonical.images.map((image) => ({ ...image }));
    const imageReferences = canonical.image_references.map((reference) => ({ ...reference }));
    const imagePaths = canonical.image_paths || {};
    return {
      ...scoped,
      asset_id: identity.asset_id,
      assetId: identity.asset_id,
      client_asset_ref: identity.client_asset_ref,
      clientAssetRef: identity.client_asset_ref,
      payload: {
        ...scopedPayload,
        asset_id: identity.asset_id,
        assetId: identity.asset_id,
        client_asset_ref: identity.client_asset_ref,
        clientAssetRef: identity.client_asset_ref,
        image_generation_id: canonical.image_generation_id,
        image_set_sha256: canonical.image_set_sha256,
        expected_original_count: canonical.expected_original_count,
        images,
        image_references: imageReferences,
        imageReferences,
        front_bucket: imagePaths.front_bucket || null,
        front_object_path: imagePaths.front_object_path || null,
        front_content_sha256: imagePaths.front_content_sha256 || null,
        back_bucket: imagePaths.back_bucket || null,
        back_object_path: imagePaths.back_object_path || null,
        back_content_sha256: imagePaths.back_content_sha256 || null,
        additional_image_paths: Array.isArray(imagePaths.additional_image_paths)
          ? imagePaths.additional_image_paths.map((reference) => ({ ...reference }))
          : []
      }
    };
  }));
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
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  return invokeTrustedV4QueuePump({
    payload: body,
    env: {
      ...env,
      V4_INTERNAL_BASE_URL: origin,
      V4_JOB_WORKER_SECRET: secret
    },
    fetchImpl
  });
}

export async function runPostEnqueueQueueKick({
  origin,
  secret,
  body,
  kickOwner,
  leaseMs,
  acquireKick = tryAcquireV4QueueKick,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  env = process.env
} = {}) {
  const acquire = (owner) => acquireKick({
    scope: "global",
    owner,
    leaseMs,
    env,
    fetchImpl
  });
  const initial = await acquire(kickOwner);
  if (!initial.ok || initial.acquired) {
    const invocation = await invokeQueuePump({ origin, secret, body, fetchImpl, env });
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
    fetchImpl,
    env
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
  if (!origin) return { triggered: false, reason: "trusted_internal_origin_missing" };
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
    cycles: 1,
    max_runtime_ms: 120_000,
    lease_seconds: 120,
    parallel_lanes: true,
    idle_delay_ms: 0,
    idle_cycles_before_stop: 1,
    background_idle_cycles: 1,
    continuation_cycles: 1,
    max_continuation_depth: 100,
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
    sleep,
    env
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
  const rawJobs = jobsFromPayload(payload);
  try {
    if (queueJobsRequireCreatePermission(rawJobs)) requirePermission(context, TENANT_PERMISSIONS.CREATE_JOB);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }
  const maxJobsPerRequest = positiveInteger(process.env.V4_QUEUE_MAX_JOBS_PER_REQUEST, 50, { min: 1, max: 250 });
  if (rawJobs.length > maxJobsPerRequest) {
    sendJson(res, 413, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_QUEUE_BATCH_TOO_LARGE",
      message: `Queue request contains ${rawJobs.length} jobs; split it into batches of at most ${maxJobsPerRequest}.`,
      max_jobs_per_request: maxJobsPerRequest
    }));
    return;
  }
  // Session IDs are ownership-bearing server identifiers. A browser may
  // provide an idempotency key, but it cannot select an existing session.
  let sourceJobs;
  try {
    const canonicalJobs = await canonicalizeQueueJobs({
      jobs: rawJobs,
      tenantId,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    sourceJobs = await authorizeFreshManualRetryJobs({
      jobs: canonicalJobs,
      tenantId,
      operatorId,
      permissionContext: context,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
  } catch (error) {
    const canonicalError = error instanceof CanonicalImageReferenceError;
    const lifecycleError = error instanceof AssetLifecycleContractError;
    const schedulingError = error instanceof QueueSchedulingIntentError;
    const invalidAsset = String(error?.message || "").includes("invalid_durable_listing_asset_id");
    const status = schedulingError
      ? error.statusCode
      : lifecycleError
        ? error.statusCode
        : canonicalError
          ? error.statusCode
          : invalidAsset ? 400 : 503;
    const code = schedulingError
      ? String(error.code || "manual_retry_verification_failed").toUpperCase()
      : lifecycleError
        ? String(error.code || "asset_lifecycle_contract_failed").toUpperCase()
        : canonicalError
          ? String(error.code || "canonical_image_reference_failed").toUpperCase()
          : invalidAsset ? "V4_QUEUE_DURABLE_ASSET_REQUIRED" : "V4_QUEUE_CANONICAL_IMAGE_REBUILD_FAILED";
    const lifecycleClassification = v4ProductionStrategy.asset_lifecycle.classify_failure({
      code,
      message: error?.message,
      retryable: error?.retryable
    });
    const recoveryAction = lifecycleError
      ? error.recoveryAction
      : canonicalError
        ? lifecycleClassification.recovery_action === assetRecoveryActions.INPUT_REBIND
          ? assetRecoveryActions.INPUT_REBIND
          : error.retryable === true
            ? assetRecoveryActions.EXECUTION_RETRY
            : assetRecoveryActions.NONE
        : null;
    sendJson(res, status, withV4Version({
      ok: false,
      retryable: schedulingError || lifecycleError || canonicalError ? error.retryable === true : !invalidAsset,
      error_code: code,
      recovery_action: recoveryAction,
      message: schedulingError
        ? "The referenced failed job could not be authorized for a priority retry."
        : lifecycleError
        ? "The requested image generation is stale or missing; rebind the current verified images before enqueueing."
        : invalidAsset
        ? "Create a durable listing asset before uploading and enqueueing images."
        : canonicalError
          ? recoveryAction === assetRecoveryActions.EXECUTION_RETRY
            ? "Verified canonical images are temporarily unavailable; retry the same immutable request."
            : "Verified canonical images are not ready for this listing asset."
          : "Canonical listing images could not be rebuilt."
    }));
    return;
  }
  const batchId = createQueueRequestBatchId({
    clientBatchToken,
    jobs: sourceJobs,
    tenantId,
    operatorId
  });
  const requestPriority = positiveInteger(payload.priority, 100, { min: 0, max: 10_000 });
  const stageJobs = expandV4RecognitionStageJobs({
    jobs: sourceJobs,
    batchId,
    operatorId,
    tenantId,
    priority: requestPriority
  });
  const result = await enqueueV4RecognitionJobs({
    jobs: stageJobs,
    batchId,
    operatorId,
    tenantId,
    priority: requestPriority
  });
  const pump = triggerV4QueuePumpAfterEnqueue(req, {
    tenantId,
    batchId: result.batchId,
    queuedCount: result.queued_count
  });

  const failedEntries = result.jobs.filter((entry) => !entry.saved);
  const acceptedCount = Number(result.accepted_count ?? result.jobs.filter((entry) => entry.saved).length);
  const noJobsAccepted = stageJobs.length > 0 && acceptedCount === 0;
  const queueSchemaDependencyMissing = failedEntries.some((entry) => isQueueSchemaDependencyFailure(entry.error));
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
    retryable: noJobsAccepted && (!deterministicConflict || queueSchemaDependencyMissing),
    error_code: noJobsAccepted
      ? queueSchemaDependencyMissing
        ? "V4_QUEUE_SCHEMA_DEPENDENCY_MISSING"
        : deterministicConflict
          ? "V4_QUEUE_IDENTITY_CONFLICT"
          : "V4_QUEUE_PERSISTENCE_FAILED"
      : null,
    message: noJobsAccepted
      ? queueSchemaDependencyMissing
        ? "任务提交失败。原因：系统队列尚未完成初始化，请稍后重试。内部：QUEUE_RPC_NOT_READY"
        : failureMessage || "The recognition job was not persisted. Retry is safe because queue IDs are idempotent."
      : null,
    internal_error_code: queueSchemaDependencyMissing ? "QUEUE_RPC_NOT_READY" : null,
    batch_id: result.batchId,
    client_batch_token: clientBatchToken || null,
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
