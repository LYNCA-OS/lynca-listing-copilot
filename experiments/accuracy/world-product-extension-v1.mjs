// Evaluation-only bridge from a positively supported world-ranked identity
// candidate to a Product extension. It cannot generate a candidate, use a
// negative edge, replace an incompatible Product, or touch lot grammar.

export const WORLD_PRODUCT_EXTENSION_V1 = "world-product-extension-v1";

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (value) => norm(value).split(" ").filter(Boolean);
const MANUFACTURERS = Object.freeze(["upper deck", "panini", "topps", "leaf"]);
const SPORT_TAIL = /\b(?:football|basketball|baseball|soccer|hockey|tennis|wrestling|cards?|trading cards?)\b/gi;
const NARRATIVE = /\b(?:all rights reserved|copyright|officially licensed|this card|congratulations|authenticity)\b/i;

function stripIdentityFrame(value, manufacturer) {
  let output = clean(value)
    .replace(/^from\s+/i, "")
    .replace(/[©®™]/g, " ")
    .replace(/\b(?:19|20)\d{2}(?:-\d{2})?\b/g, " ")
    .replace(/[–—-]+/g, " ")
    .replace(SPORT_TAIL, " ");
  const manufacturerName = clean(manufacturer);
  if (manufacturerName) {
    output = output.replace(new RegExp(`\\b${manufacturerName.replace(/\s+/g, "\\s+")}\\b`, "ig"), " ");
  }
  for (const known of MANUFACTURERS) {
    output = output.replace(new RegExp(`\\b${known.replace(/\s+/g, "\\s+")}\\b`, "ig"), " ");
  }
  return clean(output.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""));
}

export function proposeWorldProductExtensionV1(fields = {}, ranked = {}) {
  const original = structuredClone(fields ?? {});
  const decision = ranked?.decisions?.[0];
  const candidate = decision?.candidate;
  const fail = (reason) => ({
    fields: original, changed: false, reason,
    mechanism: WORLD_PRODUCT_EXTENSION_V1,
    authority: "evaluation_only", production_promoted: false
  });
  if (!decision || !(Number(decision.rank_score) > 0)) return fail("no_positive_world_support");
  if (String(original.grammar || "").toLowerCase() === "lot" || clean(original.lot_count)) {
    return fail("lot_product_extension_disallowed");
  }
  if (!candidate || !["stamped_text", "exact_text", "logo_or_symbol"].includes(candidate.basis)) {
    return fail("candidate_not_visible_exact_or_stamped");
  }
  const existing = stripIdentityFrame(original.product, original.manufacturer);
  const proposed = stripIdentityFrame(candidate.value, original.manufacturer);
  if (!existing || !proposed) return fail("missing_existing_or_proposed_product");
  if (NARRATIVE.test(candidate.value) || words(proposed).length > 6) return fail("narrative_or_overwide_candidate");
  const oldWords = words(existing);
  const newWords = words(proposed);
  if (!oldWords.every((word) => newWords.includes(word))) return fail("incompatible_product_replacement");
  if (norm(existing) === norm(proposed) || newWords.length <= oldWords.length) return fail("not_an_extension");
  const next = { ...original, product: proposed };
  return {
    fields: next,
    changed: true,
    before: original.product,
    after: proposed,
    support_edges: [...(decision.support_edges || [])],
    source_candidate: structuredClone(candidate),
    mechanism: WORLD_PRODUCT_EXTENSION_V1,
    authority: "evaluation_only",
    production_promoted: false
  };
}
