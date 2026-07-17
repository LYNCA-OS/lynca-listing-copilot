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
  return supabaseServiceHeaders(key, {
    "content-type": "application/json",
    ...(prefer ? { prefer } : {})
  });
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

function boundedTimeoutMs(value, fallback = 5000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(250, Math.min(30_000, Math.floor(parsed)));
}

function nulByteCount(value = "") {
  return (String(value).match(/\u0000/g) || []).length;
}

export function sanitizeV4PostgresJson(value) {
  let sanitizedNulByteCount = 0;

  const visit = (next) => {
    if (typeof next === "string") {
      const count = nulByteCount(next);
      sanitizedNulByteCount += count;
      return count ? next.replaceAll("\u0000", "") : next;
    }
    if (Array.isArray(next)) return next.map(visit);
    if (next instanceof Date) return visit(next.toJSON());
    if (!next || typeof next !== "object") return next;

    return Object.fromEntries(Object.entries(next).map(([key, entry]) => {
      const cleanKey = visit(key);
      return [cleanKey, visit(entry)];
    }));
  };

  return {
    value: visit(value),
    sanitized_nul_byte_count: sanitizedNulByteCount
  };
}

function serializeV4PostgresJson(value, { operation, resource } = {}) {
  const sanitized = sanitizeV4PostgresJson(value);
  if (sanitized.sanitized_nul_byte_count > 0) {
    console.warn(JSON.stringify({
      event: "v4_supabase_json_sanitized",
      operation: operation || null,
      resource: resource || null,
      sanitized_nul_byte_count: sanitized.sanitized_nul_byte_count
    }));
  }
  return {
    ...sanitized,
    body: JSON.stringify(sanitized.value)
  };
}

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abortFromUpstream();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("v4_supabase_timeout")), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
  }
}

export async function writeV4Row({
  table,
  row,
  upsert = false,
  onConflict = "id",
  duplicateResolution = "merge",
  returnRepresentation = true,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = requiredConfig(env);
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    if (upsert) endpoint.searchParams.set("on_conflict", onConflict);
    const serialized = serializeV4PostgresJson(row, { operation: "write", resource: table });

    const resolution = duplicateResolution === "ignore" ? "ignore-duplicates" : "merge-duplicates";
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "POST",
      headers: headers(key, upsert
        ? `resolution=${resolution},return=${returnRepresentation ? "representation" : "minimal"}`
        : `return=${returnRepresentation ? "representation" : "minimal"}`),
      body: serialized.body
    }, boundedTimeoutMs(env.V4_SUPABASE_WRITE_TIMEOUT_MS, 8000));
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    const savedRows = Array.isArray(rows) ? rows : rows ? [rows] : [];
    return {
      saved: true,
      row: savedRows[0] || null,
      rows: savedRows,
      error: null,
      sanitized_nul_byte_count: serialized.sanitized_nul_byte_count
    };
  } catch (error) {
    return { saved: false, row: null, rows: [], error: safeError(error), sanitized_nul_byte_count: 0 };
  }
}

export async function writeV4Rows({
  table,
  rows,
  upsert = false,
  onConflict = "id",
  duplicateResolution = "merge",
  returnRepresentation = true,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!safeRows.length) return { saved: true, rows: [], error: null, skipped: true };
  const result = await writeV4Row({
    table,
    row: safeRows,
    upsert,
    onConflict,
    duplicateResolution,
    returnRepresentation,
    env,
    fetchImpl
  });
  return {
    saved: result.saved,
    rows: result.rows || (result.row ? [result.row] : []),
    row: result.row || null,
    error: result.error || null,
    sanitized_nul_byte_count: result.sanitized_nul_byte_count || 0,
    skipped: false
  };
}

export async function patchV4Row({
  table,
  id,
  patch,
  match = {},
  requireMatch = false,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = requiredConfig(env);
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    endpoint.searchParams.set("id", `eq.${id}`);
    Object.entries(match || {}).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== "") endpoint.searchParams.set(name, String(value));
    });
    const serialized = serializeV4PostgresJson(patch, { operation: "patch", resource: table });
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "PATCH",
      headers: headers(key),
      body: serialized.body
    }, boundedTimeoutMs(env.V4_SUPABASE_PATCH_TIMEOUT_MS, 5000));
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    const matchedRows = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (requireMatch && matchedRows.length === 0) {
      return {
        saved: false,
        row: null,
        error: "row_not_matched",
        sanitized_nul_byte_count: serialized.sanitized_nul_byte_count
      };
    }
    return {
      saved: true,
      row: matchedRows[0] || null,
      error: null,
      sanitized_nul_byte_count: serialized.sanitized_nul_byte_count
    };
  } catch (error) {
    return { saved: false, row: null, error: safeError(error), sanitized_nul_byte_count: 0 };
  }
}

export async function readV4Rows({
  table,
  select = "*",
  search = {},
  count = "",
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
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      headers: headers(key, count ? `count=${count}` : undefined)
    }, boundedTimeoutMs(env.V4_SUPABASE_READ_TIMEOUT_MS, 8000));
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    const contentRange = response.headers?.get?.("content-range") || null;
    const totalMatch = contentRange?.match?.(/\/(\d+)$/);
    return {
      ok: true,
      rows: Array.isArray(rows) ? rows : [],
      count: totalMatch ? Number(totalMatch[1]) : null,
      content_range: contentRange,
      error: null
    };
  } catch (error) {
    return { ok: false, rows: [], count: null, content_range: null, error: safeError(error) };
  }
}

export async function callV4Rpc({
  fn,
  payload = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = requiredConfig(env);
    if (!fn) throw new Error("missing_rpc_function");
    const endpoint = new URL(`${url}/rest/v1/rpc/${fn}`);
    const serialized = serializeV4PostgresJson(payload || {}, { operation: "rpc", resource: fn });
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "POST",
      headers: headers(key),
      body: serialized.body
    }, boundedTimeoutMs(env.V4_SUPABASE_RPC_TIMEOUT_MS, 10000));
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${response.status} ${message.slice(0, 180)}`);
    }
    const rows = await readJson(response);
    return {
      ok: true,
      rows: Array.isArray(rows) ? rows : rows ? [rows] : [],
      error: null,
      sanitized_nul_byte_count: serialized.sanitized_nul_byte_count
    };
  } catch (error) {
    return { ok: false, rows: [], error: safeError(error), sanitized_nul_byte_count: 0 };
  }
}
import { supabaseServiceHeaders } from "../../../supabase-service-headers.mjs";
