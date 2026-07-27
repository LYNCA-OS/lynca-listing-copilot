import {
  openAiKeyPoolSize,
  openAiPerKeyStableConcurrency,
  openAiProviderGlobalConcurrency
} from "../../providers/openai-key-pool.mjs";
import { callV4Rpc } from "../session/supabase-rest.mjs";

function enabled(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value || "").trim().toLowerCase());
}

function allowedTenants(env = process.env) {
  return new Set(String(env.V4_LATE_PROVIDER_LEASE_BINDING_TENANT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
}

export function v4LateProviderLeaseBindingClaimTenantId({ tenantId, env = process.env } = {}) {
  const explicitTenant = String(tenantId || "").trim();
  if (explicitTenant) {
    return v4LateProviderLeaseBindingEnabled({ tenantId: explicitTenant, env })
      ? explicitTenant
      : null;
  }
  if (!enabled(env.V4_LATE_PROVIDER_LEASE_BINDING)) return null;
  const preview = String(env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
  const productionAcknowledged = enabled(env.V4_LATE_PROVIDER_LEASE_BINDING_PRODUCTION_ACK);
  if (!preview && !productionAcknowledged) return null;
  const tenants = [...allowedTenants(env)];
  // A tenant-less queue wake may enter the worker, but an unbound claim must
  // never broaden beyond one explicitly named canary tenant.
  return tenants.length === 1 ? tenants[0] : null;
}

export function v4LateProviderLeaseBindingEnabled({ tenantId, env = process.env } = {}) {
  const tenant = String(tenantId || "").trim();
  if (!tenant || !enabled(env.V4_LATE_PROVIDER_LEASE_BINDING)) return false;
  const preview = String(env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
  const productionAcknowledged = enabled(env.V4_LATE_PROVIDER_LEASE_BINDING_PRODUCTION_ACK);
  return (preview || productionAcknowledged) && allowedTenants(env).has(tenant);
}

export async function acquireV4LateProviderCapacity({
  jobId,
  workerId,
  leaseSeconds = 120,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!jobId || !workerId) {
    return { acquired: false, reason: jobId ? "missing_worker_id" : "missing_job_id" };
  }
  const result = await callV4Rpc({
    fn: "acquire_v4_provider_capacity_for_job",
    payload: {
      p_job_id: String(jobId),
      p_worker_id: String(workerId).slice(0, 120),
      p_lease_seconds: Math.max(30, Math.min(900, Number(leaseSeconds) || 120)),
      p_provider_id: "openai_legacy",
      p_provider_capacity: openAiProviderGlobalConcurrency(env),
      p_per_key_concurrency: openAiPerKeyStableConcurrency(env),
      p_provider_key_count: Math.max(1, openAiKeyPoolSize(env))
    },
    env,
    fetchImpl
  });
  const row = result.rows?.[0] || {};
  return {
    acquired: result.ok && row.acquired === true,
    reason: row.reason || (result.ok ? "provider_capacity_unavailable" : "provider_capacity_rpc_failed"),
    provider_capacity_slot: Number(row.provider_capacity_slot || 0) || null,
    provider_key_slot: Number(row.provider_key_slot || 0) || null,
    acquired_at: row.acquired_at || null,
    existing: row.existing === true,
    error: result.error || null
  };
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export async function waitForV4LateProviderCapacity({
  jobId,
  workerId,
  leaseSeconds = 120,
  timeoutMs = 30_000,
  pollMs = 200,
  signal = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  acquire = acquireV4LateProviderCapacity
} = {}) {
  const startedAt = Date.now();
  let attempts = 0;
  let last = null;
  while (Date.now() - startedAt <= Math.max(0, Number(timeoutMs) || 0)) {
    attempts += 1;
    last = await acquire({ jobId, workerId, leaseSeconds, env, fetchImpl });
    if (last.acquired) {
      return {
        ...last,
        attempts,
        waiting_ms: Date.now() - startedAt,
        binding_mode: "late_provider_lease_v1"
      };
    }
    if (last.reason !== "provider_capacity_unavailable") break;
    await abortableDelay(Math.max(25, Math.min(2_000, Number(pollMs) || 200)), signal);
  }
  throw Object.assign(new Error(`late_provider_capacity_not_acquired:${last?.reason || "timeout"}`), {
    code: "V4_PROVIDER_CAPACITY_ACQUIRE_FAILED",
    retryable: true,
    details: { attempts, waiting_ms: Date.now() - startedAt, reason: last?.reason || "timeout" }
  });
}
