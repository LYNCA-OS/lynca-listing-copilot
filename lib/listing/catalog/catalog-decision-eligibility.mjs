import { isOfficialCatalogSourceType } from "./catalog-contract.mjs";

const OFFICIAL_DECISION_STATUSES = new Set([
  "AUTO_PARSED_FROM_OFFICIAL_CHECKLIST",
  "OFFICIAL_CHECKLIST_CANDIDATE",
  "OFFICIAL_CHECKLIST_CONFIRMED",
  "OFFICIAL_RELEASE_SUPPORT",
  "OFFICIAL_RELEASE_METADATA",
  "TOPPS_OFFICIAL_RAW",
  "OFFICIAL_CHECKLIST_RAW"
]);

const INTERNAL_DECISION_STATUSES = new Set([
  "VERIFIED_CANONICAL_TITLE",
  "AUTO_PARSED_FROM_VERIFIED_TITLE",
  "REVIEWED_INTERNAL"
]);

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedStatus(value = "") {
  return cleanText(value).toUpperCase();
}

function isRejected(row = {}) {
  return ["REJECTED", "BLOCKED", "DISABLED", "DEPRECATED"].includes(
    normalizedStatus(row.retrieval_status || row.reference_status || row.review_status)
  );
}

export function decisionActiveCatalogCard({ source = {}, card = {} } = {}) {
  if (isRejected(source) || isRejected(card)) return false;
  const sourceType = normalizedStatus(source.source_type);
  const sourceStatus = normalizedStatus(card.source_status || source.source_status);
  const retrievalStatus = normalizedStatus(card.retrieval_status || source.retrieval_status);
  if (sourceType === "INTERNAL_CORRECTED_TITLE") {
    return INTERNAL_DECISION_STATUSES.has(sourceStatus);
  }
  if (isOfficialCatalogSourceType(sourceType)) {
    return retrievalStatus === "REGISTRY" || OFFICIAL_DECISION_STATUSES.has(sourceStatus);
  }
  return false;
}
