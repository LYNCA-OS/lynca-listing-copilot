import { titleRenderConditionalFiller, titleRenderFillerTokens } from "../csm/product-semantics.mjs";

// The deterministic half of Marketplace Composer, applied to a model-written
// title string. The canonical-fields path uses canonical-composer.mjs instead;
// this file serves the string arm and holds the rules both share.

// Sub-brands that imply a parent manufacturer. Only families where the parent
// is unambiguous -- guessing a parent onto an unrecognised product would be
// manufacturing a value, which the CSM guardrails forbid.
const PARENT_MANUFACTURERS = [
  ["Panini", /\b(?:Donruss|Optic|Prizm|Select|Mosaic|Contenders|Immaculate|Obsidian|Revolution|Eminence|National Treasures|Flawless|Spectra|Phoenix|Origins)\b/i],
  ["Topps", /\b(?:Bowman|Heritage|Stadium Club|Allen & Ginter|Finest|Tribute|Dynasty|Gypsy Queen|Archives)\b/i]
];

// TCG lives by its card number, so the low-priority rule must not reach it.
// Detected from the IP rather than the number's shape: a Pokemon card with a
// plain "#25" still must not have it stripped.
const TCG_MARKERS = /\b(?:Pok[eé]mon|One Piece|Yu-?Gi-?Oh|Weiss Schwarz|Lorcana|Magic: ?The Gathering|MTG|Digimon|Dragon Ball Super Card Game)\b/i;

// A Standard checklist code: "#221", "#GS-AKA", "NO.123". The negative
// lookahead keeps this away from the print run: "#086/070" is a TCG card number
// and "15/30" is a print run; both contain a slash, and an earlier version
// matched the "#086" of "#086/070" and left a dangling "/070" behind. A
// checklist code never contains a slash.
const CARD_NUMBER = /\s(?:#|N[oO]\.\s*)[A-Za-z0-9][A-Za-z0-9-]*(?!\s*\/)\b/g;

const GRADE_SUFFIX = /\s(?:PSA|BGS|SGC|CGC|CSG|HGA|BVG)\s*(?:Gem\s*)?(?:Mint\s*)?\d+(?:\.\d)?(?:\s*(?:GEM|MT|MINT|NM|EX|VG)\b)*\s*$/i;
const SERIAL_SUFFIX = /\s\d{0,5}\/\d{1,5}\s*$/;
const TCG_CODE_SUFFIX = /\s#?(?:\d{1,5}\/\d{1,5}|[A-Z]{2,}\d*-[A-Z0-9]+)\s*$/i;
const LOT_MARKERS = /\b(?:\d+[- ]card\s+lot|lot\s+of\s+\d+|\blot\s*x?\s*\d+|\blot\b)\b/i;

// Category filler: words the model adds to say what KIND of thing this is,
// which a reviewed title never spends characters on.
//
// The list is a count over 150 cards of how often the model writes the word
// against how often the reviewed title contains it:
//
//   basketball  22 written,  1 in reference   -> filler
//   football    20 written,  0 in reference   -> filler
//   card        28 written,  4 in reference   -> filler
//   tennis      12 written, 11 in reference   -> NOT filler, it is the product
//                                                line ("Topps Chrome Tennis")
//
// Tennis is why this is a measured list and not a category of words. "Card"
// survives when it heads a Lot ("2 Card Lot") -- that phrase is CSM's Lot
// grammar opening bracket, not a description of what a card is.
// Built from CSM's vocabulary rather than restated here. The words are the
// contract's; only the rendering mechanics (word boundaries, and the Lot-grammar
// exception after "card") belong to this layer.
const CATEGORY_FILLER = new RegExp(
  `\\b(?:${titleRenderFillerTokens.join("|")})\\b`
  + `|\\b(?:${titleRenderConditionalFiller.join("|")})\\b(?!\\s*(?:lot|number|no\\b))`,
  "gi"
);

/**
 * Marketplace profiles. The same canonical object produces different commercial
 * representations per marketplace without the marketplace constraint leaking
 * into semantic identity. "The system should not assume an 85-character limit."
 */
export const MARKETPLACE_PROFILES = Object.freeze({
  ebay: Object.freeze({
    id: "ebay",
    characterBudget: 80,
    // Brackets the canonical object CARRIES but this marketplace does not
    // PROJECT. Keyed by CSM bracket name.
    //
    // CARD NUMBER IS SUPPRESSED ON CSM'S AUTHORITY, NOT ON A MEASUREMENT.
    //
    // This comment used to argue that the contract said "if recognized and the
    // title length allows, keep it" and that the reviewed titles contradicted
    // it, quoting the F1 gain as the reason to suppress anyway. That framing
    // was wrong twice over: it read one sentence of 40 Marketplace Composer as
    // the whole contract, and it set up a measurement as the thing overruling
    // it -- which is exactly what COS-49's authority order forbids.
    //
    // COS-10 (Fei, Done) already decided this, and says it plainly:
    //
    //   "For non-TCG cards, checklist identifiers are generally lower-priority
    //    marketplace title fields and may be omitted WHEN NOT RECOGNIZED or
    //    when title space is constrained."
    //   "Numerical Rarity such as 04/10 is highly important and should not be
    //    treated as optional in the same way."
    //
    // The clause that applies here is "when not recognized". This path cannot
    // verify a checklist code against anything -- there is no Registry product
    // taxonomy to check it against, and the current-card text is the only
    // authority CSM allows for it (30 Identity Resolution). An unverifiable
    // value is not a recognized one.
    //
    // Fei re-confirmed on 2026-08-06, in this session: card number is not
    // wanted; the number that matters is Numerical Rarity.
    //
    // The measurement is recorded as consequence, not as justification. Lifting
    // the suppression costs -0.045344 on 255 cards, 1 win to 194 losses,
    // because the model emits a card number on 237 of them while the reviewed
    // titles carry one on three. If CSM ever rules the other way, that is the
    // price, and it is a price the contract may legitimately ask for.
    //
    // `search_optimization` is a different case with a different reason: see
    // `retainWithinSuppressed` below, where COS-41's high-value terms survive.
    // Suppression here removes the city name, not the bracket.
    suppress: Object.freeze({
      card_number: Object.freeze(["standard", "lot"]),
      search_optimization: Object.freeze(["standard", "lot", "tcg"])
    }),
    // Suppressing a whole bracket is a blunt instrument, and COS-41 says so:
    // Auto, RC, Patch and Relic belong to Search Optimization, and if this
    // profile drops them too early that is a Composer priority problem rather
    // than evidence CSM needs another bracket. Terms inside one bracket may
    // carry different commercial weight without changing their ownership.
    //
    // Measured: with these four removed from the title entirely, the 255-card
    // replay loses 0.03 (2 wins to 61, and 1 to 40 on the holdout). The writers
    // publish `auto` and `rc` more than any other component word. What they do
    // NOT publish is "San Antonio Spurs", which is what the rest of this
    // bracket contains.
    retainWithinSuppressed: Object.freeze({
      search_optimization: Object.freeze(["auto", "rc", "patch", "relic", "jersey"])
    })
  })
});

/**
 * The parent manufacturer implied by a product name, if unambiguous.
 *
 * Exported so the canonical Composer can fill an empty `manufacturer` from
 * `product` without re-deriving the family table. "Panini" is the single
 * most-missed word in the 255-card set.
 */
export function inferParentManufacturer(product) {
  const text = String(product ?? "");
  for (const [parent, subBrand] of PARENT_MANUFACTURERS) {
    if (new RegExp(`\\b${parent}\\b`, "i").test(text)) return null;
    if (subBrand.test(text)) return parent;
  }
  return null;
}

export function isTcgTitle(title) {
  return TCG_MARKERS.test(String(title ?? ""));
}

/**
 * Which grammar governs this title. Lot outranks TCG: a lot of Pokemon cards is
 * composed as a lot, because the per-card identity the TCG rules protect is
 * exactly what a lot does not have.
 */
export function selectGrammar(title) {
  const text = String(title ?? "");
  if (LOT_MARKERS.test(text)) return "lot";
  if (TCG_MARKERS.test(text)) return "tcg";
  return "standard";
}

/**
 * Remove category filler.
 *
 * Measured on 150 cards, replayed offline at zero API cost:
 *   canonical arm  F1 0.7211 -> 0.7320, 45 wins : 3 losses
 *   string arm     F1 0.7175 -> 0.7210, 16 wins : 3 losses
 *
 * It also returns ~6 characters of median budget, which matters more than the
 * score: the set is still missing "Refractor", "Gold" and "SSP".
 *
 * This rule only became visible once the reviewed title was treated as the
 * DESIRED OUTPUT rather than a bag of facts to recall. Under recall-only
 * scoring an extra word is free, so 606 word-instances of filler cost nothing
 * and nobody looked.
 */
export function stripCategoryFiller(title, { semanticRole = "description" } = {}) {
  const text = String(title ?? "");
  // Manufacturer is an identity value, not category prose. `Wild Card` is the
  // concrete counterexample that exposed the old global replacement: removing
  // "Card" changed a publisher name into a different value.
  if (semanticRole === "manufacturer") {
    const untyped = text.replace(CATEGORY_FILLER, " ").replace(/\s{2,}/g, " ").trim();
    return { title: text, applied: false, preserved: untyped !== text };
  }

  let preserved = false;
  const stripped = text.replace(CATEGORY_FILLER, (match, offset, source) => {
    // A category word carrying a possessive is part of a proper name, never
    // prose. `Baseball's Finest` is a Topps set; removing the sport word left
    // the title reading "1993 Topps Finest 's Finest Bo Jackson" -- a dangling
    // clitic that is visibly broken output, and one the reference does not
    // carry at all. This guard runs before the role check because the
    // `description` role stripped unconditionally, which is how a set name
    // became punctuation.
    if (/^['’]s\b/.test(source.slice(offset + match.length))) {
      preserved = true;
      return match;
    }
    if (semanticRole !== "product") return " ";

    const token = match.trim().toLowerCase();
    const before = source.slice(0, offset).trim();
    const after = source.slice(offset + match.length).trim();

    // A leading sport word followed by a distinctive word can be part of a
    // named product (`Baseball Stars`). Do not protect `Baseball Card`, where
    // both words are generic. This is syntax-bound identity preservation, not
    // a product-name registry.
    if (!before && /^(?:basketball|football|baseball|hockey)$/.test(token)
      && after && !/^(?:trading\s+)?cards?$/i.test(after)) {
      preserved = true;
      return match;
    }

    // Repeated-name constructions such as `One and One Basketball` use the
    // trailing sport token to disambiguate the actual product. Ordinary suffix
    // prose such as `Prizm Basketball` still yields.
    const mirrored = before.match(/\b([a-z0-9&.-]+)\s+(?:and|&)\s+\1$/i);
    if (!after && mirrored && /^(?:basketball|football|baseball|hockey)$/.test(token)) {
      preserved = true;
      return match;
    }
    return " ";
  }).replace(/\s{2,}/g, " ").trim();
  return { title: stripped, applied: stripped !== text, preserved };
}

/** "Autograph"/"Autographs" -> "Auto", named in the contract's compression list. */
export function compressAutograph(title) {
  const text = String(title ?? "");
  const compressed = text.replace(/\b(?:Autographs?|Autographed|Autos?)\b/gi, "Auto");
  return { title: compressed, applied: compressed !== text };
}

/** Drop a repeated token: "Panini Panini Prizm" -> "Panini Prizm". */
export function dedupeAdjacentTokens(title) {
  const text = String(title ?? "");
  const collapsed = text.replace(/\b(\w[\w'&.-]*)(\s+\1\b)+/gi, "$1");
  return { title: collapsed, applied: collapsed !== text };
}

function extractProtectedTail(text, { tcg }) {
  let body = String(text);
  let tail = "";
  const patterns = tcg ? [GRADE_SUFFIX, SERIAL_SUFFIX, TCG_CODE_SUFFIX] : [GRADE_SUFFIX, SERIAL_SUFFIX];
  // Bounded rather than looped, so an anchored pattern cannot walk the whole
  // title off one term at a time.
  for (let pass = 0; pass < 3; pass += 1) {
    const match = patterns.map((pattern) => body.match(pattern)).find(Boolean);
    if (!match) break;
    tail = `${match[0].trim()} ${tail}`.trim();
    body = body.slice(0, body.length - match[0].length).trim();
  }
  return { body, tail };
}

/**
 * Bring a title inside the character budget by priority, not by position.
 */
export function compressToBudget(title, { limit = 80, tcg = null, grammar = null } = {}) {
  let text = String(title ?? "");
  const applied = [];
  if (text.length <= limit) return { title: text, applied, truncated: false };

  const resolvedGrammar = grammar ?? (tcg === null ? selectGrammar(text) : (tcg ? "tcg" : "standard"));
  const isTcg = resolvedGrammar === "tcg";

  // High-priority brackets cluster at the end of a title, which is exactly
  // where a tail cut lands. Lift them out, cut the body, put them back.
  const { body, tail } = extractProtectedTail(text, { tcg: isTcg });
  if (tail) {
    const room = limit - tail.length - 1;
    const cutBody = body.length <= room
      ? body
      : body.slice(0, Math.max(0, room)).slice(0, body.slice(0, Math.max(0, room)).lastIndexOf(" ")).trim();
    if (room > 0 && cutBody) {
      return { title: `${cutBody} ${tail}`, applied: [...applied, "truncated", "tail_preserved"], truncated: true };
    }
  }

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return {
    title: (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim(),
    applied: [...applied, "truncated"],
    truncated: true
  };
}

/**
 * Full deterministic composition over a model-written title.
 *
 * The parent manufacturer is an ENHANCEMENT, not an entitlement: added only if
 * the finished title still fits. Adding it unconditionally lost "PSA 10" (two
 * tokens) to buy "Panini" (one) on five of 255 cards.
 */
export function composeMarketplaceTitle(title, { limit, profile = MARKETPLACE_PROFILES.ebay } = {}) {
  const budget = limit ?? profile.characterBudget;
  const grammar = selectGrammar(title);

  const base = (input) => {
    const applied = [];
    // Profile suppression first, then filler, then compression. Read from the
    // profile, never hardcoded: a marketplace with a 120-character budget may
    // well want the checklist code.
    const suppressHere = (profile.suppress?.card_number || []).includes(grammar);
    let working = String(input ?? "");
    if (suppressHere) {
      const stripped = working.replace(CARD_NUMBER, "").replace(/\s+/g, " ").trim();
      if (stripped && stripped !== working) { working = stripped; applied.push("card_number_suppressed"); }
    }
    const filler = stripCategoryFiller(working);
    if (filler.applied) applied.push("category_filler_removed");
    const auto = compressAutograph(filler.title);
    if (auto.applied) applied.push("autograph_compressed");
    const deduped = dedupeAdjacentTokens(auto.title);
    if (deduped.applied) applied.push("deduped");
    const budgeted = compressToBudget(deduped.title, { limit: budget, grammar });
    return { title: budgeted.title, applied: [...applied, ...budgeted.applied], truncated: budgeted.truncated };
  };

  const decorate = (result) => ({ ...result, grammar, marketplace: profile.id });

  const without = decorate(base(title));
  const parent = inferParentManufacturer(title);
  if (!parent) return without;

  const match = PARENT_MANUFACTURERS.find(([name]) => name === parent)[1].exec(title);
  const with_ = decorate(base(title.replace(match[0], `${parent} ${match[0]}`)));

  // Reject the parent when it evicts a term. Counting words, not checking the
  // truncation flag: an over-budget title is cut either way, and the flag says
  // the cut happened, not that it took more with it.
  const words = (text) => text.split(/\s+/).filter(Boolean).length;
  if (words(with_.title) - 1 < words(without.title)) return without;
  return { ...with_, applied: [`parent:${parent}`, ...with_.applied] };
}
