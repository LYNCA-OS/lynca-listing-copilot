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
import { supabaseRestAdminHeaders } from "../lib/supabase-service-headers.mjs";

export const telemetryExportContractVersion = "telemetry-export-snapshot-v2";
export const telemetryVerificationContractVersion = "telemetry-export-verification-v1";
// There is no default project. A hardcoded ref here outlived the project it
// named: osrrujmpxxiefppjfgpd was decommissioned in the Sydney -> Singapore
// move and this constant kept handing it to every caller that did not pass a
// url. The failure surfaced as DNS ENOTFOUND, which reads like a network blip
// and invites a retry, rather than as the configuration error it was.
//
// Resolved lazily so a missing SUPABASE_URL fails loudly at the first call
// instead of at import time, and so nothing can be silently pointed at a
// project nobody chose.
let cachedSupabaseUrl = "";
export function resolveSupabaseUrl() {
  if (cachedSupabaseUrl) return cachedSupabaseUrl;
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!url) {
    throw new Error("SUPABASE_URL is required: there is no default project. "
      + "Set it to the project this run should target (see docs/operations/active-service-context.json).");
  }
  cachedSupabaseUrl = url;
  return url;
}
export const defaultPageSize = 500;

export const telemetryTables = Object.freeze([
  { table: "v4_recognition_sessions", timeColumn: "created_at", keyColumn: "id" },
  { table: "v4_candidate_traces", timeColumn: "created_at", keyColumn: "id" },
  { table: "recognition_workflow_events", timeColumn: "created_at", keyColumn: "event_id" },
  { table: "vector_query_logs", timeColumn: "generated_at", keyColumn: "query_log_id" },
  { table: "request_logs", timeColumn: "timestamp", keyColumn: "id" },
  { table: "v4_production_quality_ledger", timeColumn: "created_at", keyColumn: "id" }
]);

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function expandHome(path) {
  return path.startsWith("~")
    ? resolve(homedir(), path.slice(1).replace(/^\/+/, ""))
    : resolve(path);
}

function headers(key, extra = {}) {
  return supabaseRestAdminHeaders(key, extra);
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

export async function snapshotCutoff(key, table, timeColumn = "created_at", {
  fetchImpl = fetch,
  supabaseUrl = resolveSupabaseUrl()
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
  supabaseUrl = resolveSupabaseUrl()
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
  supabaseUrl = resolveSupabaseUrl()
} = {}) {
  let cursor = cleanText(after);
  for (;;) {
    const cursorFilter = cursor ? `&${keyColumn}=gt.${encodedFilter(cursor)}` : "";
    const cutoffFilter = cutoff ? `&${timeColumn}=lte.${encodedFilter(cutoff)}` : "";
    const url = `${supabaseUrl}/rest/v1/${table}?select=*${cursorFilter}${cutoffFilter}&order=${keyColumn}.asc&limit=${pageSize}`;
    const response = await fetchImpl(url, { headers: headers(key) });
    if (!response.ok) throw new Error(`${table} read http_${response.status}: ${(await response.text()).slice(0, 160)}`);
    const rows = await response.json();
    if (!rows.length) return;
    for (const row of rows) {
      if (!cleanText(row?.[keyColumn])) throw new Error(`${table} row missing primary key ${keyColumn}`);
    }
    yield rows;
    cursor = cleanText(rows.at(-1)[keyColumn]);
    if (rows.length < pageSize) return;
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
  pageSize = defaultPageSize,
  fetchImpl = fetch,
  supabaseUrl = resolveSupabaseUrl(),
  onProgress = () => {}
} = {}) {
  const { table, timeColumn, keyColumn } = descriptor;
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
      pageSize,
      after: manifest.cursor_id,
      cutoff: manifest.snapshot_cutoff,
      timeColumn,
      keyColumn,
      fetchImpl,
      supabaseUrl
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

export async function verifyExport(dest, { tables = telemetryTables, supabaseUrl = resolveSupabaseUrl() } = {}) {
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
  const dest = expandHome(argValue(argv, "--dest", "~/lynca-telemetry"));
  const pageSize = Number(argValue(argv, "--page-size", defaultPageSize));
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("--page-size must be 1..1000");

  console.log(`destination: ${dest}`);
  if (verifyOnly) {
    const report = await verifyExport(dest);
    console.log(`verified ${report.total_rows.toLocaleString()} rows; sha256=${report.sha256}`);
    return 0;
  }
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!apply) {
    let total = 0;
    for (const { table, timeColumn, keyColumn } of telemetryTables) {
      const cutoff = await snapshotCutoff(key, table, timeColumn);
      const count = await tableCount(key, table, { cutoff, timeColumn, keyColumn });
      total += count;
      console.log(`  ${table.padEnd(30)} ${count.toLocaleString()} rows through ${cutoff}`);
    }
    console.log(`total ${total.toLocaleString()} rows; report only, nothing written`);
    return 0;
  }

  for (const descriptor of telemetryTables) {
    const result = await exportTable(key, descriptor, {
      dest,
      pageSize,
      onProgress: ({ table, exported, expected }) => {
        process.stderr.write(`  ${table} ${exported}/${expected}\r`);
      }
    });
    console.log(`\n  ${result.table}: ${result.rows.toLocaleString()} verified rows`);
  }
  const report = await verifyExport(dest);
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
