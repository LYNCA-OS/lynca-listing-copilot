function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    if (Array.isArray(value.candidates)) return value.candidates.length;
    if (Array.isArray(value.prompt_candidates)) return value.prompt_candidates.length;
  }
  return 0;
}

export function buildV4CandidateControlPlaneTrace(result = {}) {
  const trace = result.candidate_application_trace || {};
  const funnel = result.candidate_activation_funnel || {};
  const catalog = result.catalog_activation_funnel || {};
  const vector = result.vector_activation_funnel || {};
  const decision = result.selected_candidate_decision || trace.selected_candidate_decision || null;

  return {
    schema_version: "v4-candidate-control-plane-trace-v1",
    selected_candidate_decision: decision,
    participation_level: result.participation_level || decision?.participation_level || "LEVEL_0_SHADOW",
    raw_candidate_count: funnel.raw_candidate_count ?? count(result.raw_candidates),
    prompt_candidate_count: funnel.prompt_candidate_count ?? count(result.prompt_candidates),
    applied_field_count: trace.applied_field_count ?? 0,
    blocked_field_count: trace.blocked_field_count ?? 0,
    field_permissions: trace.field_permissions || {},
    per_field: trace.per_field || trace.fields || {},
    catalog_activation_funnel: catalog,
    vector_activation_funnel: vector,
    candidate_activation_funnel: funnel
  };
}
