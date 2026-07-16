import { identityFieldNames } from "../../identity-resolution/types.mjs";
import { canonicalValueKey } from "../../identity-resolution/normalizer.mjs";
import { normalizeFields } from "../pipeline/field-normalization.mjs";
import { applyCandidateDecisionStage } from "./candidate-decision-stage.mjs";
import { fieldPermissions } from "./candidate-application-policy.mjs";

export const retrievalApplicationDecisions = Object.freeze({
  APPLY: "APPLY",
  SUPPORT: "SUPPORT",
  BLOCK: "BLOCK",
  REJECT: "REJECT"
});

export const retrievalApplicationSchemaVersion = "retrieval-application-v1";

const identityFields = new Set(identityFieldNames);
const denominatorFields = new Set([
  "numbered_to",
  "print_run_denominator",
  "serial_denominator",
  "expected_serial_denominator"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanId(value) {
  return cleanText(value);
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "" && value !== "UNKNOWN";
}

function normalizedResolvedSnapshot(result = {}) {
  const source = result.resolved_fields && typeof result.resolved_fields === "object"
    ? result.resolved_fields
    : result.resolved && typeof result.resolved === "object"
      ? result.resolved
      : result.fields && typeof result.fields === "object"
        ? result.fields
        : {};
  return normalizeFields(source);
}

function sourceForRow(row = {}) {
  const sourceType = cleanText(row.source_type).toUpperCase();
  const sourceTrust = cleanText(row.source_trust).toUpperCase();
  if (sourceType === "VISUAL_VECTOR" || sourceType.includes("VECTOR")) return "VECTOR_APPROVED_REFERENCE";
  if (sourceType.includes("OFFICIAL") || sourceTrust.includes("OFFICIAL")) return "OFFICIAL_CHECKLIST";
  if (sourceTrust.includes("REVIEWED_INTERNAL")
    || sourceTrust.includes("INTERNAL_APPROVED")
    || sourceTrust === "APPROVED_REFERENCE") {
    return "INTERNAL_APPROVED_HISTORY";
  }
  if (sourceType.includes("MARKETPLACE") || sourceType.includes("EBAY") || sourceTrust.includes("MARKETPLACE")) {
    return "MARKETPLACE";
  }
  return "STRUCTURED_DATABASE";
}

function denominatorValue(value) {
  const match = cleanText(value).match(/(?:^|\/)(\d{1,5})$/);
  return match ? `#/${match[1]}` : null;
}

function resolverFieldValue(row = {}) {
  const field = cleanText(row.field_name || row.field);
  if (field === "card_number") return { field: "collector_number", value: row.value };
  if (identityFields.has(field)) return { field, value: row.value };
  if (denominatorFields.has(field)) {
    return { field: "numerical_rarity", value: denominatorValue(row.value) };
  }
  return { field: null, value: null };
}

function comparable(field, value) {
  if (!valuePresent(value)) return "";
  return canonicalValueKey(field, value);
}

function valuesEqual(field, left, right) {
  const leftValue = comparable(field, left);
  const rightValue = comparable(field, right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function oldValueForRow(resolved = {}, row = {}) {
  const originalField = cleanText(row.field_name || row.field);
  const resolver = resolverFieldValue(row);
  if (valuePresent(resolved[originalField])) return resolved[originalField];
  if (resolver.field && valuePresent(resolved[resolver.field])) return resolved[resolver.field];
  return null;
}

function traceKey(candidateId = "", lane = "") {
  return `${cleanId(candidateId)}::${cleanText(lane)}`;
}

function traceByCandidate(candidateControl = {}) {
  return new Map((Array.isArray(candidateControl.candidate_application_trace)
    ? candidateControl.candidate_application_trace
    : []).map((trace) => [traceKey(trace.candidate_id, trace.candidate_lane), trace]));
}

function disabledDecision() {
  return {
    decision: retrievalApplicationDecisions.REJECT,
    reason: "retrieval_application_disabled"
  };
}

function decisionForRow(row = {}, {
  enabled = true,
  trace = {},
  selectedCandidateId = "",
  selectedCandidateGroupIds = new Set(),
  lowMarginCandidateId = "",
  selectedAppliedFields = new Set(),
  lowMarginAppliedFields = new Set(),
  selectedEligibleFields = new Set(),
  lowMarginSupportedFields = new Set(),
  resolvedBefore = {}
} = {}) {
  if (!enabled) return disabledDecision();
  const candidateId = cleanId(row.candidate_id);
  const field = cleanText(row.field_name || row.field);
  const resolver = resolverFieldValue(row);
  const oldValue = oldValueForRow(resolvedBefore, row);
  const sameAsCurrent = resolver.field
    ? valuesEqual(resolver.field, oldValue, resolver.value)
    : false;
  const selectedGroupMember = selectedCandidateGroupIds.has(candidateId);
  const isSelected = candidateId && candidateId === selectedCandidateId;
  const isLowMargin = candidateId && candidateId === lowMarginCandidateId;

  if (trace.decision_eligible !== true) {
    return {
      decision: retrievalApplicationDecisions.REJECT,
      reason: trace.shadow_only_reason || "candidate_not_decision_eligible"
    };
  }
  if (row.permission === fieldPermissions.FORBIDDEN) {
    return {
      decision: retrievalApplicationDecisions.BLOCK,
      reason: "field_permission_forbidden"
    };
  }
  if (row.permission === fieldPermissions.SUGGEST_ONLY) {
    return {
      decision: retrievalApplicationDecisions.REJECT,
      reason: "field_permission_suggest_only"
    };
  }
  if ((trace.direct_conflicts || []).includes(field) || (trace.blocked_fields || []).includes(field)) {
    return {
      decision: retrievalApplicationDecisions.BLOCK,
      reason: "candidate_or_field_conflict"
    };
  }
  if (!resolver.field || !valuePresent(resolver.value)) {
    return {
      decision: retrievalApplicationDecisions.BLOCK,
      reason: "field_not_supported_by_identity_resolution"
    };
  }
  if (isSelected && selectedAppliedFields.has(field)) {
    return {
      decision: retrievalApplicationDecisions.APPLY,
      reason: "selected_candidate_safe_field_application"
    };
  }
  if (isLowMargin && lowMarginAppliedFields.has(field)) {
    return {
      decision: retrievalApplicationDecisions.SUPPORT,
      reason: "low_margin_current_image_supported"
    };
  }
  if ((isSelected || selectedGroupMember) && sameAsCurrent) {
    return {
      decision: retrievalApplicationDecisions.SUPPORT,
      reason: row.permission === fieldPermissions.SUPPORT_ONLY
        ? "selected_identity_support_only_confirmation"
        : "selected_identity_matches_current_field"
    };
  }
  if (isLowMargin && lowMarginSupportedFields.has(field) && sameAsCurrent) {
    return {
      decision: retrievalApplicationDecisions.SUPPORT,
      reason: "low_margin_candidate_matches_current_field"
    };
  }
  if (isSelected && selectedEligibleFields.has(field)) {
    return {
      decision: retrievalApplicationDecisions.BLOCK,
      reason: "unsafe_replacement_blocked"
    };
  }
  if (isSelected || selectedGroupMember || isLowMargin) {
    return {
      decision: retrievalApplicationDecisions.BLOCK,
      reason: row.permission === fieldPermissions.SUPPORT_ONLY
        ? "support_only_cannot_fill_or_replace"
        : "field_not_in_safe_application_plan"
    };
  }
  return {
    decision: retrievalApplicationDecisions.REJECT,
    reason: "candidate_not_selected"
  };
}

function evidenceItemForDecision(row = {}, decision = {}) {
  if (![retrievalApplicationDecisions.APPLY, retrievalApplicationDecisions.SUPPORT].includes(decision.decision)) {
    return null;
  }
  const resolver = resolverFieldValue(row);
  if (!resolver.field || !valuePresent(resolver.value)) return null;
  const confidenceCap = decision.decision === retrievalApplicationDecisions.APPLY ? 0.72 : 0.58;
  const rowConfidence = Number(row.confidence);
  const confidence = Math.min(
    confidenceCap,
    Math.max(0, Number.isFinite(rowConfidence) ? rowConfidence : confidenceCap)
  );
  return {
    field: resolver.field,
    value: resolver.value,
    source: sourceForRow(row),
    confidence,
    metadata: {
      candidate_id: cleanId(row.candidate_id),
      candidate_identity_id: cleanId(row.candidate_identity_id),
      retrieval_application_decision: decision.decision,
      retrieval_application_reason: decision.reason,
      field_permission: row.permission || null,
      original_candidate_field: cleanText(row.field_name || row.field),
      candidate_lane: cleanText(row.candidate_lane),
      candidate_is_evidence_not_truth: true
    }
  };
}

function decisionCounts(decisions = []) {
  return Object.fromEntries(Object.values(retrievalApplicationDecisions).map((decision) => [
    decision,
    decisions.filter((row) => row.decision === decision).length
  ]));
}

export function buildRetrievalApplicationLayer({
  result = {},
  candidateControl = {},
  enabled = true,
  maxLength = 80
} = {}) {
  const controlledResult = { ...result, ...candidateControl };
  const resolvedBefore = normalizedResolvedSnapshot(controlledResult);
  const inventory = Array.isArray(candidateControl.candidate_field_inventory)
    ? candidateControl.candidate_field_inventory
    : [];
  const traces = traceByCandidate(candidateControl);
  const selectedDecision = candidateControl.selected_candidate_decision || {};
  const selectedCandidateId = cleanId(selectedDecision.selected_candidate_id);
  const selectedCandidateGroupIds = new Set([
    selectedCandidateId,
    ...(Array.isArray(selectedDecision.selected_candidate_group_ids)
      ? selectedDecision.selected_candidate_group_ids.map(cleanId)
      : [])
  ].filter(Boolean));
  const lowMarginCandidateId = cleanId(selectedDecision.low_margin_candidate_id);
  const selectedApplication = candidateControl.selected_candidate_safe_field_application || {};
  const lowMarginApplication = candidateControl.low_margin_safe_field_application || {};
  const selectedEligibleFields = new Set(selectedApplication.eligible_fields || []);
  const lowMarginSupportedFields = new Set(lowMarginApplication.supported_fields || []);
  const predictedApplication = enabled
    ? applyCandidateDecisionStage({
      result: controlledResult,
      resolvedBefore,
      maxLength
    })
    : null;
  const selectedAppliedFields = new Set(predictedApplication?.field_application?.selected_candidate_fields || []);
  const lowMarginAppliedFields = new Set(predictedApplication?.field_application?.low_margin_supported_fields || []);

  const decisions = inventory.map((row) => {
    const candidateId = cleanId(row.candidate_id);
    const trace = traces.get(traceKey(candidateId, row.candidate_lane)) || {};
    const resolver = resolverFieldValue(row);
    const decision = decisionForRow(row, {
      enabled,
      trace,
      selectedCandidateId,
      selectedCandidateGroupIds,
      lowMarginCandidateId,
      selectedAppliedFields,
      lowMarginAppliedFields,
      selectedEligibleFields,
      lowMarginSupportedFields,
      resolvedBefore
    });
    return {
      candidate_id: candidateId,
      candidate_identity_id: cleanId(row.candidate_identity_id),
      field: cleanText(row.field_name || row.field),
      resolver_field: resolver.field,
      old_value: oldValueForRow(resolvedBefore, row),
      candidate_value: row.value,
      resolver_value: resolver.value,
      confidence: Number(row.confidence || 0),
      source: sourceForRow(row),
      source_type: cleanText(row.source_type),
      source_trust: cleanText(row.source_trust),
      candidate_lane: cleanText(row.candidate_lane),
      permission: row.permission || null,
      decision: decision.decision,
      reason: decision.reason
    };
  });
  const identityEvidenceItems = decisions
    .map((decision, index) => evidenceItemForDecision(inventory[index], decision))
    .filter(Boolean);
  const candidateIds = [...new Set(inventory.map((row) => cleanId(row.candidate_id)).filter(Boolean))];

  return {
    schema_version: retrievalApplicationSchemaVersion,
    enabled: enabled === true,
    owner: "retrieval_application_layer",
    policy: "candidate_is_evidence_not_truth; identity_resolution_is_final_decision_maker",
    owns_candidate_application: true,
    resolver_consumed: false,
    selected_candidate_id: selectedCandidateId,
    low_margin_candidate_id: lowMarginCandidateId,
    candidate_count: candidateIds.length,
    candidate_ids: candidateIds,
    field_evidence_count: decisions.length,
    identity_evidence_count: identityEvidenceItems.length,
    decision_counts: decisionCounts(decisions),
    decisions,
    identity_evidence_items: identityEvidenceItems,
    predicted_application: predictedApplication
      ? {
        applied_fields: predictedApplication.field_application?.applied_fields || [],
        blocked_fields: predictedApplication.field_application?.blocked_fields || [],
        title_before: predictedApplication.title_before || "",
        title_after: predictedApplication.title_after || "",
        title_changed: predictedApplication.title_changed === true
      }
      : {
        applied_fields: [],
        blocked_fields: [],
        title_before: cleanText(result.final_title || result.title),
        title_after: cleanText(result.final_title || result.title),
        title_changed: false
      }
  };
}

function funnelPatch(funnel = {}, appliedFields = [], titleChanged = false) {
  const uniqueAppliedFields = [...new Set(appliedFields.filter(Boolean))];
  return {
    ...(funnel || {}),
    participation_level: uniqueAppliedFields.length ? "LEVEL_3_FIELD_APPLICATION" : funnel?.participation_level,
    applied_field_count: uniqueAppliedFields.length,
    applied_fields: uniqueAppliedFields,
    title_changed: titleChanged
  };
}

function candidateTracePatch(traces = [], decisions = []) {
  const appliedByCandidate = new Map();
  const supportedByCandidate = new Map();
  const reasonsByCandidate = new Map();
  for (const row of decisions) {
    const candidateId = traceKey(row.candidate_id, row.candidate_lane);
    const field = cleanText(row.resolver_field || row.field);
    if (!candidateId || !field) continue;
    if (row.applied_to_final) {
      if (!appliedByCandidate.has(candidateId)) appliedByCandidate.set(candidateId, new Set());
      appliedByCandidate.get(candidateId).add(field);
    }
    if (row.supported_final) {
      if (!supportedByCandidate.has(candidateId)) supportedByCandidate.set(candidateId, new Set());
      supportedByCandidate.get(candidateId).add(field);
    }
    if (row.applied_to_final || row.supported_final) {
      if (!reasonsByCandidate.has(candidateId)) reasonsByCandidate.set(candidateId, {});
      reasonsByCandidate.get(candidateId)[field] = row.reason;
    }
  }
  return (Array.isArray(traces) ? traces : []).map((trace) => {
    const candidateId = traceKey(trace?.candidate_id, trace?.candidate_lane);
    const appliedFields = [...(appliedByCandidate.get(candidateId) || [])];
    const supportedFields = [...(supportedByCandidate.get(candidateId) || [])];
    if (!appliedFields.length && !supportedFields.length) return trace;
    return {
      ...trace,
      participation_level: appliedFields.length ? "LEVEL_3_FIELD_APPLICATION" : trace.participation_level,
      applied_fields: [...new Set([...(trace.applied_fields || []), ...appliedFields])],
      supported_fields: [...new Set([...(trace.supported_fields || []), ...supportedFields])],
      reason_per_field: {
        ...(trace.reason_per_field || {}),
        ...(reasonsByCandidate.get(candidateId) || {})
      }
    };
  });
}

function actualDecisionRows(application = {}, resolvedAfter = {}) {
  return (application.decisions || []).map((row) => {
    const finalField = row.resolver_field || row.field;
    const finalValue = finalField ? resolvedAfter[finalField] : null;
    const finalMatchesCandidate = finalField
      ? valuesEqual(finalField, finalValue, row.resolver_value ?? row.candidate_value)
      : false;
    const oldMatchedCandidate = finalField
      ? valuesEqual(finalField, row.old_value, row.resolver_value ?? row.candidate_value)
      : false;
    const appliedToFinal = row.decision === retrievalApplicationDecisions.APPLY
      && finalMatchesCandidate
      && !oldMatchedCandidate;
    const supportedFinal = row.decision === retrievalApplicationDecisions.SUPPORT && finalMatchesCandidate;
    return {
      ...row,
      final_value: finalValue ?? null,
      applied_to_final: appliedToFinal,
      supported_final: supportedFinal,
      outcome: appliedToFinal
        ? "APPLIED_TO_FINAL"
        : supportedFinal
          ? "SUPPORTED_FINAL"
          : row.decision === retrievalApplicationDecisions.APPLY
            ? "BLOCKED_BY_IDENTITY_RESOLUTION"
            : "NOT_APPLIED"
    };
  });
}

export function finalizeRetrievalApplicationOutcome({
  result = {},
  resolvedAfter = {},
  titleAfter = ""
} = {}) {
  const application = result.retrieval_application;
  if (!application || application.schema_version !== retrievalApplicationSchemaVersion) {
    return { retrieval_application: application || null, result_patch: {} };
  }
  const normalizedAfter = normalizeFields(resolvedAfter || {});
  const decisions = actualDecisionRows(application, normalizedAfter);
  const appliedFields = [...new Set(decisions
    .filter((row) => row.applied_to_final)
    .map((row) => row.resolver_field || row.field)
    .filter(Boolean))];
  const supportedFields = [...new Set(decisions
    .filter((row) => row.supported_final)
    .map((row) => row.resolver_field || row.field)
    .filter(Boolean))];
  const titleBefore = cleanText(application.predicted_application?.title_before || result.final_title || result.title);
  const finalTitle = cleanText(titleAfter);
  const titleChanged = Boolean(appliedFields.length && titleBefore !== finalTitle);
  const finalized = {
    ...application,
    resolver_consumed: application.enabled === true,
    decisions,
    actual_application_count: appliedFields.length,
    actual_applied_fields: appliedFields,
    actual_support_count: supportedFields.length,
    actual_supported_fields: supportedFields,
    title_before: titleBefore,
    title_after: finalTitle,
    title_changed: titleChanged
  };
  const candidateDecisionStage = {
    schema_version: "candidate-decision-stage-v1",
    heuristic_version: result.selected_candidate_decision?.heuristic_version || null,
    application_owner: "retrieval_application_layer",
    selected_candidate_id: application.selected_candidate_id || "",
    selected_candidate: result.selected_candidate_decision || null,
    resolved_before: normalizedResolvedSnapshot(result),
    field_application: {
      applied_fields: appliedFields,
      blocked_fields: [...new Set(decisions
        .filter((row) => [retrievalApplicationDecisions.BLOCK, retrievalApplicationDecisions.REJECT].includes(row.decision))
        .map((row) => row.field)
        .filter(Boolean))],
      supported_fields: supportedFields,
      reason_per_field: Object.fromEntries(decisions
        .filter((row) => row.applied_to_final || row.supported_final)
        .map((row) => [row.resolver_field || row.field, row.reason]))
    },
    resolved_after: normalizedAfter,
    title_before: titleBefore,
    title_after: finalTitle,
    title_changed: titleChanged
  };
  const patch = {
    retrieval_application: finalized,
    candidate_decision_stage: candidateDecisionStage,
    candidate_application_trace: candidateTracePatch(result.candidate_application_trace, decisions),
    candidate_safe_overlay_applied_fields: appliedFields,
    participation_level: appliedFields.length ? "LEVEL_3_FIELD_APPLICATION" : result.participation_level,
    candidate_activation_funnel: funnelPatch(result.candidate_activation_funnel, appliedFields, titleChanged),
    catalog_activation_funnel: funnelPatch(
      result.catalog_activation_funnel,
      decisions.filter((row) => row.applied_to_final && row.candidate_lane === "catalog")
        .map((row) => row.resolver_field || row.field),
      titleChanged
    ),
    vector_activation_funnel: funnelPatch(
      result.vector_activation_funnel,
      decisions.filter((row) => row.applied_to_final && row.candidate_lane === "vector")
        .map((row) => row.resolver_field || row.field),
      titleChanged
    )
  };
  return { retrieval_application: finalized, result_patch: patch };
}
