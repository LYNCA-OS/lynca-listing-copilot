import { buildFieldGraph } from "../../feedback/field_graph.mjs";
import { expandPrintRunFields } from "../../print-run/print-run-fields.mjs";

function normalizeText(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || "";
}

function resolvedFieldsFrom(result = {}) {
  return {
    ...(result.fields && typeof result.fields === "object" ? result.fields : {}),
    ...(result.resolved_fields && typeof result.resolved_fields === "object" ? result.resolved_fields : {}),
    ...(result.resolved && typeof result.resolved === "object" ? result.resolved : {})
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

function fieldState(field, value, result = {}) {
  const status = displayStatusFor(field, result);
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
  const fields = resolvedFieldsFrom(result);
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
