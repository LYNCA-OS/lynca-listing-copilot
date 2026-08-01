import assert from "node:assert/strict";
import {
  ACCURACY_MECHANISM_NAMES,
  applyAccuracyMechanismBundleV1,
  applyAccuracyMechanismV1
} from "../lib/listing/thin/accuracy-mechanism-bundle-v1.mjs";

const base = (overrides = {}) => ({
  grammar: "standard",
  surface_color: "Orange",
  print_finish: "Orange",
  parallel_family: "",
  parallel_exact: "",
  descriptive_rarity: "",
  manufacturer: "Topps",
  product: "Topps Chrome",
  set: "",
  card_name: "",
  serial: "8/25",
  ...overrides
});

const finish = applyAccuracyMechanismV1("finish_family_color_only", base(), {
  freeFields: { print_finish: "Orange Refractor" }
});
assert.equal(finish.fields.print_finish, "Orange Refractor");
assert.equal(finish.fields.parallel_exact, "Orange Refractor");
assert.equal(finish.authority, "evaluation_only");
assert.equal(finish.production_promoted, false);

const serial = applyAccuracyMechanismV1("serial_single_digit", base(), {
  observations: [{ label: "serial_number", evidence: "08/25" }]
});
assert.equal(serial.fields.serial, "08/25");

const wideSerial = applyAccuracyMechanismV1("serial_single_digit", base({ serial: "29/199" }), {
  observations: [{ label: "serial_number", evidence: "029/199" }]
});
assert.equal(wideSerial.fields.serial, "29/199");
assert.equal(wideSerial.changed, false);

const trainer = applyAccuracyMechanismV1("printed_trainer_gallery", base({ grammar: "tcg" }), {
  freeTitle: "2024 Pokemon Trainer Gallery Charizard"
});
assert.equal(trainer.fields.card_name, "Trainer Gallery");

const bowman = applyAccuracyMechanismV1("printed_first_bowman", base({ product: "Bowman Chrome" }), {
  freeTitle: "2024 Bowman Chrome 1st Bowman"
});
assert.equal(bowman.fields.descriptive_rarity, "1st Bowman");

const product = applyAccuracyMechanismV1("product_known_manufacturer_extension", base(), {
  freeFields: { product: "Topps Chrome Cosmic" }
});
assert.equal(product.fields.product, "Topps Chrome Cosmic");

const blockedUnknownManufacturer = applyAccuracyMechanismV1("product_known_manufacturer_extension", base({ manufacturer: "Unknown" }), {
  freeFields: { product: "Unknown Chrome Cosmic" }
});
assert.equal(blockedUnknownManufacturer.fields.product, "Topps Chrome");

const original = base();
const bundle = applyAccuracyMechanismBundleV1(original, {
  freeFields: { print_finish: "Orange Refractor", product: "Topps Chrome Cosmic", descriptive_rarity: "SAR" },
  freeTitle: "2024 Topps Chrome 1st Bowman",
  observations: [{ label: "serial_number", evidence: "08/25" }]
});
assert.deepEqual(original.serial, "8/25");
assert.ok(bundle.changes.length >= 3);
assert.deepEqual(new Set(bundle.changes).size, bundle.changes.length);
assert.deepEqual(ACCURACY_MECHANISM_NAMES.length, 6);
console.log("accuracy mechanism bundle v1: ok");
