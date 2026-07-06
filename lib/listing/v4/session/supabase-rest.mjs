function normalizeSupabaseUrl(env = process.env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function serviceRoleKey(env = process.env) {
  return String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
}

export function isV4SupabaseConfigured(env = process.env) {
  return Boolean(normalizeSupabaseUrl(env) && serviceRoleKey(env));
}

function requiredConfig(env = process.env) {
  const url = normalizeSupabaseUrl(env);
  const key = serviceRoleKey(env);
  if (!url || !key) throw new Error("Supabase V4 storage is not configured.");
  return { url, key };
}

function headers(key, prefer = "return=representation") {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    prefer
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 240);
}

export async function writeV4Row({
  table,
  row,
  upsert = false,
  onConflict = "id",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = requiredConfig(env);
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    if (upsert) endpoint.searchParams.set("on_conflict", onConflict);

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: headers(key, upsert ? "resolution=merge-duplicates,return=representation" : "return=representation"),
      body: JSON.stringify(row)
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    return { saved: true, row: Array.isArray(rows) ? rows[0] : rows, error: null };
  } catch (error) {
    return { saved: false, row: null, error: safeError(error) };
  }
}

export async function writeV4Rows({
  table,
  rows,
  upsert = false,
  onConflict = "id",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!safeRows.length) return { saved: true, rows: [], error: null, skipped: true };
  return writeV4Row({ table, row: safeRows, upsert, onConflict, env, fetchImpl });
}

export async function patchV4Row({
  table,
  id,
  patch,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = requiredConfig(env);
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    endpoint.searchParams.set("id", `eq.${id}`);
    const response = await fetchImpl(endpoint, {
      method: "PATCH",
      headers: headers(key),
      body: JSON.stringify(patch)
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    return { saved: true, row: Array.isArray(rows) ? rows[0] : rows, error: null };
  } catch (error) {
    return { saved: false, row: null, error: safeError(error) };
  }
}

export async function readV4Rows({
  table,
  select = "*",
  search = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = requiredConfig(env);
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    endpoint.searchParams.set("select", select);
    Object.entries(search || {}).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== "") endpoint.searchParams.set(name, value);
    });
    const response = await fetchImpl(endpoint, {
      headers: headers(key)
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    return { ok: true, rows: Array.isArray(rows) ? rows : [], error: null };
  } catch (error) {
    return { ok: false, rows: [], error: safeError(error) };
  }
}
