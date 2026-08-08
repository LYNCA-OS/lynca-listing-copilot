#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const migration = join(root,
  "infrastructure/supabase-production/supabase/migrations/20260808114900_listing_asset_owner_v1.sql");
const dataDir = mkdtempSync(join(tmpdir(), "lynca-asset-owner-pg-"));
const socketDir = mkdtempSync("/tmp/lynca-asset-owner-socket-");
const port = 59_000 + (process.pid % 1_000);
let started = false;

function command(name, args, { quiet = false } = {}) {
  return String(execFileSync(name, args, {
    cwd: root, encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
    stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"]
  }) ?? "").trim();
}
function sql(statement, { expectFailure = false } = {}) {
  try {
    return command("psql", ["-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-Atqc", statement]);
  } catch (error) {
    if (expectFailure) return String(error.stderr || error.message);
    throw error;
  }
}

for (const binary of ["initdb", "pg_ctl", "psql"]) {
  try { command(binary, ["--version"]); } catch {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
    console.log(JSON.stringify({ ok: true, skipped: true, reason: `${binary} is not available`, scope: "listing_asset_owner_postgres" }));
    process.exit(0);
  }
}

try {
  command("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres"], { quiet: true });
  command("pg_ctl", ["-D", dataDir, "-o", `-p ${port} -k ${socketDir}`,
    "-l", join(dataDir, "server.log"), "-w", "start"], { quiet: true });
  started = true;
  sql(`create role anon; create role authenticated;
    create table public.listing_assets (id text primary key, tenant_id text not null);
    alter table public.listing_assets enable row level security;
    grant select, update on public.listing_assets to anon, authenticated;
    create table public.v4_recognition_sessions (
      tenant_id text, asset_id text, user_id text, operator_id text, created_by_user_id text
    );
    insert into public.listing_assets values
      ('asset-unique', 'tenant-a'), ('asset-legacy', 'tenant-a'),
      ('asset-ambiguous', 'tenant-a'), ('asset-partial', 'tenant-a'),
      ('asset-sessionless', 'tenant-a');
    insert into public.v4_recognition_sessions values
      ('tenant-a', 'asset-unique', 'writer-a', null, null),
      ('tenant-a', 'asset-unique', 'writer-a', null, null),
      ('tenant-a', 'asset-legacy', null, 'writer-legacy', null),
      ('tenant-a', 'asset-ambiguous', 'writer-a', null, null),
      ('tenant-a', 'asset-ambiguous', 'writer-b', null, null),
      ('tenant-a', 'asset-partial', 'writer-a', null, null),
      ('tenant-a', 'asset-partial', null, null, null);`);
  command("psql", ["-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-f", migration], { quiet: true });

  assert.equal(sql("select owner_user_id from public.listing_assets where id='asset-unique'"), "writer-a");
  assert.equal(sql("select owner_user_id from public.listing_assets where id='asset-legacy'"), "writer-legacy");
  assert.equal(sql("select owner_user_id is null from public.listing_assets where id='asset-ambiguous'"), "t");
  assert.equal(sql("select owner_user_id is null from public.listing_assets where id='asset-partial'"), "t");
  assert.equal(sql("select owner_user_id is null from public.listing_assets where id='asset-sessionless'"), "t");
  assert.equal(sql("set role anon; select count(*) from public.listing_assets"), "0",
    "the additive migration must not weaken the existing RLS boundary for anon");
  assert.equal(sql("set role authenticated; select count(*) from public.listing_assets"), "0",
    "the additive migration must not expose durable ownership to authenticated clients");
  assert.match(sql("update public.listing_assets set owner_user_id='writer-b' where id='asset-unique'", { expectFailure: true }),
    /listing_asset_owner_immutable/);
  sql("update public.listing_assets set owner_user_id='writer-new' where id='asset-sessionless'");
  assert.equal(sql("select owner_user_id from public.listing_assets where id='asset-sessionless'"), "writer-new");
  assert.match(sql("update public.listing_assets set owner_user_id=null where id='asset-sessionless'", { expectFailure: true }),
    /listing_asset_owner_immutable/);
  process.stdout.write("listing asset owner postgres: ok\n");
} finally {
  if (started) try { command("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true }); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
