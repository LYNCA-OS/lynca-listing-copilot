#!/usr/bin/env node
// A second look costs about 4.27s -- the measured candidate p50 -- on top of
// the first. Asking for one on every card doubles latency to buy nothing on the
// cards that were already complete, so the decision is the whole module.

import assert from "node:assert/strict";
import test from "node:test";

import { planSecondLook } from "../lib/listing/catalog/second-look-planner.mjs";

test("a complete card is not looked at twice", () => {
  const plan = planSecondLook(
    { player: "Kobe Bryant", year: "2003-04", product: "Topps Chrome", card_number: "12", set: "Chrome" },
    {}
  );
  assert.equal(plan.worthIt, false);
  assert.equal(plan.reason, "nothing_missing");
});

test("a field the engine derived needs no photograph", () => {
  // team empty on the card, but Kobe played for one club: derived, not looked at.
  const plan = planSecondLook(
    { player: "Kobe Bryant", year: "2003-04", card_number: "12", set: "Chrome" },
    { team: { status: "VALUE" }, product: { status: "VALUE" } }
  );
  assert.equal(plan.worthIt, false);
  assert.equal(plan.reason, "nothing_missing");
});

test("EMPTY counts as settled, not as missing", () => {
  // A Mickey Mouse card is not missing a team. It has none.
  const plan = planSecondLook(
    { player: "Mickey Mouse", year: "2025", product: "Disney Lorcana", card_number: "7", set: "Iconic" },
    { team: { status: "EMPTY" } }
  );
  assert.equal(plan.worthIt, false);
});

test("what is missing and printed earns a targeted crop", () => {
  const plan = planSecondLook(
    { year: "2025", product: "Topps Chrome", set: "Chrome" },
    { team: { status: "UNKNOWN" } }
  );
  assert.equal(plan.worthIt, true);
  assert.ok(plan.crops.includes("subject_crop"), "the player is missing and printed");
  assert.ok(plan.crops.includes("card_code_crop"), "so is the card number");
  assert.ok(plan.crops.length <= 4, "the executor accepts four crops");
});

test("the crops are ordered by what a title loses without them", () => {
  const plan = planSecondLook({}, {});
  assert.equal(plan.crops[0], "subject_crop", "the player is worth more than the grade");
  assert.ok(plan.crops.length <= 4);
});

test("a field no camera can settle does not justify a second call", () => {
  // parallel_exact is manufacturer vocabulary and sport is never printed.
  // Looking harder cannot produce either; this is where abstention belongs.
  const plan = planSecondLook(
    { player: "X", year: "2025", product: "Panini Prizm", card_number: "5", set: "Prizm" },
    { parallel_exact: { status: "UNKNOWN" }, sport: { status: "UNKNOWN" } }
  );
  assert.equal(plan.worthIt, false);
});

test("an absent optional field is an answer, not a gap", () => {
  // Most cards are not serial numbered, not graded, carry no insert -- 55% and
  // 35% in production. A card with none of those is complete, not incomplete.
  const plan = planSecondLook(
    { player: "X", year: "2025", product: "Panini Prizm", card_number: "5", set: "Prizm" },
    {}
  );
  assert.equal(plan.worthIt, false);
  assert.equal(plan.reason, "nothing_missing");
});

test("an optional field IS a gap once the card says it has one", () => {
  // A serial number was read but its denominator was not: the card is numbered
  // and we failed to read how far. That is worth the serial crop.
  const plan = planSecondLook(
    { player: "X", year: "2025", product: "Panini Prizm", card_number: "5", set: "Prizm",
      serial_number: "12/99" },
    {}
  );
  assert.equal(plan.worthIt, false, "one 55-point field is under the 60 threshold");
  assert.deepEqual(plan.fields, ["serial_denominator"]);

  // Two gaps together clear it.
  const two = planSecondLook(
    { year: "2025", product: "Panini Prizm", set: "Prizm", serial_number: "12/99" },
    {}
  );
  assert.equal(two.worthIt, true);
  assert.ok(two.crops.includes("subject_crop") && two.crops.includes("serial_crop"));
});

console.log("second look planner tests passed");
