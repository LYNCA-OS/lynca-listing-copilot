import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCatalogColdStartFlywheelReport } from "./export-catalog-cold-start-flywheel-report.mjs";
import { sourceTrustValues } from "../lib/listing/external/external-candidate-contract.mjs";

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "catalog-flywheel-report-"));

try {
  const gapQueuePath = path.join(tmpDir, "gap-queue.json");
  const externalReportPath = path.join(tmpDir, "external-report.json");
  const writerPath = path.join(tmpDir, "writer-confirmations.json");
  const outPath = path.join(tmpDir, "report.json");
  const markdownOutPath = path.join(tmpDir, "report.md");

  await writeFile(gapQueuePath, JSON.stringify({
    rows: [{
      client_gap_key: "gap-1",
      asset_id: "asset-1",
      cold_start_status: "EXTERNAL_DIRECTORY_CANDIDATES_ONLY",
      ai_draft_title: "1997-98 Bowman's Best Michael Jordan",
      image_ids: ["front-1", "back-1"],
      observed_fields: { year: "1997-98", product: "Bowman's Best" },
      external_candidates: [{
        candidate_id: "cs-card-96",
        external_card_id: "cs-card-96",
        source_trust: sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
        used_as_truth: false,
        fields: {
          year: "1997-98",
          product: "Bowman's Best",
          players: ["Michael Jordan"]
        }
      }],
      marketplace_hints: []
    }, {
      client_gap_key: "gap-2",
      asset_id: "asset-2",
      cold_start_status: "CATALOG_GAP_REQUIRED",
      ai_draft_title: "Unknown card",
      image_ids: ["front-2"],
      external_candidates: [],
      marketplace_hints: []
    }]
  }), "utf8");

  await writeFile(externalReportPath, JSON.stringify({
    metrics: {
      external_candidate_recall_at_1: 0.5,
      external_candidate_recall_at_3: 0.5,
      external_candidate_recall_at_5: 1,
      external_recovery_count: 1,
      external_regression_count: 0
    }
  }), "utf8");

  await writeFile(writerPath, JSON.stringify({
    rows: [{
      client_gap_key: "gap-1",
      writer_final_title: "1997-98 Bowman's Best Michael Jordan Best Performance",
      writer_confirmed_fields: {
        year: "1997-98",
        product: "Bowman's Best",
        players: ["Michael Jordan"]
      },
      selected_candidate_id: "cs-card-96",
      promotion_status: "promoted",
      promoted_catalog_identity_id: "identity-96"
    }],
    hard_negatives: [{
      query_card_id: "asset-1",
      wrong_candidate_id: "wrong-1",
      training_eligible: false
    }]
  }), "utf8");

  const report = await buildCatalogColdStartFlywheelReport({
    gapQueuePath,
    externalReportPath,
    writerConfirmationsPath: writerPath,
    outPath,
    markdownOutPath,
    now: new Date("2026-07-01T12:00:00.000Z")
  });

  assert.equal(report.metrics.catalog_gap_created_count, 2);
  assert.equal(report.metrics.writer_confirm_rate, 0.5);
  assert.equal(report.metrics.external_candidate_recall_at_1, 0.5);
  assert.equal(report.metrics.external_candidate_recall_at_5, 1);
  assert.equal(report.metrics.external_recovery_count, 1);
  assert.equal(report.metrics.external_regression_count, 0);
  assert.equal(report.metrics.hard_negative_count, 1);
  assert.equal(report.metrics.external_to_internal_promotion_count, 1);
  assert.equal(report.metrics.forbidden_usage_violation_count, 0);
  assert.equal(report.metrics.serial_grade_cert_copy_violation_count, 0);
  assert.equal(report.metrics.marketplace_pollution_count, 0);
  assert.equal(report.policy.external_directories_used_as_truth, false);
  assert.equal(report.policy.ebay_titles_used_as_ground_truth, false);
  assert.equal(report.policy.ebay_titles_sent_to_prompt, false);
  assert.equal(report.policy.writer_review_required_for_internal_catalog_promotion, true);

  const written = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(written.schema_version, "catalog-cold-start-flywheel-report-v0");
  const markdown = await readFile(markdownOutPath, "utf8");
  assert.match(markdown, /Catalog Cold-Start Flywheel Report/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("catalog cold-start flywheel report tests passed");
