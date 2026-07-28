#!/usr/bin/env node
// The enumerator's value rests on one distinction: EMPTY means the field cannot
// apply, UNKNOWN means our coverage cannot say. Collapsing them is the error
// that has already cost two reverted changes, so it is the first thing tested.

import assert from "node:assert/strict";
import test from "node:test";

import { enumerateAll, enumerateProduct, enumerateTeam, outcomes } from "../lib/listing/catalog/constraint-enumerator.mjs";

const model = {
  player_teams: {
    "victor wembanyama": ["san antonio spurs"],
    "tom brady": ["new england patriots", "tampa bay buccaneers"],
    "shohei ohtani": ["angels", "japan", "los angeles dodgers"]
  },
  player_team_years: {
    "tom brady": { 2005: ["new england patriots"], 2021: ["tampa bay buccaneers"], 2026: ["new england patriots", "tampa bay buccaneers"] },
    "shohei ohtani": { 2025: ["los angeles dodgers"], 2026: ["angels", "japan", "los angeles dodgers"] }
  },
  set_product_years: {
    "fade to black": ["2025|panini phoenix"],
    "contours": ["2025|panini phoenix"],
    "refractor": ["2024|topps chrome", "2025|bowman chrome"],
    "chrome rookies": ["2025|topps chrome", "2025|bowman chrome"]
  }
};

test("a single-team career determines the team without looking", () => {
  const r = enumerateTeam({ player: "Victor Wembanyama", sport: "basketball" }, model);
  assert.equal(r.status, outcomes.VALUE);
  assert.equal(r.value, "san antonio spurs");
  assert.equal(r.reason, "single_team_in_career");
});

test("the printed year decides between two teams", () => {
  const brady2005 = enumerateTeam({ player: "Tom Brady", year: "2005", sport: "football" }, model);
  assert.equal(brady2005.status, outcomes.VALUE);
  assert.equal(brady2005.value, "new england patriots");

  const brady2021 = enumerateTeam({ player: "Tom Brady", year: "2021-22", sport: "football" }, model);
  assert.equal(brady2021.status, outcomes.VALUE, "a season string still starts in a year");
  assert.equal(brady2021.value, "tampa bay buccaneers");
});

test("without a usable year the answer is the candidate set, never a pick", () => {
  const r = enumerateTeam({ player: "Tom Brady", sport: "football" }, model);
  assert.equal(r.status, outcomes.UNKNOWN);
  assert.deepEqual(r.candidates, ["new england patriots", "tampa bay buccaneers"]);

  const stillAmbiguous = enumerateTeam({ player: "Tom Brady", year: "2026", sport: "football" }, model);
  assert.equal(stillAmbiguous.status, outcomes.UNKNOWN);
  assert.equal(stillAmbiguous.reason, "year_narrows_but_not_to_one");
});

test("a subject with no team is EMPTY, and a subject we never harvested is UNKNOWN", () => {
  const mickey = enumerateTeam({ player: "Mickey Mouse", sport: "entertainment" }, model);
  assert.equal(mickey.status, outcomes.EMPTY, "38 Mickey Mouse cards were counted as a missing team");

  const kobe = enumerateTeam({ player: "Kobe Bryant", sport: "basketball" }, model);
  assert.equal(kobe.status, outcomes.UNKNOWN, "not in the model is not the same as has no team");
  assert.equal(kobe.reason, "subject_not_in_model");
  assert.equal(kobe.value, null, "coverage we lack must never be answered with a guess");
});

test("a set name identifies the product line the card never prints", () => {
  const r = enumerateProduct({ set: "Fade To Black" }, model);
  assert.equal(r.status, outcomes.VALUE);
  assert.equal(r.value, "panini phoenix");

  const shared = enumerateProduct({ set: "Refractor" }, model);
  assert.equal(shared.status, outcomes.UNKNOWN, "Refractor is printed by more than one product");
  assert.equal(shared.candidates.length, 2);

  const byYear = enumerateProduct({ set: "Refractor", year: "2024" }, model);
  assert.equal(byYear.status, outcomes.VALUE);
  assert.equal(byYear.value, "topps chrome");

  const sameYear = enumerateProduct({ set: "Chrome Rookies", year: "2025" }, model);
  assert.equal(sameYear.status, outcomes.UNKNOWN, "the year cannot separate two products from the same year");
});

test("an unharvested set is UNKNOWN rather than refuted", () => {
  const r = enumerateProduct({ set: "Some Set Published Tomorrow", year: "2027" }, model);
  assert.equal(r.status, outcomes.UNKNOWN);
  assert.equal(r.reason, "set_not_in_model");
});

test("enumerateAll reports every field separately", () => {
  const all = enumerateAll({ player: "Victor Wembanyama", set: "Fade To Black", year: "2025", sport: "basketball" }, model);
  assert.equal(all.team.status, outcomes.VALUE);
  assert.equal(all.product.status, outcomes.VALUE);
});

console.log("constraint enumerator tests passed");
