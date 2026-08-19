// Token F1 cannot tell "said something extra and true" from "asserted something
// false about a printed field".
//
// Measured on the gamma-53 rows: adding `Brewers` to
//   2026 Bowman Chrome Jacob Misiorowski RC #35
// costs precision, while inventing the serial `077/499` where the card reads
// `094/125` costs LESS. One is verbosity, the other is fabrication of a fact
// printed on the card, and the primary metric ranks them the wrong way round.
//
// This module does not replace F1. It reports, per CSM bracket, whether the two
// titles make COMPETING claims -- the only case where the reviewed title proves
// the candidate wrong. Brackets the reference is silent on stay UNSUPPORTED:
// unverifiable is not the same as false, and counting it as false would punish
// exactly the recall the composer is supposed to buy.
//
// The finish vocabulary is NOT invented here. It is the runtime's own
// hash-pinned CAPTURED_E1AE_FINISH_TAXONOMY, so this metric and the composer
// cannot drift apart silently.

import {
  CAPTURED_E1AE_FINISH_TAXONOMY
} from "../../lib/listing/thin/captured-production-e1ae-finish-taxonomy.mjs";

// Printed brackets: the card physically carries these, so a disagreement is a
// misread or an invention, never a stylistic choice. These are the ones COS
// means by "fabrication is never excused".
export const PRINTED_BRACKETS = Object.freeze(["year", "card_number", "serial", "grade"]);
// Recognised bracket: optically determined rather than transcribed. A
// disagreement here is a recognition error -- still wrong, but a different
// failure with a different fix, so it is counted separately.
export const RECOGNISED_BRACKETS = Object.freeze(["finish"]);
export const ALL_BRACKETS = Object.freeze([...PRINTED_BRACKETS, ...RECOGNISED_BRACKETS]);

const FINISH_TERMS = Object.freeze([...new Set([
  ...Object.values(CAPTURED_E1AE_FINISH_TAXONOMY.families).flat(),
  ...CAPTURED_E1AE_FINISH_TAXONOMY.domain_neutral
])].sort((a, b) => b.length - a.length));

// Colours are the other half of Print Finish. The composer renders
// surface_color + parallel_family together, so the metric has to read both or
// it would score "Purple Shimmer" against "Fuchsia Wave Refractor" as a match
// on nothing.
const COLOUR_TERMS = Object.freeze([
  "aqua", "black", "blue", "bronze", "copper", "fuchsia", "gold", "green",
  "orange", "pink", "purple", "red", "silver", "teal", "white", "yellow"
]);

const fold = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function extractYear(text) {
  // 1998-99 and 2018-19 are one bracket, not two. Match the ranged form first.
  const ranged = text.match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2})\b/);
  if (ranged) return `${ranged[1]}-${ranged[2]}`;
  const plain = text.match(/\b((?:19|20)\d{2})\b/);
  return plain ? plain[1] : "";
}

function extractSerial(text) {
  // A print run: 022/350, 1/1, #/99. Must not swallow a ranged year, which is
  // why the year is matched first and its span excluded by the \d{3,} guard on
  // the denominator side being optional but the numerator never being a year.
  const matches = [...text.matchAll(/\b(\d{1,5})\s*\/\s*(\d{1,5})\b/g)];
  for (const match of matches) {
    const [, numerator, denominator] = match;
    if (/^(?:19|20)\d{2}$/.test(numerator) && denominator.length === 2) continue;
    return `${Number(numerator)}/${Number(denominator)}`;
  }
  return "";
}

function extractCardNumber(text) {
  const hashed = text.match(/#\s*([a-z0-9][a-z0-9-]*)/i);
  if (hashed) return fold(hashed[1]).replace(/-/g, "");
  return "";
}

function extractGrade(text) {
  const match = text.match(/\b(psa|bgs|sgc|cgc|scd)\s*(\d{1,2}(?:\.\d)?)?\b/i);
  if (!match) return "";
  return match[2] ? `${fold(match[1])} ${match[2]}` : fold(match[1]);
}

function extractFinish(text) {
  const found = new Set();
  for (const term of FINISH_TERMS) {
    if (new RegExp(`(?:^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`, "i").test(text)) {
      found.add(term);
    }
  }
  for (const colour of COLOUR_TERMS) {
    if (new RegExp(`(?:^|[^a-z])${colour}(?:$|[^a-z])`, "i").test(text)) found.add(colour);
  }
  return [...found].sort().join(" ");
}

const EXTRACTORS = Object.freeze({
  year: extractYear,
  card_number: extractCardNumber,
  serial: extractSerial,
  grade: extractGrade,
  finish: extractFinish
});

export function bracketsFromTitle(title) {
  const text = fold(title);
  const out = {};
  for (const bracket of ALL_BRACKETS) out[bracket] = EXTRACTORS[bracket](text);
  return out;
}

/**
 * Compare one candidate title against the writer-reviewed reference.
 *
 * MATCHED       both assert, and they agree
 * CONTRADICTED  both assert, and they disagree  <- the hallucination signal
 * UNSUPPORTED   only the candidate asserts       <- unverifiable, NOT counted as false
 * MISSED        only the reference asserts
 * ABSENT        neither asserts
 */
export function compareTitleBrackets(reference, candidate) {
  const expected = bracketsFromTitle(reference);
  const actual = bracketsFromTitle(candidate);
  const verdicts = {};
  for (const bracket of ALL_BRACKETS) {
    const want = expected[bracket];
    const got = actual[bracket];
    if (!want && !got) verdicts[bracket] = "ABSENT";
    else if (want && !got) verdicts[bracket] = "MISSED";
    else if (!want && got) verdicts[bracket] = "UNSUPPORTED";
    else verdicts[bracket] = want === got ? "MATCHED" : "CONTRADICTED";
  }
  const contradictedPrinted = PRINTED_BRACKETS.filter((b) => verdicts[b] === "CONTRADICTED");
  const contradictedRecognised = RECOGNISED_BRACKETS.filter((b) => verdicts[b] === "CONTRADICTED");
  return {
    expected,
    actual,
    verdicts,
    contradicted_printed: contradictedPrinted,
    contradicted_recognised: contradictedRecognised,
    // The headline number. A card is a fabrication case when it asserts a
    // printed fact the reviewed title proves wrong.
    fabricated: contradictedPrinted.length > 0
  };
}

export function summarizeContradictions(rows = []) {
  const perBracket = {};
  for (const bracket of ALL_BRACKETS) {
    perBracket[bracket] = { MATCHED: 0, CONTRADICTED: 0, UNSUPPORTED: 0, MISSED: 0, ABSENT: 0 };
  }
  let fabricatedCards = 0;
  for (const row of rows) {
    if (row.fabricated) fabricatedCards += 1;
    for (const bracket of ALL_BRACKETS) perBracket[bracket][row.verdicts[bracket]] += 1;
  }
  return {
    cards: rows.length,
    fabricated_cards: fabricatedCards,
    fabrication_rate: rows.length ? fabricatedCards / rows.length : 0,
    recognised_contradiction_cards: rows.filter((row) => row.contradicted_recognised.length > 0).length,
    per_bracket: perBracket
  };
}
