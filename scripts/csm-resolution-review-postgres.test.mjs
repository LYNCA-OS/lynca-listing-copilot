#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewMeasurementSnapshot
} from "../csm/contracts/resolution-review.mjs";
import { buildCsmResolutionView } from "../csm/contracts/resolution-view.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const root = new URL("..", import.meta.url).pathname;
const migrations = [
  "20260805080654_csm_resolution_reviews_v1.sql",
  "20260812055051_csm_resolution_review_measurement_v2.sql"
].map((name) => join(root,
  "infrastructure/supabase-production/supabase/migrations", name));
const dataDir = mkdtempSync(join(tmpdir(), "lynca-review-v2-pg-"));
const socketDir = mkdtempSync("/tmp/lynca-review-v2-socket-");
const port = 59_000 + (process.pid % 1_000);
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

function sqlAs(role, statement, options) {
  assert.match(role, /^(anon|authenticated|service_role)$/);
  return sql(`set role ${role}; ${statement}; reset role`, options);
}

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const nullableLiteral = (value) => value == null ? "null" : literal(value);
const parsed = parseCanonicalFields({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "",
  subjects: ["Shohei Ohtani"], card_name: "", release_variant: "",
  print_finish: "Gold Refractor", parallel_exact: "Gold Refractor",
  surface_color: "Gold", parallel_family: "Refractor",
  descriptive_rarity: "", card_number: "150", serial: "17/50",
  components: ["RC"], attributes: ["RC"], team: "Dodgers",
  grading_info: null, grade: "", grammar: "standard", lot_count: "",
  unreadable: [], low_confidence: []
}).fields;
const composed = composeFromCanonicalFields(parsed);
const baseSnapshot = buildReviewMeasurementSnapshot({
  view: buildCsmResolutionView({
    fields: parsed, composed, assetId: "asset-a",
    recognitionSessionId: "session-a"
  }),
  composerVersion: "composer-v1"
});
const snapshot = (overrides = {}) => structuredClone({
  ...baseSnapshot,
  view_version: "view-v1",
  ...overrides
});

function insertV2({ measurement = snapshot(), basis = "FIELD_REVIEWED", hash = "a".repeat(64) } = {}) {
  const measurementSql = measurement === null
    ? "null" : `${literal(JSON.stringify(measurement))}::jsonb`;
  return `insert into public.csm_resolution_reviews (
    schema_version, tenant_id, asset_id, recognition_session_id, resolution_id,
    output_id, resolver_version, composer_version, view_version, reviewer_id,
    verdict, corrections, original_fields, original_title, corrected_fields,
    corrected_title, excluded_from_metrics, note, revision_sha256, reviewed_at,
    measurement_basis, measurement_snapshot, measurement_snapshot_sha256
  ) values (
    'csm-resolution-review-v2', 'tenant-a', 'asset-a', 'session-a', 'resolution-a',
    'output-a', 'resolver-v1', 'composer-v1', 'view-v1', 'owner-a',
    'APPROVED', '[]'::jsonb, '{}'::jsonb, 'Title', '{}'::jsonb,
    'Title', false, '', '${"b".repeat(64)}', pg_catalog.now(),
    ${nullableLiteral(basis)}, ${measurementSql}, ${nullableLiteral(hash)}
  )`;
}

for (const binary of ["initdb", "pg_ctl", "psql"]) {
  try { command(binary, ["--version"]); } catch {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
    console.log(JSON.stringify({
      ok: true, skipped: true, reason: `${binary} is not available`,
      scope: "csm_resolution_review_postgres"
    }));
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
  sql("create role anon; create role authenticated; create role service_role bypassrls");
  for (const migration of migrations) {
    command("psql", [
      "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-f", migration
    ]);
  }
  // Plain Postgres does not include Supabase's API-role grants. Mirror those
  // grants here so the assertions exercise RLS and append-only rules instead
  // of stopping earlier at a table/schema permission error.
  sql(`
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema private to service_role;
    grant select, insert on public.csm_resolution_reviews to anon, authenticated;
    grant select, insert, update, delete on public.csm_resolution_reviews to service_role
  `);

  const validSnapshot = snapshot();
  const validSnapshotSql = `${literal(JSON.stringify(validSnapshot))}::jsonb`;
  assert.equal(sql(`select private.validate_csm_review_measurement_snapshot_v1(
    ${validSnapshotSql}, 'asset-a', 'session-a', 'view-v1', 'composer-v1'
  )`), "t");
  sql(insertV2());
  assert.equal(sql("select count(*) from public.csm_resolution_reviews"), "1");

  for (const role of ["anon", "authenticated"]) {
    assert.equal(sqlAs(role,
      "select count(*) from public.csm_resolution_reviews"), "0",
    `${role} must see zero reviews through RLS`);
    assert.match(sqlAs(role, `insert into public.csm_resolution_reviews (
      schema_version, tenant_id, asset_id, recognition_session_id, resolution_id,
      output_id, resolver_version, composer_version, view_version, reviewer_id,
      verdict, corrections, original_fields, original_title, corrected_fields,
      corrected_title, excluded_from_metrics, note, revision_sha256
    ) values (
      'csm-resolution-review-v1', 'tenant-denied', 'asset-denied', 'session-denied',
      'resolution-denied', 'output-denied', 'resolver-v1', 'composer-v1', 'view-v1',
      'reviewer-denied', 'APPROVED', '[]'::jsonb, '{}'::jsonb, 'Denied', '{}'::jsonb,
      'Denied', false, '', '${"d".repeat(64)}'
    )`, { expectFailure: true }), /row-level security/is,
    `${role} inserts must be rejected by RLS`);
  }

  sqlAs("service_role", insertV2());
  assert.equal(sqlAs("service_role",
    "select count(*) from public.csm_resolution_reviews"), "2",
  "service_role must insert and read through its Supabase BYPASSRLS boundary");

  for (const statement of [
    insertV2({ basis: null }),
    insertV2({ measurement: null }),
    insertV2({ hash: null }),
    insertV2({ basis: "TITLE_DERIVED" }),
    insertV2({ measurement: snapshot({ composer: undefined }) }),
    insertV2({ measurement: snapshot({ composer: {} }) }),
    insertV2({ measurement: snapshot({ extra_root: true }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, composer_version: null
    } }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, marketplace_profile_version: 7
    } }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, character_budget: "80"
    } }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, rendered_length: false
    } }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, extra_composer: true
    } }) }),
    insertV2({ measurement: snapshot({ brackets: undefined }) }),
    insertV2({ measurement: snapshot({ brackets: {} }) }),
    insertV2({ measurement: snapshot({ brackets: [{}] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], canonical_fields: []
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], rendered_text_present: null
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], state: "UNKNOWN"
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], composer_disposition: "UNKNOWN"
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], canonical_fields: ["subject", "subject"]
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], canonical_fields: ["subject", 7]
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [{
      ...snapshot().brackets[0], extra_bracket: true
    }] }) }),
    insertV2({ measurement: snapshot({ brackets: [
      snapshot().brackets[0], { ...snapshot().brackets[0] }
    ] }) }),
    insertV2({ measurement: snapshot({ asset_id: "asset-tampered" }) }),
    insertV2({ measurement: snapshot({ recognition_session_id: "session-tampered" }) }),
    insertV2({ measurement: snapshot({ view_version: "view-tampered" }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, composer_version: "composer-tampered"
    } }) }),
    insertV2({ measurement: snapshot({ schema_version: null }) }),
    insertV2({ measurement: snapshot({ measurement_basis: null }) }),
    insertV2({ measurement: snapshot({ grammar: "unknown" }) }),
    insertV2({ measurement: snapshot({ grammar: null }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, character_budget: -1
    } }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, rendered_length: 80.5
    } }) }),
    insertV2({ measurement: snapshot({ composer: {
      ...snapshot().composer, character_budget: 1, rendered_length: 2
    } }) }),
    insertV2({ measurement: snapshot({ brackets: snapshot().brackets.slice(1) }) }),
    insertV2({ measurement: snapshot({ brackets: [
      snapshot().brackets[1], snapshot().brackets[0], ...snapshot().brackets.slice(2)
    ] }) }),
    insertV2({ measurement: snapshot({ brackets: snapshot().brackets.map((row, index) => (
      index === 0 ? { ...row, canonical_fields: ["product"] } : row
    )) }) }),
    insertV2({ measurement: snapshot({ brackets: snapshot().brackets.map((row, index) => (
      index === 0 ? { ...row, publication_coverage: {
        ...row.publication_coverage, extra: 1
      } } : row
    )) }) }),
    insertV2({ measurement: snapshot({ brackets: snapshot().brackets.map((row) => (
      row.state === "VALUE" ? { ...row, partially_published: !row.partially_published } : row
    )) }) }),
    insertV2({ hash: "too-short" })
  ]) {
    assert.match(sql(statement, { expectFailure: true }),
      /csm_review_v2_measurement_complete/is,
      "a tampered v2 measurement receipt must fail the database boundary");
  }

  // Forward reader: historical v1 rows remain valid without manufactured v2
  // provenance or a history rewrite.
  sql(`insert into public.csm_resolution_reviews (
    schema_version, tenant_id, asset_id, recognition_session_id, resolution_id,
    output_id, resolver_version, composer_version, view_version, reviewer_id,
    verdict, corrections, original_fields, original_title, corrected_fields,
    corrected_title, excluded_from_metrics, note, revision_sha256
  ) values (
    'csm-resolution-review-v1', 'tenant-a', 'asset-old', 'session-old', 'resolution-old',
    'output-old', 'resolver-v1', 'composer-v1', 'view-v1', 'owner-a',
    'APPROVED', '[]'::jsonb, '{}'::jsonb, 'Old', '{}'::jsonb,
    'Old', false, '', '${"c".repeat(64)}'
  )`);
  assert.equal(sql("select count(*) from public.csm_resolution_reviews"), "3");
  assert.equal(sql(`select relrowsecurity from pg_class
    where oid = 'public.csm_resolution_reviews'::regclass`), "t");
  sqlAs("service_role", "update public.csm_resolution_reviews set note = 'mutated'");
  assert.equal(sqlAs("service_role",
    "select count(*) from public.csm_resolution_reviews where note = 'mutated'"), "0",
  "append-only UPDATE rule must preserve every review under service_role");
  sqlAs("service_role", "delete from public.csm_resolution_reviews");
  assert.equal(sqlAs("service_role",
    "select count(*) from public.csm_resolution_reviews"), "3",
  "append-only DELETE rule must preserve every review under service_role");
  process.stdout.write("csm resolution review postgres: ok\n");
} finally {
  if (started) {
    try { command("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true }); } catch {}
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
