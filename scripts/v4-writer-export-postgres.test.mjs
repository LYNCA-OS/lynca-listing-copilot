#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWriterExportObjectPath,
  buildWriterExportPersistenceRows,
  normalizeWriterExportRows
} from "../lib/listing/v4/export/writer-batch-export.mjs";

const root = new URL("..", import.meta.url).pathname;
const migration = join(
  root,
  "infrastructure/supabase-production/supabase/migrations/20260815131050_writer_export_operational_only_v1.sql"
);
const dataDir = mkdtempSync(join(tmpdir(), "lynca-writer-export-pg-"));
const socketDir = mkdtempSync("/tmp/lynca-writer-export-socket-");
const port = 60_000 + (process.pid % 1_000);
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertJsonRow(table, row, { expectFailure = false } = {}) {
  return sql(
    `insert into ${table} select * from jsonb_populate_record(null::${table}, ${sqlLiteral(JSON.stringify(row))}::jsonb)`,
    { expectFailure }
  );
}

for (const binary of ["initdb", "pg_ctl", "psql"]) {
  try {
    command(binary, ["--version"]);
  } catch {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: `${binary} is not available`,
      scope: "v4_writer_export_postgres"
    }));
    process.exit(0);
  }
}

const normalizedRows = normalizeWriterExportRows([{
  asset_id: "asset-a",
  asset_index: 1,
  recognition_session_id: "session-a",
  final_title: "2024 Topps Chrome Prospect Refractor Example Card",
  images: [{
    objectPath: "tenants/tenant_a/listing-assets/2026-08-15/asset-a/front.webp",
    bucket: "listing-card-images",
    originalType: "image/webp",
    storageVerified: true
  }]
}]);
const now = new Date("2026-08-15T12:00:00Z");

function persistenceRows(tenantId, batchId) {
  const objectPath = buildWriterExportObjectPath({ tenantId, batchId, now });
  return buildWriterExportPersistenceRows({
    tenantId,
    batchId,
    normalizedRows,
    exportedBy: "writer-a",
    bucket: "listing-card-images",
    objectPath,
    fileName: `${batchId}.xlsx`,
    fileSizeBytes: 2048,
    now
  });
}

try {
  command("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres"], { quiet: true });
  command("pg_ctl", [
    "-D", dataDir, "-o", `-p ${port} -k ${socketDir}`,
    "-l", join(dataDir, "server.log"), "-w", "start"
  ], { quiet: true });
  started = true;

  sql(`
    create table public.tenants (id text primary key);
    insert into public.tenants (id) values ('tenant_a'), ('tenant_b'), ('tenant_legacy');

    create table public.v4_writer_export_batches (
      id text primary key,
      tenant_id text not null references public.tenants(id) on delete restrict,
      schema_version text not null,
      status text not null,
      exported_by text,
      asset_count integer not null,
      item_count integer not null,
      storage_bucket text,
      storage_object_path text,
      file_name text,
      file_size_bytes bigint,
      manifest jsonb not null,
      unique (tenant_id, id)
    );

    create table public.v4_writer_export_items (
      id text primary key,
      tenant_id text not null references public.tenants(id) on delete restrict,
      export_batch_id text not null references public.v4_writer_export_batches(id) on delete cascade,
      recognition_session_id text,
      asset_id text,
      asset_index integer,
      final_title text not null,
      image_refs jsonb not null,
      training_use text not null default 'writer_export_reviewed_title',
      foreign key (tenant_id, export_batch_id)
        references public.v4_writer_export_batches(tenant_id, id) on delete cascade
    );
  `);

  const historical = persistenceRows("tenant_a", "writer_export_historical");
  historical.batchRow.manifest = {
    ...historical.batchRow.manifest,
    training_use: "reviewed_title_dataset_candidate",
    training_eligible: true
  };
  delete historical.batchRow.manifest.training_admission;
  historical.itemRows[0].training_use = "writer_export_reviewed_title";
  insertJsonRow("public.v4_writer_export_batches", historical.batchRow);
  historical.itemRows.forEach((row) => insertJsonRow("public.v4_writer_export_items", row));

  command("psql", [
    "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-f", migration
  ], { quiet: true });

  assert.equal(
    sql("select training_use from public.v4_writer_export_items where export_batch_id = 'writer_export_historical'"),
    "operational_only_never_training",
    "the migration must remove historical export-as-review labels"
  );
  assert.equal(
    sql("select manifest ->> 'training_admission' from public.v4_writer_export_batches where id = 'writer_export_historical'"),
    "requires_independent_persisted_review_event"
  );
  assert.match(
    sql(`select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'v4_writer_export_items'
        and column_name = 'training_use'`),
    /operational_only_never_training/
  );
  assert.equal(
    sql(`select bool_and(convalidated) from pg_catalog.pg_constraint
      where conname in (
        'v4_writer_export_items_operational_only_training_use',
        'v4_writer_export_batches_operational_only_manifest'
      )`),
    "t",
    "both never-training constraints must be validated, not merely declared"
  );

  const tenantA = persistenceRows("tenant_a", "writer_export_postgres_a");
  insertJsonRow("public.v4_writer_export_batches", tenantA.batchRow);
  tenantA.itemRows.forEach((row) => insertJsonRow("public.v4_writer_export_items", row));

  assert.equal(
    sql("select tenant_id from public.v4_writer_export_batches where id = 'writer_export_postgres_a'"),
    "tenant_a"
  );
  assert.equal(
    sql("select tenant_id from public.v4_writer_export_items where export_batch_id = 'writer_export_postgres_a'"),
    "tenant_a"
  );
  assert.equal(
    sql("select training_use from public.v4_writer_export_items where export_batch_id = 'writer_export_postgres_a'"),
    "operational_only_never_training"
  );
  assert.equal(
    sql("select manifest ->> 'training_eligible' from public.v4_writer_export_batches where id = 'writer_export_postgres_a'"),
    "false"
  );
  assert.equal(
    sql("select manifest ->> 'training_admission' from public.v4_writer_export_batches where id = 'writer_export_postgres_a'"),
    "requires_independent_persisted_review_event"
  );

  assert.match(
    sql(`insert into public.v4_writer_export_items (
      id, tenant_id, export_batch_id, final_title, image_refs
    ) values (
      'writer_export_invalid_conflict_target', 'tenant_a', 'writer_export_postgres_a',
      'Operational title', '[]'::jsonb
    ) on conflict (tenant_id, id) do nothing`, { expectFailure: true }),
    /no unique or exclusion constraint matching the ON CONFLICT specification/is,
    "the deployed item schema must not be called with the nonexistent tenant_id,id conflict target"
  );
  sql(`insert into public.v4_writer_export_items (
    id, tenant_id, export_batch_id, final_title, image_refs
  ) values (
    'writer_export_valid_conflict_target', 'tenant_a', 'writer_export_postgres_a',
    'Operational title', '[]'::jsonb
  ) on conflict (id) do update set final_title = excluded.final_title`);

  sql(`insert into public.v4_writer_export_items (
    id, tenant_id, export_batch_id, final_title, image_refs
  ) values (
    'writer_export_default_safe', 'tenant_a', 'writer_export_postgres_a',
    'Operational title', '[]'::jsonb
  )`);
  assert.equal(
    sql("select training_use from public.v4_writer_export_items where id = 'writer_export_default_safe'"),
    "operational_only_never_training",
    "a caller that omits training_use must still fail safe"
  );

  const syntheticReviewedItem = {
    ...tenantA.itemRows[0],
    id: `${tenantA.itemRows[0].id}_synthetic_review`,
    training_use: "writer_export_reviewed_title"
  };
  assert.match(
    insertJsonRow("public.v4_writer_export_items", syntheticReviewedItem, { expectFailure: true }),
    /v4_writer_export_items_operational_only_training_use/is,
    "no export caller may synthesize review evidence"
  );

  const syntheticReviewedBatch = {
    ...tenantA.batchRow,
    id: "writer_export_synthetic_review",
    manifest: {
      ...tenantA.batchRow.manifest,
      training_use: "reviewed_title_dataset_candidate",
      training_eligible: true
    }
  };
  assert.match(
    insertJsonRow("public.v4_writer_export_batches", syntheticReviewedBatch, { expectFailure: true }),
    /v4_writer_export_batches_operational_only_manifest/is,
    "an export batch cannot become a dataset candidate without a separate review event"
  );

  const missingTenantBatch = { ...tenantA.batchRow, id: "writer_export_missing_tenant" };
  delete missingTenantBatch.tenant_id;
  assert.match(
    insertJsonRow("public.v4_writer_export_batches", missingTenantBatch, { expectFailure: true }),
    /null value in column "tenant_id".*violates not-null constraint/is,
    "an omitted tenant must fail closed on the deployed Postgres contract"
  );

  const crossTenantItem = {
    ...tenantA.itemRows[0],
    id: `${tenantA.itemRows[0].id}_cross_tenant`,
    tenant_id: "tenant_b"
  };
  assert.match(
    insertJsonRow("public.v4_writer_export_items", crossTenantItem, { expectFailure: true }),
    /foreign key constraint/is,
    "an item cannot borrow an export batch from another tenant"
  );

  const legacy = persistenceRows("tenant_legacy", "writer_export_postgres_legacy");
  insertJsonRow("public.v4_writer_export_batches", legacy.batchRow);
  legacy.itemRows.forEach((row) => insertJsonRow("public.v4_writer_export_items", row));
  assert.equal(
    sql("select storage_object_path from public.v4_writer_export_batches where id = 'writer_export_postgres_legacy'"),
    "tenants/tenant_legacy/exports/writer-batches/2026/08/writer_export_postgres_legacy.xlsx",
    "legacy compatibility remains available but receives its own object namespace"
  );

  assert.equal(
    sql("select count(*) from public.v4_writer_export_items where training_use ~* 'reviewed_title|dataset_candidate'"),
    "0",
    "operational exports must never masquerade as independently persisted reviews"
  );
  process.stdout.write("v4 writer export postgres: ok\n");
} finally {
  if (started) {
    try {
      command("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true });
    } catch {}
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
