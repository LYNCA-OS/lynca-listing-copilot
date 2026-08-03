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
