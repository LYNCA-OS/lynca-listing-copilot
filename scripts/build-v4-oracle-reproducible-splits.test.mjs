import assert from "node:assert/strict";
import { buildReproducibleOracleSplits } from "./build-v4-oracle-reproducible-splits.mjs";

const items = Array.from({ length: 60 }, (_, index) => ({
  item_id: `item-${index}`,
  source_feedback_id: `feedback-${index}`,
  recognition_input: { images: index < 55 ? [{ object_path: `image-${index}` }] : [] },
  parser_suggestion: { fields: { year: "2025", product: `Product ${index}`, subject: [`Subject ${index}`] } },
  reviewed_ground_truth: { fields: {} }
}));
items[0].split_group_id = "shared-identity";
items[1].split_group_id = "shared-identity";

const first = buildReproducibleOracleSplits({ dataset_id: "test", items }, { minimumHoldout: 45 });
const second = buildReproducibleOracleSplits({ dataset_id: "test", items }, { minimumHoldout: 45 });
const reordered = buildReproducibleOracleSplits({ dataset_id: "test", items: [...items].reverse() }, { minimumHoldout: 45 });
assert.deepEqual(first.manifest, second.manifest);
assert.deepEqual(first.manifest, reordered.manifest);
assert.equal(first.manifest.image_backed_item_count, 55);
assert.equal(first.manifest.actual_counts.holdout, 45);
assert.deepEqual(first.manifest.leakage_check, {
  development_validation: 0,
  development_holdout: 0,
  validation_holdout: 0
});
assert.equal(first.manifest.identity_group_counts.development
  + first.manifest.identity_group_counts.validation
  + first.manifest.identity_group_counts.holdout, 54);
assert.equal(first.partitions.holdout.sealed, true);
assert.equal(first.partitions.development.sealed, false);
assert.equal(Object.values(first.partitions).flatMap((partition) => partition.items).length, 55);

console.log("build-v4-oracle-reproducible-splits tests passed");
