import { callV4Rpc, isV4SupabaseConfigured } from "../session/supabase-rest.mjs";

export const listingStageIds = Object.freeze({
  PADDLE_OCR: "paddle_ocr",
  CATALOG_RETRIEVAL: "catalog_retrieval",
  VECTOR_EMBEDDING: "vector_embedding"
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function listingStageCapacityPlan(env = process.env) {
  const ocrGlobalCapacity = positiveInteger(env.PREINGESTION_OCR_GLOBAL_CAPACITY, 10, { max: 32 });
  const ocrPerAssetCapacity = positiveInteger(
    env.PREINGESTION_OCR_PER_ASSET_CAPACITY,
    1,
    { max: ocrGlobalCapacity }
  );
  const ocrAnchorConcurrency = positiveInteger(env.PREINGESTION_OCR_ANCHOR_CONCURRENCY, 8, {
    max: ocrGlobalCapacity
  });
  const ocrDetailConcurrency = positiveInteger(env.PREINGESTION_OCR_DETAIL_CONCURRENCY, 2, {
    max: Math.max(1, ocrGlobalCapacity - ocrAnchorConcurrency)
  });

  return {
    ocr: {
      stage_id: listingStageIds.PADDLE_OCR,
      capacity_control_enabled: boolFromEnv(env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: ocrGlobalCapacity,
      per_asset_capacity: ocrPerAssetCapacity,
      per_asset_batch_size: positiveInteger(env.PREINGESTION_OCR_PER_ASSET_BATCH_SIZE, 3, { max: 6 }),
      anchor_concurrency: ocrAnchorConcurrency,
      detail_concurrency: ocrDetailConcurrency,
      local_concurrency: Math.min(ocrPerAssetCapacity, ocrAnchorConcurrency + ocrDetailConcurrency),
      capacity_wait_ms: positiveInteger(env.PREINGESTION_OCR_CAPACITY_WAIT_MS, 12_000, { min: 0, max: 30_000 }),
      capacity_poll_ms: positiveInteger(env.PREINGESTION_OCR_CAPACITY_POLL_MS, 120, { min: 25, max: 2_000 }),
      lease_seconds: positiveInteger(env.PREINGESTION_OCR_CAPACITY_LEASE_SECONDS, 90, { min: 15, max: 900 })
    },
    catalog: {
      stage_id: listingStageIds.CATALOG_RETRIEVAL,
      capacity_control_enabled: boolFromEnv(env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: positiveInteger(env.RETRIEVAL_CATALOG_GLOBAL_CAPACITY, 4, { max: 16 }),
      query_concurrency: positiveInteger(env.RETRIEVAL_INTERNAL_QUERY_CONCURRENCY, 4, { max: 12 }),
      capacity_wait_ms: positiveInteger(env.RETRIEVAL_CATALOG_CAPACITY_WAIT_MS, 1_200, { min: 0, max: 15_000 }),
      capacity_poll_ms: positiveInteger(env.RETRIEVAL_CATALOG_CAPACITY_POLL_MS, 75, { min: 25, max: 2_000 }),
      lease_seconds: positiveInteger(env.RETRIEVAL_CATALOG_CAPACITY_LEASE_SECONDS, 120, { min: 15, max: 300 })
    },
    vector: {
      stage_id: listingStageIds.VECTOR_EMBEDDING,
      capacity_control_enabled: boolFromEnv(env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: positiveInteger(env.VECTOR_QUERY_GLOBAL_CAPACITY, 4, { max: 16 }),
      index_concurrency: positiveInteger(env.VISUAL_VECTOR_INDEX_CONCURRENCY, 2, { max: 8 }),
      capacity_wait_ms: positiveInteger(env.VECTOR_QUERY_CAPACITY_WAIT_MS, 750, { min: 0, max: 15_000 }),
      capacity_poll_ms: positiveInteger(env.VECTOR_QUERY_CAPACITY_POLL_MS, 75, { min: 25, max: 2_000 }),
      lease_seconds: positiveInteger(env.VECTOR_QUERY_CAPACITY_LEASE_SECONDS, 180, { min: 15, max: 900 })
    }
  };
}

export function ocrLaneConcurrencyPlan(plan = {}, {
  anchorJobCount = 0,
  detailJobCount = 0,
  capacity = null
} = {}) {
  const anchorJobs = Math.max(0, Number(anchorJobCount) || 0);
  const detailJobs = Math.max(0, Number(detailJobCount) || 0);
  const totalJobs = anchorJobs + detailJobs;
  const globalCapacity = positiveInteger(plan.global_capacity, 10, { max: 32 });
  const availableCapacity = Math.min(
    globalCapacity,
    positiveInteger(capacity, globalCapacity, { max: globalCapacity }),
    Math.max(1, totalJobs)
  );
  if (!totalJobs) {
    return { capacity: availableCapacity, anchor_concurrency: 0, detail_concurrency: 0, local_concurrency: 0 };
  }

  const configuredAnchor = positiveInteger(plan.anchor_concurrency, availableCapacity, { max: availableCapacity });
  const configuredDetail = positiveInteger(plan.detail_concurrency, 1, { max: availableCapacity });
  let anchorConcurrency = 0;
  let detailConcurrency = 0;

  if (anchorJobs && detailJobs) {
    // A one-slot card spends its first wave on a hard anchor. Once two or
    // more slots are available, retain a small detail lane without letting
    // the two independent pools exceed the shared capacity.
    const detailReserve = availableCapacity <= 1
      ? 0
      : Math.min(detailJobs, configuredDetail, Math.max(1, Math.floor(availableCapacity / 4)));
    detailConcurrency = detailReserve;
    anchorConcurrency = Math.min(anchorJobs, configuredAnchor, availableCapacity - detailConcurrency);
  } else if (anchorJobs) {
    anchorConcurrency = Math.min(anchorJobs, availableCapacity);
  } else {
    detailConcurrency = Math.min(detailJobs, availableCapacity);
  }

  // Work-conserving borrowing: if one lane has no queued work, the other may
  // use the spare slots. The durable stage lease remains the hard limit.
  let remaining = availableCapacity - anchorConcurrency - detailConcurrency;
  if (remaining > 0 && anchorJobs > anchorConcurrency) {
    const extra = Math.min(remaining, anchorJobs - anchorConcurrency);
    anchorConcurrency += Math.max(0, extra);
    remaining -= Math.max(0, extra);
  }
  if (remaining > 0 && detailJobs > detailConcurrency) {
    const extra = Math.min(remaining, detailJobs - detailConcurrency);
    detailConcurrency += Math.max(0, extra);
  }

  return {
    capacity: availableCapacity,
    anchor_concurrency: anchorConcurrency,
    detail_concurrency: detailConcurrency,
    local_concurrency: anchorConcurrency + detailConcurrency
  };
}

export function ocrPerAssetConcurrencyPlan(plan = {}, counts = {}) {
  const globalCapacity = positiveInteger(plan.global_capacity, 10, { max: 32 });
  const perAssetCapacity = Math.min(
    globalCapacity,
    positiveInteger(plan.per_asset_capacity, 1, { max: globalCapacity })
  );
  const lanePlan = ocrLaneConcurrencyPlan(plan, { ...counts, capacity: perAssetCapacity });
  return {
    per_asset_capacity: lanePlan.capacity,
    anchor_concurrency: lanePlan.anchor_concurrency,
    detail_concurrency: lanePlan.detail_concurrency,
    local_concurrency: lanePlan.local_concurrency
  };
}

export function ocrGlobalConcurrencyPlan(plan = {}, counts = {}) {
  const lanePlan = ocrLaneConcurrencyPlan(plan, {
    ...counts,
    capacity: positiveInteger(plan.global_capacity, 10, { max: 32 })
  });
  return {
    global_capacity: lanePlan.capacity,
    anchor_concurrency: lanePlan.anchor_concurrency,
    detail_concurrency: lanePlan.detail_concurrency,
    local_concurrency: lanePlan.local_concurrency
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

export async function runWithListingStageCapacity({
  plan,
  jobId,
  owner = "stage_worker",
  env = process.env,
  fetchImpl = globalThis.fetch,
  task
} = {}) {
  if (typeof task !== "function") throw new TypeError("stage capacity task is required");
  if (!plan?.capacity_control_enabled) {
    return {
      executed: true,
      value: await task({ acquired: true, coordinated: false, slot: null }),
      stage_capacity: {
        acquired: true,
        coordinated: false,
        configured: false,
        slot: null,
        wait_ms: 0,
        attempts: 0,
        released: null,
        release_error: null
      }
    };
  }

  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) {
    return {
      executed: false,
      value: null,
      stage_capacity: {
        acquired: false,
        coordinated: true,
        configured: false,
        slot: null,
        wait_ms: 0,
        attempts: 0,
        released: null,
        error: "stage_capacity_job_id_missing"
      }
    };
  }

  const startedAt = Date.now();
  let attempts = 0;
  let acquired = null;
  let lastError = null;
  do {
    attempts += 1;
    acquired = await acquireListingStageCapacity({
      stageId: plan.stage_id,
      jobId: normalizedJobId,
      owner,
      capacity: plan.global_capacity,
      leaseSeconds: plan.lease_seconds,
      env,
      fetchImpl
    });
    if (acquired.acquired) break;
    lastError = acquired.error || (acquired.configured ? "stage_capacity_busy" : "stage_capacity_unavailable");
    if (!acquired.configured || Date.now() - startedAt >= plan.capacity_wait_ms) break;
    await sleep(plan.capacity_poll_ms);
  } while (Date.now() - startedAt < plan.capacity_wait_ms);

  const waitMs = Date.now() - startedAt;
  if (!acquired?.acquired) {
    return {
      executed: false,
      value: null,
      stage_capacity: {
        ...(acquired || {}),
        acquired: false,
        coordinated: true,
        wait_ms: waitMs,
        attempts,
        released: null,
        error: lastError || "stage_capacity_busy"
      }
    };
  }

  const capacity = {
    ...acquired,
    coordinated: true,
    wait_ms: waitMs,
    attempts,
    released: false,
    release_error: null
  };
  let value;
  let taskError;
  try {
    value = await task(capacity);
  } catch (error) {
    taskError = error;
  } finally {
    try {
      const released = await releaseListingStageCapacity({
        stageId: plan.stage_id,
        jobId: normalizedJobId,
        owner,
        env,
        fetchImpl
      });
      capacity.released = released.released;
      capacity.release_error = released.error || null;
    } catch (error) {
      // The durable lease expires even if a transient release write fails.
      capacity.released = false;
      capacity.release_error = String(error?.message || error || "stage_capacity_release_failed").slice(0, 160);
    }
  }

  if (taskError) {
    taskError.stage_capacity = capacity;
    throw taskError;
  }
  return { executed: true, value, stage_capacity: capacity };
}
