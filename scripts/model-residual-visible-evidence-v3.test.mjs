import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveModelResidualVisibleEvidenceV3 as resolveModelResidualVisibleEvidenceV3Unfrozen } from "../experiments/accuracy/model-residual-visible-evidence-v3.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const candidate = (text, role, region = "card_front", basis = "printed_text") => ({
  text, role, region, basis, authority: "candidate_only", automatic_csm_admission: false,
  automatic_renderer_admission: false, persistence_authority: false
});
const resolveModelResidualVisibleEvidenceV3 = (fields, candidates) =>
  resolveModelResidualVisibleEvidenceV3Unfrozen(fields, candidates, {
    composerFeatures: { exact_parallel_color_compaction: false }
  });
const base = (extra = {}) => ({
  year: "2025", manufacturer: "Topps", product: "Topps Chrome", set: "",
  subjects: ["Test Player"], surface_color: "", parallel_family: "", parallel_exact: "",
  print_finish: "", descriptive_rarity: "", card_name: "", serial: "5/50",
  attributes: [], components: [], grade: "", grammar: "standard", ...extra
});

const serial = resolveModelResidualVisibleEvidenceV3(base(), [candidate("05/50", "exact_code")]);
assert.equal(serial.accepted, true);
assert.equal(serial.fields.serial, "05/50");
assert.equal(serial.provider_calls, 0);
assert.deepEqual(serial.safety.lost_baseline_title_tokens, []);

const conflictingSerial = resolveModelResidualVisibleEvidenceV3(base(), [candidate("06/50", "exact_code")]);
assert.equal(conflictingSerial.fields.serial, "5/50");
assert.equal(conflictingSerial.safety.changed_fields.length, 0);
assert.equal(resolveModelResidualVisibleEvidenceV3(base(), [candidate("No. 05/50", "exact_code")]).fields.serial,
  "5/50", "only a pure fraction may enter the serial observation route");
assert.equal(resolveModelResidualVisibleEvidenceV3(base(), [
  candidate("Topps Chrome Sapphire", "exact_code")
]).fields.product, "Topps Chrome", "a wrong-role exact code cannot enter Product projection");

const insert = resolveModelResidualVisibleEvidenceV3(base(), [candidate("Kaboom", "commercial_marker")]);
assert.equal(insert.accepted, true);
assert.equal(insert.fields.card_name, "Kaboom");
assert.equal(resolveModelResidualVisibleEvidenceV3(base(), [candidate("Kaboom Horizontal", "commercial_marker")])
  .fields.card_name, "", "registry substring matches are not exact insert evidence");
assert.equal(resolveModelResidualVisibleEvidenceV3(base(), [candidate("UV-1", "commercial_marker")])
  .fields.card_name, "", "registry code prefixes cannot expand into insert names");

const tcg = base({ grammar: "tcg", ip: "", language: "EN" });
assert.equal(resolveModelResidualVisibleEvidenceV3(tcg, [candidate("Disney", "identity_phrase", "front_symbol")])
  .fields.ip, "Disney");
assert.equal(resolveModelResidualVisibleEvidenceV3(tcg, [candidate("Star Wars", "identity_phrase", "front_symbol")])
  .fields.ip, "", "the adapter cannot invent a new logo registry");

const compatibleIdentity = resolveModelResidualVisibleEvidenceV3(base(), [
  candidate("Topps Sapphire", "identity_phrase", "slab_label")
]);
assert.equal(compatibleIdentity.fields.product, "Topps Chrome Sapphire");
assert.equal(compatibleIdentity.guards.all_new_tokens_source_backed, true);

const normalizedGold = finishCanonicalTitle(JSON.stringify(base({
  surface_color: "Gold", print_finish: "Gold", serial: ""
}))).fields;
const restoredGold = resolveModelResidualVisibleEvidenceV3(normalizedGold, [
  candidate("Gold Refractor", "finish_phrase")
]);
assert.equal(restoredGold.applied, true);
assert.equal(restoredGold.fields.surface_color, "");
assert.equal(restoredGold.fields.parallel_family, "");
assert.equal(restoredGold.fields.print_finish, "Gold Refractor");
assert.equal(restoredGold.fields.parallel_exact, "Gold Refractor");
assert.deepEqual(restoredGold.safety.changed_fields.sort(), ["parallel_exact", "print_finish"]);
assert.equal(restoredGold.decisions.temporary_bare_colour_bridge.applied, true);
assert.match(restoredGold.decisions.temporary_bare_colour_bridge.observed_color_sha256, /^[0-9a-f]{64}$/);
const visualGold = resolveModelResidualVisibleEvidenceV3(normalizedGold, [
  candidate("Gold Refractor", "finish_phrase", "card_front", "visual_pattern")
]);
assert.equal(visualGold.applied, false);
assert.equal(visualGold.fields.print_finish, "");
assert.deepEqual(visualGold.context.freeFields, {});

const abbreviation = resolveModelResidualVisibleEvidenceV3(base({
  product: "Finest", surface_color: "Green", print_finish: "Green", parallel_exact: "Green"
}), [candidate("GREEN GEO", "finish_phrase")]);
assert.equal(abbreviation.fields.print_finish, "Green", "GEO must not expand into Geometric");
assert.equal(resolveModelResidualVisibleEvidenceV3(base({ grammar: "tcg" }), [
  candidate("Trainer Gallery", "finish_phrase", "card_front", "visual_pattern")
]).fields.card_name, "", "visual patterns cannot satisfy a printed-marker rule");

const displacementFields = {
  year: "2024", manufacturer: "Topps", product: "Bowman Chrome", set: "",
  subjects: ["Nick Kurtz"], team: "Athletics", card_name: "Chrome Prospect Auto",
  surface_color: "Blue", parallel_family: "Refractor", parallel_exact: "Auto-Blue Ref",
  print_finish: "Auto-Blue Ref", descriptive_rarity: "1st Edition", card_number: "CPA-NK",
  serial: "049/150", attributes: ["Auto", "1st Edition"], components: ["Auto"],
  grade: "PSA 10", grammar: "standard"
};
const displaced = resolveModelResidualVisibleEvidenceV3(displacementFields, [candidate(
  "2024 BOWMAN DRAFT NICK KURTZ CHR PROSPECT AUTO-BLUE REF", "identity_phrase", "slab_label"
)]);
assert.equal(displaced.accepted, false);
assert.equal(displaced.fields.product, "Bowman Chrome");
assert.ok(displaced.safety.lost_baseline_title_tokens.includes("t:1st"));

const finishDisplacement = resolveModelResidualVisibleEvidenceV3(base({
  year: "2021", product: "Chrome", subjects: ["Rafael Devers"], surface_color: "Red",
  parallel_family: "Refractor", parallel_exact: "Red Refractor", print_finish: "Red Refractor",
  serial: "5/5", attributes: ["Auto"], components: ["Auto"], grade: "PSA/DNA CERT PSA 9"
}), [candidate("2021 BEN BALLER CHROME RAFAEL DEVERS", "identity_phrase", "slab_label")]);
assert.equal(finishDisplacement.accepted, false);
assert.equal(finishDisplacement.fields.product, "Chrome");
assert.ok(finishDisplacement.safety.lost_baseline_title_tokens.includes("t:red"));
assert.ok(finishDisplacement.safety.lost_baseline_title_tokens.includes("t:refractor"));

assert.equal(resolveModelResidualVisibleEvidenceV3(base(), [
  { ...candidate("Topps Sapphire", "identity_phrase"), persistence_authority: true }
]).guards.valid_candidate_contract, false);
assert.equal(resolveModelResidualVisibleEvidenceV3(base(), Array.from({ length: 9 }, () =>
  candidate("Visible", "other_visible"))).guards.valid_candidate_contract, false);

const source = readFileSync(new URL("../experiments/accuracy/model-residual-visible-evidence-v3.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /reviewed_blind_/i);
assert.doesNotMatch(source, /asset[_-]?id/i);
assert.doesNotMatch(source, /\breference\b/i);
assert.doesNotMatch(source, /from\s+["'][^"']*(?:provider|openai)/i);
assert.doesNotMatch(source, /\b(?:geo|ref)\b/i, "the adapter must not contain abbreviation expansion rules");

console.log("model residual visible-evidence v3 tests passed");
