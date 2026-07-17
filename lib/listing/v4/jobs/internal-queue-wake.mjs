import { trustedInternalServiceOrigin } from "./internal-service-origin.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "./worker-auth.mjs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function readResponseBody(response) {
  try {
    return typeof response?.json === "function" ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function invokeTrustedV4QueuePump({
  payload = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000
} = {}) {
  const origin = trustedInternalServiceOrigin(env);
  const secret = configuredWorkerSecret(env);
  if (!secret || !origin) {
    return {
      invoked: false,
      ok: false,
      error: !secret ? "worker_secret_missing" : "trusted_internal_origin_missing"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), positiveInteger(timeoutMs, 12_000, { min: 1_000, max: 60_000 }));
  try {
    const response = await fetchImpl(`${origin}/api/v4/listing-job-pump`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [workerSecretHeader]: secret,
        "user-agent": "lynca-v4-internal-queue-wake",
        "x-forwarded-for": "v4-internal-queue-wake"
      },
      body: JSON.stringify({ ...payload, detached: payload.detached !== false }),
      signal: controller.signal
    });
    const body = await readResponseBody(response);
    return {
      invoked: true,
      ok: response?.ok === true && body?.ok !== false,
      status: response?.status ?? null,
      error: body?.message || body?.failed_calls?.[0]?.message || null,
      accepted: body?.accepted === true || response?.status === 202,
      pump_failed_call_count: Number(body?.failed_call_count || 0),
      pump_claimed_count: Number(body?.claimed_count || 0),
      pump_processed_count: Number(body?.processed_count || 0)
    };
  } catch (error) {
    return {
      invoked: true,
      ok: false,
      status: null,
      error: error?.name === "AbortError" ? "queue_wake_timeout" : String(error?.message || "queue_wake_failed")
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function scheduleTrustedV4QueuePump({
  payload = {},
  reason = "internal_queue_wake",
  delayMs = 0,
  dedupScope = "",
  dedupOwner = "",
  dedupLeaseMs = 1_200,
  acquireKick = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  defer = (promise) => promise,
  logger = console
} = {}) {
  const origin = trustedInternalServiceOrigin(env);
  const secret = configuredWorkerSecret(env);
  if (!secret || !origin) {
    return {
      triggered: false,
      reason: !secret ? "worker_secret_missing" : "trusted_internal_origin_missing",
      completion: null
    };
  }

  const completion = (async () => {
    if (delayMs > 0) await sleep(delayMs);
    if (typeof acquireKick === "function" && dedupScope) {
      const acquired = await acquireKick({
        scope: dedupScope,
        owner: dedupOwner || reason,
        leaseMs: dedupLeaseMs,
        env,
        fetchImpl
      });
      if (acquired.ok && acquired.acquired !== true) {
        return { ok: true, invoked: false, deduplicated: true, reason: "wake_already_scheduled" };
      }
    }
    return invokeTrustedV4QueuePump({
      payload: { ...payload, reason },
      env,
      fetchImpl
    });
  })().then((diagnostic) => {
    const method = diagnostic.ok ? "log" : "warn";
    logger?.[method]?.("[v4_internal_queue_wake]", JSON.stringify({ reason, ...diagnostic }));
    return diagnostic;
  });
  defer(completion);
  return { triggered: true, reason, completion };
}
