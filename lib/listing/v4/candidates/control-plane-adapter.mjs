function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    if (Array.isArray(value.candidates)) return value.candidates.length;
    if (Array.isArray(value.prompt_candidates)) return value.prompt_candidates.length;
  }
  return 0;
}

export function buildV4CandidateControlPlaneTrace(result = {}) {
  const diagnosticCandidateLimit = result.evaluation_profile === "v4_accuracy_ceiling_oracle_v1" ? 20 : 5;
  const trace = result.candidate_application_trace || {};
  const funnel = result.candidate_activation_funnel || {};
  const catalog = result.catalog_activation_funnel || {};
  const vector = result.vector_activation_funnel || {};
  const decision = result.selected_candidate_decision || trace.selected_candidate_decision || null;
  const retrievalApplication = result.retrieval_application || null;
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
  const cardDomainShadow = result.card_domain_reranker_shadow || null;
  // Oracle evaluation may replace the production heuristic decision with the
  // domain reranker decision. The shadow itself retains the actual baseline;
  // prefer it so an audit can measure net changes instead of comparing the
  // reranker with its own already-applied output.
  const heuristicSelectedCandidateId = cardDomainShadow?.baseline_selected_candidate_id
    || decision?.selected_candidate_id
    || null;
  const shadowSelectedCandidateId = shadow?.selected_candidate_id
    || shadow?.shadow_selected_candidate_id
    || shadow?.top_decision_eligible_candidate_id
    || null;
  const shadowSelectedCandidate = Array.isArray(shadow?.ranked_candidates)
    ? shadow.ranked_candidates.find((candidate) => candidate.candidate_id === shadowSelectedCandidateId)
    : null;
  const shadowReranker = shadow
    ? {
      shadow_only: true,
      status: shadow.status || shadow.state || shadow.mode || null,
      model_id: shadow.model_id || shadow.embedding || shadow.mode || "lightgbm-shadow",
      schema_version: shadow.schema_version || null,
      selected_candidate_id: shadowSelectedCandidateId,
      score: shadow.shadow_score ?? shadow.score ?? shadowSelectedCandidate?.score ?? null,
      candidate_count: shadow.candidate_count ?? null,
      heuristic_selected_candidate_id: heuristicSelectedCandidateId,
      would_change_candidate: Boolean(
        shadowSelectedCandidateId
        && heuristicSelectedCandidateId
        && shadowSelectedCandidateId !== heuristicSelectedCandidateId
      ),
      production_decision_affected: false,
      reason: shadow.reason || (shadowSelectedCandidateId ? "shadow_candidate_available" : "fail_closed_no_eligible_domain_candidate"),
      query_feature_count: shadow.query_feature_count ?? null,
      selection_threshold: shadow.selection_threshold ?? null,
      ranked_candidates: Array.isArray(shadow.ranked_candidates) ? shadow.ranked_candidates.slice(0, diagnosticCandidateLimit) : []
    }
    : null;
  const cardDomainSelectedCandidateId = cardDomainShadow?.top_decision_eligible_candidate_id || null;
  const cardDomainOwnsWriterDecision = decision?.selection_owner === "card_domain_reranker_trusted_catalog_v1";
  const cardDomainSelectedCandidate = Array.isArray(cardDomainShadow?.ranked_candidates)
    ? cardDomainShadow.ranked_candidates.find((candidate) => candidate.candidate_id === cardDomainSelectedCandidateId)
    : null;
  const cardDomainReranker = cardDomainShadow
    ? {
      shadow_only: !cardDomainOwnsWriterDecision,
      status: cardDomainOwnsWriterDecision ? "trusted_catalog_active" : cardDomainShadow.mode || null,
      model_id: cardDomainShadow.embedding || null,
      schema_version: cardDomainShadow.schema_version || null,
      selected_candidate_id: cardDomainSelectedCandidateId,
      score: cardDomainSelectedCandidate?.score ?? null,
      candidate_count: cardDomainShadow.candidate_count ?? null,
      heuristic_selected_candidate_id: heuristicSelectedCandidateId,
      would_change_candidate: cardDomainShadow.would_change_decision === true,
      production_decision_affected: cardDomainOwnsWriterDecision,
      reason: cardDomainOwnsWriterDecision
        ? "trusted_catalog_margin_selected"
        : cardDomainSelectedCandidateId
          ? "shadow_candidate_available"
          : "fail_closed_no_eligible_domain_candidate",
      query_feature_count: cardDomainShadow.query_feature_count ?? null,
      selection_threshold: cardDomainShadow.selection_threshold ?? null,
      ranked_candidates: Array.isArray(cardDomainShadow.ranked_candidates)
        ? cardDomainShadow.ranked_candidates.slice(0, diagnosticCandidateLimit)
        : []
    }
    : null;

  return {
    schema_version: "v4-candidate-control-plane-trace-v1",
    candidate_observation_snapshot: result.candidate_observation_snapshot || {},
    selected_candidate_decision: decision,
    participation_level: result.participation_level || decision?.participation_level || "LEVEL_0_SHADOW",
    decision_eligible_candidate_count: Number(result.decision_eligible_candidate_count || 0),
    decision_eligible_candidate_ids: Array.isArray(result.decision_eligible_candidate_ids)
      ? result.decision_eligible_candidate_ids
      : [],
    shadow_only_candidate_count: Number(result.shadow_only_candidate_count || 0),
    shadow_only_candidate_ids: Array.isArray(result.shadow_only_candidate_ids)
      ? result.shadow_only_candidate_ids
      : [],
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
    consensus_product_hierarchy_application: result.consensus_product_hierarchy_application || null,
    selected_candidate_verifier: result.selected_candidate_verifier || null,
    heuristic_baseline: decision
      ? {
        heuristic_version: decision.heuristic_version || application.heuristic_version || null,
        selected_candidate_id: heuristicSelectedCandidateId,
        participation_level: decision.participation_level || null
      }
      : null,
    shadow_reranker: shadowReranker,
    card_domain_reranker: cardDomainReranker,
    candidate_decision_stage: application,
    retrieval_application: retrievalApplication,
    candidate_application_trace_rows: Array.isArray(result.candidate_application_trace)
      ? result.candidate_application_trace
      : []
  };
}
