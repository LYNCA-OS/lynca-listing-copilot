#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  isTruncationOf,
  normalizeSubject,
  resolveAgainstIndex,
  stripForeignTokens
} from "../lib/listing/catalog/subject-normalizer.mjs";

test("tail-truncated duplicate subjects collapse without merging given and full names", () => {
  for (const [full, truncated] of [["Pelé", "Pel"], ["Dončić", "Donči"], ["Modrić", "Modri"], ["Mbappé", "Mbapp"]]) {
    assert.deepEqual(normalizeSubject({ players: [full, truncated] }).subjects, [full]);
  }
  assert.equal(isTruncationOf("Luka", "Luka Modric"), false);
  assert.deepEqual(
    normalizeSubject({ players: ["Shohei Ohtani", "Mookie Betts"] }).subjects,
    ["Shohei Ohtani", "Mookie Betts"]
  );
});

test("only tokens independently present in another observed field are removed", () => {
  assert.equal(stripForeignTokens("tennis grigor dimitrov", { product: "Topps Chrome Tennis" }), "grigor dimitrov");
  assert.equal(stripForeignTokens("dan marino teal dolphins", { surface_color: "Teal", team: "Miami Dolphins" }), "dan marino");
  assert.equal(stripForeignTokens("platinum luisangel acuna", { product: "Topps Chrome Platinum" }), "luisangel acuna");
});

test("cleanup never reduces a real name to a fragment", () => {
  assert.equal(stripForeignTokens("Chase Young", { product: "Panini Chase" }), "Chase Young");
  assert.equal(stripForeignTokens("Ken Griffey Jr", { set: "Jr" }), "Ken Griffey Jr");
  assert.equal(stripForeignTokens("Prizm", { product: "Panini Prizm" }), "Prizm");
});

test("index repair is unique-or-null", () => {
  assert.equal(resolveAgainstIndex("luisangel acuna", ["luisangel acuña"]), "luisangel acuña");
  assert.equal(resolveAgainstIndex("luka donči", ["luka dončić"]), "luka dončić");
  assert.equal(resolveAgainstIndex("jose", ["José", "Jose"]), null);
});

console.log("subject normalizer tests passed");
