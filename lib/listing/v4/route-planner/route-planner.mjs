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

export function planV4RecognitionRoute(payload = {}, env = process.env) {
  const preingestionBundleId = payload.preingestion_bundle_id || payload.preingestionBundleId || "";
  const catalogAssist = payload.enable_catalog_assist !== false && payload.catalog_assist !== false;
  const vectorAssist = payload.enable_vector_assist !== false && payload.vector_assist !== false;
  const vectorReady = truthy(env.VECTOR_INDEX_READY);
  const count = imageCount(payload);
  const exactAnchor = hasExactAnchor(payload);

  if (preingestionBundleId && exactAnchor && catalogAssist) {
    return {
      route: "EXACT_ANCHOR_FAST_LANE",
      route_reason: "preingestion bundle and exact anchor can constrain catalog before full reasoning",
      skipped_steps: vectorReady ? [] : ["visual_vector_online_query"],
      pending_steps: ["gpt_direct_observation", "candidate_control_plane", "writer_draft"],
      expected_risk: "LOW"
    };
  }

  if (catalogAssist || (vectorAssist && vectorReady)) {
    return {
      route: "ASSISTED_FULL",
      route_reason: "catalog/vector assist enabled but no exact anchor fast lane is available",
      skipped_steps: vectorReady ? [] : ["visual_vector_online_query"],
      pending_steps: ["gpt_direct_observation", "catalog_lookup", "candidate_control_plane", "writer_draft"],
      expected_risk: exactAnchor ? "MEDIUM_LOW" : "MEDIUM"
    };
  }

  if (count > 0 || preingestionBundleId) {
    return {
      route: "COLD_START_SAFE_DRAFT",
      route_reason: "no approved candidate assist is available; generate safe one-line draft from direct evidence",
      skipped_steps: ["catalog_field_lock", "visual_vector_online_query"],
      pending_steps: ["gpt_direct_observation", "writer_review"],
      expected_risk: "MEDIUM_HIGH"
    };
  }

  return {
    route: "DEEP_REVIEW_REQUIRED",
    route_reason: "no usable image or preingestion bundle was provided",
    skipped_steps: ["provider_call", "catalog_lookup", "visual_vector_online_query"],
    pending_steps: ["manual_review"],
    expected_risk: "HIGH"
  };
}
