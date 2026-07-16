export const retrievalProviderIds = Object.freeze({
  INTERNAL_MEMORY: "internal_memory",
  INTERNAL_REGISTRY: "internal_registry",
  CATALOG: "catalog",
  VISUAL_VECTOR: "visual_vector",
  POSTGRES_HYBRID: "postgres_hybrid",
  OFFICIAL_SOURCE: "official_source",
  BRAVE_SEARCH: "brave",
  EBAY_BROWSE: "ebay_browse",
  OPENAI_WEB_SEARCH: "openai_web_search"
});

export const allowedOpenAiWebSearchModels = Object.freeze([
  "gpt-4.1-mini",
  "gpt-4.1"
]);

export function normalizeRetrievalProviderId(value) {
  return String(value || "").trim().toLowerCase();
}

export function isKnownRetrievalProviderId(value) {
  return Object.values(retrievalProviderIds).includes(normalizeRetrievalProviderId(value));
}

export function openAiWebSearchModelConfig(requestedModel) {
  const model = String(requestedModel || "").trim();

  return {
    model_id: allowedOpenAiWebSearchModels.includes(model) ? model : "",
    requested_model_id: model,
    allowed_models: [...allowedOpenAiWebSearchModels],
    configured: Boolean(model),
    allowed: Boolean(model && allowedOpenAiWebSearchModels.includes(model))
  };
}

export const retrievalSourceTypes = Object.freeze({
  INTERNAL_APPROVED_HISTORY: "INTERNAL_APPROVED_HISTORY",
  INTERNAL_REGISTRY: "INTERNAL_REGISTRY",
  OFFICIAL_CHECKLIST: "OFFICIAL_CHECKLIST",
  OFFICIAL_PRODUCT_PAGE: "OFFICIAL_PRODUCT_PAGE",
  OFFICIAL_GRADING_DATA: "OFFICIAL_GRADING_DATA",
  STRUCTURED_DATABASE: "STRUCTURED_DATABASE",
  VISUAL_VECTOR: "VISUAL_VECTOR",
  MARKETPLACE: "MARKETPLACE",
  OPEN_WEB: "OPEN_WEB"
});

export const retrievalTrustTiers = Object.freeze({
  CARD_OR_OPERATOR: 1,
  OFFICIAL: 2,
  APPROVED_HISTORY: 3,
  STRUCTURED: 4,
  INTERNAL_REGISTRY: 5,
  VISUAL_CANDIDATE: 6,
  MARKET_REFERENCE: 8,
  OPEN_WEB: 9
});

export const retrievalQueryFamilies = Object.freeze({
  INTERNAL_APPROVED_HISTORY: "SEARCH_INTERNAL_APPROVED_HISTORY",
  INTERNAL_REGISTRY: "SEARCH_INTERNAL_REGISTRY",
  CATALOG_EXACT_CODE: "SEARCH_CATALOG_EXACT_CODE",
  CATALOG_YEAR_PRODUCT_SUBJECT: "SEARCH_CATALOG_YEAR_PRODUCT_SUBJECT",
  CATALOG_PRODUCT_VOCABULARY: "SEARCH_CATALOG_PRODUCT_VOCABULARY",
  CATALOG_PRODUCT_SERIAL_DENOMINATOR: "SEARCH_CATALOG_PRODUCT_SERIAL_DENOMINATOR",
  CATALOG_SET_SUBJECT: "SEARCH_CATALOG_SET_SUBJECT",
  VISUAL_VECTOR: "SEARCH_VISUAL_VECTOR",
  POSTGRES_HYBRID: "SEARCH_POSTGRES_HYBRID",
  EXACT_CHECKLIST_CODE: "SEARCH_EXACT_CHECKLIST_CODE",
  PLAYER_AND_COLLECTOR_NUMBER: "SEARCH_PLAYER_AND_COLLECTOR_NUMBER",
  PRODUCT_AND_SERIAL_DENOMINATOR: "SEARCH_PRODUCT_AND_SERIAL_DENOMINATOR",
  OFFICIAL_SOURCES: "SEARCH_OFFICIAL_SOURCES",
  BRAVE: "SEARCH_BRAVE",
  EBAY: "SEARCH_EBAY",
  OWS_FALLBACK: "SEARCH_OWS_FALLBACK"
});

export const retrievalModes = Object.freeze({
  AUTO: "AUTO",
  INTERNAL_ONLY: "INTERNAL_ONLY",
  EXTERNAL_ALLOWED: "EXTERNAL_ALLOWED"
});

export function normalizeRetrievalMode(value) {
  const normalized = String(value || "").toUpperCase();
  return Object.values(retrievalModes).includes(normalized) ? normalized : retrievalModes.AUTO;
}

export function retrievalUnavailable(providerId, reason) {
  return {
    provider_id: providerId,
    unavailable: true,
    reason
  };
}
