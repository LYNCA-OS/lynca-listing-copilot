#!/usr/bin/env node

import assert from "node:assert/strict";
import { proposeWorldProductExtensionV1 } from "../experiments/accuracy/world-product-extension-v1.mjs";

const fields = { manufacturer: "Panini", product: "Optic", grammar: "standard", lot_count: "" };
const ranked = {
  decisions: [{
    rank_score: 2,
    support_edges: ["product_year:Donruss Optic:2025"],
    candidate: { value: "2025 PANINI — DONRUSS OPTIC FOOTBALL", basis: "stamped_text" }
  }]
};
const result = proposeWorldProductExtensionV1(fields, ranked);
assert.equal(result.changed, true);
assert.equal(result.fields.product, "DONRUSS OPTIC");
assert.equal(fields.product, "Optic");

assert.equal(proposeWorldProductExtensionV1({ ...fields, grammar: "lot" }, ranked).changed, false);
assert.equal(proposeWorldProductExtensionV1(fields, {
  decisions: [{ ...ranked.decisions[0], rank_score: 0 }]
}).changed, false);
assert.equal(proposeWorldProductExtensionV1({ ...fields, product: "Court Kings" }, ranked).changed, false);
assert.equal(proposeWorldProductExtensionV1(fields, {
  decisions: [{ ...ranked.decisions[0], candidate: { value: "Topps Chrome", basis: "model_knowledge" } }]
}).changed, false);

console.log("world product extension v1 tests passed");
