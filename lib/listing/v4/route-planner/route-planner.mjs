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

  if (preingestionBundleId && exactAnchor && catalogAssist) {
    return routePlan({
      route: "EXACT_ANCHOR_FAST_LANE",
      route_reason: "preingestion bundle and exact anchor can constrain catalog before full reasoning",
      blocking_modules: [
        "signed_read_url_preparation",
        "catalog_exact_anchor_lookup",
        "full_card_gpt_observation",
        "resolver_safety_check",
        "deterministic_renderer"
      ],
      conditionally_blocking_modules: ["ocr_crop_verifier"],
      background_modules: [
        "post_observation_catalog_lookup",
        "candidate_reranker",
        "sidecar_workflow_dispatch"
      ],
      pending_modules: ["gpt_direct_observation", "candidate_control_plane", "writer_draft"],
      skipped_modules: [
        ...(vectorReady ? ["visual_vector_retrieval"] : ["visual_vector_online_query"]),
        "external_retrieval",
        "exact_parallel_research"
      ],
      risk_flags: [],
      expected_risk: "LOW"
    });
  }

  if (catalogAssist || (vectorAssist && vectorReady)) {
    return routePlan({
      route: "ASSISTED_FULL",
      route_reason: "catalog/vector assist enabled but no exact anchor fast lane is available",
      blocking_modules: [
        "signed_read_url_preparation",
        "full_card_gpt_observation",
        "resolver_safety_check",
        "deterministic_renderer"
      ],
      conditionally_blocking_modules: [
        "catalog_pre_observation_lookup",
        "ocr_crop_verifier"
      ],
      background_modules: [
        "post_observation_catalog_lookup",
        "visual_vector_retrieval",
        "external_retrieval",
        "exact_parallel_research",
        "candidate_reranker",
        "sidecar_workflow_dispatch"
      ],
      pending_modules: ["gpt_direct_observation", "catalog_lookup", "candidate_control_plane", "writer_draft"],
      skipped_modules: vectorReady ? [] : ["visual_vector_online_query"],
      risk_flags: exactAnchor ? [] : ["NO_EXACT_ANCHOR_FAST_LANE"],
      expected_risk: exactAnchor ? "MEDIUM_LOW" : "MEDIUM"
    });
  }

  if (count > 0 || preingestionBundleId) {
    return routePlan({
      route: "COLD_START_SAFE_DRAFT",
      route_reason: "no approved candidate assist is available; generate safe one-line draft from direct evidence",
      blocking_modules: [
        "signed_read_url_preparation",
        "full_card_gpt_observation",
        "resolver_safety_check",
        "deterministic_renderer"
      ],
      conditionally_blocking_modules: ["ocr_crop_verifier"],
      background_modules: [
        "post_observation_catalog_lookup",
        "external_retrieval",
        "catalog_gap_queue",
        "sidecar_workflow_dispatch"
      ],
      pending_modules: ["gpt_direct_observation", "writer_review"],
      skipped_modules: ["catalog_field_lock", "visual_vector_online_query"],
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
