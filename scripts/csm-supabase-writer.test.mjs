#!/usr/bin/env node
// The writer is tested against a fake fetch, not a database.
//
// What can go wrong here is ordering, idempotency and failure containment --
// all three are observable from the requests it makes. A test that needed a
// live Supabase project would test the network instead, and would not run in
// CI, which is the same as not existing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCsmStageRows } from "../lib/listing/thin/csm-persistence.mjs";
import {
  writeCsmStageRows, csmShadowPersistenceEnabled, isCsmPersistenceConfigured
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const FIELDS = {
  grammar: "standard", year: "2023", manufacturer: "Panini", product: "Prizm",
  subjects: ["Victor Wembanyama"], card_number: "136", serial: "25/49",
  surface_color: "Gold", parallel_family: "Prizm", parallel_exact: "",
  grade: "PSA 10", components: ["RC"], attributes: ["RC"], team: "Spurs",
  unreadable: [], low_confidence: [], lot_count: "", ip: "", language: ""
};

const composed = composeFromCanonicalFields(FIELDS);
const rows = buildCsmStageRows({
  tenantId: "tenant-1", recognitionSessionId: "session-1",
  fields: FIELDS, composed, title: composed.title, createdAt: "2026-08-01T00:00:00Z"
});

const ENV = { SUPABASE_URL: "https://example.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x", CSM_SHADOW_PERSISTENCE_ENABLED: "1" };

function recorder({ failOn = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (failOn && url.includes(failOn)) {
      return { ok: false, status: 409, text: async () => "duplicate key value violates unique constraint" };
    }
    return { ok: true, status: 201, text: async () => "" };
  };
  return { calls, fetchImpl };
}

// 1. FK order. csm_candidate_evidence_links must follow both of its parents,
//    and csm_resolved_brackets must follow the resolution it belongs to.
{
  const { calls, fetchImpl } = recorder();
  const result = await writeCsmStageRows(rows, { env: ENV, fetchImpl });
  assert.equal(result.ok, true);
  const tables = calls.map((call) => new URL(call.url).pathname.split("/").pop());
  assert.deepEqual(tables, [
    "csm_evidence_observations", "csm_bracket_candidates", "csm_candidate_evidence_links",
    "csm_identity_resolutions", "csm_resolved_brackets", "csm_marketplace_outputs"
  ]);
  assert.ok(tables.indexOf("csm_candidate_evidence_links") > tables.indexOf("csm_evidence_observations"));
  assert.ok(tables.indexOf("csm_resolved_brackets") > tables.indexOf("csm_identity_resolutions"));
}

// 2. Idempotency is requested on every call, and the conflict target matches
//    the table's actual key -- the two composite-key tables do not have `id`.
{
  const { calls, fetchImpl } = recorder();
  await writeCsmStageRows(rows, { env: ENV, fetchImpl });
  for (const call of calls) {
    assert.match(call.init.headers.prefer, /merge-duplicates/);
    assert.ok(new URL(call.url).searchParams.get("on_conflict"));
  }
  const byTable = Object.fromEntries(calls.map((call) => [
    new URL(call.url).pathname.split("/").pop(),
    new URL(call.url).searchParams.get("on_conflict")
  ]));

  // Asserted against the MIGRATION, not against the writer's own constants.
  // Checking `on_conflict` equals the string the writer sends is circular and
  // would pass with both of them wrong; the database is the authority on what
  // the key is, and a wrong key surfaces as a duplicate-row bug, not an error.
  const sql = readFileSync(
    new URL("../supabase/migrations/20260728190000_csm_stage_shadow_foundation_v1.sql", import.meta.url), "utf8");
  const primaryKeyOf = (table) => {
    const body = sql.slice(sql.indexOf(`create table if not exists public.${table}`));
    const composite = body.slice(0, body.indexOf("\n);")).match(/\n\s*primary key \(([^)]+)\)/);
    if (composite) return composite[1].split(",").map((part) => part.trim()).join(",");
    return body.slice(0, body.indexOf("\n);")).match(/\n\s*([a-z_]+) [a-z ]*primary key/)?.[1] || "";
  };
  for (const [table, conflict] of Object.entries(byTable)) {
    assert.equal(conflict, primaryKeyOf(table), `${table}: on_conflict must match the migration's primary key`);
  }
}

// 3. Replaying the same card produces byte-identical bodies. This is what makes
//    a retry safe: the ids are derived from content, so the second write is an
//    update of the same rows rather than a second copy of the card.
{
  const a = recorder(); await writeCsmStageRows(rows, { env: ENV, fetchImpl: a.fetchImpl });
  const again = buildCsmStageRows({
    tenantId: "tenant-1", recognitionSessionId: "session-1",
    fields: FIELDS, composed, title: composed.title, createdAt: "2026-08-01T00:00:00Z"
  });
  const b = recorder(); await writeCsmStageRows(again, { env: ENV, fetchImpl: b.fetchImpl });
  assert.deepEqual(a.calls.map((c) => c.init.body), b.calls.map((c) => c.init.body));
}

// 4. Failure containment: it stops at the failing table, reports which one,
//    keeps what was already written, and does NOT throw -- a throw would take
//    down the rest of a batch, which COS-26 forbids.
{
  const { calls, fetchImpl } = recorder({ failOn: "csm_identity_resolutions" });
  const result = await writeCsmStageRows(rows, { env: ENV, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.failedTable, "csm_identity_resolutions");
  assert.match(result.error, /409/);
  assert.ok(result.written.csm_evidence_observations > 0, "earlier tables stay written");
  // Nothing downstream of the failure was attempted.
  const tables = calls.map((call) => new URL(call.url).pathname.split("/").pop());
  assert.equal(tables.includes("csm_resolved_brackets"), false);
  assert.equal(tables.includes("csm_marketplace_outputs"), false);
}

// 5. Off by default, and an unconfigured environment is a skip rather than a
//    failure -- local evaluation runs must not depend on a database they do
//    not use.
{
  assert.equal(csmShadowPersistenceEnabled({}), false);
  const off = recorder();
  const disabled = await writeCsmStageRows(rows, { env: { ...ENV, CSM_SHADOW_PERSISTENCE_ENABLED: "" }, fetchImpl: off.fetchImpl });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.skipped, "disabled");
  assert.equal(off.calls.length, 0, "disabled must make no network calls");

  const bare = recorder();
  const unconfigured = await writeCsmStageRows(rows, { env: { CSM_SHADOW_PERSISTENCE_ENABLED: "1" }, fetchImpl: bare.fetchImpl });
  assert.equal(unconfigured.ok, true);
  assert.equal(unconfigured.skipped, "unconfigured");
  assert.equal(bare.calls.length, 0);
  assert.equal(isCsmPersistenceConfigured({}), false);
}

process.stdout.write("csm supabase writer: ok\n");
