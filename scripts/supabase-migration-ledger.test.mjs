#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROLLED_PATH_ACK,
  buildMigrationLedgerAudit,
  controlledMigrationDecision,
  dbPushGuardDecision,
  normalizeFetchedSql,
  renderMigrationLedgerMarkdown
} from "./supabase-migration-ledger.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = await mkdtemp(join(tmpdir(), "supabase-ledger-test-"));
const localDir = join(fixtureRoot, "local");
const remoteDir = join(fixtureRoot, "remote");
await Promise.all([mkdir(localDir), mkdir(remoteDir)]);

try {
  await Promise.all([
    writeFile(join(localDir, "20260101000000_shared.sql"), "select 1;\n"),
    writeFile(join(localDir, "20260102000000_alias.sql"), "select 2;\n"),
    writeFile(join(localDir, "20260103000000_duplicate_a.sql"), "select 3;\n"),
    writeFile(join(localDir, "20260103000000_duplicate_b.sql"), "select 4;\n"),
    writeFile(join(localDir, "20260105000000_new_delta.sql"), "select 5;\n"),
    writeFile(join(remoteDir, "20260101000000_shared.sql"), "select 1;\n"),
    writeFile(join(remoteDir, "20260101010000_alias.sql"), "select 2;\n;\n"),
    writeFile(join(remoteDir, "20260104000000_remote_only.sql"), "select 4;\n")
  ]);
  const receipt = {
    receipt_id: "test:alias",
    project_ref: "test-ref",
    migration_name: "alias",
    normalization_profile: "sql-line-endings-trailing-space-empty-tail-v1",
    local: {
      version: "20260102000000",
      filename: "20260102000000_alias.sql",
      sha256: "ac4396cdee0295db27f816dc31134189999d0071663e618f4957bc23edb584d7",
      normalized_sha256: "ac4396cdee0295db27f816dc31134189999d0071663e618f4957bc23edb584d7"
    },
    remote: {
      version: "20260101010000",
      filename: "20260101010000_alias.sql",
      sha256: "f1fd9f7d23350c72b29b2258f3c8a8747a4b67f9ac6e86bd31cd78cf0c3a4318",
      normalized_sha256: "ac4396cdee0295db27f816dc31134189999d0071663e618f4957bc23edb584d7"
    },
    safety: {
      ddl_already_applied: true,
      ddl_reapply_forbidden: true,
      migration_history_repair_forbidden: true
    }
  };
  const audit = await buildMigrationLedgerAudit({
    localDir,
    remoteDir,
    projectRef: "test-ref",
    generatedAt: "2026-08-01T00:00:00.000Z",
    cliVersion: "test",
    receipt,
    linkedListRemoteVersions: ["20260101000000", "20260101010000", "20260104000000"]
  });
  assert.equal(audit.summary.local_file_count, 5);
  assert.equal(audit.summary.local_version_count, 4);
  assert.equal(audit.summary.remote_file_count, 3);
  assert.equal(audit.summary.shared_version_count, 1);
  assert.equal(audit.summary.local_only_version_count, 3);
  assert.equal(audit.summary.remote_only_version_count, 2);
  assert.equal(audit.summary.duplicate_local_version_count, 1);
  assert.equal(audit.summary.ledger_exact, false);
  assert.equal(audit.receipt_validation.ok, true);
  const alias = audit.same_name_different_version_mappings.find((entry) => entry.name === "alias");
  assert.equal(alias.content.classification, "normalized_equivalent");
  assert.equal(dbPushGuardDecision(audit).db_push_allowed, false);
  assert.equal(
    controlledMigrationDecision(audit, "20260102000000_alias.sql", CONTROLLED_PATH_ACK).decision,
    "controlled_migration_already_applied_under_different_version"
  );
  assert.equal(
    controlledMigrationDecision(audit, "20260103000000_duplicate_a.sql", CONTROLLED_PATH_ACK).decision,
    "controlled_migration_version_not_unique"
  );
  assert.equal(
    controlledMigrationDecision(audit, "20260105000000_new_delta.sql", "").decision,
    "controlled_path_acknowledgement_missing"
  );
  assert.equal(
    controlledMigrationDecision(
      audit,
      "20260105000000_new_delta.sql",
      CONTROLLED_PATH_ACK
    ).decision,
    "controlled_migration_has_unreconciled_predecessors",
    "a reviewed target may not jump over any divergent earlier ledger entry"
  );
  const rendered = `${JSON.stringify(audit)}\n${renderMigrationLedgerMarkdown(audit)}`;
  assert.doesNotMatch(rendered, new RegExp(fixtureRoot));
  assert.doesNotMatch(rendered, /select 2/);

  const exactLocal = join(fixtureRoot, "exact-local");
  const exactRemote = join(fixtureRoot, "exact-remote");
  await Promise.all([mkdir(exactLocal), mkdir(exactRemote)]);
  await Promise.all([
    writeFile(join(exactLocal, "20260101000000_one.sql"), "select 1;\n"),
    writeFile(join(exactRemote, "20260101000000_one.sql"), "select 1;\n;\n")
  ]);
  const exact = await buildMigrationLedgerAudit({
    localDir: exactLocal,
    remoteDir: exactRemote,
    projectRef: "test-ref",
    generatedAt: "2026-08-01T00:00:00.000Z",
    cliVersion: "test",
    linkedListRemoteVersions: ["20260101000000"]
  });
  assert.equal(exact.summary.ledger_exact, true);
  assert.equal(dbPushGuardDecision(exact).db_push_allowed, true);
  assert.equal(normalizeFetchedSql("select 1;\r\n;\r\n"), "select 1;\n");

  const liveLocal = await readFile(join(
    repoRoot,
    "infrastructure/supabase-production/supabase/migrations/20260801094353_csm_atomic_stage_packet_v1.sql"
  ), "utf8");
  const receiptFixtureLocal = join(fixtureRoot, "receipt-local");
  const receiptFixtureRemote = join(fixtureRoot, "receipt-remote");
  await Promise.all([mkdir(receiptFixtureLocal), mkdir(receiptFixtureRemote)]);
  await Promise.all([
    writeFile(join(receiptFixtureLocal, "20260801094353_csm_atomic_stage_packet_v1.sql"), liveLocal),
    writeFile(join(receiptFixtureRemote, "20260801094353_csm_atomic_stage_packet_v1.sql"), liveLocal)
  ]);
  const pinnedReceipt = JSON.parse(await readFile(
    join(repoRoot, "docs/operations/supabase-migration-receipt-csm-atomic-stage-packet-v1.json"),
    "utf8"
  ));
  const receiptAudit = await buildMigrationLedgerAudit({
    localDir: receiptFixtureLocal,
    remoteDir: receiptFixtureRemote,
    projectRef: pinnedReceipt.project_ref,
    generatedAt: "2026-08-01T00:00:00.000Z",
    cliVersion: "test",
    receipt: pinnedReceipt,
    linkedListRemoteVersions: ["20260801094353"]
  });
  assert.equal(receiptAudit.receipt_validation.ok, true);
  assert.equal(receiptAudit.receipt_validation.local_version, "20260801094353");
  assert.equal(receiptAudit.receipt_validation.remote_version, "20260801094353");
  assert.equal(
    controlledMigrationDecision(
      receiptAudit,
      "20260801094353_csm_atomic_stage_packet_v1.sql",
      CONTROLLED_PATH_ACK
    ).decision,
    "controlled_migration_version_already_remote"
  );

  const canonicalLocal = join(fixtureRoot, "canonical-local");
  await mkdir(canonicalLocal);
  await writeFile(
    join(canonicalLocal, "20260801094353_csm_atomic_stage_packet_v1.sql"),
    liveLocal
  );
  const canonicalAudit = await buildMigrationLedgerAudit({
    localDir: canonicalLocal,
    remoteDir: receiptFixtureRemote,
    projectRef: pinnedReceipt.project_ref,
    generatedAt: "2026-08-01T00:00:00.000Z",
    cliVersion: "test",
    receipt: pinnedReceipt,
    linkedListRemoteVersions: ["20260801094353"]
  });
  assert.equal(canonicalAudit.receipt_validation.mode, "canonical_remote_projection");
  assert.equal(dbPushGuardDecision(canonicalAudit).db_push_allowed, true);

  const providerAdmissionMigration = "20260801101152_csm_thin_provider_admission_v1.sql";
  const providerPacerMigration = "20260801115421_csm_thin_provider_pacer_v1.sql";
  const productProjectionMigration = "20260801121955_csm_session_product_projection_v1.sql";
  const canonicalMigrationDir = join(
    repoRoot,
    "infrastructure/supabase-production/supabase/migrations"
  );
  const [providerAdmissionSql, providerPacerSql, productProjectionSql] = await Promise.all([
    readFile(join(canonicalMigrationDir, providerAdmissionMigration), "utf8"),
    readFile(join(canonicalMigrationDir, providerPacerMigration), "utf8"),
    readFile(join(canonicalMigrationDir, productProjectionMigration), "utf8")
  ]);
  const pacerLocal = join(fixtureRoot, "pacer-local");
  const pacerRemote = join(fixtureRoot, "pacer-remote");
  await Promise.all([mkdir(pacerLocal), mkdir(pacerRemote)]);
  await Promise.all([
    writeFile(join(pacerLocal, providerAdmissionMigration), providerAdmissionSql),
    writeFile(join(pacerLocal, providerPacerMigration), providerPacerSql),
    writeFile(join(pacerRemote, providerAdmissionMigration), providerAdmissionSql)
  ]);
  const pacerAudit = await buildMigrationLedgerAudit({
    localDir: pacerLocal,
    remoteDir: pacerRemote,
    projectRef: "test-ref",
    generatedAt: "2026-08-01T00:00:00.000Z",
    cliVersion: "test",
    linkedListRemoteVersions: ["20260801101152"]
  });
  assert.equal(pacerAudit.summary.local_only_version_count, 1);
  assert.equal(pacerAudit.summary.remote_only_version_count, 0);
  assert.equal(pacerAudit.summary.ledger_exact, false);
  assert.equal(dbPushGuardDecision(pacerAudit).db_push_allowed, false);
  const pacerDecision = controlledMigrationDecision(
    pacerAudit,
    providerPacerMigration,
    CONTROLLED_PATH_ACK
  );
  assert.equal(pacerDecision.ok, true);
  assert.equal(pacerDecision.decision, "controlled_single_migration_only");
  assert.equal(pacerDecision.db_push_allowed, false);
  assert.equal(pacerDecision.controlled_single_migration_allowed, true);
  assert.equal(pacerDecision.migration.filename, providerPacerMigration);

  // A newer reviewed migration may exist locally, but it cannot skip the
  // unapplied pacer predecessor. Once a freshly fetched remote ledger contains
  // pacer, the exact same single-migration guard admits projection next.
  await writeFile(join(pacerLocal, productProjectionMigration), productProjectionSql);
  const orderedAudit = await buildMigrationLedgerAudit({
    localDir: pacerLocal,
    remoteDir: pacerRemote,
    projectRef: "test-ref",
    generatedAt: "2026-08-01T00:00:00.000Z",
    cliVersion: "test",
    linkedListRemoteVersions: ["20260801101152"]
  });
  assert.equal(
    controlledMigrationDecision(
      orderedAudit,
      productProjectionMigration,
      CONTROLLED_PATH_ACK
    ).decision,
    "controlled_migration_has_unreconciled_predecessors"
  );
  await writeFile(join(pacerRemote, providerPacerMigration), providerPacerSql);
  const refreshedAudit = await buildMigrationLedgerAudit({
    localDir: pacerLocal,
    remoteDir: pacerRemote,
    projectRef: "test-ref",
    generatedAt: "2026-08-01T00:01:00.000Z",
    cliVersion: "test",
    linkedListRemoteVersions: ["20260801101152", "20260801115421"]
  });
  const projectionDecision = controlledMigrationDecision(
    refreshedAudit,
    productProjectionMigration,
    CONTROLLED_PATH_ACK
  );
  assert.equal(projectionDecision.ok, true);
  assert.equal(projectionDecision.migration.filename, productProjectionMigration);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("supabase migration ledger: ok\n");
