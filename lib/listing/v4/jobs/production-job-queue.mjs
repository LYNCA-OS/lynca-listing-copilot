import crypto from "node:crypto";
import {
  openAiKeyPoolSize,
  openAiPerKeyStableConcurrency,
  openAiProviderGlobalConcurrency
} from "../../providers/openai-key-pool.mjs";
import { contractedConcurrency } from "../orchestration/concurrency-contract.mjs";
import { v4ProductionStrategy } from "../policy/production-strategy.mjs";
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

export function v4QueueDeploymentAffinity(env = process.env) {
  if (String(env.VERCEL_ENV || "").trim().toLowerCase() !== "preview") return null;
  const deploymentId = String(env.VERCEL_DEPLOYMENT_ID || "").trim();
  return /^dpl_[A-Za-z0-9]+$/.test(deploymentId) ? deploymentId : null;
}

const table = "v4_recognition_jobs";
const durableListingAssetIdPattern = /^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function createV4DeterministicBatchId({
  tenantId = null,
  operatorId = null,
  idempotencyKey = null
} = {}) {
  if (!tenantId || !operatorId || !idempotencyKey) return null;
  return deterministicV4Id("v4batch", ["explicit", tenantId, operatorId, idempotencyKey]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalJson(value[key])])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function immutableV4JobIdentity(job = {}) {
  return canonicalJson({
    id: job.id || null,
    tenant_id: job.tenant_id || null,
    operator_id: job.operator_id || null,
    recognition_session_id: job.recognition_session_id || null,
    asset_id: job.asset_id || null,
    job_type: normalizeJobType(job.job_type || job.payload?.job_type),
    lane: normalizeLane(job.lane || job.payload?.lane),
    parent_job_id: job.parent_job_id || null,
    paired_job_id: job.paired_job_id || null,
    provider_id: job.provider_id || null,
    payload: job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? job.payload
      : {}
  });
}

export function v4CanonicalJobIdentitySha256(job = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(immutableV4JobIdentity(job)))
    .digest("hex");
}

export function v4JobIdentityMatches(existing = {}, expected = {}) {
  return String(existing.tenant_id || "") === String(expected.tenant_id || "")
    && String(existing.operator_id || "") === String(expected.operator_id || "")
    && String(existing.recognition_session_id || "") === String(expected.recognition_session_id || "")
    && v4CanonicalJobIdentitySha256(existing) === v4CanonicalJobIdentitySha256(expected);
}

function immutableV4SessionIdentity(session = {}) {
  return canonicalJson({
    id: session.id || null,
    tenant_id: session.tenant_id || null,
    user_id: session.user_id || session.created_by_user_id || null,
    operator_id: session.operator_id || session.created_by_user_id || session.user_id || null,
    asset_id: session.asset_id || null,
    stable_asset_id: session.stable_asset_id || null,
    client_asset_ref: session.client_asset_ref || null,
    asset_fingerprint: session.asset_fingerprint || null,
    identity_snapshot: session.identity_snapshot && typeof session.identity_snapshot === "object"
      ? session.identity_snapshot
      : {}
  });
}

export function v4CanonicalSessionIdentitySha256(session = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(immutableV4SessionIdentity(session)))
    .digest("hex");
}

function expectedV4SessionForJob(job = {}) {
  return buildV4RecognitionSessionRow({
    sessionId: job.recognition_session_id,
    payload: job.payload || {},
    routePlan: {},
    operatorId: job.operator_id || "",
    tenantId: job.tenant_id || "",
    userId: job.operator_id || ""
  });
}

function v4SessionIdentityMatches(session = {}, job = {}) {
  return v4CanonicalSessionIdentitySha256(session)
    === v4CanonicalSessionIdentitySha256(expectedV4SessionForJob(job));
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
  if (idempotencyKey) {
    return deterministicV4Id("v4job", ["explicit", tenantId, operatorId, assetId, idempotencyKey, jobType]);
  }
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
  if (idempotencyKey) {
    return deterministicV4Id("v4sess", ["explicit", tenantId, operatorId, assetId, idempotencyKey]);
  }
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
  return contractedConcurrency(
    "queue_submission",
    env.V4_QUEUE_SUBMISSION_CONCURRENCY,
    { fallback: providerConcurrency }
  );
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
  const effectiveTenantId = tenantId || job.tenant_id || payload.tenant_id || null;
  const effectiveOperatorId = operatorId || job.operator_id || null;
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
    max_attempts: positiveInteger(
      job.max_attempts,
      v4ProductionStrategy.profile.job_retry.max_attempts,
      { min: 1, max: 10 }
    ),
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
    const manualPriorityRetry = input.trusted_manual_retry === true;
    const createL1Default = v4QueueDefaultCreateL1(process.env);
    const createL1Job = !forceL2Only && boolOption(input.create_l1_job ?? input.createL1Job ?? basePayload.create_l1_job ?? basePayload.createL1Job, createL1Default);
    const createL2Job = boolOption(input.create_l2_job ?? input.createL2Job ?? basePayload.create_l2_job ?? basePayload.createL2Job, true);
    const effectiveBatchId = input.batch_id || batchId;
    const effectiveTenantId = tenantId || input.tenant_id || basePayload.tenant_id || null;
    const effectiveOperatorId = operatorId || input.operator_id || null;
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
      payload: {
        ...basePayload,
        ...(manualPriorityRetry ? { manual_retry: true } : {})
      },
      batch_id: effectiveBatchId,
      operator_id: effectiveOperatorId,
      tenant_id: effectiveTenantId,
      queue_tags: {
        ...(input.queue_tags || input.tags || {}),
        ...(manualPriorityRetry ? {
          manual_retry_queue_policy: "interactive_priority_zero",
          manual_retry_writer_initiated: true
        } : {})
      }
    };
    if (!createL1Job && createL2Job) {
      expanded.push(normalizeV4JobInput({
        job: {
          ...baseJob,
          job_type: v4JobTypes.FINAL_ASSISTED_TITLE,
          lane: manualPriorityRetry ? v4JobLanes.INTERACTIVE : v4JobLanes.BACKGROUND,
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
  const result = await enqueueV4RecognitionJobs({
    jobs: [job],
    batchId: job?.batch_id || createV4BatchId(),
    operatorId: job?.operator_id || null,
    tenantId: job?.tenant_id || null,
    priority: job?.priority ?? 100,
    env,
    fetchImpl
  });
  return result.jobs[0] || { saved: false, row: job || null, error: "atomic_enqueue_returned_no_job" };
}

async function enqueueV4RecognitionJobsLegacy({
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
    if (!existingJobs.ok) {
      return {
        batchId,
        jobs: prepared.map((row) => ({
          saved: false,
          row,
          error: "queue_job_identity_read_failed:" + (existingJobs.error || "unknown_error")
        })),
        queued_count: 0,
        inserted_count: 0,
        deduplicated_count: 0,
        persistence_mode: "identity_read_failed",
        session_rows_written: 0,
        job_rows_written: 0
      };
    }
    existingJobs.rows.forEach((row) => {
      if (row?.id) existingJobsById.set(row.id, row);
    });
  }
  const sessionIds = [...new Set(prepared.map((row) => row.recognition_session_id).filter(Boolean))];
  const existingSessions = new Map();
  if (sessionIds.length) {
    const quoted = sessionIds.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",");
    const existing = await readV4Rows({
      table: "v4_recognition_sessions",
      select: "id,tenant_id,operator_id,user_id,created_by_user_id,assigned_to_user_id,asset_id,stable_asset_id,client_asset_ref,asset_fingerprint,identity_snapshot",
      search: { id: `in.(${quoted})`, limit: String(sessionIds.length) },
      env,
      fetchImpl
    });
    if (!existing.ok) {
      return {
        batchId,
        jobs: prepared.map((row) => ({
          saved: false,
          row,
          error: "queue_session_identity_read_failed:" + (existing.error || "unknown_error")
        })),
        queued_count: 0,
        inserted_count: 0,
        deduplicated_count: 0,
        persistence_mode: "session_identity_read_failed",
        session_rows_written: 0,
        job_rows_written: 0
      };
    }
    existing.rows.forEach((row) => {
      if (row?.id) existingSessions.set(row.id, row);
    });
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
      operatorId: row.operator_id || operatorId || "",
      tenantId: row.tenant_id || tenantId || "",
      userId: row.operator_id || operatorId || ""
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
        existingSessions.set(sessionRow.id, sessionRow);
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
        if (saved.saved) existingSessions.set(sessionRow.id, sessionRow);
      }
    }

    const quotedSessionIds = missingSessionRows
      .map((row) => '"' + String(row.id).replaceAll('"', '\\"') + '"')
      .join(",");
    const verifiedSessions = await readV4Rows({
      table: "v4_recognition_sessions",
      select: "id,tenant_id,operator_id,user_id,created_by_user_id,assigned_to_user_id,asset_id,stable_asset_id,client_asset_ref,asset_fingerprint,identity_snapshot",
      search: {
        id: "in.(" + quotedSessionIds + ")",
        limit: String(missingSessionRows.length)
      },
      env,
      fetchImpl
    });
    const verifiedById = new Map(
      (verifiedSessions.rows || []).map((row) => [row.id, row])
    );
    for (const sessionRow of missingSessionRows) {
      const persisted = verifiedById.get(sessionRow.id);
      const expectedJob = prepared.find((row) => row.recognition_session_id === sessionRow.id);
      const identityMatches = verifiedSessions.ok
        && persisted
        && expectedJob
        && v4SessionIdentityMatches(persisted, expectedJob);
      sessionWrites.set(sessionRow.id, {
        saved: Boolean(identityMatches),
        error: identityMatches
          ? null
          : verifiedSessions.error || "queue_session_post_write_identity_conflict"
      });
      if (identityMatches) existingSessions.set(sessionRow.id, persisted);
    }
  }

  const eligibleRows = [];
  for (const row of prepared) {
    const existingJob = existingJobsById.get(row.id);
    if (existingJob) {
      if (!v4JobIdentityMatches(existingJob, row)) {
        results.push({
          saved: false,
          row: existingJob,
          error: "queue_job_identity_conflict",
          deduplicated: false
        });
      } else {
        const terminalFailure = [
          v4JobStatuses.FAILED,
          v4JobStatuses.CANCELLED
        ].includes(String(existingJob.status || "").toUpperCase());
        results.push(terminalFailure ? {
          saved: false,
          row: existingJob,
          error: "queue_job_terminal_retry_required",
          retry_required: true,
          deduplicated: true
        } : {
          saved: true,
          row: existingJob,
          error: null,
          deduplicated: true,
          canonical_payload_sha256: v4CanonicalJobIdentitySha256(existingJob)
        });
      }
      continue;
    }
    const existingSession = existingSessions.get(row.recognition_session_id);
    if (existingSession && !v4SessionIdentityMatches(existingSession, row)) {
      results.push({
        saved: false,
        row,
        error: "queue_session_identity_conflict"
      });
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
    const writeReturnedIds = new Set();
    const jobBatch = await writeV4Rows({
      table,
      rows: eligibleRows,
      upsert: true,
      duplicateResolution: "ignore",
      env,
      fetchImpl
    });
    if (jobBatch.saved) {
      for (const row of jobBatch.rows || []) {
        if (row?.id) writeReturnedIds.add(row.id);
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
        if (saved.saved && saved.row?.id) writeReturnedIds.add(saved.row.id);
      }
    }

    const quotedJobIds = eligibleRows
      .map((row) => '"' + String(row.id).replaceAll('"', '\\"') + '"')
      .join(",");
    const verifiedJobs = await readV4Rows({
      table,
      select: "*",
      search: {
        id: "in.(" + quotedJobIds + ")",
        limit: String(eligibleRows.length)
      },
      env,
      fetchImpl
    });
    const verifiedById = new Map(
      (verifiedJobs.rows || []).map((row) => [row.id, row])
    );
    for (const row of eligibleRows) {
      const persisted = verifiedById.get(row.id);
      const persistedSession = existingSessions.get(row.recognition_session_id);
      const identityMatches = verifiedJobs.ok
        && persisted
        && persistedSession
        && v4SessionIdentityMatches(persistedSession, row)
        && v4JobIdentityMatches(persisted, row);
      results.push(identityMatches ? {
        saved: true,
        row: persisted,
        error: null,
        deduplicated: !writeReturnedIds.has(row.id),
        verified_after_write: true,
        canonical_payload_sha256: v4CanonicalJobIdentitySha256(persisted)
      } : {
        saved: false,
        row: persisted || row,
        error: verifiedJobs.error || "queue_job_post_write_identity_conflict",
        deduplicated: false,
        verified_after_write: false
      });
    }
  }
  const runnableStatuses = new Set([
    v4JobStatuses.QUEUED,
    v4JobStatuses.RETRYING,
    v4JobStatuses.RUNNING
  ]);
  const acceptedCount = results.filter((result) => result.saved).length;
  return {
    batchId,
    jobs: results,
    accepted_count: acceptedCount,
    queued_count: results.filter((result) => (
      result.saved && runnableStatuses.has(String(result.row?.status || "").toUpperCase())
    )).length,
    inserted_count: results.filter((result) => result.saved && result.deduplicated !== true).length,
    deduplicated_count: results.filter((result) => result.saved && result.deduplicated === true).length,
    persistence_mode: persistenceMode,
    session_rows_written: missingSessionRows.length,
    job_rows_written: eligibleRows.length
  };
}

function atomicSessionRows(prepared = [], { tenantId, operatorId } = {}) {
  const rows = new Map();
  for (const job of prepared) {
    const row = buildV4RecognitionSessionRow({
      sessionId: job.recognition_session_id,
      payload: job.payload || {},
      routePlan: {
        route: "V4_QUEUE_PENDING",
        route_reason: "session stub created atomically with queued stage jobs"
      },
      operatorId,
      tenantId,
      userId: operatorId
    });
    const prior = rows.get(row.id);
    if (prior && v4CanonicalSessionIdentitySha256(prior) !== v4CanonicalSessionIdentitySha256(row)) {
      throw new Error(`queue_session_identity_conflict:${row.id}`);
    }
    if (!prior) rows.set(row.id, row);
  }
  return [...rows.values()];
}

function atomicBatchIdentitySha256({ batchId, tenantId, operatorId, jobs = [] } = {}) {
  const identity = canonicalJson({
    batch_id: batchId,
    tenant_id: tenantId,
    operator_id: operatorId,
    job_identity_sha256: jobs.map(v4CanonicalJobIdentitySha256).sort()
  });
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function isAtomicV4RpcSignatureError(error) {
  const message = String(error || "").toLowerCase();
  return (
    message.includes("pgrst202") &&
    message.includes("enqueue_v4_recognition_batch_atomic")
  );
}

function isAtomicV4RpcDependencyError(error) {
  const message = String(error || "").toLowerCase();
  return /relation\s+"public\./.test(message) && /does not exist/.test(message);
}

function makeQueueRpcProbePayload() {
  return {
    p_batch: {
      id: "probe_batch",
      tenant_id: "probe_tenant",
      operator_id: "probe_operator",
      item_count: 1,
      metadata: {
        schema_version: v4SchemaVersion,
        source: "v4-probe",
        enqueue_identity_sha256: "0".repeat(64)
      }
    },
    p_jobs: [],
    p_operator_id: "probe_operator",
    p_sessions: [],
    p_tenant_id: "probe_tenant"
  };
}

async function checkV4QueueLegacyPrincipalReady({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const tenantRows = await readV4Rows({
    table: "tenants",
    select: "id,status,disabled_at",
    search: {
      id: "eq.tenant_legacy",
      status: "eq.ACTIVE",
      disabled_at: "is.null",
      limit: "1"
    },
    env,
    fetchImpl
  });
  if (!tenantRows.ok) {
    return { ok: false, reason: String(tenantRows.error || "legacy_tenant_read_failed") };
  }
  if (!tenantRows.rows.length) {
    return { ok: false, reason: "legacy_tenant_not_ready" };
  }

  const userRows = await readV4Rows({
    table: "users",
    select: "id,status,session_version,disabled_at",
    search: {
      id: "eq.user_legacy",
      status: "eq.ACTIVE",
      session_version: "gte.1",
      disabled_at: "is.null",
      limit: "1"
    },
    env,
    fetchImpl
  });
  if (!userRows.ok) {
    return { ok: false, reason: String(userRows.error || "legacy_user_read_failed") };
  }
  if (!userRows.rows.length) {
    return { ok: false, reason: "legacy_user_not_ready" };
  }

  const membershipRows = await readV4Rows({
    table: "tenant_members",
    select: "tenant_id,user_id,role,status,disabled_at",
    search: {
      tenant_id: "eq.tenant_legacy",
      user_id: "eq.user_legacy",
      role: "eq.OWNER",
      status: "eq.ACTIVE",
      disabled_at: "is.null",
      limit: "1"
    },
    env,
    fetchImpl
  });
  if (!membershipRows.ok) {
    return { ok: false, reason: String(membershipRows.error || "legacy_membership_read_failed") };
  }
  if (!membershipRows.rows.length) {
    return { ok: false, reason: "legacy_membership_not_ready" };
  }

  return { ok: true, reason: null };
}

function makeDependencyQueueRpcProbePayload() {
  const probeTenantId = "probe_tenant";
  const probeOperatorId = "probe_operator";
  const probeBatchId = "probe_batch";
  const probeSessionId = "probe_session";
  const probeJobId = "probe_job";
  const probeAssetId = "asset_11111111-2222-4123-8abc-abcdef123456";
  const probeAssetRef = "probe_ref";
  return {
    p_batch: {
      id: probeBatchId,
      tenant_id: probeTenantId,
      operator_id: probeOperatorId,
      item_count: 1,
      metadata: {
        schema_version: v4SchemaVersion,
        source: "v4-probe",
        enqueue_identity_sha256: "0".repeat(64)
      }
    },
    p_jobs: [
      {
        id: probeJobId,
        tenant_id: probeTenantId,
        operator_id: probeOperatorId,
        batch_id: probeBatchId,
        asset_id: probeAssetId,
        job_type: "FINAL_ASSISTED_TITLE",
        recognition_session_id: probeSessionId,
        payload: {
          tenant_id: probeTenantId,
          operator_id: probeOperatorId,
          asset_id: probeAssetId,
          recognition_session_id: probeSessionId
        },
        priority: 100,
        max_attempts: 2
      }
    ],
    p_operator_id: probeOperatorId,
    p_sessions: [
      {
        id: probeSessionId,
        tenant_id: probeTenantId,
        operator_id: probeOperatorId,
        user_id: probeOperatorId,
        asset_id: probeAssetId,
        client_asset_ref: probeAssetRef,
        identity_snapshot: {
          tenant_id: probeTenantId,
          operator_id: probeOperatorId,
          user_id: probeOperatorId,
          asset_id: probeAssetId,
          client_asset_ref: probeAssetRef,
          stable_asset_id: null,
          asset_fingerprint: "0".repeat(64),
          image_references: []
        }
      }
    ],
    p_tenant_id: probeTenantId
  };
}

export async function checkV4QueueRpcReady({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!isV4SupabaseConfigured(env)) {
    return {
      ready: false,
      signature_ready: false,
      dependencies_ready: false,
      legacy_principal_ready: false,
      reason: "supabase_not_configured",
      signature_error: null,
      dependency_error: null,
      legacy_principal_error: null,
      probe_rows: null
    };
  }

  const signatureProbe = await callV4Rpc({
    fn: "enqueue_v4_recognition_batch_atomic",
    payload: makeQueueRpcProbePayload(),
    env,
    fetchImpl
  });

  const dependencyProbe = await callV4Rpc({
    fn: "enqueue_v4_recognition_batch_atomic",
    payload: makeDependencyQueueRpcProbePayload(),
    env,
    fetchImpl
  });

  const dependencyTransaction = Array.isArray(dependencyProbe.rows) ? dependencyProbe.rows[0] : null;
  const dependencyReady = dependencyProbe.ok
    && dependencyTransaction
    && dependencyTransaction.saved === false
    && dependencyTransaction.reason === "operator_not_active_member";

  if (!signatureProbe.ok) {
    const reason = String(signatureProbe.error || "unknown_error");
    if (isAtomicV4RpcDependencyError(reason)) {
      return {
        ready: false,
        signature_ready: false,
        dependencies_ready: false,
        legacy_principal_ready: false,
        reason: "queue_rpc_dependencies_not_ready",
        signature_error: reason,
        dependency_error: dependencyProbe.ok ? null : dependencyProbe.error || null,
        legacy_principal_error: null,
        probe_rows: Array.isArray(dependencyProbe.rows) ? dependencyProbe.rows : []
      };
    }
    if (isAtomicV4RpcSignatureError(reason)) {
      return {
        ready: false,
        signature_ready: false,
        dependencies_ready: false,
        legacy_principal_ready: false,
        reason: "queue_rpc_signature_not_ready",
        signature_error: reason,
        dependency_error: dependencyProbe.ok ? null : dependencyProbe.error || null,
        legacy_principal_error: null,
        probe_rows: []
      };
    }
    return {
      ready: false,
      signature_ready: false,
      dependencies_ready: false,
      legacy_principal_ready: false,
      reason: "queue_rpc_signature_not_ready",
      signature_error: reason,
      dependency_error: dependencyProbe.ok ? null : dependencyProbe.error || null,
      legacy_principal_error: null,
      probe_rows: []
    };
  }

  if (!dependencyReady) {
    const dependencyFailure = dependencyProbe.ok
      ? `dependency_probe_unexpected: ${String(dependencyTransaction?.reason || "unknown_reason")}`
      : dependencyProbe.error || "dependency_probe_failed";
    return {
      ready: false,
      signature_ready: true,
      dependencies_ready: false,
      legacy_principal_ready: false,
      reason: "queue_rpc_dependencies_not_ready",
      signature_error: null,
      dependency_error: dependencyFailure,
      legacy_principal_error: "queue_legacy_principal_probe_skipped",
      probe_rows: Array.isArray(dependencyProbe.rows) ? dependencyProbe.rows : []
    };
  }

  const legacyPrincipal = await checkV4QueueLegacyPrincipalReady({
    env,
    fetchImpl
  });
  return {
    ready: signatureProbe.ok && dependencyReady && legacyPrincipal.ok,
    signature_ready: true,
    dependencies_ready: dependencyReady,
    legacy_principal_ready: legacyPrincipal.ok,
    reason: legacyPrincipal.ok ? null : "queue_legacy_principal_not_ready",
    signature_error: null,
    dependency_error: null,
    legacy_principal_error: legacyPrincipal.ok ? null : legacyPrincipal.reason,
    probe_rows: Array.isArray(dependencyProbe.rows) ? dependencyProbe.rows : []
  };
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
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedOperatorId = String(operatorId || "").trim();
  const normalizedBatchId = String(batchId || "").trim();
  const deploymentAffinity = v4QueueDeploymentAffinity(env);
  const prepared = (Array.isArray(jobs) ? jobs : [])
    .filter(Boolean)
    .map((job) => normalizeV4JobInput({
      job: deploymentAffinity ? {
        ...job,
        queue_tags: {
          ...(job.queue_tags || job.tags || {}),
          deployment_affinity: deploymentAffinity
        }
      } : job,
      batchId: normalizedBatchId,
      operatorId: normalizedOperatorId,
      tenantId: normalizedTenantId,
      priority
    }));
  const failure = (error, persistenceMode = "atomic_rpc_failed") => ({
    batchId: normalizedBatchId,
    jobs: prepared.map((row) => ({ saved: false, row, error })),
    accepted_count: 0,
    queued_count: 0,
    inserted_count: 0,
    deduplicated_count: 0,
    persistence_mode: persistenceMode,
    batch_saved: false,
    session_rows_written: 0,
    job_rows_written: 0
  });
  if (!normalizedTenantId || !normalizedOperatorId || !normalizedBatchId || !prepared.length) {
    return failure("atomic_enqueue_identity_required", "atomic_validation_failed");
  }
  if (prepared.some((row) => (
    !row.id
    || !durableListingAssetIdPattern.test(String(row.asset_id || ""))
    || !row.recognition_session_id
    || !String(row.payload?.client_asset_ref || row.payload?.clientAssetRef || "").trim()
    || row.tenant_id !== normalizedTenantId
    || row.operator_id !== normalizedOperatorId
    || row.batch_id !== normalizedBatchId
  ))) {
    return failure("atomic_enqueue_job_identity_invalid", "atomic_validation_failed");
  }

  let sessions;
  try {
    sessions = atomicSessionRows(prepared, {
      tenantId: normalizedTenantId,
      operatorId: normalizedOperatorId
    });
  } catch (error) {
    return failure(String(error?.message || error || "queue_session_identity_conflict"), "atomic_validation_failed");
  }
  const enqueueIdentitySha256 = atomicBatchIdentitySha256({
    batchId: normalizedBatchId,
    tenantId: normalizedTenantId,
    operatorId: normalizedOperatorId,
    jobs: prepared
  });
  const batchPayload = {
    p_tenant_id: normalizedTenantId,
    p_operator_id: normalizedOperatorId,
    p_batch: {
      id: normalizedBatchId,
      tenant_id: normalizedTenantId,
      operator_id: normalizedOperatorId,
      item_count: prepared.length,
      metadata: {
        schema_version: v4SchemaVersion,
        source: "v4_recognition_queue",
        enqueue_identity_sha256: enqueueIdentitySha256
      }
    },
    p_sessions: sessions,
    p_jobs: prepared
  };
  const rpcPayloads = [
    batchPayload,
    {
      p_batch: batchPayload.p_batch,
      p_jobs: prepared,
      p_operator_id: normalizedOperatorId,
      p_sessions: sessions,
      p_tenant_id: normalizedTenantId
    }
  ];
  let rpc = { ok: false, rows: [], error: "rpc_not_attempted" };
  let rpcAttempt = 0;
  for (const payload of rpcPayloads) {
    rpc = await callV4Rpc({
      fn: "enqueue_v4_recognition_batch_atomic",
      payload,
      env,
      fetchImpl
    });
    rpcAttempt += 1;
    if (rpc.ok || rpcAttempt >= rpcPayloads.length || !isAtomicV4RpcSignatureError(rpc.error)) {
      break;
    }
  }
  if (!rpc.ok) {
    return failure(`atomic_enqueue_rpc_failed:${rpc.error || "unknown_error"}`);
  }
  const transaction = rpc.rows?.[0] || {};
  if (transaction.saved !== true) {
    return failure(
      `atomic_enqueue_rejected:${transaction.reason || "unknown_reason"}`,
      "atomic_rpc_rejected"
    );
  }
  const returnedJobs = Array.isArray(transaction.jobs) ? transaction.jobs : [];
  if (returnedJobs.length !== prepared.length) {
    return failure("atomic_enqueue_result_cardinality_mismatch");
  }
  return {
    batchId: String(transaction.batch_id || normalizedBatchId),
    jobs: returnedJobs,
    accepted_count: Number(transaction.accepted_count || 0),
    queued_count: Number(transaction.queued_count || 0),
    inserted_count: Number(transaction.inserted_count || 0),
    deduplicated_count: Number(transaction.deduplicated_count || 0),
    persistence_mode: "atomic_rpc",
    batch_saved: true,
    session_rows_written: Number(transaction.session_rows_written || 0),
    job_rows_written: Number(transaction.job_rows_written || 0)
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
  const deploymentAffinity = v4QueueDeploymentAffinity(env);
  const payload = compact({
    // PostgREST matches RPC arguments by name: the base claim functions have
    // no p_deployment_affinity parameter, so the key may only be present when
    // routing to a *_for_deployment wrapper. A null here is NOT stripped by
    // compact() and breaks production claiming with PGRST202.
    ...(deploymentAffinity ? { p_deployment_affinity: deploymentAffinity } : {}),
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
    ? deploymentAffinity
      ? "claim_v4_recognition_jobs_with_balanced_capacity_for_deployment"
      : "claim_v4_recognition_jobs_with_balanced_capacity"
    : deploymentAffinity
      ? "claim_v4_recognition_jobs_for_deployment"
      : "claim_v4_recognition_jobs";
  const primary = await callV4Rpc({
    fn: primaryFunction,
    payload,
    env,
    fetchImpl
  });
  if (!primary.ok && retryableCapacityReleaseError(primary.error)) {
    // The claim transaction may have committed even when the serverless caller
    // lost the PostgREST response. The worker id is unique to this invocation,
    // so reading its live leases recovers ownership without a second claim.
    const recovered = await readV4Rows({
      table,
      select: "*",
      search: compact({
        status: `eq.${v4JobStatuses.RUNNING}`,
        lease_owner: `eq.${String(workerId || "worker").slice(0, 120)}`,
        lease_expires_at: `gt.${nowIso()}`,
        tenant_id: tenantId ? `eq.${String(tenantId).slice(0, 120)}` : undefined,
        order: "created_at.asc",
        limit: String(positiveInteger(limit, 1, { min: 1, max: 25 }))
      }),
      env,
      fetchImpl
    });
    if (recovered.ok && recovered.rows.length) {
      return {
        ok: true,
        rows: recovered.rows,
        error: null,
        rpc_mode: capacityControl ? "balanced_capacity_reconciled" : "legacy_reconciled",
        reconciled_after_response_loss: true,
        primary_error: primary.error || null
      };
    }
  }
  if (primary.ok || deploymentAffinity || !capacityControl || !isMissingBalancedCapacityRpc(primary.error)) {
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

function retryableCapacityReleaseError(error) {
  const message = String(error || "").toLowerCase();
  return /(?:^|\s)(?:408|425|429|5\d\d)(?:\s|$)/.test(message)
    || /timeout|timed out|fetch failed|network|connection reset|temporar/.test(message);
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
  const payload = {
    p_job_id: String(jobId),
    p_worker_id: workerId ? String(workerId).slice(0, 120) : null
  };
  let result = null;
  let releaseAttempts = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    releaseAttempts = attempt;
    result = await callV4Rpc({
      fn: "release_v4_provider_capacity_for_job",
      payload,
      env,
      fetchImpl
    });
    if (result.ok || !retryableCapacityReleaseError(result.error) || attempt >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const releasedCount = Number(result.rows?.[0] || 0);
  return {
    released: result.ok && releasedCount > 0,
    released_count: releasedCount,
    release_attempts: releaseAttempts,
    recovered_after_retry: releaseAttempts > 1 && result.ok && releasedCount > 0,
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

export async function fenceV4RecognitionJobExecution({
  jobId,
  workerId,
  leaseSeconds = 300,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!jobId || !workerId) {
    return {
      fenced: false,
      job: null,
      error: jobId ? "missing_worker_id" : "missing_job_id"
    };
  }
  const result = await callV4Rpc({
    fn: "fence_v4_recognition_job_execution",
    payload: {
      p_job_id: String(jobId),
      p_worker_id: String(workerId).slice(0, 120),
      p_lease_seconds: positiveInteger(leaseSeconds, 300, { min: 30, max: 900 })
    },
    env,
    fetchImpl
  });
  const job = result.rows?.[0] && typeof result.rows[0] === "object"
    ? result.rows[0]
    : null;
  return {
    fenced: result.ok && Boolean(job?.id),
    job,
    error: result.error || (job?.id ? null : "job_lease_not_live")
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

export async function requestV4RecognitionJobRecovery({
  jobId,
  tenantId,
  requestedByUserId = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedJobId = String(jobId || "").trim();
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedJobId || !normalizedTenantId) {
    return {
      ok: false,
      action: "INVALID_REQUEST",
      job: null,
      error: normalizedJobId ? "tenant_id_required" : "job_id_required"
    };
  }
  const result = await callV4Rpc({
    fn: "request_v4_recognition_job_recovery",
    payload: {
      p_job_id: normalizedJobId,
      p_tenant_id: normalizedTenantId,
      p_requested_by_user_id: requestedByUserId ? String(requestedByUserId).slice(0, 160) : null
    },
    env,
    fetchImpl
  });
  const recovery = result.rows?.[0] && typeof result.rows[0] === "object"
    ? result.rows[0]
    : null;
  return {
    ok: result.ok && Boolean(recovery?.action),
    action: recovery?.action || null,
    job: recovery,
    error: result.error || (recovery?.action ? null : "recovery_result_missing")
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
  tenantId = null,
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
    if (tenantId) {
      const reconciliation = await readV4RecognitionJobs({
        jobIds: [jobId],
        tenantId,
        limit: 1,
        select: "id,tenant_id,status,lease_owner,lease_expires_at,completed_at,result,timing",
        env,
        fetchImpl
      });
      const durableRow = reconciliation.rows?.[0] || null;
      if (reconciliation.ok && durableRow
          && durableRow.status === status
          && !durableRow.lease_owner
          && durableRow.completed_at) {
        return {
          saved: true,
          row: durableRow,
          error: null,
          write_attempts: attempt,
          completion_mode: "durable_readback_reconciled",
          completion_response_error: completion.error || null,
          completion_payload_sanitized_nul_count: sanitizedPayload.sanitized_nul_byte_count
        };
      }
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
  forceFinalFailure = false,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const attemptCount = positiveInteger(job.attempt_count, 0, { min: 0, max: 100 });
  const maxAttempts = positiveInteger(
    job.max_attempts,
    v4ProductionStrategy.profile.job_retry.max_attempts,
    { min: 1, max: 100 }
  );
  const retryPlan = v4ProductionStrategy.job_recovery.plan_retry({
    attemptCount,
    maxAttempts,
    error,
    forceFinalFailure
  });
  const shouldRetry = retryPlan.shouldRetry;
  const delayMs = Number(retryPlan.retryDelaySeconds || 0) * 1000;
  const previousHistory = Array.isArray(job.error?.attempt_history)
    ? job.error.attempt_history.slice(-4)
    : job.error && Object.keys(job.error).length
      ? [job.error]
      : [];
  const currentFailure = {
    attempt: attemptCount,
    message: String(error?.message || error?.error || error || "unknown_error").slice(0, 500),
    code: retryPlan.classification.code || error?.code || error?.status || null,
    http_status: Number.isFinite(Number(error?.http_status)) ? Number(error.http_status) : null,
    retryable: retryPlan.classification.retryable,
    retry_category: retryPlan.classification.category,
    recovery_action: retryPlan.classification.recovery_action || null,
    retries_remaining: retryPlan.retriesRemaining,
    retry_delay_seconds: retryPlan.retryDelaySeconds,
    retry_wake_strategy: shouldRetry ? "detached_deduplicated" : null,
    failed_at: nowIso()
  };
  const failurePayload = {
    ...currentFailure,
    attempt_history: [...previousHistory, currentFailure].slice(-5)
  };

  // The database transaction owns the failure transition. It updates the job,
  // releases provider capacity and appends the attempt event atomically. A
  // separate release followed by a REST patch can strand RUNNING jobs when a
  // serverless invocation ends between those two writes.
  const transitionPayload = {
    p_job_id: String(job.id || ""),
    p_worker_id: job.lease_owner ? String(job.lease_owner).slice(0, 120) : null,
    p_error: failurePayload,
    p_retryable: retryPlan.classification.retryable,
    p_force_final_failure: forceFinalFailure === true
  };
  const atomicAttempts = positiveInteger(env.V4_JOB_FAILURE_TRANSITION_ATTEMPTS, 2, { min: 1, max: 3 });
  const atomicRetryBaseMs = positiveInteger(env.V4_JOB_FAILURE_TRANSITION_RETRY_BASE_MS, 100, { min: 10, max: 1000 });
  let transition = null;
  let reconciledRow = null;
  let reconciliationError = null;

  for (let attempt = 1; attempt <= atomicAttempts; attempt += 1) {
    transition = await callV4Rpc({
      fn: "fail_v4_recognition_job",
      payload: transitionPayload,
      env,
      fetchImpl
    });
    const transitionedRow = transition.rows?.[0] || null;
    if (transition.ok && transitionedRow?.id) {
      return {
        saved: true,
        row: transitionedRow,
        error: null,
        transition_mode: "atomic_failure_rpc",
        transition_attempts: attempt,
        capacity_release_handled: true,
        retry_plan: retryPlan
      };
    }

    const rpcMissing = /(?:PGRST202|schema cache|could not find).*fail_v4_recognition_job/i.test(
      String(transition.error || "")
    );
    if (rpcMissing) break;

    // A serverless/network timeout can hide a committed transaction response.
    // Read the durable row before retrying so the append-only attempt event is
    // never duplicated and a successful capacity release is not repeated.
    const reconciliation = await readV4RecognitionJobs({
      jobIds: [job.id],
      tenantId: job.tenant_id,
      select: "id,tenant_id,status,lease_owner,lease_expires_at,not_before,completed_at,error",
      env,
      fetchImpl
    });
    reconciliationError = reconciliation.error || null;
    const durableRow = reconciliation.rows?.[0] || null;
    if (durableRow && [v4JobStatuses.RETRYING, v4JobStatuses.FAILED].includes(durableRow.status)
        && !durableRow.lease_owner) {
      reconciledRow = durableRow;
      break;
    }
    if (durableRow && (
      durableRow.status !== v4JobStatuses.RUNNING
      || (job.lease_owner && durableRow.lease_owner !== job.lease_owner)
    )) {
      return {
        saved: false,
        row: durableRow,
        error: "failure_transition_lease_lost",
        transition_mode: "atomic_failure_rpc_reconciled_conflict",
        transition_attempts: attempt,
        capacity_release_handled: false,
        retry_plan: retryPlan
      };
    }
    if (attempt < atomicAttempts) {
      await new Promise((resolve) => setTimeout(resolve, atomicRetryBaseMs * (2 ** (attempt - 1))));
    }
  }

  if (reconciledRow) {
    return {
      saved: true,
      row: reconciledRow,
      error: null,
      transition_mode: "atomic_failure_rpc_reconciled",
      transition_attempts: 1,
      reconciliation_error: reconciliationError,
      capacity_release_handled: true,
      retry_plan: retryPlan
    };
  }

  // Compatibility fallback is intentionally narrow. It keeps a rolling
  // deployment operable if PostgREST has not reloaded the migration yet; all
  // other RPC failures remain visible instead of silently weakening the
  // transactional contract.
  const rpcMissing = /(?:PGRST202|schema cache|could not find).*fail_v4_recognition_job/i.test(
    String(transition.error || "")
  );
  if (!rpcMissing) {
    return {
      saved: false,
      row: null,
      error: transition.error || (transition.ok ? "row_not_matched" : "atomic_failure_transition_failed"),
      transition_mode: "atomic_failure_rpc",
      transition_attempts: atomicAttempts,
      reconciliation_error: reconciliationError,
      capacity_release_handled: false,
      retry_plan: retryPlan
    };
  }

  const saved = await markV4RecognitionJob({
    jobId: job.id,
    status: shouldRetry ? v4JobStatuses.RETRYING : v4JobStatuses.FAILED,
    patch: {
      error: failurePayload,
      not_before: shouldRetry ? new Date(Date.now() + delayMs).toISOString() : job.not_before,
      completed_at: shouldRetry ? null : nowIso(),
      lease_owner: null,
      lease_expires_at: null
    },
    workerId: job.lease_owner || null,
    env,
    fetchImpl
  });
  return {
    ...saved,
    transition_mode: "rest_compatibility_fallback",
    capacity_release_handled: false,
    retry_plan: retryPlan
  };
}

export async function readV4RecognitionJobs({
  batchId = "",
  jobIds = [],
  operatorId = "",
  tenantId = "",
  limit = 100,
  select = "*",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId) {
    return { ok: false, rows: [], error: "tenant_id_required" };
  }
  const search = {
    tenant_id: `eq.${normalizedTenantId}`,
    order: "created_at.asc",
    limit: String(positiveInteger(limit, 100, { min: 1, max: 500 }))
  };
  if (batchId) search.batch_id = `eq.${batchId}`;
  if (operatorId) search.operator_id = `eq.${String(operatorId)}`;
  if (tenantId) search.tenant_id = `eq.${String(tenantId)}`;
  const ids = Array.isArray(jobIds) ? jobIds.filter(Boolean).map(String) : [];
  if (ids.length) search.id = `in.(${ids.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`;
  if (!batchId && !ids.length) return { ok: false, rows: [], error: "batch_id_or_job_ids_required" };
  const requestedSelect = String(select || "*").trim() || "*";
  const scopedSelect = requestedSelect === "*"
    || requestedSelect.split(",").map((field) => field.trim()).includes("tenant_id")
    ? requestedSelect
    : `tenant_id,${requestedSelect}`;
  const result = await readV4Rows({ table, select: scopedSelect, search, env, fetchImpl });
  if (!result.ok) return result;
  // Service-role reads bypass RLS. Keep an application-level fence even after
  // the PostgREST tenant filter so an upstream/mock regression cannot expose a
  // different tenant's payload, result or error details.
  const rows = (result.rows || []).filter(
    (row) => String(row?.tenant_id || "").trim() === normalizedTenantId
  );
  return {
    ...result,
    rows,
    discarded_out_of_scope_count: Math.max(0, (result.rows || []).length - rows.length)
  };
}
