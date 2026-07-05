import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEbayColdStartReport } from "./evaluate-ebay-cold-start-report.mjs";
import { buildEbayManualGtSample } from "./build-ebay-manual-gt-sample.mjs";

const tmpDir = await mkdtemp(join(tmpdir(), "ebay-cold-start-report-"));
try {
  const reportPath = join(tmpDir, "cloud-report.json");
  const sealedPath = join(tmpDir, "sealed.jsonl");
  const outPath = join(tmpDir, "cold-report.json");
  const markdownPath = join(tmpDir, "cold-report.md");
  const datasetPath = join(tmpDir, "dataset.json");
  const manualOutPath = join(tmpDir, "manual.json");

  await mkdir(tmpDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    results: [{
      candidate_id: "case-1",
      final_evaluated_title: "2023 Topps Chrome Test Player Gold",
      cold_start_status: "SAFE_DRAFT_READY",
      cold_start_safe_draft: { safe_draft_ready: true },
      cold_start_analysis: {
        no_approved_catalog_match: true,
        unsupported_exact_parallel: false,
        unsupported_official_card_type: false,
        high_risk_guess_fields: [],
        serial_current_image_only: null,
        grade_current_image_only: null
      },
      external_retrieval_used: false,
      high_risk_guess_removed: []
    }, {
      candidate_id: "case-2",
      final_evaluated_title: "2023 Topps Chrome Other Player Gold Wave PSA 10",
      cold_start_status: "WRITER_REVIEW_REQUIRED",
      writer_action_required: true,
      cold_start_analysis: {
        no_approved_catalog_match: true,
        unsupported_exact_parallel: true,
        unsupported_official_card_type: false,
        high_risk_guess_fields: ["parallel_exact", "grade"],
        serial_current_image_only: false,
        grade_current_image_only: false
      },
      external_retrieval_used: true,
      high_risk_guess_removed: [{ field: "parallel_exact" }]
    }]
  }, null, 2)}\n`);
  await writeFile(
    sealedPath,
    `${JSON.stringify({ case_id: "case-1", title: "2023 Topps Chrome Test Player Gold Refractor" })}\n`
  );
  const coldReport = await buildEbayColdStartReport({
    reportPath,
    sealedLabelsPath: sealedPath,
    outPath,
    markdownOutPath: markdownPath
  });
  assert.equal(coldReport.metrics.attempted_count, 2);
  assert.equal(coldReport.metrics.cold_start_safe_draft_rate, 0.5);
  assert.equal(coldReport.metrics.critical_error_rate, 0.5);
  assert.equal(coldReport.metrics.high_risk_guess_count, 2);
  assert.equal(coldReport.metrics.high_risk_guess_removed_count, 1);
  assert.equal(coldReport.rows[0].marketplace_title_used_as_truth, false);
  assert.equal(coldReport.rows[0].marketplace_title_sent_to_model, false);
  assert.match(await readFile(markdownPath, "utf8"), /sealed weak label only/);

  await writeFile(datasetPath, `${JSON.stringify({
    items: [{
      asset_id: "case-1",
      source_provider: "ebay_browse",
      sealed_eval_label_ref: { key: "case-1" },
      images: [{ image_id: "img1", bucket: "b", object_path: "o" }]
    }]
  }, null, 2)}\n`);
  const manualPacket = await buildEbayManualGtSample({
    argv: [
      "--dataset", datasetPath,
      "--sealed-labels", sealedPath,
      "--out", manualOutPath,
      "--count", "1"
    ],
    now: new Date("2026-07-01T00:00:00.000Z")
  });
  assert.equal(manualPacket.item_count, 1);
  assert.equal(manualPacket.policy.marketplace_title_is_noisy_reference_only, true);
  assert.equal(manualPacket.items[0].fields_to_review.subject, null);
  assert.equal(manualPacket.items[0].noisy_reference_for_reviewer_only.not_ground_truth, true);
  const manualText = await readFile(manualOutPath, "utf8");
  assert.match(manualText, /noisy_reference_for_reviewer_only/);
  assert.match(manualText, /not_ground_truth/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("eBay cold-start report tests passed");
