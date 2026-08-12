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
// RELEASE AUTHORITY
//
// The active table is intentionally tiny. Only claims in the immutable,
// governed-review-approved release may reject a finish. Seed examples and raw
// corpus counts are evidence, not authority. This prevents another useful-looking
// vocabulary expansion from quietly acquiring deletion power.
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
import { PRINT_FINISH_PRODUCT_CLAIMS_V1 } from
  "./releases/print-finish-product-claims-v1.mjs";

/**
 * Finish terms whose market recognition is anchored to a product family.
 *
 * Keyed by the family token as it appears in Manufacturer / Product / Set text.
 * A term absent from every list is domain-neutral by default.
 */
export const PRINT_FINISH_REGISTRY_RELEASE = PRINT_FINISH_PRODUCT_CLAIMS_V1;
const releaseApproved = PRINT_FINISH_REGISTRY_RELEASE.status === "FROZEN_APPROVED"
  && PRINT_FINISH_REGISTRY_RELEASE.authority?.approval === "GOVERNED_REVIEW_APPROVED"
  && PRINT_FINISH_REGISTRY_RELEASE.review_receipt?.status === "APPROVED";
export const APPROVED_PRINT_FINISH_CLAIMS = Object.freeze(
  releaseApproved
    ? PRINT_FINISH_REGISTRY_RELEASE.claims.filter((claim) => claim.status === "ACTIVE")
    : []
);

const fold = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact word/phrase matching; `scope` must never match `kaleidoscope`. */
function containsPhrase(value, phrase) {
  const source = fold(value);
  const words = fold(phrase).split(" ").filter(Boolean).map(escapePattern);
  if (!source || !words.length) return false;
  return new RegExp(`(?:^|[^a-z0-9])${words.join("\\s+")}(?=$|[^a-z0-9])`).test(source);
}

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
  const text = fold([fields.manufacturer, fields.product, fields.set, fields.ip].filter(Boolean).join(" "));
  const matches = new Set(ip ? [ip] : []);
  for (const family of PRINT_FINISH_REGISTRY_RELEASE.product_families) {
    if (family.exact_phrases.some((phrase) => containsPhrase(text, phrase))) {
      matches.add(family.id);
    }
  }
  return matches.size === 1 ? [...matches][0] : "";
}

/** All approved owner families matching a term. Exposed for release tests. */
export function familiesClaiming(term, claims = APPROVED_PRINT_FINISH_CLAIMS) {
  return Object.freeze([...new Set(claims
    .filter((claim) => claim.status === "ACTIVE" && containsPhrase(term, claim.term))
    .map((claim) => claim.product_family))].sort());
}

/** The unique owner family, or "" for unknown/ambiguous terms. */
export function familyClaiming(term, claims = APPROVED_PRINT_FINISH_CLAIMS) {
  const families = familiesClaiming(term, claims);
  return families.length === 1 ? families[0] : "";
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
