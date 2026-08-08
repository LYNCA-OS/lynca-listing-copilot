import assert from "node:assert/strict";

import {
  diagnoseProjectionLoss,
  measure,
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

const paired = measure([
  {
    arm: "thin_budgeted",
    asset_id: "pair-1",
    title: "2025 Bowman Chrome Player",
    reference: "2025 Topps Bowman Chrome Player",
    image_set_sha256: "same-image",
    run_fingerprint: "same-run",
    image_detail: "high",
    image_count: 2,
    model: "gpt-5.6-luna",
    served_model: "gpt-5.6-luna",
    requested_effort: "none",
    served_effort: "none"
  },
  {
    arm: "thin_canonical_high",
    asset_id: "pair-1",
    raw_title: JSON.stringify({ year: "2025", product: "Bowman Chrome", subjects: ["Player"] }),
    fields: { year: "2025", product: "Bowman Chrome", subjects: ["Player"] },
    reference: "2025 Topps Bowman Chrome Player",
    image_set_sha256: "same-image",
    run_fingerprint: "same-run",
    image_detail: "high",
    image_count: 2,
    model: "gpt-5.6-luna",
    served_model: "gpt-5.6-luna",
    requested_effort: "none",
    served_effort: "none"
  }
]);
assert.equal(paired.canonical_plus_free_evidence.n, 1,
  "the current thin_canonical_high arm must pair instead of silently measuring n=0");
assert.deepEqual(paired.pairing, {
  free_arm: "thin_budgeted",
  canonical_arm: "thin_canonical_high",
  budgeted_rows: 1,
  canonical_rows: 1,
  paired_rows: 1,
  reference_verified_pairs: 1,
  image_set_verified_pairs: 1,
  run_fingerprint_verified_pairs: 1,
  configuration_verified_pairs: 1
});
assert.equal(paired.projection_safety.cards_with_unbacked_new_tokens, 1,
  "SEM-derived tokens absent from the provider title must stay visible as evaluation safety debt");
assert.equal(paired.projection_safety.rows[0].unbacked_new_tokens.includes("topps"), true);
assert.ok(paired.loss_diagnosis.boundary_reference_oracles.parser.delta_f1 >= 0,
  "a label-reading boundary oracle is an upper bound and cannot reduce F1");

const marketplaceOracle = measure([{
  arm: "thin_budgeted",
  asset_id: "marketplace-oracle",
  title: "2025 Topps Chrome Jaxson Dart New York Giants",
  reference: "2025 Topps Chrome Jaxson Dart New York Giants"
}]).loss_diagnosis.boundary_reference_oracles.marketplace_profile;
assert.equal(marketplaceOracle.scope, "net_f1_loss_rows");
assert.equal(marketplaceOracle.scope_rows, 1);
assert.ok(Math.abs(marketplaceOracle.delta_f1 - 3 / 13) < 1e-12,
  "the oracle must restore the three known-helpful suppressed team tokens");

const serialFormatting = measure([{
  arm: "thin_budgeted",
  asset_id: "serial-formatting",
  title: "2025 Topps Chrome Player /50",
  reference: "2025 Topps Chrome Player /50"
}]);
assert.equal(serialFormatting.projection_safety.cards_with_new_numeric_claims, 0,
  "Composer's #/50 rendering is the same numeric claim as provider /50, not a critical mutation");

const free = {
  arm: "thin_budgeted",
  asset_id: "integrity",
  title: "2025 Topps Chrome Player",
  reference: "2025 Topps Chrome Player",
  image_set_sha256: "image-a",
  run_fingerprint: "run-a"
};
const canonical = {
  arm: "thin_canonical_high",
  asset_id: "integrity",
  fields: { year: "2025", product: "Topps Chrome", subjects: ["Player"] },
  reference: free.reference,
  image_set_sha256: free.image_set_sha256,
  run_fingerprint: free.run_fingerprint
};
assert.throws(() => measure([free, { ...free }]), /duplicate_asset:thin_budgeted:integrity/,
  "duplicate free rows must not be averaged as independent cards");
assert.throws(() => measure([
  free,
  canonical,
  { ...canonical, arm: "thin_canonical" }
]), /ambiguous_canonical_arms/,
  "two canonical arms for one cohort must not depend on input order");
assert.throws(() => measure([free, { ...canonical, reference: "different" }]), /reference_mismatch/);
assert.throws(() => measure([
  free,
  { ...canonical, image_set_sha256: "image-b" }
]), /image_set_mismatch/);
assert.throws(() => measure([
  { ...free, image_set_sha256: undefined },
  canonical
]), /image_set_presence_mismatch/);
assert.throws(() => measure([
  free,
  { ...canonical, run_fingerprint: "run-b" }
]), /run_fingerprint_mismatch/);
assert.throws(() => measure([
  { ...free, image_detail: "high" },
  { ...canonical, image_detail: "original" }
]), /nuisance_mismatch:image_detail/);
assert.throws(() => measure([
  { ...free, image_detail: "high" },
  canonical
]), /nuisance_presence_mismatch:image_detail/);
assert.throws(() => measure([canonical]), /missing_budgeted_arm/);

console.log("free title CSM projection tests passed");
