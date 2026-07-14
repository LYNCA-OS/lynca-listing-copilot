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
  const application = result.candidate_decision_stage || {};
  const appliedFields = Array.isArray(application.field_application?.applied_fields)
    ? application.field_application.applied_fields
    : Array.isArray(funnel.applied_fields)
      ? funnel.applied_fields
      : [];
  const blockedFields = Array.isArray(application.field_application?.blocked_fields)
    ? application.field_application.blocked_fields
    : Array.isArray(funnel.blocked_fields)
      ? funnel.blocked_fields
      : [];
  const appliedFieldCount = application.schema_version
    ? appliedFields.length
    : Number.isFinite(Number(funnel.applied_field_count))
      ? Number(funnel.applied_field_count)
      : Number.isFinite(Number(trace.applied_field_count))
        ? Number(trace.applied_field_count)
        : appliedFields.length;
  const blockedFieldCount = application.schema_version
    ? blockedFields.length
    : Number.isFinite(Number(funnel.blocked_field_count))
      ? Number(funnel.blocked_field_count)
      : Number.isFinite(Number(trace.blocked_field_count))
        ? Number(trace.blocked_field_count)
        : blockedFields.length;
  const shadow = result.workflow_sidecars?.lightgbm || result.shadow_reranker || null;
  const heuristicSelectedCandidateId = decision?.selected_candidate_id || null;
  const shadowSelectedCandidateId = shadow?.selected_candidate_id
    || shadow?.shadow_selected_candidate_id
    || null;
  const shadowReranker = shadow
    ? {
      shadow_only: true,
      status: shadow.status || shadow.state || null,
      model_id: shadow.model_id || shadow.mode || "lightgbm-shadow",
      selected_candidate_id: shadowSelectedCandidateId,
      score: shadow.shadow_score ?? shadow.score ?? null,
      candidate_count: shadow.candidate_count ?? null,
      heuristic_selected_candidate_id: heuristicSelectedCandidateId,
      would_change_candidate: Boolean(
        shadowSelectedCandidateId
        && heuristicSelectedCandidateId
        && shadowSelectedCandidateId !== heuristicSelectedCandidateId
      ),
      production_decision_affected: false,
      reason: shadow.reason || null
    }
    : null;

  return {
    schema_version: "v4-candidate-control-plane-trace-v1",
    selected_candidate_decision: decision,
    participation_level: result.participation_level || decision?.participation_level || "LEVEL_0_SHADOW",
    raw_candidate_count: funnel.raw_candidate_count ?? count(result.raw_candidates),
    prompt_candidate_count: funnel.prompt_candidate_count ?? count(result.prompt_candidates),
    heuristic_version: application.heuristic_version || null,
    applied_field_count: appliedFieldCount,
    applied_fields: appliedFields,
    blocked_field_count: blockedFieldCount,
    blocked_fields: blockedFields,
    field_permissions: trace.field_permissions || {},
    per_field: trace.per_field || trace.fields || {},
    catalog_activation_funnel: catalog,
    vector_activation_funnel: vector,
    candidate_activation_funnel: funnel,
    low_margin_safe_field_application: result.low_margin_safe_field_application || null,
    selected_candidate_safe_field_application: result.selected_candidate_safe_field_application || null,
    selected_candidate_verifier: result.selected_candidate_verifier || null,
    heuristic_baseline: decision
      ? {
        heuristic_version: decision.heuristic_version || application.heuristic_version || null,
        selected_candidate_id: heuristicSelectedCandidateId,
        participation_level: decision.participation_level || null
      }
      : null,
    shadow_reranker: shadowReranker,
    candidate_decision_stage: application,
    candidate_application_trace_rows: Array.isArray(result.candidate_application_trace)
      ? result.candidate_application_trace
      : []
  };
}
