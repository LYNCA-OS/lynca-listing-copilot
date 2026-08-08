#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const migration = join(root,
  "infrastructure/supabase-production/supabase/migrations/20260805080709_listing_manual_recovery_records_v1.sql");
const dataDir = mkdtempSync(join(tmpdir(), "lynca-manual-recovery-pg-"));
const socketDir = mkdtempSync("/tmp/lynca-manual-recovery-socket-");
const port = 57_000 + (process.pid % 2_000);
let started = false;

function command(name, args, { quiet = false } = {}) {
  return String(execFileSync(name, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
    stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"]
  }) ?? "").trim();
}

function sql(statement, { expectFailure = false } = {}) {
  try {
    return command("psql", [
      "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-Atqc", statement
    ]);
  } catch (error) {
    if (expectFailure) return String(error.stderr || error.message);
    throw error;
  }
}

for (const binary of ["initdb", "pg_ctl", "psql"]) {
  try {
    command(binary, ["--version"]);
  } catch {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
    console.log(JSON.stringify({ ok: true, skipped: true, reason: `${binary} is not available`, scope: "manual_recovery_postgres" }));
    process.exit(0);
  }
}

try {
  command("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres"], { quiet: true });
  command("pg_ctl", [
    "-D", dataDir, "-o", `-p ${port} -k ${socketDir}`,
    "-l", join(dataDir, "server.log"), "-w", "start"
  ], { quiet: true });
  started = true;
  command("psql", [
    "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-f", migration
  ], { quiet: true });

  const id = "00000000-0000-4000-8000-000000000051";
  const values = `'${id}', 'listing-manual-recovery-v2', 'tenant-a', 'asset-a',
    'client-a', '', 'recognition', 'MANUAL_AFTER_RECOGNITION_FAILURE',
    'Original title', 'writer-a', '2026-08-08T10:00:00Z'`;
  sql(`insert into public.listing_manual_recovery_records (
    id, schema_version, tenant_id, asset_id, client_asset_ref,
    failure_code, failure_stage, source, manual_title, operator_id, recorded_at
  ) values (${values})`);

  assert.match(
    sql(`insert into public.listing_manual_recovery_records (
      id, schema_version, tenant_id, asset_id, client_asset_ref,
      failure_code, failure_stage, source, manual_title, operator_id, recorded_at
    ) values (${values})`, { expectFailure: true }),
    /duplicate key value violates unique constraint.*pkey/is,
    "the UUID primary key must reject a second physical record for one writer action"
  );

  assert.equal(sql(`select count(*) from public.listing_manual_recovery_records where id = '${id}'`), "1");

  assert.match(sql(`insert into public.listing_manual_recovery_records (
    id, schema_version, tenant_id, asset_id, client_asset_ref,
    failure_code, failure_stage, source, manual_title, operator_id, recorded_at
  ) values ('${id}', 'listing-manual-recovery-v2', 'tenant-a', 'asset-a', 'client-a',
    '', 'recognition', 'MANUAL_AFTER_RECOGNITION_FAILURE', 'Conflicting title',
    'writer-a', '2026-08-08T10:00:00Z')`, { expectFailure: true }),
    /duplicate key value violates unique constraint.*pkey/is);
  assert.equal(sql(`select manual_title from public.listing_manual_recovery_records where id = '${id}'`), "Original title",
    "a conflicting replay must never overwrite the append-only payload");

  process.stdout.write("manual recovery postgres: ok\n");
} finally {
  if (started) {
    try { command("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true }); } catch {}
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
