import assert from "node:assert/strict";
import { applyAccuracyMechanismV2 } from "../lib/listing/thin/accuracy-mechanism-bundle-v2.mjs";

const fields = {
  grammar: "standard",
  lot_count: "",
  serial: "2/15",
  surface_color: "Green",
  print_finish: "Green",
  parallel_family: "",
  manufacturer: "Panini",
  product: "Contenders Optic Basketball"
};

const conflictingFinish = applyAccuracyMechanismV2("finish_family_color_only", fields, {
  freeFields: { print_finish: "Green Prizm", serial: "#/75" }
});
assert.equal(conflictingFinish.changed, false);
assert.equal(conflictingFinish.blocked, "serial_denominator_conflict");

const compatibleFinish = applyAccuracyMechanismV2("finish_family_color_only", fields, {
  freeFields: { print_finish: "Green Prizm", serial: "#/15" }
});
assert.equal(compatibleFinish.fields.print_finish, "Green Prizm");

const lot = applyAccuracyMechanismV2("product_known_manufacturer_extension", {
  ...fields, grammar: "lot", lot_count: "3", product: "OptiChrome", manufacturer: "Leaf"
}, { freeFields: { product: "Leaf OptiChrome Triple" } });
assert.equal(lot.changed, false);
assert.equal(lot.blocked, "lot_product_extension_disallowed");
console.log("accuracy mechanism bundle v2: ok");
