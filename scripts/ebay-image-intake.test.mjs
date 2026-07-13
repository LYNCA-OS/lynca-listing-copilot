import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildEbayImageIntakeDataset } from "./build-ebay-image-intake-dataset.mjs";
import { buildCatalogGapQueueFromImageIntake } from "./build-catalog-gap-queue-from-image-intake.mjs";
import { buildEvaluationSamplePolicy } from "../lib/listing/evaluation/sample-policy.mjs";

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ebay-image-intake-"));
try {
  const runId = "run-1";
  const runRoot = path.join(tmpDir, runId);
  const imageDir = path.join(runRoot, "inference_bundle", "images");
  const answerDir = path.join(runRoot, "sealed_answers");
  await writeFile(path.join(tmpDir, ".keep"), "");
  await mkdir(imageDir, { recursive: true });
  await mkdir(answerDir, { recursive: true });

  const frontPath = path.join(imageDir, "case-1_img_0.jpg");
  const backPath = path.join(imageDir, "case-1_img_1.jpg");
  await writeFile(frontPath, "front image bytes");
  await writeFile(backPath, "back image bytes");
  await writeFile(
    path.join(runRoot, "inference_bundle", "blind_inputs.jsonl"),
    `${JSON.stringify({ case_id: "case-1", image_paths: [frontPath, backPath] })}\n`
  );
  await writeFile(
    path.join(runRoot, "blind_dataset_manifest.json"),
    `${JSON.stringify({
      evaluation_sample_policy: buildEvaluationSamplePolicy({
        mode: "FRESH_GENERALIZATION",
        excludedItemIds: ["prior-item"],
        selectedItemIds: ["v1|secret-title|0"],
        exclusionSourceCount: 1
      })
    })}\n`
  );
  await writeFile(
    path.join(answerDir, "answer_key.jsonl"),
    `${JSON.stringify({
      case_id: "case-1",
      seller: "dcsports87",
      item_id: "v1|secret-title|0",
      item_web_url: "https://www.ebay.com/itm/secret-title",
      title: "2023 Panini Prizm Tiger Stripe Secret Player PSA 10",
      raw_listing_metadata: { marketplace_id: "EBAY_US" }
    })}\n`
  );

  const datasetPath = path.join(tmpDir, "image-intake.json");
  const sealedLabelsPath = path.join(tmpDir, "sealed-labels.jsonl");
  const { dataset, sealedLabels } = await buildEbayImageIntakeDataset({
    argv: [
      "--blind-dir", tmpDir,
      "--run-ids", runId,
      "--out", datasetPath,
      "--sealed-labels-out", sealedLabelsPath
    ],
    now: new Date("2026-07-01T00:00:00.000Z")
  });

  assert.equal(dataset.schema_version, "ebay-image-intake-dataset-v1");
  assert.equal(dataset.item_count, 1);
  assert.equal(dataset.image_count, 2);
  assert.equal(dataset.evaluation_sample_policy.mode, "FRESH_GENERALIZATION");
  assert.equal(dataset.evaluation_sample_policy.novelty_verified, true);
  assert.equal(dataset.evaluation_sample_policy.selected_item_count, 1);
  assert.equal(dataset.intake_policy.seller_titles_in_dataset, false);
  assert.deepEqual(dataset.items[0].source_titles, {});
  assert.equal(dataset.items[0].canonical_title, "");
  assert.equal(dataset.items[0].source_record.seller_title_visible_to_model, false);
  assert.equal(dataset.items[0].source_record.title_derived_fields_are_ground_truth, false);
  assert.equal(sealedLabels.length, 1);
  assert.equal(sealedLabels[0].policy.catalog_import_allowed, false);

  const datasetText = await readFile(datasetPath, "utf8");
  assert.doesNotMatch(datasetText, /Tiger Stripe/);
  assert.doesNotMatch(datasetText, /Secret Player/);
  assert.doesNotMatch(datasetText, /secret-title/);

  const sealedText = await readFile(sealedLabelsPath, "utf8");
  assert.match(sealedText, /Tiger Stripe/);
  assert.match(sealedText, /use_after_prediction_for_eval_only/);

  const gapPath = path.join(tmpDir, "gap-queue.json");
  const gapReport = await buildCatalogGapQueueFromImageIntake({
    argv: ["--dataset", datasetPath, "--out", gapPath],
    now: new Date("2026-07-01T00:01:00.000Z")
  });
  assert.equal(gapReport.row_count, 1);
  assert.equal(gapReport.policy.seller_titles_enter_catalog, false);
  assert.equal(gapReport.rows[0].gap_reason, "new_identity");
  assert.equal(gapReport.rows[0].source_batch, `blind_eval/${runId}`);
  assert.deepEqual(gapReport.rows[0].image_ids, ["case-1_img_0", "case-1_img_1"]);
  assert.deepEqual(gapReport.rows[0].query_image_ids, ["case-1_img_0", "case-1_img_1"]);
  assert.equal(gapReport.rows[0].ai_draft_title, "");
  assert.deepEqual(gapReport.rows[0].observed_fields, {});
  assert.deepEqual(gapReport.rows[0].internal_candidates, []);
  assert.deepEqual(gapReport.rows[0].official_candidates, []);
  assert.deepEqual(gapReport.rows[0].external_candidates, []);
  assert.deepEqual(gapReport.rows[0].unresolved_fields, []);
  assert.deepEqual(gapReport.rows[0].high_risk_fields, []);
  assert.deepEqual(gapReport.rows[0].external_retrieval_hints, []);
  assert.deepEqual(gapReport.rows[0].marketplace_hints, []);
  assert.equal(gapReport.rows[0].reason, "NO_APPROVED_CATALOG_MATCH");
  assert.equal(gapReport.rows[0].cold_start_status, "CATALOG_GAP_REQUIRED");
  assert.equal(gapReport.rows[0].writer_action_required, true);
  assert.equal(gapReport.rows[0].writer_final_title, null);
  assert.equal(gapReport.rows[0].writer_confirmed_fields, null);
  assert.equal(gapReport.rows[0].selected_candidate_id, null);
  assert.deepEqual(gapReport.rows[0].rejected_candidate_ids, []);
  assert.deepEqual(gapReport.rows[0].field_diff, []);
  assert.equal(gapReport.rows[0].review_time_ms, null);
  assert.equal(gapReport.rows[0].promoted_catalog_identity_id, null);
  assert.equal(gapReport.rows[0].promotion_status, "pending");
  assert.deepEqual(gapReport.rows[0].proposed_identity_fields, {});
  assert.deepEqual(gapReport.rows[0].proposed_instance_fields, {});
  assert.equal(gapReport.rows[0].requires_writer_review, true);
  assert.equal(gapReport.rows[0].training_eligible, false);
  assert.equal(gapReport.rows[0].metadata.seller_title_visible_to_model, false);
  assert.equal(gapReport.rows[0].metadata.image_evidence_refs.length, 2);

  const gapText = await readFile(gapPath, "utf8");
  assert.doesNotMatch(gapText, /Tiger Stripe/);
  assert.doesNotMatch(gapText, /Secret Player/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("eBay image-only intake tests passed");
