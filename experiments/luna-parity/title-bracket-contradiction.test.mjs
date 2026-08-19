// The detector proves itself before it is used to judge anything.
//
// Every case below is a real row from the gamma-53 scored summary, not a
// constructed example, so a pass here means the metric sees the failures we
// already know are in that run.

import assert from "node:assert/strict";

import {
  bracketsFromTitle,
  compareTitleBrackets,
  summarizeContradictions
} from "./title-bracket-contradiction.mjs";

// ── extraction ──────────────────────────────────────────────────────────────

assert.equal(bracketsFromTitle("1998-99 Fleer Ultra Michael Jordan Gold Medallion #85G").year,
  "1998-99", "a ranged season is one bracket, not the year 1998 plus a stray 99");
assert.equal(bracketsFromTitle("2026 Bowman Chrome Dasan Hill Raywave Twins #BCP-88 09/150").serial,
  "9/150", "serial is compared by value, so a dropped leading zero is not a fabrication");
assert.equal(bracketsFromTitle("2026 Bowman Baseball Dasan Hill Chrome Prospect BCP-88 Wave Refractor 022/350").serial,
  "22/350");
assert.equal(bracketsFromTitle("2018 Panini Encased Jaren Jackson Jr. RC Jersey Auto #/99 Grizzlies BGS 9.5/9").year,
  "2018", "a ranged year must not be read out of a grade fraction");
assert.equal(bracketsFromTitle("... #BCP-125 137/199").card_number, "bcp125",
  "checklist codes compare without their hyphen");
assert.equal(bracketsFromTitle("2020 Contenders Anthony Edwards #105 PSA 10").grade, "psa 10");

// ── the case the whole metric exists for ────────────────────────────────────

// Real row. The candidate added a true team name the writer chose to omit.
const verbose = compareTitleBrackets(
  "2026 Bowman Chrome Jacob Misiorowski RC #35",
  "2026 Bowman Chrome Jacob Misiorowski RC Brewers #35"
);
assert.equal(verbose.fabricated, false,
  "saying something extra and true is not fabrication");
assert.deepEqual(verbose.contradicted_printed, []);

// Real row. The candidate invented a print run the card does not carry.
const invented = compareTitleBrackets(
  "2026 Bowman Baseball Ethan Dorchies Aqua Shimmer Refractor #BCP-52 094/125",
  "2026 Bowman Chrome Ethan Dorchies Aqua Raywave 1st Bowman #BCP-52 077/499"
);
assert.equal(invented.fabricated, true,
  "inventing 077/499 where the card reads 094/125 is fabrication of a printed fact");
assert.deepEqual(invented.contradicted_printed, ["serial"]);

// This is the ranking token F1 got backwards: the fabrication must not score
// better than the harmless addition.
assert.ok(invented.fabricated && !verbose.fabricated,
  "the metric must separate the two cases token F1 conflates");

// Real row. Serial invented AND the finish misrecognised.
const both = compareTitleBrackets(
  "2026 Bowman Baseball Dasan Hill Chrome Prospect BCP-88 Wave Refractor 022/350",
  "2026 Bowman Chrome Dasan Hill Raywave Twins #BCP-88 09/150"
);
assert.equal(both.fabricated, true);
assert.deepEqual(both.contradicted_printed, ["serial"]);
assert.deepEqual(both.contradicted_recognised, ["finish"],
  "raywave against wave refractor is a recognition contradiction, counted apart from printed facts");

// Real row. Wrong year and wrong product, finish disagreement.
const wrongYear = compareTitleBrackets(
  "2026 Bowman Baseball Nick Kurtz Power Chords PC-6 Aqua Refractor 010/125",
  "2025 Topps Chrome Nick Kurtz Power Pours PC-6 Orange /125 RC Athletics"
);
assert.ok(wrongYear.contradicted_printed.includes("year"),
  "2025 against 2026 is a contradicted printed bracket");

// ── silence is not falsehood ────────────────────────────────────────────────

const silent = compareTitleBrackets(
  "1961 Topps Mickey Mantle #300",
  "1961 Topps Mickey Mantle #300 PSA 8"
);
assert.equal(silent.verdicts.grade, "UNSUPPORTED",
  "a grade the reference never mentions is unverifiable, not proven false");
assert.equal(silent.fabricated, false,
  "UNSUPPORTED must never be counted as fabrication -- that would punish recall");

const dropped = compareTitleBrackets(
  "2026 Bowman Chrome Wei-En Lin Fuchsia Wave Refractor #BCP-125 137/199",
  "2026 Bowman Chrome Wei-En Lin #BCP-125"
);
assert.equal(dropped.verdicts.serial, "MISSED");
assert.equal(dropped.fabricated, false, "dropping a bracket is a recall loss, not a lie");

// ── summary ─────────────────────────────────────────────────────────────────

const summary = summarizeContradictions([verbose, invented, both, wrongYear, silent, dropped]);
assert.equal(summary.cards, 6);
assert.equal(summary.fabricated_cards, 3);
assert.equal(summary.per_bracket.serial.CONTRADICTED, 2);
assert.equal(summary.per_bracket.grade.UNSUPPORTED, 1);

console.log("title bracket contradiction: ok (all cases are real gamma-53 rows)");
