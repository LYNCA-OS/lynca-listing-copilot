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
import { computeCsmPacketHashes, THIN_REGISTRY_RELEASE_ID } from "./csm-persistence.mjs";

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

/**
 * Shadow persistence is OFF unless explicitly enabled.
 *
 * The rows are a shadow of a path that is not yet the production path, and a
 * shadow writer that turns itself on because credentials happen to be present
 * is how a feature branch writes to production. COS-25's own guardrail --
 * "do not deploy from a feature branch or dirty tree" -- is about deployment,
 * but the same reasoning applies to writes.
 */
export function csmShadowPersistenceEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.CSM_SHADOW_PERSISTENCE_ENABLED || "").trim().toLowerCase()
  );
}

/** Cost guard: verify the migration and Registry seed before paying the model. */
export async function checkCsmPersistenceReadiness({
  env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  if (!csmShadowPersistenceEnabled(env)) return { ready: false, reason: "disabled" };
  if (!isCsmPersistenceConfigured(env)) return { ready: false, reason: "unconfigured" };
  const endpoint = new URL(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/csm_registry_releases`);
  endpoint.searchParams.set("select", "id,registry_version,content_sha256,sem_standard_version,registry_payload");
  endpoint.searchParams.set("id", `eq.${THIN_REGISTRY_RELEASE_ID}`);
  endpoint.searchParams.set("limit", "1");
  let lastReason = "schema_probe_failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint.toString(), {
        headers: supabaseServiceHeaders(csmServiceKey(env))
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
        const rpcResponse = await fetchImpl(
          `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${CSM_ATOMIC_PERSISTENCE_RPC}`,
          {
            method: "POST",
            headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
            body: JSON.stringify({
              p_tenant_id: "",
              p_recognition_session_id: "",
              p_packet: {},
              p_session_patch: {}
            })
          }
        );
        if (!rpcResponse.ok) return { ready: false, reason: `atomic_rpc_probe_${rpcResponse.status}` };
        const probe = await rpcResponse.json().catch(() => null);
        return probe?.code === "missing_csm_stage_row_identity"
          ? { ready: true, reason: null }
          : { ready: false, reason: "atomic_rpc_probe_contract_mismatch" };
      }
    } catch (error) {
      lastReason = `schema_probe_failed:${String(error?.message || error).slice(0, 120)}`;
      if (attempt === 2) return { ready: false, reason: lastReason };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
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
    headers: supabaseServiceHeaders(csmServiceKey(env))
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
      headers: supabaseServiceHeaders(csmServiceKey(env))
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
  fetchImpl = globalThis.fetch
} = {}) {
  if (!csmShadowPersistenceEnabled(env)) {
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
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: supabaseServiceHeaders(csmServiceKey(env), { "content-type": "application/json" }),
      body: JSON.stringify({
        p_tenant_id: identity.tenantId,
        p_recognition_session_id: identity.recognitionSessionId,
        p_packet: rows,
        p_session_patch: sessionPatch
      })
    });
  } catch (error) {
    return writerFailure("csm_atomic_rpc_failed", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC,
      error: String(error?.message || error)
    });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return writerFailure("csm_atomic_rpc_failed", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC,
      error: `${response.status} ${detail.slice(0, 240)}`
    });
  }

  let result;
  try {
    const text = await response.text();
    const parsed = JSON.parse(text);
    result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  } catch {
    return writerFailure("csm_atomic_rpc_invalid_response", {
      failedTable: CSM_ATOMIC_PERSISTENCE_RPC
    });
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
  if (!csmShadowPersistenceEnabled(env)) {
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
  const endpoint = new URL(`${url}/rest/v1/csm_marketplace_outputs`);
  endpoint.searchParams.set("select", [
    "id", "tenant_id", "asset_id", "recognition_session_id", "identity_resolution_id",
    "canonical_payload", "title", "resolver_version", "composer_version", "created_at"
  ].join(","));
  endpoint.searchParams.set("asset_id", `eq.${assetId}`);
  endpoint.searchParams.set("tenant_id", `eq.${tenantId}`);
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", "1");
  const response = await fetchImpl(endpoint.toString(), {
    headers: supabaseServiceHeaders(csmServiceKey(env))
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_resolution_read:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_resolution_read");
  const row = rows[0];
  if (!row) return null;
  return {
    asset_id: row.asset_id,
    recognition_session_id: row.recognition_session_id,
    resolution_id: row.identity_resolution_id,
    output_id: row.id,
    canonical_payload: row.canonical_payload,
    output_title: row.title,
    resolver_version: row.resolver_version || THIN_RESOLVER_VERSION,
    composer_version: row.composer_version || THIN_COMPOSER_VERSION
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
    body: JSON.stringify([{ ...review, tenant_id: tenantId }])
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`csm_review_append:${response.status} ${detail.slice(0, 180)}`);
  }
  const rows = await responseRows(response, "csm_review_append");
  return rows[0] || null;
}
