import crypto from "node:crypto";
import listingJobWorkerHandler from "./listing-job-worker.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  v4JobLanes,
  v4WorkerProcessConcurrency
} from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import {
  configuredWorkerSecret,
  isV4WorkerRequest,
  workerSecretHeader
} from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function headerValue(req, name) {
  const lower = String(name || "").toLowerCase();
  const value = req?.headers?.[lower] ?? req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function cronSecret(env = process.env) {
  return String(env.CRON_SECRET || env.V4_JOB_PUMP_CRON_SECRET || "").trim();
}

function isCronRequest(req, env = process.env) {
  const secret = cronSecret(env);
  if (!secret) return false;
  return constantTimeEquals(headerValue(req, "authorization"), `Bearer ${secret}`);
}

function urlFromRequest(req) {
  const host = headerValue(req, "host") || "localhost";
  return new URL(req.url || "/", `https://${host}`);
}

function payloadFromQuery(req) {
  const url = urlFromRequest(req);
  return Object.fromEntries(url.searchParams.entries());
}

function boolFlag(value) {
  return /^(?:1|true|yes)$/i.test(String(value || ""));
}

function falseFlag(value) {
  return /^(?:0|false|no)$/i.test(String(value || ""));
}

function lanePlanFromPayload(payload = {}) {
  if (boolFlag(payload.interactive_only)) return [v4JobLanes.INTERACTIVE];
  if (boolFlag(payload.background_only)) return [v4JobLanes.BACKGROUND];
  return [v4JobLanes.INTERACTIVE, v4JobLanes.BACKGROUND];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function defaultInvokeWorker(payload, { workerSecret }) {
  return callJsonHandler(listingJobWorkerHandler, {
    method: "POST",
    headers: {
      [workerSecretHeader]: workerSecret,
      "user-agent": "lynca-v4-job-pump",
      "x-forwarded-for": "v4-job-pump"
    },
    payload
  });
}

export async function runV4QueuePump({
  payload = {},
  env = process.env,
  invokeWorker = defaultInvokeWorker,
  now = () => Date.now()
} = {}) {
  const workerSecret = configuredWorkerSecret(env);
  if (!workerSecret) {
    return {
      ok: false,
      message: "V4 worker secret is not configured.",
      cycles_run: 0,
      calls: []
    };
  }

  const started = now();
  const maxCycles = positiveInteger(payload.cycles ?? payload.max_cycles, 6, { min: 1, max: 30 });
  const limit = positiveInteger(payload.limit, 2, { min: 1, max: 12 });
  const processConcurrency = positiveInteger(
    payload.process_concurrency ?? payload.processConcurrency,
    v4WorkerProcessConcurrency(env),
    { min: 1, max: 8 }
  );
  const maxRuntimeMs = positiveInteger(payload.max_runtime_ms ?? payload.maxRuntimeMs, 250_000, { min: 5_000, max: 290_000 });
  const retryDelaySeconds = positiveInteger(payload.retry_delay_seconds ?? payload.retryDelaySeconds, 8, { min: 1, max: 900 });
  const tenantId = payload.tenant_id || payload.tenantId || null;
  const lanes = lanePlanFromPayload(payload);
  const parallelLanes = lanes.length > 1 && !falseFlag(payload.parallel_lanes ?? payload.parallelLanes);
  const idleDelayMs = positiveInteger(payload.idle_delay_ms ?? payload.idleDelayMs, 0, { min: 0, max: 30_000 });
  const defaultIdleCycles = positiveInteger(payload.idle_cycles_before_stop ?? payload.idleCyclesBeforeStop, 1, { min: 1, max: 60 });
  const backgroundIdleCycles = positiveInteger(
    payload.background_idle_cycles ?? payload.backgroundIdleCycles,
    defaultIdleCycles,
    { min: 1, max: 120 }
  );
  const calls = [];
  let totalClaimed = 0;
  let totalProcessed = 0;
  const laneSummaries = [];

  async function runLane(lane) {
    const stopAfterIdle = lane === v4JobLanes.BACKGROUND ? backgroundIdleCycles : defaultIdleCycles;
    let laneCycles = 0;
    let idleCycles = 0;
    let laneClaimed = 0;
    let laneProcessed = 0;
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      if (now() - started >= maxRuntimeMs) break;
      laneCycles += 1;
      const callStarted = now();
      const workerPayload = {
        lane,
        tenant_id: tenantId,
        limit,
        process_concurrency: processConcurrency,
        retry_delay_seconds: retryDelaySeconds,
        worker_id: `v4-pump-${lane}-${cycle + 1}`
      };
      const response = await invokeWorker(workerPayload, { workerSecret, env });
      const body = response?.body || {};
      const claimed = positiveInteger(body.claimed_count, 0, { min: 0, max: 10_000 });
      const processed = positiveInteger(body.processed_count, 0, { min: 0, max: 10_000 });
      totalClaimed += claimed;
      totalProcessed += processed;
      laneClaimed += claimed;
      laneProcessed += processed;
      calls.push({
        cycle: cycle + 1,
        lane,
        status_code: response?.statusCode || 0,
        ok: response?.statusCode >= 200 && response?.statusCode < 300 && body.ok !== false,
        claimed_count: claimed,
        processed_count: processed,
        latency_ms: now() - callStarted,
        message: body.message || null
      });

      if (!claimed) {
        idleCycles += 1;
        if (idleCycles >= stopAfterIdle) break;
        if (idleDelayMs > 0) await delay(idleDelayMs);
      } else {
        idleCycles = 0;
      }
    }
    return { lane, cycles_run: laneCycles, claimed_count: laneClaimed, processed_count: laneProcessed };
  }

  if (parallelLanes) {
    laneSummaries.push(...await Promise.all(lanes.map((lane) => runLane(lane))));
  } else {
    for (const lane of lanes) {
      laneSummaries.push(await runLane(lane));
    }
  }

  return {
    ok: true,
    tenant_id: tenantId,
    cycles_run: Math.max(0, ...laneSummaries.map((summary) => summary.cycles_run || 0)),
    lanes,
    parallel_lanes: parallelLanes,
    limit,
    process_concurrency: processConcurrency,
    idle_delay_ms: idleDelayMs,
    idle_cycles_before_stop: defaultIdleCycles,
    background_idle_cycles: backgroundIdleCycles,
    claimed_count: totalClaimed,
    processed_count: totalProcessed,
    elapsed_ms: now() - started,
    lane_summaries: laneSummaries,
    calls
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!isV4WorkerRequest(req, process.env) && !isCronRequest(req, process.env)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized pump" }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_pump",
    limit: 120,
    windowMs: 60_000,
    identifier: "v4-production-pump",
    message: "Too many V4 queue pump requests. Please try again shortly."
  })) return;

  let payload = payloadFromQuery(req);
  if (req.method === "POST") {
    try {
      payload = { ...payload, ...(await readJsonPayload(req)) };
    } catch {
      sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
      return;
    }
  }

  const result = await runV4QueuePump({ payload, env: process.env });
  sendJson(res, result.ok ? 200 : 503, withV4Version(result));
}
