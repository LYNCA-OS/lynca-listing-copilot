import { semCanonicalEditableFields, semLotTitleOrder } from "../csm/sem-definition.mjs";

export const RULER_VERSION = "semantic-publication-ruler-v1";

export const TRUTH_STATUSES = Object.freeze([
  "SUPPORTED",
  "CONTRADICTED",
  "UNKNOWN"
]);

export const TRUTH_SOURCES = Object.freeze([
  "CARD_IMAGE",
  "SLAB_LABEL",
  "OFFICIAL_SOURCE",
  "ADJUDICATED"
]);

export const TITLE_POLICIES = Object.freeze([
  "REQUIRED",
  "OPTIONAL",
  "FORBIDDEN",
  "NOT_APPLICABLE"
]);

// Proposal only. Promotion remains ineligible until an approved policy freezes
// this list (or its replacement) under the sealed approval manifest.
export const PROPOSED_CRITICAL_FIELDS = Object.freeze([
  "year",
  "ip_sport",
  "language",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "numerical_rarity",
  "grading_info",
  "lot_quantity"
]);

export const RULER_CLAIM_FIELDS = new Set([
  ...semCanonicalEditableFields,
  // CSM's LOT grammar includes this field even though the editable-field
  // export has not yet caught up. Keep the exception explicit and testable.
  ...(semLotTitleOrder.includes("lot_quantity") ? ["lot_quantity"] : [])
]);

export const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const uniqueSorted = (values) => [...new Set(values.map(clean).filter(Boolean))].sort();

export function prepareClaimEvidence(claim = {}) {
  const truthSource = clean(claim.truth_source);
  if (!TRUTH_SOURCES.includes(truthSource)) {
    throw new Error(`invalid_truth_source:${truthSource || "empty"}`);
  }
  const evidenceRefs = uniqueSorted(Array.isArray(claim.evidence_refs) ? claim.evidence_refs : []);
  if (evidenceRefs.length === 0) throw new Error("claim_evidence_refs_required");
  return { truth_source: truthSource, evidence_refs: evidenceRefs };
}

export function claimField(value) {
  const field = clean(value);
  if (!RULER_CLAIM_FIELDS.has(field)) throw new Error(`unknown_csm_claim_field:${field || "empty"}`);
  return field;
}

export function normalizeClaimValue(value) {
  let normalized = "";
  let previousBaseWasLatin = false;
  for (const character of clean(value).normalize("NFKD")) {
    const isMark = /\p{M}/u.test(character);
    if (isMark && previousBaseWasLatin) continue;
    normalized += character;
    if (!isMark) previousBaseWasLatin = /\p{Script=Latin}/u.test(character);
  }
  return normalized
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/&'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
