// When two strings state the same fact, a scorer that calls one of them wrong
// is measuring itself, not the pipeline.
//
// Measured on the 150-card confirmatory cohort, changing no pipeline output at
// all, only letting the metric recognise what the pipeline already knows:
//
//   synonym classes   +0.010985   45 cards
//   plural folding    +0.001973
//   orthography       +0.000837
//   together          +0.011779   0.777351 -> 0.789130
//
// That is larger than any mechanism this repository shipped on the same day.
//
// WHY THIS IS NOT A PIPELINE CHANGE. The obvious reading -- emit both forms --
// was measured and is decisively wrong: rendering "Auto Autograph" scored
// -0.009094 with 7 wins to 47 losses, and "Rookie RC" -0.002712 with 13 to 29,
// because writers overwhelmingly publish one form and the second word is a
// precision cost on every card that used it alone. The composer's choice is
// correct. The metric's blindness is the defect.
//
// HIERARCHY IS DELIBERATELY ABSENT. Scoring "Refractor" against a writer's
// "Gold Refractor" already behaves correctly under token overlap: we earn
// `refractor` and lose `gold`, and losing `gold` is right because we did not
// identify the colour. Granting ancestor credit was measured at +0.001897 over
// 6 cards and would be paying us for a fact we never established. Hierarchy is
// needed by the claim-level ruler, where a true generalisation is otherwise
// judged a false claim with no partial credit available -- a correctness
// requirement there, not a score recovery here.
//
// This module NEVER becomes the default silently. Every reading is labelled
// with EQUIVALENCE_VERSION, and callers opt in. A scorer quietly changed
// between runs is the confound the paired design exists to prevent, and every
// number recorded before this file must stay comparable to itself.

import { createHash } from "node:crypto";

/**
 * Classes of strings that state the same fact. Membership is evidence-led, from
 * what the writer publishes across 358 confirmed titles, not from what looks
 * interchangeable. `signature` folds into `auto` because the writer uses them
 * for one thing; `relic` and `memorabilia` likewise.
 */
export const SYNONYM_CLASSES = Object.freeze([
  Object.freeze({ canonical: "auto", forms: Object.freeze(["auto", "autos", "autograph", "autographs", "autographed", "signature", "signatures", "sig", "sigs"]) }),
  Object.freeze({ canonical: "rc", forms: Object.freeze(["rc", "rookie", "rookies"]) }),
  Object.freeze({ canonical: "relic", forms: Object.freeze(["relic", "relics", "memorabilia"]) }),
  Object.freeze({ canonical: "patch", forms: Object.freeze(["patch", "patches"]) }),
  Object.freeze({ canonical: "refractor", forms: Object.freeze(["refractor", "refractors"]) }),
  Object.freeze({ canonical: "prizm", forms: Object.freeze(["prizm", "prizms"]) })
]);

const FORM_TO_CANONICAL = new Map();
for (const cls of SYNONYM_CLASSES) for (const form of cls.forms) FORM_TO_CANONICAL.set(form, cls.canonical);

/**
 * Rendering differences that carry no meaning. We publish Ibrahimović, Dončić,
 * Pokémon and a typographic apostrophe in D'Angelo; the writer types ASCII. Our
 * rendering is the more faithful one, so folding these is not a concession.
 */
function foldOrthography(text) {
  return String(text ?? "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Plural of a term, not a word ending in s. `is`/`us`/`ss` are not plurals. */
function foldPlural(word) {
  if (/(ss|us|is)$/.test(word)) return word;
  return word.replace(/s$/, "");
}

/**
 * One token's canonical form. Order matters: orthography first so `Dončić`
 * reaches the synonym table as `doncic`, then the synonym class, then plurals
 * for anything the table does not cover.
 */
export function canonicaliseToken(token) {
  const folded = foldOrthography(token).toLowerCase();
  const mapped = FORM_TO_CANONICAL.get(folded);
  if (mapped) return mapped;
  return foldPlural(folded);
}

/**
 * Tokenise and canonicalise a title. Returns a Set, because the scorer this
 * feeds compares presence rather than counts.
 */
export function equivalenceTokens(text) {
  return new Set(foldOrthography(text)
    .toLowerCase()
    .split(/[^a-z0-9/']+/)
    .filter(Boolean)
    .map(canonicaliseToken));
}

/**
 * Stable identity of the vocabulary above. A reading taken under one version is
 * not comparable to a reading taken under another, so the version travels with
 * every result rather than living in a changelog.
 */
export const EQUIVALENCE_VERSION = `sem-equiv-1+${createHash("sha256")
  .update(JSON.stringify(SYNONYM_CLASSES))
  .digest("hex")
  .slice(0, 12)}`;

/**
 * Score a title against a reference, both raw and equivalence-aware.
 *
 * Both readings are always returned. Reporting only the higher one would make
 * this file a way to improve numbers rather than a way to measure honestly,
 * and the raw reading is what every prior result in this repository used.
 */
export function scoreWithEquivalence(reference, title) {
  const plain = (text) => new Set(String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
  const f1 = (want, got) => {
    const hits = [...want].filter((t) => got.has(t)).length;
    const recall = want.size ? hits / want.size : 0;
    const precision = got.size ? hits / got.size : 0;
    return {
      recall,
      precision,
      f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0
    };
  };
  return {
    raw: f1(plain(reference), plain(title)),
    equivalent: f1(equivalenceTokens(reference), equivalenceTokens(title)),
    equivalence_version: EQUIVALENCE_VERSION
  };
}
