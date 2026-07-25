// Loads the committed field-vocabulary artifact and answers attestation
// questions for the pipeline.
//
// The open-set taxonomy rules suppress optical wording (Refractor, Sparkle,
// Lava, Prizm ...) because a shiny card is not evidence of a named parallel.
// That is right for a guess and wrong for a name the catalog can vouch for:
// "Green Lava Refractor" appears 19 times in the catalog, so it is a real Topps
// parallel, not an impression. Attestation lets the renderer tell those apart.
//
// Failing open would re-admit the guesses this protects against, so a missing
// or unreadable artifact attests nothing and every caller keeps its previous
// behaviour.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attestTerm, trimAttributePrefix } from "./field-vocabulary.mjs";

const defaultPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data/catalog/vocabulary/field-vocabulary.json"
);

let cache = null;

export function loadFieldVocabulary({ path = defaultPath, reload = false } = {}) {
  if (cache && !reload) return cache;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const rows = [];
    for (const [field, list] of Object.entries(parsed.fields || {})) {
      for (const entry of list) rows.push({ ...entry, field });
    }
    cache = { rows, generated_at: parsed.generated_at || null, term_count: rows.length };
  } catch {
    cache = { rows: [], generated_at: null, term_count: 0 };
  }
  return cache;
}

/**
 * Is this wording a value the catalog has actually seen for this field?
 * Official checklist wording attests at any frequency; marketplace wording
 * needs corroboration so one mis-parsed title cannot mint vocabulary.
 */
export function attestFieldValue(field, value, options = {}) {
  const vocabulary = loadFieldVocabulary(options).rows;
  if (!vocabulary.length) return { attested: false, reason: "vocabulary_unavailable" };
  return attestTerm(vocabulary, field, value, options);
}

// Convenience for the renderer: parallel wording lives under print_finish, and
// callers pass raw title-cased values such as "Gold Refractor".
//
// A bare finish head ("Prizm", "Refractor") is exactly the impression the gate
// exists to reject: it names no parallel, and when the product line is already
// "Panini Prizm" it only repeats the product. Reviewed titles bear this out --
// none of them write "<colour> Prizm", while "Red Wave Prizm", "Gold Shimmer"
// and "Red Sparkle" are all used. Only a qualified phrase is a name, so
// attestation requires more than one word.
export function attestedParallelWording(value, options = {}) {
  const term = trimAttributePrefix(value);
  if (!term || term.split(" ").filter(Boolean).length < 2) return false;
  return attestFieldValue("print_finish", term, options).attested === true;
}
