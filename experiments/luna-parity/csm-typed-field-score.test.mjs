// The typed-field scorer decides whether a change ships, so it proves itself
// against the founder's own policy text before it is trusted.
//
// The two cases that matter most are the two I got wrong by hand:
//   1. misreading a serial that IS on the card  -> tolerated variance, NOT fabrication
//   2. asserting a value the founder marked empty -> fabrication, absolute failure

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildGoldIndex, buildEquivalenceIndex, scoreCase, summarize
} from "./csm-typed-field-score.mjs";

const CSMDATA = "/Users/paidaxin/lynca-csmdata";
const gold = buildGoldIndex(JSON.parse(await readFile(`${CSMDATA}/golden/founder-golden-projection.json`, "utf8")));
const equivalence = buildEquivalenceIndex(
  JSON.parse(await readFile(`${CSMDATA}/policy/semantic-equivalence-decisions-v1.json`, "utf8")));

const CASE = "gamma-training-a-b";
const g = gold.get(CASE);
assert.ok(g, "gamma-training-a-b must exist in the founder golden projection");
assert.equal(g.answer, "2026 Bowman Chrome Jacob Misiorowski RC #35");
assert.ok(g.explicitlyEmpty.has("print_finish"), "this card's print_finish is explicitly empty in the gold");

const perfect = {
  year: "2026", manufacturer: "Topps", product: "Bowman Chrome",
  subjects: ["Jacob Misiorowski"], card_number: "35", ip: "Baseball"
};

// ── baseline ────────────────────────────────────────────────────────────────
const clean = scoreCase({ gold: g, runtimeFields: perfect, equivalence, caseId: CASE });
assert.equal(clean.passed, true, "the gold answer's own fields must pass");
assert.equal(clean.fabricated, false);

// ── 1. recognition variance is NOT fabrication ──────────────────────────────
// policy: "A numerical_rarity or print_finish mismatch alone does not fail a
// case; it remains reported."
const variance = scoreCase({
  gold: gold.get("gamma-training-a-e"),
  runtimeFields: { ...perfect, serial: "077/499" },
  equivalence, caseId: "gamma-training-a-e"
});
assert.equal(variance.fabricated, false,
  "misreading a serial that exists on the card is recognition variance, not fabrication");
assert.ok(!variance.verdicts.numerical_rarity || variance.verdicts.numerical_rarity !== "MISMATCH",
  "numerical_rarity must never be scored as a hard mismatch");

// ── 2. asserting an explicitly-empty field IS fabrication ───────────────────
const invented = scoreCase({
  gold: g,
  runtimeFields: { ...perfect, print_finish: "Black Refractor" },
  equivalence, caseId: CASE
});
assert.equal(invented.verdicts.print_finish, "FABRICATED_OR_UNBACKED");
assert.equal(invented.fabricated, true,
  "a value on a field the founder recorded as empty is FABRICATED_OR_UNBACKED_VALUE");
assert.equal(invented.passed, false, "absolute failures always fail");

// ── 3. release configuration must not be serialised as release variant ──────
const misfiled = scoreCase({
  gold: g, runtimeFields: { ...perfect, release_variant: "FOTL" }, equivalence, caseId: CASE
});
assert.ok(misfiled.absolute_failures.some(
  (f) => f.code === "RELEASE_CONFIGURATION_SERIALIZED_AS_RELEASE_VARIANT"),
  "FOTL is release configuration, not a release variant");
assert.equal(misfiled.passed, false);

// ── 4. product family equivalence, per the founder's general rule ───────────
const family = scoreCase({
  gold: g, runtimeFields: { ...perfect, product: "Bowman Baseball" }, equivalence, caseId: CASE
});
assert.equal(family.verdicts.product, "FOUNDER_RULED_PAIR",
  "the founder ruled Bowman Chrome ~ Bowman Baseball on six separate cases; that ruling applies to every card showing the same pair, not only the card it was written on");
assert.equal(family.passed, true);

// ...but a genuinely different product must still fail, or we would trip
// DISTINCT_PRODUCT_IDENTITY_COLLAPSED_AS_EQUIVALENT.
const wrongProduct = scoreCase({
  gold: g, runtimeFields: { ...perfect, product: "Panini Prizm" }, equivalence, caseId: CASE
});

// The rule this replaced matched on the shared head token, so it called two
// distinct Topps products equivalent. That is the exact absolute failure the
// policy names, and it must now fail.
const sameMakerDifferentProduct = scoreCase({
  gold: gold.get("gamma-training-c-m"),
  runtimeFields: { ...perfect, product: "Topps Finest" },
  equivalence, caseId: "gamma-training-c-m"
});
assert.equal(sameMakerDifferentProduct.verdicts.product, "MISMATCH",
  "sharing only the manufacturer is not family equivalence");
assert.equal(wrongProduct.verdicts.product, "MISMATCH",
  "family equivalence must not collapse distinct product identities");
assert.equal(wrongProduct.passed, false);

// ── 5. silence is a recall loss, not a lie ──────────────────────────────────
const silent = scoreCase({
  gold: g, runtimeFields: { year: "2026", product: "Bowman Chrome" }, equivalence, caseId: CASE
});
assert.equal(silent.verdicts.subject, "MISSED");
assert.equal(silent.fabricated, false, "omitting a field is not fabrication");

// ── summary shape ───────────────────────────────────────────────────────────
const s = summarize([clean, invented, misfiled, wrongProduct]);
assert.equal(s.cases, 4);
assert.equal(s.passed, 1);
// misfiled trips TWO absolute failures at once, and that is correct: on this
// card release_variant is itself an explicitly-empty field, so writing "FOTL"
// into it is both a fabrication AND a release-configuration misfiling. Two
// distinct policy violations, one edit.
assert.equal(s.fabricated_cases, 2);
assert.equal(s.absolute_failure_cases, 2); // invented + misfiled; wrongProduct fails on a hard mismatch, not an absolute failure

console.log("csm typed field score: ok (policy read from LYNCA-OS/csmdata, not restated)");
