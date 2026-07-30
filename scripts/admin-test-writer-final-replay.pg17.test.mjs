#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
  collectAdminTestReplayProductionSchemaSnapshot,
  evaluateAdminTestReplayProductionSchemaSnapshot
} from "./check-admin-test-replay-production-schema.mjs";

const { Client } = pg;
const migrationUrl = new URL(
  "../supabase/migrations/20260730120000_admin_test_writer_final_replay_isolation_v1.sql",
  import.meta.url
);
const commandTimeoutMs = 120_000;
const externalTestUrl = String(
  process.env.ADMIN_TEST_REPLAY_PG17_TEST_URL
  || process.env.WRITER_INTAKE_PG17_TEST_URL
  || ""
).trim();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: commandTimeoutMs,
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

function postgres17BinDirectory() {
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
    if (["initdb", "pg_ctl", "postgres"].every((name) => fs.existsSync(path.join(candidate, name)))) {
      const version = run(path.join(candidate, "postgres"), ["--version"]);
      if (/PostgreSQL\) 17(?:\.|\s)/.test(version)) return { directory: candidate, version };
    }
  }
  if (process.env.REQUIRE_POSTGRES17 === "1") {
    throw new Error("PostgreSQL 17 binaries are required; set POSTGRES17_BIN_DIR");
  }
  return null;
}

const postgres = externalTestUrl ? null : postgres17BinDirectory();
if (!externalTestUrl && !postgres) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "postgresql_17_not_available" }));
  process.exit(0);
}

const temporaryRoot = externalTestUrl
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), "lynca-admin-replay-pg17-"));
const dataDirectory = temporaryRoot ? path.join(temporaryRoot, "data") : null;
const socketDirectory = temporaryRoot ? path.join(temporaryRoot, "socket") : null;
const postgresLogPath = temporaryRoot ? path.join(temporaryRoot, "postgres.log") : null;
if (socketDirectory) fs.mkdirSync(socketDirectory, { recursive: true });
const initdb = postgres ? path.join(postgres.directory, "initdb") : null;
const pgCtl = postgres ? path.join(postgres.directory, "pg_ctl") : null;
let client;
let adminClient;
let clusterStarted = false;
let externalDatabaseName = null;
let externalRolePreexistence = null;

const bootstrapSql = String.raw`
  do $$ begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;

  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text not null
  );

  create table public.v4_recognition_sessions (
    id text primary key,
    tenant_id text not null,
    status text not null default 'READY',
    writer_final_title text,
    resolved_fields jsonb not null default '{}'::jsonb,
    field_states jsonb not null default '{}'::jsonb,
    provider_result_summary jsonb not null default '{}'::jsonb,
    writer_feedback_event_id text
  );

  create table public.v4_writer_feedback_events (
    id text primary key,
    tenant_id text not null,
    recognition_session_id text not null,
    dataset_disposition text not null default 'OBSERVE_ONLY',
    writer_feedback jsonb not null default '{}'::jsonb
  );

  create table public.v4_learning_events (
    id text primary key,
    feedback_event_id text,
    tenant_id text not null,
    recognition_session_id text not null,
    dataset_disposition text not null default 'OBSERVE_ONLY',
    training_eligible boolean not null default false,
    feedback_training_event jsonb not null default '{}'::jsonb
  );

  create table public.listing_writer_final_replay (
    tenant_id text not null,
    image_generation_hash text not null check (image_generation_hash ~ '^[0-9a-f]{64}$'),
    writer_final_title text not null check (char_length(btrim(writer_final_title)) between 1 and 80),
    resolved_fields jsonb not null default '{}'::jsonb,
    field_states jsonb not null default '{}'::jsonb,
    identity_status text,
    ambiguity_status text,
    source_session_id text not null,
    source_feedback_event_id text,
    replay_status text not null default 'active' check (replay_status in ('active', 'tombstoned')),
    training_eligible boolean not null default false check (training_eligible = false),
    catalog_promotion_eligible boolean not null default false check (catalog_promotion_eligible = false),
    identity_truth boolean not null default false check (identity_truth = false),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    primary key (tenant_id, image_generation_hash)
  );
`;

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

try {
  let clientOptions;
  if (externalTestUrl) {
    adminClient = new Client({
      connectionString: externalTestUrl,
      application_name: "admin-test-replay-pg17-admin",
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000
    });
    await adminClient.connect();
    const adminVersion = Number((await adminClient.query("show server_version_num")).rows[0]?.server_version_num);
    assert.ok(adminVersion >= 170000 && adminVersion < 180000, `expected PostgreSQL 17, received ${adminVersion}`);
    const roleState = await adminClient.query(String.raw`
      select role_name, exists(
        select 1 from pg_catalog.pg_roles where rolname = role_name
      ) as existed
      from unnest(array['anon', 'authenticated', 'service_role']) role_name
    `);
    externalRolePreexistence = Object.fromEntries(
      roleState.rows.map((row) => [row.role_name, row.existed === true])
    );
    externalDatabaseName = `lynca_admin_replay_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
    assert.match(externalDatabaseName, /^[a-z0-9_]+$/);
    await adminClient.query(`create database "${externalDatabaseName}"`);
    const isolatedUrl = new URL(externalTestUrl);
    isolatedUrl.pathname = `/${externalDatabaseName}`;
    clientOptions = { connectionString: isolatedUrl.toString() };
  } else {
    run(initdb, ["--pgdata", dataDirectory, "--auth=trust", "--username=postgres", "--no-locale"]);
    run(pgCtl, [
      "--pgdata", dataDirectory,
      "--wait",
      "--timeout", "60",
      "--log", postgresLogPath,
      "--options", `-k ${socketDirectory} -h ''`,
      "start"
    ]);
    clusterStarted = true;
    clientOptions = {
      host: socketDirectory,
      port: 5432,
      database: "postgres",
      user: "postgres"
    };
  }

  client = new Client({
    ...clientOptions,
    application_name: "admin-test-replay-pg17-integration",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000
  });
  await client.connect();
  const version = await client.query("show server_version_num");
  const serverVersionNum = Number(version.rows[0].server_version_num);
  assert.ok(serverVersionNum >= 170000 && serverVersionNum < 180000);
  await client.query(bootstrapSql);

  await client.query(String.raw`
      insert into public.v4_recognition_sessions(
        id, tenant_id, status, writer_final_title, provider_result_summary, writer_feedback_event_id
      ) values (
        'session_historical_admin', 'tenant_a', 'EDITED', '1999 Synthetic Admin Title',
        jsonb_build_object('identity_cache_image_generation_hash', repeat('a', 64)), 'feedback_historical_admin'
      );
      insert into public.v4_writer_feedback_events(
        id, tenant_id, recognition_session_id, writer_feedback
      ) values (
        'feedback_historical_admin', 'tenant_a', 'session_historical_admin',
        '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
      );
      insert into public.listing_writer_final_replay(
        tenant_id, image_generation_hash, writer_final_title, source_session_id,
        source_feedback_event_id, replay_status
      ) values (
        'tenant_a', repeat('a', 64), '1999 Synthetic Admin Title', 'session_historical_admin',
        'feedback_historical_admin', 'active'
      );

      insert into public.v4_recognition_sessions(
        id, tenant_id, status, writer_final_title, provider_result_summary, writer_feedback_event_id
      ) values (
        'session_repaired_legitimate', 'tenant_a', 'ACCEPTED', '2024 Legitimate Newer Title',
        jsonb_build_object('identity_cache_image_generation_hash', repeat('c', 64)), 'feedback_repaired_legitimate'
      );
      insert into public.v4_writer_feedback_events(
        id, tenant_id, recognition_session_id, writer_feedback
      ) values
        ('feedback_old_admin', 'tenant_a', 'session_repaired_legitimate', '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb),
        ('feedback_repaired_legitimate', 'tenant_a', 'session_repaired_legitimate', '{"dataset_disposition":"OBSERVE_ONLY"}'::jsonb);
      insert into public.listing_writer_final_replay(
        tenant_id, image_generation_hash, writer_final_title, source_session_id,
        source_feedback_event_id, replay_status
      ) values (
        'tenant_a', repeat('c', 64), '2024 Legitimate Newer Title', 'session_repaired_legitimate',
        'feedback_repaired_legitimate', 'active'
      );
    `);

  await client.query(fs.readFileSync(migrationUrl, "utf8"));
  await client.query(String.raw`
    insert into supabase_migrations.schema_migrations(version, name)
    values ('20260730120000', 'admin_test_writer_final_replay_isolation_v1')
  `);

  const remediation = await client.query(String.raw`
    select image_generation_hash, writer_final_title, source_feedback_event_id, replay_status
    from public.listing_writer_final_replay
    where tenant_id = 'tenant_a'
    order by image_generation_hash
  `);
  assert.deepEqual(remediation.rows, [
    {
      image_generation_hash: hashA,
      writer_final_title: "1999 Synthetic Admin Title",
      source_feedback_event_id: "feedback_historical_admin",
      replay_status: "tombstoned"
    },
    {
      image_generation_hash: hashC,
      writer_final_title: "2024 Legitimate Newer Title",
      source_feedback_event_id: "feedback_repaired_legitimate",
      replay_status: "active"
    }
  ], "remediation must tombstone only replay rows still sourced by administrator tests");

  await client.query(String.raw`
      insert into public.v4_recognition_sessions(
        id, tenant_id, provider_result_summary
      ) values (
        'session_normal_then_admin', 'tenant_a',
        jsonb_build_object('identity_cache_image_generation_hash', repeat('b', 64))
      );
      insert into public.v4_writer_feedback_events(
        id, tenant_id, recognition_session_id, writer_feedback
      ) values (
        'feedback_legitimate', 'tenant_a', 'session_normal_then_admin',
        '{"dataset_disposition":"OBSERVE_ONLY"}'::jsonb
      );
      update public.v4_recognition_sessions
      set status = 'ACCEPTED',
          writer_final_title = '2024 Legitimate Writer Title',
          writer_feedback_event_id = 'feedback_legitimate'
      where id = 'session_normal_then_admin';
    `);

  let activeReplay = await client.query({
    text: String.raw`
      select writer_final_title, source_feedback_event_id, replay_status
      from public.listing_writer_final_replay
      where tenant_id = 'tenant_a' and image_generation_hash = $1
    `,
    values: [hashB]
  });
  assert.deepEqual(activeReplay.rows[0], {
    writer_final_title: "2024 Legitimate Writer Title",
    source_feedback_event_id: "feedback_legitimate",
    replay_status: "active"
  }, "normal writer feedback must still create active replay authority");

  await client.query(String.raw`
    insert into public.v4_writer_feedback_events(
      id, tenant_id, recognition_session_id, writer_feedback
    ) values (
      'feedback_admin_same_image', 'tenant_a', 'session_normal_then_admin',
      '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
    );
    insert into public.v4_learning_events(
      id, feedback_event_id, tenant_id, recognition_session_id,
      dataset_disposition, training_eligible, feedback_training_event
    ) values (
      'learning_admin_same_image', 'feedback_admin_same_image', 'tenant_a',
      'session_normal_then_admin', 'OBSERVE_ONLY', false,
      '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
    );
    update public.v4_recognition_sessions
    set status = 'EDITED',
        writer_final_title = '1999 Synthetic Admin Replacement',
        writer_feedback_event_id = 'feedback_admin_same_image'
    where id = 'session_normal_then_admin';
  `);

  activeReplay = await client.query({
    text: String.raw`
      select writer_final_title, source_feedback_event_id, replay_status
      from public.listing_writer_final_replay
      where tenant_id = 'tenant_a' and image_generation_hash = $1
    `,
    values: [hashB]
  });
  assert.deepEqual(activeReplay.rows[0], {
    writer_final_title: "2024 Legitimate Writer Title",
    source_feedback_event_id: "feedback_legitimate",
    replay_status: "active"
  }, "administrator feedback must not overwrite an existing legitimate replay");

  const sameImageProof = await client.query(String.raw`
    select public.verify_v4_admin_test_feedback_isolation(
      'session_normal_then_admin', 'tenant_a', 'feedback_admin_same_image'
    ) as proof
  `);
  assert.equal(sameImageProof.rows[0].proof.verified, true);
  assert.equal(sameImageProof.rows[0].proof.image_generation_hash_verified, true);
  assert.equal(sameImageProof.rows[0].proof.writer_final_replay_excluded, true);
  assert.equal(sameImageProof.rows[0].proof.active_writer_final_replay_source_count, 0);
  assert.equal(sameImageProof.rows[0].proof.active_admin_test_replay_for_image_count, 0);

  await client.query(String.raw`
      insert into public.v4_recognition_sessions(
        id, tenant_id, provider_result_summary
      ) values (
        'session_admin_only', 'tenant_a',
        jsonb_build_object('identity_cache_image_generation_hash', repeat('d', 64))
      );
      insert into public.v4_writer_feedback_events(
        id, tenant_id, recognition_session_id, writer_feedback
      ) values (
        'feedback_admin_only', 'tenant_a', 'session_admin_only',
        '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
      );
      insert into public.v4_learning_events(
        id, feedback_event_id, tenant_id, recognition_session_id,
        dataset_disposition, training_eligible, feedback_training_event
      ) values (
        'learning_admin_only', 'feedback_admin_only', 'tenant_a', 'session_admin_only',
        'OBSERVE_ONLY', false, '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
      );
      update public.v4_recognition_sessions
      set status = 'EDITED',
          writer_final_title = '1999 Admin Only Title',
          writer_feedback_event_id = 'feedback_admin_only'
      where id = 'session_admin_only';
    `);
  const adminOnly = await client.query(String.raw`
    select count(*)::integer as replay_count
    from public.listing_writer_final_replay
    where tenant_id = 'tenant_a'
      and image_generation_hash = repeat('d', 64)
  `);
  assert.equal(adminOnly.rows[0].replay_count, 0, "administrator-only feedback must create no replay row");

  const adminOnlyProof = await client.query(String.raw`
    select public.verify_v4_admin_test_feedback_isolation(
      'session_admin_only', 'tenant_a', 'feedback_admin_only'
    ) as proof
  `);
  assert.equal(adminOnlyProof.rows[0].proof.verified, true);
  assert.equal(adminOnlyProof.rows[0].proof.image_generation_hash_verified, true);
  assert.equal(adminOnlyProof.rows[0].proof.replay_source_count, 0);

  await client.query(String.raw`
    insert into public.v4_recognition_sessions(id, tenant_id)
    values ('session_admin_missing_hash', 'tenant_a');
    insert into public.v4_writer_feedback_events(
      id, tenant_id, recognition_session_id, writer_feedback
    ) values (
      'feedback_admin_missing_hash', 'tenant_a', 'session_admin_missing_hash',
      '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
    );
    insert into public.v4_learning_events(
      id, feedback_event_id, tenant_id, recognition_session_id,
      dataset_disposition, training_eligible, feedback_training_event
    ) values (
      'learning_admin_missing_hash', 'feedback_admin_missing_hash', 'tenant_a',
      'session_admin_missing_hash', 'OBSERVE_ONLY', false,
      '{"dataset_disposition":"ADMIN_TEST_ONLY"}'::jsonb
    );
    update public.v4_recognition_sessions
    set status = 'EDITED',
        writer_final_title = 'Admin Proof Missing Image Hash',
        writer_feedback_event_id = 'feedback_admin_missing_hash'
    where id = 'session_admin_missing_hash';
  `);
  const missingHashProof = await client.query(String.raw`
    select public.verify_v4_admin_test_feedback_isolation(
      'session_admin_missing_hash', 'tenant_a', 'feedback_admin_missing_hash'
    ) as proof
  `);
  assert.equal(missingHashProof.rows[0].proof.verified, false);
  assert.equal(missingHashProof.rows[0].proof.image_generation_hash_verified, false);

  await client.query(String.raw`
    insert into public.v4_recognition_sessions(
      id, tenant_id, provider_result_summary
    ) values
      ('session_unknown_disposition', 'tenant_a', jsonb_build_object(
        'identity_cache_image_generation_hash', repeat('e', 64)
      )),
      ('session_missing_feedback', 'tenant_a', jsonb_build_object(
        'identity_cache_image_generation_hash', repeat('f', 64)
      ));
    insert into public.v4_writer_feedback_events(
      id, tenant_id, recognition_session_id, writer_feedback
    ) values (
      'feedback_unknown_disposition', 'tenant_a', 'session_unknown_disposition',
      '{"dataset_disposition":"UNRECOGNIZED"}'::jsonb
    );
    update public.v4_recognition_sessions
    set status = 'EDITED',
        writer_final_title = 'Unknown Disposition Must Not Replay',
        writer_feedback_event_id = 'feedback_unknown_disposition'
    where id = 'session_unknown_disposition';
    update public.v4_recognition_sessions
    set status = 'EDITED',
        writer_final_title = 'Missing Feedback Must Not Replay',
        writer_feedback_event_id = 'feedback_does_not_exist'
    where id = 'session_missing_feedback';
  `);
  const failClosedReplay = await client.query(String.raw`
    select count(*)::integer as replay_count
    from public.listing_writer_final_replay
    where tenant_id = 'tenant_a'
      and image_generation_hash in (repeat('e', 64), repeat('f', 64))
  `);
  assert.equal(
    failClosedReplay.rows[0].replay_count,
    0,
    "missing and unknown feedback dispositions must fail closed outside replay authority"
  );

  const privileges = await client.query(String.raw`
    select
      has_function_privilege('anon', 'public.verify_v4_admin_test_feedback_isolation(text,text,text)', 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', 'public.verify_v4_admin_test_feedback_isolation(text,text,text)', 'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role', 'public.verify_v4_admin_test_feedback_isolation(text,text,text)', 'EXECUTE') as service_execute
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_execute: false,
    authenticated_execute: false,
    service_execute: true
  });

  await client.query("begin isolation level repeatable read read only");
  const productionSchemaSnapshot = await collectAdminTestReplayProductionSchemaSnapshot(client);
  const productionSchemaReport = evaluateAdminTestReplayProductionSchemaSnapshot(
    productionSchemaSnapshot
  );
  await client.query("rollback");
  assert.equal(
    productionSchemaReport.ok,
    true,
    `exact production schema attestation failed: ${JSON.stringify({
      checks: productionSchemaReport.checks,
      proof_definition: productionSchemaSnapshot.functions.find((row) => (
        row.signature === "public.verify_v4_admin_test_feedback_isolation(text,text,text)"
      ))?.definition
    })}`
  );

  console.log(JSON.stringify({
    ok: true,
    execution_mode: externalTestUrl ? "external_ephemeral_database" : "local_temporary_cluster",
    postgres_version: externalTestUrl ? `PostgreSQL ${serverVersionNum}` : postgres.version,
    historical_admin_replay_tombstoned: true,
    later_legitimate_replay_preserved: true,
    normal_feedback_created_replay: true,
    admin_feedback_did_not_overwrite_replay: true,
    admin_only_feedback_created_no_replay: true,
    proof_without_image_hash_failed_closed: true,
    missing_or_unknown_feedback_failed_closed: true,
    service_role_proof_boundary_verified: true,
    exact_production_schema_attested: true
  }, null, 2));
} finally {
  if (client) await client.end().catch(() => {});
  if (externalTestUrl && adminClient) {
    if (externalDatabaseName) {
      await adminClient.query(
        "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname = $1 and pid <> pg_catalog.pg_backend_pid()",
        [externalDatabaseName]
      ).catch(() => {});
      await adminClient.query(`drop database if exists "${externalDatabaseName}"`).catch(() => {});
    }
    for (const roleName of ["anon", "authenticated", "service_role"]) {
      if (externalRolePreexistence?.[roleName] === false) {
        await adminClient.query(`drop role if exists "${roleName}"`).catch(() => {});
      }
    }
    await adminClient.end().catch(() => {});
  }
  if (!externalTestUrl && (clusterStarted || fs.existsSync(path.join(dataDirectory, "postmaster.pid")))) {
    run(pgCtl, [
      "--pgdata", dataDirectory,
      "--wait",
      "--timeout", "60",
      "--mode", "fast",
      "stop"
    ]);
  }
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
