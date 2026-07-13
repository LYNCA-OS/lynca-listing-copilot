import { buildFieldGraph } from "../../feedback/field_graph.mjs";
import { normalizePrintedCardCodeForFields } from "../../pipeline/field-normalization.mjs";
import { expandPrintRunFields } from "../../print-run/print-run-fields.mjs";
import { sanitizeGradeFields } from "../../grade/grade-value.mjs";

function normalizeText(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "";
}

function sanitizeStructuralFields(fields = {}) {
  const output = sanitizeGradeFields(fields);
  const cardName = normalizeText(output.card_name);
  // PSA-style labels expose a field descriptor such as `SPLTNG.IMG - BLACK
  // SCOPE`. It is evidence about the parallel, never the collectible's card
  // name. Keep the parallel field and prevent this label key from leaking into
  // the CSM title when V4 reconciles authoritative evidence.
  if (/\b(?:SPLT{1,2}NG\.?\s*IMG|PARALLEL(?:\s+NAME)?)\b\s*[-–—:]/i.test(cardName)) {
    output.card_name = null;
  }
  // V4 merges several structured surfaces after the legacy normalization
  // pass. Re-apply the printed-code contract at the canonical boundary so
  // player names and label prose cannot re-enter the title as `#...`.
  for (const field of ["card_number", "collector_number", "checklist_code"]) {
    output[field] = normalizePrintedCardCodeForFields(output[field], output);
  }
  return output;
}

function resolvedFieldsFrom(result = {}) {
  const renderedFields = result.rendered_fields && typeof result.rendered_fields === "object"
    && !Array.isArray(result.rendered_fields)
    && result.rendered_fields.fields && typeof result.rendered_fields.fields === "object"
    && !Array.isArray(result.rendered_fields.fields)
    ? result.rendered_fields.fields
    : {};
  return {
    ...(result.fields && typeof result.fields === "object" ? result.fields : {}),
    ...(result.resolved && typeof result.resolved === "object" ? result.resolved : {}),
    ...(result.resolved_fields && typeof result.resolved_fields === "object" ? result.resolved_fields : {}),
    ...renderedFields
  };
}

function unresolvedSet(result = {}) {
  return new Set((Array.isArray(result.unresolved) ? result.unresolved : [])
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean));
}

function conflictIsResolved(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.resolved === true || value.is_resolved === true) return true;
  return /^(?:RESOLVED|OVERRIDDEN|ACCEPTED)$/i.test(normalizeText(
    value.status || value.resolution_status || value.decision
  ));
}

function explicitConflictFields(result = {}) {
  const fields = new Set();
  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      // A resolved override is part of the audit trail, not a reason to erase
      // the canonical value a second time at the V4 boundary.
      if (conflictIsResolved(value)) return;
      push(value.field || value.field_name || value.name);
      return;
    }
    const normalized = normalizeText(value).toLowerCase();
    if (normalized) fields.add(normalized);
  };
  push(result.conflict_map);
  push(result.conflicts);
  push(result.field_conflicts);
  return fields;
}

function displayConflictFields(result = {}) {
  const fields = explicitConflictFields(result);
  for (const state of Array.isArray(result.field_states) ? result.field_states : Object.values(result.field_states || {})) {
    if (!/CONFLICT/i.test(normalizeText(state?.display_status || state?.status))) continue;
    const field = normalizeText(state?.field || state?.field_name || state?.name).toLowerCase();
    if (field) fields.add(field);
  }
  return fields;
}

const conflictFieldGroups = Object.freeze([
  ["player", "players", "subject", "character"],
  ["parallel", "parallel_exact", "exact_parallel"],
  ["serial", "serial_number", "serial_denominator", "print_run_number", "print_run_numerator", "print_run_denominator", "numbered_to", "numerical_rarity"],
  ["grade", "grade_company", "card_grade", "auto_grade", "grade_type"],
  ["card_number", "collector_number", "checklist_code", "tcg_card_number"]
]);

function fieldsWithoutConflicts(fields = {}, result = {}) {
  const conflicts = explicitConflictFields(result);
  if (!conflicts.size) return fields;
  const blocked = new Set();
  for (const field of conflicts) {
    const group = conflictFieldGroups.find((members) => members.includes(field));
    (group || [field]).forEach((member) => blocked.add(member));
  }
  const output = { ...fields };
  for (const field of blocked) {
    if (Object.hasOwn(output, field)) output[field] = null;
  }
  return output;
}

function displayStatusFor(field, result = {}) {
  const unresolved = unresolvedSet(result);
  const conflicts = displayConflictFields(result);
  const key = normalizeText(field).toLowerCase();
  if (conflicts.has(key)) return "CONFLICT";
  if (unresolved.has(key)) return "REVIEW";
  return "NORMAL";
}

function valueHasExplicitUncertainty(value) {
  if (Array.isArray(value)) return value.some(valueHasExplicitUncertainty);
  const text = normalizeText(value);
  return Boolean(text && (
    /\?/u.test(text)
    || /\b(?:visible\s+partial|partial\s+wording|uncertain|unclear|illegible|possibly|likely)\b/i.test(text)
    || /\b(?:Edition|Ed\.?)[\s]*[-:][\s]*(?=(?:Aqua|Gold|Green|Red|Blue|Purple|Orange|Black|Silver)\b)/i.test(text)
  ));
}

function fieldState(field, value, result = {}) {
  const explicitStatus = displayStatusFor(field, result);
  const status = explicitStatus === "NORMAL" && valueHasExplicitUncertainty(value)
    ? "REVIEW"
    : explicitStatus;
  return {
    field,
    value: value === undefined ? null : value,
    display_status: status,
    writer_visible: false,
    confidence_band: status === "NORMAL" ? "usable" : "needs_review"
  };
}

export function buildV4FieldGraph(result = {}, payload = {}) {
  return buildFieldGraph({
    // Field states and persisted canonical fields must share one sanitizer.
    // Otherwise invalid OCR/model codes can appear NORMAL in the graph after
    // the canonical identity boundary has correctly removed them.
    resolved: buildV4ResolvedFields(result),
    evidence: result.provider_evidence || result.evidence || {},
    retrievalTrace: result.retrieval_trace || {},
    openSetReadiness: result.open_set_readiness || {},
    workflowSidecars: result.workflow_sidecars || payload.workflow_sidecars || {}
  });
}

export function buildV4ResolvedFields(result = {}) {
  const fields = fieldsWithoutConflicts(
    sanitizeStructuralFields(resolvedFieldsFrom(result)),
    result
  );
  return {
    ...fields,
    ...expandPrintRunFields(fields)
  };
}

export function buildV4FieldStates(result = {}, payload = {}) {
  const fieldGraph = buildV4FieldGraph(result, payload);
  const compact = {
    player: fieldGraph.player,
    year: fieldGraph.year,
    product: fieldGraph.product,
    card_type: fieldGraph.card_type,
    parallel: fieldGraph.parallel,
    serial: fieldGraph.serial,
    card_number: fieldGraph.card_number,
    grade: fieldGraph.grade
  };
  return Object.fromEntries(
    Object.entries(compact).map(([field, value]) => [field, fieldState(field, value, result)])
  );
}

export function buildV4FieldEvidenceRows({ sessionId, result = {}, payload = {} } = {}) {
  const fieldStates = buildV4FieldStates(result, payload);
  const fieldGraph = buildV4FieldGraph(result, payload);
  return Object.values(fieldStates).map((state) => ({
    id: `${sessionId}_${state.field}`,
    field_name: state.field,
    field_value: state.value,
    display_status: state.display_status,
    confidence: state.confidence_band === "usable" ? 0.8 : 0.45,
    source_type: "V4_FIELD_GRAPH",
    provenance: {
      source_fields: fieldGraph.field_nodes?.[state.field]?.source_fields || [],
      evidence_sources: fieldGraph.field_nodes?.[state.field]?.evidence_sources || [],
      structured_only: true
    }
  }));
}
