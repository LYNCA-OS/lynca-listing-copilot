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
  const controlled = controlledMigrationDecision(
    audit,
    "20260105000000_new_delta.sql",
    CONTROLLED_PATH_ACK
  );
  assert.equal(controlled.ok, true);
  assert.equal(controlled.db_push_allowed, false);
  assert.equal(controlled.controlled_single_migration_allowed, true);
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

  const liveLocal = await readFile(join(repoRoot, "supabase/migrations/20260801123000_csm_atomic_stage_packet_v1.sql"), "utf8");
  const receiptFixtureLocal = join(fixtureRoot, "receipt-local");
  const receiptFixtureRemote = join(fixtureRoot, "receipt-remote");
  await Promise.all([mkdir(receiptFixtureLocal), mkdir(receiptFixtureRemote)]);
  await Promise.all([
    writeFile(join(receiptFixtureLocal, "20260801123000_csm_atomic_stage_packet_v1.sql"), liveLocal),
    writeFile(join(receiptFixtureRemote, "20260801094353_csm_atomic_stage_packet_v1.sql"), `${liveLocal};\n`)
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
  assert.equal(
    controlledMigrationDecision(
      receiptAudit,
      "20260801123000_csm_atomic_stage_packet_v1.sql",
      CONTROLLED_PATH_ACK
    ).decision,
    "controlled_migration_already_applied_under_different_version"
  );

  const canonicalLocal = join(fixtureRoot, "canonical-local");
  await mkdir(canonicalLocal);
  await writeFile(
    join(canonicalLocal, "20260801094353_csm_atomic_stage_packet_v1.sql"),
    `${liveLocal};\n`
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
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("supabase migration ledger: ok\n");
