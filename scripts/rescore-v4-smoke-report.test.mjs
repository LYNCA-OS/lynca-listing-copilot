import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rescoreV4SmokeReport } from "./rescore-v4-smoke-report.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "v4-rescore-"));
try {
  const labelsPath = path.join(root, "labels.jsonl");
  await writeFile(labelsPath, `${JSON.stringify({
    key: "case_1",
    reviewed_title: "2025 Topps Chrome Test Player Gold",
    policy: {
      reviewed_title_is_ground_truth: true,
      model_prompt_visible: false
    }
  })}\n`);
  const report = {
    offset: 0,
    run_wall_ms: 1000,
    results: [{
      asset_id: "runtime_asset_1",
      source_asset_id: "asset_1",
      final_title: "2025 Topps Chrome Test Player Gold",
      provider_calls: 1,
      ok: true,
      l2_ready: true
    }]
  };
  const dataset = { items: [{ asset_id: "asset_1", sealed_eval_label_ref: { key: "case_1" } }] };
  const rescored = await rescoreV4SmokeReport({ report, dataset, sealedLabelsPath: labelsPath });
  assert.equal(rescored.results[0].final_title, report.results[0].final_title);
  assert.equal(rescored.results[0].provider_calls, 1);
  assert.equal(rescored.results[0].reference_title_is_reviewed_ground_truth, true);
  assert.equal(rescored.summary.final_accuracy_proxy.policy_fair_token_recall_avg, 1);
  assert.equal(rescored.rescore_provenance.provider_calls_added, 0);
  assert.equal(rescored.rescore_provenance.prediction_rows_changed, 0);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("v4 smoke offline rescore tests passed");
