import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import { aggregateEvidence, buildEvidenceItems } from "./aggregator.mjs";
import { routeAmbiguity, routeIdentityStatus } from "./ambiguity-router.mjs";
import { generateFieldCandidates } from "./candidate-generator.mjs";
import { validateIdentity } from "./constraint-engine.mjs";
import { detectConflicts, groupConflictsByField } from "./conflict-detector.mjs";
import { buildConflictGraph } from "./conflict-graph.mjs";
import { buildIdentityState } from "./identity-state.mjs";
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
    "insert",
    "parallel",
    "variation",
    "serial_number",
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
    "product",
    "set",
    "subset",
    "card_type",
    "insert",
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
      resolved: Boolean(selection.selected) && selection.selected?.key !== candidate.key
        ? true
        : selection.resolved === true && selection.selected?.key === candidate.key,
      resolution: Boolean(selection.selected) && selection.selected?.key !== candidate.key
        ? "rejected_failed_constraint_candidate"
        : selection.resolved ? selection.reason : null,
      selected_value: selection.selected?.value ?? null
    }));
  });
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
  const decisionRoute = selection.ambiguity || uncertainty.high_conflict_high_uncertainty ? "ABSTAIN" : "USE";

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
  const allEvidenceItems = buildEvidenceItems({
    evidenceItems,
    resolvedHint,
    retrievalCandidates,
    registryRecords,
    options: mergedOptions
  });
  const aggregation = aggregateEvidence(allEvidenceItems);
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
  const identityState = buildIdentityState({
    identity,
    fieldStates,
    conflictGraph,
    resolutionTrace: trace,
    status
  });

  return {
    identity,
    resolved_identity: identity,
    identity_state: identityState,
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
    confidence_report: report
  };
}
