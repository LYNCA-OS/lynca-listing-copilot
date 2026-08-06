import assert from "node:assert/strict";
// `resolveSupabaseUrl` is deliberately lazy and has NO default -- "nothing can
// be silently pointed at a project nobody chose". That makes the URL an input
// to this test rather than an ambient fact, so it is set here instead of being
// inherited from whoever happens to be running. Without this the suite passes
// on a developer machine with credentials loaded and fails on a runner.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";

import { appendFile, mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  resolveSupabaseUrl,
  exportTable,
  reconcileCommittedFiles,
  telemetryExportContractVersion,
  telemetryTables,
  verifyExport
} from "./export-telemetry-local.mjs";
import { verifyReclaimGate } from "./reclaim-database-disk.mjs";

const cutoff = "2026-07-28T10:00:00.000Z";
const fixtureRows = [
  { id: "001", created_at: "2026-07-27T01:00:00.000Z", payload: { n: 1 } },
  { id: "002", created_at: "2026-07-28T01:00:00.000Z", payload: { n: 2 } },
  { id: "003", created_at: "2026-07-28T02:00:00.000Z", payload: { n: 3 } }
];

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function fixtureFetch(url, init = {}) {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  if (query.get("order") === "created_at.desc") return Promise.resolve(jsonResponse([{ created_at: cutoff }]));
  if (String(init.headers?.Prefer || "").includes("count=exact")) {
    return Promise.resolve(jsonResponse([fixtureRows[0]], { headers: { "Content-Range": `0-0/${fixtureRows.length}` } }));
  }
  const after = String(query.get("id") || "").replace(/^gt\./, "");
  const limit = Number(query.get("limit") || 500);
  return Promise.resolve(jsonResponse(fixtureRows.filter((row) => row.id > after).slice(0, limit)));
}

async function writeEmptyManifest(dest, { table, timeColumn, keyColumn }) {
  const tableDir = resolve(dest, table);
  await mkdir(tableDir, { recursive: true });
  await writeFile(resolve(tableDir, "manifest.json"), `${JSON.stringify({
    schema_version: telemetryExportContractVersion,
    project_url: resolveSupabaseUrl(),
    table,
    time_column: timeColumn,
    key_column: keyColumn,
    snapshot_cutoff: cutoff,
    expected_row_count: 0,
    exported_row_count: 0,
    cursor_id: "",
    page_count: 0,
    files: {},
    complete: true,
    created_at: cutoff,
    completed_at: cutoff
  })}\n`);
}

test("export is page-bounded, daily, verified, and resumable from committed bytes", async () => {
  const dest = await mkdtemp(resolve(tmpdir(), "lynca-telemetry-export-"));
  try {
    const descriptor = { table: "request_logs", timeColumn: "created_at", keyColumn: "id" };
    const result = await exportTable("service-role-test", descriptor, {
      dest,
      pageSize: 2,
      fetchImpl: fixtureFetch
    });
    assert.equal(result.rows, 3);
    assert.deepEqual(Object.keys(result.files), ["2026-07-27", "2026-07-28"]);

    const tableDir = resolve(dest, descriptor.table);
    const manifestPath = resolve(tableDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.complete, true);
    assert.equal(manifest.page_count, 2);
    assert.equal(manifest.cursor_id, "003");
    assert.equal(manifest.expected_row_count, 3);
    assert.equal(manifest.exported_row_count, 3);
    assert.match(manifest.files["2026-07-28"].sha256, /^[a-f0-9]{64}$/);

    const dayPath = resolve(tableDir, "2026-07-28.jsonl");
    const committedBytes = manifest.files["2026-07-28"].bytes;
    await appendFile(dayPath, `${JSON.stringify({ id: "uncommitted" })}\n`);
    assert.ok((await stat(dayPath)).size > committedBytes);
    await reconcileCommittedFiles(tableDir, manifest);
    assert.equal((await stat(dayPath)).size, committedBytes);

    await truncate(dayPath, committedBytes - 1);
    await assert.rejects(() => reconcileCommittedFiles(tableDir, manifest), /shorter than committed checkpoint/);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test("reclaim gate re-verifies all six exported tables and rejects a saved digest drift", async () => {
  const dest = await mkdtemp(resolve(tmpdir(), "lynca-telemetry-gate-"));
  try {
    for (const descriptor of telemetryTables) await writeEmptyManifest(dest, descriptor);
    const report = await verifyExport(dest);
    const reportPath = resolve(dest, "export-verification.json");
    assert.equal((await verifyReclaimGate(reportPath)).sha256, report.sha256);

    const tampered = JSON.parse(await readFile(reportPath, "utf8"));
    tampered.sha256 = "0".repeat(64);
    await writeFile(reportPath, `${JSON.stringify(tampered)}\n`);
    await assert.rejects(() => verifyReclaimGate(reportPath), /digest changed/);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

console.log("telemetry export safety tests passed");
