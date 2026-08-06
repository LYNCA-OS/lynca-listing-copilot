#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  buildCsmStageRows, CSM_STAGE_CONTRACT_VERSION, computeCsmPacketHashes,
  EBAY_PROFILE_VERSION, THIN_COMPOSER_VERSION, THIN_RESOLVER_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";

const root = new URL("..", import.meta.url).pathname;
const migrationDir = join(root, "infrastructure/supabase-production/supabase/migrations");
const oldMigrations = [
  "20260801065544_csm_stage_shadow_foundation_v1.sql",
  "20260801065941_csm_marketplace_trace_object.sql",
  "20260801071129_csm_empty_canonical_sql_null.sql",
  "20260801094353_csm_atomic_stage_packet_v1.sql"
].map((name) => join(migrationDir, name));
const projectionMigration = join(
  migrationDir, "20260801121955_csm_session_product_projection_v1.sql"
);

const dataDir = mkdtempSync(join(tmpdir(), "lynca-csm-product-projection-pg-"));
// PostgreSQL's Unix-socket path limit is much shorter than macOS's generated
// per-user tmp path. Keep only the socket directory under the short /tmp link.
const socketDir = mkdtempSync("/tmp/lynca-csm-projection-socket-");
const port = 56_000 + (process.pid % 4_000);
let started = false;

function command(name, args, options = {}) {
  try {
    return String(execFileSync(name, args, {
      cwd: root,
      encoding: "utf8",
      // A locale the harness supplies, rather than whatever the caller happens
      // to export. With neither LC_ALL nor LANG set -- the default in a
      // non-login shell on macOS -- the postmaster goes multithreaded during
      // startup and refuses to run, and pg_ctl fails with no message of its
      // own, so the suite read as a missing PostgreSQL when PostgreSQL was
      // installed and working. "C" so collation order is the same everywhere.
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      stdio: options.capture === false ? "ignore" : ["ignore", "pipe", "pipe"]
    }) ?? "").trim();
  } catch (error) {
    error.commandOutput = [error?.stdout, error?.stderr]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
    throw error;
  }
}

function psqlArgs(database = "postgres") {
  return ["-h", socketDir, "-p", String(port), "-U", "postgres", "-d", database];
}

function sql(statement, database = "postgres") {
  return command("psql", [
    ...psqlArgs(database), "-v", "ON_ERROR_STOP=1", "-Atqc", statement
  ]);
}

function json(statement, database = "postgres") {
  return JSON.parse(sql(statement, database));
}

function applyMigration(file, database = "postgres", { expectFailure = false } = {}) {
  try {
    command("psql", [
      ...psqlArgs(database), "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", file
    ]);
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error?.commandOutput || error?.stderr || error?.message || error);
  }
  if (expectFailure) throw new Error(`migration_unexpectedly_succeeded:${file}`);
  return "";
}

function expectSqlFailure(statement, pattern, database = "postgres") {
  let failure = "";
  try {
    sql(statement, database);
  } catch (error) {
    failure = String(error?.commandOutput || error?.stderr || error?.message || error);
  }
  assert.match(failure, pattern);
}

function literal(value) {
  if (value === null) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bootstrapDatabase(database) {
  sql(`
    create schema private;
    create table public.v4_recognition_sessions (
      id text primary key,
      schema_version text not null,
      status text not null,
      tenant_id text not null,
      final_title text,
      resolved_fields jsonb not null default '{}'::jsonb,
      provider_result_summary jsonb not null default '{}'::jsonb,
      writer_feedback_event_id text,
      updated_at timestamptz not null default pg_catalog.clock_timestamp()
    );
    create unique index v4_recognition_sessions_tenant_id_id_uidx
      on public.v4_recognition_sessions(tenant_id, id);
  `, database);
  for (const migration of oldMigrations) applyMigration(migration, database);
}

const observed = parseCanonicalFields({
  year: "2025", ip: "Pokemon", language: "JP", manufacturer: "", product: "",
  set: "Mega Brave", subjects: ["Mega Absol Ex"], team: "", card_name: "",
  release_variant: "", surface_color: "", parallel_family: "",
  parallel_exact: "", descriptive_rarity: "Special Art Rare",
  card_number: "089/063", serial: "", attributes: [], grade: "CGC 10",
  grammar: "tcg", lot_count: "", unreadable: [], low_confidence: []
}).fields;
const composed = composeFromCanonicalFields(observed);

function stageRows(sessionId, tenantId = "tenant-1") {
  return buildCsmStageRows({
    tenantId,
    recognitionSessionId: sessionId,
    fields: observed,
    composed,
    title: composed.title,
    createdAt: "2026-08-01T12:00:00Z"
  });
}

function sessionPatch(rows) {
  return {
    csm_contract_version: CSM_STAGE_CONTRACT_VERSION,
    csm_registry_release_id: rows.resolution.registry_release_id,
    csm_grammar: rows.resolution.grammar,
    csm_grammar_confidence: 0.8,
    recognition_pipeline_fingerprint: "f".repeat(64),
    csm_owner_versions: {
      provider: "openai",
      model: "gpt-5.6-luna",
      effort: "none",
      image_detail: "high",
      prompt_version: "csm-canonical-fields-v1",
      provider_response_id: "resp_product_projection",
      provider_request_id: "req_product_projection",
      provider_client_request_id: "lynca_product_projection",
      latency_ms: 2450,
      input_tokens: 5000,
      output_tokens: 120,
      total_tokens: 5120,
      resolver: THIN_RESOLVER_VERSION,
      composer: THIN_COMPOSER_VERSION,
      marketplace_profile: EBAY_PROFILE_VERSION
    },
    csm_recognition_stage_status: "COMPLETE",
    csm_resolution_stage_status: "COMPLETE",
    csm_composition_stage_status: "COMPLETE",
    ...rows.session_hashes
  };
}

function createSession(sessionId, {
  database = "postgres", schemaVersion = "csm-recognition-session-v1"
} = {}) {
  sql(`insert into public.v4_recognition_sessions (
      id, schema_version, status, tenant_id
    ) values (
      ${literal(sessionId)}, ${literal(schemaVersion)}, 'CREATED', 'tenant-1'
    )`, database);
}

function persist(rows, database = "postgres", { expectFailure = null } = {}) {
  const statement = `select public.persist_csm_stage_packet_v1(
    ${literal(rows.resolution.tenant_id)},
    ${literal(rows.resolution.recognition_session_id)},
    ${literal(JSON.stringify(rows))}::jsonb,
    ${literal(JSON.stringify(sessionPatch(rows)))}::jsonb
  )::text`;
  if (expectFailure) {
    expectSqlFailure(statement, expectFailure, database);
    return null;
  }
  return json(statement, database);
}

function productRow(sessionId, database = "postgres") {
  return json(`select pg_catalog.jsonb_build_object(
    'schema_version', schema_version,
    'status', status,
    'final_title', final_title,
    'resolved_fields', resolved_fields,
    'provider_result_summary', provider_result_summary,
    'stage', csm_composition_stage_status
  )::text
  from public.v4_recognition_sessions where id = ${literal(sessionId)}`, database);
}

function replaceProjectionTrigger(whenExpression, database = "postgres") {
  sql(`
    drop trigger project_csm_session_product_read_model_v1
      on public.v4_recognition_sessions;
    create trigger project_csm_session_product_read_model_v1
    before update of csm_composition_stage_status
    on public.v4_recognition_sessions
    for each row
    when (${whenExpression})
    execute function private.project_csm_session_product_read_model_v1();
  `, database);
}

for (const binary of ["initdb", "pg_ctl", "psql"]) {
  try {
    command(binary, ["--version"]);
  } catch {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
    process.stdout.write(JSON.stringify({
      ok: true,
      skipped: true,
      reason: `${binary} is not available`,
      scope: "csm_product_projection_postgres"
    }) + "\n");
    process.exit(0);
  }
}

try {
  command("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres"], { capture: false });
  command("pg_ctl", [
    "-D", dataDir, "-o", `-p ${port} -k ${socketDir}`,
    "-l", join(dataDir, "server.log"), "-w", "start"
  ]);
  started = true;
  assert.ok(Number(sql("show server_version_num")) >= 170000, "the behavior test requires PostgreSQL 17+");
  sql("create role anon; create role authenticated; create role service_role");
  bootstrapDatabase("postgres");

  // Establish the actual defect before applying the new migration: the atomic
  // graph commits, but the product row remains CREATED and empty.
  for (const sessionId of ["backfill-pristine", "backfill-identical"]) {
    createSession(sessionId);
    assert.equal(persist(stageRows(sessionId)).code, "inserted");
  }
  const before = productRow("backfill-pristine");
  assert.equal(before.stage, "COMPLETE");
  assert.equal(before.status, "CREATED");
  assert.equal(before.final_title, null);
  assert.deepEqual(before.resolved_fields, {});

  const identicalRows = stageRows("backfill-identical");
  sql(`update public.v4_recognition_sessions
    set status = 'WRITER_REVIEW',
        final_title = ${literal(identicalRows.output.title)},
        resolved_fields = ${literal(JSON.stringify(identicalRows.output.structured_output.sem))}::jsonb,
        provider_result_summary = '{"keep":"existing"}'::jsonb
    where id = 'backfill-identical'`);

  // A legacy V4 row may carry CSM facts during convergence, but this migration
  // is not allowed to reinterpret its product workflow.
  createSession("legacy-session", { schemaVersion: "v4-recognition-session-v4" });
  assert.equal(persist(stageRows("legacy-session")).code, "inserted");

  applyMigration(projectionMigration);
  assert.equal(sql(`select pg_catalog.count(*) from pg_catalog.pg_trigger
    where tgrelid = 'public.v4_recognition_sessions'::regclass
      and tgname = 'project_csm_session_product_read_model_v1'
      and not tgisinternal`), "1");
  assert.equal(sql(`select has_function_privilege(
    'service_role', 'public.check_csm_session_product_projection_v1()', 'EXECUTE'
  )`), "t");
  assert.equal(sql(`select has_function_privilege(
    'anon', 'public.check_csm_session_product_projection_v1()', 'EXECUTE'
  )`), "f");
  let readiness = json("select public.check_csm_session_product_projection_v1()::text");
  assert.deepEqual(readiness, {
    ok: true,
    code: "csm_product_projection_ready",
    version: "csm-session-product-projection-v1"
  });
  sql(`alter table public.v4_recognition_sessions
    disable trigger project_csm_session_product_read_model_v1`);
  readiness = json("select public.check_csm_session_product_projection_v1()::text");
  assert.equal(readiness.ok, false);
  assert.equal(readiness.code, "csm_product_projection_not_ready");
  sql(`alter table public.v4_recognition_sessions
    enable trigger project_csm_session_product_read_model_v1`);
  assert.equal(json(
    "select public.check_csm_session_product_projection_v1()::text"
  ).ok, true);

  // Preserve every trigger property the old readiness probe checked, but
  // replace only tgqual. The live probe must reject this inert same-name,
  // same-function trigger and recover only after the exact WHEN is restored.
  replaceProjectionTrigger("false");
  assert.match(sql(`select pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.v4_recognition_sessions'::regclass
      and trigger_row.tgname = 'project_csm_session_product_read_model_v1'
      and not trigger_row.tgisinternal`), / WHEN \(false\) /);
  assert.equal(sql(`select
      trigger_row.tgenabled in ('O', 'A')
      and trigger_row.tgfoid = 'private.project_csm_session_product_read_model_v1()'::regprocedure
      and trigger_row.tgtype = 19
      and trigger_row.tgattr::text = attribute.attnum::text
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = trigger_row.tgrelid
     and attribute.attname = 'csm_composition_stage_status'
     and not attribute.attisdropped
    where trigger_row.tgrelid = 'public.v4_recognition_sessions'::regclass
      and trigger_row.tgname = 'project_csm_session_product_read_model_v1'
      and not trigger_row.tgisinternal`), "t",
  "the tampered trigger must differ only in its WHEN expression");
  readiness = json("select public.check_csm_session_product_projection_v1()::text");
  assert.equal(readiness.ok, false);
  assert.equal(readiness.code, "csm_product_projection_not_ready");

  replaceProjectionTrigger(`
    new.schema_version = 'csm-recognition-session-v1'
    and new.csm_composition_stage_status = 'COMPLETE'
  `);
  assert.equal(json(
    "select public.check_csm_session_product_projection_v1()::text"
  ).ok, true, "restoring the exact trigger condition must restore readiness");

  for (const sessionId of ["backfill-pristine", "backfill-identical"]) {
    const row = productRow(sessionId);
    const expected = stageRows(sessionId).output;
    assert.equal(row.status, "WRITER_REVIEW");
    assert.equal(row.final_title, expected.title);
    assert.deepEqual(row.resolved_fields, expected.structured_output.sem);
    assert.equal(row.provider_result_summary.csm_product_projection_version,
      "csm-session-product-projection-v1");
    assert.equal(row.provider_result_summary.provider, "openai");
    assert.equal(row.provider_result_summary.model, "gpt-5.6-luna");
    assert.equal(row.provider_result_summary.prompt_version, "csm-canonical-fields-v1");
    assert.equal(row.provider_result_summary.provider_response_id, "resp_product_projection");
    assert.equal(row.provider_result_summary.provider_request_id, "req_product_projection");
    assert.equal(row.provider_result_summary.provider_client_request_id, "lynca_product_projection");
    assert.equal(row.provider_result_summary.latency_ms, 2450);
    assert.equal(row.provider_result_summary.input_tokens, 5000);
    assert.equal(row.provider_result_summary.output_tokens, 120);
    assert.equal(row.provider_result_summary.total_tokens, 5120);
    assert.equal(row.provider_result_summary.title_length_policy.max_length, 80);
  }
  assert.equal(productRow("backfill-identical").provider_result_summary.keep, "existing",
    "the projection must preserve unrelated product summary data");
  assert.deepEqual(productRow("legacy-session"), {
    schema_version: "v4-recognition-session-v4",
    status: "CREATED",
    final_title: null,
    resolved_fields: {},
    provider_result_summary: {},
    stage: "COMPLETE"
  });

  // New RPC writes now commit the immutable graph and product view together.
  createSession("atomic-product");
  assert.equal(persist(stageRows("atomic-product")).code, "inserted");
  const atomicProduct = productRow("atomic-product");
  assert.equal(atomicProduct.status, "WRITER_REVIEW");
  assert.equal(atomicProduct.final_title, stageRows("atomic-product").output.title);
  assert.deepEqual(atomicProduct.resolved_fields,
    stageRows("atomic-product").output.structured_output.sem);

  // An invalid SEM projection aborts the whole RPC: no child facts and no
  // COMPLETE marker survive the failed transaction.
  createSession("invalid-sem");
  const invalidRows = stageRows("invalid-sem");
  invalidRows.output.structured_output.sem = "not-an-object";
  invalidRows.session_hashes = computeCsmPacketHashes(invalidRows);
  persist(invalidRows, "postgres", {
    expectFailure: /csm_product_projection_requires_sem_object/
  });
  assert.equal(sql(`select pg_catalog.count(*) from public.csm_marketplace_outputs
    where recognition_session_id = 'invalid-sem'`), "0");
  assert.equal(productRow("invalid-sem").stage, "NOT_STARTED");

  // The late migration itself refuses to overwrite a pre-existing, divergent
  // product view and rolls its trigger/function back as one transaction.
  sql("create database projection_conflict");
  bootstrapDatabase("projection_conflict");
  createSession("conflicting-backfill", { database: "projection_conflict" });
  persist(stageRows("conflicting-backfill"), "projection_conflict");
  sql(`update public.v4_recognition_sessions
    set status = 'DRAFT_READY',
        final_title = 'Writer-owned title',
        resolved_fields = '{"subject":"Writer-owned"}'::jsonb,
        provider_result_summary = '{"keep":true}'::jsonb
    where id = 'conflicting-backfill'`, "projection_conflict");
  const migrationFailure = applyMigration(
    projectionMigration, "projection_conflict", { expectFailure: true }
  );
  assert.match(migrationFailure,
    /csm_product_projection_backfill_requires_remediation:conflicting-backfill/);
  assert.equal(sql(`select pg_catalog.to_regprocedure(
    'private.project_csm_session_product_read_model_v1()'
  ) is null`, "projection_conflict"), "t",
  "a failed migration must leave no partially installed trigger function");
  assert.equal(productRow("conflicting-backfill", "projection_conflict").final_title,
    "Writer-owned title");

  process.stdout.write(JSON.stringify({
    ok: true,
    postgres: sql("show server_version"),
    backfilled_sessions: 2,
    atomic_projection: true,
    live_readiness_probe: true,
    trigger_condition_tamper_rejected: true,
    legacy_scope_guard: true,
    invalid_sem_rolled_back: true,
    conflicting_backfill_rejected: true
  }) + "\n");
} finally {
  if (started) {
    try {
      command("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], { capture: false });
    } catch {
      // The temporary cluster is removed below; preserve the test failure.
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
