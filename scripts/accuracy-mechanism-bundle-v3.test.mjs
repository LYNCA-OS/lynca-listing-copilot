import assert from "node:assert/strict";
import {
  ACCURACY_MECHANISM_NAMES_V3,
  applyAccuracyMechanismBundleV3,
  applyAccuracyMechanismV3
} from "../lib/listing/thin/accuracy-mechanism-bundle-v3.mjs";

assert.equal(ACCURACY_MECHANISM_NAMES_V3.length, 6);
const inserted = applyAccuracyMechanismV3("attested_insert", { card_name: "", grammar: "tcg" }, {
  observations: [{
    label: "insert_name",
    evidence: "KABOOM HORIZONTAL",
    kind: "printed_text",
    confidence: "high",
    region: "slab_label"
  }]
});
assert.equal(inserted.fields.card_name, "KABOOM HORIZONTAL");
assert.equal(inserted.changes.length, 1);
assert.equal(inserted.authority, "evaluation_only");

const rejected = applyAccuracyMechanismV3("attested_insert", { card_name: "Downtown", grammar: "tcg" }, {
  observations: [{ label: "insert_name", evidence: "Kaboom", kind: "printed_text", confidence: "high" }]
});
assert.equal(rejected.changes.length, 0);

const weak = applyAccuracyMechanismV3("attested_insert", { card_name: "", grammar: "tcg" }, {
  observations: [{ label: "insert_name", evidence: "Kaboom", kind: "printed_text", confidence: "medium" }]
});
assert.equal(weak.changes.length, 0);

const bundle = applyAccuracyMechanismBundleV3({ card_name: "", grammar: "tcg" }, {
  observations: [{
    label: "insert_name",
    evidence: "KABOOM HORIZONTAL",
    kind: "printed_text",
    confidence: "high"
  }]
});
assert.equal(bundle.fields.card_name, "KABOOM HORIZONTAL");
assert.deepEqual(bundle.changes, ["attested_insert"]);
assert.equal(bundle.production_promoted, false);

console.log("Accuracy mechanism bundle v3 tests passed");
