import assert from "node:assert/strict";

import {
  CANONICAL_FREE_PRODUCT_V1_SCHEMA,
  CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME,
  buildCanonicalFreeProductV1Request,
  finishCanonicalFreeProductV1
} from "../lib/listing/thin/canonical-free-product-v1.mjs";

assert.equal(CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME, "canonical_card_fields_with_free_title_v1");
assert.equal(CANONICAL_FREE_PRODUCT_V1_SCHEMA.properties.free_title.type, "string");
assert.ok(CANONICAL_FREE_PRODUCT_V1_SCHEMA.required.includes("free_title"));

const request = buildCanonicalFreeProductV1Request({
  imageUrls: ["https://example.invalid/card.jpg"],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "high"
});
assert.equal(request.text.format.name, CANONICAL_FREE_PRODUCT_V1_SCHEMA_NAME);
assert.equal(request.input[0].content[1].detail, "high");

const result = finishCanonicalFreeProductV1(JSON.stringify({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", subjects: ["Shohei Ohtani"],
  team: "", card_name: "", release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
  parallel_exact: "", descriptive_rarity: "", card_number: "", serial: "05/25", attributes: [],
  grade: "", grammar: "standard", lot_count: "", language: "", unreadable: [], low_confidence: [],
  free_title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 05/25"
}));
assert.equal(result.free_title, "2025 Topps Chrome Shohei Ohtani Gold Refractor 05/25");
assert.equal(result.fields.product, "Chrome");
assert.equal(result.production_promoted, false);

process.stdout.write("canonical free product v1: ok\n");
