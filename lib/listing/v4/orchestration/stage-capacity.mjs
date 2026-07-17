import { callV4Rpc, isV4SupabaseConfigured } from "../session/supabase-rest.mjs";
import { contractedConcurrency, listingConcurrencyContract } from "./concurrency-contract.mjs";

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

function stageLeaseHeartbeatIntervalMs(plan = {}) {
  const leaseMs = positiveInteger(plan.lease_seconds, 90, { min: 15, max: 900 }) * 1000;
  const derived = Math.max(5_000, Math.min(30_000, Math.floor(leaseMs / 3)));
  return positiveInteger(plan.capacity_heartbeat_ms, derived, {
    min: 5,
    max: Math.max(5, Math.floor(leaseMs / 2))
  });
}

export function startListingStageCapacityHeartbeats({
  leases = [],
  heartbeatIntervalMs = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedLeases = leases
    .map((lease) => ({
      stage_id: String(lease?.stageId || lease?.stage_id || "").trim(),
      job_id: String(lease?.jobId || lease?.job_id || "").trim(),
      owner: String(lease?.owner || "stage_worker").trim(),
      capacity: positiveInteger(lease?.capacity, 1, { max: 64 }),
      lease_seconds: positiveInteger(lease?.leaseSeconds ?? lease?.lease_seconds, 90, { min: 15, max: 900 })
    }))
    .filter((lease) => lease.stage_id && lease.job_id);
  const shortestLeaseSeconds = normalizedLeases.length
    ? Math.min(...normalizedLeases.map((lease) => lease.lease_seconds))
    : 90;
  const intervalMs = heartbeatIntervalMs === null || heartbeatIntervalMs === undefined
    ? stageLeaseHeartbeatIntervalMs({ lease_seconds: shortestLeaseSeconds })
    : positiveInteger(heartbeatIntervalMs, 30_000, {
      min: 5,
      max: Math.max(5, Math.floor(shortestLeaseSeconds * 500))
    });
  const telemetry = {
    heartbeat_interval_ms: intervalMs,
    heartbeat_lease_count: normalizedLeases.length,
    heartbeat_attempts: 0,
    heartbeat_request_count: 0,
    heartbeat_failures: 0,
    heartbeat_lost_ownership_count: 0,
    heartbeat_last_error: null
  };
  let timer = null;
  let inFlight = null;
  let stopped = false;

  const runHeartbeat = async () => {
    telemetry.heartbeat_attempts += 1;
    telemetry.heartbeat_request_count += normalizedLeases.length;
    const renewals = await Promise.all(normalizedLeases.map(async (lease) => {
      try {
        return await acquireListingStageCapacity({
          stageId: lease.stage_id,
          jobId: lease.job_id,
          owner: lease.owner,
          capacity: lease.capacity,
          leaseSeconds: lease.lease_seconds,
          env,
          fetchImpl
        });
      } catch (error) {
        return {
          acquired: false,
          configured: false,
          error: String(error?.message || error || "stage_capacity_heartbeat_failed").slice(0, 160)
        };
      }
    }));
    for (const renewal of renewals) {
      if (renewal.acquired) continue;
      telemetry.heartbeat_failures += 1;
      if (renewal.configured) telemetry.heartbeat_lost_ownership_count += 1;
      telemetry.heartbeat_last_error = renewal.error
        || (renewal.configured ? "stage_capacity_lease_lost" : "stage_capacity_heartbeat_unavailable");
    }
  };

  const schedule = () => {
    if (stopped || !normalizedLeases.length) return;
    timer = setTimeout(async () => {
      inFlight = runHeartbeat();
      await inFlight;
      inFlight = null;
      schedule();
    }, intervalMs);
    timer.unref?.();
  };

  schedule();
  return {
    telemetry,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
      return telemetry;
    }
  };
}

export function listingStageCapacityPlan(env = process.env) {
  const ocrGlobalCapacity = contractedConcurrency("paddle_ocr", env.PREINGESTION_OCR_GLOBAL_CAPACITY, { fallback: 8 });
  const ocrPerAssetCapacity = contractedConcurrency(
    "paddle_ocr",
    env.PREINGESTION_OCR_PER_ASSET_CAPACITY,
    { fallback: 1, limitKey: "per_asset_concurrency" }
  );
  const ocrAnchorConcurrency = contractedConcurrency("paddle_ocr", env.PREINGESTION_OCR_ANCHOR_CONCURRENCY, {
    fallback: 8,
    limitKey: "anchor_lane_limit"
  });
  const ocrDetailConcurrency = contractedConcurrency("paddle_ocr", env.PREINGESTION_OCR_DETAIL_CONCURRENCY, {
    fallback: 2,
    limitKey: "detail_lane_limit"
  });

  return {
    ocr: {
      stage_id: listingStageIds.PADDLE_OCR,
      capacity_control_enabled: boolFromEnv(env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: ocrGlobalCapacity,
      per_asset_capacity: ocrPerAssetCapacity,
      per_asset_batch_size: contractedConcurrency("paddle_ocr", env.PREINGESTION_OCR_PER_ASSET_BATCH_SIZE, {
        fallback: 3,
        limitKey: "per_asset_batch_size"
      }),
      anchor_concurrency: Math.min(ocrGlobalCapacity, ocrAnchorConcurrency),
      detail_concurrency: Math.min(ocrGlobalCapacity, ocrDetailConcurrency),
      local_concurrency: Math.min(ocrPerAssetCapacity, ocrAnchorConcurrency + ocrDetailConcurrency),
      capacity_wait_ms: positiveInteger(env.PREINGESTION_OCR_CAPACITY_WAIT_MS, 12_000, { min: 0, max: 30_000 }),
      capacity_poll_ms: positiveInteger(env.PREINGESTION_OCR_CAPACITY_POLL_MS, 120, { min: 25, max: 2_000 }),
      lease_seconds: positiveInteger(env.PREINGESTION_OCR_CAPACITY_LEASE_SECONDS, 90, { min: 15, max: 900 })
    },
    catalog: {
      stage_id: listingStageIds.CATALOG_RETRIEVAL,
      capacity_control_enabled: boolFromEnv(env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: contractedConcurrency(
        "catalog_retrieval",
        env.RETRIEVAL_CATALOG_GLOBAL_CAPACITY,
        { fallback: listingConcurrencyContract.catalog_retrieval.concurrency }
      ),
      query_concurrency: contractedConcurrency(
        "catalog_internal_queries",
        env.RETRIEVAL_INTERNAL_QUERY_CONCURRENCY,
        { fallback: listingConcurrencyContract.catalog_internal_queries.concurrency }
      ),
      capacity_wait_ms: positiveInteger(env.RETRIEVAL_CATALOG_CAPACITY_WAIT_MS, 1_200, { min: 0, max: 15_000 }),
      capacity_poll_ms: positiveInteger(env.RETRIEVAL_CATALOG_CAPACITY_POLL_MS, 75, { min: 25, max: 2_000 }),
      lease_seconds: positiveInteger(env.RETRIEVAL_CATALOG_CAPACITY_LEASE_SECONDS, 120, { min: 15, max: 300 })
    },
    vector: {
      stage_id: listingStageIds.VECTOR_EMBEDDING,
      capacity_control_enabled: boolFromEnv(env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED, false),
      global_capacity: contractedConcurrency(
        "vector_query",
        env.VECTOR_QUERY_GLOBAL_CAPACITY,
        { fallback: listingConcurrencyContract.vector_query.concurrency }
      ),
      index_concurrency: contractedConcurrency(
        "vector_index",
        env.VISUAL_VECTOR_INDEX_CONCURRENCY,
        { fallback: listingConcurrencyContract.vector_index.concurrency }
      ),
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
  const globalCapacity = contractedConcurrency(
    "paddle_ocr",
    plan.global_capacity,
    { fallback: listingConcurrencyContract.paddle_ocr.concurrency }
  );
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
    detailConcurrency = Math.min(detailJobs, configuredDetail, availableCapacity);
  }

  // Work-conserving borrowing: if one lane has no queued work, the other may
  // use the spare slots. The durable stage lease remains the hard limit.
  let remaining = availableCapacity - anchorConcurrency - detailConcurrency;
  if (remaining > 0 && anchorJobs > anchorConcurrency) {
    const extra = Math.min(remaining, anchorJobs - anchorConcurrency);
    anchorConcurrency += Math.max(0, extra);
    remaining -= Math.max(0, extra);
  }
  if (remaining > 0 && detailJobs > detailConcurrency && detailConcurrency < configuredDetail) {
    const extra = Math.min(remaining, detailJobs - detailConcurrency, configuredDetail - detailConcurrency);
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
  const globalCapacity = contractedConcurrency(
    "paddle_ocr",
    plan.global_capacity,
    { fallback: listingConcurrencyContract.paddle_ocr.concurrency }
  );
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
    capacity: contractedConcurrency(
      "paddle_ocr",
      plan.global_capacity,
      { fallback: listingConcurrencyContract.paddle_ocr.concurrency }
    )
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

export async function releaseListingStageCapacityWithRetry({
  maxAttempts = 2,
  retryDelayMs = 50,
  ...options
} = {}) {
  const attemptsLimit = positiveInteger(maxAttempts, 2, { min: 1, max: 3 });
  let result = null;
  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    try {
      result = await releaseListingStageCapacity(options);
    } catch (error) {
      result = {
        released: false,
        configured: false,
        released_count: 0,
        error: String(error?.message || error || "stage_capacity_release_failed").slice(0, 160)
      };
    }
    if (result.released || !result.error || attempt >= attemptsLimit) {
      return { ...result, attempts: attempt };
    }
    await sleep(retryDelayMs);
  }
  return {
    ...(result || {}),
    released: false,
    attempts: attemptsLimit,
    error: result?.error || "stage_capacity_release_failed"
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
    heartbeat_interval_ms: stageLeaseHeartbeatIntervalMs(plan),
    heartbeat_lease_count: 1,
    heartbeat_attempts: 0,
    heartbeat_request_count: 0,
    heartbeat_failures: 0,
    heartbeat_lost_ownership_count: 0,
    heartbeat_last_error: null,
    released: false,
    release_attempts: 0,
    release_error: null
  };
  const heartbeat = startListingStageCapacityHeartbeats({
    leases: [{
      stageId: plan.stage_id,
      jobId: normalizedJobId,
      owner,
      capacity: plan.global_capacity,
      leaseSeconds: plan.lease_seconds
    }],
    heartbeatIntervalMs: capacity.heartbeat_interval_ms,
    env,
    fetchImpl
  });
  let value;
  let taskError;
  try {
    value = await task(capacity);
  } catch (error) {
    taskError = error;
  } finally {
    Object.assign(capacity, await heartbeat.stop());
    try {
      const released = await releaseListingStageCapacityWithRetry({
        stageId: plan.stage_id,
        jobId: normalizedJobId,
        owner,
        env,
        fetchImpl
      });
      capacity.release_attempts = released.attempts;
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
