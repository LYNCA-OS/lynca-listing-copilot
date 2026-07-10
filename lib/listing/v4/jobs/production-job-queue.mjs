import crypto from "node:crypto";
import {
  openAiPerKeyStableConcurrency,
  openAiProviderGlobalConcurrency
} from "../../providers/openai-key-pool.mjs";
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

function boolOption(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(value).trim().toLowerCase());
}

export function v4QueueDefaultCreateL1(env = process.env) {
  // L1 is an internal scout/experiment lane. Keep the production default on
  // direct L2 until an A/B run clears the title-quality guard, but allow
  // explicit per-job or env opt-in so the path can keep evolving.
  return boolOption(env.V4_QUEUE_DEFAULT_CREATE_L1, false);
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
  return openAiProviderGlobalConcurrency(env);
}

export function v4WorkerLeaseSeconds(env = process.env) {
  return positiveInteger(env.V4_JOB_LEASE_SECONDS, 120, { min: 30, max: 900 });
}

export function v4WorkerMaxWaitMs(env = process.env) {
  return positiveInteger(env.V4_JOB_WORKER_MAX_WAIT_MS, 55_000, { min: 5_000, max: 240_000 });
}

export function v4WorkerProcessConcurrency(env = process.env) {
  return openAiProviderGlobalConcurrency(env);
}

export function v4ProviderCapacityControlEnabled(env = process.env) {
  return boolOption(env.V4_PROVIDER_CAPACITY_CONTROL_ENABLED, true);
}

export function v4QueueGlobalDrainEnabled(env = process.env) {
  return boolOption(env.V4_QUEUE_GLOBAL_DRAIN_ENABLED, true);
}

export function v4QueueKickDedupMs(env = process.env) {
  return positiveInteger(env.V4_QUEUE_KICK_DEDUP_MS, 1200, { min: 250, max: 30_000 });
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
    const explicitJobType = normalizeJobType(input.job_type || basePayload.job_type || "", "");
    const forceL2Only = basePayload.force_l2_only === true ||
      input.force_l2_only === true ||
      explicitJobType === v4JobTypes.FINAL_ASSISTED_TITLE;
    const createL1Default = v4QueueDefaultCreateL1(process.env);
    const createL1Job = !forceL2Only && boolOption(input.create_l1_job ?? input.createL1Job ?? basePayload.create_l1_job ?? basePayload.createL1Job, createL1Default);
    const createL2Job = boolOption(input.create_l2_job ?? input.createL2Job ?? basePayload.create_l2_job ?? basePayload.createL2Job, true);
    const sessionId = basePayload.recognition_session_id || input.recognition_session_id || createV4SessionId();
    basePayload.recognition_session_id = sessionId;
    const baseJob = {
      ...input,
      payload: basePayload,
      batch_id: input.batch_id || batchId,
      operator_id: input.operator_id || operatorId || null,
      tenant_id: input.tenant_id || tenantId || basePayload.tenant_id || null
    };
    if (!createL1Job && createL2Job) {
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
    if (!createL1Job && !createL2Job) continue;
    const l1JobId = input.l1_job_id || createV4JobId("v4job_l1");
    const l2JobId = createL2Job ? (input.l2_job_id || createV4JobId("v4job_l2")) : null;
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
    if (createL2Job) {
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
  const releasedAt = nowIso();
  const inheritedTags = { ...(job.queue_tags || {}) };
  [
    "provider_capacity_slot",
    "provider_key_slot",
    "provider_capacity",
    "provider_per_key_concurrency",
    "provider_capacity_lease_owner",
    "provider_capacity_leased_at"
  ].forEach((field) => delete inheritedTags[field]);
  return markV4RecognitionJob({
    jobId: job.paired_job_id,
    status: v4JobStatuses.QUEUED,
    patch: {
      not_before: releasedAt,
      priority: Math.max(0, priority + 1),
      queue_tags: {
        ...inheritedTags,
        lane: v4JobLanes.BACKGROUND,
        job_type: v4JobTypes.FINAL_ASSISTED_TITLE,
        released_by_parent_job_id: job.id || null,
        release_reason: reason,
        paired_l1_released_at: releasedAt
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
  const capacityControl = v4ProviderCapacityControlEnabled(env);
  return callV4Rpc({
    fn: capacityControl
      ? "claim_v4_recognition_jobs_with_capacity"
      : "claim_v4_recognition_jobs",
    payload: compact({
      p_limit: positiveInteger(limit, 1, { min: 1, max: 25 }),
      p_worker_id: String(workerId || "worker").slice(0, 120),
      p_lease_seconds: positiveInteger(leaseSeconds, 120, { min: 30, max: 900 }),
      p_lane: normalizedLane || null,
      p_tenant_id: tenantId ? String(tenantId).slice(0, 120) : null,
      ...(capacityControl
        ? {
          p_provider_id: "openai_legacy",
          p_provider_capacity: openAiProviderGlobalConcurrency(env),
          p_per_key_concurrency: openAiPerKeyStableConcurrency(env)
        }
        : {})
    }),
    env,
    fetchImpl
  });
}

export async function releaseV4ProviderCapacityForJob({
  jobId,
  workerId = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!jobId || !v4ProviderCapacityControlEnabled(env)) {
    return { released: false, skipped: true, error: jobId ? null : "missing_job_id" };
  }
  const result = await callV4Rpc({
    fn: "release_v4_provider_capacity_for_job",
    payload: {
      p_job_id: String(jobId),
      p_worker_id: workerId ? String(workerId).slice(0, 120) : null
    },
    env,
    fetchImpl
  });
  const releasedCount = Number(result.rows?.[0] || 0);
  return {
    released: result.ok && releasedCount > 0,
    released_count: releasedCount,
    skipped: false,
    error: result.error || null
  };
}

export async function tryAcquireV4QueueKick({
  scope = "global",
  owner = "enqueue",
  leaseMs = v4QueueKickDedupMs(process.env),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const result = await callV4Rpc({
    fn: "try_acquire_v4_queue_kick",
    payload: {
      p_scope: String(scope || "global").slice(0, 120),
      p_lease_owner: String(owner || "enqueue").slice(0, 120),
      p_lease_ms: positiveInteger(leaseMs, v4QueueKickDedupMs(env), { min: 250, max: 30_000 })
    },
    env,
    fetchImpl
  });
  return {
    ok: result.ok,
    acquired: result.ok && result.rows?.[0] === true,
    error: result.error || null
  };
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
  previousError = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const maxAttempts = positiveInteger(env.V4_JOB_COMPLETION_WRITE_ATTEMPTS, 3, { min: 1, max: 5 });
  const retryBaseMs = positiveInteger(env.V4_JOB_COMPLETION_RETRY_BASE_MS, 120, { min: 1, max: 2000 });
  const priorHistory = Array.isArray(previousError?.attempt_history)
    ? previousError.attempt_history.slice(-4)
    : previousError && Object.keys(previousError).length
      ? [previousError]
      : [];
  let completion = { saved: false, row: null, error: "completion_write_not_attempted" };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    completion = await markV4RecognitionJob({
      jobId,
      status,
      patch: {
        result,
        stage_result: stageResult || result,
        timing: {
          ...timing,
          completion_write_attempts: attempt
        },
        completed_at: nowIso(),
        lease_owner: null,
        lease_expires_at: null,
        error: priorHistory.length
          ? { resolved: true, attempt_history: priorHistory }
          : {}
      },
      env,
      fetchImpl
    });
    if (completion.saved) return { ...completion, write_attempts: attempt };
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryBaseMs * (2 ** (attempt - 1))));
    }
  }
  return { ...completion, write_attempts: maxAttempts };
}

export async function failV4RecognitionJob({
  job = {},
  error = {},
  retryDelaySeconds = 15,
  forceFinalFailure = false,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const attemptCount = positiveInteger(job.attempt_count, 0, { min: 0, max: 100 });
  const maxAttempts = positiveInteger(job.max_attempts, 2, { min: 1, max: 100 });
  const shouldRetry = forceFinalFailure !== true && attemptCount < maxAttempts;
  const delayMs = positiveInteger(retryDelaySeconds, 15, { min: 1, max: 900 }) * 1000;
  const previousHistory = Array.isArray(job.error?.attempt_history)
    ? job.error.attempt_history.slice(-4)
    : job.error && Object.keys(job.error).length
      ? [job.error]
      : [];
  const currentFailure = {
    attempt: attemptCount,
    message: String(error?.message || error?.error || error || "unknown_error").slice(0, 500),
    code: error?.code || error?.status || null,
    failed_at: nowIso()
  };
  return markV4RecognitionJob({
    jobId: job.id,
    status: shouldRetry ? v4JobStatuses.RETRYING : v4JobStatuses.FAILED,
    patch: {
      error: {
        ...currentFailure,
        attempt_history: [...previousHistory, currentFailure].slice(-5)
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
