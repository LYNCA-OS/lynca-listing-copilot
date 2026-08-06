// Print Finish Registry — product-scoped finish recognition.
//
// CSM names this authority in three places, and all three say PRODUCT, not
// grammar:
//
//   20 Registry            "Registry / product taxonomy may verify whether a
//                           visually observed finish term is market-recognized
//                           FOR THE PRODUCT"
//   30 Identity Resolution  Print Finish -> "current visual evidence plus
//                           verified product taxonomy"
//   60 Rebuild Contract     same, and separately: "TCG / Non-TCG is a grammar
//                           choice, NOT an IP-level claim"
//
// The implementation this replaces gated on `grammar === "tcg"` corroborated by
// the IP table. It produced the right answers on the reviewed corpus, but it
// made grammar carry an IP claim, which the contract forbids in as many words.
//
// WHERE THE TABLE COMES FROM
//
// Not invented. Two sources, both authoritative:
//
//   1. `20 Registry`'s own Print Finish Registry examples, which deliberately
//      mix domains -- Mojo Refractor and Superfractor sit beside Master Ball
//      Reverse Holo and Ghost Rare. CSM does not partition finish vocabulary by
//      domain, so neither does this.
//   2. The 255 reviewed titles: what the market actually calls these products.
//      That is the plainest available evidence of "market-recognized for the
//      product", because it is the market writing the names.
//
// The corpus is unambiguous where it speaks: `refractor` appears with 22
// product families and every one is Topps; `prizm` with 9 and every one is
// Panini; `holo` with Panini Donruss Optic AND Pokemon, so it crosses domains
// legitimately and is claimed by neither.
//
// ABSENCE IS NOT REJECTION
//
// A term this table does not know is ADMITTED. Registry "supports resolution;
// it does not define truth by itself" (20 Registry), and Identity Resolution is
// told to preserve conflicts and abstain rather than manufacture a verdict. A
// finish is withheld only when the table positively knows the term belongs to a
// different product family than the card's -- Refractor on a Pokemon card. An
// unknown product, or an unknown term, leaves the finish alone.
//
// That is the difference between a taxonomy and a blocklist, and it is why this
// can grow without ever silently deleting a finish nobody has catalogued yet.

import { semTcgIpLabel } from "../ontology/sem-definition.mjs";

/**
 * Finish terms whose market recognition is anchored to a product family.
 *
 * Keyed by the family token as it appears in Manufacturer / Product / Set text.
 * A term absent from every list is domain-neutral by default.
 */
export const PRINT_FINISH_FAMILIES = Object.freeze({
  topps: Object.freeze([
    // Corpus: 22 product families, all Topps.
    "refractor",
    "xfractor",
    "raywave",
    "superfractor",
    "sapphire",
    "pulsar"
  ]),
  panini: Object.freeze([
    // Corpus: 9 product families, all Panini.
    "prizm",
    "hyper",
    "lucky",
    "shock",
    "cracked ice",
    "disco",
    "velocity",
    "scope"
  ]),
  // `20 Registry` lists these beside the Topps and Panini terms, in the same
  // table, which is the point: CSM does not partition the vocabulary, it scopes
  // recognition to the product. The corpus adds `holo` for Pokemon, but `holo`
  // is domain-neutral -- Panini Donruss Optic uses it too -- so it is not
  // claimed here.
  pokemon: Object.freeze(["master ball reverse holo", "poke ball reverse holo"]),
  "yu-gi-oh!": Object.freeze(["ghost rare", "starlight rare", "collector rare"])
});

/**
 * Terms the corpus or `20 Registry` shows on more than one family, or that name
 * a surface rather than a product line. These are never withheld on product
 * grounds.
 */
export const DOMAIN_NEUTRAL_FINISHES = Object.freeze([
  "holo", "reverse holo", "foil", "wave", "shimmer", "sparkle",
  "geometric", "mojo", "prismatic", "marble", "lucky"
]);

const fold = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

/** The product family this card belongs to, or "" when the table cannot tell. */
export function productFamilyFor(fields = {}) {
  // A trading card game IS a product family for this purpose. CSM's own
  // `semTcgIpMatchers` already enumerates them, so the family is read from the
  // contract rather than re-listed here.
  //
  // This is not the thing `60 Rebuild Contract` forbids. That prohibition is
  // "TCG / Non-TCG is a grammar choice, not an IP-level claim" -- it stops
  // GRAMMAR being decided by IP. Nothing here touches grammar; the IP table is
  // used to answer "which product is this", which is the question a product
  // taxonomy exists to answer.
  const ip = fold(semTcgIpLabel({
    manufacturer: fields.manufacturer,
    product: fields.product,
    set: fields.set || fields.product,
    card_name: fields.card_name,
    ip: fields.ip
  }));
  if (ip && ip in PRINT_FINISH_FAMILIES) return ip;
  if (ip) return ip;

  const text = fold([fields.manufacturer, fields.product, fields.set, fields.ip].filter(Boolean).join(" "));
  if (!text) return "";
  for (const family of Object.keys(PRINT_FINISH_FAMILIES)) {
    if (new RegExp(`(?:^|\\s)${family}(?:\\s|$)`).test(text)) return family;
  }
  return "";
}

/** The family that claims this finish term, or "" when nobody does. */
export function familyClaiming(term) {
  const text = fold(term);
  if (!text) return "";
  if (DOMAIN_NEUTRAL_FINISHES.some((neutral) => text.includes(neutral))) return "";
  for (const [family, terms] of Object.entries(PRINT_FINISH_FAMILIES)) {
    if (terms.some((claimed) => text.includes(claimed))) return family;
  }
  return "";
}

/**
 * Is this finish term market-recognized for this card's product?
 *
 * Returns one of:
 *   "RECOGNIZED"   the term belongs to this card's product family
 *   "FOREIGN"      the term belongs to a DIFFERENT family, and this card's
 *                  family is known -- the only case that withholds
 *   "UNVERIFIED"   the table cannot say; the finish is admitted unchanged
 */
export function finishRecognitionForProduct(term, fields = {}) {
  const claiming = familyClaiming(term);
  if (!claiming) return "UNVERIFIED";
  const family = productFamilyFor(fields);
  if (!family) return "UNVERIFIED";
  return family === claiming ? "RECOGNIZED" : "FOREIGN";
}
