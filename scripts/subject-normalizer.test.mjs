#!/usr/bin/env node
// The subject arrives damaged in two ways, both measured on 4,614 production
// cards, and both make a lookup miss a person the index plainly contains.

import assert from "node:assert/strict";
import test from "node:test";

import { isTruncationOf, normalizeSubject, stripForeignTokens } from "../lib/listing/catalog/subject-normalizer.mjs";

test("one person carried as two is merged, keeping the fuller spelling", () => {
  // Real titles: "Pelé / Pel", "Dončić / Donči", "Modrić / Modri", "Mbappé /
  // Mbapp". 13 cards say "luka dončić" and 10 say "luka donči".
  for (const [full, truncated] of [["Pelé", "Pel"], ["Dončić", "Donči"], ["Modrić", "Modri"], ["Mbappé", "Mbapp"]]) {
    const merged = normalizeSubject({ players: [full, truncated] });
    assert.deepEqual(merged.subjects, [full], `${full} / ${truncated}`);
  }
});

test("a genuine multi-subject card is left alone", () => {
  const dual = normalizeSubject({ players: ["Shohei Ohtani", "Mookie Betts"] });
  assert.equal(dual.subjects.length, 2);
  assert.equal(dual.changed, false);

  // A given name is a prefix of the full name and must never be merged away.
  assert.equal(isTruncationOf("Luka", "Luka Modric"), false);
  assert.equal(isTruncationOf("Pel", "Pelé"), true);
});

test("a word the card states in another field is removed from the subject", () => {
  assert.equal(
    stripForeignTokens("tennis grigor dimitrov", { product: "Topps Chrome Tennis" }),
    "grigor dimitrov"
  );
  assert.equal(
    stripForeignTokens("dan marino teal dolphins", { surface_color: "Teal", team: "Miami Dolphins" }),
    "dan marino"
  );
  assert.equal(
    stripForeignTokens("platinum luisangel acuna", { product: "Topps Chrome Platinum" }),
    "luisangel acuna"
  );
});

test("cleaning never invents a different person", () => {
  // "Chase" is a real given name and also a Panini insert; stripping it would
  // hand the engine someone else entirely.
  assert.equal(stripForeignTokens("Chase Young", { product: "Panini Chase" }), "Chase Young");
  assert.equal(stripForeignTokens("Ken Griffey Jr", { product: "Upper Deck", set: "Jr" }), "Ken Griffey Jr");
  // A subject that would be emptied comes back untouched.
  assert.equal(stripForeignTokens("Prizm", { product: "Panini Prizm" }), "Prizm");
});

console.log("subject normalizer tests passed");
