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
console.log("accuracy mechanism bundle v4 tests passed");
