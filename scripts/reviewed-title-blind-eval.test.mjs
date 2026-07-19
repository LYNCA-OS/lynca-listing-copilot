import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReviewedTitleBlindEval } from "./build-reviewed-title-blind-eval.mjs";
import { attachPostRecognitionScoring, summarize } from "./v4-ebay-smoke.mjs";

const root = await mkdtemp(join(tmpdir(), "lynca-reviewed-title-blind-"));
try {
  const sourcePath = join(root, "source.json");
  const exclusionPath = join(root, "prior.jsonl");
  const outPath = join(root, "dataset.json");
  const labelsPath = join(root, "labels.jsonl");
  const source = {
    schema_version: "feedback-writer-gt-seed-v1",
    items: [
      {
        asset_id: "feedback-old",
        source_feedback_id: "old-id",
        category: "collectible_card",
        source_titles: { corrected_title: "2024 Topps Chrome Old Player PSA 10" },
        source_record: { reviewed_ground_truth: true },
        images: [{ image_id: "old-1", bucket: "cards", object_path: "old/front.jpg", role: "image_1_original" }]
      },
      {
        asset_id: "feedback-new",
        source_feedback_id: "new-id",
        category: "collectible_card",
        source_titles: { corrected_title: "2025 Topps Chrome New Player Gold PSA 10" },
        source_record: { reviewed_ground_truth: true },
        images: [{ image_id: "new-1", bucket: "cards", object_path: "new/front.jpg", role: "image_1_original" }]
      }
    ]
  };
  await writeFile(sourcePath, `${JSON.stringify(source)}\n`);
  await writeFile(exclusionPath, `${JSON.stringify({ source_feedback_id: "old-id" })}\n`);

  const { dataset, labels } = await buildReviewedTitleBlindEval({
    sourcePath,
    excludePaths: [exclusionPath],
    outPath,
    labelsOutPath: labelsPath,
    limit: 1,
    selectionSeed: "test-seed",
    evaluationSampleMode: "FRESH_GENERALIZATION",
    now: new Date("2026-07-14T00:00:00.000Z")
  });
  assert.equal(dataset.item_count, 1);
  assert.equal(dataset.items[0].source_feedback_id, "new-id");
  assert.equal(dataset.items[0].canonical_title, "");
  assert.deepEqual(dataset.items[0].source_titles, {});
  assert.equal(dataset.items[0].source_record.self_retrieval_exclusion_required, true);
  assert.equal(dataset.evaluation_sample_policy.novelty_verified, true);
  assert.equal(dataset.evaluation_sample_policy.prior_history_overlap_count, 0);
  assert.equal(labels[0].reviewed_title, "2025 Topps Chrome New Player Gold PSA 10");
  assert.equal(labels[0].policy.model_prompt_visible, false);

  const randomBlind = await buildReviewedTitleBlindEval({
    sourcePath,
    excludePaths: [],
    outPath: join(root, "random.json"),
    labelsOutPath: join(root, "random-labels.jsonl"),
    limit: 1,
    selectionSeed: "random-test-seed",
    evaluationSampleMode: "RANDOM_BLIND"
  });
  assert.equal(randomBlind.dataset.evaluation_sample_policy.mode, "RANDOM_BLIND");
  assert.equal(randomBlind.dataset.evaluation_sample_policy.randomized_selection, true);
  assert.equal(randomBlind.dataset.evaluation_sample_policy.randomization_verified, true);
  assert.equal(randomBlind.dataset.evaluation_sample_policy.cross_wave_overlap_permitted, true);
  assert.equal(randomBlind.dataset.evaluation_sample_policy.prior_history_exclusion_present, false);
  assert.equal(randomBlind.dataset.evaluation_sample_policy.excluded_item_count, 0);
  assert.match(randomBlind.dataset.evaluation_sample_policy.sample_seed_sha256, /^[a-f0-9]{64}$/);

  const datasetText = await readFile(outPath, "utf8");
  assert.doesNotMatch(datasetText, /New Player Gold/);
  assert.doesNotMatch(datasetText, /Old Player/);
  const labelText = await readFile(labelsPath, "utf8");
  assert.match(labelText, /New Player Gold/);

  const labelMap = new Map([[labels[0].key, labels[0]]]);
  const scored = attachPostRecognitionScoring([{
    asset_id: dataset.items[0].asset_id,
    ok: true,
    final_title: "2025 Topps Chrome New Player Gold PSA 10",
    l1_title: ""
  }], dataset.items, labelMap);
  assert.equal(scored[0].reference_title_type, "REVIEWED_INTERNAL_TITLE");
  assert.equal(scored[0].reference_title_is_reviewed_ground_truth, true);
  assert.equal(scored[0].final_scoring.policy_fair_token_recall, 1);
  const metrics = summarize(scored, { runWallMs: 1000 });
  assert.equal(metrics.reviewed_title_policy_acceptance.eligible, true);
  assert.equal(metrics.reviewed_title_policy_acceptance.rate, 1);

  const marketplace = attachPostRecognitionScoring([{
    asset_id: "market",
    ok: true,
    final_title: "Seller title"
  }], [{ asset_id: "market", sealed_eval_label_ref: { key: "market-key" } }], new Map([[
    "market-key",
    { key: "market-key", title: "Seller title", policy: { seller_title_is_ground_truth: false } }
  ]]));
  assert.equal(marketplace[0].reference_title_type, "MARKETPLACE_WEAK_LABEL");
  assert.equal(marketplace[0].reference_title_is_reviewed_ground_truth, false);
  assert.equal(summarize(marketplace).reviewed_title_policy_acceptance.eligible, false);

  await assert.rejects(() => buildReviewedTitleBlindEval({
    sourcePath,
    excludePaths: [exclusionPath],
    outPath: join(root, "too-many.json"),
    labelsOutPath: join(root, "too-many-labels.jsonl"),
    limit: 2,
    selectionSeed: "test-seed",
    evaluationSampleMode: "FRESH_GENERALIZATION"
  }), /Only 1 eligible reviewed-title image records remain; requested 2/);

  const fullInventory = await buildReviewedTitleBlindEval({
    sourcePath,
    outPath: join(root, "full-inventory.json"),
    labelsOutPath: join(root, "full-inventory-labels.jsonl"),
    allItems: true,
    selectionSeed: "inventory-seed",
    evaluationSampleMode: "FIXED_REGRESSION"
  });
  assert.equal(fullInventory.dataset.item_count, 2);
  assert.equal(fullInventory.dataset.evaluation_sample_policy.inventory_exhaustive, true);
  assert.equal(fullInventory.dataset.evaluation_sample_policy.inventory_coverage_rate, 1);
  assert.equal(fullInventory.dataset.evaluation_sample_policy.reuse_policy_complete, true);
  assert.equal(fullInventory.labels.length, 2);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("reviewed-title blind eval tests passed");
