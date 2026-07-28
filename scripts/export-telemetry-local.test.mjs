import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  defaultSupabaseUrl,
  exportTable,
  nextPace,
  pacingCeilingMs,
  pacingFloorMs,
  reconcileCommittedFiles,
  telemetryExportContractVersion,
  telemetryTables,
  verifyExport,
  waitForStableDatabase
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
    project_url: defaultSupabaseUrl,
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
      fetchImpl: fixtureFetch,
      paced: false
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

// A gateway 504 is the failure that killed two attempts outright. The retry has
// to shrink the page, and -- the part that shipped broken once -- the loop must
// decide whether a page was the last one by comparing against what the
// SUCCESSFUL attempt requested, not the original page size. Getting that wrong
// ended an export at 1,262 of 6,581 rows and reported success.
test("a shrunken retry does not read as a short final page", async () => {
  const dest = await mkdtemp(resolve(tmpdir(), "lynca-telemetry-retry-"));
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: String(i + 1).padStart(3, "0"),
    created_at: "2026-07-28T01:00:00.000Z"
  }));
  let firstReadFailed = false;
  const flakyFetch = (url, init = {}) => {
    const query = new URL(url).searchParams;
    if (query.get("order") === "created_at.desc") return Promise.resolve(jsonResponse([{ created_at: cutoff }]));
    if (String(init.headers?.Prefer || "").includes("count=exact")) {
      return Promise.resolve(jsonResponse([rows[0]], { headers: { "Content-Range": `0-0/${rows.length}` } }));
    }
    if (!firstReadFailed) {
      firstReadFailed = true;
      return Promise.resolve(new Response("gateway timeout", { status: 504 }));
    }
    const after = String(query.get("id") || "").replace(/^gt\./, "");
    const limit = Number(query.get("limit") || 500);
    return Promise.resolve(jsonResponse(rows.filter((row) => row.id > after).slice(0, limit)));
  };

  try {
    const result = await exportTable("service-role-test", {
      table: "request_logs", timeColumn: "created_at", keyColumn: "id"
    }, { dest, pageSize: 4, fetchImpl: flakyFetch, paced: false });
    assert.equal(firstReadFailed, true, "the fixture must have exercised the retry");
    assert.equal(result.rows, 6, "every row survives a mid-export gateway failure");
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test("the stability preflight refuses an origin that is not steady", async () => {
  const downFetch = () => Promise.resolve(new Response("origin down", { status: 521 }));
  const down = await waitForStableDatabase("service-role-test", {
    probes: 4, spacingMs: 1, fetchImpl: downFetch, log: () => {}
  });
  assert.equal(down.stable, false);
  assert.equal(down.failedProbe, 1, "it must give up on the first bad probe, not average them");

  let probes = 0;
  const upFetch = () => { probes += 1; return Promise.resolve(jsonResponse([])); };
  const up = await waitForStableDatabase("service-role-test", {
    probes: 3, spacingMs: 1, fetchImpl: upFetch, log: () => {}
  });
  assert.equal(up.stable, true);
  assert.equal(probes, 3, "a healthy origin is probed the full number of times");

  // Slow but successful is still not ready: latency is the signal that the
  // instance is still recovering, which is precisely when the bulk read hurts.
  const slowFetch = () => new Promise((r) => setTimeout(() => r(jsonResponse([])), 40));
  const slow = await waitForStableDatabase("service-role-test", {
    probes: 2, spacingMs: 1, maxLatencyMs: 5, fetchImpl: slowFetch, log: () => {}
  });
  assert.equal(slow.stable, false);
});

test("pacing widens under load and relaxes when the server is quick", () => {
  assert.equal(nextPace(pacingFloorMs, 5_000), 500, "a slow page doubles the delay");
  assert.equal(nextPace(4_000, 9_000), pacingCeilingMs, "backoff is capped");
  assert.equal(nextPace(pacingFloorMs, 300), pacingFloorMs, "a fast page holds at the floor");
  assert.equal(nextPace(1_000, 300), 800, "a fast page decays toward the floor");
});

test("the heaviest table is exported last", () => {
  const names = telemetryTables.map(({ table }) => table);
  assert.equal(names.at(-1), "v4_recognition_sessions",
    "227 MB at ~35 KB a row is where both failed attempts died; prove the run on a cheap table first");
  assert.equal(names[0], "request_logs");
});

console.log("telemetry export safety tests passed");
