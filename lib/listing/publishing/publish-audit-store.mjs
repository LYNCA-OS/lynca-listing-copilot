import crypto from "node:crypto";

const publishJobsTable = "listing_publish_jobs";

function nowIso() {
  return new Date().toISOString();
}

function requiredSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createMemoryPublishAuditStore() {
  const jobs = new Map();

  return {
    configured: true,
    durable: false,
    async findByIdempotencyKey(idempotencyKey) {
      return [...jobs.values()].find((job) => job.idempotency_key === idempotencyKey) || null;
    },
    async createJob(row) {
      const job = {
        id: row.id || `publish_${crypto.randomUUID()}`,
        attempts: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
        ...row
      };
      jobs.set(job.id, job);
      return job;
    },
    async updateJob(id, patch) {
      const current = jobs.get(id);
      if (!current) throw new Error(`Publish job not found: ${id}`);
      const next = {
        ...current,
        ...patch,
        updated_at: nowIso()
      };
      jobs.set(id, next);
      return next;
    },
    all() {
      return [...jobs.values()];
    }
  };
}

export const defaultMemoryPublishAuditStore = createMemoryPublishAuditStore();

export function createSupabasePublishAuditStore({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = requiredSupabaseConfig(env);

  return {
    configured: Boolean(config && typeof fetchImpl === "function"),
    durable: true,
    async findByIdempotencyKey(idempotencyKey) {
      if (!this.configured) return null;
      const url = new URL(`${config.url}/rest/v1/${publishJobsTable}`);
      url.searchParams.set("idempotency_key", `eq.${idempotencyKey}`);
      url.searchParams.set("limit", "1");

      const response = await fetchImpl(url, {
        method: "GET",
        headers: supabaseHeaders(config.serviceRoleKey)
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Supabase publish job lookup failed: ${response.status} ${message.slice(0, 180)}`);
      }

      const rows = await parseJsonResponse(response);
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async createJob(row) {
      if (!this.configured) throw new Error("Supabase publish audit store is not configured.");
      const response = await fetchImpl(`${config.url}/rest/v1/${publishJobsTable}`, {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.serviceRoleKey),
          prefer: "return=representation"
        },
        body: JSON.stringify(row)
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Supabase publish job insert failed: ${response.status} ${message.slice(0, 180)}`);
      }

      const rows = await parseJsonResponse(response);
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async updateJob(id, patch) {
      if (!this.configured) throw new Error("Supabase publish audit store is not configured.");
      const url = new URL(`${config.url}/rest/v1/${publishJobsTable}`);
      url.searchParams.set("id", `eq.${id}`);

      const response = await fetchImpl(url, {
        method: "PATCH",
        headers: {
          ...supabaseHeaders(config.serviceRoleKey),
          prefer: "return=representation"
        },
        body: JSON.stringify({
          ...patch,
          updated_at: nowIso()
        })
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Supabase publish job update failed: ${response.status} ${message.slice(0, 180)}`);
      }

      const rows = await parseJsonResponse(response);
      return Array.isArray(rows) ? rows[0] : rows;
    }
  };
}

export function selectPublishAuditStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
  fallbackStore = defaultMemoryPublishAuditStore
} = {}) {
  const supabaseStore = createSupabasePublishAuditStore({ env, fetchImpl });
  return supabaseStore.configured ? supabaseStore : fallbackStore;
}
