import { normalizeFields } from "../pipeline/field-normalization.mjs";
import { normalizeStringOrNull } from "../pipeline/text.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";
import { candidateSelectionHeuristicVersion } from "./candidate-selection-pass.mjs";

export const candidateDecisionHeuristicVersion = candidateSelectionHeuristicVersion;

const physicalInstanceFields = new Set([
  "print_run_number",
  "print_run_numerator",
  "serial_number",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number",
  "condition",
  "current_physical_defects",
  "physical_defects"
]);

const lowMarginAllowedFields = new Set([
  "year",
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "subset",
  "insert",
  "language",
  "rarity",
  "card_name",
  "players",
  "player",
  "character",
  "team",
  "card_type",
  "official_card_type",
  "observable_components",
  "surface_color",
  "parallel",
  "parallel_family",
  "parallel_exact",
  "variation",
  "collector_number",
  "card_number",
  "checklist_code",
  "tcg_card_number",
  "numbered_to",
  "print_run_denominator",
  "serial_denominator",
  "expected_serial_denominator"
]);

const selectedCandidateAllowedFields = new Set([
  "year",
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "subset",
  "insert",
  "language",
  "rarity",
  "card_name",
  "players",
  "player",
  "character",
  "collector_number",
  "card_number",
  "checklist_code",
  "tcg_card_number",
  "official_card_type",
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
  "surface_color",
  "parallel",
  "parallel_family",
  "parallel_exact",
  "variation",
  "numbered_to",
  "print_run_denominator",
  "serial_denominator",
  "expected_serial_denominator"
]);

const embeddedReferenceFields = new Set([
  "parallel",
  "parallel_family",
  "parallel_exact",
  "variation",
  "print_finish",
  "product_finish",
  ...physicalInstanceFields
]);

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null
    && value !== undefined
    && String(value).replace(/\s+/g, " ").trim() !== ""
    && value !== "UNKNOWN";
}

function normalizedCandidateId(value) {
  return normalizeStringOrNull(value) || "";
}

function containsReferenceInstanceValue(value, forbiddenValues = []) {
  const comparable = normalizeStringOrNull(value)?.toLowerCase().replace(/\s+/g, " ").trim();
  if (!comparable) return false;
  return forbiddenValues.some((forbiddenValue) => {
    const forbidden = normalizeStringOrNull(forbiddenValue)?.toLowerCase().replace(/\s+/g, " ").trim();
    return Boolean(forbidden && forbidden.length >= 3 && comparable.includes(forbidden));
  });
}

function candidateEvidenceRows(result = {}, candidateId = "") {
  return (Array.isArray(result.candidate_field_evidence) ? result.candidate_field_evidence : [])
    .filter((row) => normalizedCandidateId(row?.candidate_id) === candidateId);
}

function normalizeOverlay(overlay = {}) {
  const normalized = normalizeFields(overlay);
  const output = Object.fromEntries(Object.entries(overlay).map(([field, value]) => [
    field,
    valuePresent(normalized[field]) ? normalized[field] : value
  ]));
  const denominatorObserved = [
    "print_run_denominator",
    "serial_denominator",
    "expected_serial_denominator",
    "numbered_to"
  ].some((field) => valuePresent(overlay[field]));
  if (denominatorObserved) {
    for (const field of ["print_run_denominator", "serial_denominator", "expected_serial_denominator", "numbered_to"]) {
      if (valuePresent(normalized[field])) output[field] = normalized[field];
    }
  }
  return output;
}

function selectedCandidateOverlay(result = {}) {
  const application = result.selected_candidate_safe_field_application;
  if (!application || application.status !== "ready_fill_missing" || application.renderer_application_allowed !== true) {
    return { candidateId: "", overlay: {}, reasons: {}, blockedFields: application?.blocked_fields || [] };
  }
  const candidateId = normalizedCandidateId(application.candidate_id);
  if (!candidateId) return { candidateId: "", overlay: {}, reasons: {}, blockedFields: application.blocked_fields || [] };
  const eligible = new Set((Array.isArray(application.eligible_fields) ? application.eligible_fields : [])
    .map(normalizedCandidateId)
    .filter(Boolean));
  const rows = candidateEvidenceRows(result, candidateId);
  const forbiddenReferenceValues = rows
    .filter((row) => physicalInstanceFields.has(normalizedCandidateId(row?.field_name)) && valuePresent(row?.value))
    .map((row) => row.value);
  const overlay = {};
  for (const row of rows) {
    const field = normalizedCandidateId(row?.field_name);
    if (!field || !eligible.has(field) || !selectedCandidateAllowedFields.has(field)) continue;
    if (physicalInstanceFields.has(field) || row.permission !== "can_apply" || !valuePresent(row.value)) continue;
    const applicationReason = application.field_reasons?.[field] || "";
    if (embeddedReferenceFields.has(field)
      && !["trusted_reviewed_identity_variant_fill", "trusted_reviewed_current_source_semantic_fill"].includes(applicationReason)) continue;
    if (containsReferenceInstanceValue(row.value, forbiddenReferenceValues)) continue;
    overlay[field] = row.value;
  }
  return {
    candidateId,
    overlay: normalizeOverlay(overlay),
    reasons: application.field_reasons || {},
    blockedFields: application.blocked_fields || []
  };
}

function lowMarginOverlay(result = {}) {
  const application = result.low_margin_safe_field_application;
  if (!application || application.status !== "evidence_support_only") {
    return {
      candidateId: "",
      overlay: {},
      blockedFields: [
        ...(application?.blocked_fields || []),
        ...(application?.verifier_required_fields || [])
      ]
    };
  }
  const candidateId = normalizedCandidateId(application.candidate_id);
  if (!candidateId) {
    return {
      candidateId: "",
      overlay: {},
      blockedFields: [
        ...(application.blocked_fields || []),
        ...(application.verifier_required_fields || [])
      ]
    };
  }
  const supported = new Set((Array.isArray(application.supported_fields) ? application.supported_fields : [])
    .map(normalizedCandidateId)
    .filter(Boolean));
  const overlay = {};
  for (const row of candidateEvidenceRows(result, candidateId)) {
    const field = normalizedCandidateId(row?.field_name);
    if (!field || !supported.has(field) || !lowMarginAllowedFields.has(field)) continue;
    if (physicalInstanceFields.has(field) || ["forbidden", "suggest_only"].includes(row.permission)) continue;
    if (!valuePresent(row.value)) continue;
    overlay[field] = row.value;
  }
  return {
    candidateId,
    overlay: normalizeOverlay(overlay),
    blockedFields: [
      ...(application.blocked_fields || []),
      ...(application.verifier_required_fields || [])
    ]
  };
}

function renderTitle(resolved = {}, result = {}, maxLength = 80) {
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return "";
  const presentation = renderListingPresentation({
    resolved,
    evidence: result.normalized_evidence || result.evidence || {},
    maxLength,
    serialNumeratorVerified: result.serial_numerator_verified ?? result.serialNumeratorVerified ?? false
  });
  return String(presentation.final_title || presentation.rendered_title || "").replace(/\s+/g, " ").trim();
}

const hierarchyFields = new Set([
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "subset",
  "insert"
]);

const exactCodeAuthoritativeHierarchyFields = new Set([
  "product",
  "release",
  "set",
  "subset",
  "insert"
]);

const hierarchyOwnershipTokens = new Set([
  "bandai",
  "bowman",
  "donruss",
  "fanatics",
  "konami",
  "leaf",
  "panini",
  "pokemon",
  "topps",
  "upper",
  "deck",
  "wizards"
]);

function comparableTokens(value) {
  return String(Array.isArray(value) ? value.join(" ") : value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function strictTextSuperset(currentValue, candidateValue) {
  const current = new Set(comparableTokens(currentValue));
  const candidate = new Set(comparableTokens(candidateValue));
  if (!current.size || candidate.size <= current.size) return false;
  return [...current].every((token) => candidate.has(token));
}

function hierarchyOwnershipFamily(value) {
  const tokens = new Set(comparableTokens(value));
  if (["topps", "bowman", "fanatics"].some((token) => tokens.has(token))) return "topps";
  if (["panini", "donruss"].some((token) => tokens.has(token))) return "panini";
  if (tokens.has("upper") || tokens.has("deck")) return "upper_deck";
  return [...tokens].find((token) => hierarchyOwnershipTokens.has(token)) || "";
}

function arrayStrictSuperset(currentValue, candidateValue) {
  if (!Array.isArray(currentValue) || !Array.isArray(candidateValue)) return false;
  const current = new Set(currentValue.map((value) => normalizeStringOrNull(value)?.toLowerCase()).filter(Boolean));
  const candidate = new Set(candidateValue.map((value) => normalizeStringOrNull(value)?.toLowerCase()).filter(Boolean));
  return current.size > 0
    && candidate.size > current.size
    && [...current].every((value) => candidate.has(value));
}

function genericIdentityScaffold(field, value) {
  const comparable = normalizeStringOrNull(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || "";
  if (!comparable) return true;
  if (field === "card_name") return /^(?:base(?: card)?|card|regular(?: card)?|standard(?: card)?|unknown)$/.test(comparable);
  return /^(?:other collectibles|unknown|unidentified|n a)$/.test(comparable);
}

function safeSelectedCandidateUpgradeReason(field, currentValue, candidateValue, applicationReason = "") {
  if (!valuePresent(currentValue) || !valuePresent(candidateValue)) return "";
  const currentComparable = normalizeStringOrNull(Array.isArray(currentValue) ? currentValue.join("|") : currentValue);
  const candidateComparable = normalizeStringOrNull(Array.isArray(candidateValue) ? candidateValue.join("|") : candidateValue);
  if (currentComparable?.toLowerCase() === candidateComparable?.toLowerCase()) return "";

  const exactCodeIdentity = applicationReason === "trusted_exact_code_identity_fill";
  if (applicationReason === "trusted_reviewed_current_source_semantic_fill"
    && selectedCandidateAllowedFields.has(field)) {
    return "trusted_reviewed_current_source_semantic_replace";
  }
  if (exactCodeIdentity && exactCodeAuthoritativeHierarchyFields.has(field)) {
    return "trusted_exact_code_identity_replace";
  }
  if (exactCodeIdentity && field === "year") {
    return "trusted_exact_code_year_replace";
  }
  if (exactCodeIdentity && field === "card_name" && (
    genericIdentityScaffold(field, currentValue)
    || strictTextSuperset(currentValue, candidateValue)
  )) {
    return "trusted_exact_code_card_name_upgrade";
  }
  if (exactCodeIdentity && ["players", "subjects"].includes(field)
    && arrayStrictSuperset(currentValue, candidateValue)) {
    return "trusted_exact_code_subject_completion";
  }
  if (applicationReason === "trusted_reviewed_current_source_product_hierarchy_fill"
    && hierarchyFields.has(field)) {
    const currentFamily = hierarchyOwnershipFamily(currentValue);
    const candidateFamily = hierarchyOwnershipFamily(candidateValue);
    if (!currentFamily || !candidateFamily || currentFamily === candidateFamily) {
      return "trusted_reviewed_current_source_product_hierarchy_replace";
    }
  }
  return "";
}

function applyMissingFields(base = {}, overlay = {}, {
  source = "candidate",
  reasons = {},
  allowSafeUpgrade = false
} = {}) {
  const resolved = { ...base };
  const appliedFields = [];
  const reasonPerField = {};
  for (const [field, value] of Object.entries(overlay)) {
    if (!valuePresent(value)) continue;
    const existing = resolved[field];
    if (valuePresent(existing)) {
      const upgradeReason = allowSafeUpgrade
        ? safeSelectedCandidateUpgradeReason(field, existing, value, reasons[field])
        : "";
      if (!upgradeReason) continue;
      resolved[field] = value;
      appliedFields.push(field);
      reasonPerField[field] = upgradeReason;
      continue;
    }
    resolved[field] = value;
    appliedFields.push(field);
    reasonPerField[field] = reasons[field] || `${source}_fill_missing`;
  }
  return { resolved, appliedFields, reasonPerField };
}

function updateTraceRows(result = {}, selectedId = "", appliedFields = [], reasonPerField = {}) {
  if (!Array.isArray(result.candidate_application_trace) || !appliedFields.length) {
    return result.candidate_application_trace || [];
  }
  return result.candidate_application_trace.map((trace) => (
    normalizedCandidateId(trace?.candidate_id) === selectedId
      ? {
        ...trace,
        participation_level: "LEVEL_3_FIELD_APPLICATION",
        applied_fields: [...new Set([...(trace.applied_fields || []), ...appliedFields])],
        reason_per_field: { ...(trace.reason_per_field || {}), ...reasonPerField }
      }
      : trace
  ));
}

function updateFunnel(funnel = {}, selectedId = "", appliedFields = [], titleChanged = false, {
  laneSpecific = false
} = {}) {
  if (!funnel || typeof funnel !== "object" || !appliedFields.length) return funnel || {};
  if (laneSpecific && normalizedCandidateId(funnel.selected_candidate_id) !== selectedId) return funnel;
  return {
    ...funnel,
    participation_level: "LEVEL_3_FIELD_APPLICATION",
    applied_field_count: appliedFields.length,
    applied_fields: appliedFields,
    title_changed: titleChanged
  };
}

export function applyCandidateDecisionStage({
  result = {},
  resolvedBefore = {},
  maxLength = 80
} = {}) {
  const before = normalizeFields(resolvedBefore || {});
  const selected = selectedCandidateOverlay(result);
  const selectedApplied = applyMissingFields(before, selected.overlay, {
    source: "selected_trusted_candidate",
    reasons: selected.reasons,
    allowSafeUpgrade: true
  });
  const lowMargin = lowMarginOverlay(result);
  const candidateIdsConflict = Boolean(
    selected.candidateId
      && lowMargin.candidateId
      && selected.candidateId !== lowMargin.candidateId
  );
  const lowMarginApplied = applyMissingFields(
    selectedApplied.resolved,
    candidateIdsConflict ? {} : lowMargin.overlay,
    { source: "low_margin_current_image_supported_candidate" }
  );
  const appliedFields = [...new Set([...selectedApplied.appliedFields, ...lowMarginApplied.appliedFields])];
  const reasonPerField = { ...selectedApplied.reasonPerField, ...lowMarginApplied.reasonPerField };
  const selectedId = selectedApplied.appliedFields.length ? selected.candidateId : lowMargin.candidateId;
  const blockedFields = [...new Set([
    ...selected.blockedFields,
    ...lowMargin.blockedFields,
    ...(candidateIdsConflict ? ["candidate_id_mismatch"] : []),
    ...(Array.isArray(result.candidate_application_trace)
      ? result.candidate_application_trace.flatMap((trace) => trace.blocked_fields || [])
      : [])
  ])];
  const titleBefore = renderTitle(before, result, maxLength);
  const titleAfter = renderTitle(lowMarginApplied.resolved, result, maxLength);
  const titleChanged = Boolean(appliedFields.length && titleBefore !== titleAfter);
  const traceRows = updateTraceRows(result, selectedId, appliedFields, reasonPerField);
  const decisionRecord = {
    schema_version: "candidate-decision-stage-v1",
    heuristic_version: candidateDecisionHeuristicVersion,
    selected_candidate_id: normalizedCandidateId(result.selected_candidate_decision?.selected_candidate_id) || selectedId,
    selected_candidate: result.selected_candidate_decision || null,
    resolved_before: before,
    field_application: {
      applied_fields: appliedFields,
      blocked_fields: blockedFields,
      reason_per_field: reasonPerField,
      selected_candidate_fields: selectedApplied.appliedFields,
      low_margin_supported_fields: lowMarginApplied.appliedFields,
      candidate_id_mismatch_blocked: candidateIdsConflict
    },
    resolved_after: lowMarginApplied.resolved,
    title_before: titleBefore,
    title_after: titleAfter,
    title_changed: titleChanged
  };
  const resultPatch = {
    participation_level: appliedFields.length ? "LEVEL_3_FIELD_APPLICATION" : result.participation_level,
    candidate_application_trace: traceRows,
    candidate_decision_stage: decisionRecord,
    candidate_safe_overlay_applied_fields: [
      ...new Set([...(result.candidate_safe_overlay_applied_fields || []), ...appliedFields])
    ],
    candidate_activation_funnel: updateFunnel(
      result.candidate_activation_funnel,
      selectedId,
      appliedFields,
      titleChanged
    ),
    catalog_activation_funnel: updateFunnel(
      result.catalog_activation_funnel,
      selectedId,
      appliedFields,
      titleChanged,
      { laneSpecific: true }
    ),
    vector_activation_funnel: updateFunnel(
      result.vector_activation_funnel,
      selectedId,
      appliedFields,
      titleChanged,
      { laneSpecific: true }
    )
  };
  if (selectedApplied.appliedFields.length) {
    resultPatch.selected_candidate_safe_field_application = {
      ...(result.selected_candidate_safe_field_application || {}),
      renderer_applied_fields: selectedApplied.appliedFields,
      renderer_application_policy: "fill_missing_or_strictly_upgrade_trusted_identity_fields"
    };
  }
  if (lowMarginApplied.appliedFields.length) {
    resultPatch.low_margin_safe_field_application = {
      ...(result.low_margin_safe_field_application || {}),
      renderer_application_allowed: true,
      renderer_applied_fields: lowMarginApplied.appliedFields,
      renderer_application_policy: "fill_missing_fields_only_when_candidate_value_matches_current_image_evidence"
    };
  }

  return {
    ...decisionRecord,
    result_patch: resultPatch
  };
}
