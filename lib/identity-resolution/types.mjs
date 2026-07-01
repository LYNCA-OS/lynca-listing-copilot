export const ambiguityStatuses = Object.freeze({
  CONFIRMED: "CONFIRMED",
  RESOLVED: "RESOLVED",
  AMBIGUOUS: "AMBIGUOUS"
});

export const identityStatuses = Object.freeze({
  CONFIRMED: "CONFIRMED",
  RESOLVED: "RESOLVED",
  ABSTAIN: "ABSTAIN"
});

export const identityEvidenceSources = Object.freeze([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "INTERNAL_APPROVED_HISTORY",
  "OFFICIAL_CHECKLIST",
  "STRUCTURED_DATABASE",
  "VECTOR_APPROVED_REFERENCE",
  "MODEL_INFERENCE",
  "PRIMARY_FAST_VISION",
  "OCR_ONLY",
  "MARKETPLACE",
  "VISUAL_GUESS"
]);

export const sourcePriorityRank = Object.freeze({
  SLAB_LABEL: 1,
  CARD_BACK_PRINTED_TEXT: 2,
  CARD_FRONT_PRINTED_TEXT: 3,
  INTERNAL_APPROVED_HISTORY: 4,
  OFFICIAL_CHECKLIST: 5,
  STRUCTURED_DATABASE: 6,
  VECTOR_APPROVED_REFERENCE: 7,
  MODEL_INFERENCE: 8,
  PRIMARY_FAST_VISION: 9,
  OCR_ONLY: 10,
  MARKETPLACE: 11,
  VISUAL_GUESS: 12
});

export const defaultScoringWeights = Object.freeze({
  ocrConfidence: 0.65,
  crossViewAgreement: 0.15,
  registryMatch: 0.75,
  slabMatch: 0.78,
  retrievalSupport: 0.22,
  focusedVisualSupport: 0.42,
  taxonomySerialSupport: 0.12,
  structuralValidity: 0.22,
  conflictPenalty: 0.2,
  glarePenalty: 0.08,
  marketplaceOverreliancePenalty: 0.2
});

export const defaultIdentityResolutionOptions = Object.freeze({
  topK: 3,
  fieldAmbiguityGap: 0.12,
  highConfidenceThreshold: 0.74,
  confirmedConfidenceThreshold: 0.86,
  abstainEntropyThreshold: 0.55,
  abstainConflictIntensityThreshold: 0.75,
  includeResolvedHint: true,
  resolvedHintConfidence: 0.45,
  weights: defaultScoringWeights
});

export const identityFieldNames = Object.freeze([
  "year",
  "multi_card",
  "card_count",
  "lot_type",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "players",
  "character",
  "team",
  "artist",
  "card_type",
  "official_card_type",
  "observable_components",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "attributes",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "jersey",
  "sketch",
  "redemption",
  "one_of_one",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

export const defaultCriticalFields = Object.freeze([
  "year",
  "product",
  "players"
]);

export const optionalCriticalFields = Object.freeze([
  "serial_number",
  "collector_number",
  "checklist_code",
  "multi_card",
  "card_count",
  "lot_type",
  "parallel",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "card_type",
  "official_card_type",
  "observable_components",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

export const conflictSeverities = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH"
});

export const detectedConflictFields = Object.freeze([
  "serial_number",
  "multi_card",
  "card_count",
  "lot_type",
  "year",
  "product",
  "players",
  "card_type",
  "official_card_type",
  "observable_components",
  "parallel",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "checklist_code",
  "grade_company",
  "card_grade",
  "auto_grade",
  "jersey",
  "grade_type"
]);

export function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export function mergeIdentityResolutionOptions(options = {}) {
  const weights = {
    ...defaultScoringWeights,
    ...(options.weights || {})
  };

  return {
    ...defaultIdentityResolutionOptions,
    ...options,
    topK: Math.max(1, Number(options.topK || defaultIdentityResolutionOptions.topK)),
    fieldAmbiguityGap: clamp01(options.fieldAmbiguityGap, defaultIdentityResolutionOptions.fieldAmbiguityGap),
    highConfidenceThreshold: clamp01(options.highConfidenceThreshold, defaultIdentityResolutionOptions.highConfidenceThreshold),
    confirmedConfidenceThreshold: clamp01(options.confirmedConfidenceThreshold, defaultIdentityResolutionOptions.confirmedConfidenceThreshold),
    abstainEntropyThreshold: clamp01(options.abstainEntropyThreshold, defaultIdentityResolutionOptions.abstainEntropyThreshold),
    abstainConflictIntensityThreshold: clamp01(options.abstainConflictIntensityThreshold, defaultIdentityResolutionOptions.abstainConflictIntensityThreshold),
    resolvedHintConfidence: clamp01(options.resolvedHintConfidence, defaultIdentityResolutionOptions.resolvedHintConfidence),
    weights
  };
}

export function sourceRank(source) {
  return sourcePriorityRank[source] || sourcePriorityRank.VISUAL_GUESS;
}
