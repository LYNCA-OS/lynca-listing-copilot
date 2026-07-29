import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializePairedAblationCohort } from "./materialize-paired-ablation-cohort.mjs";

const dir = await mkdtemp(join(tmpdir(), "paired-ablation-test-"));
const datasetPath = join(dir, "source.json");
const labelsPath = join(dir, "labels.jsonl");
const outPath = join(dir, "cohort.json");
const labelsOutPath = join(dir, "cohort-labels.jsonl");
await writeFile(datasetPath, `${JSON.stringify({
  schema_version: "source-v1",
  items: [
    { asset_id: "card_b", sealed_eval_label_ref: { key: "card_b" } },
    { asset_id: "card_a", sealed_eval_label_ref: { key: "card_a" } },
    { asset_id: "card_c", sealed_eval_label_ref: { key: "card_c" } }
  ]
})}\n`);
await writeFile(labelsPath, [
  JSON.stringify({ key: "card_a", reviewed_title: "A" }),
  JSON.stringify({ key: "card_b", reviewed_title: "B" }),
  JSON.stringify({ key: "card_c", reviewed_title: "C" })
].join("\n") + "\n");

const result = await materializePairedAblationCohort({
  datasetPath,
  labelsPath,
  outPath,
  labelsOutPath,
  limit: 2,
  reuseReason: "fixed regression",
  reuseScopeId: "paired-test-v1",
  evaluationPartition: "development"
});
assert.equal(result.dataset.item_count, 2);
assert.equal(result.dataset.evaluation_sample_policy.mode, "PAIRED_ABLATION");
assert.equal(result.dataset.evaluation_sample_policy.same_sample_required, true);
assert.equal(result.dataset.evaluation_sample_policy.generalization_claim_permitted, false);
assert.equal(result.dataset.evaluation_sample_policy.reuse_scope_id, "paired-test-v1");
assert.equal(result.dataset.evaluation_partition, "development");
assert.equal(result.dataset.data_policy.frozen_holdout, false);
assert.deepEqual(result.labels.map((row) => row.key), ["card_b", "card_a"]);
assert.equal(JSON.parse(await readFile(outPath, "utf8")).items.length, 2);

console.log("paired ablation cohort materialization tests passed");
