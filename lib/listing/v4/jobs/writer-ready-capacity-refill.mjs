import { waitUntil } from "@vercel/functions";
import {
  v4JobLanes,
  v4WorkerProcessConcurrency
} from "./production-job-queue.mjs";
import { scheduleTrustedV4QueuePump } from "./internal-queue-wake.mjs";
import { v4EventRefillContract } from "./queue-drain-contract.mjs";

function enabledByDefault(value) {
  if (value === undefined || value === null || value === "") return true;
  return !["0", "false", "no", "off", "disabled"].includes(String(value).trim().toLowerCase());
}

export function triggerReleasedProviderCapacityRefill(_req, {
  payload = {},
  capacityRelease = {},
  releaseBoundary = "writer_ready",
  env = process.env,
  fetchImpl = globalThis.fetch,
  waitUntilImpl = waitUntil
} = {}) {
  if (capacityRelease.released !== true) return { triggered: false, reason: "capacity_not_released" };
  if (!payload.v4_queue_job_id) return { triggered: false, reason: "not_queue_job" };
  if (!enabledByDefault(env.V4_WRITER_READY_CAPACITY_REFILL_ENABLED)) {
    return { triggered: false, reason: "capacity_refill_disabled" };
  }
  const lane = payload.v4_queue_lane === v4JobLanes.INTERACTIVE
    ? v4JobLanes.INTERACTIVE
    : v4JobLanes.BACKGROUND;
  const stableConcurrency = v4WorkerProcessConcurrency(env);
  const sourceTenantId = payload.tenant_id || payload.tenantId || null;
  const reason = `${releaseBoundary}_capacity_refill`;
  const scheduled = scheduleTrustedV4QueuePump({
    payload: {
      tenant_id: null,
      refill_source_tenant_id: sourceTenantId,
      ...(lane === v4JobLanes.INTERACTIVE
        ? { interactive_only: true }
        : { background_only: true }),
      limit: stableConcurrency,
      process_concurrency: stableConcurrency,
      ...v4EventRefillContract()
    },
    reason,
    // Every real slot release must create a wake. The database capacity lease
    // is the concurrency guard; coalescing releases here can strand a queued
    // job when two provider calls finish inside the same short dedup window.
    dedupScope: "",
    acquireKick: null,
    env,
    fetchImpl,
    defer: waitUntilImpl,
    logger: console
  });
  return {
    triggered: scheduled.triggered,
    reason: scheduled.triggered ? "provider_capacity_released" : scheduled.reason,
    release_boundary: releaseBoundary,
    lane,
    job_id: payload.v4_queue_job_id,
    process_concurrency: stableConcurrency,
    completion: scheduled.completion
  };
}

export function triggerWriterReadyCapacityRefill(req, options = {}) {
  return triggerReleasedProviderCapacityRefill(req, {
    ...options,
    releaseBoundary: "writer_ready"
  });
}
