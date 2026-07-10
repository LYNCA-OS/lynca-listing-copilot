export const candidateContextSummaryVersion = "candidate-context-summary-v1";

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueList(values = []) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function candidateId(candidate = {}) {
  return cleanText(
    candidate.candidate_id
    || candidate.candidate_identity_id
    || candidate.card_identity_id
    || candidate.identity_id
    || candidate.id
  );
}

function packetCandidates(packet = {}) {
  const candidates = packet?.vector_retrieval?.candidates;
  return Array.isArray(candidates) ? candidates : [];
}

function packetSignal(packet = {}) {
  const retrieval = packet?.vector_retrieval || {};
  const unavailable = Array.isArray(retrieval.unavailable) ? retrieval.unavailable : [];
  return {
    status: retrieval.status || null,
    status_code: retrieval.status_code || null,
    open_set_decision: retrieval.open_set_decision || null,
    open_set_reason: retrieval.open_set_reason || null,
    unavailable_reasons: unavailable.map((item) => cleanText(item.reason)).filter(Boolean)
  };
}

function providerMetadataForLane(lane, context = {}) {
  const trace = Array.isArray(context?.retrieval?.trace) ? context.retrieval.trace : [];
  const laneProvider = lane === "vector" ? "visual_vector" : lane;
  const entry = [...trace].reverse().find((row) => row?.provider_id === laneProvider && row?.metadata);
  return entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : null;
}

function providerRuntimeFieldsForLane(lane, context = {}, metadata = null) {
  const signal = packetSignal(context?.packet || {});
  const output = {
    runtime_status: signal.status || context?.mode || null,
    runtime_status_code: signal.status_code || null,
    runtime_unavailable_reasons: signal.unavailable_reasons || []
  };
  if (lane !== "vector") return output;
  const providerMetadata = metadata && typeof metadata === "object" ? metadata : {};
  return {
    ...output,
    worker_status: context?.worker?.status || null,
    worker_reason: context?.worker?.reason || "",
    worker_feature_count: Array.isArray(context?.worker?.features) ? context.worker.features.length : null,
    worker_latency_ms: context?.worker?.latency_ms ?? null,
    worker_attempt_count: context?.worker?.attempt_count ?? null,
    query_embedding_role: providerMetadata.query_embedding_role || "",
    role_agnostic_fallback_used: providerMetadata.role_agnostic_fallback_used === true,
    role_agnostic_fallback_reason: providerMetadata.role_agnostic_fallback_reason || "",
    returned_row_count: Number.isFinite(Number(providerMetadata.returned_row_count))
      ? Number(providerMetadata.returned_row_count)
      : null,
    self_excluded_count: Number.isFinite(Number(providerMetadata.self_excluded_count))
      ? Number(providerMetadata.self_excluded_count)
      : null
  };
}

function eligibilityForLane(context = {}, resultEligibility = null) {
  if (resultEligibility && typeof resultEligibility === "object") return resultEligibility;
  if (context?.catalog_assist_eligibility && typeof context.catalog_assist_eligibility === "object") return context.catalog_assist_eligibility;
  if (context?.vector_assist_eligibility && typeof context.vector_assist_eligibility === "object") return context.vector_assist_eligibility;
  const assistFilter = context?.assistPacket?.vector_retrieval?.assist_filter
    || context?.packet?.vector_retrieval?.assist_filter;
  return assistFilter && typeof assistFilter === "object" ? assistFilter : {};
}

function promptCandidateIds(eligibility = {}, assistPacket = {}) {
  const explicit = Array.isArray(eligibility.prompt_candidate_ids)
    ? eligibility.prompt_candidate_ids
    : [];
  const assistIds = packetCandidates(assistPacket).map(candidateId);
  return uniqueList([...explicit, ...assistIds]);
}

function fieldSupportIds(eligibility = {}) {
  if (Array.isArray(eligibility.field_support_candidate_ids)) return uniqueList(eligibility.field_support_candidate_ids);
  if (Array.isArray(eligibility.support_candidate_ids)) return uniqueList(eligibility.support_candidate_ids);
  return [];
}

function summarizeLane({
  lane,
  context = {},
  resultEligibility = null,
  resultPacket = null
} = {}) {
  const packet = resultPacket || context?.packet || {};
  const eligibility = eligibilityForLane(context, resultEligibility);
  const candidates = packetCandidates(packet);
  const promptIds = promptCandidateIds(eligibility, context?.assistPacket || {});
  const fieldIds = fieldSupportIds(eligibility);
  const rawCandidateCount = numeric(eligibility.raw_candidate_count, candidates.length);
  const approvedCandidateCount = numeric(eligibility.approved_candidate_count, 0);
  const conflictBlockedCount = numeric(eligibility.conflict_blocked_count, 0);
  const promptCandidateCount = numeric(eligibility.prompt_candidate_count, promptIds.length);
  const fieldSupportCount = numeric(eligibility.field_support_count, fieldIds.length);
  const providerMetadata = providerMetadataForLane(lane, context);
  const runtimeFields = providerRuntimeFieldsForLane(lane, context, providerMetadata);

  return {
    lane,
    status: context?.mode || packetSignal(packet).status || null,
    signal: packetSignal(packet),
    provider_metadata: providerMetadata,
    ...runtimeFields,
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    conflict_blocked_count: conflictBlockedCount,
    field_support_count: fieldSupportCount,
    prompt_candidate_count: promptCandidateCount,
    prompt_candidate_ids: promptIds,
    field_support_candidate_ids: fieldIds,
    prompt_assist_used: context?.promptPacket === true,
    cache_hit: context?.catalog_cache_hit === true,
    skipped: context?.vector_lazy_skip?.skipped === true,
    skip_reason: context?.vector_lazy_skip?.reason || context?.vector_lazy_skip?.skip_reason || "",
    exact_anchor_fast_lane_eligible: context?.exact_anchor_fast_lane_shadow?.exact_anchor_fast_lane_eligible === true,
    exact_anchor_candidate_id: context?.exact_anchor_fast_lane_shadow?.exact_anchor_candidate_id || "",
    worker_status: runtimeFields.worker_status ?? context?.worker?.status ?? null,
    worker_reason: runtimeFields.worker_reason ?? context?.worker?.reason ?? "",
    worker_feature_count: runtimeFields.worker_feature_count ?? (Array.isArray(context?.worker?.features) ? context.worker.features.length : null),
    worker_latency_ms: runtimeFields.worker_latency_ms ?? context?.worker?.latency_ms ?? null,
    worker_attempt_count: runtimeFields.worker_attempt_count ?? context?.worker?.attempt_count ?? null,
    telemetry_recorded: Boolean(context?.telemetry)
  };
}

function runtimeRegion(env = process.env) {
  return cleanText(env.VERCEL_REGION || env.AWS_REGION || env.FUNCTION_REGION || env.LYNCA_FUNCTION_REGION || "syd1");
}

function storageRegion(env = process.env) {
  return cleanText(env.SUPABASE_REGION || env.LYNCA_SUPABASE_REGION || "ap-southeast-2");
}

export function buildCandidateContextSummary({
  result = {},
  openSetReadiness = {},
  catalogContext = {},
  vectorContext = {},
  providerOptions = {},
  env = process.env
} = {}) {
  const catalog = summarizeLane({
    lane: "catalog",
    context: catalogContext,
    resultEligibility: result.catalog_assist_eligibility || openSetReadiness.catalog?.eligibility,
    resultPacket: result.catalog_candidate_packet
  });
  const vector = summarizeLane({
    lane: "vector",
    context: vectorContext,
    resultEligibility: result.vector_assist_eligibility || openSetReadiness.vector?.eligibility,
    resultPacket: result.vector_candidate_packet
  });
  const promptCandidateIdsCombined = uniqueList([
    ...(Array.isArray(openSetReadiness.prompt_candidate_ids) ? openSetReadiness.prompt_candidate_ids : []),
    ...catalog.prompt_candidate_ids,
    ...vector.prompt_candidate_ids
  ]);
  const assistEnabled = Boolean(
    openSetReadiness.assist_enabled
    || providerOptions.enable_catalog_assist
    || providerOptions.enable_vector_assist
  );

  return {
    schema_version: candidateContextSummaryVersion,
    compute_placement: "data_adjacent_cloud_function",
    compute_region: runtimeRegion(env),
    storage_region: storageRegion(env),
    strategy: "supabase_catalog_lookup_inside_region_pinned_vercel_function",
    assist_enabled: assistEnabled,
    status: openSetReadiness.status || "UNKNOWN",
    release_policy: openSetReadiness.release_policy || null,
    prompt_candidate_count: promptCandidateIdsCombined.length,
    prompt_candidate_ids: promptCandidateIdsCombined,
    raw_candidate_count: numeric(openSetReadiness.raw_candidate_count, catalog.raw_candidate_count + vector.raw_candidate_count),
    approved_candidate_count: numeric(openSetReadiness.approved_candidate_count, catalog.approved_candidate_count + vector.approved_candidate_count),
    conflict_blocked_count: numeric(openSetReadiness.conflict_blocked_count, catalog.conflict_blocked_count + vector.conflict_blocked_count),
    field_support_count: numeric(openSetReadiness.prompt_field_support_count, catalog.field_support_count + vector.field_support_count),
    fail_closed_candidate: openSetReadiness.fail_closed_candidate === true,
    catalog_gap_queue_candidate: openSetReadiness.catalog_gap_queue_candidate === true,
    catalog,
    vector,
    invariants: {
      prompt_candidates_are_filtered: true,
      raw_vector_candidates_are_shadow_until_prompt_safe: true,
      catalog_vector_do_not_copy_instance_fields: true,
      final_decision_remains_resolver_gate: true
    }
  };
}
