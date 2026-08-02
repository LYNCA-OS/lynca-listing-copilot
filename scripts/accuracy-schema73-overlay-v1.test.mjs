import assert from "node:assert/strict";

import {
  ACCURACY_SCHEMA73_MECHANISMS,
  ACCURACY_SCHEMA73_OVERLAY_V1,
  applyAccuracySchema73MechanismV1,
  applyAccuracySchema73OverlayV1
} from "../lib/listing/thin/accuracy-schema73-overlay-v1.mjs";

const base = (overrides = {}) => ({
  year: "2024",
  manufacturer: "Topps",
  product: "Topps Chrome",
  set: "",
  subjects: ["Player"],
  card_name: "",
  release_variant: "",
  serial: "27/150",
  grammar: "standard",
  ...overrides
});

const season = applyAccuracySchema73MechanismV1("exact_season_suffix", base({ year: "2018" }), {
  observations: [{
    evidence: "2018-19 PANINI - HOOPS BASKETBALL",
    kind: "printed_text",
    region: "card_back",
    label: "copyright_set_line",
    confidence: "high"
  }]
});
assert.equal(season.fields.year, "2018-19");
assert.equal(season.changes[0].reason_code, "exact_next_season_suffix");

const wrongSeason = applyAccuracySchema73MechanismV1("exact_season_suffix", base({ year: "2018" }), {
  observations: [{
    evidence: "2018-20",
    kind: "printed_text",
    region: "card_back",
    label: "set",
    confidence: "high"
  }]
});
assert.equal(wrongSeason.fields.year, "2018", "only the mathematically next season suffix is admitted");

const serial = applyAccuracySchema73MechanismV1("front_same_value_serial", base(), {
  observations: [{
    evidence: "027/150",
    kind: "printed_text",
    region: "card_front",
    label: "serial_number",
    confidence: "high"
  }]
});
assert.equal(serial.fields.serial, "027/150");
assert.equal(serial.changes[0].same_numeric_value, true);

const backSerial = applyAccuracySchema73MechanismV1("front_same_value_serial", base({ serial: "29/199" }), {
  observations: [{
    evidence: "029/199",
    kind: "printed_text",
    region: "card_back",
    label: "serial_number",
    confidence: "high"
  }]
});
assert.equal(backSerial.fields.serial, "29/199", "the known back-serial regression stays blocked");

const conflictingSerial = applyAccuracySchema73MechanismV1("front_same_value_serial", base(), {
  observations: [{
    evidence: "027/151",
    kind: "printed_text",
    region: "card_front",
    label: "serial_number",
    confidence: "high"
  }]
});
assert.equal(conflictingSerial.fields.serial, "27/150", "no numerator or denominator mutation is allowed");

const nbl = applyAccuracySchema73MechanismV1("typed_exact_admission", base(), {
  observations: [{
    evidence: "NBL", kind: "printed_text", region: "card_front", label: "logo", confidence: "high"
  }]
});
assert.equal(nbl.fields.set, "NBL");
assert.equal(nbl.changes[0].source.evidence, "NBL");

const derby = applyAccuracySchema73MechanismV1("typed_exact_admission", base({ product: "Topps Tribute" }), {
  observations: [{
    evidence: "2024 T-MOBILE HOME RUN DERBY",
    kind: "printed_text",
    region: "card_front",
    label: "event",
    confidence: "high"
  }]
});
assert.equal(derby.fields.release_variant, "Derby");

const pick = applyAccuracySchema73MechanismV1("typed_exact_admission", base({ product: "Signature Class" }), {
  observations: [{
    evidence: "PICK 2", kind: "printed_text", region: "card_front", label: "unknown", confidence: "high"
  }]
});
assert.equal(pick.fields.card_name, "Pick 2");

const mismatchedPick = applyAccuracySchema73MechanismV1("typed_exact_admission", base({ product: "Topps Chrome" }), {
  observations: [{
    evidence: "PICK 2", kind: "printed_text", region: "card_front", label: "unknown", confidence: "high"
  }]
});
assert.equal(mismatchedPick.fields.card_name, "", "open text cannot bypass the product-specific typed registry");

const first = applyAccuracySchema73MechanismV1("typed_exact_admission", base({
  product: "Bowman Chrome Basketball",
  set: "Chrome Prospect Autograph",
  components: ["Auto"]
}), {
  observations: [{
    evidence: "1ST", kind: "printed_text", region: "card_front", label: "stamped_number", confidence: "high"
  }]
});
assert.equal(first.fields.set, "Prospect 1st");
assert.deepEqual(first.changes[0].sanctioned_title_losses, ["autograph"]);

const optic = applyAccuracySchema73MechanismV1("typed_exact_admission", base({
  manufacturer: "Panini",
  product: "Donruss Football",
  set: "Legendary Logos",
  team: "Cowboys",
  card_name: "Cowboys"
}), {
  observations: [{
    evidence: "OPTIC", kind: "printed_text", region: "card_front", label: "logo", confidence: "high"
  }]
});
assert.equal(optic.fields.product, "Donruss Optic Football");
assert.equal(optic.fields.card_name, "");
assert.equal(optic.changes.length, 2);
assert.deepEqual(optic.changes[1].sanctioned_title_losses, ["cowboys"]);

const original = base({ year: "2018", product: "Signature Class" });
const combined = applyAccuracySchema73OverlayV1(original, {
  observations: [
    { evidence: "2018-19 TOPPS", kind: "printed_text", region: "card_back", label: "set", confidence: "high" },
    { evidence: "027/150", kind: "printed_text", region: "card_front", label: "serial_number", confidence: "high" },
    { evidence: "PICK 2", kind: "printed_text", region: "card_front", label: "unknown", confidence: "high" }
  ]
});
assert.equal(combined.overlay, ACCURACY_SCHEMA73_OVERLAY_V1);
assert.equal(combined.authority, "evaluation_only");
assert.equal(combined.production_promoted, false);
assert.deepEqual(ACCURACY_SCHEMA73_MECHANISMS, [
  "exact_season_suffix", "front_same_value_serial", "typed_exact_admission"
]);
assert.equal(combined.fields.year, "2018-19");
assert.equal(combined.fields.serial, "027/150");
assert.equal(combined.fields.card_name, "Pick 2");
assert.equal(original.year, "2018", "the canonical input stays immutable");

assert.throws(
  () => applyAccuracySchema73MechanismV1("unknown", base()),
  /unknown_accuracy_schema73_mechanism/
);

console.log("accuracy schema73 overlay v1: ok");
