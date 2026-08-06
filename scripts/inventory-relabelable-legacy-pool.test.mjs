import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventoryRelabelableLegacyPool } from "./inventory-relabelable-legacy-pool.mjs";

const root = await mkdtemp(join(tmpdir(), "legacy-relabel-"));
const image = join(root, "front.jpg");
const dataset = join(root, "dataset.json");
const labels = join(root, "labels.jsonl");
await writeFile(image, "image-bytes");
await writeFile(dataset, JSON.stringify({
  item_count: 1,
  intake_policy: {
    image_only: true,
    seller_titles_are_ground_truth: false,
    ebay_answer_key_is_reviewed_ground_truth: false,
    title_derived_catalog_import_allowed: false,
    requires_writer_review_before_approved_reference: true
  },
  items: [{
    review_status: "NEEDS_WRITER_REVIEW",
    sealed_eval_label_ref: { key: "sealed-1" },
    images: [{ local_path: image }]
  }]
}));
await writeFile(labels, '{"key":"sealed-1","title":"must not be exported"}\n');

const report = await inventoryRelabelableLegacyPool({
  sources: [{ id: "fixture", dataset, labels }],
  now: () => new Date("2026-08-02T00:00:00.000Z")
});
assert.equal(report.relabel_ready_source_count, 1);
assert.equal(report.cards_available_for_relabeling, 1);
assert.equal(report.cards_available_for_accuracy_gate, 0);
assert.equal(report.sources[0].all_images_materialized, true);
assert.equal(report.sources[0].accuracy_eval_eligible, false);
assert.equal(report.accuracy_gate_policy.no_titles_exported, true);
assert.equal(JSON.stringify(report).includes("must not be exported"), false);
console.log("legacy relabel inventory tests passed");
