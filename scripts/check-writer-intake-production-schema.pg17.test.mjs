#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  collectWriterIntakeProductionSchemaSnapshot,
  evaluateWriterIntakeProductionSchemaSnapshot
} from "./check-writer-intake-production-schema.mjs";

const { Client } = pg;
const MIGRATION_URL = new URL(
  "../supabase/migrations/20260730065921_v4_writer_intake_ledger_v1.sql",
  import.meta.url
);
const CHECKER_URL = new URL("./check-writer-intake-production-schema.mjs", import.meta.url);
const CLUSTER_PORT = 55432;
const COMMAND_TIMEOUT_MS = 120_000;
const externalTestUrl = String(process.env.WRITER_INTAKE_PG17_TEST_URL || "").trim();

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
    ...options
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(`${path.basename(command)} ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout || result.stderr || "").trim();
}

function binaryDirectory() {
  const configured = [
    process.env.POSTGRES17_BIN_DIR,
    process.env.POSTGRES_BIN_DIR
  ].map((value) => String(value || "").trim()).find(Boolean);
  const candidates = [
    configured,
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@17/bin"
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (["initdb", "pg_ctl", "postgres"].every((name) => (
      fs.existsSync(path.join(candidate, name))
    ))) return candidate;
  }

  const located = spawnSync("which", ["postgres"], {
    encoding: "utf8",
    timeout: 5_000
  });
  if (located.status === 0 && String(located.stdout || "").trim()) {
    const candidate = path.dirname(String(located.stdout).trim());
    if (["initdb", "pg_ctl", "postgres"].every((name) => (
      fs.existsSync(path.join(candidate, name))
    ))) return candidate;
  }
  if (process.env.REQUIRE_POSTGRES17 === "1") {
    throw new Error(
      "PostgreSQL 17 binaries are required; set POSTGRES17_BIN_DIR to the directory containing initdb, pg_ctl, and postgres"
    );
  }
  return null;
}

function postgresBinary(binDirectory, name) {
  return path.join(binDirectory, name);
}

function assertPostgres17(binDirectory) {
  const version = commandResult(postgresBinary(binDirectory, "postgres"), ["--version"]);
  if (!/PostgreSQL\) 17(?:\.|\s)/.test(version)) {
    if (process.env.REQUIRE_POSTGRES17 === "1") {
      assert.match(version, /PostgreSQL\) 17(?:\.|\s)/, `expected PostgreSQL 17, received ${version}`);
    }
    return null;
  }
  return version;
}

const bootstrapSql = String.raw`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema private;
  create schema extensions;
  create extension pgcrypto with schema extensions;

  create or replace function private.is_tenant_member(p_tenant_id text)
  returns boolean
  language sql
  stable
  set search_path = ''
  as $$ select p_tenant_id is not null $$;

  create or replace function private.current_user_matches_operator(p_operator_id text)
  returns boolean
  language sql
  stable
  set search_path = ''
  as $$ select p_operator_id is not null $$;

  create table public.tenant_members (
    tenant_id text not null,
    user_id text not null,
    primary key (tenant_id, user_id)
  );

  create table public.listing_assets (
    id text primary key,
    tenant_id text not null,
    image_set_state text not null default 'PENDING',
    image_generation_id text,
    image_set_sha256 text,
    expected_original_count integer not null default 0,
    created_at timestamptz not null default pg_catalog.clock_timestamp()
  );

  create table public.listing_image_verifications (
    tenant_id text not null,
    asset_id text not null,
    image_generation_id text not null,
    storage_role text not null,
    canonical_eligible boolean not null default false,
    verified_at timestamptz not null default pg_catalog.clock_timestamp()
  );

  create table public.v4_recognition_sessions (
    id text primary key,
    tenant_id text not null,
    operator_id text,
    asset_id text,
    status text not null default 'READY',
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    unique (tenant_id, id)
  );

  create table public.v4_recognition_jobs (
    id text primary key,
    tenant_id text not null,
    operator_id text,
    asset_id text,
    recognition_session_id text,
    job_type text not null default 'FINAL_ASSISTED_TITLE',
    status text not null default 'QUEUED',
    queue_tags jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    unique (tenant_id, id)
  );
`;

function matchesFailure(failureId, expected) {
  return expected.some((matcher) => (
    matcher instanceof RegExp ? matcher.test(failureId) : failureId === matcher
  ));
}

async function reportFor(client) {
  const snapshot = await collectWriterIntakeProductionSchemaSnapshot(client);
  return evaluateWriterIntakeProductionSchemaSnapshot(snapshot);
}

async function assertTamperFails(client, results, { label, sql, expected }) {
  const startedAt = performance.now();
  await client.query("begin");
  try {
    await client.query(sql);
    const report = await reportFor(client);
    assert.equal(report.ready, false, `${label} must fail the production schema contract`);
    assert.ok(
      report.failure_ids.some((failureId) => matchesFailure(failureId, expected)),
      `${label} must produce the expected failure category; failures=${JSON.stringify(report.failure_ids)}`
    );
    results.push({
      label,
      elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      failure_ids: report.failure_ids.filter((failureId) => matchesFailure(failureId, expected))
    });
  } finally {
    await client.query("rollback");
  }
}

const tamperCases = [
  {
    label: "unexpected RLS policy",
    sql: String.raw`
      create policy v4_writer_intake_batches_unexpected_select
      on public.v4_writer_intake_batches
      for select to authenticated
      using (true)
    `,
    expected: [/policy/i]
  },
  {
    label: "missing commit-rate index",
    sql: "drop index public.v4_writer_intake_batches_commit_rate_idx",
    expected: [/index:.*v4_writer_intake_batches_commit_rate_idx/i]
  },
  {
    label: "same-name wrong queue binding index",
    sql: String.raw`
      drop index public.v4_writer_intake_items_queue_job_uidx;
      create unique index v4_writer_intake_items_queue_job_uidx
        on public.v4_writer_intake_items(tenant_id, id)
        where id is not null
    `,
    expected: [/index:.*v4_writer_intake_items_queue_job_uidx/i]
  },
  {
    label: "same-name wrong truth-boundary constraint",
    sql: String.raw`
      alter table public.v4_writer_intake_items
        drop constraint v4_writer_intake_items_truth_boundary_check;
      alter table public.v4_writer_intake_items
        add constraint v4_writer_intake_items_truth_boundary_check check (true)
    `,
    expected: [/constraint:.*v4_writer_intake_items_truth_boundary_check/i]
  },
  {
    label: "tampered commit function body",
    sql: String.raw`
      create or replace function public.commit_v4_writer_intake_batch(
        p_tenant_id text,
        p_operator_id text,
        p_batch_id text,
        p_idempotency_key_sha256 text,
        p_expected_item_count integer
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        return pg_catalog.jsonb_build_object('saved', true);
      end;
      $$
    `,
    expected: [/function.*commit_v4_writer_intake_batch/i]
  },
  {
    label: "tampered abandon function body",
    sql: String.raw`
      create or replace function public.abandon_v4_writer_intake_batch(
        p_tenant_id text,
        p_operator_id text,
        p_batch_id text
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        return pg_catalog.jsonb_build_object('saved', true);
      end;
      $$
    `,
    expected: [/function.*abandon_v4_writer_intake_batch/i]
  },
  {
    label: "untrusted commit function owner",
    sql: String.raw`
      alter function public.commit_v4_writer_intake_batch(text, text, text, text, integer)
      owner to authenticated
    `,
    expected: [/^function:commit_v4_writer_intake_batch/i]
  },
  {
    label: "wrong commit function language",
    sql: String.raw`
      create or replace function public.commit_v4_writer_intake_batch(
        p_tenant_id text,
        p_operator_id text,
        p_batch_id text,
        p_idempotency_key_sha256 text,
        p_expected_item_count integer
      )
      returns jsonb
      language sql
      security definer
      set search_path = ''
      as $$ select pg_catalog.jsonb_build_object('saved', true) $$
    `,
    expected: [/^function:commit_v4_writer_intake_batch/i]
  },
  {
    label: "wrong abandon function return type",
    sql: String.raw`
      drop function public.abandon_v4_writer_intake_batch(text, text, text);
      create function public.abandon_v4_writer_intake_batch(
        p_tenant_id text,
        p_operator_id text,
        p_batch_id text
      )
      returns text
      language plpgsql
      security definer
      set search_path = ''
      as $$ begin return 'saved'; end; $$;
      revoke all on function public.abandon_v4_writer_intake_batch(text, text, text)
        from public, anon, authenticated;
      grant execute on function public.abandon_v4_writer_intake_batch(text, text, text)
        to service_role
    `,
    expected: [/^function:abandon_v4_writer_intake_batch/i]
  },
  {
    label: "wrong trigger timing and event",
    sql: String.raw`
      drop trigger zz_listing_assets_image_set_finalized_clock on public.listing_assets;
      create trigger zz_listing_assets_image_set_finalized_clock
      after delete on public.listing_assets
      for each row execute function public.stamp_listing_asset_image_set_finalized_at()
    `,
    expected: [/trigger:.*zz_listing_assets_image_set_finalized_clock/i]
  },
  {
    label: "unexpected authenticated TRUNCATE grant",
    sql: "grant truncate on table public.v4_writer_intake_items to authenticated",
    expected: [/acl:.*v4_writer_intake_items/i]
  },
  {
    label: "unexpected authenticated table grant option",
    sql: "grant select on table public.v4_writer_intake_items to authenticated with grant option",
    expected: [/acl:.*v4_writer_intake_items/i]
  },
  {
    label: "unexpected service function grant option",
    sql: String.raw`
      grant execute on function public.commit_v4_writer_intake_batch(text, text, text, text, integer)
      to service_role with grant option
    `,
    expected: [/^function:commit_v4_writer_intake_batch/i]
  },
  {
    label: "canonical queue reference mismatch",
    sql: String.raw`
      insert into public.tenant_members (tenant_id, user_id)
      values ('tenant_fixture', 'operator_fixture');

      select public.commit_v4_writer_intake_batch(
        'tenant_fixture',
        'operator_fixture',
        'intake_11111111111111111111111111111111',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        1
      );

      insert into public.listing_assets (
        id,
        tenant_id,
        image_set_state,
        image_generation_id,
        image_set_sha256,
        expected_original_count
      ) values (
        'asset_fixture',
        'tenant_fixture',
        'FINALIZED',
        'asset_fixture',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        2
      );

      insert into public.v4_recognition_sessions (
        id, tenant_id, operator_id, asset_id, status
      ) values (
        'session_fixture', 'tenant_fixture', 'operator_fixture', 'asset_fixture', 'L2_READY'
      );

      insert into public.v4_recognition_jobs (
        id,
        tenant_id,
        operator_id,
        asset_id,
        recognition_session_id,
        job_type,
        status,
        queue_tags
      ) values (
        'job_fixture',
        'tenant_fixture',
        'different_operator',
        'asset_fixture',
        'session_fixture',
        'FINAL_ASSISTED_TITLE',
        'L2_READY',
        '{"writer_intake_batch_id":"wrong_batch","writer_intake_item_id":"wrong_item"}'::jsonb
      );

      update public.v4_writer_intake_items items
      set status = 'QUEUE_ADMITTED',
          asset_id = 'asset_fixture',
          asset_admitted_at = (
            select assets.image_set_finalized_at
            from public.listing_assets assets
            where assets.id = 'asset_fixture'
          ),
          queue_job_id = 'job_fixture',
          recognition_session_id = 'session_fixture',
          queue_admitted_at = (
            select jobs.created_at
            from public.v4_recognition_jobs jobs
            where jobs.id = 'job_fixture'
          )
      where items.tenant_id = 'tenant_fixture'
        and items.batch_id = 'intake_11111111111111111111111111111111'
        and items.item_position = 1
    `,
    expected: [/invariant:.*(?:canonical|queue)/i]
  }
];

const suiteStartedAt = performance.now();
const binDirectory = externalTestUrl ? null : binaryDirectory();
if (!externalTestUrl && !binDirectory) {
  console.log("writer intake PostgreSQL 17 integration skipped: PostgreSQL 17 binaries are unavailable");
  process.exit(0);
}
const postgresVersion = externalTestUrl ? "external PostgreSQL 17 service" : assertPostgres17(binDirectory);
if (!externalTestUrl && !postgresVersion) {
  console.log("writer intake PostgreSQL 17 integration skipped: available PostgreSQL major is not 17");
  process.exit(0);
}
const temporaryRoot = externalTestUrl
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), "lynca-writer-intake-pg17-"));
const dataDirectory = temporaryRoot ? path.join(temporaryRoot, "data") : null;
const socketDirectory = temporaryRoot ? path.join(temporaryRoot, "socket") : null;
const postgresLogPath = temporaryRoot ? path.join(temporaryRoot, "postgres.log") : null;
if (socketDirectory) fs.mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
let clusterStarted = false;
let client;
const tamperResults = [];

try {
  if (!externalTestUrl) {
    commandResult(postgresBinary(binDirectory, "initdb"), [
      "--pgdata", dataDirectory,
      "--username", "postgres",
      "--auth", "trust",
      "--encoding", "UTF8",
      "--no-locale"
    ]);
    commandResult(postgresBinary(binDirectory, "pg_ctl"), [
      "--pgdata", dataDirectory,
      "--wait",
      "--timeout", "60",
      "--log", postgresLogPath,
      "--options", `-c listen_addresses='' -c unix_socket_directories='${socketDirectory}' -p ${CLUSTER_PORT}`,
      "start"
    ]);
    clusterStarted = true;
  }

  client = new Client({
    ...(externalTestUrl
      ? { connectionString: externalTestUrl }
      : { host: socketDirectory, port: CLUSTER_PORT, database: "postgres", user: "postgres" }),
    application_name: "writer-intake-pg17-schema-integration",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000
  });
  await client.connect();
  const serverVersionResult = await client.query("show server_version_num");
  const serverVersionNum = Number(serverVersionResult.rows[0]?.server_version_num);
  assert.ok(
    serverVersionNum >= 170000 && serverVersionNum < 180000,
    `integration cluster must be PostgreSQL 17, received ${serverVersionNum}`
  );

  await client.query(bootstrapSql);
  await client.query(fs.readFileSync(MIGRATION_URL, "utf8"));

  const positiveStartedAt = performance.now();
  const positiveReport = await reportFor(client);
  assert.equal(
    positiveReport.ready,
    true,
    `the real migration must satisfy the production schema contract: ${JSON.stringify(positiveReport.failure_ids)}`
  );
  const positiveElapsedMs = performance.now() - positiveStartedAt;

  const socketConnectionString = externalTestUrl
    || `postgresql://postgres@localhost:${CLUSTER_PORT}/postgres?host=${encodeURIComponent(socketDirectory)}`;
  const cliReport = JSON.parse(commandResult(process.execPath, [fileURLToPath(CHECKER_URL)], {
    env: { ...process.env, POSTGRES_URL_NON_POOLING: socketConnectionString }
  }));
  assert.equal(cliReport.ready, true, `checker CLI must pass the real migration: ${JSON.stringify(cliReport.failure_ids)}`);
  assert.equal(cliReport.source, "postgres_repeatable_read_only");

  await client.query("begin");
  try {
    await client.query(String.raw`
      insert into public.tenant_members (tenant_id, user_id)
      values ('tenant_asset_orphan', 'operator_asset_orphan');

      select public.commit_v4_writer_intake_batch(
        'tenant_asset_orphan',
        'operator_asset_orphan',
        'intake_22222222222222222222222222222222',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        1
      );

      insert into public.listing_assets (
        id, tenant_id, image_set_state, image_generation_id,
        image_set_sha256, expected_original_count
      ) values (
        'asset_admitted_without_queue',
        'tenant_asset_orphan',
        'FINALIZED',
        'generation_asset_orphan',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        2
      );

      update public.v4_writer_intake_items items
      set status = 'ASSET_ADMITTED',
          asset_id = 'asset_admitted_without_queue',
          asset_admitted_at = (
            select assets.image_set_finalized_at
            from public.listing_assets assets
            where assets.id = 'asset_admitted_without_queue'
          ),
          asset_durable_at = (
            select assets.image_set_finalized_at
            from public.listing_assets assets
            where assets.id = 'asset_admitted_without_queue'
          ),
          durability_status = 'DURABLE'
      where items.batch_id = 'intake_22222222222222222222222222222222'
        and items.item_position = 1;

      select public.abandon_v4_writer_intake_batch(
        'tenant_asset_orphan',
        'operator_asset_orphan',
        'intake_22222222222222222222222222222222'
      );
    `);
    const orphanResult = await client.query(String.raw`
      select status, asset_id, queue_job_id, recognition_session_id, last_error_code
      from public.v4_writer_intake_items
      where batch_id = 'intake_22222222222222222222222222222222'
        and item_position = 1
    `);
    assert.deepEqual(orphanResult.rows[0], {
      status: "CANCELLED",
      asset_id: "asset_admitted_without_queue",
      queue_job_id: null,
      recognition_session_id: null,
      last_error_code: "OPERATOR_ABANDONED_INPUT"
    }, "PostgreSQL must close a zero-accepted ASSET_ADMITTED orphan without erasing asset provenance");
  } finally {
    await client.query("rollback");
  }

  for (const tamperCase of tamperCases) {
    await assertTamperFails(client, tamperResults, tamperCase);
  }

  const finalReport = await reportFor(client);
  assert.equal(
    finalReport.ready,
    true,
    `transactional tamper rollback must restore the canonical schema: ${JSON.stringify(finalReport.failure_ids)}`
  );

  console.log(JSON.stringify({
    ok: true,
    execution_mode: externalTestUrl ? "external_ephemeral_ci_service" : "local_temporary_cluster",
    postgres_version: postgresVersion,
    server_version_num: serverVersionNum,
    migration: path.basename(MIGRATION_URL.pathname),
    positive_check_ms: Number(positiveElapsedMs.toFixed(3)),
    tamper_case_count: tamperResults.length,
    tamper_cases: tamperResults,
    total_elapsed_ms: Number((performance.now() - suiteStartedAt).toFixed(3))
  }, null, 2));
} finally {
  if (client) await client.end().catch(() => {});
  const postmasterPidPath = dataDirectory ? path.join(dataDirectory, "postmaster.pid") : null;
  if (postmasterPidPath && (clusterStarted || fs.existsSync(postmasterPidPath))) {
    try {
      commandResult(postgresBinary(binDirectory, "pg_ctl"), [
        "--pgdata", dataDirectory,
        "--wait",
        "--timeout", "60",
        "--mode", "fast",
        "stop"
      ]);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    }
  }
  if (postmasterPidPath && fs.existsSync(postmasterPidPath)) {
    throw new Error(`temporary PostgreSQL cluster is still running; preserved for safe recovery at ${temporaryRoot}`);
  }
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
