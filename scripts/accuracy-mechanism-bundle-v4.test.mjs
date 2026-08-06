import assert from "node:assert/strict";
import { applyAccuracyMechanismBundleV4 } from "../lib/listing/thin/accuracy-mechanism-bundle-v4.mjs";

const fields = {
  grammar: "standard", set: "", manufacturer: "Topps", product: "Chrome",
  subjects: ["Test Player"], card_name: "", components: [], attributes: [],
  serial: "", card_number: "", parallel_exact: "", surface_color: "",
  parallel_family: "", print_finish: "", descriptive_rarity: "", language: ""
};
const result = applyAccuracyMechanismBundleV4(fields, {
  identityFacts: [{ value: "Disney", kind: "identity", basis: "logo_or_symbol", image: "image_1" }]
});
assert.equal(result.fields.set, "Disney");
assert.equal(result.authority, "evaluation_only");
assert.equal(result.production_promoted, false);
assert.deepEqual(result.changes, ["candidate_identity_replay_v3"]);

const vetoed = applyAccuracyMechanismBundleV4(fields, {
  identityFacts: [{ value: "Atlanta Hawks", kind: "affiliation", basis: "logo_or_symbol", image: "image_1" }]
});
assert.equal(vetoed.fields.set, "");
assert.equal(vetoed.changes.length, 0);

const exactPrinted = applyAccuracyMechanismBundleV4({
  ...fields,
  surface_color: "Silver",
  parallel_family: "Refractor",
  print_finish: "Silver Refractor"
}, {
  observations: [{
    evidence: "REFRACTOR",
    kind: "printed_text",
    label: "finish",
    confidence: "high",
    region: "card_back"
  }]
});
assert.equal(exactPrinted.fields.parallel_exact, "Refractor");
assert.deepEqual(exactPrinted.changes, ["printed_refractor_exact"]);

const richerPrinted = applyAccuracyMechanismBundleV4({
  ...fields,
  surface_color: "Silver",
  parallel_family: "Refractor",
  print_finish: "100-Year Diamond Refractor"
}, {
  observations: [{
    evidence: "100-YEAR DIAMOND REFRACTOR",
    kind: "printed_text",
    label: "parallel",
    confidence: "high",
    region: "slab_label"
  }]
});
assert.equal(richerPrinted.fields.parallel_exact, "");
assert.deepEqual(richerPrinted.changes, []);
console.log("accuracy mechanism bundle v4 tests passed");
