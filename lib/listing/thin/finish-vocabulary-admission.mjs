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

const normalize = (value) => String(value ?? "").trim().toLowerCase();

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
export function admitFinishVocabulary(fields = {}) {
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
