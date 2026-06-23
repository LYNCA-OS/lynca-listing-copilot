import { validateCandidate } from "./constraint-engine.mjs";
import {
  sourceIsMarketplace,
  sourceIsOcr,
  sourceIsRegistry,
  sourceIsRetrieval,
  sourceIsSlab
} from "./normalizer.mjs";

function maxConfidence(items = []) {
  return Math.max(...items.map((item) => Number(item.confidence || 0)), 0);
}

function agreementScore(group = {}) {
  const ocrSources = group.ocr_sources || [];
  if (ocrSources.length >= 2) return 1;
  if (ocrSources.length === 1) return 0.5;
  return 0;
}

function retrievalSupport(items = []) {
  const retrievalItems = items.filter((item) => sourceIsRetrieval(item.source));
  if (!retrievalItems.length) return 0;
  const nonMarketplace = retrievalItems.filter((item) => !sourceIsMarketplace(item.source));
  return Math.min(1, (nonMarketplace.length * 0.5) + (retrievalItems.length * 0.2));
}

function conflictPenalty(fieldConflicts = []) {
  if (!fieldConflicts.length) return 0;
  if (fieldConflicts.some((conflict) => conflict.severity === "HIGH")) return 0.8;
  if (fieldConflicts.some((conflict) => conflict.severity === "MEDIUM")) return 0.5;
  return 0.25;
}

function marketplacePenalty(items = []) {
  if (!items.length) return 0;
  if (items.every((item) => sourceIsMarketplace(item.source))) return 1;
  const marketplaceCount = items.filter((item) => sourceIsMarketplace(item.source)).length;
  return marketplaceCount / items.length > 0.5 ? 0.5 : 0;
}

export function generateFieldCandidates(aggregation = {}, {
  conflictsByField = {},
  productSchemas = [],
  registryRecords = [],
  options = {}
} = {}) {
  const candidatesByField = {};

  Object.entries(aggregation.fields || {}).forEach(([field, groups]) => {
    candidatesByField[field] = Object.values(groups).map((group) => {
      const items = group.evidence_items || [];
      const constraintResult = validateCandidate(group, {
        productSchemas,
        registryRecords
      });

      return {
        field,
        value: group.value,
        key: group.key,
        display_value: group.display_value,
        evidence_items: items,
        sources: group.sources || [],
        best_source: group.best_source,
        best_source_rank: group.best_source_rank,
        marketplace_only: items.length > 0 && items.every((item) => sourceIsMarketplace(item.source)),
        constraint_result: constraintResult,
        score_components: {
          OCR_confidence: maxConfidence(items.filter((item) => sourceIsOcr(item.source))),
          cross_view_agreement: agreementScore(group),
          registry_match: items.some((item) => sourceIsRegistry(item.source)) ? 1 : 0,
          slab_match: items.some((item) => sourceIsSlab(item.source)) ? 1 : 0,
          retrieval_support: retrievalSupport(items),
          structural_validity: constraintResult.structural_validity,
          conflict_penalty: conflictPenalty(conflictsByField[field] || []),
          glare_penalty: Math.max(Number(group.max_glare_score || 0), Number(group.max_blur_score || 0) * 0.5),
          marketplace_overreliance_penalty: marketplacePenalty(items)
        },
        options
      };
    });
  });

  return candidatesByField;
}
