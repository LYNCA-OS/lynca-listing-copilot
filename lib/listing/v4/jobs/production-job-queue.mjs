import crypto from "node:crypto";
import { v4SchemaVersion } from "../schema/version.mjs";
import { createV4SessionId } from "../session/session-store.mjs";
import { callV4Rpc, isV4SupabaseConfigured, patchV4Row, readV4Rows, writeV4Row } from "../session/supabase-rest.mjs";

export const v4JobStatuses = Object.freeze({
  QUEUED: "QUEUED",
  RETRYING: "RETRYING",
  RUNNING: "RUNNING",
  L1_READY: "L1_READY",
  L2_READY: "L2_READY",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
});

const table = "v4_recognition_jobs";

function nowIso() {
  return new Date().toISOString();
}

function compact(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, next]) => next !== undefined)
  );
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function createV4JobId(prefix = "v4job") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createV4BatchId(prefix = "v4batch") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function v4QueueConfigured(env = process.env) {
  return isV4SupabaseConfigured(env);
}

export function v4WorkerClaimLimit(env = process.env) {
  return positiveInteger(env.V4_JOB_WORKER_CLAIM_LIMIT, 2, { min: 1, max: 12 });
}

export function v4WorkerLeaseSeconds(env = process.env) {
  return positiveInteger(env.V4_JOB_LEASE_SECONDS, 120, { min: 30, max: 900 });
}

export function v4WorkerMaxWaitMs(env = process.env) {
  return positiveInteger(env.V4_JOB_WORKER_MAX_WAIT_MS, 55_000, { min: 5_000, max: 240_000 });
}

export function normalizeV4JobInput({
  job = {},
  batchId = createV4BatchId(),
  operatorId = null,
  tenantId = null,
  priority = 100
} = {}) {
  const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? { ...job.payload }
    : { ...job };
  const sessionId = payload.recognition_session_id || job.recognition_session_id || createV4SessionId();
  payload.recognition_session_id = sessionId;
  const assetId = job.asset_id || job.assetId || payload.asset_id || payload.assetId || null;
  if (assetId && !payload.asset_id) payload.asset_id = assetId;
  return compact({
    id: job.id || job.job_id || createV4JobId(),
    schema_version: v4SchemaVersion,
    batch_id: job.batch_id || batchId,
    tenant_id: job.tenant_id || tenantId || payload.tenant_id || null,
    operator_id: job.operator_id || operatorId || null,
    asset_id: assetId,
    recognition_session_id: sessionId,
    job_type: job.job_type || "listing_title",
    provider_id: job.provider_id || payload.provider_id || payload.provider || payload.vision_provider || "openai_legacy",
    status: v4JobStatuses.QUEUED,
    priority: positiveInteger(job.priority, priority, { min: 0, max: 10_000 }),
    payload,
    result: {},
    error: {},
    timing: {},
    queue_tags: job.queue_tags || job.tags || {},
    max_attempts: positiveInteger(job.max_attempts, 2, { min: 1, max: 10 }),
    not_before: job.not_before || nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

export async function enqueueV4RecognitionJob({
  job,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const row = normalizeV4JobInput(job);
  return writeV4Row({ table, row, upsert: true, env, fetchImpl });
}

export async function enqueueV4RecognitionJobs({
  jobs = [],
  batchId = createV4BatchId(),
  operatorId = null,
  tenantId = null,
  priority = 100,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const prepared = (Array.isArray(jobs) ? jobs : [])
    .filter(Boolean)
    .map((job) => normalizeV4JobInput({ job, batchId, operatorId, tenantId, priority }));
  const results = [];
  for (const row of prepared) {
    const result = await writeV4Row({ table, row, upsert: true, env, fetchImpl });
    results.push({ ...result, row: result.row || row });
  }
  return { batchId, jobs: results, queued_count: results.filter((result) => result.saved).length };
}

export async function claimV4RecognitionJobs({
  limit = 1,
  workerId = "worker",
  leaseSeconds = 120,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return callV4Rpc({
    fn: "claim_v4_recognition_jobs",
    payload: {
      p_limit: positiveInteger(limit, 1, { min: 1, max: 25 }),
      p_worker_id: String(workerId || "worker").slice(0, 120),
      p_lease_seconds: positiveInteger(leaseSeconds, 120, { min: 30, max: 900 })
    },
    env,
    fetchImpl
  });
}

export async function markV4RecognitionJob({
  jobId,
  status,
  patch = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!jobId) return { saved: false, error: "missing_job_id" };
  return patchV4Row({
    table,
    id: jobId,
    patch: compact({
      status,
      ...patch,
      updated_at: nowIso()
    }),
    env,
    fetchImpl
  });
}

export async function completeV4RecognitionJob({
  jobId,
  result = {},
  timing = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return markV4RecognitionJob({
    jobId,
    status: v4JobStatuses.L2_READY,
    patch: {
      result,
      timing,
      completed_at: nowIso(),
      lease_owner: null,
      lease_expires_at: null,
      error: {}
    },
    env,
    fetchImpl
  });
}

export async function failV4RecognitionJob({
  job = {},
  error = {},
  retryDelaySeconds = 15,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const attemptCount = positiveInteger(job.attempt_count, 0, { min: 0, max: 100 });
  const maxAttempts = positiveInteger(job.max_attempts, 2, { min: 1, max: 100 });
  const shouldRetry = attemptCount < maxAttempts;
  const delayMs = positiveInteger(retryDelaySeconds, 15, { min: 1, max: 900 }) * 1000;
  return markV4RecognitionJob({
    jobId: job.id,
    status: shouldRetry ? v4JobStatuses.RETRYING : v4JobStatuses.FAILED,
    patch: {
      error: {
        message: String(error?.message || error?.error || error || "unknown_error").slice(0, 500),
        code: error?.code || error?.status || null,
        failed_at: nowIso()
      },
      not_before: shouldRetry ? new Date(Date.now() + delayMs).toISOString() : job.not_before,
      completed_at: shouldRetry ? null : nowIso(),
      lease_owner: null,
      lease_expires_at: null
    },
    env,
    fetchImpl
  });
}

export async function readV4RecognitionJobs({
  batchId = "",
  jobIds = [],
  limit = 100,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const search = { order: "created_at.asc", limit: String(positiveInteger(limit, 100, { min: 1, max: 500 })) };
  if (batchId) search.batch_id = `eq.${batchId}`;
  const ids = Array.isArray(jobIds) ? jobIds.filter(Boolean).map(String) : [];
  if (ids.length) search.id = `in.(${ids.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`;
  if (!batchId && !ids.length) return { ok: false, rows: [], error: "batch_id_or_job_ids_required" };
  return readV4Rows({ table, select: "*", search, env, fetchImpl });
}
