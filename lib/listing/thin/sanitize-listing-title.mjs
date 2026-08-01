// Deterministic cleanup of a model-written listing title.
//
// The bare model scores 0.8334 on the 255-card sealed set -- better than every
// pipeline arm measured -- but 16 of those 255 titles end in a fragment of
// another script: CJK gambling spam, Armenian, Thai, Kannada, Abkhaz, or an
// unassigned private-use codepoint. That is the only reason the bare call
// cannot ship as-is, and it does not need a pipeline to fix. It needs string
// handling.
//
// Two facts from the 255-card audit shape the rules below, and both should be
// re-checked before the rules are loosened:
//
//   1. Every occurrence is at the END of the title. Not one card had foreign
//      text in the middle. So the scan runs from the tail and stops at the
//      first character that belongs.
//   2. The scored damage is small (dirty cards averaged 0.8253 against 0.8338
//      clean) because token recall barely penalises a trailing token. The
//      reason to strip it is not the score; it is that gambling spam cannot
//      appear in a seller's eBay title.

// What a listing title may contain: printable ASCII, the Latin letters that
// appear in player and set names (Peña, Müller), and typographic punctuation.
//
// Deliberately NOT a "block these scripts" list. A blocklist has to enumerate
// the garbage, and the audit already found six scripts plus a private-use
// codepoint across 16 cards; the seventh would pass through.
const ALLOWED_CHARACTER = /[\x20-\x7EÀ-ɏ‘’“”–—]/;

// Punctuation that cannot legitimately end a listing title. A trailing "?" is
// the model hedging -- 13 of 255 cards ended in one -- and "＿" or "-" is
// usually the seam where foreign text was attached.
//
// Two characters are deliberately absent. "!" ends a real inscription
// ("Inscribed Go Heels!"). "+" is a grade suffix: an earlier version turned
// "SCD Authentic 8.5 NM/MT+" into "NM/MT", which the scorer did not penalise
// and which was wrong anyway.
const DANGLING_TAIL = /[\s?＿_\-–—:;,/\\|&*#~"'`(\[{<]+$/;

const LEADING_LABEL = /^(?:title|listing title|ebay title)\s*[:\-]\s*/i;
const WRAPPING_QUOTES = /^["'‘’“”]+|["'‘’“”]+$/g;

/**
 * @returns {{ title: string, changed: boolean, strippedTail: string }}
 *   `strippedTail` is kept so a caller can count contamination rather than
 *   silently absorbing it. A cleanup that leaves no trace makes the underlying
 *   rate unobservable, and the rate is what says whether the model got better
 *   or the provider got worse.
 */
export function sanitizeListingTitle(raw) {
  const original = String(raw ?? "");

  // Normalise first: a composed and a decomposed "Peña" must not be judged by
  // different rules, and NFC is what the allowed range is written against.
  let title = original.normalize("NFC");

  // First line only. When the model ignores "title only" it appends an
  // explanation on a new line, never a second candidate title.
  title = title.split(/[\r\n]/, 1)[0];
  title = title.replace(LEADING_LABEL, "");
  title = title.replace(WRAPPING_QUOTES, "");

  // Walk in from the tail, dropping characters until one belongs. Alternating
  // with the dangling-punctuation trim because the two interleave:
  // "Refractor?♀♀♀♀" needs the symbols gone before the "?" is exposed.
  let strippedTail = "";
  let previous = null;
  while (previous !== title) {
    previous = title;
    const characters = [...title];
    let end = characters.length;
    while (end > 0 && !ALLOWED_CHARACTER.test(characters[end - 1])) end -= 1;
    strippedTail = characters.slice(end).join("") + strippedTail;
    title = characters.slice(0, end).join("");

    const dangling = title.match(DANGLING_TAIL);
    if (dangling) {
      strippedTail = dangling[0] + strippedTail;
      title = title.slice(0, title.length - dangling[0].length);
    }
  }

  title = title.replace(/\s+/g, " ").trim();
  return { title, changed: title !== original, strippedTail: strippedTail.trim() };
}

/**
 * Whether a title still carries characters that do not belong in one.
 *
 * Separate from the sanitiser so an evaluation can measure contamination on
 * arms that were never sanitised -- the point of the measurement is the rate
 * before the fix, and asking the fix to report it would be circular.
 */
export function findForeignCharacters(raw) {
  return [...String(raw ?? "").normalize("NFC")].filter((character) => !ALLOWED_CHARACTER.test(character));
}
