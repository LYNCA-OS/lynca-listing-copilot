import { waitUntil } from "@vercel/functions";
import { trustedInternalServiceOrigin } from "./internal-service-origin.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "./worker-auth.mjs";

const interactiveLane = "interactive";
const backgroundLane = "background";

function enabledByDefault(value) {
  if (value === undefined || value === null || value === "") return true;
  return !["0", "false", "no", "off", "disabled"].includes(String(value).trim().toLowerCase());
}

export function triggerReleasedProviderCapacityRefill(req, {
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
  const secret = configuredWorkerSecret(env);
  if (!secret) return { triggered: false, reason: "worker_secret_missing" };
  const origin = trustedInternalServiceOrigin(env);
  if (!origin) return { triggered: false, reason: "trusted_internal_origin_missing" };
  const lane = payload.v4_queue_lane === interactiveLane
    ? interactiveLane
    : backgroundLane;
  const body = {
    lane,
    tenant_id: payload.tenant_id || payload.tenantId || null,
    limit: 1,
    process_concurrency: 1,
    retry_delay_seconds: 8,
    worker_id: `v4-refill-${String(payload.v4_queue_job_id).slice(0, 96)}`,
    reason: `${releaseBoundary}_capacity_refill`
  };
  const completion = fetchImpl(`${origin}/api/v4/listing-job-worker`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [workerSecretHeader]: secret,
      "user-agent": "lynca-v4-writer-ready-refill",
      "x-forwarded-for": "v4-writer-ready-refill"
    },
    body: JSON.stringify(body)
  }).then(async (response) => {
    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
    const diagnostic = {
      ok: response.ok === true && responseBody?.ok !== false,
      status: response.status ?? null,
      claimed_count: Number(responseBody?.claimed_count || 0),
      processed_count: Number(responseBody?.processed_count || 0),
      error: responseBody?.message || null
    };
    console.log("[v4_writer_ready_capacity_refill]", JSON.stringify({
      job_id: payload.v4_queue_job_id,
      lane,
      ...diagnostic
    }));
    return diagnostic;
  }).catch((error) => {
    const diagnostic = { ok: false, status: null, claimed_count: 0, processed_count: 0, error: error?.message || "refill_fetch_failed" };
    console.warn("[v4_writer_ready_capacity_refill]", JSON.stringify({
      job_id: payload.v4_queue_job_id,
      lane,
      ...diagnostic
    }));
    return diagnostic;
  });
  waitUntilImpl(completion);
  return {
    triggered: true,
    reason: "provider_capacity_released",
    release_boundary: releaseBoundary,
    lane,
    job_id: payload.v4_queue_job_id
  };
}

export function triggerWriterReadyCapacityRefill(req, options = {}) {
  return triggerReleasedProviderCapacityRefill(req, {
    ...options,
    releaseBoundary: "writer_ready"
  });
}
