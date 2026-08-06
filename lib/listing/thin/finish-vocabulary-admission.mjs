// Which observed finish terms are allowed to RESOLVE into [Print Finish].
//
// The observation is not in question. When the schema demands a surface colour
// for a base Refractor, "rainbow" is the honest answer -- the card really does
// throw a rainbow sheen. What is in question is whether that word names the
// card's parallel, and it does not: the writer calls that card a Refractor.
//
// Measured on 150 stored observations, per-term hit rate against reviewed
// titles (no parallel_exact present):
//
//   surface_color   rainbow    0/30      parallel_family  foil          0/7
//                   silver     1/11                       prismatic     0/7
//                   red        7/12                       sparkle       0/5
//                   orange     3/4                        cracked ice   0/3
//                   gold       9/19                       refractor    14/20
//                   blue       6/14                       prizm         8/19
//
// Two separable causes, and the list below encodes the causes rather than the
// hit rates. `rainbow` and `silver` are the BASE APPEARANCE of chrome-family
// products -- a base Panini Prizm is silver, a base Topps Chrome Refractor is
// rainbow -- so they are what the card looks like before any parallel exists.
// `foil`, `prismatic`, `sparkle` and `cracked ice` are adjectives for how a
// surface behaves; they are not names a marketplace writer uses for a parallel.
//
// A list fitted to hit rates would also have caught `purple` (2/6) and `green`
// (3/16), and a split-half fit did exactly that -- each half produced terms the
// other did not, which is what fitting noise looks like below n=10. Those are
// real parallel colours that this cohort happened to get wrong, and withholding
// them would be scoring the sample rather than the mechanism. They stay in.
//
// This layer REJECTS a resolution; it does not erase an observation. The raw
// surface_color and parallel_family survive into evidence and persistence, so
// a later registry that can confirm "Rainbow Foil" is a real parallel name for
// some product is free to admit it. In CSM's terms the term remains an
// OBSERVED_FIELD_CANDIDATE and is denied promotion to RESOLVED_SEMANTIC_FIELD.

/** Base appearance of a chrome-family product, not a parallel name. */
export const BASE_APPEARANCE_COLOURS = Object.freeze(["rainbow", "silver"]);

/** Describes how a surface behaves; not a name writers use for a parallel. */
export const NON_NAMING_FINISH_FAMILIES = Object.freeze([
  "foil", "prismatic", "sparkle", "cracked ice"
]);

/**
 * Finish wording that belongs to a NON_TCG product line and must not cross into
 * a TCG title. COS-39 (Fei, 2026-08-04): "TCG vs NON_TCG classification must
 * happen first so domain-inappropriate finish terminology does not cross Grammar
 * boundaries... This boundary should prevent a Pokémon / Charizard card from
 * receiving inappropriate Non-TCG finish wording such as Gold Refractor or
 * Silver Refractor."
 *
 * The list holds only the term the decision itself names. The rest of the
 * partition -- whether Prizm, Mojo, Sapphire, Xfractor and the other entries of
 * the `parallel_family` enum are NON_TCG-only, and which terms are TCG-only --
 * is a Registry table CSM has not stated, and writing it here would be an
 * invention wearing a contract's name. It is deliberately short and the gap is
 * deliberately visible.
 *
 * Measured cost, recorded rather than hidden: of five TCG-grammar cards in the
 * reviewed corpus, two are Topps Chrome Disney whose reviewed titles DO say
 * Refractor, and they lose the term. Those two look misclassified rather than
 * misdescribed -- `manufacturer` is Topps and `product` is Topps Chrome, with no
 * game anywhere -- but grammar is what the decision gates on, and under CSM
 * authority the contract is applied as written rather than bent to the corpus.
 */
export const NON_TCG_FINISH_FAMILIES = Object.freeze(["refractor"]);

const normalize = (value) => String(value ?? "").trim().toLowerCase();

export function isNonTcgFinishWording(value) {
  const text = normalize(value);
  if (!text) return false;
  return NON_TCG_FINISH_FAMILIES.some((term) => new RegExp(`(?:^|\\s)${term}(?:$|\\s)`).test(text));
}

export function isBaseAppearanceColour(value) {
  return BASE_APPEARANCE_COLOURS.includes(normalize(value));
}

export function isNonNamingFinishFamily(value) {
  return NON_NAMING_FINISH_FAMILIES.includes(normalize(value));
}

/**
 * Deny non-naming terms promotion to the resolved [Print Finish].
 *
 * `parallel_exact` is never touched: a name printed on the card is the one rung
 * of the ladder that is not an inference, and it measured 0.750 token precision
 * against 0.313 for colour+family.
 *
 * @param fields canonical fields as observed
 * @returns fields with the resolved finish re-derived, plus `withheld` naming
 *          which layers were denied, for the evidence record
 */
export function admitFinishVocabulary(fields = {}, { taxonomyConfirmsColour = () => false } = {}) {
  // The grammar gate runs FIRST, ahead of the `parallel_exact` early return.
  // The decision's own example -- "Gold Refractor" on a Charizard -- is exactly
  // a printed-name value, so a boundary placed after that return would let
  // through the one case the decision names.
  // Corroborated TCG, not merely claimed TCG. CSM declares the discriminator:
  // `semTcgIpMatchers` names eighteen trading card games, and
  // `csm/contracts/resolution-view.mjs` already reasons about exactly this --
  // "a grammar the contract cannot corroborate is a review case".
  //
  // Gating on `grammar` alone withheld Refractor from two Topps Chrome Disney
  // cards whose reviewed titles say Refractor. Those two are misclassified
  // rather than misdescribed, and the IP table says so: it recognises the two
  // Pokemon cards and the Lorcana card, and stays silent on them. `fields.ip`
  // carries that label, so a claimed TCG grammar the contract cannot back does
  // not trigger a domain rule -- it stays a review case, which is what the
  // contract calls it.
  const tcg = normalize(fields.grammar) === "tcg" && Boolean(String(fields.ip || "").trim());
  const crossed = tcg && [fields.parallel_exact, fields.parallel_family]
    .some((value) => isNonTcgFinishWording(value));
  if (crossed) {
    const denied = [];
    const cleaned = { ...fields };
    for (const layer of ["parallel_exact", "parallel_family"]) {
      if (!isNonTcgFinishWording(cleaned[layer])) continue;
      denied.push({ layer, value: cleaned[layer], reason: "NON_TCG_FINISH_WORDING_ON_TCG_GRAMMAR" });
      cleaned[layer] = "";
    }
    const downstream = admitFinishVocabulary({ ...cleaned, grammar: "" }, { taxonomyConfirmsColour });
    return { ...downstream, grammar: fields.grammar, withheld: [...denied, ...(downstream.withheld || [])] };
  }

  if (String(fields.parallel_exact || "").trim()) return { ...fields, withheld: [] };

  const withheld = [];
  const out = { ...fields };
  if (isBaseAppearanceColour(out.surface_color)) {
    withheld.push({ layer: "surface_color", value: out.surface_color, reason: "BASE_APPEARANCE_NOT_PARALLEL" });
    out.surface_color = "";
  }
  if (isNonNamingFinishFamily(out.parallel_family)) {
    withheld.push({ layer: "parallel_family", value: out.parallel_family, reason: "DESCRIBES_SURFACE_NOT_PARALLEL" });
    out.parallel_family = "";
  }

  // COS-49 (Fei, 2026-08-04): a bare colour stays Recognition evidence. It may
  // become canonical Print Finish only when the card explicitly names it -- the
  // `parallel_exact` early return above -- or verified Registry / product
  // taxonomy confirms the colour ALONE as a market-recognized finish.
  //
  // This is the same rejection the marketplace Composer already applies when it
  // projects the bracket, moved to where the decision actually says it belongs.
  // Leaving it downstream meant the canonical object still carried "Gold" as a
  // resolved Print Finish while the title correctly refused to print it -- the
  // record disagreed with the output, and the record is what CSM persists and
  // what the Glass Box shows an operator.
  //
  // Because the Composer gate stays in place, moving this upstream changes no
  // title: measured across 150 + 105 cards at exactly 0.000000 on 65 bare-colour
  // cards, which is the point. The canonical field changes; the merchant output
  // does not.
  //
  // `taxonomyConfirmsColour` is the reopening the decision names. No caller
  // supplies one yet, so today every bare colour is withheld -- but the term is
  // preserved below, so a Registry that later confirms "Gold" for some product
  // admits it without a re-run.
  const bareColour = String(out.surface_color || "").trim();
  if (bareColour && !String(out.parallel_family || "").trim() && !taxonomyConfirmsColour(bareColour, out)) {
    withheld.push({ layer: "surface_color", value: bareColour, reason: "BARE_COLOUR_NOT_TAXONOMY_CONFIRMED" });
    out.surface_color = "";
  }

  if (!withheld.length) return { ...fields, withheld };

  // Re-derive rather than trust the stored value: `print_finish` was computed
  // from the full ladder before anything was withheld, so leaving it in place
  // would let a rejected term back in through the field it produced.
  const colour = String(out.surface_color || "").trim();
  const family = String(out.parallel_family || "").trim();
  out.print_finish = !colour
    ? family
    : (!family || family.toLowerCase().includes(colour.toLowerCase()) ? colour : `${colour} ${family}`);
  return { ...out, withheld };
}
