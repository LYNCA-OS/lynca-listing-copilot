import { canonicalValueKey, sourceIsMarketplace, sourceIsOcr, sourceIsRegistry, sourceIsRetrieval, sourceIsSlab } from "./normalizer.mjs";

function valueText(value) {
  return Array.isArray(value) ? value.join(" / ") : String(value ?? "");
}

function evidenceNodeType(source) {
  if (sourceIsOcr(source)) return "OCR_RESULT";
  if (sourceIsSlab(source)) return "SLAB_INFO";
  if (sourceIsRegistry(source)) return "REGISTRY_MATCH";
  if (sourceIsMarketplace(source)) return "MARKETPLACE_RESULT";
  if (sourceIsRetrieval(source)) return "RETRIEVAL_RESULT";
  return source === "AGNES_INFERENCE" || source === "VISUAL_GUESS" ? "VISION_INFERENCE" : "EVIDENCE";
}

function sameCandidate(field, left, right) {
  return canonicalValueKey(field, left) === canonicalValueKey(field, right);
}

function selectedForField(fieldStates = [], field) {
  return fieldStates.find((fieldState) => fieldState.field === field) || null;
}

export function buildConflictGraph({
  aggregation = {},
  candidatesByField = {},
  rankedByField = {},
  fieldStates = [],
  conflictMap = []
} = {}) {
  const nodes = [];
  const edges = [];
  const evidenceIds = new Map();

  (aggregation.evidence_items || []).forEach((item, index) => {
    const id = `evidence:${index + 1}`;
    evidenceIds.set(item, id);
    nodes.push({
      id,
      type: evidenceNodeType(item.source),
      field: item.field,
      value: item.value,
      source: item.source,
      confidence: item.confidence,
      image_id: item.image_id || null
    });
  });

  Object.keys(candidatesByField || {}).forEach((field) => {
    const fieldState = selectedForField(fieldStates, field);
    const fieldNodeId = `field:${field}`;
    nodes.push({
      id: fieldNodeId,
      type: "IDENTITY_FIELD",
      field,
      resolved_value: fieldState?.resolved_value ?? null,
      status: fieldState?.decision_route || "UNKNOWN"
    });

    (rankedByField[field] || candidatesByField[field] || []).forEach((candidate) => {
      const candidateNodeId = `candidate:${field}:${candidate.key}`;
      nodes.push({
        id: candidateNodeId,
        type: "FIELD_CANDIDATE",
        field,
        value: candidate.value,
        score: candidate.score ?? null,
        selected: fieldState ? sameCandidate(field, candidate.value, fieldState.resolved_value) : false,
        constraint_result: candidate.constraint_result || null
      });

      (candidate.evidence_items || []).forEach((item) => {
        const evidenceNodeId = evidenceIds.get(item);
        if (!evidenceNodeId) return;
        edges.push({
          from: evidenceNodeId,
          to: candidateNodeId,
          edge_type: "support",
          field,
          value: candidate.value
        });
        edges.push({
          from: candidateNodeId,
          to: evidenceNodeId,
          edge_type: "derived_from",
          field,
          value: candidate.value
        });
      });

      if (fieldState && sameCandidate(field, candidate.value, fieldState.resolved_value)) {
        edges.push({
          from: candidateNodeId,
          to: fieldNodeId,
          edge_type: "support",
          field,
          reason: fieldState.resolution_reason
        });
      }
    });
  });

  (conflictMap || []).forEach((conflict, index) => {
    const values = conflict.conflicting_values || [];
    for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
        const left = `candidate:${conflict.field}:${canonicalValueKey(conflict.field, values[leftIndex])}`;
        const right = `candidate:${conflict.field}:${canonicalValueKey(conflict.field, values[rightIndex])}`;
        edges.push({
          from: left,
          to: right,
          edge_type: "contradict",
          field: conflict.field,
          conflict_id: `conflict:${index + 1}`,
          conflict_type: conflict.conflict_type,
          severity: conflict.severity
        });
        edges.push({
          from: right,
          to: left,
          edge_type: "contradict",
          field: conflict.field,
          conflict_id: `conflict:${index + 1}`,
          conflict_type: conflict.conflict_type,
          severity: conflict.severity
        });
      }
    }

    if (conflict.resolved === true && conflict.selected_value !== null && conflict.selected_value !== undefined) {
      values
        .filter((value) => !sameCandidate(conflict.field, value, conflict.selected_value))
        .forEach((value) => {
          edges.push({
            from: `candidate:${conflict.field}:${canonicalValueKey(conflict.field, conflict.selected_value)}`,
            to: `candidate:${conflict.field}:${canonicalValueKey(conflict.field, value)}`,
            edge_type: "override",
            field: conflict.field,
            conflict_id: `conflict:${index + 1}`,
            conflict_type: conflict.conflict_type,
            severity: conflict.severity,
            reason: conflict.resolution || "resolved_by_solver"
          });
        });
    }
  });

  return {
    nodes,
    edges,
    summary: {
      node_count: nodes.length,
      edge_count: edges.length,
      support_edges: edges.filter((edge) => edge.edge_type === "support").length,
      contradict_edges: edges.filter((edge) => edge.edge_type === "contradict").length,
      override_edges: edges.filter((edge) => edge.edge_type === "override").length,
      derived_from_edges: edges.filter((edge) => edge.edge_type === "derived_from").length
    }
  };
}
