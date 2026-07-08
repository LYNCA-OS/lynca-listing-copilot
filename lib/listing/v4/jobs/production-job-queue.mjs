import crypto from "node:crypto";
import { openAiProviderGlobalConcurrency } from "../../providers/openai-key-pool.mjs";
import { v4SchemaVersion } from "../schema/version.mjs";
import { createV4RecognitionSession, createV4SessionId } from "../session/session-store.mjs";
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

export const v4JobLanes = Object.freeze({
  INTERACTIVE: "interactive",
  BACKGROUND: "background"
});

export const v4JobTypes = Object.freeze({
  FAST_SCOUT_DRAFT: "FAST_SCOUT_DRAFT",
  FINAL_ASSISTED_TITLE: "FINAL_ASSISTED_TITLE"
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

function normalizeLane(value, fallback = v4JobLanes.BACKGROUND) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(v4JobLanes).includes(normalized) ? normalized : fallback;
}

function normalizeJobType(value, fallback = v4JobTypes.FINAL_ASSISTED_TITLE) {
  const normalized = String(value || "").trim().toUpperCase();
  if (Object.values(v4JobTypes).includes(normalized)) return normalized;
  if (normalized === "LISTING_TITLE" || normalized === "TITLE") return fallback;
  return fallback;
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
  return positiveInteger(env.V4_JOB_WORKER_CLAIM_LIMIT, openAiProviderGlobalConcurrency(env), { min: 1, max: 96 });
}

export function v4WorkerLeaseSeconds(env = process.env) {
  return positiveInteger(env.V4_JOB_LEASE_SECONDS, 120, { min: 30, max: 900 });
}

export function v4WorkerMaxWaitMs(env = process.env) {
  return positiveInteger(env.V4_JOB_WORKER_MAX_WAIT_MS, 55_000, { min: 5_000, max: 240_000 });
}

export function v4WorkerProcessConcurrency(env = process.env) {
  return positiveInteger(env.V4_JOB_WORKER_PROCESS_CONCURRENCY, openAiProviderGlobalConcurrency(env), { min: 1, max: 96 });
}

function l2DeferredUntil() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
  const jobType = normalizeJobType(job.job_type || payload.job_type);
  const lane = normalizeLane(job.lane || payload.lane, jobType === v4JobTypes.FAST_SCOUT_DRAFT ? v4JobLanes.INTERACTIVE : v4JobLanes.BACKGROUND);
  return compact({
    id: job.id || job.job_id || createV4JobId(),
    schema_version: v4SchemaVersion,
    batch_id: job.batch_id || batchId,
    tenant_id: job.tenant_id || tenantId || payload.tenant_id || null,
    operator_id: job.operator_id || operatorId || null,
    asset_id: assetId,
    recognition_session_id: sessionId,
    job_type: jobType,
    lane,
    parent_job_id: job.parent_job_id || job.parentJobId || payload.parent_job_id || null,
    paired_job_id: job.paired_job_id || job.pairedJobId || payload.paired_job_id || null,
    provider_id: job.provider_id || payload.provider_id || payload.provider || payload.vision_provider || "openai_legacy",
    status: v4JobStatuses.QUEUED,
    priority: positiveInteger(job.priority, priority, { min: 0, max: 10_000 }),
    payload,
    result: {},
    stage_result: job.stage_result || {},
    error: {},
    timing: {},
    queue_tags: {
      ...(job.queue_tags || job.tags || {}),
      lane,
      job_type: jobType
    },
    max_attempts: positiveInteger(job.max_attempts, 2, { min: 1, max: 10 }),
    not_before: job.not_before || nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

export function expandV4RecognitionStageJobs({
  jobs = [],
  batchId = createV4BatchId(),
  operatorId = null,
  tenantId = null,
  priority = 100
} = {}) {
  const expanded = [];
  for (const input of Array.isArray(jobs) ? jobs : []) {
    if (!input) continue;
    const basePayload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? { ...input.payload }
      : { ...input };
    const queueFastScout = basePayload.enable_queue_fast_scout === true ||
      input.enable_queue_fast_scout === true ||
      input.job_type === v4JobTypes.FAST_SCOUT_DRAFT ||
      basePayload.job_type === v4JobTypes.FAST_SCOUT_DRAFT;
    const forceL2Only = basePayload.force_l2_only === true ||
      input.force_l2_only === true ||
      input.job_type === v4JobTypes.FINAL_ASSISTED_TITLE ||
      !queueFastScout;
    const sessionId = basePayload.recognition_session_id || input.recognition_session_id || createV4SessionId();
    basePayload.recognition_session_id = sessionId;
    const baseJob = {
      ...input,
      payload: basePayload,
      batch_id: input.batch_id || batchId,
      operator_id: input.operator_id || operatorId || null,
      tenant_id: input.tenant_id || tenantId || basePayload.tenant_id || null
    };
    if (forceL2Only) {
      expanded.push(normalizeV4JobInput({
        job: {
          ...baseJob,
          job_type: v4JobTypes.FINAL_ASSISTED_TITLE,
          lane: v4JobLanes.BACKGROUND,
          priority: input.priority ?? priority
        },
        batchId,
        operatorId,
        tenantId,
        priority
      }));
      continue;
    }
    const l1JobId = input.l1_job_id || createV4JobId("v4job_l1");
    const l2JobId = input.l2_job_id || createV4JobId("v4job_l2");
    expanded.push(normalizeV4JobInput({
      job: {
        ...baseJob,
        id: l1JobId,
        job_type: v4JobTypes.FAST_SCOUT_DRAFT,
        lane: v4JobLanes.INTERACTIVE,
        paired_job_id: l2JobId,
        priority: input.l1_priority ?? input.priority ?? Math.max(0, positiveInteger(priority, 100, { min: 0, max: 10_000 }) - 50),
        payload: {
          ...basePayload,
          job_type: v4JobTypes.FAST_SCOUT_DRAFT,
          lane: v4JobLanes.INTERACTIVE
        }
      },
      batchId,
      operatorId,
      tenantId,
      priority
    }));
    expanded.push(normalizeV4JobInput({
      job: {
        ...baseJob,
        id: l2JobId,
        job_type: v4JobTypes.FINAL_ASSISTED_TITLE,
        lane: v4JobLanes.BACKGROUND,
        parent_job_id: l1JobId,
        paired_job_id: l1JobId,
        not_before: input.l2_not_before || l2DeferredUntil(),
        priority: input.l2_priority ?? positiveInteger(input.priority ?? priority, 100, { min: 0, max: 10_000 }) + 100,
        payload: {
          ...basePayload,
          job_type: v4JobTypes.FINAL_ASSISTED_TITLE,
          lane: v4JobLanes.BACKGROUND,
          waits_for_job_id: l1JobId
        }
      },
      batchId,
      operatorId,
      tenantId,
      priority
    }));
  }
  return expanded;
}

export async function releasePairedV4FinalJob({
  job = {},
  reason = "l1_ready",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const jobType = normalizeJobType(job.job_type || job.payload?.job_type);
  if (jobType !== v4JobTypes.FAST_SCOUT_DRAFT || !job.paired_job_id) {
    return { saved: false, skipped: true, error: "no_paired_final_job" };
  }
  const priority = positiveInteger(job.priority, 100, { min: 0, max: 10_000 });
  return markV4RecognitionJob({
    jobId: job.paired_job_id,
    status: v4JobStatuses.QUEUED,
    patch: {
      not_before: nowIso(),
      priority: Math.max(0, priority + 1),
      queue_tags: {
        ...(job.queue_tags || {}),
        lane: v4JobLanes.BACKGROUND,
        job_type: v4JobTypes.FINAL_ASSISTED_TITLE,
        released_by_parent_job_id: job.id || null,
        release_reason: reason
      }
    },
    env,
    fetchImpl
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
  const sessionIds = [...new Set(prepared.map((row) => row.recognition_session_id).filter(Boolean))];
  const existingSessions = new Set();
  if (sessionIds.length) {
    const quoted = sessionIds.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",");
    const existing = await readV4Rows({
      table: "v4_recognition_sessions",
      select: "id",
      search: { id: `in.(${quoted})`, limit: String(sessionIds.length) },
      env,
      fetchImpl
    });
    if (existing.ok) {
      existing.rows.forEach((row) => {
        if (row?.id) existingSessions.add(row.id);
      });
    }
  }
  const results = [];
  const sessionWrites = new Map();
  for (const row of prepared) {
    if (!row.recognition_session_id || existingSessions.has(row.recognition_session_id) || sessionWrites.has(row.recognition_session_id)) continue;
    const session = await createV4RecognitionSession({
      sessionId: row.recognition_session_id,
      payload: row.payload || {},
      routePlan: {
        route: "V4_QUEUE_PENDING",
        route_reason: "session stub created before queued stage workers run"
      },
      operatorId: row.operator_id || operatorId || "",
      env,
      fetchImpl
    });
    const saved = session.persistence?.recognition_session?.saved === true;
    sessionWrites.set(row.recognition_session_id, {
      saved,
      error: session.persistence?.recognition_session?.error || null
    });
    if (saved) existingSessions.add(row.recognition_session_id);
  }
  for (const row of prepared) {
    const sessionWrite = sessionWrites.get(row.recognition_session_id);
    if (sessionWrite && !sessionWrite.saved) {
      results.push({
        saved: false,
        row,
        error: `recognition_session_create_failed:${sessionWrite.error || "unknown_error"}`
      });
      continue;
    }
    const result = await writeV4Row({ table, row, upsert: true, env, fetchImpl });
    results.push({ ...result, row: result.row || row });
  }
  return { batchId, jobs: results, queued_count: results.filter((result) => result.saved).length };
}

export async function claimV4RecognitionJobs({
  limit = 1,
  workerId = "worker",
  leaseSeconds = 120,
  lane = null,
  tenantId = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedLane = lane ? normalizeLane(lane, "") : null;
  return callV4Rpc({
    fn: "claim_v4_recognition_jobs",
    payload: {
      p_limit: positiveInteger(limit, 1, { min: 1, max: 25 }),
      p_worker_id: String(workerId || "worker").slice(0, 120),
      p_lease_seconds: positiveInteger(leaseSeconds, 120, { min: 30, max: 900 }),
      p_lane: normalizedLane || null,
      p_tenant_id: tenantId ? String(tenantId).slice(0, 120) : null
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
  status = v4JobStatuses.L2_READY,
  result = {},
  stageResult = null,
  timing = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return markV4RecognitionJob({
    jobId,
    status,
    patch: {
      result,
      stage_result: stageResult || result,
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
