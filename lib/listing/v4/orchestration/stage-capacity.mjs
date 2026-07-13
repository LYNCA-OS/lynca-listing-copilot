import { callV4Rpc, isV4SupabaseConfigured } from "../session/supabase-rest.mjs";

export const listingStageIds = Object.freeze({
  PADDLE_OCR: "paddle_ocr"
});

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback, { min = 1, max = 64 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function listingStageCapacityPlan(env = process.env) {
  const ocrGlobalCapacity = positiveInteger(env.PREINGESTION_OCR_GLOBAL_CAPACITY, 8, { max: 32 });
  const ocrAnchorConcurrency = positiveInteger(env.PREINGESTION_OCR_ANCHOR_CONCURRENCY, 4, {
    max: ocrGlobalCapacity
  });
  const ocrDetailConcurrency = positiveInteger(env.PREINGESTION_OCR_DETAIL_CONCURRENCY, 1, {
    max: Math.max(1, ocrGlobalCapacity - ocrAnchorConcurrency)
  });

  return {
    ocr: {
      stage_id: listingStageIds.PADDLE_OCR,
      capacity_control_enabled: boolFromEnv(env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: ocrGlobalCapacity,
      anchor_concurrency: ocrAnchorConcurrency,
      detail_concurrency: ocrDetailConcurrency,
      local_concurrency: Math.min(ocrGlobalCapacity, ocrAnchorConcurrency + ocrDetailConcurrency),
      capacity_wait_ms: positiveInteger(env.PREINGESTION_OCR_CAPACITY_WAIT_MS, 4_000, { min: 0, max: 30_000 }),
      capacity_poll_ms: positiveInteger(env.PREINGESTION_OCR_CAPACITY_POLL_MS, 120, { min: 25, max: 2_000 }),
      lease_seconds: positiveInteger(env.PREINGESTION_OCR_CAPACITY_LEASE_SECONDS, 90, { min: 15, max: 900 })
    },
    catalog: {
      query_concurrency: positiveInteger(env.RETRIEVAL_INTERNAL_QUERY_CONCURRENCY, 4, { max: 12 })
    },
    vector: {
      index_concurrency: positiveInteger(env.VISUAL_VECTOR_INDEX_CONCURRENCY, 2, { max: 8 })
    }
  };
}

export async function acquireListingStageCapacity({
  stageId,
  jobId,
  owner,
  capacity,
  leaseSeconds,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!stageId || !jobId || !isV4SupabaseConfigured(env)) {
    return { acquired: false, configured: false, slot: null, error: "stage_capacity_not_configured" };
  }
  const result = await callV4Rpc({
    fn: "acquire_v4_stage_capacity",
    payload: {
      p_stage_id: String(stageId).slice(0, 80),
      p_job_id: String(jobId).slice(0, 160),
      p_lease_owner: String(owner || "stage_worker").slice(0, 160),
      p_capacity: positiveInteger(capacity, 1, { max: 64 }),
      p_lease_seconds: positiveInteger(leaseSeconds, 90, { min: 15, max: 900 })
    },
    env,
    fetchImpl
  });
  const slot = Number(result.rows?.[0]);
  return {
    acquired: result.ok && Number.isFinite(slot) && slot > 0,
    configured: result.ok,
    slot: Number.isFinite(slot) && slot > 0 ? slot : null,
    error: result.error || null
  };
}

export async function releaseListingStageCapacity({
  stageId,
  jobId,
  owner = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!stageId || !jobId || !isV4SupabaseConfigured(env)) {
    return { released: false, configured: false, released_count: 0, error: "stage_capacity_not_configured" };
  }
  const result = await callV4Rpc({
    fn: "release_v4_stage_capacity",
    payload: {
      p_stage_id: String(stageId).slice(0, 80),
      p_job_id: String(jobId).slice(0, 160),
      p_lease_owner: owner ? String(owner).slice(0, 160) : null
    },
    env,
    fetchImpl
  });
  const releasedCount = Number(result.rows?.[0] || 0);
  return {
    released: result.ok && releasedCount > 0,
    configured: result.ok,
    released_count: Number.isFinite(releasedCount) ? releasedCount : 0,
    error: result.error || null
  };
}
