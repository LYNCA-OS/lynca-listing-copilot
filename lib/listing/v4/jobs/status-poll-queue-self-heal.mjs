import { waitUntil } from "@vercel/functions";
import {
  tryAcquireV4QueueKick,
  v4JobLanes,
  v4JobStatuses,
  v4WorkerProcessConcurrency
} from "./production-job-queue.mjs";
import { scheduleTrustedV4QueuePump } from "./internal-queue-wake.mjs";
import { v4EventRefillContract } from "./queue-drain-contract.mjs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function statusPollQueueSelfHealPlan(jobs = [], {
  nowMs = Date.now(),
  processConcurrency = 2,
  minimumQueueAgeMs = 15_000
} = {}) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const runningCount = rows.filter((job) => job.status === v4JobStatuses.RUNNING).length;
  const readyQueued = rows.filter((job) => {
    if (job.status !== v4JobStatuses.QUEUED) return false;
    const notBefore = Date.parse(job.not_before || "");
    return !Number.isFinite(notBefore) || notBefore <= nowMs;
  });
  if (!readyQueued.length) return { trigger: false, reason: "no_ready_queued_jobs", running_count: runningCount };
  if (runningCount >= processConcurrency) {
    return { trigger: false, reason: "worker_capacity_full", running_count: runningCount, queued_count: readyQueued.length };
  }
  const createdTimes = readyQueued.map((job) => Date.parse(job.created_at || "")).filter(Number.isFinite);
  const oldestQueueAgeMs = createdTimes.length ? Math.max(0, nowMs - Math.min(...createdTimes)) : 0;
  if (oldestQueueAgeMs < minimumQueueAgeMs) {
    return { trigger: false, reason: "queue_age_below_self_heal_floor", running_count: runningCount, queued_count: readyQueued.length, oldest_queue_age_ms: oldestQueueAgeMs };
  }
  const lane = readyQueued.some((job) => job.lane === v4JobLanes.INTERACTIVE)
    ? v4JobLanes.INTERACTIVE
    : v4JobLanes.BACKGROUND;
  return {
    trigger: true,
    reason: "status_poll_detected_idle_capacity",
    lane,
    running_count: runningCount,
    queued_count: readyQueued.length,
    oldest_queue_age_ms: oldestQueueAgeMs,
    batch_id: readyQueued[0]?.batch_id || null,
    tenant_id: readyQueued[0]?.tenant_id || null
  };
}

export function triggerStatusPollQueueSelfHeal(jobs = [], {
  env = process.env,
  fetchImpl = globalThis.fetch,
  defer = waitUntil,
  acquireKick = tryAcquireV4QueueKick,
  nowMs = Date.now()
} = {}) {
  if (["0", "false", "off", "disabled"].includes(String(env.V4_STATUS_POLL_QUEUE_SELF_HEAL_ENABLED || "true").trim().toLowerCase())) {
    return { triggered: false, reason: "status_poll_self_heal_disabled" };
  }
  const processConcurrency = v4WorkerProcessConcurrency(env);
  const plan = statusPollQueueSelfHealPlan(jobs, {
    nowMs,
    processConcurrency,
    minimumQueueAgeMs: positiveInteger(env.V4_STATUS_POLL_QUEUE_SELF_HEAL_AFTER_MS, 15_000, { min: 5_000, max: 120_000 })
  });
  if (!plan.trigger) return { triggered: false, ...plan };
  const laneOnly = plan.lane === v4JobLanes.INTERACTIVE
    ? { interactive_only: true }
    : { background_only: true };
  const scheduled = scheduleTrustedV4QueuePump({
    payload: {
      tenant_id: null,
      self_heal_source_tenant_id: plan.tenant_id,
      ...laneOnly,
      limit: processConcurrency,
      process_concurrency: processConcurrency,
      ...v4EventRefillContract()
    },
    reason: "status_poll_queue_self_heal",
    dedupScope: `status-self-heal:${plan.tenant_id || "global"}:${plan.batch_id || "jobs"}`,
    dedupOwner: `status-poll-${nowMs}`,
    dedupLeaseMs: 5_000,
    acquireKick,
    env,
    fetchImpl,
    defer
  });
  return { ...plan, triggered: scheduled.triggered, completion: scheduled.completion };
}
