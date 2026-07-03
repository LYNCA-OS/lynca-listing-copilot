import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import { aggregateEvidence, canonicalizeIdentityEvidence } from "./aggregator.mjs";
import { routeAmbiguity, routeIdentityStatus } from "./ambiguity-router.mjs";
import {
  evidenceItemsFromSelectedCardIdentity,
  generateCardIdentityCandidates
} from "./card-identity-candidates.mjs";
import { generateFieldCandidates } from "./candidate-generator.mjs";
import { validateIdentity } from "./constraint-engine.mjs";
import { detectConflicts, groupConflictsByField } from "./conflict-detector.mjs";
import { buildConflictGraph } from "./conflict-graph.mjs";
import { buildOpenWorldIdentity } from "./identity-layers.mjs";
import { buildIdentityState } from "./identity-state.mjs";
import { deriveParallelExactEvidenceFromTaxonomy } from "./parallel-taxonomy.mjs";
import { rankFieldCandidates } from "./scoring-engine.mjs";
import {
  ambiguityStatuses,
  clamp01,
  defaultCriticalFields,
  mergeIdentityResolutionOptions,
  optionalCriticalFields
} from "./types.mjs";
import { appendTrace, candidateTraceSummary } from "./resolution-trace.mjs";
import { calculateFieldUncertainty } from "./uncertainty-engine.mjs";
import {
  canonicalValueKey,
  normalizeFieldValue,
  normalizeText,
  sourceIsCardDesign,
  sourceIsMarketplace,
  sourceIsRegistry,
  sourceIsSlab
} from "./normalizer.mjs";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sourceSummary(candidate = null) {
  if (!candidate) return [];
  const counts = {};
  (candidate.evidence_items || []).forEach((item) => {
    counts[item.source] = (counts[item.source] || 0) + 1;
  });
  return Object.entries(counts).map(([source, count]) => ({ source, count }));
}

function evidenceSummary(items = []) {
  return (items || []).map((item) => ({
    source: item.source,
    value: item.value,
    confidence: item.confidence,
    image_id: item.image_id || null,
    original_source: item.metadata?.original_source || null
  }));
}

function conflictingSourceSummary(ranked = [], selected = null, field) {
  return ranked
    .filter((candidate) => {
      if (!selected) return true;
      return canonicalValueKey(field, candidate.value) !== canonicalValueKey(field, selected.value);
    })
    .flatMap((candidate) => evidenceSummary(candidate.evidence_items));
}

function publicCandidate(candidate = {}) {
  return {
    field: candidate.field,
    value: candidate.value,
    score: candidate.score,
    sources: candidate.sources || [],
    best_source: candidate.best_source,
    marketplace_only: candidate.marketplace_only,
    score_components: candidate.score_components,
    constraint_result: candidate.constraint_result,
    evidence_items: candidate.evidence_items || []
  };
}

function hasOcrConflict(conflicts = []) {
  return conflicts.some((conflict) => {
    const groups = conflict.source_groups || {};
    return groups.has_ocr_conflict
      || groups.has_slab_ocr_conflict
      || groups.has_registry_ocr_conflict
      || String(conflict.conflict_type || "").includes("OCR");
  });
}

function tripleConflict(conflicts = []) {
  return conflicts.some((conflict) => {
    const groups = conflict.source_groups || {};
    return groups.has_ocr_conflict && groups.has_registry_conflict && groups.has_retrieval_conflict;
  });
}

function topValidCandidates(ranked = []) {
  return ranked.filter((candidate) => candidate.constraint_result?.valid !== false);
}

function cardDesignAuthoritativeForField(field) {
  return [
    "year",
    "manufacturer",
    "brand",
    "product",
    "set",
    "subset",
    "card_type",
    "card_name",
    "insert",
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation",
    "serial_number",
    "numerical_rarity",
    "collector_number",
    "checklist_code",
    "rc",
    "first_bowman",
    "ssp",
    "case_hit",
    "auto",
    "patch",
    "relic",
    "one_of_one"
  ].includes(field);
}

function cardDesignCandidate(valid = []) {
  return valid.find((candidate) => candidate.evidence_items?.some((item) => sourceIsCardDesign(item.source))) || null;
}

function backPrintedOverrideField(field) {
  return ["serial_number", "collector_number", "checklist_code"].includes(field);
}

function singleBackPrintedCandidate(field, valid = []) {
  if (!backPrintedOverrideField(field)) return null;
  const backCandidates = valid.filter((candidate) => {
    return candidate.evidence_items?.some((item) => item.source === "CARD_BACK_PRINTED_TEXT");
  });
  const distinctBackValues = new Set(backCandidates.map((candidate) => canonicalValueKey(field, candidate.value)));
  return distinctBackValues.size === 1 ? backCandidates[0] : null;
}

function candidateHasCardDesignEvidence(candidate = {}) {
  return candidate.evidence_items?.some((item) => sourceIsCardDesign(item.source)) === true;
}

function hasCompetingNonDesignCandidate(field, valid = [], design = null) {
  if (!design) return false;
  return valid.some((candidate) => {
    return !candidateHasCardDesignEvidence(candidate)
      && !sameCandidateValue(candidate, design.value, field);
  });
}

function sameCandidateValue(candidate, value, field) {
  return canonicalValueKey(field, candidate?.value) === canonicalValueKey(field, value);
}

function descriptorSpecificityField(field) {
  return [
    "year",
    "product",
    "set",
    "subset",
    "card_type",
    "card_name",
    "insert",
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation"
  ].includes(field);
}

function moreSpecificCompatibleCandidate(field, valid = [], options = {}) {
  if (!descriptorSpecificityField(field) || valid.length < 2) return null;
  const topScore = Number(valid[0]?.score || 0);
  const close = valid.filter((candidate) => {
    return topScore - Number(candidate.score || 0) < options.fieldAmbiguityGap;
  });
  if (close.length < 2) return null;

  const withKeys = close
    .map((candidate) => ({
      candidate,
      key: canonicalValueKey(field, candidate.value)
    }))
    .filter((item) => item.key);
  if (withKeys.length < 2) return null;

  const sorted = [...withKeys].sort((left, right) => right.key.length - left.key.length);
  const mostSpecific = sorted[0];
  const compatible = sorted.slice(1).every((item) => {
    return mostSpecific.key.includes(item.key) || item.key.includes(mostSpecific.key);
  });
  return compatible ? mostSpecific.candidate : null;
}

function annotateConflicts(fieldConflicts = [], selection = {}) {
  return fieldConflicts.map((conflict) => ({
    ...conflict,
    resolved: selection.resolved === true,
    resolution: selection.resolved ? selection.reason : null,
    selected_value: selection.selected?.value ?? null
  }));
}

function constraintConflicts(field, ranked = [], selection = {}) {
  return ranked.flatMap((candidate) => {
    return (candidate.constraint_result?.violations || []).map((violation) => ({
      field,
      conflict_type: String(violation.code || "constraint_violation").toUpperCase(),
      conflicting_values: [candidate.value],
      severity: violation.severity || "HIGH",
      reason: violation.message || "candidate failed identity constraint",
      resolved: selection.resolved === true && !selection.selected
        ? true
        : Boolean(selection.selected) && selection.selected?.key !== candidate.key
        ? true
        : selection.resolved === true && selection.selected?.key === candidate.key,
      resolution: selection.resolved === true && !selection.selected
        ? selection.reason
        : Boolean(selection.selected) && selection.selected?.key !== candidate.key
        ? "rejected_failed_constraint_candidate"
        : selection.resolved ? selection.reason : null,
      selected_value: selection.selected?.value ?? null
    }));
  });
}

function optionalUnsupportedDropField(field) {
  return [
    "insert",
    "card_type",
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation",
    "numerical_rarity",
    "rc",
    "first_bowman",
    "ssp",
    "case_hit"
  ].includes(field);
}

function selectFieldCandidate({
  field,
  ranked,
  fieldConflicts,
  options
}) {
  const valid = topValidCandidates(ranked);
  const top = valid[0] || null;
  const second = valid[1] || null;

  if (!ranked.length) {
    return {
      selected: null,
      reason: "missing_evidence",
      ambiguity: true,
      resolved: false
    };
  }

  if (!valid.length) {
    if (optionalUnsupportedDropField(field)) {
      return {
        selected: null,
        reason: "rejected_unsupported_optional_candidate",
        ambiguity: false,
        resolved: true
      };
    }
    return {
      selected: null,
      reason: "all_candidates_failed_constraints",
      ambiguity: true,
      resolved: false
    };
  }

  if (tripleConflict(fieldConflicts)) {
    return {
      selected: null,
      reason: "ambiguous_ocr_registry_retrieval_conflict",
      ambiguity: true,
      resolved: false
    };
  }

  const design = cardDesignAuthoritativeForField(field) ? cardDesignCandidate(valid) : null;
  if (design && hasCompetingNonDesignCandidate(field, valid, design)) {
    return {
      selected: design,
      reason: "card_design_override_label_or_inference_conflict",
      ambiguity: false,
      resolved: true
    };
  }

  if (hasOcrConflict(fieldConflicts)) {
    const slab = valid.find((candidate) => candidate.evidence_items?.some((item) => sourceIsSlab(item.source)));
    if (slab) {
      return {
        selected: slab,
        reason: "slab_override_ocr_conflict",
        ambiguity: false,
        resolved: true
      };
    }

    const registry = valid.find((candidate) => candidate.evidence_items?.some((item) => sourceIsRegistry(item.source)));
    if (registry) {
      return {
        selected: registry,
        reason: "registry_override_ocr_conflict",
        ambiguity: false,
        resolved: true
      };
    }

    const backPrinted = singleBackPrintedCandidate(field, valid);
    if (backPrinted) {
      return {
        selected: backPrinted,
        reason: "card_back_printed_text_override_front_ocr_conflict",
        ambiguity: false,
        resolved: true
      };
    }
  }

  if (top?.marketplace_only) {
    const nonMarketplace = valid.find((candidate) => !candidate.marketplace_only);
    if (nonMarketplace) {
      return {
        selected: nonMarketplace,
        reason: "marketplace_reference_cannot_override_grounded_evidence",
        ambiguity: false,
        resolved: fieldConflicts.length > 0
      };
    }
    return {
      selected: null,
      reason: "marketplace_reference_only",
      ambiguity: true,
      resolved: false
    };
  }

  const moreSpecific = moreSpecificCompatibleCandidate(field, valid, options);
  if (moreSpecific && !sameCandidateValue(moreSpecific, top.value, field)) {
    return {
      selected: moreSpecific,
      reason: "more_specific_compatible_descriptor",
      ambiguity: false,
      resolved: fieldConflicts.length > 0
    };
  }

  if (second && !sameCandidateValue(top, second.value, field)) {
    const margin = Number((top.score - second.score).toFixed(4));
    if (margin < options.fieldAmbiguityGap) {
      return {
        selected: null,
        reason: "ambiguous_low_score_margin",
        ambiguity: true,
        resolved: false,
        margin
      };
    }
  }

  return {
    selected: top,
    reason: fieldConflicts.length ? "highest_scoring_candidate_after_conflict_check" : "highest_scoring_candidate",
    ambiguity: false,
    resolved: fieldConflicts.length > 0
  };
}

function fieldsToResolve(candidatesByField = {}, options = {}) {
  const configuredCritical = options.criticalFields || defaultCriticalFields;
  const evidenceFields = Object.keys(candidatesByField);
  const presentOptionalCritical = optionalCriticalFields.filter((field) => evidenceFields.includes(field));
  return unique([...configuredCritical, ...presentOptionalCritical, ...evidenceFields]);
}

function fieldStateForSelection({
  field,
  ranked,
  fieldConflicts,
  selection,
  options
}) {
  const selected = selection.selected;
  const conflictItems = [
    ...annotateConflicts(fieldConflicts, selection),
    ...constraintConflicts(field, ranked, selection)
  ];
  const uncertainty = calculateFieldUncertainty({
    candidates: ranked,
    conflicts: conflictItems,
    selected,
    options
  });
  const decisionRoute = selection.resolved === true && !selected
    ? "DROP"
    : selection.ambiguity || uncertainty.high_conflict_high_uncertainty ? "ABSTAIN" : "USE";

  return {
    field,
    candidates: ranked.slice(0, options.topK).map(publicCandidate),
    conflicts: conflictItems.length > 0,
    conflict_items: conflictItems,
    entropy: uncertainty.entropy,
    conflict_intensity: uncertainty.conflict_intensity,
    evidence_dispersion: uncertainty.evidence_dispersion,
    uncertainty_score: uncertainty.uncertainty_score,
    field_uncertainty: uncertainty,
    resolved_value: selected ? selected.value : null,
    resolution_confidence: selected ? clamp01(selected.score) : 0,
    resolution_reason: selection.reason,
    ambiguity: selection.ambiguity,
    decision_route: decisionRoute,
    supporting_sources: evidenceSummary(selected?.evidence_items || []),
    conflicting_sources: conflictingSourceSummary(ranked, selected, field),
    source_summary: sourceSummary(selected)
  };
}

function identityFromFieldStates(fieldStates = []) {
  const selected = {};
  fieldStates.forEach((fieldState) => {
    if (fieldState.resolved_value === null || fieldState.resolved_value === undefined || fieldState.resolved_value === "") return;
    selected[fieldState.field] = normalizeFieldValue(fieldState.field, fieldState.resolved_value);
  });

  const identity = normalizeResolvedFields(selected);
  if (identity.serial_number === "1/1") identity.one_of_one = true;
  return identity;
}

function confidenceReport(fieldStates = []) {
  const resolved = fieldStates.filter((fieldState) => fieldState.resolved_value !== null && fieldState.resolved_value !== undefined);
  const perField = Object.fromEntries(fieldStates.map((fieldState) => [fieldState.field, fieldState.resolution_confidence]));
  const weakest = resolved.length
    ? resolved.reduce((lowest, fieldState) => fieldState.resolution_confidence < lowest.resolution_confidence ? fieldState : lowest, resolved[0])
    : null;
  const global = resolved.length
    ? resolved.reduce((sum, fieldState) => sum + fieldState.resolution_confidence, 0) / resolved.length
    : 0;

  return {
    per_field_confidence: perField,
    global_confidence: Number(global.toFixed(4)),
    weakest_field: weakest?.field || null
  };
}

function constraintScoreReport(fieldStates = [], identityConflicts = []) {
  const perField = Object.fromEntries(fieldStates.map((fieldState) => {
    const scores = (fieldState.candidates || [])
      .map((candidate) => candidate.constraint_result?.constraint_score)
      .filter((score) => Number.isFinite(Number(score)))
      .map(Number);
    const best = scores.length ? Math.max(...scores) : 1;
    return [fieldState.field, Number(best.toFixed(4))];
  }));
  const scores = Object.values(perField);
  const global = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 1;

  return {
    per_field_constraint_score: perField,
    global_constraint_score: Number(global.toFixed(4)),
    identity_constraint_conflicts: identityConflicts,
    scoring_model: "weighted_constraint_rules",
    rule_semantics: "rules emit weighted violations; valid candidates retain a non-zero structural validity score"
  };
}

export function resolveIdentity({
  evidenceItems = [],
  resolvedHint = {},
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = [],
  options = {}
} = {}) {
  const mergedOptions = mergeIdentityResolutionOptions(options);
  const trace = [];
  let canonicalEvidence = canonicalizeIdentityEvidence({
    evidenceItems,
    resolvedHint,
    retrievalCandidates,
    registryRecords,
    options: mergedOptions
  });
  let allEvidenceItems = canonicalEvidence.evidence_items;
  let aggregation = aggregateEvidence(allEvidenceItems);
  const taxonomyEvidenceItems = deriveParallelExactEvidenceFromTaxonomy(aggregation, {
    productSchemas,
    registryRecords
  });
  if (taxonomyEvidenceItems.length) {
    allEvidenceItems = appendUniqueEvidenceItems(allEvidenceItems, taxonomyEvidenceItems);
    aggregation = aggregateEvidence(allEvidenceItems);
  }
  const cardIdentityReport = generateCardIdentityCandidates({
    aggregation,
    retrievalCandidates,
    registryRecords,
    productSchemas,
    options: mergedOptions
  });
  const cardIdentityEvidenceItems = evidenceItemsFromSelectedCardIdentity(cardIdentityReport);
  if (cardIdentityEvidenceItems.length) {
    allEvidenceItems = appendUniqueEvidenceItems(allEvidenceItems, cardIdentityEvidenceItems);
    aggregation = aggregateEvidence(allEvidenceItems);
  }
  if (taxonomyEvidenceItems.length || cardIdentityEvidenceItems.length) {
    canonicalEvidence = canonicalizeIdentityEvidence({
      evidenceItems: allEvidenceItems,
      options: {
        ...mergedOptions,
        includeResolvedHint: false
      }
    });
  }

  if (taxonomyEvidenceItems.length || cardIdentityReport.candidates.length) {
    appendTrace(trace, {
      field: "_identity",
      step: "whole_card_candidate_generation",
      input: {
        retrieval_candidate_count: retrievalCandidates.length,
        registry_record_count: registryRecords.length,
        product_schema_count: Array.isArray(productSchemas) ? productSchemas.length : 0
      },
      output: {
        taxonomy_parallel_evidence_count: taxonomyEvidenceItems.length,
        selected_card_identity_candidate_id: cardIdentityReport.selected_candidate_id,
        candidate_count: cardIdentityReport.candidates.length,
        candidates: cardIdentityReport.candidates.map((candidate) => ({
          candidate_id: candidate.candidate_id,
          score: candidate.score,
          selected: candidate.selected,
          conflict_count: candidate.conflict_count
        }))
      }
    });
  }
  const detectedConflicts = detectConflicts(aggregation);
  const conflictsByField = groupConflictsByField(detectedConflicts);
  const candidatesByField = generateFieldCandidates(aggregation, {
    conflictsByField,
    productSchemas,
    registryRecords,
    options: mergedOptions
  });
  const fieldStates = [];
  const rankedByField = {};
  let conflictMap = [];

  fieldsToResolve(candidatesByField, mergedOptions).forEach((field) => {
    const rawCandidates = candidatesByField[field] || [];
    const ranked = rankFieldCandidates(rawCandidates, { options: mergedOptions });
    rankedByField[field] = ranked;
    const fieldConflicts = conflictsByField[field] || [];

    appendTrace(trace, {
      field,
      step: "candidate_generation",
      input: { evidence_count: aggregation.evidence_items.length },
      output: { candidate_count: rawCandidates.length, candidates: candidateTraceSummary(rawCandidates) }
    });

    appendTrace(trace, {
      field,
      step: "conflict_detection",
      input: { candidate_values: rawCandidates.map((candidate) => candidate.value) },
      output: { conflicts: fieldConflicts }
    });

    appendTrace(trace, {
      field,
      step: "constraint_validation",
      input: { candidate_values: rawCandidates.map((candidate) => candidate.value) },
      output: rawCandidates.map((candidate) => ({
        value: candidate.value,
        constraint_result: candidate.constraint_result
      }))
    });

    appendTrace(trace, {
      field,
      step: "scoring",
      input: { formula: ranked[0]?.score_formula || null },
      output: { candidates: candidateTraceSummary(ranked) }
    });

    const selection = selectFieldCandidate({
      field,
      ranked,
      fieldConflicts,
      options: mergedOptions
    });
    const fieldState = fieldStateForSelection({
      field,
      ranked,
      fieldConflicts,
      selection,
      options: mergedOptions
    });
    fieldStates.push(fieldState);
    conflictMap.push(...fieldState.conflict_items);

    appendTrace(trace, {
      field,
      step: "solver_selection",
      input: { top_candidates: candidateTraceSummary(ranked) },
      output: {
        resolved_value: fieldState.resolved_value,
        resolution_confidence: fieldState.resolution_confidence,
        ambiguity: fieldState.ambiguity,
        entropy: fieldState.entropy,
        conflict_intensity: fieldState.conflict_intensity,
        evidence_dispersion: fieldState.evidence_dispersion,
        uncertainty_score: fieldState.uncertainty_score,
        decision_route: fieldState.decision_route
      },
      decision: fieldState.resolution_reason
    });
  });

  const identity = identityFromFieldStates(fieldStates);
  const identityConflicts = validateIdentity(identity, {
    productSchemas,
    registryRecords
  });
  conflictMap = [...conflictMap, ...identityConflicts];

  const status = routeIdentityStatus({
    fieldStates,
    conflictMap,
    options: mergedOptions
  });
  const ambiguityStatus = routeAmbiguity({
    fieldStates,
    conflictMap,
    options: mergedOptions
  });

  const conflictGraph = buildConflictGraph({
    aggregation,
    candidatesByField,
    rankedByField,
    fieldStates,
    conflictMap
  });

  fieldStates.forEach((fieldState) => {
    appendTrace(trace, {
      field: fieldState.field,
      step: "ambiguity_routing",
      input: {
        field_ambiguous: fieldState.ambiguity,
        conflicts: fieldState.conflict_items
      },
      output: { ambiguity_status: ambiguityStatus },
      decision: status
    });
  });

  const report = confidenceReport(fieldStates);
  const constraintReport = constraintScoreReport(fieldStates, identityConflicts);
  const openWorldIdentity = buildOpenWorldIdentity({
    identity,
    fieldStates,
    conflictMap,
    status,
    criticalFields: mergedOptions.criticalFields || defaultCriticalFields,
    fieldAmbiguityGap: mergedOptions.fieldAmbiguityGap
  });
  const identityState = buildIdentityState({
    identity,
    fieldStates,
    conflictGraph,
    resolutionTrace: trace,
    catalogCardIdentity: openWorldIdentity.catalog_card_identity,
    physicalAssetIdentity: openWorldIdentity.physical_asset_identity,
    openWorldIdentity,
    abstainReasonCodes: openWorldIdentity.abstain_reason_codes,
    status
  });

  return {
    identity,
    resolved_identity: identity,
    identity_state: identityState,
    catalog_card_identity: openWorldIdentity.catalog_card_identity,
    physical_asset_identity: openWorldIdentity.physical_asset_identity,
    open_world_identity: openWorldIdentity,
    abstain_reason_codes: openWorldIdentity.abstain_reason_codes,
    fields: identityState.fields,
    field_level_resolution: fieldStates,
    field_states: fieldStates,
    field_candidates: identityState.field_candidates,
    field_conflicts: identityState.field_conflicts,
    field_uncertainty: identityState.field_uncertainty,
    uncertainty_map: identityState.uncertainty_map,
    conflict_graph: conflictGraph,
    global_conflicts: conflictMap,
    status,
    ambiguity_status: ambiguityStatus || ambiguityStatuses.AMBIGUOUS,
    conflict_map: conflictMap,
    resolution_trace: trace,
    confidence_report: report,
    canonical_evidence: canonicalEvidence,
    card_identity_candidates: cardIdentityReport,
    candidate_identity_report: cardIdentityReport,
    constraint_score_report: constraintReport
  };
}

const defaultConvergenceOptions = Object.freeze({
  maxIterations: 2,
  stopStatuses: ["CONFIRMED"],
  retrieveStatuses: ["ABSTAIN"],
  retrieveHighSeverityConflicts: true
});

const convergenceLoopName = "detect_conflict_retrieve_reevaluate_converge";

function convergenceOptions(input = {}) {
  return {
    ...defaultConvergenceOptions,
    ...(input || {}),
    maxIterations: Math.max(0, Number(input.maxIterations ?? defaultConvergenceOptions.maxIterations))
  };
}

function shouldRetrieveForConvergence(result = {}, settings = {}) {
  const status = String(result.status || "").toUpperCase();
  if (settings.stopStatuses.map((item) => String(item).toUpperCase()).includes(status)) return false;
  if (settings.retrieveStatuses.map((item) => String(item).toUpperCase()).includes(status)) return true;
  if (!settings.retrieveHighSeverityConflicts) return false;
  return (result.conflict_map || []).some((conflict) => {
    return conflict.resolved !== true && String(conflict.severity || "").toUpperCase() === "HIGH";
  });
}

function unresolvedConvergenceFields(result = {}) {
  return (result.field_states || [])
    .filter((fieldState) => {
      return fieldState.decision_route === "ABSTAIN"
        || fieldState.ambiguity === true
        || (fieldState.conflict_items || []).some((conflict) => conflict.resolved !== true);
    })
    .map((fieldState) => fieldState.field);
}

function normalizeConvergenceRetrievalResponse(response = {}) {
  if (Array.isArray(response)) {
    return {
      evidenceItems: response,
      retrievalCandidates: [],
      registryRecords: [],
      productSchemas: []
    };
  }

  return {
    evidenceItems: Array.isArray(response.evidenceItems) ? response.evidenceItems : [],
    retrievalCandidates: Array.isArray(response.retrievalCandidates) ? response.retrievalCandidates : [],
    registryRecords: Array.isArray(response.registryRecords) ? response.registryRecords : [],
    productSchemas: Array.isArray(response.productSchemas) ? response.productSchemas : []
  };
}

function evidenceItemKey(item = {}) {
  const field = normalizeText(item.field || "");
  const source = normalizeText(item.source || item.source_type || "");
  const value = canonicalValueKey(field, item.value);
  const image = normalizeText(item.image_id || item.imageId || "");
  const region = normalizeText(item.region || "");
  return [field, source, value, image, region].join("::");
}

function appendUniqueEvidenceItems(existing = [], additions = []) {
  const seen = new Set(existing.map(evidenceItemKey));
  const next = [...existing];
  additions.forEach((item) => {
    const key = evidenceItemKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(item);
  });
  return next;
}

function appendObjectRecords(existing = [], additions = []) {
  return [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(additions) ? additions : [])
  ];
}

function convergenceFingerprint(result = {}) {
  const fieldValues = (result.field_states || []).map((fieldState) => [
    fieldState.field,
    canonicalValueKey(fieldState.field, fieldState.resolved_value),
    fieldState.decision_route,
    Number(fieldState.resolution_confidence || 0).toFixed(4)
  ]);
  return JSON.stringify({
    status: result.status,
    ambiguity_status: result.ambiguity_status,
    fields: fieldValues
  });
}

function buildCoreConvergenceReport(convergence = {}) {
  const trace = convergence.trace || [];
  const detectEvents = trace.filter((entry) => entry.step === "detect_conflict");
  const retrieveEvents = trace.filter((entry) => entry.step === "retrieve");
  const reEvaluateEvents = trace.filter((entry) => entry.step === "re_evaluate");
  const convergeEvents = trace.filter((entry) => entry.step === "converged");
  const finalEvent = [...trace].reverse().find((entry) => entry.status || entry.next_status) || {};
  const finalUnresolved = [...trace].reverse().find((entry) => Array.isArray(entry.unresolved_fields))?.unresolved_fields || [];
  const phaseSequence = [
    detectEvents.length ? "detect_conflict" : null,
    retrieveEvents.length ? "retrieve" : null,
    reEvaluateEvents.length ? "re_evaluate" : null,
    convergeEvents.length ? "converge" : null
  ].filter(Boolean);

  return {
    loop: convergenceLoopName,
    enabled: true,
    iterations: convergence.iterations || 0,
    converged: convergence.converged === true,
    phase_sequence: phaseSequence,
    detect_conflict_count: detectEvents.length,
    retrieval_attempts: retrieveEvents.length,
    re_evaluation_count: reEvaluateEvents.length,
    final_status: finalEvent.next_status || finalEvent.status || null,
    final_unresolved_fields: finalUnresolved,
    conflict_path: reEvaluateEvents.map((entry) => ({
      iteration: entry.iteration,
      previous_status: entry.previous_status,
      next_status: entry.next_status,
      unresolved_fields: entry.unresolved_fields || [],
      added_evidence_items: entry.added_evidence_items || 0,
      added_structured_records: entry.added_structured_records || 0
    }))
  };
}

function withConvergenceResult(result = {}, convergence = {}) {
  const convergenceReport = buildCoreConvergenceReport(convergence);
  return {
    ...result,
    convergence: {
      ...convergence,
      report: convergenceReport
    },
    convergence_report: convergenceReport,
    convergence_trace: convergence.trace || []
  };
}

export async function resolveIdentityWithConvergence({
  evidenceItems = [],
  resolvedHint = {},
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = [],
  options = {},
  retrieveEvidence
} = {}) {
  const settings = convergenceOptions(options.convergence);
  const convergenceTrace = [];
  const current = {
    evidenceItems: Array.isArray(evidenceItems) ? [...evidenceItems] : [],
    resolvedHint,
    retrievalCandidates: Array.isArray(retrievalCandidates) ? [...retrievalCandidates] : [],
    registryRecords: Array.isArray(registryRecords) ? [...registryRecords] : [],
    productSchemas: Array.isArray(productSchemas) ? [...productSchemas] : []
  };

  let result = resolveIdentity({ ...current, options });
  let previousFingerprint = convergenceFingerprint(result);

  convergenceTrace.push({
    iteration: 0,
    step: "detect_conflict",
    status: result.status,
    ambiguity_status: result.ambiguity_status,
    unresolved_fields: unresolvedConvergenceFields(result),
    conflict_count: result.conflict_map.length
  });

  if (!shouldRetrieveForConvergence(result, settings)) {
    convergenceTrace.push({
      iteration: 0,
      step: "converged",
      reason: "initial_identity_state_stable",
      status: result.status,
      ambiguity_status: result.ambiguity_status
    });
  }

  for (let iteration = 1; iteration <= settings.maxIterations; iteration += 1) {
    if (typeof retrieveEvidence !== "function" || !shouldRetrieveForConvergence(result, settings)) {
      break;
    }

    const retrievalRequest = {
      iteration,
      identity: result.identity,
      status: result.status,
      ambiguity_status: result.ambiguity_status,
      unresolved_fields: unresolvedConvergenceFields(result),
      conflict_map: result.conflict_map,
      field_states: result.field_states,
      canonical_evidence: result.canonical_evidence
    };

    convergenceTrace.push({
      iteration,
      step: "retrieve",
      request: {
        unresolved_fields: retrievalRequest.unresolved_fields,
        conflict_count: retrievalRequest.conflict_map.length
      }
    });

    const additions = normalizeConvergenceRetrievalResponse(await retrieveEvidence(retrievalRequest));
    const beforeEvidenceCount = current.evidenceItems.length;
    current.evidenceItems = appendUniqueEvidenceItems(current.evidenceItems, additions.evidenceItems);
    current.retrievalCandidates = appendObjectRecords(current.retrievalCandidates, additions.retrievalCandidates);
    current.registryRecords = appendObjectRecords(current.registryRecords, additions.registryRecords);
    current.productSchemas = appendObjectRecords(current.productSchemas, additions.productSchemas);

    const addedEvidenceCount = current.evidenceItems.length - beforeEvidenceCount;
    const addedStructuredCount = additions.retrievalCandidates.length
      + additions.registryRecords.length
      + additions.productSchemas.length;

    if (addedEvidenceCount === 0 && addedStructuredCount === 0) {
      convergenceTrace.push({
        iteration,
        step: "converged",
        reason: "no_new_evidence",
        status: result.status
      });
      break;
    }

    const nextResult = resolveIdentity({ ...current, options });
    const nextFingerprint = convergenceFingerprint(nextResult);

    convergenceTrace.push({
      iteration,
      step: "re_evaluate",
      added_evidence_items: addedEvidenceCount,
      added_structured_records: addedStructuredCount,
      previous_status: result.status,
      next_status: nextResult.status,
      next_ambiguity_status: nextResult.ambiguity_status,
      unresolved_fields: unresolvedConvergenceFields(nextResult)
    });

    result = nextResult;
    if (nextFingerprint === previousFingerprint || !shouldRetrieveForConvergence(result, settings)) {
      convergenceTrace.push({
        iteration,
        step: "converged",
        reason: nextFingerprint === previousFingerprint ? "stable_identity_state" : "resolved_without_more_retrieval",
        status: result.status,
        ambiguity_status: result.ambiguity_status
      });
      break;
    }

    previousFingerprint = nextFingerprint;
  }

  return withConvergenceResult(result, {
    enabled: true,
    max_iterations: settings.maxIterations,
    iterations: Math.max(0, ...convergenceTrace.map((entry) => Number(entry.iteration || 0))),
    converged: convergenceTrace.some((entry) => entry.step === "converged"),
    trace: convergenceTrace
  });
}
