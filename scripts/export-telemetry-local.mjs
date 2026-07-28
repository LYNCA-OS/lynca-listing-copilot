#!/usr/bin/env node
// Export production evaluation telemetry to a bounded, resumable local
// snapshot before any irreversible database reclaim.
//
//   node scripts/export-telemetry-local.mjs
//   node scripts/export-telemetry-local.mjs --apply --dest ~/lynca-telemetry
//   node scripts/export-telemetry-local.mjs --verify --dest ~/lynca-telemetry
//
// Rows are appended to one JSONL file per table/day. After every fetched page,
// file byte offsets and the primary-key cursor are committed atomically. If a
// process dies after appending but before the checkpoint, the next run truncates
// only the uncommitted local tail and re-fetches that page. The database is
// never mutated by this script.
//
// An earlier export took the database down. It read at full speed -- no delay
// between pages, no retry -- against an instance that had just finished a
// forty-minute WAL replay with every cache cold, and it opened with the single
// heaviest table. The gateway went 504, then 521, then 522. Reading 750 MB is
// not a safe operation just because it is a read, so three things are load
// discipline rather than correctness, and none of them are optional:
//
//   * pace     -- a delay between pages, widened when the server answers slowly.
//   * retry    -- a 504 is the gateway giving up on a large page, not a dead
//                 database. Shrink and back off instead of failing the table.
//   * order    -- lightest table first, so the run is proved on something cheap
//                 before the 227 MB table is touched.
//
// Correctness (frozen snapshot cutoff, atomic manifest checkpoints, per-file
// sha256, exact-count gating) is unchanged: the reclaim step is irreversible and
// an export that reports success while short is the failure mode that matters.

import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  truncate,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import readline from "node:readline";

export const telemetryExportContractVersion = "telemetry-export-snapshot-v2";
export const telemetryVerificationContractVersion = "telemetry-export-verification-v1";
export const defaultSupabaseUrl = "https://osrrujmpxxiefppjfgpd.supabase.co";
export const defaultPageSize = 500;

// Pace, not throughput. The export is never urgent; the database serving
// listers is. A page that comes back slowly is the server asking for room, so
// the delay tracks observed latency instead of staying fixed.
export const pacingFloorMs = 250;
export const pacingCeilingMs = 5_000;
export const slowPageMs = 2_000;

// Ordered lightest-first by total table size. The previous order opened with
// v4_recognition_sessions -- 227 MB at ~35 KB a row -- and that is where both
// failed attempts died. Row-weight also sets the page size: 500 sessions is a
// 17 MB response and times out, while 500 request_logs rows is small.
export const telemetryTables = Object.freeze([
  { table: "request_logs", timeColumn: "timestamp", keyColumn: "id", pageSize: 500 },
  { table: "v4_candidate_traces", timeColumn: "created_at", keyColumn: "id", pageSize: 50 },
  { table: "recognition_workflow_events", timeColumn: "created_at", keyColumn: "event_id", pageSize: 100 },
  { table: "vector_query_logs", timeColumn: "generated_at", keyColumn: "query_log_id", pageSize: 200 },
  { table: "v4_production_quality_ledger", timeColumn: "created_at", keyColumn: "id", pageSize: 200 },
  { table: "v4_recognition_sessions", timeColumn: "created_at", keyColumn: "id", pageSize: 25 }
]);

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function expandHome(path) {
  return path.startsWith("~")
    ? resolve(homedir(), path.slice(1).replace(/^\/+/, ""))
    : resolve(path);
}

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

function encodedFilter(value) {
  return encodeURIComponent(cleanText(value));
}

function contentRangeCount(value) {
  const total = cleanText(value).split("/")[1];
  if (total === "*" || total === undefined) return null;
  const parsed = Number(total);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

// How long to wait before the next page. A page slower than slowPageMs is the
// server under strain, and the answer to strain is to back off rather than keep
// the same cadence and hope.
export function nextPace(currentMs, elapsedMs) {
  if (elapsedMs > slowPageMs) return Math.min(pacingCeilingMs, Math.round(currentMs * 2) || pacingFloorMs);
  return Math.max(pacingFloorMs, Math.round(currentMs * 0.8));
}

// Do not start a heavy read against an instance that has merely stopped
// erroring. Both failed attempts began seconds after a single 200 came back,
// while the database was still recovering, and the export finished the job.
// Require several consecutive fast responses spread over time instead.
export async function waitForStableDatabase(key, {
  probes = 4,
  spacingMs = 15_000,
  maxLatencyMs = 3_000,
  supabaseUrl = defaultSupabaseUrl,
  fetchImpl = fetch,
  log = console.log
} = {}) {
  for (let attempt = 1; attempt <= probes; attempt += 1) {
    const started = Date.now();
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/catalog_sources?select=id&limit=1`, {
      headers: headers(key)
    }).catch((error) => ({ ok: false, status: String(error?.name || "fetch_failed") }));
    const elapsed = Date.now() - started;
    const healthy = Boolean(response.ok) && elapsed <= maxLatencyMs;
    log(`  probe ${attempt}/${probes}  ${response.ok ? 200 : response.status}  ${elapsed}ms  ${healthy ? "ok" : "NOT READY"}`);
    if (!healthy) return { stable: false, failedProbe: attempt, status: response.status ?? null, elapsed };
    if (attempt < probes) await sleep(spacingMs);
  }
  return { stable: true };
}

export async function snapshotCutoff(key, table, timeColumn = "created_at", {
  fetchImpl = fetch,
  supabaseUrl = defaultSupabaseUrl
} = {}) {
  const url = `${supabaseUrl}/rest/v1/${table}?select=${timeColumn}&order=${timeColumn}.desc&limit=1`;
  const response = await fetchImpl(url, { headers: headers(key) });
  if (!response.ok) throw new Error(`${table} cutoff http_${response.status}: ${(await response.text()).slice(0, 160)}`);
  const rows = await response.json();
  return cleanText(rows[0]?.[timeColumn]) || new Date(0).toISOString();
}

export async function tableCount(key, table, {
  cutoff = "",
  timeColumn = "created_at",
  keyColumn = "id",
  fetchImpl = fetch,
  supabaseUrl = defaultSupabaseUrl
} = {}) {
  const filter = cutoff ? `&${timeColumn}=lte.${encodedFilter(cutoff)}` : "";
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?select=${keyColumn}${filter}`, {
    headers: headers(key, { Prefer: "count=exact", Range: "0-0" })
  });
  if (!response.ok) throw new Error(`${table} count http_${response.status}: ${(await response.text()).slice(0, 160)}`);
  const count = contentRangeCount(response.headers.get("content-range"));
  if (count === null) throw new Error(`${table} exact count missing`);
  return count;
}

export async function* pageRows(key, table, {
  pageSize = defaultPageSize,
  after = "",
  cutoff = "",
  timeColumn = "created_at",
  keyColumn = "id",
  fetchImpl = fetch,
  supabaseUrl = defaultSupabaseUrl,
  attempts = 5,
  paced = true
} = {}) {
  let cursor = cleanText(after);
  let pace = pacingFloorMs;
  for (;;) {
    const cursorFilter = cursor ? `&${keyColumn}=gt.${encodedFilter(cursor)}` : "";
    const cutoffFilter = cutoff ? `&${timeColumn}=lte.${encodedFilter(cutoff)}` : "";
    const base = `${supabaseUrl}/rest/v1/${table}?select=*${cursorFilter}${cutoffFilter}&order=${keyColumn}.asc`;
    const started = Date.now();

    // `requested` is what the successful attempt actually asked for. Comparing
    // the returned count against the ORIGINAL pageSize is how a shrunken retry
    // looks like a short final page and silently ends the export -- that bug
    // shipped once and reported success at 1,262 of 6,581 rows.
    let response = null;
    let requested = pageSize;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // Shrink, never grow: a floor of 5 applied with Math.max raised the
      // request ABOVE pageSize whenever the page was smaller than 5, which is
      // the opposite of backing off.
      requested = Math.min(pageSize, Math.max(1, Math.floor(pageSize / attempt)));
      response = await fetchImpl(`${base}&limit=${requested}`, { headers: headers(key) })
        .catch((error) => ({ ok: false, status: String(error?.name || "fetch_failed"), text: async () => "" }));
      if (response.ok) break;
      if (attempt === attempts) {
        throw new Error(`${table} read http_${response.status}: ${(await response.text()).slice(0, 160)}`);
      }
      // A 521/522 is Cloudflare reporting the origin is down; retrying every
      // half second is how a struggling instance is kept struggling.
      await sleep(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
    }

    const rows = await response.json();
    if (!rows.length) return;
    for (const row of rows) {
      if (!cleanText(row?.[keyColumn])) throw new Error(`${table} row missing primary key ${keyColumn}`);
    }
    pace = nextPace(pace, Date.now() - started);
    yield rows;
    cursor = cleanText(rows.at(-1)[keyColumn]);
    if (rows.length < requested) return;
    if (paced) await sleep(pace);
  }
}

export function groupByDay(rows = [], timeColumn = "created_at") {
  const days = new Map();
  for (const row of rows) {
    const raw = cleanText(row?.[timeColumn]).slice(0, 10);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "undated";
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(row);
  }
  return days;
}

async function pathSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temp, "wx");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function newManifest({ table, timeColumn, keyColumn, cutoff, expectedCount, supabaseUrl }) {
  return {
    schema_version: telemetryExportContractVersion,
    project_url: supabaseUrl,
    table,
    time_column: timeColumn,
    key_column: keyColumn,
    snapshot_cutoff: cutoff,
    expected_row_count: expectedCount,
    exported_row_count: 0,
    cursor_id: "",
    page_count: 0,
    files: {},
    complete: expectedCount === 0,
    created_at: new Date().toISOString(),
    completed_at: expectedCount === 0 ? new Date().toISOString() : null
  };
}

function assertManifest(manifest, { table, timeColumn, keyColumn, supabaseUrl }) {
  if (manifest?.schema_version !== telemetryExportContractVersion) throw new Error(`${table} manifest version mismatch`);
  if (manifest.table !== table || manifest.time_column !== timeColumn || manifest.key_column !== keyColumn) {
    throw new Error(`${table} manifest identity mismatch`);
  }
  if (manifest.project_url !== supabaseUrl) throw new Error(`${table} manifest project mismatch`);
  if (!Number.isSafeInteger(manifest.expected_row_count) || manifest.expected_row_count < 0) {
    throw new Error(`${table} manifest expected count invalid`);
  }
  if (!Number.isSafeInteger(manifest.exported_row_count) || manifest.exported_row_count < 0) {
    throw new Error(`${table} manifest exported count invalid`);
  }
}

export async function reconcileCommittedFiles(tableDir, manifest) {
  for (const [day, file] of Object.entries(manifest.files || {})) {
    const path = resolve(tableDir, `${day}.jsonl`);
    const actual = await pathSize(path);
    if (actual === null && file.bytes === 0) continue;
    if (actual === null) throw new Error(`${manifest.table}/${day} committed file missing`);
    if (actual < file.bytes) throw new Error(`${manifest.table}/${day} shorter than committed checkpoint`);
    if (actual > file.bytes) await truncate(path, file.bytes);
  }
}

async function appendPage(tableDir, manifest, rows) {
  const next = structuredClone(manifest);
  for (const [day, dayRows] of groupByDay(rows, manifest.time_column)) {
    const payload = `${dayRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const path = resolve(tableDir, `${day}.jsonl`);
    await appendFile(path, payload, "utf8");
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const current = next.files[day] || { rows: 0, bytes: 0, sha256: null };
    current.rows += dayRows.length;
    current.bytes += Buffer.byteLength(payload);
    current.sha256 = null;
    next.files[day] = current;
  }
  next.cursor_id = cleanText(rows.at(-1)?.[manifest.key_column]);
  next.exported_row_count += rows.length;
  next.page_count += 1;
  next.updated_at = new Date().toISOString();
  if (next.exported_row_count > next.expected_row_count) {
    throw new Error(`${manifest.table} exported more rows than frozen snapshot count`);
  }
  return next;
}

export async function inspectJsonl(path) {
  const hash = crypto.createHash("sha256");
  let rows = 0;
  const input = createReadStream(path);
  input.on("data", (chunk) => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    JSON.parse(line);
    rows += 1;
  }
  return { rows, bytes: (await stat(path)).size, sha256: hash.digest("hex") };
}

export async function verifyTableExport(tableDir, manifest) {
  assertManifest(manifest, {
    table: manifest?.table,
    timeColumn: manifest?.time_column,
    keyColumn: manifest?.key_column,
    supabaseUrl: manifest?.project_url
  });
  const files = {};
  let rows = 0;
  for (const day of Object.keys(manifest.files || {}).sort()) {
    const details = await inspectJsonl(resolve(tableDir, `${day}.jsonl`));
    const checkpoint = manifest.files[day];
    if (details.rows !== checkpoint.rows || details.bytes !== checkpoint.bytes) {
      throw new Error(`${manifest.table}/${day} verification mismatch`);
    }
    files[day] = details;
    rows += details.rows;
  }
  if (rows !== manifest.expected_row_count || rows !== manifest.exported_row_count) {
    throw new Error(`${manifest.table} row count mismatch expected=${manifest.expected_row_count} exported=${rows}`);
  }
  return { table: manifest.table, snapshot_cutoff: manifest.snapshot_cutoff, rows, files };
}

export async function exportTable(key, descriptor, {
  dest,
  pageSize = 0,
  fetchImpl = fetch,
  supabaseUrl = defaultSupabaseUrl,
  paced = true,
  onProgress = () => {}
} = {}) {
  const { table, timeColumn, keyColumn } = descriptor;
  // Per-table page size unless the caller overrides: row weight varies by two
  // orders of magnitude across these tables.
  const effectivePageSize = pageSize || descriptor.pageSize || defaultPageSize;
  const tableDir = resolve(dest, table);
  const manifestPath = resolve(tableDir, "manifest.json");
  await mkdir(tableDir, { recursive: true });
  let manifest = await readJson(manifestPath);
  if (!manifest) {
    const cutoff = await snapshotCutoff(key, table, timeColumn, { fetchImpl, supabaseUrl });
    const expectedCount = await tableCount(key, table, { cutoff, timeColumn, keyColumn, fetchImpl, supabaseUrl });
    manifest = newManifest({ table, timeColumn, keyColumn, cutoff, expectedCount, supabaseUrl });
    await atomicJson(manifestPath, manifest);
  }
  assertManifest(manifest, { table, timeColumn, keyColumn, supabaseUrl });
  await reconcileCommittedFiles(tableDir, manifest);
  if (!manifest.complete) {
    for await (const rows of pageRows(key, table, {
      pageSize: effectivePageSize,
      after: manifest.cursor_id,
      cutoff: manifest.snapshot_cutoff,
      timeColumn,
      keyColumn,
      fetchImpl,
      supabaseUrl,
      paced
    })) {
      manifest = await appendPage(tableDir, manifest, rows);
      await atomicJson(manifestPath, manifest);
      onProgress({ table, exported: manifest.exported_row_count, expected: manifest.expected_row_count });
    }
    if (manifest.exported_row_count !== manifest.expected_row_count) {
      throw new Error(`${table} ended early expected=${manifest.expected_row_count} exported=${manifest.exported_row_count}`);
    }
  }
  const verified = await verifyTableExport(tableDir, manifest);
  manifest.complete = true;
  manifest.completed_at ||= new Date().toISOString();
  for (const [day, details] of Object.entries(verified.files)) manifest.files[day].sha256 = details.sha256;
  await atomicJson(manifestPath, manifest);
  return verified;
}

export async function verifyExport(dest, { tables = telemetryTables, supabaseUrl = defaultSupabaseUrl } = {}) {
  const verified = [];
  for (const { table, timeColumn, keyColumn } of tables) {
    const tableDir = resolve(dest, table);
    const manifest = await readJson(resolve(tableDir, "manifest.json"));
    if (!manifest?.complete) throw new Error(`${table} export is not complete`);
    assertManifest(manifest, { table, timeColumn, keyColumn, supabaseUrl });
    verified.push(await verifyTableExport(tableDir, manifest));
  }
  const report = {
    schema_version: telemetryVerificationContractVersion,
    project_url: supabaseUrl,
    complete: true,
    verified_at: new Date().toISOString(),
    total_rows: verified.reduce((sum, table) => sum + table.rows, 0),
    tables: verified
  };
  report.sha256 = crypto.createHash("sha256").update(JSON.stringify(report.tables)).digest("hex");
  await atomicJson(resolve(dest, "export-verification.json"), report);
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const apply = argv.includes("--apply");
  const verifyOnly = argv.includes("--verify");
  const skipPreflight = argv.includes("--skip-preflight");
  const dest = expandHome(argValue(argv, "--dest", "~/lynca-telemetry"));
  const only = cleanText(argValue(argv, "--only", ""));
  const pageSizeArg = argValue(argv, "--page-size", "");
  const pageSize = pageSizeArg ? Number(pageSizeArg) : 0;
  if (pageSizeArg && (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000)) {
    throw new Error("--page-size must be 1..1000");
  }
  const tables = only ? telemetryTables.filter((entry) => entry.table === only) : telemetryTables;
  if (only && !tables.length) throw new Error(`unknown table: ${only}`);

  console.log(`destination: ${dest}`);
  if (verifyOnly) {
    const report = await verifyExport(dest, { tables });
    console.log(`verified ${report.total_rows.toLocaleString()} rows; sha256=${report.sha256}`);
    return 0;
  }
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!apply) {
    let total = 0;
    for (const { table, timeColumn, keyColumn } of tables) {
      const cutoff = await snapshotCutoff(key, table, timeColumn);
      const count = await tableCount(key, table, { cutoff, timeColumn, keyColumn });
      total += count;
      console.log(`  ${table.padEnd(30)} ${count.toLocaleString()} rows through ${cutoff}`);
    }
    console.log(`total ${total.toLocaleString()} rows; report only, nothing written`);
    return 0;
  }

  if (!skipPreflight) {
    console.log("stability preflight (an earlier export took the database down):");
    const health = await waitForStableDatabase(key);
    if (!health.stable) {
      console.log(`\n  ABORTED at probe ${health.failedProbe}. The database is not steady enough to read from.`);
      console.log("  Nothing was fetched. Wait and re-run; --skip-preflight overrides deliberately.");
      return 1;
    }
    console.log("  stable.\n");
  }

  for (const descriptor of tables) {
    const result = await exportTable(key, descriptor, {
      dest,
      pageSize,
      onProgress: ({ table, exported, expected }) => {
        process.stderr.write(`  ${table} ${exported}/${expected}\r`);
      }
    });
    console.log(`\n  ${result.table}: ${result.rows.toLocaleString()} verified rows`);
  }
  const report = await verifyExport(dest, { tables });
  console.log(`complete: ${report.total_rows.toLocaleString()} rows; sha256=${report.sha256}`);
  console.log(`reclaim gate: ${resolve(dest, "export-verification.json")}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
