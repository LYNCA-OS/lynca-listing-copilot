import { retrievalProviderIds, retrievalQueryFamilies } from "./retrieval-contract.mjs";

export function quotePhrase(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? `"${text.replace(/"/g, "")}"` : "";
}

export function serialDenominator(serialNumber) {
  const match = String(serialNumber || "").match(/\/\s*(\d{1,4})\b/);
  return match ? `/${match[1]}` : "";
}

export function queryId(family, index) {
  return `${family.toLowerCase()}_${index + 1}`;
}

export function queryForProvider(family) {
  if (family === retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY) return retrievalProviderIds.INTERNAL_MEMORY;
  if (family === retrievalQueryFamilies.INTERNAL_REGISTRY) return retrievalProviderIds.INTERNAL_REGISTRY;
  if (family === retrievalQueryFamilies.VISUAL_VECTOR) return retrievalProviderIds.VISUAL_VECTOR;
  if (family === retrievalQueryFamilies.EBAY) return retrievalProviderIds.EBAY_BROWSE;
  if (family === retrievalQueryFamilies.OWS_FALLBACK) return retrievalProviderIds.OPENAI_WEB_SEARCH;
  if (family === retrievalQueryFamilies.OFFICIAL_SOURCES) return retrievalProviderIds.BRAVE_SEARCH;
  return retrievalProviderIds.BRAVE_SEARCH;
}
