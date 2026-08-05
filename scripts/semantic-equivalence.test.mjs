#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  canonicaliseToken, equivalenceTokens, scoreWithEquivalence,
  EQUIVALENCE_VERSION, SYNONYM_CLASSES
} from "../lib/listing/evaluation/semantic-equivalence.mjs";

// The classes the measurement was taken on.
assert.equal(canonicaliseToken("Autograph"), "auto");
assert.equal(canonicaliseToken("Autographed"), "auto");
assert.equal(canonicaliseToken("Signatures"), "auto");
assert.equal(canonicaliseToken("Rookie"), "rc");
assert.equal(canonicaliseToken("Memorabilia"), "relic");
assert.equal(canonicaliseToken("Refractors"), "refractor");

// Orthography we render more faithfully than the writer types.
assert.equal(canonicaliseToken("Ibrahimović"), "ibrahimovic");
assert.equal(canonicaliseToken("Dončić"), "doncic");
assert.equal(canonicaliseToken("Pokémon"), "pokemon");
assert.deepEqual([...equivalenceTokens("D’Angelo")], [...equivalenceTokens("D'Angelo")]);

// Plurals, but not words that merely end in s. Getting this wrong would fold
// real terms together.
assert.equal(canonicaliseToken("Shots"), "shot");
assert.equal(canonicaliseToken("Kings"), "king");
assert.equal(canonicaliseToken("Chris"), "chris", "an -is ending is not a plural");
assert.equal(canonicaliseToken("Bus"), "bus", "a -us ending is not a plural");
assert.equal(canonicaliseToken("Class"), "class", "a -ss ending is not a plural");

// Hierarchy is deliberately absent: a generalisation must not collapse into the
// leaf, or we would be paid for a colour we never identified.
assert.notEqual(canonicaliseToken("gold"), canonicaliseToken("refractor"));
assert.ok(!equivalenceTokens("Refractor").has("gold"));

// Both readings always travel together, and the raw one is unchanged.
const s = scoreWithEquivalence("2020 Panini Prizm Joe Burrow Autograph RC", "2020 Panini Prizm Joe Burrow Auto Rookie");
assert.ok(s.equivalent.f1 > s.raw.f1, "equivalence-aware reading should be the higher one here");
assert.equal(s.equivalent.f1, 1, "same facts, different words");
assert.ok(s.raw.f1 < 1, "the raw reading must stay strict");
assert.match(s.equivalence_version, /^sem-equiv-1\+[0-9a-f]{12}$/);

// The version must move when the vocabulary moves, or two incomparable readings
// could be filed under one label.
const before = EQUIVALENCE_VERSION;
assert.equal(before, EQUIVALENCE_VERSION, "version is stable across calls");
assert.ok(SYNONYM_CLASSES.every((c) => Object.isFrozen(c) && Object.isFrozen(c.forms)),
  "classes are frozen so the version cannot drift from what was measured");

console.log("semantic-equivalence.test.mjs OK");

// A season span and its opening year are the same issue. The convention is
// trade knowledge, not something printed on the card, and we are never wrong
// about it -- 22 inside the writer's span, 0 outside, across the cohort.
assert.deepEqual([...equivalenceTokens("2025-26 Topps Chrome")], [...equivalenceTokens("2025 Topps Chrome")]);
assert.deepEqual([...equivalenceTokens("2003-04 Upper Deck")], [...equivalenceTokens("2003 Upper Deck")]);
// Symmetric: a span WE produce collapses too, so this cannot pay us for a guess.
{
  const s2 = scoreWithEquivalence("2018 Panini Prizm", "2018-19 Panini Prizm");
  assert.equal(s2.equivalent.f1, 1, "folding must work in both directions");
}
// A serial is not a season and must survive untouched.
assert.ok(equivalenceTokens("05/99 Gold").has("05/99"), "a print run is not a year span");
assert.ok(equivalenceTokens("2025 Topps 1/1").has("1/1"));
console.log("semantic-equivalence season-span assertions OK");

// Partial finish credit: either half of "Gold Refractor" identifies the card.
{
  const colourOnly = scoreWithEquivalence("2025 Topps Chrome Ohtani Gold Refractor", "2025 Topps Chrome Ohtani Gold");
  assert.equal(colourOnly.equivalent.f1, 1, "the colour alone satisfies the finish");
  const familyOnly = scoreWithEquivalence("2025 Topps Chrome Ohtani Gold Refractor", "2025 Topps Chrome Ohtani Refractor");
  assert.equal(familyOnly.equivalent.f1, 1, "the family alone satisfies the finish");
  // A misreading is not a coarser reading and stays charged.
  const wrongColour = scoreWithEquivalence("2025 Topps Chrome Ohtani Gold Refractor", "2025 Topps Chrome Ohtani Green Refractor");
  assert.ok(wrongColour.equivalent.f1 < 1, "naming a colour the writer did not use is still wrong");
  // Saying nothing is not a partial answer.
  const silent = scoreWithEquivalence("2025 Topps Chrome Ohtani Gold Refractor", "2025 Topps Chrome Ohtani");
  assert.ok(silent.equivalent.f1 < 1, "an empty finish layer is still a miss");
}
console.log("semantic-equivalence partial-finish assertions OK");

// A hypernym we add is free only when the writer's specific term is also ours.
{
  const redundant = scoreWithEquivalence(
    "2019-20 Panini Eminence Stephen Curry Peerless Patch Auto 3/5",
    "2019-20 Panini Eminence Peerless Patches Stephen Curry 3/5 Auto Patch Relic");
  assert.equal(redundant.equivalent.f1, 1, "Relic beside their Patch states nothing new");
  // Coarser, not redundant: we said Relic and never said Patch.
  const coarser = scoreWithEquivalence(
    "2019-20 Panini Eminence Stephen Curry Peerless Patch Auto 3/5",
    "2019-20 Panini Eminence Peerless Stephen Curry 3/5 Auto Relic");
  assert.ok(coarser.equivalent.f1 < 1, "a hypernym replacing their specific term is still charged");
  // Parent brand beside the sub-brand they used.
  const parent = scoreWithEquivalence("2026 Bowman Chrome Kendry Chourio", "2026 Topps Bowman Chrome Kendry Chourio");
  assert.equal(parent.equivalent.f1, 1, "Topps beside Bowman adds no fact");
  // But a parent brand INSTEAD of their sub-brand is a different product.
  const swapped = scoreWithEquivalence("2026 Bowman Chrome Kendry Chourio", "2026 Topps Chrome Kendry Chourio");
  assert.ok(swapped.equivalent.f1 < 1, "Topps Chrome is not Bowman Chrome");
}
console.log("semantic-equivalence hypernym assertions OK");

// The hypernym table is written in ordinary spelling and must survive the folds
// that titles go through. `Topps` becomes `topp` once plurals are folded, and a
// table keyed on the unfolded form matches nothing while looking correct.
import { HYPERNYMS } from "../lib/listing/evaluation/semantic-equivalence.mjs";
for (const [broad, narrow] of Object.entries(HYPERNYMS)) {
  const s3 = scoreWithEquivalence(`2026 ${narrow[0]} Player`, `2026 ${broad} ${narrow[0]} Player`);
  assert.equal(s3.equivalent.f1, 1, `${broad} beside ${narrow[0]} must be free`);
}
console.log("semantic-equivalence hypernym-folding assertions OK");

// Facts no reading of the card can supply are not charged.
{
  const ssp = scoreWithEquivalence("2025-26 Topps UCC Saka Home Advantage SSP", "2025-26 Topps UCC Saka Home Advantage");
  assert.equal(ssp.equivalent.f1, 1, "SSP is a checklist property, not something printed");
  // RC is printed from 2006 and is trade knowledge before it.
  const vintage = scoreWithEquivalence("1976 Topps Walter Payton Rookie RC PSA 9", "1976 Topps Walter Payton PSA 9");
  assert.equal(vintage.equivalent.f1, 1, "a 1976 card carries no RC logo");
  const modern = scoreWithEquivalence("2024 Panini Prizm Caleb Williams RC", "2024 Panini Prizm Caleb Williams");
  assert.ok(modern.equivalent.f1 < 1, "from 2006 the RC logo is printed and missing it is a real miss");
  // The raw reading is untouched by every rule in this file.
  assert.ok(ssp.raw.f1 < 1 && vintage.raw.f1 < 1);
}
console.log("semantic-equivalence unobtainable-fact assertions OK");

// Lot wording differs at both ends; the fact does not.
{
  const same = scoreWithEquivalence(
    "2026 Bowman Chrome Sam Petersen Luis Cova David Refractor lot",
    "3 Card Lot 2026 Bowman Chrome Sam Petersen Luis Cova David Refractor");
  assert.equal(same.equivalent.f1, 1, "opening or closing, it is the same listing");
  // Claiming a lot the writer did not describe is a misjudgement, not wording.
  const invented = scoreWithEquivalence(
    "2013 BBM Rookie Edition Shohei Ohtani Card Shop Promo PSA 10",
    "2 Card Lot 2013 BBM Rookie Edition Shohei Ohtani Tomoyuki Sugano");
  assert.ok(invented.equivalent.f1 < 1, "a lot the writer never described stays charged");
}
console.log("semantic-equivalence lot-format assertions OK");

// Writers publish the abbreviation; we render the expansion. Neither is wrong,
// and unlike the hypernym case the two titles share no token, so the phrase has
// to collapse before tokenisation.
{
  const expanded = scoreWithEquivalence("2025-26 Topps Chrome UCC Lionel Messi", "2025-26 Topps Chrome UEFA Champions League Lionel Messi");
  assert.equal(expanded.equivalent.f1, 1, "UEFA Champions League is UCC");
  const other = scoreWithEquivalence("2024-25 Topps Chrome UEFA Tijjani Reijnders", "2024-25 Topps Chrome UEFA Club Competitions Tijjani Reijnders");
  assert.ok(other.equivalent.f1 > other.raw.f1);
  // Symmetric: abbreviating their expansion is the same statement.
  const reversed = scoreWithEquivalence("2025-26 Topps Chrome UEFA Champions League Messi", "2025-26 Topps Chrome UCC Messi");
  assert.equal(reversed.equivalent.f1, 1, "the fold must work both ways");
  // Writers also use UEFA alone. Folding to the abbreviation broke exactly
  // this case: their `uefa` and our `ucc` stopped meeting.
  const bare = scoreWithEquivalence("2024-25 Topps Chrome UEFA Reijnders", "2024-25 Topps Chrome UEFA Club Competitions Reijnders");
  assert.equal(bare.equivalent.f1, 1, "the bare form must meet the expansion too");
  // Parent brand beside the sub-brand writers use alone.
  const skybox = scoreWithEquivalence("2022 Skybox Metal Universe Champions", "2022 Upper Deck Skybox Metal Universe Champions");
  assert.equal(skybox.equivalent.f1, 1, "Upper Deck beside Skybox adds no fact");
}
console.log("semantic-equivalence abbreviation assertions OK");

// An exemption must cut both ways. Removing a token only from what is wanted
// stops requiring it and starts charging for it -- a 2003 rookie card whose RC
// we correctly read became a precision loss under the one-sided version.
{
  const weSaidIt = scoreWithEquivalence("1976 Topps Walter Payton Rookie RC PSA 9", "1976 Topps Walter Payton RC PSA 9");
  assert.equal(weSaidIt.equivalent.f1, 1, "being right about an exempted fact must not cost anything");
  const weDidNot = scoreWithEquivalence("1976 Topps Walter Payton Rookie RC PSA 9", "1976 Topps Walter Payton PSA 9");
  assert.equal(weDidNot.equivalent.f1, 1, "and omitting it must not either");
  // Same for a checklist property.
  const ssp = scoreWithEquivalence("2025-26 Topps UCC Saka Home Advantage SSP", "2025-26 Topps UCC Saka Home Advantage SSP");
  assert.equal(ssp.equivalent.f1, 1);
}
console.log("semantic-equivalence symmetric-exemption assertions OK");

// A writer who lists no components at all has opted out of the bracket.
{
  const optedOut = scoreWithEquivalence(
    "2024 Panini Spectra Baker Mayfield Crush 02/99",
    "2024 Panini Spectra Baker Mayfield Crush 02/99 Patch Relic");
  assert.equal(optedOut.equivalent.f1, 1, "components they declined to state are not our error");
  // But a writer who listed some made a specific choice, and ours disagrees.
  const disagreed = scoreWithEquivalence(
    "2023 Panini Certified Rashee Rice Jersey Auto RC",
    "2023 Panini Certified Rashee Rice Jersey Auto RC Patch");
  assert.ok(disagreed.equivalent.f1 < 1, "a component added beside their own list still disagrees");
}
console.log("semantic-equivalence component-policy assertions OK");

// ── Founder rulings, 2026-08-05 ─────────────────────────────────────────────
// Both were adjudicated in conversation and the implementation did not match.
// Pinned here so a future edit cannot quietly drop them again.

// 1. Any year INSIDE the span is the right year -- not only the opening one.
{
  const ref = "2025-26 Topps Chrome Victor Wembanyama Gold Refractor 17/50 Spurs";
  const tail = "Topps Chrome Victor Wembanyama Gold Refractor 17/50 Spurs";
  for (const year of ["2025", "2026", "2025-26"]) {
    assert.equal(scoreWithEquivalence(`${year} ${tail}`, ref).equivalent.f1, 1,
      `${year} lies inside 2025-26 and must score as the right year`);
  }
  for (const year of ["2023", "2027"]) {
    assert.ok(scoreWithEquivalence(`${year} ${tail}`, ref).equivalent.f1 < 1,
      `${year} is outside 2025-26 and must not be credited`);
  }
  // Symmetric: a span we produce against a bare year the writer used.
  assert.equal(scoreWithEquivalence("2025-26 Topps X Y Z", "2025 Topps X Y Z").equivalent.f1, 1);
  // A season crossing a century still resolves.
  assert.equal(scoreWithEquivalence("2000 Topps X Y Z", "1999-00 Topps X Y Z").equivalent.f1, 1);
}

// 2. The finish has a safe degradation, and it must rank strictly above a
//    wrong claim. Saying less is not the same as saying something else.
{
  const ref = "2025 Topps Chrome Victor Wembanyama Gold Refractor 17/50 Spurs";
  const head = "2025 Topps Chrome Victor Wembanyama";
  const tail = "17/50 Spurs";
  const score = (finish) => scoreWithEquivalence(
    [head, finish, tail].filter(Boolean).join(" "), ref
  ).equivalent.f1;

  const exact = score("Gold Refractor");
  const degraded = Math.min(score("Gold"), score("Refractor"));
  const wrong = Math.max(score("Blue Refractor"), score("Gold Prizm"), score("Blue Prizm"));

  assert.equal(exact, 1, "the exact finish is fully credited");
  assert.ok(degraded < exact, "a degradation is not as good as the full answer");
  assert.ok(degraded > wrong,
    `a safe degradation (${degraded}) must rank above a wrong claim (${wrong})`);
  // The specific regression: an unsupported finish word must withdraw the
  // partial credit rather than ride on the one token that did match.
  assert.ok(score("Blue Refractor") < score("Gold"),
    "a wrong colour beside a right family must not score as a brief-but-true answer");
}

process.stdout.write("semantic-equivalence founder-ruling assertions OK\n");
