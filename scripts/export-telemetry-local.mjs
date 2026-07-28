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

import { mkdir, writeFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const SUPABASE = "https://osrrujmpxxiefppjfgpd.supabase.co";
const PAGE = 500;

// Everything here is produced by evaluation runs and read only by analysis.
// catalog_* tables are deliberately absent: they are the asset and stay.
const TELEMETRY_TABLES = [
  { table: "v4_recognition_sessions", timeColumn: "created_at" },
  { table: "v4_candidate_traces", timeColumn: "created_at" },
  { table: "recognition_workflow_events", timeColumn: "created_at" },
  { table: "vector_query_logs", timeColumn: "created_at" },
  { table: "request_logs", timeColumn: "created_at" },
  { table: "v4_production_quality_ledger", timeColumn: "created_at" }
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

export async function tableCount(key, table) {
  const response = await fetch(`${SUPABASE}/rest/v1/${table}?select=id`, {
    headers: headers(key, { Prefer: "count=planned", Range: "0-0" })
  });
  if (!response.ok) return null;
  return Number(cleanText(response.headers.get("content-range")).split("/")[1] || 0) || null;
}

// Page by primary key rather than offset: a large offset makes Postgres walk
// every skipped row, which is how a read turns into the load that caused the
// original outage.
export async function* pageRows(key, table, { pageSize = PAGE, after = "" } = {}) {
  let cursor = after;
  for (;;) {
    const filter = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : "";
    const url = `${SUPABASE}/rest/v1/${table}?select=*${filter}&order=id.asc&limit=${pageSize}`;
    const response = await fetch(url, { headers: headers(key) });
    if (!response.ok) throw new Error(`${table} read http_${response.status}: ${(await response.text()).slice(0, 160)}`);
    const rows = await response.json();
    if (!rows.length) return;
    yield rows;
    cursor = rows[rows.length - 1].id;
    if (rows.length < pageSize) return;
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

export async function main(argv = process.argv.slice(2)) {
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const apply = argv.includes("--apply");
  const dest = expandHome(argValue(argv, "--dest", "~/lynca-telemetry"));

  console.log(`destination: ${dest}${apply ? "" : "   (report only)"}\n`);

  let grandTotal = 0;
  for (const { table, timeColumn } of TELEMETRY_TABLES) {
    const count = await tableCount(key, table);
    console.log(`  ${table.padEnd(30)} ~${count === null ? "?" : count.toLocaleString()} rows`);
    if (count !== null) grandTotal += count;
    if (!apply) continue;

    await mkdir(resolve(dest, table), { recursive: true });
    const buffers = new Map();
    let pulled = 0;
    for await (const rows of pageRows(key, table)) {
      for (const [day, dayRows] of groupByDay(rows, timeColumn)) {
        if (!buffers.has(day)) buffers.set(day, []);
        buffers.get(day).push(...dayRows);
      }
      pulled += rows.length;
      process.stderr.write(`    ${table} ${pulled}\r`);
    }
    for (const [day, dayRows] of buffers) {
      const file = resolve(dest, table, `${day}.jsonl`);
      await writeFile(file, `${dayRows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
    }
    console.log(`    -> ${pulled.toLocaleString()} rows in ${buffers.size} daily files`);
  }

  console.log(`\n  total ~${grandTotal.toLocaleString()} rows`);
  if (!apply) {
    console.log("\n  report only. Re-run with --apply to write them locally.");
    console.log("  Export must complete before scripts/reclaim-database-disk.mjs truncates anything.");
    return 0;
  }

  const written = await readdir(dest).catch(() => []);
  console.log(`\n  exported tables on disk: ${written.join(", ")}`);
  console.log("  safe to run the reclaim plan now.");
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
