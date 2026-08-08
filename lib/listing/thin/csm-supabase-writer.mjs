// Write the CSM stage rows to Supabase.
//
// `csm-persistence.mjs` builds the rows; this is the transport and nothing
// else. Keeping them apart is the point: the row shapes are covered by a
// contract test that reads the migration file, and that test must not need a
// database. What is left here is small enough to read in one sitting --
// ordering, idempotency, and failure containment.
//
// This closes the last code-shaped gap in COS-25's chain:
//
//   upload -> stored asset -> evidence/candidates
//     -> identity resolution -> canonical object
//     -> marketplace composition -> eBay output
//
// with `upload -> stored asset` still owned by the application layer.
//
// Three properties the issue asks for by name:
//
//   * idempotency -- the immutable recognition session reserves the three
//     canonical packet hashes before any child row is written. A completed
//     exact replay is a no-op; a changed packet is rejected before writes.
//
//   * traceability -- rows go in FK order, so a reader never sees a resolved
//     bracket whose candidate is missing.
//
//   * failure preservation -- the six PostgREST writes are deliberately not
//     described as a transaction. A failed write reports the partial counts;
//     only the exact reserved packet may resume it. The application boundary
//     fails closed until that retry finishes.

import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";
import {
  computeCsmPacketHashes,
  THIN_REGISTRY_RELEASE_ID,
  THIN_RESOLVER_VERSION,
  THIN_COMPOSER_VERSION
} from "./csm-persistence.mjs";

// FK order, not schema order. csm_candidate_evidence_links references both a
// candidate and an evidence row, and csm_resolved_brackets references both a
// resolution and a candidate, so those two go after their parents. Getting
// this wrong surfaces as a foreign-key violation on the FIRST card, which is
// the good failure mode -- but only because the order is explicit here rather
// than being whatever Object.keys returned.
const WRITE_PLAN = Object.freeze([
  { key: "evidence", table: "csm_evidence_observations", conflict: "id" },
  { key: "candidates", table: "csm_bracket_candidates", conflict: "id" },
  { key: "links", table: "csm_candidate_evidence_links", conflict: "candidate_id,evidence_observation_id,relationship" },
  { key: "resolution", table: "csm_identity_resolutions", conflict: "id" },
  { key: "resolved", table: "csm_resolved_brackets", conflict: "resolution_id,bracket" },
  { key: "output", table: "csm_marketplace_outputs", conflict: "id" }
]);

const SESSION_HASH_KEYS = Object.freeze([
  "csm_recognition_packet_sha256",
  "csm_resolution_packet_sha256",
  "csm_marketplace_packet_sha256"
]);

const SESSION_STATUS_KEYS = Object.freeze([
  "csm_recognition_stage_status",
  "csm_resolution_stage_status",
  "csm_composition_stage_status"
]);

export const CSM_ATOMIC_PERSISTENCE_RPC = "persist_csm_stage_packet_v1";
export const CSM_PRODUCT_PROJECTION_READINESS_RPC = "check_csm_session_product_projection_v1";
export const CSM_PRODUCT_PROJECTION_VERSION = "csm-session-product-projection-v1";
export const CSM_SUPABASE_REQUEST_TIMEOUT_MS = 5_000;
export const CSM_SUPABASE_READINESS_BUDGET_MS = 8_000;
export const CSM_SUPABASE_ATOMIC_BUDGET_MS = 12_000;
export const THIN_REGISTRY_RELEASE_CONTRACT = Object.freeze({
  id: THIN_REGISTRY_RELEASE_ID,
  registry_version: "thin-path-registry-release-v1",
  content_sha256: "ac36d845fe8ca6ad21b017560736864f077fc67a1a864ad9947ac25b8432a6c7",
  sem_standard_version: "linear-cos-10-23-v25"
});

const emptyWrittenCounts = () => Object.fromEntries(WRITE_PLAN.map(({ table }) => [table, 0]));

function safeText(value) {
  return String(value || "").trim();
}

function positiveTimeout(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function requestTimedOut(error) {
  return [error, error?.cause].some((candidate) => (
    candidate?.name === "TimeoutError"
    || candidate?.name === "AbortError"
    || candidate?.code === "ABORT_ERR"
  ));
}

function boundedRequestSignal({ deadlineMs, requestTimeoutMs, now }) {
  const remainingMs = Math.floor(deadlineMs - now());
  if (remainingMs < 1) {
    throw Object.assign(new Error("csm_supabase_budget_exhausted"), {
      name: "TimeoutError"
    });
  }
  return AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remainingMs)));
}

function stageRowsIdentity(rows) {
  const tenantId = safeText(rows?.resolution?.tenant_id);
  const recognitionSessionId = safeText(rows?.resolution?.recognition_session_id);
  if (!tenantId || !recognitionSessionId) throw new Error("missing_csm_stage_row_identity");
  for (const step of WRITE_PLAN) {
    const values = Array.isArray(rows?.[step.key]) ? rows[step.key] : rows?.[step.key] ? [rows[step.key]] : [];
    for (const row of values) {
      if (safeText(row?.tenant_id) !== tenantId || safeText(row?.recognition_session_id) !== recognitionSessionId) {
        throw new Error("mixed_csm_stage_row_identity");
      }
    }
  }
  return { tenantId, recognitionSessionId };
}

function stagePacketHashes(rows) {
  const supplied = rows?.session_hashes || {};
  const computed = computeCsmPacketHashes(rows);
  if (!SESSION_HASH_KEYS.every((key) => (
    /^[0-9a-f]{64}$/.test(safeText(supplied[key]))
    && safeText(supplied[key]) === computed[key]
  ))) {
    throw new Error("invalid_csm_packet_hashes");
  }
  if (safeText(rows?.resolution?.recognition_packet_sha256)
      !== computed.csm_recognition_packet_sha256
      || safeText(rows?.output?.resolution_packet_sha256)
      !== computed.csm_resolution_packet_sha256) {
    throw new Error("csm_packet_lineage_hash_mismatch");
  }
  return computed;
}

async function responseRows(response, context) {
  const text = await response.text();
  if (!text) throw new Error(`${context}:representation_missing`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${context}:representation_invalid`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${context}:representation_not_array`);
  return parsed;
}

export function isCsmPersistenceConfigured(env = process.env) {
  return Boolean(String(env.SUPABASE_URL || "").trim()
    && String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim());
}

const csmServiceKey = (env) => String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();

/** Active CSM persistence is OFF unless explicitly enabled. */
export function csmPersistenceEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.CSM_PERSISTENCE_ENABLED || "").trim().toLowerCase()
  );
}

/** Cost guard: verify the migration and Registry seed before paying the model. */
export async function checkCsmPersistenceReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = CSM_SUPABASE_REQUEST_TIMEOUT_MS,
  maximumDurationMs = CSM_SUPABASE_READINESS_BUDGET_MS,
  now = Date.now,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
} = {}) {
  if (!csmPersistenceEnabled(env)) return { ready: false, reason: "disabled" };
  if (!isCsmPersistenceConfigured(env)) return { ready: false, reason: "unconfigured" };
  if (typeof fetchImpl !== "function") return { ready: false, reason: "missing_fetch" };
  if (typeof now !== "function") return { ready: false, reason: "invalid_now" };
  const perRequestTimeoutMs = positiveTimeout(requestTimeoutMs, CSM_SUPABASE_REQUEST_TIMEOUT_MS, 60_000);
  const totalBudgetMs = positiveTimeout(maximumDurationMs, CSM_SUPABASE_READINESS_BUDGET_MS, 60_000);
  const deadlineMs = now() + totalBudgetMs;
  const endpoint = new URL(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/csm_registry_releases`);
  endpoint.searchParams.set("select", "id,registry_version,content_sha256,sem_standard_version,registry_payload");
  endpoint.searchParams.set("id", `eq.${THIN_REGISTRY_RELEASE_ID}`);
  endpoint.searchParams.set("limit", "1");
  let lastReason = "schema_probe_failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let phase = "registry_probe";
    try {
      const response = await fetchImpl(endpoint.toString(), {
        headers: supabaseServiceHeaders(csmServiceKey(env)),
        redirect: "error",
        signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
      });
      if (!response.ok) {
        lastReason = `schema_probe_${response.status}`;
        if (response.status < 500 || attempt === 2) return { ready: false, reason: lastReason };
      } else {
        const rows = await response.json();
        const release = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
        if (!release) return { ready: false, reason: "registry_release_missing" };
        if (!Object.entries(THIN_REGISTRY_RELEASE_CONTRACT)
          .every(([name, value]) => release[name] === value)
          || release.registry_payload?.mode !== "local_sem_and_composer_only"
          || release.registry_payload?.external_catalog !== false) {
          return { ready: false, reason: "registry_release_contract_mismatch" };
        }
        // A harmless invalid-input call proves PostgREST can see the additive
        // atomic RPC before a paid provider request. It returns before locking
        // or writing any session.
        // Both probes are invalid-input/read-only checks and do not depend on
        // one another. Run them concurrently after the Registry contract is
        // verified; the outer retry loop still retries the whole receipt if
        // either transport boundary is transient or times out.
        const probeRpc = async (probePhase, url, init, expected) => {
          let response;
          try {
            response = await fetchImpl(url, init);
          } catch (error) {
            error.csmReadinessPhase = probePhase;
            throw error;
          }
          if (!response.ok) return { ok: false, reason: `${probePhase}_${response.status}` };
          let result = null;
          try {
            result = await response.json();
          } catch (error) {
            if (requestTimedOut(error)) {
              error.csmReadinessPhase = probePhase;
              throw error;
            }
          }
          return expected(result)
            ? { ok: true, result }
            : { ok: false, reason: `${probePhase}_contract_mismatch` };
        };
        const [atomicProbe, projectionProbe] = await Promise.all([
          probeRpc(
            "atomic_rpc_probe",
            `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_ATOMIC_PERSISTENCE_RPC}`,
            {
              method: "POST",
              headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
              redirect: "error",
              body: JSON.stringify({
                p_tenant_id: "",
                p_recognition_session_id: "",
                p_packet: {},
                p_session_patch: {}
              }),
              signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
            },
            (result) => result?.code === "missing_csm_stage_row_identity"
          ),
          probeRpc(
            "product_projection_probe",
            `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`,
            {
              method: "POST",
              headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
              redirect: "error",
              body: "{}",
              signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
            },
            (result) => result?.ok === true
              && result?.code === "csm_product_projection_ready"
              && result?.version === CSM_PRODUCT_PROJECTION_VERSION
          )
        ]);
        if (!atomicProbe.ok) return { ready: false, reason: atomicProbe.reason };
        return projectionProbe.ok
          ? { ready: true, reason: null }
          : { ready: false, reason: projectionProbe.reason };
      }
    } catch (error) {
      phase = error?.csmReadinessPhase || phase;
      lastReason = requestTimedOut(error)
        ? `${phase}_timeout`
        : `${phase}_failed:${String(error?.message || error).slice(0, 120)}`;
      if (attempt === 2) return { ready: false, reason: lastReason };
    }
    const remainingMs = Math.max(0, deadlineMs - now());
    if (remainingMs < 1) return { ready: false, reason: lastReason };
    await sleep(Math.min(120, remainingMs));
  }
  return { ready: false, reason: lastReason };
}

/** Read the immutable attempt marker owned by v4_recognition_sessions. */
export async function readCsmSessionPacketState({
  tenantId, recognitionSessionId, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const endpoint = new URL(`${url}/rest/v1/v4_recognition_sessions`);
  endpoint.searchParams.set("select", ["id", "tenant_id", ...SESSION_HASH_KEYS, ...SESSION_STATUS_KEYS].join(","));
  endpoint.searchParams.set("id", `eq.${recognitionSessionId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  endpoint.searchParams.set("limit", "1");
  const response = await fetchImpl(endpoint.toString(), {
    headers: supabaseServiceHeaders(csmServiceKey(env)),
    redirect: "error"
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_session_preflight:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_session_preflight");
  return rows[0] || null;
}

/**
 * Reserve one packet on a session with a compare-and-set PATCH.
 *
 * This is not the six-table transaction. It is the immutable attempt fence:
 * only one set of packet hashes can cross the child-write boundary.
 */
export async function claimCsmSessionPacket({
  tenantId, recognitionSessionId, hashes, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const endpoint = new URL(`${url}/rest/v1/v4_recognition_sessions`);
  endpoint.searchParams.set("id", `eq.${recognitionSessionId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  for (const key of SESSION_HASH_KEYS) endpoint.searchParams.set(key, "is.null");
  const response = await fetchImpl(endpoint.toString(), {
    method: "PATCH",
    headers: supabaseServiceHeaders(csmServiceKey(env), {
      "content-type": "application/json",
      prefer: "return=representation"
    }),
    redirect: "error",
    body: JSON.stringify(hashes)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_session_claim:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_session_claim");
  return { claimed: rows.length === 1, session: rows[0] || null };
}

/** Detect legacy/partial child facts that have no packet reservation. */
export async function readExistingCsmStageRows({
  tenantId, recognitionSessionId, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const checks = await Promise.all(WRITE_PLAN.map(async ({ table, conflict }) => {
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    endpoint.searchParams.set("select", conflict.split(",")[0]);
    endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    endpoint.searchParams.set("recognition_session_id", `eq.${recognitionSessionId}`);
    endpoint.searchParams.set("limit", "1");
    const response = await fetchImpl(endpoint.toString(), {
      headers: supabaseServiceHeaders(csmServiceKey(env)),
      redirect: "error"
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${table}_preflight:${response.status} ${detail.slice(0, 180)}`);
    }
    const rows = await responseRows(response, `${table}_preflight`);
    return { table, present: rows.length > 0 };
  }));
  return checks;
}

function classifySessionPacket(session, hashes) {
  if (!session) return { state: "missing" };
  const stored = SESSION_HASH_KEYS.map((key) => safeText(session[key]));
  const present = stored.filter(Boolean).length;
  if (present === 0) return { state: "unclaimed" };
  if (present !== SESSION_HASH_KEYS.length) return { state: "invalid_partial_hashes" };
  const exact = SESSION_HASH_KEYS.every((key) => safeText(session[key]) === hashes[key]);
  if (!exact) return { state: "conflict" };
  const complete = SESSION_STATUS_KEYS.every((key) => safeText(session[key]).toUpperCase() === "COMPLETE");
  return { state: complete ? "exact_complete" : "exact_incomplete" };
}

function writerFailure(code, {
  statusCode = 503, written = emptyWrittenCounts(), failedTable = null, error = code
} = {}) {
  return {
    ok: false,
    code,
    statusCode,
    skipped: null,
    replayed: false,
    atomic: false,
    written,
    failedTable,
    error
  };
}

/**
 * Production transport: one Postgres transaction for rows + COMPLETE marker.
 * The additive migration owns locking, immutable retry classification and
 * actual insert counts. Absence or an invalid response fails closed.
 */
export async function writeCsmStagePacketAtomically(rows, {
  sessionPatch,
  env = process.env,
  fetchImpl = globalThis.fetch,
  maximumAttempts = 5,
  retryDelayMs = 100,
  requestTimeoutMs = CSM_SUPABASE_REQUEST_TIMEOUT_MS,
  maximumDurationMs = CSM_SUPABASE_ATOMIC_BUDGET_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = Date.now
} = {}) {
  if (!csmPersistenceEnabled(env)) {
    return { ok: true, skipped: "disabled", written: {}, atomic: false };
  }
  if (!isCsmPersistenceConfigured(env)) {
    return { ok: true, skipped: "unconfigured", written: {}, atomic: false };
  }

  let identity;
  let hashes;
  try {
    identity = stageRowsIdentity(rows);
    hashes = stagePacketHashes(rows);
  } catch (error) {
    return writerFailure(String(error?.message || "invalid_csm_stage_rows"), {
      statusCode: 400,
      error: String(error?.message || error)
    });
  }
  if (!sessionPatch || SESSION_HASH_KEYS.some((key) => safeText(sessionPatch[key]) !== hashes[key])) {
    return writerFailure("invalid_csm_session_patch", { statusCode: 400 });
  }

  const endpoint = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_ATOMIC_PERSISTENCE_RPC}`;
  const attempts = Math.max(1, Math.min(5, Number(maximumAttempts) || 5));
  const perRequestTimeoutMs = positiveTimeout(requestTimeoutMs, CSM_SUPABASE_REQUEST_TIMEOUT_MS, 60_000);
  const totalBudgetMs = positiveTimeout(maximumDurationMs, CSM_SUPABASE_ATOMIC_BUDGET_MS, 60_000);
  if (typeof fetchImpl !== "function" || typeof now !== "function") {
    return writerFailure("csm_atomic_rpc_invalid_transport", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  const deadlineMs = now() + totalBudgetMs;
  const request = {
    method: "POST",
    headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
    redirect: "error",
    body: JSON.stringify({
      p_tenant_id: identity.tenantId,
      p_recognition_session_id: identity.recognitionSessionId,
      p_packet: rows,
      p_session_patch: sessionPatch
    })
  };
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    let raw = "";
    try {
      response = await fetchImpl(endpoint, {
        ...request,
        signal: boundedRequestSignal({ deadlineMs, requestTimeoutMs: perRequestTimeoutMs, now })
      });
      raw = await response.text();
    } catch (error) {
      const timedOut = requestTimedOut(error);
      if (attempt < attempts && deadlineMs - now() > 0) {
        await sleep(Math.min(
          retryDelayMs * (2 ** (attempt - 1)),
          Math.max(0, deadlineMs - now())
        ));
        continue;
      }
      return writerFailure(timedOut ? "csm_atomic_rpc_timeout" : "csm_atomic_rpc_failed", {
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC,
        error: String(error?.message || error)
      });
    }
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await sleep(Math.min(
          retryDelayMs * (2 ** (attempt - 1)),
          Math.max(0, deadlineMs - now())
        ));
        continue;
      }
      return writerFailure("csm_atomic_rpc_failed", {
        statusCode: Number(response.status || 503),
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC,
        error: `${response.status} ${raw.slice(0, 240)}`
      });
    }
    try {
      const parsed = JSON.parse(raw);
      result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
    } catch {
      return writerFailure("csm_atomic_rpc_invalid_response", {
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC
      });
    }
    if (result?.ok !== true
        && [429, 500, 502, 503, 504].includes(Number(result?.status_code))
        && attempt < attempts) {
      await sleep(Math.min(
        retryDelayMs * (2 ** (attempt - 1)),
        Math.max(0, deadlineMs - now())
      ));
      continue;
    }
    break;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return writerFailure("csm_atomic_rpc_invalid_response", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  if (result.ok !== true) {
    return writerFailure(safeText(result.code) || "csm_atomic_rpc_rejected", {
      statusCode: Number(result.status_code || 503),
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  const written = emptyWrittenCounts();
  for (const { table } of WRITE_PLAN) {
    const count = Number(result.written?.[table]);
    if (!Number.isSafeInteger(count) || count < 0) {
      return writerFailure("csm_atomic_rpc_invalid_counts", {
        failedTable: CSM_ATOMIC_PERSISTENCE_RPC
      });
    }
    written[table] = count;
  }
  if (result.atomic !== true || (result.replayed !== true && result.session_saved !== true)) {
    return writerFailure("csm_atomic_rpc_incomplete_commit", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
  }
  return {
    ok: true,
    code: safeText(result.code) || (result.replayed ? "exact_replay" : "inserted"),
    statusCode: 200,
    skipped: null,
    replayed: result.replayed === true,
    resumed: false,
    atomic: true,
    written,
    session: { saved: true }
  };
}

async function upsert({ url, key, table, conflict, rows, fetchImpl }) {
  const payload = Array.isArray(rows) ? rows : [rows];
  if (!payload.length) return { table, written: 0 };

  const endpoint = new URL(`${url}/rest/v1/${table}`);
  endpoint.searchParams.set("on_conflict", conflict);

  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: supabaseServiceHeaders(key, {
      "content-type": "application/json",
      // Append-only facts may be replayed after a partial failure, but replay
      // must not become an UPDATE that the immutability trigger rejects.
      // Counting the payload would turn ignored duplicates into fictitious
      // inserts. PostgREST's representation is the insert receipt: an exact
      // retry returns [], a first insert returns the inserted rows.
      prefer: "resolution=ignore-duplicates,return=representation"
    }),
    redirect: "error",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The table name is in the error because "insert failed" is not
    // actionable; "csm_resolved_brackets failed with a FK violation" is.
    throw Object.assign(new Error(`${table}: ${response.status} ${detail.slice(0, 300)}`), {
      table, status: response.status
    });
  }
  const inserted = await responseRows(response, `${table}_insert`);
  if (inserted.length > payload.length) throw new Error(`${table}:insert_count_exceeds_payload`);
  return { table, written: inserted.length };
}

/**
 * Persist one card's rows.
 *
 * @param rows as produced by `buildCsmStageRows`
 * @returns { ok, skipped, written, failedTable, error } -- never throws
 */
export async function writeCsmStageRows(rows, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  readSessionState = readCsmSessionPacketState,
  claimSession = claimCsmSessionPacket,
  readExistingRows = readExistingCsmStageRows
} = {}) {
  if (!csmPersistenceEnabled(env)) {
    return { ok: true, skipped: "disabled", written: {} };
  }
  if (!isCsmPersistenceConfigured(env)) {
    // Not an error. An unconfigured environment is the normal case for local
    // evaluation runs, and failing them over shadow persistence would make the
    // measurement path depend on a database it does not use.
    return { ok: true, skipped: "unconfigured", written: {} };
  }

  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = csmServiceKey(env);
  const written = emptyWrittenCounts();
  let identity;
  let hashes;
  try {
    identity = stageRowsIdentity(rows);
    hashes = stagePacketHashes(rows);
  } catch (error) {
    return writerFailure(String(error?.message || "invalid_csm_stage_rows"), {
      statusCode: 400,
      written,
      error: String(error?.message || error)
    });
  }

  let session;
  try {
    session = await readSessionState({ ...identity, hashes, env, fetchImpl });
  } catch (error) {
    return writerFailure("csm_session_preflight_failed", {
      written,
      failedTable: "v4_recognition_sessions",
      error: String(error?.message || error)
    });
  }

  let relation = classifySessionPacket(session, hashes);
  if (relation.state === "missing") {
    return writerFailure("csm_session_not_found", {
      statusCode: 409, written, failedTable: "v4_recognition_sessions"
    });
  }
  if (relation.state === "invalid_partial_hashes") {
    return writerFailure("csm_session_hash_state_incomplete", {
      statusCode: 409, written, failedTable: "v4_recognition_sessions"
    });
  }
  if (relation.state === "conflict") {
    return writerFailure("immutable_session_conflict", {
      statusCode: 409, written, failedTable: "v4_recognition_sessions"
    });
  }
  if (relation.state === "exact_complete") {
    return {
      ok: true,
      code: "exact_replay",
      statusCode: 200,
      skipped: null,
      replayed: true,
      resumed: false,
      atomic: false,
      written
    };
  }

  if (relation.state === "unclaimed") {
    let existing;
    try {
      existing = await readExistingRows({ ...identity, hashes, env, fetchImpl });
    } catch (error) {
      return writerFailure("csm_child_preflight_failed", {
        written, error: String(error?.message || error)
      });
    }
    if ((existing || []).some((entry) => entry?.present)) {
      // Rows without an attempt marker may have been produced by the unsafe
      // transport. We cannot prove which packet they belong to, so adopting
      // them would be the same silent corruption this fence is meant to stop.
      return writerFailure("csm_unclaimed_partial_state", {
        statusCode: 409, written
      });
    }

    let claimed;
    try {
      claimed = await claimSession({ ...identity, hashes, env, fetchImpl });
    } catch (error) {
      return writerFailure("csm_session_claim_failed", {
        written,
        failedTable: "v4_recognition_sessions",
        error: String(error?.message || error)
      });
    }
    if (!claimed?.claimed) {
      // Another request won the compare-and-set. Re-read its packet before a
      // single child write: same packet may safely resume, different packet
      // is the immutable-session conflict.
      try {
        session = await readSessionState({ ...identity, hashes, env, fetchImpl });
      } catch (error) {
        return writerFailure("csm_session_claim_reread_failed", {
          written,
          failedTable: "v4_recognition_sessions",
          error: String(error?.message || error)
        });
      }
      relation = classifySessionPacket(session, hashes);
      if (relation.state === "exact_complete") {
        return {
          ok: true, code: "exact_replay", statusCode: 200, skipped: null,
          replayed: true, resumed: false, atomic: false, written
        };
      }
      if (relation.state !== "exact_incomplete") {
        return writerFailure(
          relation.state === "conflict" ? "immutable_session_conflict" : "csm_session_claim_lost",
          { statusCode: 409, written, failedTable: "v4_recognition_sessions" }
        );
      }
    }
  }

  for (const step of WRITE_PLAN) {
    const value = rows[step.key];
    if (!value) continue;
    try {
      const result = await upsert({ url, key, table: step.table, conflict: step.conflict, rows: value, fetchImpl });
      written[step.table] = result.written;
    } catch (error) {
      // Stop at the first failure rather than pressing on: every later table
      // references this one, so continuing would produce a cascade of FK
      // violations that buries the actual cause. What is already written stays
      // -- the ids are deterministic, so a retry completes the chain rather
      // than duplicating it.
      return {
        ...writerFailure("csm_stage_write_failed", {
          written, failedTable: step.table, error: error.message
        }),
        resumed: relation.state === "exact_incomplete"
      };
    }
  }

  return {
    ok: true,
    code: relation.state === "exact_incomplete" ? "exact_resume" : "inserted",
    statusCode: 200,
    skipped: null,
    replayed: false,
    resumed: relation.state === "exact_incomplete",
    atomic: false,
    written
  };
}

/**
 * Read one run's stored resolution for the inspector. COS-42.
 *
 * A pure read over facts the run already committed: no provider call, no
 * recomposition here, no write. An operator opening a card must not be able to
 * spend money or mutate a record by looking at it.
 *
 * The canonical payload comes from `csm_marketplace_outputs`, which is the row
 * that actually shipped, joined to its resolution and session so the review
 * written later can name the exact facts it reviewed.
 */
export async function readCsmResolutionRecord({
  tenantId, assetId, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const headers = supabaseServiceHeaders(csmServiceKey(env));
  const readRows = async (endpoint, context) => {
    const response = await fetchImpl(endpoint.toString(), { headers, redirect: "error" });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${context}:${response.status} ${detail.slice(0, 180)}`);
    }
    return responseRows(response, context);
  };

  // Two hops, because the CSM stage tables are keyed on the recognition
  // session and carry no `asset_id` at all. The first version of this queried
  // `csm_marketplace_outputs` by `asset_id` and selected `canonical_payload`,
  // `identity_resolution_id` and `resolver_version` -- four names that do not
  // exist on that table, so the Glass Box read answered 400 for every card.
  // The unit tests stubbed this function, so nothing caught it until the
  // columns were compared against the live schema.
  //
  //   v4_recognition_sessions   asset_id -> session id
  //   csm_marketplace_outputs   session  -> structured_output, resolution_id
  //   csm_identity_resolutions  resolution -> resolver_version
  const sessionEndpoint = new URL(`${url}/rest/v1/v4_recognition_sessions`);
  sessionEndpoint.searchParams.set("select", "id,asset_id,created_at");
  sessionEndpoint.searchParams.set("asset_id", `eq.${assetId}`);
  sessionEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  sessionEndpoint.searchParams.set("order", "created_at.desc");
  sessionEndpoint.searchParams.set("limit", "1");
  const session = (await readRows(sessionEndpoint, "csm_resolution_session_read"))[0];
  if (!session?.id) return null;

  const outputEndpoint = new URL(`${url}/rest/v1/csm_marketplace_outputs`);
  outputEndpoint.searchParams.set("select", [
    "id", "tenant_id", "recognition_session_id", "resolution_id",
    "structured_output", "title", "composer_version", "created_at",
    // `replayFromRows` dispatches the composer on all three of these and
    // refuses to guess. Omitting them threw `unsupported_replay_version` for
    // every card -- a correct refusal to replay a run whose composer identity
    // is unknown, but the identity is right there in the row.
    "marketplace", "marketplace_profile_version", "contract_version"
  ].join(","));
  outputEndpoint.searchParams.set("recognition_session_id", `eq.${session.id}`);
  outputEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  outputEndpoint.searchParams.set("order", "created_at.desc");
  outputEndpoint.searchParams.set("limit", "1");
  const row = (await readRows(outputEndpoint, "csm_resolution_read"))[0];
  if (!row) return null;

  // `resolver_version` lives on the resolution, not the output. Missing it is
  // not fatal -- the view stamps a fallback -- so one failed hop must not deny
  // the operator the trace.
  // `grammar` as well as `resolver_version`: the replay cross-checks the
  // stored composition grammar against the identity's own, and refuses rather
  // than guess when they disagree. Without the row it saw `undefined/standard`
  // and refused every card.
  let resolution = null;
  if (row.resolution_id) {
    const resolutionEndpoint = new URL(`${url}/rest/v1/csm_identity_resolutions`);
    resolutionEndpoint.searchParams.set("select", "id,resolver_version,grammar,contract_version,revision");
    resolutionEndpoint.searchParams.set("id", `eq.${row.resolution_id}`);
    resolutionEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
    resolutionEndpoint.searchParams.set("limit", "1");
    try {
      resolution = (await readRows(resolutionEndpoint, "csm_resolution_version_read"))[0] || null;
    } catch { resolution = null; }
  }
  const resolverVersion = resolution?.resolver_version || "";

  // The resolved brackets, because `structured_output` is the CSM EMIT shape
  // (`sem`, `print_finish_layers`, `composition_grammar`) and not the flat
  // canonical fields object. Feeding it to `parseCanonicalFields` returns a
  // near-empty result -- the Glass Box would show an operator a blank trace for
  // a card that resolved perfectly well. `replayFromRows` is the reverse
  // mapping that already exists, and it needs both halves.
  const bracketEndpoint = new URL(`${url}/rest/v1/csm_resolved_brackets`);
  bracketEndpoint.searchParams.set("select", [
    "bracket", "selected_kind", "canonical_value", "empty_reason",
    "selected_candidate_id", "rationale_codes", "semantic_confidence"
  ].join(","));
  bracketEndpoint.searchParams.set("resolution_id", `eq.${row.resolution_id}`);
  bracketEndpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  let resolved = [];
  try {
    resolved = await readRows(bracketEndpoint, "csm_resolved_brackets_read");
  } catch { resolved = []; }

  return {
    asset_id: session.asset_id,
    recognition_session_id: row.recognition_session_id,
    resolution_id: row.resolution_id,
    output_id: row.id,
    canonical_payload: row.structured_output,
    output_title: row.title,
    resolver_version: resolverVersion || THIN_RESOLVER_VERSION,
    composer_version: row.composer_version || THIN_COMPOSER_VERSION,
    // The bundle `replayFromRows` consumes, in its own shape.
    replay_rows: { output: row, resolved, resolution }
  };
}

/**
 * Append one review. Never an update.
 *
 * A correction that overwrote the resolution it corrects would destroy the only
 * record of what the model actually did, and every accuracy number derived
 * afterwards would be measuring a human-edited past. The insert therefore has
 * no conflict target: a repeated revision is a new row, and
 * `revision_sha256` is what lets a reader tell a replay from a fresh decision.
 */
export async function appendCsmResolutionReview({
  tenantId, review, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const endpoint = new URL(`${url}/rest/v1/csm_resolution_reviews`);
  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      ...supabaseServiceHeaders(csmServiceKey(env)),
      "content-type": "application/json",
      prefer: "return=representation"
    },
    redirect: "error",
    body: JSON.stringify([{ ...review, tenant_id: tenantId }])
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_review_append:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_review_append");
  return rows[0] || null;
}
