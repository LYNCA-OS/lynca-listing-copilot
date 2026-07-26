import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyToken,
  documentFrequency,
  gateVerdict,
  multisetDiff,
  scoreCard,
  summarize,
  tokens
} from "./writer-acceptance-eval.mjs";

test("tokens drop punctuation and the leading # on card numbers", () => {
  assert.deepEqual(
    tokens("2025 Topps Chrome #DF-3 Duel of the Fates 15/50 SP"),
    ["2025", "topps", "chrome", "df-3", "duel", "of", "the", "fates", "15/50", "sp"]
  );
});

test("a token needed twice and supplied once is still short", () => {
  const { missing, extra } = multisetDiff(["gold", "gold", "prizm"], ["gold", "prizm"]);
  assert.deepEqual(missing, ["gold"]);
  assert.deepEqual(extra, []);
});

test("tokens we supplied but the reviewed title does not want count as extra", () => {
  const { missing, extra } = multisetDiff(["prizm"], ["prizm", "jaguars"]);
  assert.deepEqual(missing, []);
  assert.deepEqual(extra, ["jaguars"]);
});

// The whole point of using frequency: "chrome" recurs across the corpus,
// "robinson" does not, and no hand-kept vocabulary has to be maintained.
test("structural words are separated from names by corpus frequency", () => {
  const corpus = [
    "2025 Topps Chrome Bijan Robinson RC",
    "2025 Topps Chrome Dalton Rushing RC",
    "2024 Topps Chrome Paul Skenes RC",
    "2024 Topps Chrome Jackson Holliday RC"
  ];
  const context = { df: documentFrequency(corpus), corpusSize: corpus.length };
  assert.equal(classifyToken("chrome", context), "structural");
  assert.equal(classifyToken("topps", context), "structural");
  assert.equal(classifyToken("robinson", context), "name");
});

test("serials, years and markers are classified before frequency is consulted", () => {
  const context = { df: new Map(), corpusSize: 1 };
  assert.equal(classifyToken("15/50", context), "serial");
  assert.equal(classifyToken("2025", context), "year");
  assert.equal(classifyToken("2025-26", context), "year");
  assert.equal(classifyToken("rc", context), "marker");
  assert.equal(classifyToken("auto", context), "marker");
});

const corpus = [
  "2025 Panini Donruss Travis Hunter Rated Throwback RC",
  "2025 Panini Donruss Caleb Williams Rated Rookie RC",
  "2025 Panini Prizm Travis Hunter Silver",
  "2024 Panini Prizm Caleb Williams Silver"
];
const context = { df: documentFrequency(corpus), corpusSize: corpus.length };

test("a title missing only the year is cheap, not catastrophic", () => {
  const card = scoreCard(
    "Panini Donruss Travis Hunter Rated Throwback RC",
    "2025 Panini Donruss Travis Hunter Rated Throwback RC",
    context
  );
  assert.equal(card.edits, 1);
  assert.equal(card.catastrophic, false);
  assert.equal(card.cosmetic_only, true);
  assert.equal(card.missing_classes.year, 1);
});

// The failure the token metric prices the same as a typo, and a lister does not.
test("a title naming a different player is catastrophic however few the edits", () => {
  const card = scoreCard(
    "2025 Panini Donruss Caleb Williams Rated Throwback RC",
    "2025 Panini Donruss Travis Hunter Rated Throwback RC",
    context
  );
  assert.equal(card.catastrophic, true);
  assert.equal(card.cosmetic_only, false);
});

test("a missing serial is structural, not cosmetic", () => {
  const card = scoreCard(
    "2025 Panini Prizm Travis Hunter Silver",
    "2025 Panini Prizm Travis Hunter Silver 15/50",
    context
  );
  assert.equal(card.missing_classes.serial, 1);
  assert.equal(card.cosmetic_only, false);
  assert.equal(card.catastrophic, false);
});

test("an exact title needs no edits and is not flagged", () => {
  const card = scoreCard(corpus[0], corpus[0], context);
  assert.equal(card.edits, 0);
  assert.equal(card.catastrophic, false);
  assert.equal(card.cosmetic_only, false);
});

test("summarize reports acceptance, retype and catastrophic rates", () => {
  const cards = [
    { edits: 0, gt_length: 8, missing_classes: {}, catastrophic: false, cosmetic_only: false },
    { edits: 2, gt_length: 8, missing_classes: { year: 1 }, catastrophic: false, cosmetic_only: true },
    { edits: 9, gt_length: 8, missing_classes: { name: 2 }, catastrophic: true, cosmetic_only: false },
    { edits: 5, gt_length: 8, missing_classes: { serial: 1 }, catastrophic: false, cosmetic_only: false }
  ];
  const s = summarize(cards);
  assert.equal(s.accept_0, 0.25);
  assert.equal(s.accept_2, 0.5);
  assert.equal(s.catastrophic_rate, 0.25);
  assert.equal(s.retype_rate, 0.5, "9 edits exceeds the retype floor; 5 exceeds half an 8-word title");
  assert.deepEqual(s.missing_by_class, { year: 1, name: 2, serial: 1 });
});

test("the gate fails when any single lister-facing threshold is missed", () => {
  const passing = { accept_2: 0.7, retype_rate: 0.05, catastrophic_rate: 0.0 };
  assert.equal(gateVerdict(passing).pass, true);
  assert.equal(gateVerdict({ ...passing, accept_2: 0.4 }).pass, false);
  assert.equal(gateVerdict({ ...passing, retype_rate: 0.4 }).pass, false);
  assert.equal(gateVerdict({ ...passing, catastrophic_rate: 0.1 }).pass, false);
});
