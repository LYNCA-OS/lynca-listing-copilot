export const catalogSourceTypes = Object.freeze({
  INTERNAL_CORRECTED_TITLE: "INTERNAL_CORRECTED_TITLE",
  TOPPS_OFFICIAL_CHECKLIST: "TOPPS_OFFICIAL_CHECKLIST",
  PANINI_OFFICIAL_CHECKLIST: "PANINI_OFFICIAL_CHECKLIST",
  UPPER_DECK_OFFICIAL_CHECKLIST: "UPPER_DECK_OFFICIAL_CHECKLIST",
  LEAF_OFFICIAL_CHECKLIST: "LEAF_OFFICIAL_CHECKLIST"
});

export const officialChecklistCatalogSourceTypes = Object.freeze([
  catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST,
  catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST,
  catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST,
  catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST
]);

export function isOfficialChecklistCatalogSourceType(value) {
  return officialChecklistCatalogSourceTypes.includes(String(value || "").trim().toUpperCase());
}

export const catalogFieldStatuses = Object.freeze({
  VERIFIED_CANONICAL_TITLE: "VERIFIED_CANONICAL_TITLE",
  AUTO_PARSED_FROM_VERIFIED_TITLE: "AUTO_PARSED_FROM_VERIFIED_TITLE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  REVIEWED_INTERNAL: "REVIEWED_INTERNAL"
});

export const catalogImportStatuses = Object.freeze({
  AUTO_PARSED_FROM_VERIFIED_TITLE: "AUTO_PARSED_FROM_VERIFIED_TITLE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  READY_CANDIDATE: "READY_CANDIDATE",
  REVIEWED_INTERNAL: "REVIEWED_INTERNAL",
  REJECTED: "REJECTED"
});

export const basketballToppsChecklistAllowlist = Object.freeze([
  "Basketball",
  "Bowman Basketball",
  "Bowman University Basketball",
  "Topps Chrome Basketball",
  "Topps Chrome Basketball Sapphire",
  "Topps Finest Basketball",
  "Topps Basketball",
  "Topps NBL Basketball",
  "Topps G-League Basketball"
]);

export const basketballToppsChecklistExclusions = Object.freeze([
  "Baseball",
  "Football",
  "Soccer",
  "UFC",
  "WWE",
  "Star Wars",
  "Marvel",
  "Pokemon",
  "Pokémon",
  "TCG",
  "Non-Sports",
  "Entertainment"
]);
