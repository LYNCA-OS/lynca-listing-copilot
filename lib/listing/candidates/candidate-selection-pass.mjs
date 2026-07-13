import {
  buildCandidateApplicationTrace,
  candidateDirectConflicts,
  candidateFieldEvidenceRows,
  candidateFields,
  candidateId,
  candidateIsMarketplace,
  candidateIsVectorOnly,
  candidateSourceTrust,
  candidateSourceType,
  fieldPermissions,
  participationLevels,
  sourceTrustScore
} from "./candidate-application-policy.mjs";
import { semCatalogTrustVerdict } from "../csm/sem-definition.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanComparable(value) {
  return cleanText(Array.isArray(value) ? value.join(" ") : value)
    .toLowerCase()
    .replace(/[#.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function packetCandidates(packet = {}) {
  return Array.isArray(packet?.vector_retrieval?.candidates)
    ? packet.vector_retrieval.candidates
    : [];
}

function packetFieldSupport(packet = {}) {
  return Array.isArray(packet?.vector_retrieval?.field_support)
    ? packet.vector_retrieval.field_support
    : [];
}

function packetSignal(packet = {}) {
  const retrieval = packet?.vector_retrieval || {};
  const unavailable = Array.isArray(retrieval.unavailable) ? retrieval.unavailable : [];
  return {
    status: retrieval.status || null,
    status_code: retrieval.status_code || null,
    unavailable_reasons: unavailable.map((item) => cleanText(item.reason)).filter(Boolean)
  };
}

function providerMetadataForLane(lane, context = {}) {
  const trace = Array.isArray(context?.retrieval?.trace) ? context.retrieval.trace : [];
  const laneProvider = lane === "vector" ? "visual_vector" : lane;
  const entry = [...trace].reverse().find((row) => row?.provider_id === laneProvider && row?.metadata);
  return entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
}

function vectorRuntimeDiagnostics(context = {}) {
  const signal = packetSignal(context.packet || {});
  const metadata = providerMetadataForLane("vector", context);
  return {
    vector_runtime_status: signal.status || context.mode || null,
    vector_runtime_status_code: signal.status_code || null,
    vector_runtime_unavailable_reasons: signal.unavailable_reasons || [],
    vector_worker_status: context?.worker?.status || null,
    vector_worker_reason: context?.worker?.reason || "",
    vector_worker_feature_count: Array.isArray(context?.worker?.features) ? context.worker.features.length : null,
    vector_worker_latency_ms: context?.worker?.latency_ms ?? null,
    vector_worker_attempt_count: context?.worker?.attempt_count ?? null,
    vector_query_embedding_role: metadata.query_embedding_role || "",
    vector_role_agnostic_fallback_used: metadata.role_agnostic_fallback_used === true,
    vector_role_agnostic_fallback_reason: metadata.role_agnostic_fallback_reason || "",
    vector_returned_row_count: Number.isFinite(Number(metadata.returned_row_count))
      ? Number(metadata.returned_row_count)
      : null,
    vector_self_excluded_count: Number.isFinite(Number(metadata.self_excluded_count))
      ? Number(metadata.self_excluded_count)
      : null
  };
}

function eligibilityFromContext(context = {}) {
  return context.catalog_assist_eligibility
    || context.vector_assist_eligibility
    || context.assistPacket?.vector_retrieval?.assist_filter
    || {};
}

function nonEmptyEligibility(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) return value;
  }
  return {};
}

function promptIdsFromEligibility(eligibility = {}) {
  return new Set(Array.isArray(eligibility.prompt_candidate_ids) ? eligibility.prompt_candidate_ids : []);
}

function candidatePromptId(candidate = {}) {
  return cleanText(candidate.candidate_identity_id || candidate.identity_id || candidate.candidate_id || candidate.source_url);
}

function candidateScore(candidate = {}) {
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  const agreedCount = Array.isArray(agreement.agreed) ? agreement.agreed.length : 0;
  const contradictedCount = Array.isArray(agreement.contradicted) ? agreement.contradicted.length : 0;
  const directConflictCount = candidateDirectConflicts(candidate).length;
  const exactCodeBonus = agreement.exact_code_match === true ? 1.4 : 0;
  const vectorSimilarity = Math.max(
    numberValue(candidate.front_similarity, 0),
    numberValue(candidate.back_similarity, 0),
    numberValue(candidate.visual_similarity, 0),
    numberValue(candidate.similarity, 0),
    numberValue(candidate.combined_score, 0)
  );
  const trustScore = sourceTrustScore(candidateSourceTrust(candidate)) * 0.18;
  const rawScore = Math.max(
    numberValue(candidate.match_score, 0),
    numberValue(candidate.normalized_score, 0),
    numberValue(candidate.rerank_score, 0),
    numberValue(candidate.rank_fusion_score, 0)
  );
  return Number((
    trustScore
    + exactCodeBonus
    + agreedCount * 0.22
    + rawScore * 0.3
    + vectorSimilarity * 0.2
    - contradictedCount * 0.55
    - directConflictCount * 0.8
    - (candidateIsMarketplace(candidate) ? 0.8 : 0)
  ).toFixed(6));
}

function observedFieldsFromResult(result = {}) {
  const resolved = result.resolved_fields || result.resolved || result.fields || {};
  const evidence = result.evidence || result.provider_evidence || result.generated_evidence || {};
  return {
    ...resolved,
    ...(evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {})
  };
}

function fieldValueMatchesCurrentImage(candidateValue, observedValue) {
  if (candidateValue === null || candidateValue === undefined || observedValue === null || observedValue === undefined) return false;
  const left = cleanComparable(candidateValue);
  const right = cleanComparable(observedValue);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Array.isArray(candidateValue) || Array.isArray(observedValue)) {
    const leftTokens = new Set(left.split(" ").filter(Boolean));
    const rightTokens = new Set(right.split(" ").filter(Boolean));
    if (!leftTokens.size || !rightTokens.size) return false;
    let matches = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) matches += 1;
    }
    return matches === leftTokens.size || matches === rightTokens.size;
  }
  return false;
}

function currentImageSupportedFields(candidate = {}, result = {}) {
  const observed = observedFieldsFromResult(result);
  const fields = candidateFields(candidate);
  const supported = [];
  for (const [field, value] of Object.entries(fields)) {
    const observedValue = observed[field];
    if (fieldValueMatchesCurrentImage(value, observedValue)) supported.push(field);
  }
  return supported;
}

function agreementHas(agreement = {}, field = "") {
  return Array.isArray(agreement.agreed) && agreement.agreed.includes(field);
}

function matchLevelForCandidate(candidate = {}) {
  if (candidateDirectConflicts(candidate).length) return "NO_MATCH";
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  const vectorOnly = candidateIsVectorOnly(candidate);
  const product = agreementHas(agreement, "product_hierarchy");
  const subject = agreementHas(agreement, "subjects");
  const year = agreementHas(agreement, "year");
  const exactCode = agreement.exact_code_match === true;
  if (!vectorOnly && exactCode && subject && (product || year)) return "EXACT_CARD_MATCH";
  if (!vectorOnly && exactCode && (product || subject)) return "SET_LEVEL_MATCH";
  if (product && subject && year) return vectorOnly ? "PRODUCT_LEVEL_MATCH" : "SET_LEVEL_MATCH";
  if (product && (subject || year)) return "PRODUCT_LEVEL_MATCH";
  if (product || subject || year) return "SAFE_DRAFT_ONLY";
  return "NO_MATCH";
}

function rejectReasons(candidate = {}) {
  const reasons = [];
  const direct = candidateDirectConflicts(candidate);
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  if (direct.length) reasons.push(`direct_conflict:${direct.join(",")}`);
  if (Array.isArray(agreement.contradicted) && agreement.contradicted.length) {
    reasons.push(`anchor_contradiction:${agreement.contradicted.join(",")}`);
  }
  if (candidateIsMarketplace(candidate)) reasons.push("marketplace_not_truth");
  if (candidateIsVectorOnly(candidate) && matchLevelForCandidate(candidate) === "EXACT_CARD_MATCH") {
    reasons.push("vector_only_cannot_exact_match");
  }
  if (candidate.reference_print_run_numerator_copy_violation_count || candidate.catalog_full_print_run_copy_violation_count) {
    reasons.push("reference_print_run_numerator_forbidden");
  }
  return reasons;
}

function participationLevelForCandidate(candidate = {}, {
  promptIds = new Set(),
  evidenceRows = [],
  appliedFields = []
} = {}) {
  if (appliedFields.length) return participationLevels.FIELD_APPLICATION;
  if (evidenceRows.length) return participationLevels.EVIDENCE_SUPPORT;
  if (promptIds.has(candidatePromptId(candidate))) return participationLevels.PROMPT_ASSIST;
  return participationLevels.SHADOW;
}

function selectedReasonCodes(candidate = {}, margin = 0) {
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  return [
    agreement.exact_code_match === true ? "exact_code_anchor" : "",
    Array.isArray(agreement.agreed) && agreement.agreed.length ? `anchor_agreement:${agreement.agreed.join(",")}` : "",
    sourceTrustScore(candidateSourceTrust(candidate)) >= 5 ? "trusted_source" : "",
    margin < 0.08 ? "low_margin" : ""
  ].filter(Boolean);
}

function selectedCandidateDecision(candidates = [], traces = []) {
  const scored = candidates.map((candidate, index) => ({
    candidate,
    trace: traces[index],
    score: candidateScore(candidate),
    match_level: matchLevelForCandidate(candidate),
    rejected_reasons: rejectReasons(candidate)
  })).sort((left, right) => right.score - left.score);

  const viable = scored.filter((row) => row.rejected_reasons.length === 0 && row.match_level !== "NO_MATCH");
  const top = viable[0] || null;
  const second = viable[1] || null;
  const margin = top ? Number((top.score - (second?.score ?? 0)).toFixed(6)) : 0;
  const lowMargin = top && margin < 0.08;
  const selected = top && !lowMargin ? top : null;
  return {
    selected_candidate_id: selected ? candidateId(selected.candidate) : "",
    selected_candidate_source: selected ? candidateSourceType(selected.candidate) : "",
    selected_candidate_source_trust: selected ? candidateSourceTrust(selected.candidate) : "",
    match_level: selected ? selected.match_level : top ? "SAFE_DRAFT_ONLY" : "NO_MATCH",
    selection_confidence: selected ? Math.max(0, Math.min(1, Number((0.45 + selected.score / 4).toFixed(4)))) : 0,
    selection_margin: top ? margin : 0,
    top_candidate_id: top ? candidateId(top.candidate) : "",
    second_candidate_id: second ? candidateId(second.candidate) : "",
    top_candidate_score: top ? top.score : 0,
    second_candidate_score: second ? second.score : 0,
    low_margin_candidate_id: lowMargin ? candidateId(top.candidate) : "",
    none_of_the_above_score: selected ? 0 : top ? 0.45 : 0.9,
    selected_reason_codes: selected ? selectedReasonCodes(selected.candidate, margin) : top ? ["low_margin_no_application"] : ["no_viable_candidate"],
    rejected_candidate_reasons: scored.map((row) => ({
      candidate_id: candidateId(row.candidate),
      match_level: row.match_level,
      score: row.score,
      reasons: row.rejected_reasons.length ? row.rejected_reasons : row === top && lowMargin ? ["low_margin"] : []
    }))
  };
}

function buildLowMarginSafeFieldApplication({
  decision = {},
  candidates = [],
  traces = [],
  result = {}
} = {}) {
  if (!decision.low_margin_candidate_id) {
    return {
      status: "not_needed",
      candidate_id: "",
      supported_fields: [],
      verifier_required_fields: [],
      blocked_fields: [],
      policy: "candidate_fields_apply_only_after_selection_or_current_image_verifier"
    };
  }
  const candidateIndex = candidates.findIndex((candidate) => candidateId(candidate) === decision.low_margin_candidate_id);
  const candidate = candidateIndex >= 0 ? candidates[candidateIndex] : {};
  const trace = traces[candidateIndex] || {};
  const supported = currentImageSupportedFields(candidate, result)
    .filter((field) => !trace.forbidden_fields?.includes(field));
  const candidateFieldNames = Object.keys(candidateFields(candidate));
  const verifierRequired = candidateFieldNames.filter((field) => (
    !supported.includes(field)
    && !trace.forbidden_fields?.includes(field)
    && !trace.suggest_only_fields?.includes(field)
  ));
  return {
    status: supported.length ? "evidence_support_only" : "blocked_pending_verifier",
    candidate_id: decision.low_margin_candidate_id,
    supported_fields: supported,
    verifier_required_fields: verifierRequired,
    blocked_fields: [
      ...new Set([
        ...(trace.forbidden_fields || []),
        ...(trace.suggest_only_fields || [])
      ])
    ],
    policy: "low_margin_candidates_may_support_matching_current_image_fields_but_cannot_render_unverified_fields",
    renderer_application_allowed: false
  };
}

const selectedCandidateExactIdentityFields = new Set([
  "year",
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "insert",
  "subset",
  "language",
  "rarity",
  "players",
  "character",
  "card_name",
  "collector_number",
  "checklist_code",
  "card_number",
  "tcg_card_number",
  "official_card_type"
]);

const selectedCandidateProductHierarchyFields = new Set([
  "manufacturer",
  "brand",
  "product"
]);

function selectedCandidateFieldApplicationReason(field, agreement = {}) {
  const agreed = new Set(Array.isArray(agreement.agreed) ? agreement.agreed : []);
  if (agreement.exact_code_match === true && selectedCandidateExactIdentityFields.has(field)) {
    return "trusted_exact_code_identity_fill";
  }
  if (agreed.has("product_hierarchy") && selectedCandidateProductHierarchyFields.has(field)) {
    return "trusted_product_hierarchy_fill";
  }
  if (agreed.has("year") && field === "year") return "trusted_year_anchor_fill";
  return "";
}

function buildSelectedCandidateSafeFieldApplication({
  decision = {},
  candidates = [],
  traces = []
} = {}) {
  const selectedId = cleanText(decision.selected_candidate_id);
  if (!selectedId) {
    return {
      status: "not_selected",
      candidate_id: "",
      eligible_fields: [],
      blocked_fields: [],
      field_reasons: {},
      renderer_application_allowed: false,
      policy: "only_a_selected_trusted_candidate_may_fill_missing_identity_fields"
    };
  }

  const candidateIndex = candidates.findIndex((candidate) => candidateId(candidate) === selectedId);
  const candidate = candidateIndex >= 0 ? candidates[candidateIndex] : null;
  const trace = traces[candidateIndex] || {};
  const agreement = candidate?.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  const semVerdict = candidate ? semCatalogTrustVerdict({
    sourceType: candidateSourceType(candidate),
    sourceTrust: candidateSourceTrust(candidate),
    anchorAgreement: agreement,
    directConflicts: candidateDirectConflicts(candidate),
    materialConflicts: candidate.conflicting_fields || []
  }) : { allowed: false, reason: "selected_candidate_missing" };
  const trusted = candidate
    && !candidateIsVectorOnly(candidate)
    && !candidateIsMarketplace(candidate)
    && sourceTrustScore(candidateSourceTrust(candidate)) >= 5
    && semVerdict.allowed === true
    && candidateCanSupportEvidence(candidate);

  if (!trusted) {
    return {
      status: "blocked",
      candidate_id: selectedId,
      eligible_fields: [],
      blocked_fields: Object.keys(candidate ? candidateFields(candidate) : {}),
      field_reasons: {},
      renderer_application_allowed: false,
      blocked_reason: semVerdict.reason || "selected_candidate_not_trusted_for_field_application",
      policy: "vector_marketplace_conflicting_or_unanchored_candidates_never_apply_fields"
    };
  }

  const eligibleFields = [];
  const fieldReasons = {};
  const blockedFields = new Set([
    ...(trace.forbidden_fields || []),
    ...(trace.suggest_only_fields || [])
  ]);
  for (const field of trace.can_apply_fields || []) {
    const reason = selectedCandidateFieldApplicationReason(field, agreement);
    if (!reason) {
      blockedFields.add(field);
      continue;
    }
    eligibleFields.push(field);
    fieldReasons[field] = reason;
  }

  return {
    status: eligibleFields.length ? "ready_fill_missing" : "blocked_no_safe_fields",
    candidate_id: selectedId,
    eligible_fields: eligibleFields,
    blocked_fields: [...blockedFields],
    field_reasons: fieldReasons,
    renderer_application_allowed: eligibleFields.length > 0,
    policy: "fill_missing_identity_fields_only_from_selected_trusted_conflict_free_anchor_candidate"
  };
}

function flattenCandidateRows({ catalogPacket = {}, vectorPacket = {} } = {}) {
  return [
    ...packetCandidates(catalogPacket).map((candidate) => ({ ...candidate, __candidate_lane: "catalog" })),
    ...packetCandidates(vectorPacket).map((candidate) => ({ ...candidate, __candidate_lane: "vector" }))
  ];
}

function permissionValue(trace = {}, fieldName = "") {
  return trace.field_permissions?.[fieldName] || "";
}

function candidateCanSupportEvidence(candidate = {}) {
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  if (candidateDirectConflicts(candidate).length) return false;
  if (Array.isArray(agreement.contradicted) && agreement.contradicted.length) return false;
  const semVerdict = semCatalogTrustVerdict({
    sourceType: candidateSourceType(candidate),
    sourceTrust: candidateSourceTrust(candidate),
    anchorAgreement: agreement,
    directConflicts: candidateDirectConflicts(candidate),
    materialConflicts: candidate.conflicting_fields || []
  });
  if (Object.prototype.hasOwnProperty.call(agreement, "prompt_hard_filter_pass")) {
    return agreement.prompt_hard_filter_pass === true && semVerdict.allowed === true;
  }
  return semVerdict.allowed === true;
}

function applicationTraceRows({ candidates = [], catalogPromptIds = new Set(), vectorPromptIds = new Set() } = {}) {
  return candidates.map((candidate) => {
    const promptIds = candidate.__candidate_lane === "catalog" ? catalogPromptIds : vectorPromptIds;
    const baseTrace = buildCandidateApplicationTrace(candidate, {
      matchLevel: matchLevelForCandidate(candidate)
    });
    const evidenceRows = candidateCanSupportEvidence(candidate)
      ? candidateFieldEvidenceRows(candidate, baseTrace).filter((row) => row.permission !== fieldPermissions.SUGGEST_ONLY)
      : [];
    const participationLevel = participationLevelForCandidate(candidate, {
      promptIds,
      evidenceRows,
      appliedFields: []
    });
    const reasonPerField = {};
    for (const fieldName of Object.keys(candidateFields(candidate))) {
      const permission = permissionValue(baseTrace, fieldName);
      reasonPerField[fieldName] = permission === fieldPermissions.FORBIDDEN
        ? "forbidden_reference_instance_or_physical_field"
        : permission === fieldPermissions.SUGGEST_ONLY
          ? "suggest_only_low_trust_or_unmodeled_field"
          : permission === fieldPermissions.SUPPORT_ONLY
            ? "support_only_requires_current_image_or_catalog_selection"
            : "can_apply_after_resolver_gate";
    }
    return {
      ...buildCandidateApplicationTrace(candidate, {
      participationLevel,
      matchLevel: baseTrace.match_level,
      appliedFields: [],
      blockedFields: rejectReasons(candidate).flatMap((reason) => reason.split(":")[1]?.split(",") || []),
      reasonPerField
      }),
      candidate_lane: candidate.__candidate_lane || ""
    };
  });
}

function maxParticipationLevel(traces = []) {
  const order = [
    participationLevels.SHADOW,
    participationLevels.PROMPT_ASSIST,
    participationLevels.EVIDENCE_SUPPORT,
    participationLevels.FIELD_APPLICATION
  ];
  let maxIndex = 0;
  for (const trace of traces) {
    const index = order.indexOf(trace.participation_level);
    if (index > maxIndex) maxIndex = index;
  }
  return order[maxIndex];
}

function funnelForLane({
  lane = "catalog",
  context = {},
  traceRows = [],
  selectedDecision = {},
  promptAssistUsed = false
} = {}) {
  const eligibility = eligibilityFromContext(context);
  const rows = traceRows.filter((trace) => trace.candidate_lane === lane);
  const evidenceRows = rows.filter((trace) => [
    participationLevels.EVIDENCE_SUPPORT,
    participationLevels.FIELD_APPLICATION
  ].includes(trace.participation_level));
  const participationLevel = maxParticipationLevel(rows);
  const selectedId = rows.some((trace) => trace.candidate_id === selectedDecision.selected_candidate_id)
    ? selectedDecision.selected_candidate_id
    : "";
  const phaseText = cleanText(context.catalog_anchor_plan?.phase || context.retrieval_phase || "");
  return {
    query_attempted: Boolean(context.packet || context.retrieval),
    pre_observation_query_attempted: !phaseText.includes("provider_observation"),
    post_observation_query_attempted: phaseText.includes("provider_observation"),
    raw_candidate_count: Number(eligibility.raw_candidate_count || 0),
    approved_candidate_count: Number(eligibility.approved_candidate_count || 0),
    trust_blocked_count: Number(eligibility.trust_blocked_count || 0),
    conflict_blocked_count: Number(eligibility.conflict_blocked_count || 0),
    prompt_candidate_count: Number(eligibility.prompt_candidate_count || 0),
    prompt_assist_used: promptAssistUsed === true,
    selected_candidate_id: selectedId,
    evidence_support_field_count: evidenceRows.reduce((sum, trace) => sum + Number(trace.support_only_fields?.length || 0) + Number(trace.can_apply_fields?.length || 0), 0),
    applied_field_count: 0,
    applied_fields: [],
    blocked_fields: [...new Set(rows.flatMap((trace) => trace.blocked_fields || []))],
    title_changed: false,
    participation_level: participationLevel,
    blocked_reasons: [...new Set(rows.flatMap((trace) => selectedDecision.rejected_candidate_reasons
      ?.find((reason) => reason.candidate_id === trace.candidate_id)?.reasons || []))]
  };
}

export function buildCandidateSelectionPass({
  result = {},
  catalogContext = {},
  vectorContext = {}
} = {}) {
  const catalogPacket = result.catalog_candidate_packet || catalogContext.packet || {};
  const vectorPacket = result.vector_candidate_packet || vectorContext.packet || {};
  const catalogEligibility = nonEmptyEligibility(
    result.catalog_assist_eligibility,
    eligibilityFromContext(catalogContext),
    catalogPacket?.vector_retrieval?.assist_filter
  );
  const vectorEligibility = nonEmptyEligibility(
    result.vector_assist_eligibility,
    eligibilityFromContext(vectorContext),
    vectorPacket?.vector_retrieval?.assist_filter
  );
  const catalogPromptIds = promptIdsFromEligibility(catalogEligibility);
  const vectorPromptIds = promptIdsFromEligibility(vectorEligibility);
  const candidates = flattenCandidateRows({ catalogPacket, vectorPacket });
  const traces = applicationTraceRows({ candidates, catalogPromptIds, vectorPromptIds });
  const decision = selectedCandidateDecision(candidates, traces);
  const lowMarginSafeFieldApplication = buildLowMarginSafeFieldApplication({
    decision,
    candidates,
    traces,
    result
  });
  const selectedCandidateSafeFieldApplication = buildSelectedCandidateSafeFieldApplication({
    decision,
    candidates,
    traces
  });
  const fieldEvidence = traces.flatMap((trace, index) => (
    candidateCanSupportEvidence(candidates[index])
      ? candidateFieldEvidenceRows(candidates[index], trace)
      : []
  ));
  const participationLevel = maxParticipationLevel(traces);
  const catalogFunnel = funnelForLane({
    lane: "catalog",
    context: {
      ...catalogContext,
      packet: catalogContext.packet || catalogPacket,
      catalog_assist_eligibility: catalogEligibility
    },
    traceRows: traces,
    selectedDecision: decision,
    promptAssistUsed: result.catalog_prompt_assist_used === true || catalogContext.promptPacket === true
  });
  const vectorFunnel = {
    ...funnelForLane({
      lane: "vector",
      context: {
        ...vectorContext,
        packet: vectorContext.packet || vectorPacket,
        vector_assist_eligibility: vectorEligibility
      },
      traceRows: traces,
      selectedDecision: decision,
      promptAssistUsed: result.vector_prompt_assist_used === true || vectorContext.promptPacket === true
    }),
    ...vectorRuntimeDiagnostics({
      ...vectorContext,
      packet: vectorContext.packet || vectorPacket
    }),
    vector_lazy_skip: result.vector_lazy_skip?.skipped === true || vectorContext.vector_lazy_skip?.skipped === true,
    vector_lazy_skip_reason: result.vector_lazy_skip?.reason || vectorContext.vector_lazy_skip?.reason || ""
  };

  return {
    participation_level: participationLevel,
    selected_candidate_decision: decision,
    candidate_application_trace: traces,
    candidate_field_evidence: fieldEvidence,
    candidate_activation_funnel: {
      participation_level: participationLevel,
      selected_candidate_id: decision.selected_candidate_id,
      evidence_support_field_count: fieldEvidence.length,
      applied_field_count: 0,
      title_changed: false
    },
    catalog_activation_funnel: catalogFunnel,
    vector_activation_funnel: vectorFunnel,
    low_margin_safe_field_application: lowMarginSafeFieldApplication,
    selected_candidate_safe_field_application: selectedCandidateSafeFieldApplication,
    pre_observation_candidate_count: (catalogFunnel.pre_observation_query_attempted ? catalogFunnel.raw_candidate_count : 0)
      + (vectorFunnel.pre_observation_query_attempted ? vectorFunnel.raw_candidate_count : 0),
    post_observation_candidate_count: (catalogFunnel.post_observation_query_attempted ? catalogFunnel.raw_candidate_count : 0)
      + (vectorFunnel.post_observation_query_attempted ? vectorFunnel.raw_candidate_count : 0),
    post_observation_selected_candidate_id: (catalogFunnel.post_observation_query_attempted || vectorFunnel.post_observation_query_attempted)
      ? decision.selected_candidate_id
      : "",
    retrieval_used_observation_fields: [...new Set(traces.flatMap((trace) => trace.anchor_agreement?.agreed || []))],
    selected_candidate_verifier: {
      enabled: Boolean(decision.low_margin_candidate_id),
      status: decision.low_margin_candidate_id
        ? (lowMarginSafeFieldApplication.status === "evidence_support_only" ? "current_image_support_only" : "verifier_required")
        : "not_run",
      reason: decision.low_margin_candidate_id
        ? "low_margin_candidate_requires_current_image_evidence_or_specialized_verifier_before field application"
        : "no_low_margin_candidate"
    }
  };
}
