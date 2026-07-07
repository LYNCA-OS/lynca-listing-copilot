function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function imageCount(payload = {}) {
  return Array.isArray(payload.images) ? payload.images.length : 0;
}

function hasExactAnchor(payload = {}) {
  const text = JSON.stringify({
    collector_number: payload.collector_number,
    checklist_code: payload.checklist_code,
    card_number: payload.card_number,
    exact_anchor: payload.exact_anchor,
    initial_evidence: payload.initial_evidence || payload.initialEvidence
  }).toLowerCase();
  return Boolean(/collector|checklist|card_number|serial|print_run|#?[a-z]{1,8}[- ][a-z0-9]{1,12}/i.test(text));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function providerOptions(payload = {}) {
  const options = payload.provider_options || payload.providerOptions || {};
  return options && typeof options === "object" && !Array.isArray(options) ? options : {};
}

function hasApprovedCandidateSupport(payload = {}) {
  const options = providerOptions(payload);
  const directCounts = [
    payload.approved_candidate_count,
    payload.approvedCatalogCandidateCount,
    payload.catalog_prompt_candidate_count,
    payload.catalogPromptCandidateCount,
    options.approved_candidate_count,
    options.catalog_prompt_candidate_count,
    options.prompt_candidate_count
  ];
  if (directCounts.some((value) => numberValue(value) > 0)) return true;

  const candidateSources = [
    payload.catalog_candidates,
    payload.catalogCandidates,
    payload.retrieval_candidates,
    payload.retrievalCandidates,
    payload.vector_candidate_packet?.assist_candidates,
    payload.vectorCandidatePacket?.assistCandidates
  ].filter(Array.isArray);

  return candidateSources.flat().some((candidate) => {
    const status = String(
      candidate?.retrieval_status
      || candidate?.reference_status
      || candidate?.reference_metadata?.retrieval_status
      || ""
    ).trim().toLowerCase();
    if (/^(approved|reviewed|verified)$/.test(status)) return true;
    const trust = String(candidate?.source_trust || candidate?.trust || "").trim().toUpperCase();
    return trust === "APPROVED_REFERENCE" || trust === "REVIEWED_INTERNAL";
  });
}

function looksMarketplaceBlind(payload = {}) {
  const options = providerOptions(payload);
  const text = JSON.stringify({
    provider_eval_mode: payload.provider_eval_mode || payload.providerEvalMode || options.provider_eval_mode || options.providerMode,
    capture_profile: payload.captureProfileId || payload.capture_profile_id,
    source_provider: payload.source_provider || payload.sourceProvider,
    source_record: payload.source_record || payload.sourceRecord,
    source_manifest: payload.source_manifest || payload.sourceManifest,
    reference_capture_source: payload.reference_capture_source || payload.referenceCaptureSource
  }).toLowerCase();
  return /ebay|marketplace|blind|image_only|cold_start/.test(text)
    || options.cold_start_blind === true
    || options.enable_cold_start_blind === true
    || options.send_corrected_title_hint_to_cloud === false && /eval|smoke/.test(text);
}

function routePlan({
  route,
  route_reason,
  blocking_modules = [],
  conditionally_blocking_modules = [],
  background_modules = [],
  pending_modules = [],
  skipped_modules = [],
  risk_flags = [],
  expected_risk = "MEDIUM"
} = {}) {
  return {
    route,
    route_reason,
    blocking_modules,
    conditionally_blocking_modules,
    background_modules,
    pending_modules,
    skipped_modules,
    risk_flags,
    expected_risk,
    // Backward-compatible aliases for older V4 persistence/tests.
    skipped_steps: skipped_modules,
    pending_steps: pending_modules
  };
}

export function planV4RecognitionRoute(payload = {}, env = process.env) {
  const preingestionBundleId = payload.preingestion_bundle_id || payload.preingestionBundleId || "";
  const catalogAssist = payload.enable_catalog_assist !== false && payload.catalog_assist !== false;
  const vectorAssist = payload.enable_vector_assist !== false && payload.vector_assist !== false;
  const vectorReady = truthy(env.VECTOR_INDEX_READY);
  const count = imageCount(payload);
  const exactAnchor = hasExactAnchor(payload);
  const approvedCandidateSupport = hasApprovedCandidateSupport(payload);
  const marketplaceBlind = looksMarketplaceBlind(payload);

  if (preingestionBundleId && exactAnchor && catalogAssist && approvedCandidateSupport) {
    return routePlan({
      route: "EXACT_ANCHOR_FAST_LANE",
      route_reason: "preingestion bundle and exact anchor can constrain the background assist lane; L1 returns internal scout evidence only",
      blocking_modules: [
        "signed_read_url_preparation",
        "fast_scout_observation",
        "resolver_safety_check",
        "deterministic_renderer"
      ],
      conditionally_blocking_modules: ["ocr_crop_verifier"],
      background_modules: [
        "catalog_exact_anchor_lookup",
        "full_assisted_observation",
        "post_observation_catalog_lookup",
        "candidate_reranker",
        "sidecar_workflow_dispatch"
      ],
      pending_modules: ["fast_scout_observation", "l2_assisted_draft", "writer_review"],
      skipped_modules: [
        ...(vectorReady ? ["visual_vector_retrieval"] : ["visual_vector_online_query"]),
        "external_retrieval",
        "exact_parallel_research"
      ],
      risk_flags: [],
      expected_risk: "LOW"
    });
  }

  if ((catalogAssist || (vectorAssist && vectorReady)) && approvedCandidateSupport) {
    return routePlan({
      route: "ASSISTED_FULL",
      route_reason: "catalog/vector assist is available for the background L2 lane; L1 returns internal scout evidence only",
      blocking_modules: [
        "signed_read_url_preparation",
        "fast_scout_observation",
        "resolver_safety_check",
        "deterministic_renderer"
      ],
      conditionally_blocking_modules: [
        "catalog_pre_observation_lookup",
        "ocr_crop_verifier"
      ],
      background_modules: [
        "full_assisted_observation",
        "post_observation_catalog_lookup",
        "visual_vector_retrieval",
        "external_retrieval",
        "exact_parallel_research",
        "candidate_reranker",
        "sidecar_workflow_dispatch"
      ],
      pending_modules: ["fast_scout_observation", "l2_assisted_draft", "writer_review"],
      skipped_modules: vectorReady ? [] : ["visual_vector_online_query"],
      risk_flags: exactAnchor ? [] : ["NO_EXACT_ANCHOR_FAST_LANE"],
      expected_risk: exactAnchor ? "MEDIUM_LOW" : "MEDIUM"
    });
  }

  if (count > 0 || preingestionBundleId) {
    return routePlan({
      route: "COLD_START_SAFE_DRAFT",
      route_reason: marketplaceBlind
        ? "marketplace/blind input has no approved catalog identity; return internal scout evidence and continue L2 assist in background"
        : "no approved candidate assist is available; use internal scout evidence before L2 generates the one-line title",
      blocking_modules: [
        "signed_read_url_preparation",
        "fast_scout_observation",
        "resolver_safety_check",
        "deterministic_renderer"
      ],
      conditionally_blocking_modules: ["ocr_crop_verifier"],
      background_modules: [
        "full_assisted_observation",
        "post_observation_catalog_lookup",
        "visual_vector_retrieval",
        "external_retrieval",
        "exact_parallel_research",
        "candidate_reranker",
        "catalog_gap_queue",
        "sidecar_workflow_dispatch"
      ],
      pending_modules: ["fast_scout_observation", "l2_assisted_draft", "writer_review"],
      skipped_modules: ["catalog_field_lock"],
      risk_flags: ["CATALOG_GAP_REQUIRED"],
      expected_risk: "MEDIUM_HIGH"
    });
  }

  return routePlan({
    route: "DEEP_REVIEW_REQUIRED",
    route_reason: "no usable image or preingestion bundle was provided",
    blocking_modules: ["manual_safety_review"],
    conditionally_blocking_modules: [],
    background_modules: [],
    pending_modules: ["manual_review"],
    skipped_modules: ["provider_call", "catalog_lookup", "visual_vector_online_query"],
    risk_flags: ["NO_USABLE_IMAGE"],
    expected_risk: "HIGH"
  });
}
