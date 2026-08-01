import assert from "node:assert/strict";

import { semCanonicalEditableFields } from "../lib/listing/csm/sem-definition.mjs";
import {
  ACCURACY_EXPRESSION_OVERLAY_V1,
  applyAccuracyExpressionOverlayV1
} from "../lib/listing/thin/accuracy-expression-overlay-v1.mjs";

const base = {
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "",
  subjects: ["Cooper Flagg"], team: "", card_name: "", release_variant: "",
  surface_color: "Red", parallel_family: "", parallel_exact: "",
  print_finish: "Red", descriptive_rarity: "", card_number: "",
  serial: "1/5", components: ["RC"], grade: "", grammar: "standard",
  lot_count: "", unreadable: [], low_confidence: [], language: "", ip: ""
};

const expressionFields = {
  ...base,
  product: "Topps Chrome Sapphire",
  print_finish: "Red Shimmer"
};

const result = applyAccuracyExpressionOverlayV1(base, {
  expressionFields,
  expressionTitle: "2025 Topps Chrome Sapphire Cooper Flagg Red Shimmer Rookie RC 1/5"
});
assert.equal(result.overlay, ACCURACY_EXPRESSION_OVERLAY_V1);
assert.equal(result.authority, "evaluation_only");
assert.equal(result.production_promoted, false);
assert.equal(result.fields.product, "Topps Chrome Sapphire");
assert.match(result.composed.title, /Sapphire/);
assert.ok(result.composed.length <= 80);
assert.deepEqual(base.product, "Chrome", "overlay must not mutate canonical input");
assert.ok(Object.keys(result.sem).every((field) => semCanonicalEditableFields.includes(field)));

const blocked = applyAccuracyExpressionOverlayV1({
  ...base, grammar: "lot", lot_count: "2", product: "Topps Chrome"
}, {
  expressionFields: { product: "Topps Chrome Sapphire" },
  expressionTitle: "unsafe"
});
assert.equal(blocked.changes.length, 0);
assert.ok(blocked.rejected.some((row) => row.reason === "lot_product_extension_disallowed"));

console.log("accuracy expression overlay v1: ok");
