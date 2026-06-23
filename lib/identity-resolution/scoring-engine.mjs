import { clamp01, mergeIdentityResolutionOptions } from "./types.mjs";

function component(candidate = {}, name) {
  return Number(candidate.score_components?.[name] || 0);
}

export function scoreCandidate(candidate = {}, {
  options = {}
} = {}) {
  const mergedOptions = mergeIdentityResolutionOptions(options);
  const weights = mergedOptions.weights;
  const positive =
    weights.ocrConfidence * component(candidate, "OCR_confidence")
    + weights.crossViewAgreement * component(candidate, "cross_view_agreement")
    + weights.registryMatch * component(candidate, "registry_match")
    + weights.slabMatch * component(candidate, "slab_match")
    + weights.retrievalSupport * component(candidate, "retrieval_support")
    + weights.structuralValidity * component(candidate, "structural_validity");
  const negative =
    weights.conflictPenalty * component(candidate, "conflict_penalty")
    + weights.glarePenalty * component(candidate, "glare_penalty")
    + weights.marketplaceOverreliancePenalty * component(candidate, "marketplace_overreliance_penalty");
  const priorityTieBreaker = Math.max(0, (10 - Number(candidate.best_source_rank || 10)) * 0.005);
  const score = clamp01(positive - negative + priorityTieBreaker);

  return {
    ...candidate,
    score: Number(score.toFixed(4)),
    score_formula: "w1*OCR_confidence + w2*cross_view_agreement + w3*registry_match + w4*slab_match + w5*retrieval_support + w6*structural_validity - w7*conflict_penalty - w8*glare_penalty - w9*marketplace_overreliance_penalty"
  };
}

export function rankFieldCandidates(candidates = [], {
  options = {}
} = {}) {
  const mergedOptions = mergeIdentityResolutionOptions(options);
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => scoreCandidate(candidate, { options: mergedOptions }))
    .sort((left, right) => {
      return right.score - left.score
        || left.best_source_rank - right.best_source_rank
        || String(left.display_value || "").localeCompare(String(right.display_value || ""));
    })
    .slice(0, Math.max(1, mergedOptions.topK));
}
