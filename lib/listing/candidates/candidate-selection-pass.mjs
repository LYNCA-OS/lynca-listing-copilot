import {
  buildCandidateApplicationTrace,
  candidateDirectConflicts,
  candidateFieldSource,
  candidateFieldEvidenceRows,
  candidateFieldInventoryRows,
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
import {
  candidateHasPromptIdentityAnchor,
  rebindCandidateToObservedFields
} from "../retrieval/vector-candidate-packet.mjs";

export const candidateSelectionHeuristicV1 = Object.freeze({
  version: "candidate-heuristic-v3-instance-fields-sanitized-20260714",
  weights: Object.freeze({
    exact_code_bonus: 1.4,
    anchor_agreement: 0.22,
    source_trust: 0.18,
    raw_score: 0.3,
    vector_similarity: 0.2,
    anchor_contradiction: 0.55,
    direct_conflict: 0.8,
    marketplace: 0.8
  }),
  low_margin_threshold: 0.08
});

export const candidateSelectionHeuristicVersion = candidateSelectionHeuristicV1.version;

const candidateObservationFieldNames = Object.freeze([
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "insert",
  "player",
  "players",
  "character",
  "collector_number",
  "card_number",
  "checklist_code",
  "serial_denominator",
  "print_run_denominator",
  "expected_serial_denominator"
]);

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

function candidatePromptIds(candidate = {}) {
  return [...new Set([
    candidate.candidate_identity_id,
    candidate.identity_id,
    candidate.candidate_id,
    candidate.source_url
  ].map(cleanText).filter(Boolean))];
}

function candidateIsPromptEligible(candidate = {}, promptIds = new Set()) {
  return candidatePromptIds(candidate).some((id) => promptIds.has(id));
}

function candidateIdentityGroupKey(candidate = {}) {
  return cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || candidateId(candidate);
}

function candidateScore(candidate = {}) {
  const weights = candidateSelectionHeuristicV1.weights;
  const agreement = candidate.anchor_agreement && typeof candidate.anchor_agreement === "object"
    ? candidate.anchor_agreement
    : {};
  const agreedCount = Array.isArray(agreement.agreed) ? agreement.agreed.length : 0;
  const contradictedCount = Array.isArray(agreement.contradicted) ? agreement.contradicted.length : 0;
  const directConflictCount = candidateDirectConflicts(candidate).length;
  const exactCodeBonus = agreement.exact_code_match === true ? weights.exact_code_bonus : 0;
  const vectorSimilarity = Math.max(
    numberValue(candidate.front_similarity, 0),
    numberValue(candidate.back_similarity, 0),
    numberValue(candidate.visual_similarity, 0),
    numberValue(candidate.similarity, 0),
    numberValue(candidate.combined_score, 0)
  );
  const trustScore = sourceTrustScore(candidateSourceTrust(candidate)) * weights.source_trust;
  const rawScore = Math.max(
    numberValue(candidate.match_score, 0),
    numberValue(candidate.normalized_score, 0),
    numberValue(candidate.rerank_score, 0),
    numberValue(candidate.rank_fusion_score, 0)
  );
  return Number((
    trustScore
    + exactCodeBonus
    + agreedCount * weights.anchor_agreement
    + rawScore * weights.raw_score
    + vectorSimilarity * weights.vector_similarity
    - contradictedCount * weights.anchor_contradiction
    - directConflictCount * weights.direct_conflict
    - (candidateIsMarketplace(candidate) ? weights.marketplace : 0)
  ).toFixed(6));
}

function observedFieldsFromResult(result = {}) {
  const output = {};
  const assignMissingScalars = (fields = {}) => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
    for (const [field, value] of Object.entries(fields)) {
      if (output[field] !== null && output[field] !== undefined && cleanText(output[field])) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) continue;
      const normalizedValue = Array.isArray(value)
        ? value.filter((item) => item !== null && item !== undefined && typeof item !== "object" && cleanText(item))
        : value;
      if (Array.isArray(normalizedValue) && !normalizedValue.length) continue;
      output[field] = normalizedValue;
    }
  };

  // Candidate decisions must use one current-image snapshot. Final normalized
  // fields own the value; provider/raw fields may only fill gaps. In
  // particular, never spread EvidenceField objects over resolved scalars:
  // `{ value, status, sources }` used to become "[object Object]" downstream
  // and manufactured false year/product conflicts.
  assignMissingScalars(result.resolved_fields);
  assignMissingScalars(result.resolved);
  assignMissingScalars(result.fields);
  assignMissingScalars(result.raw_provider_fields);

  const evidenceSources = [
    result.normalized_evidence,
    result.evidence,
    result.provider_evidence,
    result.generated_evidence
  ];
  for (const evidence of evidenceSources) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) continue;
    const evidenceValues = {};
    for (const [field, entry] of Object.entries(evidence)) {
      if (entry !== null && entry !== undefined && (typeof entry !== "object" || Array.isArray(entry))) {
        evidenceValues[field] = entry;
        continue;
      }
      if (!entry || Array.isArray(entry)) continue;
      const value = entry.normalized_value ?? entry.normalizedValue ?? entry.value ?? entry.resolved_value;
      if (value !== null && value !== undefined && (typeof value !== "object" || Array.isArray(value))) {
        evidenceValues[field] = value;
      }
    }
    assignMissingScalars(evidenceValues);
  }

  return output;
}

function compactObservedFields(fields = {}) {
  const output = {};
  for (const field of candidateObservationFieldNames) {
    const value = fields[field];
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) continue;
    if (!cleanText(value)) continue;
    output[field] = value;
  }
  return output;
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
  return reasons;
}

function sanitizedReferenceInstanceFields(candidate = {}) {
  if (!candidate.reference_print_run_numerator_copy_violation_count
    && !candidate.catalog_full_print_run_copy_violation_count) return [];
  return ["serial_number", "print_run_numerator"];
}

function participationLevelForCandidate(candidate = {}, {
  promptEligible = false,
  evidenceRows = [],
  appliedFields = []
} = {}) {
  if (appliedFields.length) return participationLevels.FIELD_APPLICATION;
  if (!promptEligible) return participationLevels.SHADOW;
  if (evidenceRows.length) return participationLevels.EVIDENCE_SUPPORT;
  if (promptEligible) return participationLevels.PROMPT_ASSIST;
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
    sanitizedReferenceInstanceFields(candidate).length ? "reference_instance_fields_sanitized" : "",
    margin < candidateSelectionHeuristicV1.low_margin_threshold ? "low_margin" : ""
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
  const identityGroups = new Map();
  for (const row of viable) {
    const key = candidateIdentityGroupKey(row.candidate);
    const rows = identityGroups.get(key) || [];
    rows.push(row);
    identityGroups.set(key, rows);
  }
  const grouped = [...identityGroups.entries()].map(([key, rows]) => {
    const ordered = [...rows].sort((left, right) => {
      const leftTrustedCatalog = !candidateIsVectorOnly(left.candidate)
        && !candidateIsMarketplace(left.candidate)
        && sourceTrustScore(candidateSourceTrust(left.candidate)) >= 5;
      const rightTrustedCatalog = !candidateIsVectorOnly(right.candidate)
        && !candidateIsMarketplace(right.candidate)
        && sourceTrustScore(candidateSourceTrust(right.candidate)) >= 5;
      if (leftTrustedCatalog !== rightTrustedCatalog) return leftTrustedCatalog ? -1 : 1;
      const leftVector = candidateIsVectorOnly(left.candidate) ? 1 : 0;
      const rightVector = candidateIsVectorOnly(right.candidate) ? 1 : 0;
      if (leftVector !== rightVector) return leftVector - rightVector;
      const trustDelta = sourceTrustScore(candidateSourceTrust(right.candidate))
        - sourceTrustScore(candidateSourceTrust(left.candidate));
      if (trustDelta !== 0) return trustDelta;
      return right.score - left.score;
    });
    return {
      key,
      representative: ordered[0],
      member_candidate_ids: rows.map((row) => candidateId(row.candidate)).filter(Boolean)
    };
  }).sort((left, right) => right.representative.score - left.representative.score);
  const topGroup = grouped[0] || null;
  const secondGroup = grouped[1] || null;
  const top = topGroup?.representative || null;
  const second = secondGroup?.representative || null;
  const margin = top ? Number((top.score - (second?.score ?? 0)).toFixed(6)) : 0;
  const lowMargin = top && margin < candidateSelectionHeuristicV1.low_margin_threshold;
  const selected = top && !lowMargin ? top : null;
  return {
    heuristic_version: candidateSelectionHeuristicVersion,
    decision_eligible_candidate_count: candidates.length,
    viable_candidate_count: viable.length,
    viable_identity_group_count: grouped.length,
    selected_candidate_id: selected ? candidateId(selected.candidate) : "",
    selected_candidate_identity_group_key: selected ? topGroup.key : "",
    selected_candidate_group_ids: selected ? topGroup.member_candidate_ids : [],
    selected_candidate_source: selected ? candidateSourceType(selected.candidate) : "",
    selected_candidate_source_trust: selected ? candidateSourceTrust(selected.candidate) : "",
    match_level: selected ? selected.match_level : top ? "SAFE_DRAFT_ONLY" : "NO_MATCH",
    selection_confidence: selected ? Math.max(0, Math.min(1, Number((0.45 + selected.score / 4).toFixed(4)))) : 0,
    selection_margin: top ? margin : 0,
    top_candidate_id: top ? candidateId(top.candidate) : "",
    top_candidate_identity_group_key: topGroup?.key || "",
    top_candidate_group_ids: topGroup?.member_candidate_ids || [],
    second_candidate_id: second ? candidateId(second.candidate) : "",
    second_candidate_identity_group_key: secondGroup?.key || "",
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

const selectedCandidateVariantFields = new Set([
  "card_name",
  "official_card_type",
  "surface_color",
  "parallel",
  "parallel_family",
  "parallel_exact",
  "variation"
]);

const selectedCandidateProductHierarchyFields = new Set([
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "subset",
  "insert"
]);

function candidateUsesReviewedTitleGroundTruth(candidate = {}) {
  return candidate.reference_metadata?.corrected_title_is_reviewed_title_ground_truth === true
    || candidate.field_derivation?.corrected_title_is_reviewed_title_ground_truth === true;
}

function reviewedCompositeIdentityEligible(candidate = {}, agreement = {}, decision = {}) {
  if (!candidateUsesReviewedTitleGroundTruth(candidate)) return false;
  const agreed = new Set(Array.isArray(agreement.agreed) ? agreement.agreed : []);
  if (!agreed.has("subjects") || !agreed.has("product_hierarchy")) return false;
  if (agreement.exact_code_match === true) return true;
  if (agreed.has("year") || agreed.has("serial_denominator")) return true;
  return Number(decision.selection_margin || 0) >= 0.5;
}

function selectedCandidateFieldApplicationReason(field, agreement = {}, candidate = {}, decision = {}) {
  const agreed = new Set(Array.isArray(agreement.agreed) ? agreement.agreed : []);
  if (agreement.exact_code_match === true && selectedCandidateExactIdentityFields.has(field)) {
    return "trusted_exact_code_identity_fill";
  }
  if (agreed.has("product_hierarchy") && selectedCandidateProductHierarchyFields.has(field)) {
    return "trusted_product_hierarchy_fill";
  }
  if (agreed.has("year") && field === "year") return "trusted_year_anchor_fill";
  if (reviewedCompositeIdentityEligible(candidate, agreement, decision)) {
    if (field === "year") return "trusted_reviewed_identity_year_fill";
    if (selectedCandidateVariantFields.has(field)) return "trusted_reviewed_identity_variant_fill";
  }
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
    const reason = selectedCandidateFieldApplicationReason(field, agreement, candidate, decision);
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
  const forLane = (candidate, lane) => ({
    ...candidate,
    fields: candidateFieldSource(candidate),
    __candidate_lane: lane
  });
  return [
    ...packetCandidates(catalogPacket).map((candidate) => forLane(candidate, "catalog")),
    ...packetCandidates(vectorPacket).map((candidate) => forLane(candidate, "vector"))
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
    const providerPromptEligible = candidateIsPromptEligible(candidate, promptIds);
    const liveAnchorEligible = candidateHasPromptIdentityAnchor(candidate);
    const liveEvidenceEligible = candidateCanSupportEvidence(candidate);
    const promptEligible = providerPromptEligible && liveAnchorEligible && liveEvidenceEligible;
    const baseTrace = buildCandidateApplicationTrace(candidate, {
      matchLevel: matchLevelForCandidate(candidate)
    });
    const evidenceRows = promptEligible && candidateCanSupportEvidence(candidate)
      ? candidateFieldEvidenceRows(candidate, baseTrace).filter((row) => row.permission !== fieldPermissions.SUGGEST_ONLY)
      : [];
    const participationLevel = participationLevelForCandidate(candidate, {
      promptEligible,
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
    const referenceInstanceFieldsSanitized = sanitizedReferenceInstanceFields(candidate);
    return {
      ...buildCandidateApplicationTrace(candidate, {
      participationLevel,
      matchLevel: baseTrace.match_level,
      appliedFields: [],
      blockedFields: [
        ...rejectReasons(candidate).flatMap((reason) => reason.split(":")[1]?.split(",") || []),
        ...referenceInstanceFieldsSanitized
      ],
      reasonPerField
      }),
      reference_instance_fields_sanitized: referenceInstanceFieldsSanitized,
      candidate_lane: candidate.__candidate_lane || "",
      provider_prompt_eligible: providerPromptEligible,
      live_anchor_eligible: liveAnchorEligible,
      live_evidence_eligible: liveEvidenceEligible,
      prompt_eligible: promptEligible,
      decision_eligible: promptEligible,
      shadow_only_reason: promptEligible
        ? ""
        : !providerPromptEligible
          ? "not_in_provider_prompt_safe_candidate_ids"
          : !liveAnchorEligible
            ? "post_observation_anchor_filter_blocked"
            : "post_observation_evidence_conflict_blocked"
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
  const livePromptRows = rows.filter((trace) => trace.prompt_eligible === true);
  const providerPromptRows = rows.filter((trace) => trace.provider_prompt_eligible === true);
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
    provider_prompt_candidate_count: Number(eligibility.prompt_candidate_count || providerPromptRows.length || 0),
    provider_prompt_candidate_ids: Array.isArray(eligibility.prompt_candidate_ids)
      ? eligibility.prompt_candidate_ids
      : providerPromptRows.map((trace) => trace.candidate_id).filter(Boolean),
    prompt_candidate_count: livePromptRows.length,
    prompt_candidate_ids: livePromptRows.map((trace) => trace.candidate_id).filter(Boolean),
    post_observation_blocked_count: Math.max(0, providerPromptRows.length - livePromptRows.length),
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
  const observedFields = observedFieldsFromResult(result);
  const candidateObservationSnapshot = compactObservedFields(observedFields);
  const candidates = flattenCandidateRows({ catalogPacket, vectorPacket })
    .map((candidate) => rebindCandidateToObservedFields(candidate, observedFields));
  const traces = applicationTraceRows({ candidates, catalogPromptIds, vectorPromptIds });
  const decisionCandidateIndexes = traces
    .map((trace, index) => trace.decision_eligible === true ? index : -1)
    .filter((index) => index >= 0);
  const decisionCandidates = decisionCandidateIndexes.map((index) => candidates[index]);
  const decisionTraces = decisionCandidateIndexes.map((index) => traces[index]);
  const decision = selectedCandidateDecision(decisionCandidates, decisionTraces);
  const shadowOnlyCandidateIds = traces
    .filter((trace) => trace.decision_eligible !== true)
    .map((trace) => trace.candidate_id)
    .filter(Boolean);
  const lowMarginSafeFieldApplication = buildLowMarginSafeFieldApplication({
    decision,
    candidates: decisionCandidates,
    traces: decisionTraces,
    result
  });
  const selectedCandidateSafeFieldApplication = buildSelectedCandidateSafeFieldApplication({
    decision,
    candidates: decisionCandidates,
    traces: decisionTraces
  });
  const fieldEvidence = traces.flatMap((trace, index) => (
    trace.decision_eligible === true && candidateCanSupportEvidence(candidates[index])
      ? candidateFieldEvidenceRows(candidates[index], trace)
      : []
  ));
  const fieldInventory = traces.flatMap((trace, index) => (
    candidateFieldInventoryRows(candidates[index], trace).map((row) => ({
      ...row,
      candidate_lane: trace.candidate_lane || candidates[index]?.__candidate_lane || "",
      decision_eligible: trace.decision_eligible === true,
      prompt_eligible: trace.prompt_eligible === true
    }))
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
    candidate_observation_snapshot: candidateObservationSnapshot,
    participation_level: participationLevel,
    decision_eligible_candidate_count: decisionCandidates.length,
    decision_eligible_candidate_ids: decisionTraces.map((trace) => trace.candidate_id).filter(Boolean),
    shadow_only_candidate_count: shadowOnlyCandidateIds.length,
    shadow_only_candidate_ids: shadowOnlyCandidateIds,
    selected_candidate_decision: decision,
    candidate_application_trace: traces,
    candidate_field_inventory: fieldInventory,
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
