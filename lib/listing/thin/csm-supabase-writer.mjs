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
//   * idempotency -- every id is a sha256 of its own content, so a replayed
//     run writes the same ids and upserts rather than duplicating. A retry
//     after a partial failure is safe and does not need a cleanup path.
//
//   * traceability -- rows go in FK order, so a reader never sees a resolved
//     bracket whose candidate is missing.
//
//   * failure preservation -- a failed write returns which table failed and
//     why; it does not throw into the caller. COS-26 requires one card's
//     failure not to break the rest of a batch, and a throw here would do
//     exactly that.

import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";

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

export function isCsmPersistenceConfigured(env = process.env) {
  return Boolean(String(env.SUPABASE_URL || "").trim() && env.SUPABASE_SERVICE_ROLE_KEY);
}

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

async function upsert({ url, key, table, conflict, rows, fetchImpl }) {
  const payload = Array.isArray(rows) ? rows : [rows];
  if (!payload.length) return { table, written: 0 };

  const endpoint = new URL(`${url}/rest/v1/${table}`);
  endpoint.searchParams.set("on_conflict", conflict);

  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: supabaseServiceHeaders(key, {
      "content-type": "application/json",
      // merge-duplicates is what makes the content-derived ids useful: a
      // re-run of the same card updates in place instead of colliding.
      // `return=minimal` keeps the response body empty -- we already know what
      // we wrote, and echoing every row back doubles the transfer.
      prefer: "resolution=merge-duplicates,return=minimal"
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
  return { table, written: payload.length };
}

/**
 * Persist one card's rows.
 *
 * @param rows as produced by `buildCsmStageRows`
 * @returns { ok, skipped, written, failedTable, error } -- never throws
 */
export async function writeCsmStageRows(rows, {
  env = process.env, fetchImpl = globalThis.fetch
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
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const written = {};

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
        ok: false, skipped: null, written,
        failedTable: step.table, error: error.message
      };
    }
  }

  return { ok: true, skipped: null, written };
}
