import { createEvidenceField, createVisionSource, normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { runRetrieval } from "../retrieval/retrieval-engine.mjs";
import { rankRetrievalCandidates } from "../retrieval/candidate-matcher.mjs";
import { retrievalModes } from "../retrieval/retrieval-contract.mjs";
import { verifyRetrievalCandidates } from "./candidate-verifier.mjs";
import { createCompletionState, completionResolutionStates } from "./completion-state.mjs";
import {
  completionActions,
  retrievalFamiliesByAction,
  chooseNextBestAction,
  hasAttemptedAction
} from "./next-best-action.mjs";
import {
  createResolutionBudget,
  consumeResolutionBudget,
  remainingResolutionBudget,
  isResolutionBudgetExhausted
} from "./resolution-budget.mjs";
import { deriveRouteFromCompletionState, completionReasonForRoute } from "./completion-policy.mjs";
import { createCompletionTraceEntry, completionAttemptFromTrace } from "./resolution-trace.mjs";
import { appendConvergenceToTrace, buildConvergenceReport } from "./convergence-loop.mjs";
import { isMissingValue, normalizeFieldValue } from "../../identity-resolution/normalizer.mjs";
import { splitParallelDescriptor } from "../../identity-resolution/parallel-taxonomy.mjs";

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });

  return result;
}

function emptyRetrievalSummary(mode = retrievalModes.AUTO) {
  return {
    mode,
    providers_used: [],
    queries: [],
    sources: [],
    selected_candidate: null,
    candidate_margin: 0,
    candidate_selection_threshold: null,
    low_margin_conflict: null,
    conflicts: [],
    unavailable: [],
    trace: []
  };
}

function mergeRetrievalSummaries(current, next) {
  if (!next) return current;
  const sourceInputs = next.selection_rechecked
    ? [...(next.sources || []), ...(current.sources || [])]
    : [...(current.sources || []), ...(next.sources || [])];
  const sources = uniqueBy(
    sourceInputs,
    (candidate) => candidate.candidate_id || candidate.source_url || JSON.stringify(candidate.fields || {})
  );
  const selectedCandidate = next.selection_rechecked
    ? next.selected_candidate || null
    : next.selected_candidate || current.selected_candidate || null;

  return {
    mode: next.mode || current.mode,
    providers_used: [...new Set([...(current.providers_used || []), ...(next.providers_used || [])])],
    queries: [...(current.queries || []), ...(next.queries || [])],
    sources,
    selected_candidate: selectedCandidate,
    candidate_margin: Math.max(Number(current.candidate_margin || 0), Number(next.candidate_margin || 0)),
    candidate_selection_threshold: next.candidate_selection_threshold || current.candidate_selection_threshold || null,
    low_margin_conflict: next.low_margin_conflict || current.low_margin_conflict || null,
    conflicts: [...(current.conflicts || []), ...(next.conflicts || [])],
    unavailable: [...(current.unavailable || []), ...(next.unavailable || [])],
    trace: [...(current.trace || []), ...(next.trace || [])],
    selection_rechecked: Boolean(next.selection_rechecked || current.selection_rechecked)
  };
}

function actionIsRetrieval(action) {
  return Array.isArray(retrievalFamiliesByAction[action]);
}

function actionIsCandidateVerification(action) {
  return action === completionActions.VERIFY_CANDIDATE;
}

function actionUsesExternalQueryBudget(action) {
  return ![
    completionActions.SEARCH_INTERNAL_APPROVED_HISTORY,
    completionActions.SEARCH_INTERNAL_REGISTRY
  ].includes(action);
}

function actionNeedsAgnesCall(action) {
  return action === completionActions.AGNES_FOCUSED_RECHECK;
}

const focusedFieldsByAction = Object.freeze({
  [completionActions.RE_READ_FRONT]: [],
  [completionActions.RE_READ_BACK]: [],
  [completionActions.READ_ALTERNATE_VIEW]: [],
  [completionActions.CROP_AND_READ_SUBJECT]: ["players", "character", "rc", "first_bowman"],
  [completionActions.CROP_AND_READ_SERIAL]: ["serial_number"],
  [completionActions.CROP_AND_READ_CARD_CODE]: ["collector_number", "checklist_code"],
  [completionActions.CROP_AND_READ_GRADE_LABEL]: ["grade_company", "card_grade", "auto_grade", "grade_type"],
  [completionActions.CROP_AND_READ_YEAR_PRODUCT]: ["year", "brand", "product", "set", "subset", "rc", "first_bowman"],
  [completionActions.CROP_AND_READ_PARALLEL]: ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "ssp", "case_hit"],
  [completionActions.TRY_ALTERNATIVE_OCR]: [],
  [completionActions.AGNES_FOCUSED_RECHECK]: []
});

const parallelFocusedRecoveryOrder = Object.freeze([
  completionActions.CROP_AND_READ_SERIAL,
  completionActions.CROP_AND_READ_PARALLEL,
  completionActions.CROP_AND_READ_YEAR_PRODUCT,
  completionActions.CROP_AND_READ_SUBJECT,
  completionActions.CROP_AND_READ_GRADE_LABEL,
  completionActions.CROP_AND_READ_CARD_CODE
]);

const proactiveFocusedRecoveryOrder = Object.freeze([
  completionActions.CROP_AND_READ_SERIAL,
  completionActions.CROP_AND_READ_PARALLEL,
  completionActions.CROP_AND_READ_YEAR_PRODUCT,
  completionActions.CROP_AND_READ_SUBJECT,
  completionActions.CROP_AND_READ_GRADE_LABEL,
  completionActions.CROP_AND_READ_CARD_CODE
]);

const requiredFocusedActionByFieldGroup = Object.freeze({
  serial_number: completionActions.CROP_AND_READ_SERIAL,
  parallel: completionActions.CROP_AND_READ_PARALLEL,
  year_product: completionActions.CROP_AND_READ_YEAR_PRODUCT,
  grade_label: completionActions.CROP_AND_READ_GRADE_LABEL,
  card_code: completionActions.CROP_AND_READ_CARD_CODE
});

function plannedVisionRecovery(action) {
  return [
    completionActions.RE_READ_FRONT,
    completionActions.RE_READ_BACK,
    completionActions.READ_ALTERNATE_VIEW,
    completionActions.CROP_AND_READ_SUBJECT,
    completionActions.CROP_AND_READ_SERIAL,
    completionActions.CROP_AND_READ_CARD_CODE,
    completionActions.CROP_AND_READ_GRADE_LABEL,
    completionActions.CROP_AND_READ_YEAR_PRODUCT,
    completionActions.CROP_AND_READ_PARALLEL,
    completionActions.TRY_ALTERNATIVE_OCR,
    completionActions.AGNES_FOCUSED_RECHECK
  ].includes(action);
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function focusFieldsForAction(action, state = {}) {
  const configured = focusedFieldsByAction[action] || [];
  if (configured.length) return configured;

  return uniqueValues([
    ...(state.missing_fields || []),
    ...(state.weak_fields || []),
    ...(state.conflicting_fields || [])
  ]);
}

function fieldHasValue(fieldName, value) {
  if (fieldName === "players") return Array.isArray(value) && value.length > 0;
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function normalizedComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).join("|");
  }
  return String(value ?? "").trim().toLowerCase();
}

function evidenceValueForField(fieldName, focusedDocument = {}) {
  const evidenceValue = focusedDocument.evidence?.[fieldName]?.value;
  if (fieldHasValue(fieldName, evidenceValue)) return evidenceValue;
  return focusedDocument.resolved?.[fieldName];
}

function focusedRawValueForField(fieldName, focusedDocument = {}) {
  const focusedResolved = normalizeResolvedFields(focusedDocument.resolved || {});
  if (fieldHasValue(fieldName, focusedDocument.resolved?.[fieldName])) return focusedDocument.resolved[fieldName];
  if (fieldHasValue(fieldName, focusedResolved[fieldName])) return focusedResolved[fieldName];
  return evidenceValueForField(fieldName, focusedDocument);
}

function normalizedFocusedValue(fieldName, value) {
  const normalized = normalizeFieldValue(fieldName, value);
  if (isMissingValue(normalized)) {
    return {
      ok: false,
      value: null,
      reason: "invalid_or_empty_focused_value"
    };
  }

  return {
    ok: true,
    value: normalized,
    reason: null
  };
}

function sourceForFocusedField(fieldName, value, focusedDocument = {}, action) {
  const existingSources = focusedDocument.evidence?.[fieldName]?.sources;
  const focusedSource = createVisionSource({
    imageId: focusedDocument.image_id || focusedDocument.imageId || null,
    captureRole: "focused_reread",
    region: action,
    observedText: Array.isArray(value) ? value.join(" / ") : String(value ?? ""),
    trustTier: 2
  });
  if (Array.isArray(existingSources) && existingSources.length) {
    return uniqueSources([...existingSources, focusedSource]);
  }

  return [
    focusedSource
  ];
}

function sourceKey(source = {}) {
  return [
    source.source_type || source.source || "",
    source.side || "",
    source.capture_role || "",
    source.region || "",
    source.observed_text || "",
    source.image_id || source.imageId || ""
  ].join("|");
}

function uniqueSources(sources = []) {
  return uniqueBy(sources.filter(Boolean), sourceKey);
}

function highRiskVisualDescriptorField(fieldName) {
  return [
    "parallel_exact",
    "parallel",
    "variation",
    "ssp",
    "case_hit"
  ].includes(fieldName);
}

function descriptorMergeField(fieldName) {
  return ["parallel_exact", "parallel", "variation"].includes(fieldName);
}

function descriptorWords(value) {
  return normalizedComparableValue(value)
    .replace(/\//g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function descriptorPhraseContains(container, contained) {
  const containerWords = descriptorWords(container);
  const containedWords = descriptorWords(contained);
  if (!containerWords.length || !containedWords.length) return false;
  return containedWords.every((word) => containerWords.includes(word));
}

function descriptorValuesCompatible(fieldName, left, right) {
  if (!descriptorMergeField(fieldName)) return false;
  const leftKey = normalizedComparableValue(left);
  const rightKey = normalizedComparableValue(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey
    || descriptorPhraseContains(left, right)
    || descriptorPhraseContains(right, left);
}

function moreSpecificDescriptorValue(left, right) {
  const leftWords = descriptorWords(left);
  const rightWords = descriptorWords(right);
  if (rightWords.length > leftWords.length) return right;
  if (leftWords.length > rightWords.length) return left;
  return normalizedComparableValue(right).length > normalizedComparableValue(left).length ? right : left;
}

function focusedUnresolvedText(fieldName, focusedField = {}, focusedDocument = {}) {
  return [
    focusedField.unresolved_reason,
    ...(Array.isArray(focusedDocument.unresolved) ? focusedDocument.unresolved : [])
  ]
    .map((item) => String(item || "").toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function focusedFieldHasReviewBlocker(fieldName, focusedField = {}, focusedDocument = {}) {
  const text = focusedUnresolvedText(fieldName, focusedField, focusedDocument);
  if (!text) return false;
  const fieldAliases = ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"].includes(fieldName)
    ? ["parallel", "variation", "color", "foil", "refractor", "prizm"]
    : [fieldName.replace(/_/g, " ")];
  const mentionsField = fieldAliases.some((alias) => text.includes(alias));
  const hasBlocker = /review|operator|manual|uncertain|unreadable|weak|glare|lighting|sleeve|background|guess|conflict|not visible|not readable|requires/.test(text);
  return mentionsField && hasBlocker;
}

function focusedPublishEvidenceFloor({
  fieldName,
  focusedField = {},
  focusedDocument = {},
  action,
  confidence
} = {}) {
  if (action !== completionActions.CROP_AND_READ_PARALLEL) return null;
  if (!["surface_color", "parallel_family"].includes(fieldName)) return null;
  if (focusedFieldHasReviewBlocker(fieldName, focusedField, focusedDocument)) return null;
  if (Number(confidence || 0) < 0.78) return null;
  return {
    status: "CONFIRMED",
    confidence: Math.max(Number(confidence || 0), 0.86),
    reason: "focused_parallel_reread_surface_fact_without_review_blocker"
  };
}

function focusedCandidatesWithFloor({
  focusedField = {},
  focusedValue,
  focusedSources = [],
  confidence
} = {}) {
  const rawCandidates = Array.isArray(focusedField.candidates) && focusedField.candidates.length
    ? focusedField.candidates
    : [{ value: focusedValue, confidence }];
  return rawCandidates.map((candidate) => {
    const valuesMatch = normalizedComparableValue(candidate.value) === normalizedComparableValue(focusedValue);
    return {
      ...candidate,
      confidence: valuesMatch ? Math.max(Number(candidate.confidence || 0), Number(confidence || 0)) : candidate.confidence,
      sources: valuesMatch ? uniqueSources([...(candidate.sources || []), ...focusedSources]) : candidate.sources
    };
  });
}

function mergeAgreementField({
  fieldName,
  currentField = {},
  currentValue,
  focusedField = {},
  focusedValue,
  focusedDocument = {},
  action
}) {
  const focusedSources = sourceForFocusedField(fieldName, focusedValue, focusedDocument, action);
  const sources = uniqueSources([
    ...(Array.isArray(currentField.sources) ? currentField.sources : []),
    ...focusedSources
  ]);
  const rawConfidence = Math.max(Number(currentField.confidence || 0), Number(focusedField.confidence || 0), 0.5);
  const publishFloor = focusedPublishEvidenceFloor({
    fieldName,
    focusedField,
    focusedDocument,
    action,
    confidence: rawConfidence
  });
  const confidence = publishFloor?.confidence ?? rawConfidence;
  const explicitConfirmed = ["CONFIRMED", "MANUAL_CONFIRMED", "NOT_APPLICABLE"].includes(currentField.status)
    || ["CONFIRMED", "MANUAL_CONFIRMED", "NOT_APPLICABLE"].includes(focusedField.status);
  const status = explicitConfirmed
    || publishFloor?.status === "CONFIRMED"
    || (!highRiskVisualDescriptorField(fieldName) && confidence >= 0.86)
    ? "CONFIRMED"
    : "REVIEW";

  return createEvidenceField({
    value: currentValue,
    normalizedValue: currentValue,
    status,
    confidence,
    candidates: [
      ...(Array.isArray(currentField.candidates) ? currentField.candidates : []),
      ...(Array.isArray(focusedField.candidates) ? focusedField.candidates : []),
      { value: focusedValue, confidence: publishFloor?.confidence ?? Number(focusedField.confidence || confidence), sources: focusedSources }
    ],
    sources,
    conflicts: [
      ...(Array.isArray(currentField.conflicts) ? currentField.conflicts : []),
      ...(Array.isArray(focusedField.conflicts) ? focusedField.conflicts : [])
    ],
    unresolvedReason: publishFloor ? null : currentField.unresolved_reason || focusedField.unresolved_reason || null
  });
}

function createConflictField({
  fieldName,
  currentField,
  currentValue,
  focusedField,
  focusedValue,
  focusedDocument,
  action
}) {
  return createEvidenceField({
    value: currentValue,
    normalizedValue: currentValue,
    status: "CONFLICT",
    confidence: Math.max(Number(currentField?.confidence || 0), Number(focusedField?.confidence || 0), 0.5),
    candidates: [
      { value: currentValue, confidence: Number(currentField?.confidence || 0.5) },
      { value: focusedValue, confidence: Number(focusedField?.confidence || 0.5) }
    ],
    sources: [
      ...(Array.isArray(currentField?.sources) ? currentField.sources : []),
      ...sourceForFocusedField(fieldName, focusedValue, focusedDocument, action)
    ],
    conflicts: [
      ...(Array.isArray(currentField?.conflicts) ? currentField.conflicts : []),
      {
        source_type: "VISION_MODEL",
        action,
        current_value: currentValue,
        focused_value: focusedValue,
        reason: "focused_reread_conflicts_with_existing_value"
      }
    ],
    unresolvedReason: "focused_reread_conflict"
  });
}

function focusedParallelDerivedEntries(fieldName, focusedDocument = {}) {
  const rawValue = focusedRawValueForField(fieldName, focusedDocument);
  if (!fieldHasValue(fieldName, rawValue)) return [];
  const descriptor = splitParallelDescriptor(rawValue);
  return [
    descriptor.surface_color
      ? {
          fieldName: "surface_color",
          rawFocusedValue: descriptor.surface_color,
          sourceFieldName: fieldName,
          derivedFrom: fieldName
        }
      : null,
    descriptor.parallel_family
      ? {
          fieldName: "parallel_family",
          rawFocusedValue: descriptor.parallel_family,
          sourceFieldName: fieldName,
          derivedFrom: fieldName
        }
      : null
  ].filter(Boolean);
}

function focusedFieldEntries(focusFields = [], focusedDocument = {}, action) {
  const entries = [];

  for (const fieldName of focusFields) {
    if (action === completionActions.CROP_AND_READ_PARALLEL && ["parallel", "variation"].includes(fieldName)) {
      entries.push(...focusedParallelDerivedEntries(fieldName, focusedDocument));
      continue;
    }
    entries.push({
      fieldName,
      rawFocusedValue: focusedRawValueForField(fieldName, focusedDocument),
      sourceFieldName: fieldName,
      derivedFrom: null
    });
  }

  return uniqueBy(entries, (entry) => `${entry.fieldName}:${normalizedComparableValue(entry.rawFocusedValue)}`);
}

function mergeFocusedVisionEvidence({
  resolved,
  evidence,
  focusedVision,
  focusFields,
  action
}) {
  const focusedDocument = focusedVision?.evidence_document || focusedVision?.document || focusedVision || {};
  const nextResolved = { ...resolved };
  const nextEvidence = { ...evidence };
  const updatedFields = [];
  const conflictingFields = [];
  const rejectedFields = [];
  const fieldValues = {};

  for (const entry of focusedFieldEntries(focusFields, focusedDocument, action)) {
    const { fieldName, rawFocusedValue, sourceFieldName, derivedFrom } = entry;
    if (!fieldHasValue(fieldName, rawFocusedValue)) continue;
    const normalized = normalizedFocusedValue(fieldName, rawFocusedValue);
    if (!normalized.ok) {
      rejectedFields.push({
        field: fieldName,
        derived_from: derivedFrom,
        reason: normalized.reason,
        value: String(rawFocusedValue ?? "").slice(0, 120)
      });
      continue;
    }
    const focusedValue = normalized.value;
    fieldValues[fieldName] = focusedValue;

    const currentValue = nextResolved[fieldName];
    const currentField = nextEvidence[fieldName];
    const focusedField = focusedDocument.evidence?.[fieldName] || focusedDocument.evidence?.[sourceFieldName];
    const currentHasValue = fieldHasValue(fieldName, currentValue);
    const currentIsConfirmed = ["CONFIRMED", "MANUAL_CONFIRMED", "NOT_APPLICABLE"].includes(currentField?.status);
    const valuesMatch = currentHasValue && normalizedComparableValue(currentValue) === normalizedComparableValue(focusedValue);

    if (currentHasValue && valuesMatch) {
      nextResolved[fieldName] = currentValue;
      nextEvidence[fieldName] = mergeAgreementField({
        fieldName,
        currentField,
        currentValue,
        focusedField,
        focusedValue,
        focusedDocument,
        action
      });
      updatedFields.push(fieldName);
      continue;
    }

    if (currentHasValue && descriptorValuesCompatible(fieldName, currentValue, focusedValue)) {
      const selectedValue = moreSpecificDescriptorValue(currentValue, focusedValue);
      nextResolved[fieldName] = selectedValue;
      nextEvidence[fieldName] = mergeAgreementField({
        fieldName,
        currentField,
        currentValue: selectedValue,
        focusedField,
        focusedValue,
        focusedDocument,
        action
      });
      updatedFields.push(fieldName);
      continue;
    }

    if (!currentHasValue || !currentIsConfirmed) {
      const focusedSources = sourceForFocusedField(fieldName, focusedValue, focusedDocument, action);
      const focusedConfidence = Number(focusedField?.confidence || 0.78);
      const canReuseFocusedField = focusedField && sourceFieldName === fieldName;
      const publishFloor = focusedPublishEvidenceFloor({
        fieldName,
        focusedField,
        focusedDocument,
        action,
        confidence: focusedConfidence
      });
      nextResolved[fieldName] = focusedValue;
      nextEvidence[fieldName] = canReuseFocusedField
        ? {
            ...focusedField,
            value: focusedValue,
            normalized_value: focusedValue,
            status: publishFloor?.status || focusedField.status,
            confidence: publishFloor?.confidence ?? focusedField.confidence,
            candidates: publishFloor
              ? focusedCandidatesWithFloor({
                  focusedField,
                  focusedValue,
                  focusedSources,
                  confidence: publishFloor.confidence
                })
              : focusedField.candidates,
            sources: focusedSources,
            unresolved_reason: publishFloor ? null : focusedField.unresolved_reason || null
          }
        : createEvidenceField({
            value: focusedValue,
            normalizedValue: focusedValue,
            status: publishFloor?.status || "REVIEW",
            confidence: publishFloor?.confidence ?? focusedConfidence,
            sources: focusedSources
          });
      updatedFields.push(fieldName);
      continue;
    }

    nextEvidence[fieldName] = createConflictField({
      fieldName,
      currentField,
      currentValue,
      focusedField,
      focusedValue,
      focusedDocument,
      action
    });
    conflictingFields.push(fieldName);
  }

  return {
    resolved: normalizeResolvedFields(nextResolved),
    evidence: nextEvidence,
    summary: {
      provider_id: focusedVision?.provider_id || focusedVision?.provider || null,
      model_id: focusedVision?.model_id || null,
      focus_fields: focusFields,
      updated_fields: uniqueValues(updatedFields),
      conflicting_fields: uniqueValues(conflictingFields),
      rejected_fields: rejectedFields,
      field_values: fieldValues
    }
  };
}

function retrievalInformationGain(retrieval) {
  const candidateCount = retrieval?.sources?.length || 0;
  if (retrieval?.selected_candidate) return Math.min(0.9, 0.45 + candidateCount * 0.04);
  if (candidateCount > 0) return Math.min(0.62, candidateCount * 0.08);
  return 0;
}

function traceOutputForRetrieval(retrieval) {
  return {
    provider_ids: retrieval.providers_used || [],
    query_ids: (retrieval.queries || []).map((query) => query.query_id),
    candidate_count: retrieval.sources?.length || 0,
    selected_candidate_id: retrieval.selected_candidate?.candidate_id || null,
    candidate_margin: retrieval.candidate_margin ?? 0,
    conflicts: retrieval.conflicts || [],
    low_margin_conflict: retrieval.low_margin_conflict || null,
    unavailable: retrieval.unavailable || []
  };
}

function technicalFailureReason(reason = "") {
  const normalized = String(reason || "").toLowerCase();
  if (!normalized) return false;
  if (/not configured|disabled|provider_not_registered|no_applicable_query|no_information|budget is exhausted/.test(normalized)) {
    return false;
  }
  return /error|timeout|rate_limited|unauthorized|server|failed|fetch/.test(normalized);
}

function transientFocusedVisionError(error = {}) {
  const reason = [
    error.code,
    error.name,
    error.message,
    error.cause?.code,
    error.cause?.message
  ].filter(Boolean).join(" ").toLowerCase();
  return /timeout|timed out|rate.?limit|econnreset|socket|network|fetch|temporar|overload|5\d\d|server/.test(reason);
}

function focusedVisionAttemptLimit(env = {}, remaining = {}) {
  const retries = numberFromEnv(
    env.AGNES_FOCUSED_VISION_RETRIES
      ?? env.FOCUSED_VISION_TRANSIENT_RETRIES
      ?? env.AGNES_SUPABASE_FEEDBACK_RATE_LIMIT_RETRIES,
    1
  );
  return Math.max(1, Math.min(Number(remaining.agnes_calls || 1), 1 + retries));
}

function retrievalTechnicalFailures(retrieval = {}) {
  const failures = [];

  (retrieval.trace || []).forEach((entry) => {
    if (entry?.status === "error" || technicalFailureReason(entry?.reason || entry?.error_code)) {
      failures.push({
        provider_id: entry.provider_id || null,
        query_id: entry.query_id || entry.query?.query_id || null,
        reason: entry.reason || entry.error_code || "retrieval_error"
      });
    }
  });

  (retrieval.unavailable || []).forEach((item) => {
    if (technicalFailureReason(item.reason)) {
      failures.push({
        provider_id: item.provider_id || null,
        query_id: item.query_id || null,
        reason: item.reason
      });
    }
  });

  return uniqueBy(failures, (failure) => [
    failure.provider_id || "",
    failure.query_id || "",
    failure.reason || ""
  ].join("|"));
}

function candidateConflicts(candidates = []) {
  return candidates
    .filter((candidate) => Array.isArray(candidate.conflicting_fields) && candidate.conflicting_fields.length)
    .map((candidate) => ({
      type: "CANDIDATE_FIELD_CONFLICT",
      candidate_id: candidate.candidate_id || null,
      fields: candidate.conflicting_fields,
      conflicts: candidate.conflicts || []
    }));
}

function retrievalSummaryFromCandidateCards({
  candidates = [],
  resolved = {},
  mode = retrievalModes.AUTO
} = {}) {
  const ranked = rankRetrievalCandidates(candidates, resolved);
  const conflicts = [
    ...(ranked.low_margin_conflict ? [ranked.low_margin_conflict] : []),
    ...candidateConflicts(ranked.candidates)
  ];

  return {
    mode,
    providers_used: [...new Set(ranked.candidates.map((candidate) => candidate.provider_id).filter(Boolean))],
    queries: [],
    sources: ranked.candidates,
    selected_candidate: ranked.selected_candidate,
    candidate_margin: ranked.candidate_margin,
    candidate_selection_threshold: ranked.candidate_selection_threshold,
    low_margin_conflict: ranked.low_margin_conflict,
    conflicts,
    unavailable: [],
    trace: [],
    selection_rechecked: true
  };
}

function completionTraceTechnicalFailures(trace = []) {
  return (trace || [])
    .filter((entry) => entry?.status === "error" || technicalFailureReason(entry?.reason))
    .map((entry) => ({
      action: entry.action || null,
      reason: entry.reason || "completion_error",
      provider_ids: entry.output?.provider_ids || [],
      query_ids: entry.output?.query_ids || []
    }));
}

function appendCandidateVerification(traceEntry, verification) {
  if (!verification?.summary) return traceEntry;
  return {
    ...traceEntry,
    output: {
      ...(traceEntry.output || {}),
      candidate_verification: verification.summary
    }
  };
}

function appendFocusedVisionSummary(traceEntry, focusedMerge) {
  if (!focusedMerge?.summary) return traceEntry;
  return {
    ...traceEntry,
    output: {
      ...(traceEntry.output || {}),
      focused_vision: focusedMerge.summary
    }
  };
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parallelFocusedRereadsEnabled(env = process.env) {
  return env.ENABLE_PARALLEL_FOCUSED_REREADS !== "0"
    && env.ENABLE_PARALLEL_AGNES_FOCUSED_REREADS !== "0";
}

function proactiveFocusedRereadsEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env.ENABLE_PROACTIVE_FOCUSED_REREADS || "").trim().toLowerCase())
    || ["1", "true", "yes", "on"].includes(String(env.ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS || "").trim().toLowerCase());
}

function proactiveSerialOnlyEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env.ENABLE_PROACTIVE_SERIAL_ONLY || "").trim().toLowerCase())
    || ["1", "true", "yes", "on"].includes(String(env.ENABLE_PROACTIVE_AGNES_SERIAL_ONLY || "").trim().toLowerCase());
}

function splitEnvList(value) {
  return String(value || "")
    .split(/[\s,|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredFocusedActionsFromEnv(env = process.env) {
  const fieldGroups = splitEnvList(env.CASCADE_SECONDARY_VERIFICATION_FIELDS || env.REQUIRED_FOCUSED_FIELDS);
  const explicitActions = splitEnvList(env.REQUIRED_FOCUSED_ACTIONS);
  return uniqueValues([
    ...fieldGroups.map((fieldGroup) => requiredFocusedActionByFieldGroup[fieldGroup]).filter(Boolean),
    ...explicitActions.filter((action) => plannedVisionRecovery(action))
  ]);
}

function focusedActionHasStateGap(action, state = {}) {
  const fields = focusFieldsForAction(action, state);
  const gaps = new Set([
    ...(state.missing_fields || []),
    ...(state.weak_fields || []),
    ...(state.conflicting_fields || [])
  ]);
  if (fields.some((field) => gaps.has(field))) return true;

  const regions = new Set((state.critical_region_occlusion || []).map((item) => item.region).filter(Boolean));
  if (action === completionActions.CROP_AND_READ_SUBJECT && regions.has("subject_name")) return true;
  if (action === completionActions.CROP_AND_READ_YEAR_PRODUCT && regions.has("year_product")) return true;
  if (action === completionActions.CROP_AND_READ_PARALLEL && (regions.has("parallel") || regions.has("variation") || regions.has("color"))) return true;
  if (action === completionActions.CROP_AND_READ_SERIAL && regions.has("serial_number")) return true;
  if (action === completionActions.CROP_AND_READ_CARD_CODE && (regions.has("collector_number") || regions.has("checklist_code"))) return true;
  if (action === completionActions.CROP_AND_READ_GRADE_LABEL && regions.has("grade_label")) return true;

  return false;
}

function plannedParallelFocusedActions({
  state = {},
  resolved = {},
  attemptedActions = [],
  budget,
  env = process.env
} = {}) {
  if (!parallelFocusedRereadsEnabled(env)) return [];
  const stateHasGap = state.resolution_state !== completionResolutionStates.EVIDENCE_CLOSED;
  if (!stateHasGap && !proactiveFocusedRereadsEnabled(env)) return [];
  const remaining = remainingResolutionBudget(budget);
  const maxParallel = Math.min(
    remaining.agnes_calls,
    numberFromEnv(env.MAX_PARALLEL_FOCUSED_REREADS, 3)
  );
  if (maxParallel <= 0) return [];

  const requiredActions = requiredFocusedActionsFromEnv(env)
    .filter((action) => parallelFocusedRecoveryOrder.includes(action));
  const gapActions = stateHasGap
    ? parallelFocusedRecoveryOrder.filter((action) => focusedActionHasStateGap(action, state))
    : [];
  const proactiveActions = proactiveFocusedRereadsEnabled(env)
    ? proactiveSerialOnlyEnabled(env)
      ? fieldHasValue("serial_number", resolved.serial_number)
        ? [completionActions.CROP_AND_READ_SERIAL]
        : []
      : proactiveFocusedRecoveryOrder
    : [];
  const planned = requiredActions.length
    ? requiredActions
    : uniqueValues([
        ...gapActions,
        ...proactiveActions.filter((action) => !gapActions.includes(action))
      ]);

  return planned
    .filter((action) => !hasAttemptedAction(attemptedActions, action))
    .slice(0, maxParallel);
}

async function executeParallelFocusedRereads({
  actions = [],
  state,
  resolved,
  evidence,
  captureQuality = {},
  unresolved = [],
  env,
  retrievalMode,
  providerRegistry,
  cache,
  sourcePolicy,
  budget,
  runRetrievalImpl,
  runFocusedVisionImpl
} = {}) {
  const executions = await Promise.all(actions.map((action) => executeCompletionAction({
    action,
    state,
    resolved,
    evidence,
    env,
    retrievalMode,
    providerRegistry,
    cache,
    sourcePolicy,
    budget,
    runRetrievalImpl,
    runFocusedVisionImpl
  })));
  let currentResolved = resolved;
  let currentEvidence = evidence;
  const traces = [];
  const attempts = [];
  const budgetUse = {
    rounds: 0,
    agnesCalls: 0,
    resolutionTimeMs: 0,
    estimatedCostUsd: 0
  };

  executions.forEach((execution, index) => {
    const action = actions[index];
    let executionTrace = execution.trace;

    if (execution.focusedVision) {
      const focusedMerge = mergeFocusedVisionEvidence({
        resolved: currentResolved,
        evidence: currentEvidence,
        focusedVision: execution.focusedVision,
        focusFields: focusFieldsForAction(action, state),
        action
      });
      currentResolved = focusedMerge.resolved;
      currentEvidence = focusedMerge.evidence;
      executionTrace = appendFocusedVisionSummary(executionTrace, focusedMerge);
    }

    const nextState = createCompletionState({
      resolved: currentResolved,
      evidence: currentEvidence,
      captureQuality,
      unresolved,
      attemptedActions: state.attempted_actions || [],
      candidateCards: state.candidate_cards || []
    });
    executionTrace = appendConvergenceToTrace(executionTrace, {
      before: state,
      after: nextState,
      focusedFields: focusFieldsForAction(action, state)
    });

    traces.push(executionTrace);
    attempts.push(completionAttemptFromTrace(execution.trace));
    budgetUse.rounds += execution.budgetUse?.rounds || 0;
    budgetUse.agnesCalls += execution.budgetUse?.agnesCalls || 0;
    budgetUse.resolutionTimeMs = Math.max(budgetUse.resolutionTimeMs, execution.budgetUse?.resolutionTimeMs || 0);
    budgetUse.estimatedCostUsd = Number((budgetUse.estimatedCostUsd + Number(execution.budgetUse?.estimatedCostUsd || 0)).toFixed(6));
  });

  return {
    resolved: currentResolved,
    evidence: currentEvidence,
    traces,
    attempts,
    budgetUse
  };
}

async function executeCompletionAction({
  action,
  state,
  resolved,
  evidence,
  env,
  retrievalMode,
  providerRegistry,
  cache,
  sourcePolicy,
  budget,
  runRetrievalImpl,
  runFocusedVisionImpl
}) {
  const startedAt = Date.now();
  const remaining = remainingResolutionBudget(budget, startedAt);

  if (actionIsCandidateVerification(action)) {
    const retrieval = retrievalSummaryFromCandidateCards({
      candidates: state.candidate_cards || [],
      resolved,
      mode: retrievalMode
    });
    const endedAt = Date.now();
    const candidateCount = retrieval.sources?.length || 0;

    return {
      retrieval,
      trace: createCompletionTraceEntry({
        action,
        status: candidateCount ? "executed" : "no_information",
        reason: candidateCount
          ? "Existing retrieval candidates were re-scored against the current conflict state."
          : "No existing retrieval candidates were available for verification.",
        input: {
          conflicting_fields: state.conflicting_fields || [],
          candidate_count: candidateCount
        },
        output: {
          ...traceOutputForRetrieval(retrieval),
          information_gain: retrieval.selected_candidate ? 0.4 : candidateCount ? 0.12 : 0
        },
        startedAt,
        endedAt
      }),
      budgetUse: {
        rounds: 1,
        externalQueries: 0,
        retrievalTimeMs: 0,
        resolutionTimeMs: endedAt - budget.started_at_ms
      }
    };
  }

  if (actionIsRetrieval(action)) {
    const usesExternalBudget = actionUsesExternalQueryBudget(action);

    if ((usesExternalBudget && remaining.external_queries <= 0) || remaining.retrieval_time_ms <= 0) {
      const endedAt = Date.now();
      return {
        retrieval: null,
        trace: createCompletionTraceEntry({
          action,
          status: "unavailable",
          reason: "Retrieval query budget is exhausted.",
          startedAt,
          endedAt,
          output: { provider_ids: [], query_ids: [], candidate_count: 0 }
        }),
        budgetUse: {
          rounds: 1,
          externalQueries: 0,
          retrievalTimeMs: 0,
          resolutionTimeMs: endedAt - budget.started_at_ms
        }
      };
    }

    let retrieval;
    try {
      retrieval = await runRetrievalImpl({
        resolved,
        missingFields: state.missing_fields || [],
        weakFields: state.weak_fields || [],
        mode: retrievalMode,
        env,
        providerRegistry,
        cache,
        sourcePolicy,
        allowedFamilies: retrievalFamiliesByAction[action],
        maxQueries: usesExternalBudget ? Math.max(1, remaining.external_queries) : 1
      });
    } catch (error) {
      const endedAt = Date.now();
      return {
        retrieval: null,
        trace: createCompletionTraceEntry({
          action,
          status: "error",
          reason: error?.code || error?.message || "retrieval_error",
          input: {
            missing_fields: state.missing_fields || [],
            weak_fields: state.weak_fields || [],
            families: retrievalFamiliesByAction[action]
          },
          output: {
            provider_ids: [],
            query_ids: [],
            candidate_count: 0,
            technical_failure: true
          },
          startedAt,
          endedAt
        }),
        budgetUse: {
          rounds: 1,
          externalQueries: usesExternalBudget ? 1 : 0,
          retrievalTimeMs: endedAt - startedAt,
          resolutionTimeMs: endedAt - budget.started_at_ms
        }
      };
    }
    const endedAt = Date.now();
    const candidateCount = retrieval.sources?.length || 0;
    const technicalFailures = retrievalTechnicalFailures(retrieval);
    const status = candidateCount > 0
      ? "executed"
      : technicalFailures.length
        ? "error"
        : retrieval.unavailable?.length
        ? "unavailable"
        : retrieval.queries?.length
          ? "no_information"
          : "no_applicable_query";

    return {
      retrieval,
      trace: createCompletionTraceEntry({
        action,
        status,
        reason: candidateCount > 0
          ? "Retrieval returned candidate evidence for review."
          : "Retrieval did not produce candidate evidence.",
        input: {
          missing_fields: state.missing_fields || [],
          weak_fields: state.weak_fields || [],
          families: retrievalFamiliesByAction[action]
        },
        output: {
          ...traceOutputForRetrieval(retrieval),
          information_gain: retrievalInformationGain(retrieval),
          ...(technicalFailures.length ? { technical_failures: technicalFailures } : {})
        },
        startedAt,
        endedAt
      }),
      budgetUse: {
        rounds: 1,
        externalQueries: usesExternalBudget ? retrieval.queries?.length || 0 : 0,
        retrievalTimeMs: endedAt - startedAt,
        resolutionTimeMs: endedAt - budget.started_at_ms
      }
    };
  }

  if (actionNeedsAgnesCall(action) && remaining.agnes_calls <= 0) {
    const endedAt = Date.now();
    return {
      retrieval: null,
      trace: createCompletionTraceEntry({
        action,
        status: "unavailable",
        reason: "Primary-provider focused recheck budget is exhausted.",
        startedAt,
        endedAt
      }),
      budgetUse: {
        rounds: 1,
        agnesCalls: 0,
        resolutionTimeMs: endedAt - budget.started_at_ms
      }
    };
  }

  if (plannedVisionRecovery(action)) {
    const focusFields = focusFieldsForAction(action, state);

    if (typeof runFocusedVisionImpl === "function") {
      if (remaining.agnes_calls <= 0) {
        const endedAt = Date.now();
        return {
          retrieval: null,
          focusedVision: null,
          trace: createCompletionTraceEntry({
            action,
            status: "unavailable",
            reason: "Primary-provider focused recheck budget is exhausted.",
            input: {
              focus_fields: focusFields,
              missing_fields: state.missing_fields || [],
              weak_fields: state.weak_fields || [],
              occluded_regions: state.critical_region_occlusion || []
            },
            startedAt,
            endedAt
          }),
          budgetUse: {
            rounds: 1,
            agnesCalls: 0,
            resolutionTimeMs: endedAt - budget.started_at_ms
          }
        };
      }

      let focusedVision = null;
      let focusedAttempts = 0;
      let lastFocusedError = null;
      const maxFocusedAttempts = focusedVisionAttemptLimit(env, remaining);

      while (focusedAttempts < maxFocusedAttempts) {
        focusedAttempts += 1;
        try {
          focusedVision = await runFocusedVisionImpl({
            action,
            focusFields,
            state,
            resolved,
            evidence,
            env
          });
          lastFocusedError = null;
          break;
        } catch (error) {
          lastFocusedError = error;
          if (!transientFocusedVisionError(error) || focusedAttempts >= maxFocusedAttempts) break;
        }
      }

      if (!lastFocusedError) {
        const endedAt = Date.now();
        const providerId = focusedVision?.provider_id || focusedVision?.provider || "agnes";
        const focusedDocument = focusedVision?.evidence_document || focusedVision?.document || focusedVision || {};
        const returnedFields = focusFields.filter((fieldName) => {
          const value = focusedRawValueForField(fieldName, focusedDocument);
          return fieldHasValue(fieldName, value) && normalizedFocusedValue(fieldName, value).ok;
        });

        return {
          retrieval: null,
          focusedVision,
          trace: createCompletionTraceEntry({
            action,
            status: returnedFields.length ? "executed" : "no_information",
            reason: returnedFields.length
              ? "Primary provider returned focused reread evidence."
              : "Primary provider focused reread did not return requested field evidence.",
            input: {
              focus_fields: focusFields,
              missing_fields: state.missing_fields || [],
              weak_fields: state.weak_fields || [],
              occluded_regions: state.critical_region_occlusion || []
            },
            output: {
              provider_ids: [providerId],
              model_id: focusedVision?.model_id || null,
              returned_fields: returnedFields,
              information_gain: returnedFields.length ? 0.46 : 0,
              transient_retry_attempts: Math.max(0, focusedAttempts - 1)
            },
            startedAt,
            endedAt
          }),
          budgetUse: {
            rounds: 1,
            agnesCalls: focusedAttempts,
            resolutionTimeMs: endedAt - budget.started_at_ms,
            estimatedCostUsd: Number(focusedVision?.usage?.estimated_cost_usd || 0)
          }
        };
      } else {
        const endedAt = Date.now();
        return {
          retrieval: null,
          focusedVision: null,
          trace: createCompletionTraceEntry({
            action,
            status: "error",
            reason: lastFocusedError?.code || lastFocusedError?.message || "focused_vision_error",
            input: {
              focus_fields: focusFields,
              missing_fields: state.missing_fields || [],
              weak_fields: state.weak_fields || [],
              occluded_regions: state.critical_region_occlusion || []
            },
            output: {
              provider_ids: ["agnes"],
              candidate_count: 0,
              transient_retry_attempts: Math.max(0, focusedAttempts - 1),
              transient_failure: transientFocusedVisionError(lastFocusedError)
            },
            startedAt,
            endedAt
          }),
          budgetUse: {
            rounds: 1,
            agnesCalls: focusedAttempts,
            resolutionTimeMs: endedAt - budget.started_at_ms
          }
        };
      }
    }

    const endedAt = Date.now();
    return {
      retrieval: null,
      trace: createCompletionTraceEntry({
        action,
        status: "planned",
        reason: "Focused vision recovery is planned but not executed in this API layer yet.",
        input: {
          focus_fields: focusFields,
          missing_fields: state.missing_fields || [],
          weak_fields: state.weak_fields || [],
          occluded_regions: state.critical_region_occlusion || []
        },
        output: {
          information_gain: 0,
          provider_ids: [],
          query_ids: [],
          candidate_count: 0
        },
        startedAt,
        endedAt
      }),
      budgetUse: {
        rounds: 1,
        agnesCalls: 0,
        resolutionTimeMs: endedAt - budget.started_at_ms
      }
    };
  }

  const endedAt = Date.now();
  return {
    retrieval: null,
    trace: createCompletionTraceEntry({
      action,
      status: action === completionActions.REQUEST_TARGETED_RESCAN ? "requested" : "terminal",
      reason: action === completionActions.REQUEST_TARGETED_RESCAN
        ? "Targeted rescan is required for blocked critical image evidence."
        : "Manual route selected after automated evidence completion options.",
      input: {
        missing_fields: state.missing_fields || [],
        weak_fields: state.weak_fields || [],
        conflicting_fields: state.conflicting_fields || []
      },
      startedAt,
      endedAt
    }),
    budgetUse: {
      rounds: action === completionActions.ROUTE_TO_MANUAL ? 0 : 1,
      resolutionTimeMs: endedAt - budget.started_at_ms
    }
  };
}

export async function completeEvidence({
  resolved = {},
  evidence = {},
  captureQuality = {},
  unresolved = [],
  attemptedActions = [],
  retrievalMode = retrievalModes.AUTO,
  env = process.env,
  providerRegistry = null,
  cache = null,
  sourcePolicy = null,
  budgetOverrides = {},
  runRetrievalImpl = runRetrieval,
  runFocusedVisionImpl = null
} = {}) {
  const normalizedResolved = normalizeResolvedFields(resolved);
  let currentResolved = normalizedResolved;
  let currentEvidence = { ...(evidence || {}) };
  let budget = createResolutionBudget({ env, overrides: budgetOverrides });
  let retrieval = emptyRetrievalSummary(retrievalMode);
  let trace = [];
  let attempts = Array.isArray(attemptedActions) ? [...attemptedActions] : [];
  let state = createCompletionState({
    resolved: currentResolved,
    evidence: currentEvidence,
    captureQuality,
    unresolved,
    attemptedActions: attempts,
    candidateCards: retrieval.sources
  });

  if (state.resolution_state !== completionResolutionStates.EVIDENCE_CLOSED
    && !hasAttemptedAction(attempts, completionActions.SEARCH_INTERNAL_APPROVED_HISTORY)
    && !isResolutionBudgetExhausted(budget)) {
    const execution = await executeCompletionAction({
      action: completionActions.SEARCH_INTERNAL_APPROVED_HISTORY,
      state,
      resolved: currentResolved,
      evidence: currentEvidence,
      env,
      retrievalMode,
      providerRegistry,
      cache,
      sourcePolicy,
      budget,
      runRetrievalImpl,
      runFocusedVisionImpl
    });

    let executionTrace = execution.trace;
    if (execution.retrieval) {
      const verification = verifyRetrievalCandidates({
        resolved: currentResolved,
        evidence: currentEvidence,
        retrieval: execution.retrieval
      });
      currentResolved = verification.resolved;
      currentEvidence = verification.evidence;
      retrieval = mergeRetrievalSummaries(retrieval, execution.retrieval);
      executionTrace = appendCandidateVerification(executionTrace, verification);
    }

    const reevaluatedState = createCompletionState({
      resolved: currentResolved,
      evidence: currentEvidence,
      captureQuality,
      unresolved,
      attemptedActions: attempts,
      candidateCards: retrieval.sources
    });
    executionTrace = appendConvergenceToTrace(executionTrace, {
      before: state,
      after: reevaluatedState
    });
    trace.push(executionTrace);
    attempts.push(completionAttemptFromTrace(execution.trace));
    budget = consumeResolutionBudget(budget, {
      ...execution.budgetUse,
      rounds: 0
    });
    state = reevaluatedState;
  }

  if (typeof runFocusedVisionImpl === "function") {
    const parallelFocusedActions = plannedParallelFocusedActions({
      state,
      resolved: currentResolved,
      attemptedActions: attempts,
      budget,
      env
    });

    if (parallelFocusedActions.length) {
      const parallelRecovery = await executeParallelFocusedRereads({
        actions: parallelFocusedActions,
        state,
        resolved: currentResolved,
        evidence: currentEvidence,
        captureQuality,
        unresolved,
        env,
        retrievalMode,
        providerRegistry,
        cache,
        sourcePolicy,
        budget,
        runRetrievalImpl,
        runFocusedVisionImpl
      });
      currentResolved = parallelRecovery.resolved;
      currentEvidence = parallelRecovery.evidence;
      trace.push(...parallelRecovery.traces);
      attempts.push(...parallelRecovery.attempts);
      budget = consumeResolutionBudget(budget, parallelRecovery.budgetUse);
    }
  }

  while (!isResolutionBudgetExhausted(budget)) {
    state = createCompletionState({
      resolved: currentResolved,
      evidence: currentEvidence,
      captureQuality,
      unresolved,
      attemptedActions: attempts,
      candidateCards: retrieval.sources
    });

    const next = chooseNextBestAction({
      state,
      resolved: currentResolved,
      budget
    });
    state.next_best_action = next.action;
    state.estimated_information_gain = next.estimated_information_gain;

    if (!next.action || next.action === completionActions.ROUTE_TO_MANUAL) {
      const terminalTrace = createCompletionTraceEntry({
        action: next.action || null,
        status: next.action ? "terminal" : "complete",
        reason: next.reason,
        input: {
          missing_fields: state.missing_fields,
          weak_fields: state.weak_fields,
          conflicting_fields: state.conflicting_fields
        }
      });
      trace.push(terminalTrace);
      if (next.action) attempts.push(completionAttemptFromTrace(terminalTrace));
      break;
    }

    if (hasAttemptedAction(attempts, next.action)) break;

    const execution = await executeCompletionAction({
      action: next.action,
      state,
      resolved: currentResolved,
      evidence: currentEvidence,
      env,
      retrievalMode,
      providerRegistry,
      cache,
      sourcePolicy,
      budget,
      runRetrievalImpl,
      runFocusedVisionImpl
    });

    let executionTrace = execution.trace;
    if (execution.retrieval) {
      const verification = verifyRetrievalCandidates({
        resolved: currentResolved,
        evidence: currentEvidence,
        retrieval: execution.retrieval
      });
      currentResolved = verification.resolved;
      currentEvidence = verification.evidence;
      executionTrace = appendCandidateVerification(executionTrace, verification);
    }
    if (execution.focusedVision) {
      const focusedMerge = mergeFocusedVisionEvidence({
        resolved: currentResolved,
        evidence: currentEvidence,
        focusedVision: execution.focusedVision,
        focusFields: focusFieldsForAction(next.action, state),
        action: next.action
      });
      currentResolved = focusedMerge.resolved;
      currentEvidence = focusedMerge.evidence;
      executionTrace = appendFocusedVisionSummary(executionTrace, focusedMerge);
    }

    const nextRetrieval = mergeRetrievalSummaries(retrieval, execution.retrieval);
    const reevaluatedState = createCompletionState({
      resolved: currentResolved,
      evidence: currentEvidence,
      captureQuality,
      unresolved,
      attemptedActions: attempts,
      candidateCards: nextRetrieval.sources
    });
    executionTrace = appendConvergenceToTrace(executionTrace, {
      before: state,
      after: reevaluatedState,
      focusedFields: execution.focusedVision ? focusFieldsForAction(next.action, state) : []
    });

    trace.push(executionTrace);
    attempts.push(completionAttemptFromTrace(execution.trace));
    retrieval = nextRetrieval;
    budget = consumeResolutionBudget(budget, execution.budgetUse);

    if ([completionActions.REQUEST_TARGETED_RESCAN, completionActions.ROUTE_TO_MANUAL].includes(next.action)) {
      break;
    }
  }

  state = createCompletionState({
    resolved: currentResolved,
    evidence: currentEvidence,
    captureQuality,
    unresolved,
    attemptedActions: attempts,
    candidateCards: retrieval.sources
  });

  const targetedRescanRequested = hasAttemptedAction(attempts, completionActions.REQUEST_TARGETED_RESCAN);
  if (targetedRescanRequested && state.resolution_state !== completionResolutionStates.EVIDENCE_CLOSED) {
    state.resolution_state = completionResolutionStates.TARGETED_RESCAN_REQUIRED;
  } else if (isResolutionBudgetExhausted(budget) && state.resolution_state !== completionResolutionStates.EVIDENCE_CLOSED) {
    state.resolution_state = completionResolutionStates.BUDGET_EXHAUSTED;
  }

  const finalDecision = targetedRescanRequested && state.resolution_state === completionResolutionStates.TARGETED_RESCAN_REQUIRED
    ? {
        action: completionActions.REQUEST_TARGETED_RESCAN,
        estimated_information_gain: 0,
        reason: "Targeted rescan has been requested for blocked critical image evidence."
      }
    : chooseNextBestAction({
        state,
        resolved: currentResolved,
        budget
      });
  const technicalFailures = completionTraceTechnicalFailures(trace);
  state.next_best_action = finalDecision.action;
  state.estimated_information_gain = finalDecision.estimated_information_gain;

  if (finalDecision.action === completionActions.REQUEST_TARGETED_RESCAN) {
    state.resolution_state = completionResolutionStates.TARGETED_RESCAN_REQUIRED;
  } else if (
    finalDecision.action === completionActions.ROUTE_TO_MANUAL
    && state.resolution_state !== completionResolutionStates.BUDGET_EXHAUSTED
    && state.resolution_state !== completionResolutionStates.TARGETED_RESCAN_REQUIRED
  ) {
    state.resolution_state = completionResolutionStates.MANUAL_REQUIRED;
  }

  const route = deriveRouteFromCompletionState({
    state,
    nextBestAction: finalDecision.action,
    providerError: technicalFailures.length > 0
      && state.resolution_state !== completionResolutionStates.EVIDENCE_CLOSED
      && state.resolution_state !== completionResolutionStates.TARGETED_RESCAN_REQUIRED
  });

  return {
    resolved: currentResolved,
    evidence: currentEvidence,
    state,
    retrieval,
    resolution_trace: trace,
    convergence_report: buildConvergenceReport(trace, state),
    route,
    route_reason: completionReasonForRoute(route, state),
    technical_failures: technicalFailures,
    usage: {
      provider_calls: budget.used.agnes_calls,
      retrieval_calls: retrieval.queries.length,
      latency_ms: budget.used.resolution_time_ms,
      estimated_cost_usd: budget.used.estimated_cost_usd,
      resolution_rounds: budget.used.rounds
    },
    budget: {
      limits: budget.limits,
      used: budget.used,
      remaining: remainingResolutionBudget(budget)
    }
  };
}
