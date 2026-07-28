#!/usr/bin/env node
// Pull evaluation telemetry out of the cloud database onto this machine, so it
// can be deleted there.
//
//   node scripts/export-telemetry-local.mjs                    (report sizes only)
//   node scripts/export-telemetry-local.mjs --apply
//   node scripts/export-telemetry-local.mjs --apply --dest ~/lynca-telemetry
//
// The database ran out of disk on 2026-07-27 and Postgres could not write
// pg_wal for sixteen hours. The catalog was not what filled it:
//
//   catalog_import_staging        291 MB   105,558 rows
//   v4_recognition_sessions       227 MB     6,581 rows (~35 KB each)
//   catalog_cards                 204 MB   147,936 rows   <- the asset
//   v4_production_quality_ledger   72 MB
//   vector_query_logs              68 MB    14,079 rows
//   recognition_workflow_events    65 MB
//   v4_candidate_traces            63 MB
//   request_logs                   55 MB   127,142 rows
//
// Roughly 750 MB of 1,348 MB is telemetry our own evaluation runs produced, and
// nothing prunes it. It belongs on the machine that analyses it: every question
// asked of it so far has been offline analysis, it is faster to query locally,
// and it stops competing for the quota that serves listers.
//
// EXPORT BEFORE DELETING. The reclaim plan truncates request_logs and
// vector_query_logs, which is the only operation that returns space to a full
// volume -- and it is irreversible. This runs first.
//
// Written as newline-delimited JSON, one file per table per day, so a partial
// run resumes without duplicating and a single day can be re-fetched.
//
// This export took the database down on 2026-07-28. It read at full speed --
// zero delay between pages -- against an instance that had just finished a
// forty-minute WAL replay with every cache cold, starting with the single
// heaviest table. The gateway went 504, then 521, then 522. Reading 750 MB is
// not a safe operation just because it is a read, and nothing in the first
// version acknowledged that. Three things follow, and none of them are
// optional:
//
//   * pace     -- a delay between pages, widened when the server is slow.
//   * order    -- lightest table first, so the run is proved on something
//                 cheap before the 227 MB table is touched.
//   * resume   -- rows land on disk and a cursor is checkpointed as they go,
//                 so a failure at 90% costs the last page, not the run. Both
//                 previous attempts ended with an empty destination.

import { mkdir, writeFile, appendFile, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Overridable so the resume path can be exercised against a local stub. The
// claim being tested -- "a failure mid-run costs one page, not the run" -- is
// exactly the kind that reads as obviously true and was false twice.
const SUPABASE = process.env.TELEMETRY_EXPORT_ORIGIN || "https://osrrujmpxxiefppjfgpd.supabase.co";
// v4_recognition_sessions rows are ~35 KB each, so 500 of them is an 17 MB
// response and the gateway times out at 504. Page size is per-table, sized by
// row weight rather than a single global guess.
const PAGE = 500;
const PAGE_BY_TABLE = { v4_recognition_sessions: 25, v4_candidate_traces: 50, recognition_workflow_events: 100 };

// Pace, not throughput. The export is not urgent; the database serving listers
// is. A page that comes back slowly is the server asking for room, so the delay
// tracks observed latency rather than staying fixed.
const PACE_MS = 250;
const PACE_MAX_MS = 5_000;
const SLOW_PAGE_MS = 2_000;

// Everything here is produced by evaluation runs and read only by analysis.
// catalog_* tables are deliberately absent: they are the asset and stay.
// cursorColumn is not always `id`: recognition_workflow_events has no such
// column and the first run failed outright with 42703 rather than exporting
// anything. Anything monotonic works as a cursor.
//
// Ordered lightest-first by total table size, so the cheapest table proves the
// run is survivable before the heaviest one is attempted. The previous order
// opened with v4_recognition_sessions -- 227 MB, 35 KB a row -- and that is
// where both failures happened.
const TELEMETRY_TABLES = [
  { table: "request_logs", timeColumn: "created_at", cursorColumn: "id", sizeMb: 55 },
  { table: "v4_candidate_traces", timeColumn: "created_at", cursorColumn: "id", sizeMb: 63 },
  { table: "recognition_workflow_events", timeColumn: "created_at", cursorColumn: "created_at", sizeMb: 65 },
  { table: "vector_query_logs", timeColumn: "created_at", cursorColumn: "created_at", sizeMb: 68 },
  { table: "v4_production_quality_ledger", timeColumn: "created_at", cursorColumn: "id", sizeMb: 72 },
  { table: "v4_recognition_sessions", timeColumn: "created_at", cursorColumn: "id", sizeMb: 227 }
];

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function expandHome(path) {
  return path.startsWith("~") ? resolve(homedir(), path.slice(1).replace(/^\/+/, "")) : resolve(path);
}

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

// select=id would 42703 on recognition_workflow_events, which has no such
// column -- and a null count there silently turns the completeness check into
// an unconditional pass. Count over the column the table actually pages by.
export async function tableCount(key, table, cursorColumn = "id") {
  const response = await fetch(`${SUPABASE}/rest/v1/${table}?select=${encodeURIComponent(cursorColumn)}`, {
    headers: headers(key, { Prefer: "count=planned", Range: "0-0" })
  }).catch(() => null);
  if (!response?.ok) return null;
  return Number(cleanText(response.headers.get("content-range")).split("/")[1] || 0) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How long to wait before the next page. A page that took longer than
// SLOW_PAGE_MS is the server under strain, and the correct response to strain
// is to back off, not to keep the same cadence and hope.
export function nextPace(currentMs, elapsedMs) {
  if (elapsedMs > SLOW_PAGE_MS) return Math.min(PACE_MAX_MS, Math.round(currentMs * 2) || PACE_MS);
  return Math.max(PACE_MS, Math.round(currentMs * 0.8));
}

// Do not start a heavy read against an instance that has merely stopped
// erroring. Both failed attempts began seconds after a single 200 came back;
// the database was still recovering and the export finished the job. Require
// several consecutive quick responses spread over time instead.
export async function waitForStableDatabase(key, { probes = 4, spacingMs = 15_000, maxLatencyMs = 3_000, log = console.log } = {}) {
  for (let i = 1; i <= probes; i += 1) {
    const started = Date.now();
    const response = await fetch(`${SUPABASE}/rest/v1/catalog_sources?select=id&limit=1`, {
      headers: headers(key), signal: AbortSignal.timeout(20_000)
    }).catch((error) => ({ ok: false, status: String(error?.name || "fetch_failed") }));
    const elapsed = Date.now() - started;
    const healthy = response.ok && elapsed <= maxLatencyMs;
    log(`  probe ${i}/${probes}  ${response.ok ? "200" : response.status}  ${elapsed}ms  ${healthy ? "ok" : "NOT READY"}`);
    if (!healthy) return { stable: false, failedProbe: i, status: response.status ?? null, elapsed };
    if (i < probes) await sleep(spacingMs);
  }
  return { stable: true };
}

// Page by primary key rather than offset: a large offset makes Postgres walk
// every skipped row, which is how a read turns into the load that caused the
// original outage.
export async function* pageRows(key, table, { pageSize = PAGE_BY_TABLE[table] || PAGE, after = "", cursorColumn = "id" } = {}) {
  let cursor = after;
  let pace = PACE_MS;
  for (;;) {
    const filter = cursor ? `&${cursorColumn}=gt.${encodeURIComponent(cursor)}` : "";
    const url = `${SUPABASE}/rest/v1/${table}?select=*${filter}&order=${cursorColumn}.asc&limit=${pageSize}`;
    let response = null;
    let requested = pageSize;
    const started = Date.now();
    // A 504 here is the gateway giving up on a large page, not a dead database.
    // Shrink and retry rather than losing the whole export -- and remember what
    // was actually requested, because the first version compared the returned
    // count against the ORIGINAL page size. A retry that succeeded with a
    // smaller limit then looked like a short final page and stopped the export
    // silently: v4_recognition_sessions came out at 1,262 rows and reported
    // success. Silent truncation is the failure mode this whole export exists
    // to avoid.
    // Retries widen as well as shrink. A 521/522 is Cloudflare reporting the
    // origin is down, and hammering it every half second is how a struggling
    // instance is kept struggling.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      requested = Math.max(5, Math.floor(pageSize / attempt));
      response = await fetch(url.replace(`limit=${pageSize}`, `limit=${requested}`), { headers: headers(key) })
        .catch((error) => ({ ok: false, status: String(error?.name || "fetch_failed"), text: async () => "" }));
      if (response.ok) break;
      if (attempt === 5) throw new Error(`${table} read http_${response.status}: ${(await response.text()).slice(0, 160)}`);
      await sleep(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
    }
    const rows = await response.json();
    if (!rows.length) return;
    pace = nextPace(pace, Date.now() - started);
    cursor = rows[rows.length - 1][cursorColumn];
    // The cursor travels with the rows so the caller can checkpoint exactly
    // what it has written, rather than inferring it.
    yield { rows, cursor, pace };
    if (rows.length < requested) return;
    await sleep(pace);
  }
}

export function groupByDay(rows = [], timeColumn = "created_at") {
  const days = new Map();
  for (const row of rows) {
    const day = cleanText(row[timeColumn]).slice(0, 10) || "undated";
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(row);
  }
  return days;
}

// One checkpoint per table: the cursor value whose rows are already on disk,
// and the count written so far. Rows are appended before the checkpoint moves,
// so a crash re-fetches at most one page and never loses one.
const checkpointPath = (dest, table) => resolve(dest, table, "_checkpoint.json");

async function readCheckpoint(dest, table) {
  const raw = await readFile(checkpointPath(dest, table), "utf8").catch(() => "");
  if (!raw) return { cursor: "", written: 0 };
  try {
    const parsed = JSON.parse(raw);
    return { cursor: parsed.cursor ?? "", written: Number(parsed.written) || 0 };
  } catch { return { cursor: "", written: 0 }; }
}

export async function main(argv = process.argv.slice(2)) {
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const apply = argv.includes("--apply");
  const dest = expandHome(argValue(argv, "--dest", "~/lynca-telemetry"));
  const only = cleanText(argValue(argv, "--only", ""));
  const skipPreflight = argv.includes("--skip-preflight");
  const tables = only ? TELEMETRY_TABLES.filter((t) => t.table === only) : TELEMETRY_TABLES;
  if (only && !tables.length) throw new Error(`unknown table: ${only}`);

  console.log(`destination: ${dest}${apply ? "" : "   (report only)"}\n`);

  if (apply && !skipPreflight) {
    console.log("stability preflight (this export took the database down once):");
    const health = await waitForStableDatabase(key);
    if (!health.stable) {
      console.log(`\n  ABORTED at probe ${health.failedProbe}. The database is not steady enough to read from.`);
      console.log("  Nothing was fetched. Wait and re-run; --skip-preflight overrides deliberately.");
      return 1;
    }
    console.log("  stable.\n");
  }

  let grandTotal = 0;
  const summary = [];
  for (const { table, timeColumn, cursorColumn } of tables) {
    const count = await tableCount(key, table, cursorColumn);
    console.log(`  ${table.padEnd(30)} ~${count === null ? "?" : count.toLocaleString()} rows`);
    if (count !== null) grandTotal += count;
    if (!apply) continue;

    await mkdir(resolve(dest, table), { recursive: true });
    const checkpoint = await readCheckpoint(dest, table);
    if (checkpoint.cursor) console.log(`    resuming after ${cursorColumn}=${String(checkpoint.cursor).slice(0, 40)} (${checkpoint.written.toLocaleString()} already local)`);

    const days = new Set();
    let pulled = checkpoint.written;
    for await (const { rows, cursor, pace } of pageRows(key, table, { cursorColumn, after: checkpoint.cursor })) {
      // Append first, checkpoint second. The reverse order loses rows.
      for (const [day, dayRows] of groupByDay(rows, timeColumn)) {
        await appendFile(resolve(dest, table, `${day}.jsonl`), `${dayRows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
        days.add(day);
      }
      pulled += rows.length;
      await writeFile(checkpointPath(dest, table), `${JSON.stringify({ cursor, written: pulled, cursorColumn })}\n`, "utf8");
      process.stderr.write(`    ${table} ${pulled}${count ? `/${count}` : ""}  pace ${pace}ms   \r`);
    }
    // `days` counts files touched by THIS run, which is zero on a resume that
    // had nothing left to fetch -- so it is labelled as such rather than
    // reading as "1,000 rows in 0 files".
    console.log(`    -> ${pulled.toLocaleString()} rows local (${days.size} daily files written this run)`);
    summary.push({ table, cloud: count, local: pulled });
  }

  console.log(`\n  total ~${grandTotal.toLocaleString()} rows`);
  if (!apply) {
    console.log("\n  report only. Re-run with --apply to write them locally.");
    console.log("  Export must complete before scripts/reclaim-database-disk.mjs truncates anything.");
    return 0;
  }

  // The reclaim plan is irreversible, so it is gated on numbers agreeing rather
  // than on this script having finished without throwing. The count is planned
  // rather than exact, so a small excess is expected; a shortfall is not.
  console.log("\n  cloud vs local:");
  let complete = true;
  for (const { table, cloud, local } of summary) {
    const ok = cloud === null || local >= cloud;
    if (!ok) complete = false;
    console.log(`    ${table.padEnd(30)} cloud ${String(cloud ?? "?").padStart(8)}  local ${String(local).padStart(8)}  ${ok ? "ok" : "SHORT"}`);
  }
  const written = await readdir(dest).catch(() => []);
  console.log(`\n  exported tables on disk: ${written.join(", ")}`);
  console.log(complete
    ? "  every table matched or exceeded its cloud count. Safe to run the reclaim plan."
    : "  DO NOT RUN THE RECLAIM PLAN. At least one table is short; re-run to resume.");
  return complete ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
