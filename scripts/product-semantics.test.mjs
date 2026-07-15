import assert from "node:assert/strict";
import {
  productSemanticKey,
  productProxyComparisonKey,
  productsSemanticallyEquivalent,
  productsProxyCompatible,
  sharedDistinctiveProductTokens
} from "../lib/listing/csm/product-semantics.mjs";

assert.equal(productSemanticKey("2003 Topps Chrome"), "topps chrome");
assert.equal(productSemanticKey("Topps Chrome Football"), "topps chrome football");
assert.equal(productSemanticKey("2025-26 Topps Cosmic Chrome Basketball"), "topps cosmic chrome basketball");
assert.equal(productSemanticKey("Panini Prizm FIFA Soccer"), "panini prizm fifa soccer");
assert.equal(productProxyComparisonKey("Topps Chrome Football"), "topps chrome");
assert.equal(productProxyComparisonKey("Panini Prizm FIFA Soccer"), "panini prizm fifa soccer");
assert.equal(productsSemanticallyEquivalent("2000 Bowman Chrome", "Bowman Chrome"), true);
assert.equal(productsSemanticallyEquivalent("Topps Finest Basketball", "Topps Finest"), false);
assert.equal(productsProxyCompatible("Topps Finest Basketball", "Topps Finest"), true);
assert.equal(productsSemanticallyEquivalent("Disney100 Chrome", "Topps Chrome"), false);
assert.deepEqual(sharedDistinctiveProductTokens("Disney100 Chrome", "Topps Chrome"), ["chrome"]);

console.log("product semantics tests passed");
