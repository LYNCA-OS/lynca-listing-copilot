import assert from "node:assert/strict";

import {
  diagnoseProjectionLoss,
  mergeFreeEvidenceIntoCanonical,
  projectFreeTitleThroughCsm
} from "./measure-free-title-csm-projection.mjs";

const projected = projectFreeTitleThroughCsm(
  "2025 Topps Chrome Victor Wembanyama Gold Refractor 17/50 Spurs"
);
assert.equal(projected.title, "2025 Topps Chrome Victor Wembanyama Gold Refractor 17/50");
assert.equal(projected.fields.print_finish, "Gold Refractor");
assert.equal(projected.fields.serial, "17/50");
assert.equal(projected.suppressed.includes("search_optimization"), true);

const noAliasInjection = projectFreeTitleThroughCsm("2026 Bowman Chrome Kendry Chourio Purple Wave /250 RC");
assert.equal(noAliasInjection.fields.manufacturer, "", "Topps is an inferred alias, not free-expression evidence");
assert.equal(noAliasInjection.fields.product, "Bowman Chrome");

const merged = mergeFreeEvidenceIntoCanonical(
  { product: "Leaf Metal", print_finish: "Refractor", components: [] },
  { product: "Leaf Metal Draft", print_finish: "Gold Refractor", parallel_exact: "Gold Refractor", components: ["RC"] }
);
assert.equal(merged.product, "Leaf Metal Draft", "an anchored strict extension is additive evidence");
assert.equal(merged.print_finish, "Gold Refractor");
assert.equal(merged.parallel_exact, "Gold Refractor");
assert.deepEqual(merged.components, ["RC"]);
assert.equal(
  mergeFreeEvidenceIntoCanonical({ product: "Topps Chrome" }, { product: "Panini Prizm" }).product,
  "Topps Chrome",
  "free evidence must not overwrite a conflicting canonical observation"
);

const loss = diagnoseProjectionLoss({
  row: {
    asset_id: "loss-1",
    title: "2025 Topps Chrome Jaxson Dart New York Giants",
    reference: "2025 Topps Chrome Jaxson Dart New York Giants"
  },
  output: projectFreeTitleThroughCsm("2025 Topps Chrome Jaxson Dart New York Giants"),
  before: { f1: 1 },
  after: { f1: 0.8 }
});
assert.deepEqual(loss.causes.marketplace_profile, ["new", "york", "giants"]);
assert.equal(loss.causes.parser.length, 0);

console.log("free title CSM projection tests passed");
