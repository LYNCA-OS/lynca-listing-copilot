import { supabaseServiceHeaders } from "./supabase-service-headers.mjs";

function configuration(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
  if (!url || !key) throw new Error("Supabase storage is not configured.");
  return { url, key };
}

function endpointFor(url, resource) {
  const name = String(resource || "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("invalid_supabase_resource");
  return new URL(`${url}/rest/v1/${name}`);
}

function boundedTimeoutMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(250, Math.min(30_000, Math.floor(parsed)))
    : fallback;
}

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 240);
}

function sanitizeJson(value) {
  let nulBytes = 0;
  const visit = (next) => {
    if (typeof next === "string") {
      const matches = next.match(/\u0000/g);
      nulBytes += matches?.length || 0;
      return matches ? next.replaceAll("\u0000", "") : next;
    }
    if (Array.isArray(next)) return next.map(visit);
    if (next instanceof Date) return visit(next.toJSON());
    if (!next || typeof next !== "object") return next;
    return Object.fromEntries(Object.entries(next).map(([key, entry]) => [visit(key), visit(entry)]));
  };
  return { value: visit(value), sanitized_nul_byte_count: nulBytes };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  return fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
}

async function parsedBody(response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function headers(key, prefer = "return=representation") {
  return supabaseServiceHeaders(key, {
    "content-type": "application/json",
    ...(prefer ? { prefer } : {})
  });
}

export async function writeSupabaseRow({
  table, row, upsert = false, onConflict = "id", duplicateResolution = "merge",
  returnRepresentation = true, timeoutMs = 8_000,
  env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = configuration(env);
    const endpoint = endpointFor(url, table);
    if (upsert) endpoint.searchParams.set("on_conflict", onConflict);
    const sanitized = sanitizeJson(row);
    const resolution = duplicateResolution === "ignore" ? "ignore-duplicates" : "merge-duplicates";
    const prefer = upsert
      ? `resolution=${resolution},return=${returnRepresentation ? "representation" : "minimal"}`
      : `return=${returnRepresentation ? "representation" : "minimal"}`;
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "POST",
      headers: headers(key, prefer),
      body: JSON.stringify(sanitized.value)
    }, boundedTimeoutMs(timeoutMs, 8_000));
    if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 180)}`);
    const body = await parsedBody(response);
    const rows = Array.isArray(body) ? body : body ? [body] : [];
    return {
      saved: true,
      row: rows[0] || null,
      rows,
      error: null,
      sanitized_nul_byte_count: sanitized.sanitized_nul_byte_count
    };
  } catch (error) {
    return { saved: false, row: null, rows: [], error: safeError(error), sanitized_nul_byte_count: 0 };
  }
}

export async function writeSupabaseRows({
  table, rows, upsert = false, onConflict = "id", duplicateResolution = "merge",
  returnRepresentation = true, timeoutMs = 8_000,
  env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!safeRows.length) {
    return { saved: true, row: null, rows: [], error: null, skipped: true };
  }
  const result = await writeSupabaseRow({
    table,
    row: safeRows,
    upsert,
    onConflict,
    duplicateResolution,
    returnRepresentation,
    timeoutMs,
    env,
    fetchImpl
  });
  return {
    ...result,
    rows: result.rows || (result.row ? [result.row] : []),
    skipped: false
  };
}

export async function readSupabaseRows({
  table, select = "*", search = {}, timeoutMs = 8_000, attempts = 2,
  env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = configuration(env);
    const endpoint = endpointFor(url, table);
    endpoint.searchParams.set("select", select);
    for (const [name, value] of Object.entries(search || {})) {
      if (value !== undefined && value !== null && value !== "") endpoint.searchParams.set(name, value);
    }
    const maximumAttempts = Math.max(1, Math.min(3, Number(attempts) || 2));
    let response = null;
    let lastError = null;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        response = await fetchWithTimeout(fetchImpl, endpoint, {
          headers: headers(key, "")
        }, boundedTimeoutMs(timeoutMs, 8_000));
        lastError = null;
      } catch (error) {
        lastError = error;
        response = null;
      }
      const retryable = !response
        || [408, 425, 429].includes(response.status)
        || response.status >= 500;
      if (!retryable || attempt >= maximumAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 120 * (2 ** (attempt - 1))));
    }
    if (!response && lastError) throw lastError;
    if (!response?.ok) throw new Error(`${response?.status || 503} ${(await response?.text?.() || "").slice(0, 180)}`);
    const body = await parsedBody(response);
    return { ok: true, rows: Array.isArray(body) ? body : [], error: null };
  } catch (error) {
    return { ok: false, rows: [], error: safeError(error) };
  }
}

export async function patchSupabaseRow({
  table, id, patch, match = {}, requireMatch = false, timeoutMs = 5_000,
  env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  try {
    const { url, key } = configuration(env);
    const endpoint = endpointFor(url, table);
    endpoint.searchParams.set("id", `eq.${id}`);
    for (const [name, value] of Object.entries(match || {})) {
      if (value === undefined || value === null || value === "") continue;
      const filter = String(value);
      endpoint.searchParams.set(
        name,
        /^(?:eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|is|in|cs|cd|ov|sl|sr|nxl|nxr|adj|not)\./.test(filter)
          ? filter
          : `eq.${filter}`
      );
    }
    const sanitized = sanitizeJson(patch);
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "PATCH",
      headers: headers(key),
      body: JSON.stringify(sanitized.value)
    }, boundedTimeoutMs(timeoutMs, 5_000));
    if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 180)}`);
    const body = await parsedBody(response);
    const rows = Array.isArray(body) ? body : body ? [body] : [];
    if (requireMatch && rows.length === 0) {
      return {
        saved: false, row: null, error: "row_not_matched",
        sanitized_nul_byte_count: sanitized.sanitized_nul_byte_count
      };
    }
    return {
      saved: true, row: rows[0] || null, error: null,
      sanitized_nul_byte_count: sanitized.sanitized_nul_byte_count
    };
  } catch (error) {
    return { saved: false, row: null, error: safeError(error), sanitized_nul_byte_count: 0 };
  }
}
