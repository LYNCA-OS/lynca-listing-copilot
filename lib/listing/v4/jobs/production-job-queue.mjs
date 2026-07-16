import crypto from "node:crypto";
import {
  openAiKeyPoolSize,
  openAiPerKeyStableConcurrency,
  openAiProviderGlobalConcurrency
} from "../../providers/openai-key-pool.mjs";
import { contractedConcurrency } from "../orchestration/concurrency-contract.mjs";
import { v4SchemaVersion } from "../schema/version.mjs";
import { buildV4RecognitionSessionRow, createV4SessionId } from "../session/session-store.mjs";
import {
  callV4Rpc,
  isV4SupabaseConfigured,
  patchV4Row,
  readV4Rows,
  sanitizeV4PostgresJson,
  writeV4Row,
  writeV4Rows
} from "../session/supabase-rest.mjs";

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

function deterministicV4Id(prefix, parts = []) {
  const identity = parts.map((part) => String(part || "").trim()).join("\u001f");
  if (!identity.replaceAll("\u001f", "")) return null;
  return `${prefix}_${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export function createV4DeterministicJobId({
  batchId,
  tenantId = null,
  operatorId = null,
  assetId,
  jobType = v4JobTypes.FINAL_ASSISTED_TITLE,
  idempotencyKey = null
} = {}) {
  if (idempotencyKey) return deterministicV4Id("v4job", ["explicit", idempotencyKey, jobType]);
  if (!batchId || !assetId) return null;
  return deterministicV4Id("v4job", [tenantId, operatorId, batchId, assetId, jobType]);
}

export function createV4DeterministicSessionId({
  batchId,
  tenantId = null,
  operatorId = null,
  assetId,
  idempotencyKey = null
} = {}) {
  if (idempotencyKey) return deterministicV4Id("v4sess", ["explicit", idempotencyKey]);
  if (!batchId || !assetId) return null;
  return deterministicV4Id("v4sess", [tenantId, operatorId, batchId, assetId]);
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

export function v4JobLeaseHeartbeatEnabled(env = process.env) {
  return boolOption(env.V4_JOB_LEASE_HEARTBEAT_ENABLED, true);
}

export function v4JobLeaseHeartbeatIntervalMs({
  leaseSeconds = v4WorkerLeaseSeconds(process.env),
  env = process.env
} = {}) {
  const normalizedLeaseSeconds = positiveInteger(leaseSeconds, 120, { min: 30, max: 900 });
  const derived = Math.max(10_000, Math.min(60_000, Math.floor(normalizedLeaseSeconds * 1000 / 3)));
  const configured = positiveInteger(env.V4_JOB_LEASE_HEARTBEAT_INTERVAL_MS, derived, { min: 10_000, max: 120_000 });
  const leaseSafeMaximum = Math.max(10_000, Math.floor(normalizedLeaseSeconds * 1000 / 2));
  return Math.min(configured, leaseSafeMaximum);
}

export function v4WorkerMaxWaitMs(env = process.env) {
  return positiveInteger(env.V4_JOB_WORKER_MAX_WAIT_MS, 55_000, { min: 5_000, max: 240_000 });
}

export function v4WorkerProcessConcurrency(env = process.env) {
  return openAiProviderGlobalConcurrency(env);
}

export function v4QueueSubmissionConcurrency(env = process.env) {
  const providerConcurrency = openAiProviderGlobalConcurrency(env);
  return contractedConcurrency("queue_submission", positiveInteger(
    env.V4_QUEUE_SUBMISSION_CONCURRENCY,
    providerConcurrency,
    { min: 1, max: 12 }
  ));
}

export function v4ProviderCapacityControlEnabled(env = process.env) {
  return boolOption(env.V4_PROVIDER_CAPACITY_CONTROL_ENABLED, true);
}

export function v4ProviderDoneCapacityHandoffEnabled(env = process.env) {
  return boolOption(env.V4_PROVIDER_DONE_CAPACITY_HANDOFF_ENABLED, true);
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
  const effectiveBatchId = job.batch_id || batchId;
  const effectiveTenantId = job.tenant_id || tenantId || payload.tenant_id || null;
  const effectiveOperatorId = job.operator_id || operatorId || null;
  const assetId = job.asset_id || job.assetId || payload.asset_id || payload.assetId || null;
  if (assetId && !payload.asset_id) payload.asset_id = assetId;
  const jobType = normalizeJobType(job.job_type || payload.job_type);
  const idempotencyKey = job.idempotency_key || job.idempotencyKey || payload.idempotency_key || payload.idempotencyKey || null;
  const sessionId = payload.recognition_session_id
    || job.recognition_session_id
    || createV4DeterministicSessionId({
      batchId: effectiveBatchId,
      tenantId: effectiveTenantId,
      operatorId: effectiveOperatorId,
      assetId,
      idempotencyKey
    })
    || createV4SessionId();
  payload.recognition_session_id = sessionId;
  if (idempotencyKey && !payload.idempotency_key) payload.idempotency_key = idempotencyKey;
  const lane = normalizeLane(job.lane || payload.lane, jobType === v4JobTypes.FAST_SCOUT_DRAFT ? v4JobLanes.INTERACTIVE : v4JobLanes.BACKGROUND);
  const deterministicJobId = createV4DeterministicJobId({
    batchId: effectiveBatchId,
    tenantId: effectiveTenantId,
    operatorId: effectiveOperatorId,
    assetId,
    jobType,
    idempotencyKey
  });
  return compact({
    id: job.id || job.job_id || deterministicJobId || createV4JobId(),
    schema_version: v4SchemaVersion,
    batch_id: effectiveBatchId,
    tenant_id: effectiveTenantId,
    operator_id: effectiveOperatorId,
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
      job_type: jobType,
      idempotency_mode: deterministicJobId ? "batch_asset_job_type" : "random_fallback",
      idempotency_key: idempotencyKey || null
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
    const effectiveBatchId = input.batch_id || batchId;
    const effectiveTenantId = input.tenant_id || tenantId || basePayload.tenant_id || null;
    const effectiveOperatorId = input.operator_id || operatorId || null;
    const assetId = input.asset_id || input.assetId || basePayload.asset_id || basePayload.assetId || null;
    const idempotencyKey = input.idempotency_key || input.idempotencyKey || basePayload.idempotency_key || basePayload.idempotencyKey || null;
    const sessionId = basePayload.recognition_session_id
      || input.recognition_session_id
      || createV4DeterministicSessionId({
        batchId: effectiveBatchId,
        tenantId: effectiveTenantId,
        operatorId: effectiveOperatorId,
        assetId,
        idempotencyKey
      })
      || createV4SessionId();
    basePayload.recognition_session_id = sessionId;
    const baseJob = {
      ...input,
      payload: basePayload,
      batch_id: effectiveBatchId,
      operator_id: effectiveOperatorId,
      tenant_id: effectiveTenantId
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
    const l1JobId = input.l1_job_id || createV4DeterministicJobId({
      batchId: effectiveBatchId,
      tenantId: effectiveTenantId,
      operatorId: effectiveOperatorId,
      assetId,
      jobType: v4JobTypes.FAST_SCOUT_DRAFT,
      idempotencyKey
    }) || createV4JobId("v4job_l1");
    const l2JobId = createL2Job
      ? input.l2_job_id || createV4DeterministicJobId({
        batchId: effectiveBatchId,
        tenantId: effectiveTenantId,
        operatorId: effectiveOperatorId,
        assetId,
        jobType: v4JobTypes.FINAL_ASSISTED_TITLE,
        idempotencyKey
      }) || createV4JobId("v4job_l2")
      : null;
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
  const row = normalizeV4JobInput({ job });
  return writeV4Row({
    table,
    row,
    upsert: true,
    duplicateResolution: "ignore",
    env,
    fetchImpl
  });
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
  const existingJobsById = new Map();
  const preparedJobIds = [...new Set(prepared.map((row) => row.id).filter(Boolean))];
  if (preparedJobIds.length) {
    const quoted = preparedJobIds.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",");
    const existingJobs = await readV4Rows({
      table,
      select: "*",
      search: { id: `in.(${quoted})`, limit: String(preparedJobIds.length) },
      env,
      fetchImpl
    });
    if (existingJobs.ok) {
      existingJobs.rows.forEach((row) => {
        if (row?.id) existingJobsById.set(row.id, row);
      });
    }
  }
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
  const missingSessionRows = [];
  for (const row of prepared) {
    if (!row.recognition_session_id || existingSessions.has(row.recognition_session_id) || sessionWrites.has(row.recognition_session_id)) continue;
    const sessionRow = buildV4RecognitionSessionRow({
      sessionId: row.recognition_session_id,
      payload: row.payload || {},
      routePlan: {
        route: "V4_QUEUE_PENDING",
        route_reason: "session stub created before queued stage workers run"
      },
      operatorId: row.operator_id || operatorId || ""
    });
    sessionWrites.set(row.recognition_session_id, { saved: false, error: "session_write_pending" });
    missingSessionRows.push(sessionRow);
  }

  let persistenceMode = "bulk";
  if (missingSessionRows.length) {
    const sessionBatch = await writeV4Rows({
      table: "v4_recognition_sessions",
      rows: missingSessionRows,
      upsert: true,
      duplicateResolution: "ignore",
      env,
      fetchImpl
    });
    if (sessionBatch.saved) {
      for (const sessionRow of missingSessionRows) {
        sessionWrites.set(sessionRow.id, { saved: true, error: null });
        existingSessions.add(sessionRow.id);
      }
    } else {
      persistenceMode = "bulk_with_row_fallback";
      for (const sessionRow of missingSessionRows) {
        const saved = await writeV4Row({
          table: "v4_recognition_sessions",
          row: sessionRow,
          upsert: true,
          duplicateResolution: "ignore",
          env,
          fetchImpl
        });
        sessionWrites.set(sessionRow.id, { saved: saved.saved, error: saved.error || null });
        if (saved.saved) existingSessions.add(sessionRow.id);
      }
    }
  }

  const eligibleRows = [];
  for (const row of prepared) {
    const existingJob = existingJobsById.get(row.id);
    if (existingJob) {
      results.push({ saved: true, row: existingJob, error: null, deduplicated: true });
      continue;
    }
    const sessionWrite = sessionWrites.get(row.recognition_session_id);
    if (sessionWrite && !sessionWrite.saved) {
      results.push({
        saved: false,
        row,
        error: `recognition_session_create_failed:${sessionWrite.error || "unknown_error"}`
      });
      continue;
    }
    eligibleRows.push(row);
  }

  if (eligibleRows.length) {
    const jobBatch = await writeV4Rows({
      table,
      rows: eligibleRows,
      upsert: true,
      duplicateResolution: "ignore",
      env,
      fetchImpl
    });
    if (jobBatch.saved) {
      const savedById = new Map((jobBatch.rows || []).map((row) => [row.id, row]));
      for (const row of eligibleRows) {
        results.push({ saved: true, row: savedById.get(row.id) || row, error: null });
      }
    } else {
      persistenceMode = "bulk_with_row_fallback";
      for (const row of eligibleRows) {
        const saved = await writeV4Row({
          table,
          row,
          upsert: true,
          duplicateResolution: "ignore",
          env,
          fetchImpl
        });
        results.push({ ...saved, row: saved.row || row });
      }
    }
  }
  return {
    batchId,
    jobs: results,
    queued_count: results.filter((result) => result.saved).length,
    inserted_count: results.filter((result) => result.saved && result.deduplicated !== true).length,
    deduplicated_count: results.filter((result) => result.saved && result.deduplicated === true).length,
    persistence_mode: persistenceMode,
    session_rows_written: missingSessionRows.length,
    job_rows_written: eligibleRows.length
  };
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
  const payload = compact({
    p_limit: positiveInteger(limit, 1, { min: 1, max: 25 }),
    p_worker_id: String(workerId || "worker").slice(0, 120),
    p_lease_seconds: positiveInteger(leaseSeconds, 120, { min: 30, max: 900 }),
    p_lane: normalizedLane || null,
    p_tenant_id: tenantId ? String(tenantId).slice(0, 120) : null,
    ...(capacityControl
      ? {
        p_provider_id: "openai_legacy",
        p_provider_capacity: openAiProviderGlobalConcurrency(env),
        p_per_key_concurrency: openAiPerKeyStableConcurrency(env),
        p_provider_key_count: Math.max(1, openAiKeyPoolSize(env))
      }
      : {})
  });
  const primaryFunction = capacityControl
    ? "claim_v4_recognition_jobs_with_balanced_capacity"
    : "claim_v4_recognition_jobs";
  const primary = await callV4Rpc({
    fn: primaryFunction,
    payload,
    env,
    fetchImpl
  });
  if (primary.ok || !capacityControl || !isMissingBalancedCapacityRpc(primary.error)) {
    return { ...primary, rpc_mode: capacityControl ? "balanced_capacity" : "legacy" };
  }

  // A direct SQL migration can be committed before PostgREST refreshes its
  // schema cache. Keep capacity enforcement active by falling back only to the
  // previous capacity-aware RPC; never fall through to an unbounded claim.
  const fallback = await callV4Rpc({
    fn: "claim_v4_recognition_jobs_with_capacity",
    payload: compact({
      ...payload,
      p_provider_key_count: undefined
    }),
    env,
    fetchImpl
  });
  return {
    ...fallback,
    rpc_mode: fallback.ok ? "capacity_schema_cache_fallback" : "capacity_fallback_failed",
    fallback_from: primaryFunction,
    fallback_reason: "balanced_capacity_rpc_not_visible",
    primary_error: primary.error || null
  };
}

function isMissingBalancedCapacityRpc(error) {
  const message = String(error || "").toLowerCase();
  return message.includes("pgrst202") ||
    (message.includes("schema cache") && message.includes("claim_v4_recognition_jobs_with_balanced_capacity")) ||
    (message.includes("could not find") && message.includes("claim_v4_recognition_jobs_with_balanced_capacity"));
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

export async function heartbeatV4RecognitionJob({
  jobId,
  workerId,
  leaseSeconds = 300,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!jobId || !workerId) {
    return { extended: false, skipped: true, error: jobId ? "missing_worker_id" : "missing_job_id" };
  }
  if (!v4JobLeaseHeartbeatEnabled(env)) {
    return { extended: false, skipped: true, error: null };
  }
  const result = await callV4Rpc({
    fn: "heartbeat_v4_recognition_job",
    payload: {
      p_job_id: String(jobId),
      p_worker_id: String(workerId).slice(0, 120),
      p_lease_seconds: positiveInteger(leaseSeconds, 300, { min: 30, max: 900 })
    },
    env,
    fetchImpl
  });
  return {
    extended: result.ok && result.rows?.[0] === true,
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
  workerId = null,
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
    match: workerId
      ? { status: `eq.${v4JobStatuses.RUNNING}`, lease_owner: `eq.${String(workerId).slice(0, 120)}` }
      : {},
    requireMatch: Boolean(workerId),
    env,
    fetchImpl
  });
}

export async function completeV4RecognitionJob({
  jobId,
  workerId = null,
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
  const sanitizedPayload = sanitizeV4PostgresJson({
    result,
    stage_result: stageResult || result,
    timing,
    error: priorHistory.length
      ? { resolved: true, attempt_history: priorHistory }
      : {}
  });
  const cleanPayload = sanitizedPayload.value;
  let completion = { saved: false, row: null, error: "completion_write_not_attempted" };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    completion = await markV4RecognitionJob({
      jobId,
      status,
      patch: {
        result: cleanPayload.result,
        stage_result: cleanPayload.stage_result,
        timing: {
          ...cleanPayload.timing,
          completion_payload_sanitized_nul_count: sanitizedPayload.sanitized_nul_byte_count,
          completion_write_attempts: attempt
        },
        completed_at: nowIso(),
        lease_owner: null,
        lease_expires_at: null,
        error: cleanPayload.error
      },
      workerId,
      env,
      fetchImpl
    });
    if (completion.saved) {
      return {
        ...completion,
        write_attempts: attempt,
        completion_payload_sanitized_nul_count: sanitizedPayload.sanitized_nul_byte_count
      };
    }
    if (completion.error === "row_not_matched") {
      return {
        ...completion,
        write_attempts: attempt,
        completion_payload_sanitized_nul_count: sanitizedPayload.sanitized_nul_byte_count
      };
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryBaseMs * (2 ** (attempt - 1))));
    }
  }
  return {
    ...completion,
    write_attempts: maxAttempts,
    completion_payload_sanitized_nul_count: sanitizedPayload.sanitized_nul_byte_count
  };
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
  const code = String(error?.code || error?.status || "").trim().toLowerCase();
  const explicitlyNonRetryable = error?.retryable === false || new Set([
    "invalid_payload",
    "image_input_unsupported",
    "provider_input_unsupported",
    "queue_lease_lost"
  ]).has(code);
  const shouldRetry = forceFinalFailure !== true && !explicitlyNonRetryable && attemptCount < maxAttempts;
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
    http_status: Number.isFinite(Number(error?.http_status)) ? Number(error.http_status) : null,
    retryable: !explicitlyNonRetryable,
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
    workerId: job.lease_owner || null,
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

const manuallyRetryableStatuses = new Set([
  v4JobStatuses.FAILED,
  v4JobStatuses.CANCELLED
]);

const activeRetryStatuses = new Set([
  v4JobStatuses.QUEUED,
  v4JobStatuses.RETRYING,
  v4JobStatuses.RUNNING
]);

function queueTagsForManualRetry(queueTags = {}, requestedAt = nowIso()) {
  const clean = { ...(queueTags || {}) };
  for (const key of [
    "provider_capacity_slot",
    "provider_key_slot",
    "provider_capacity_lease_owner",
    "provider_capacity_leased_at"
  ]) {
    delete clean[key];
  }
  return {
    ...clean,
    manual_retry_requested_at: requestedAt,
    manual_retry_count: positiveInteger(clean.manual_retry_count, 0, { min: 0, max: 1000 }) + 1,
    manual_retry_queue_policy: "interactive_priority_zero",
    manual_retry_writer_initiated: true
  };
}

export async function retryV4RecognitionJob({
  jobId,
  operatorId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedJobId = String(jobId || "").trim();
  const normalizedOperatorId = String(operatorId || "").trim();
  if (!normalizedJobId || !normalizedOperatorId) {
    return {
      saved: false,
      retryable: false,
      error_code: normalizedJobId ? "V4_JOB_RETRY_OPERATOR_REQUIRED" : "V4_JOB_RETRY_JOB_ID_REQUIRED",
      error: normalizedJobId ? "operator_id_required" : "job_id_required"
    };
  }

  const existing = await readV4RecognitionJobs({
    jobIds: [normalizedJobId],
    limit: 1,
    env,
    fetchImpl
  });
  if (!existing.ok) {
    return {
      saved: false,
      retryable: true,
      error_code: "V4_JOB_RETRY_BACKEND_UNAVAILABLE",
      error: existing.error || "job_read_failed"
    };
  }

  const job = existing.rows.find((row) => String(row?.operator_id || "") === normalizedOperatorId) || null;
  if (!job) {
    return {
      saved: false,
      retryable: false,
      error_code: "V4_JOB_RETRY_NOT_FOUND",
      error: "job_not_found"
    };
  }

  const currentStatus = String(job.status || "").toUpperCase();
  if (activeRetryStatuses.has(currentStatus)) {
    return {
      saved: true,
      retryable: false,
      already_active: true,
      row: job,
      error_code: null,
      error: null
    };
  }
  if (!manuallyRetryableStatuses.has(currentStatus)) {
    return {
      saved: false,
      retryable: false,
      error_code: "V4_JOB_RETRY_NOT_ALLOWED",
      error: `job_status_not_retryable:${currentStatus || "UNKNOWN"}`,
      row: job
    };
  }

  const requestedAt = nowIso();
  const attemptCount = positiveInteger(job.attempt_count, 0, { min: 0, max: 1000 });
  const maxAttempts = Math.max(
    positiveInteger(job.max_attempts, 2, { min: 1, max: 1000 }),
    attemptCount + 2
  );
  const priorError = job.error && typeof job.error === "object" && !Array.isArray(job.error)
    ? job.error
    : {};
  const priorTiming = job.timing && typeof job.timing === "object" && !Array.isArray(job.timing)
    ? job.timing
    : {};
  const retried = await patchV4Row({
    table,
    id: normalizedJobId,
    patch: {
      status: v4JobStatuses.RETRYING,
      lane: v4JobLanes.INTERACTIVE,
      priority: 0,
      max_attempts: maxAttempts,
      not_before: requestedAt,
      started_at: null,
      completed_at: null,
      lease_owner: null,
      lease_expires_at: null,
      result: {},
      stage_result: {},
      error: {
        ...priorError,
        manual_retry: {
          requested_at: requestedAt,
          previous_status: currentStatus,
          previous_attempt_count: attemptCount
        }
      },
      timing: {
        manual_retry_requested_at: requestedAt,
        previous_attempt_timing: priorTiming
      },
      queue_tags: queueTagsForManualRetry(job.queue_tags, requestedAt),
      updated_at: requestedAt
    },
    match: {
      operator_id: `eq.${normalizedOperatorId}`,
      status: `eq.${currentStatus}`
    },
    requireMatch: true,
    env,
    fetchImpl
  });
  if (!retried.saved) {
    return {
      saved: false,
      retryable: retried.error !== "row_not_matched",
      error_code: retried.error === "row_not_matched"
        ? "V4_JOB_RETRY_STATE_CHANGED"
        : "V4_JOB_RETRY_WRITE_FAILED",
      error: retried.error || "job_retry_write_failed"
    };
  }

  return {
    saved: true,
    retryable: false,
    already_active: false,
    row: retried.row || {
      ...job,
      status: v4JobStatuses.RETRYING,
      lane: v4JobLanes.INTERACTIVE,
      priority: 0,
      max_attempts: maxAttempts,
      not_before: requestedAt,
      started_at: null,
      completed_at: null,
      queue_tags: queueTagsForManualRetry(job.queue_tags, requestedAt)
    },
    error_code: null,
    error: null
  };
}
