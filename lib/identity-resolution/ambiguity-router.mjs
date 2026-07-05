import { ambiguityStatuses, defaultCriticalFields, identityStatuses, mergeIdentityResolutionOptions } from "./types.mjs";

function hasResolvedValue(fieldState = {}) {
  if (Array.isArray(fieldState.resolved_value)) return fieldState.resolved_value.length > 0;
  return fieldState.resolved_value !== null && fieldState.resolved_value !== undefined && fieldState.resolved_value !== "";
}

function fieldIsAmbiguous(fieldState = {}) {
  return fieldState.ambiguity === true || String(fieldState.resolution_reason || "").includes("ambiguous") || !hasResolvedValue(fieldState);
}

function hasHighConfidenceAnchor(fieldState = {}, threshold) {
  if (!hasResolvedValue(fieldState) || Number(fieldState.resolution_confidence || 0) < threshold) return false;

  const sources = (fieldState.source_summary || []).map((item) => item.source);
  const hasSlab = sources.includes("SLAB_LABEL");
  const hasRegistry = sources.some((source) => [
    "INTERNAL_APPROVED_HISTORY",
    "OFFICIAL_CHECKLIST",
    "STRUCTURED_DATABASE"
  ].includes(source));
  const ocrSourceCount = sources.filter((source) => [
    "CARD_BACK_PRINTED_TEXT",
    "CARD_FRONT_PRINTED_TEXT",
    "OCR_ONLY"
  ].includes(source)).length;

  return hasSlab || hasRegistry || ocrSourceCount >= 1;
}

function fieldRequiresAbstain(fieldState = {}, options = {}) {
  const uncertainty = fieldState.field_uncertainty || {};
  return fieldIsAmbiguous(fieldState)
    || uncertainty.high_conflict_high_uncertainty === true
    || Number(uncertainty.uncertainty_score || 0) >= Number(options.abstainUncertaintyThreshold || 0.72);
}

export function routeIdentityStatus({
  fieldStates = [],
  conflictMap = [],
  options = {}
} = {}) {
  const mergedOptions = mergeIdentityResolutionOptions(options);
  const criticalFields = new Set([...(options.criticalFields || defaultCriticalFields)]);
  const criticalAmbiguousCount = fieldStates
    .filter((fieldState) => criticalFields.has(fieldState.field) && fieldRequiresAbstain(fieldState, mergedOptions))
    .length;
  const unresolvedSevereConflict = conflictMap.some((conflict) => conflict.severity === "HIGH" && conflict.resolved !== true);
  const unresolvedHighUncertaintyConflict = fieldStates.some((fieldState) => {
    const uncertainty = fieldState.field_uncertainty || {};
    return fieldState.conflicts
      && fieldState.ambiguity
      && Number(uncertainty.conflict_intensity || 0) >= mergedOptions.abstainConflictIntensityThreshold;
  });
  const highConfidenceAnchor = fieldStates.some((fieldState) => hasHighConfidenceAnchor(fieldState, mergedOptions.highConfidenceThreshold));

  if (criticalAmbiguousCount >= 1 || unresolvedSevereConflict || unresolvedHighUncertaintyConflict || !highConfidenceAnchor) {
    return identityStatuses.ABSTAIN;
  }

  const hasConflict = conflictMap.length > 0 || fieldStates.some((fieldState) => fieldState.conflicts);
  const allCriticalConfirmed = fieldStates
    .filter((fieldState) => criticalFields.has(fieldState.field))
    .every((fieldState) => hasResolvedValue(fieldState) && Number(fieldState.resolution_confidence || 0) >= mergedOptions.confirmedConfidenceThreshold && !fieldState.conflicts);

  return !hasConflict && allCriticalConfirmed ? identityStatuses.CONFIRMED : identityStatuses.RESOLVED;
}

export function routeAmbiguity(args = {}) {
  const status = routeIdentityStatus(args);
  return status === identityStatuses.ABSTAIN ? ambiguityStatuses.AMBIGUOUS : status;
}
