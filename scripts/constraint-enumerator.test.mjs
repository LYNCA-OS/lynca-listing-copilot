#!/usr/bin/env node
// The enumerator's value rests on one distinction: EMPTY means the field cannot
// apply, UNKNOWN means our coverage cannot say. Collapsing them is the error
// that has already cost two reverted changes, so it is the first thing tested.

import assert from "node:assert/strict";
import test from "node:test";

import { enumerateAll, enumerateProduct, enumerateTeam, intervalCoversYear, outcomes } from "../lib/listing/catalog/constraint-enumerator.mjs";

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

// Career intervals are what let a card's own year answer the question. The
// checklist harvest covers 2024-2026 while 49% of production cards are older,
// so without these a 2000 Brady or a 2019 Ohtani is unanswerable.
const careerModel = {
  player_teams: { "lebron james": ["cleveland cavaliers", "east", "los angeles lakers"] },
  player_team_intervals: {
    "kobe bryant": [{ sport: "basketball", teams: [{ team: "Los Angeles Lakers", start: 1996, end: 2016 }] }],
    "shohei ohtani": [{ sport: "baseball", teams: [
      { team: "Hokkaido Nippon-Ham Fighters", start: 2013, end: 2017 },
      { team: "Los Angeles Angels", start: 2018, end: 2023 },
      { team: "Los Angeles Dodgers", start: 2024, end: null }
    ] }],
    "tom brady": [
      { sport: "American football", teams: [
        { team: "New England Patriots", start: 2000, end: 2019 },
        { team: "Tampa Bay Buccaneers", start: 2020, end: 2022 }
      ] },
      // Two other men are called Tom Brady and Wikidata never dated their
      // memberships. An undated membership must not answer for every year.
      { sport: "rugby", teams: [{ team: "Sale Sharks", start: null, end: null }] }
    ]
  }
};

test("a career interval answers a year the checklist harvest never covered", () => {
  const kobe = enumerateTeam({ player: "Kobe Bryant", year: "2003-04" }, careerModel);
  assert.equal(kobe.status, outcomes.VALUE);
  assert.equal(kobe.value, "los angeles lakers");

  const ohtani2019 = enumerateTeam({ player: "Shohei Ohtani", year: "2019" }, careerModel);
  assert.equal(ohtani2019.value, "los angeles angels", "2019 is inside the Angels interval, not the Dodgers one");

  const ohtani2025 = enumerateTeam({ player: "Shohei Ohtani", year: "2025" }, careerModel);
  assert.equal(ohtani2025.value, "los angeles dodgers", "an open end means still there");
});

test("an undated membership does not cover every year", () => {
  assert.equal(intervalCoversYear({ start: null, end: null }, 2000), false,
    "an unknown start is unknown, not the beginning of time");
  assert.equal(intervalCoversYear({ start: 1996, end: null }, 2000), true);
  assert.equal(intervalCoversYear({ start: 1996, end: 2016 }, 2020), false);

  // Before this was fixed, a 2000 Tom Brady card came back with the Patriots,
  // Sale Sharks and Geelong together, because two other men of that name have
  // memberships with no dates.
  const brady = enumerateTeam({ player: "Tom Brady", year: "2000", sport: "American football" }, careerModel);
  assert.equal(brady.status, outcomes.VALUE);
  assert.equal(brady.value, "new england patriots");
});

test("a shared name is not answered just because only one namesake has dates", () => {
  // The others may simply have no dated memberships, and absent data about them
  // is not evidence against them. This put "arizona cardinals" on a 2025-26
  // Bowman Chrome Caleb Wilson: the NFL tight end has dates, the basketball
  // prospect does not, so the only dated career won by default.
  const withoutSport = enumerateTeam({ player: "Tom Brady", year: "2000" }, careerModel);
  assert.equal(withoutSport.status, outcomes.UNKNOWN);
  assert.equal(withoutSport.reason, "ambiguous_subject_needs_sport");
  assert.equal(withoutSport.value, null);

  // The sport separates them -- and it is the field the provider is asked for
  // on every call and has returned zero times in 4,695.
  const withSport = enumerateTeam({ player: "Tom Brady", year: "2000", sport: "American football" }, careerModel);
  assert.equal(withSport.status, outcomes.VALUE);

  // A name only one person holds is unaffected.
  const kobe = enumerateTeam({ player: "Kobe Bryant", year: "2003-04" }, careerModel);
  assert.equal(kobe.status, outcomes.VALUE);
});

test("a teamless product answers EMPTY before consulting a polluted team set", () => {
  // The checklist-derived team column holds franchise names for entertainment
  // products, so Mickey Mouse resolved to the "team" mickey & friends.
  const polluted = { player_teams: { "mickey mouse": ["mickey & friends"] }, player_team_intervals: {} };
  const mickey = enumerateTeam({ player: "Mickey Mouse", year: "2025", product: "Disney Lorcana" }, polluted);
  assert.equal(mickey.status, outcomes.EMPTY);
  assert.equal(mickey.reason, "product_has_no_teams");
  assert.equal(mickey.value, null, "a confident wrong team is worse than no answer");
});

console.log("constraint enumerator tests passed");
