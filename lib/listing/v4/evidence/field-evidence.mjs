import { buildFieldGraph } from "../../feedback/field_graph.mjs";
import { normalizePrintedCardCodeForFields } from "../../pipeline/field-normalization.mjs";
import { expandPrintRunFields } from "../../print-run/print-run-fields.mjs";

function normalizeText(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "";
}

function sanitizeStructuralFields(fields = {}) {
  const output = { ...fields };
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

function conflictFields(result = {}) {
  const fields = new Set();
  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      push(value.field || value.field_name || value.name);
      return;
    }
    const normalized = normalizeText(value).toLowerCase();
    if (normalized) fields.add(normalized);
  };
  push(result.conflict_map);
  push(result.conflicts);
  return fields;
}

function displayStatusFor(field, result = {}) {
  const unresolved = unresolvedSet(result);
  const conflicts = conflictFields(result);
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
    resolved: resolvedFieldsFrom(result),
    evidence: result.provider_evidence || result.evidence || {},
    retrievalTrace: result.retrieval_trace || {},
    openSetReadiness: result.open_set_readiness || {},
    workflowSidecars: result.workflow_sidecars || payload.workflow_sidecars || {}
  });
}

export function buildV4ResolvedFields(result = {}) {
  const fields = sanitizeStructuralFields(resolvedFieldsFrom(result));
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
