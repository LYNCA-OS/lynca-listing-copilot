// Score a title against the reviewed title FIELD BY FIELD, using CSM's own
// parser on both sides.
//
// Two earlier attempts at a CSM metric were written by hand and both failed
// blind calibration -- 17% and 58% agreement against 74% for plain token
// recall. The diagnosis each time was the same: I chose which brackets to look
// at and how much each was worth, and both choices drifted toward the arm I had
// just built. One of them scored the canonical arm on its FIELDS while scoring
// the string arm on its TITLE, inflating it by 5.2pp; that bug was found by
// hand-reading 20 cards, not by reasoning about the design, which looked sound
// the whole time.
//
// `titleDerivedSemSuggestion` removes some of that discretion: it is CSM's own
// title-to-SEM parser, written for the writer feedback loop rather than for
// this comparison, so it has no stake in which arm wins.
//
// WHAT IT CANNOT DO, measured on 150 cards before trusting it: the parser's
// field BOUNDARIES are unreliable on free text. It returned "Spencer Dinwiddie
// Shock" against "Spencer Dinwiddie", "Nbl Karim Lopez" against "Karim Lopez",
// and on one card dropped "Saka" from the REFERENCE side. Exact comparison
// turned every boundary wobble into a model error and reported 65 of 150
// subjects missing. So the headline covers ANCHORED fields only -- the ones
// pinned by shape or a closed vocabulary, where the parser reads both sides the
// same way -- and the free fields are reported for reading, not for deciding.

import { titleDerivedSemSuggestion } from "../csm/title-derived-sem.mjs";

export const ANCHORED_FIELDS = Object.freeze(["year", "manufacturer", "numerical_rarity", "card_number"]);

export const SCALAR_FIELDS = Object.freeze([
  "year", "manufacturer", "product", "set", "card_name",
  "release_variant", "print_finish", "numerical_rarity",
  "descriptive_rarity", "card_number"
]);
export const LIST_FIELDS = Object.freeze(["subject", "search_optimization"]);

// Diacritics and curly quotes are spelling, not disagreement -- "Acuña" and
// "Acuna", "D’Angelo" and "D'Angelo".
const norm = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase()
  .replace(/[^a-z0-9/&'-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const normList = (value) => (Array.isArray(value) ? value : [value]).map(norm).filter(Boolean);

export function scoreCsmFields(referenceTitle, predictedTitle) {
  const want = titleDerivedSemSuggestion(referenceTitle) || {};
  const got = titleDerivedSemSuggestion(predictedTitle) || {};
  const fields = {};

  for (const name of SCALAR_FIELDS) {
    const a = norm(want[name]);
    const b = norm(got[name]);
    fields[name] = {
      // correct / wrong (a MISREAD) / missed (an OMISSION) / extra
      // (unverifiable -- a reviewer omitting a value is not the model being
      // wrong) / absent.
      state: a && b ? (a === b ? "correct" : "wrong") : a ? "missed" : b ? "extra" : "absent",
      want: want[name] ?? null,
      got: got[name] ?? null
    };
  }

  for (const name of LIST_FIELDS) {
    const a = normList(want[name]);
    const b = normList(got[name]);
    // Containment, not equality: "Spencer Dinwiddie" is present inside
    // "Spencer Dinwiddie Shock", and calling that a miss measures the parser.
    const hit = a.filter((value) => b.some((candidate) =>
      candidate === value || candidate.includes(value) || value.includes(candidate))).length;
    fields[name] = {
      state: !a.length ? (b.length ? "extra" : "absent")
        : hit === a.length && hit === b.length ? "correct"
          : hit ? "partial" : "missed",
      hit,
      wanted: a.length,
      got: b.length
    };
  }

  // ANCHORED only. Folding in the free fields would report the parser's
  // boundary noise as model quality.
  let decided = 0;
  let earned = 0;
  for (const name of ANCHORED_FIELDS) {
    const part = fields[name];
    if (!part || part.state === "extra" || part.state === "absent") continue;
    decided += 1;
    if (part.state === "correct") earned += 1;
    else if (part.state === "partial") earned += part.hit / part.wanted;
  }

  return { fields, decided, earned, score: decided ? earned / decided : null };
}

export function summariseCsmFields(rows) {
  const names = [...SCALAR_FIELDS, ...LIST_FIELDS];
  const states = Object.fromEntries(names.map((name) => [name, {}]));
  const scores = [];
  for (const row of rows) {
    const scored = scoreCsmFields(row.reference, row.title);
    if (scored.score !== null) scores.push(scored.score);
    for (const name of names) {
      const state = scored.fields[name].state;
      states[name][state] = (states[name][state] ?? 0) + 1;
    }
  }
  return {
    n: rows.length,
    score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    states
  };
}
