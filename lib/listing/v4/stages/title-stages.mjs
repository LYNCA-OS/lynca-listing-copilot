export const v4TitleStages = Object.freeze({
  L0_INSTANT_SKELETON: "L0_INSTANT_SKELETON",
  L1_WRITER_SAFE_DRAFT: "L1_WRITER_SAFE_DRAFT",
  L2_ASSISTED_DRAFT: "L2_ASSISTED_DRAFT",
  L3_WRITER_FINAL: "L3_WRITER_FINAL"
});

export const v4ModuleNames = Object.freeze({
  SIGNED_READ_URL: "signed_read_url_preparation",
  FAST_SCOUT_OBSERVATION: "fast_scout_observation",
  FULL_CARD_GPT_OBSERVATION: "full_card_gpt_observation",
  IMAGE_QUALITY_SUMMARY: "image_quality_summary",
  CATALOG_PRE_OBSERVATION_LOOKUP: "catalog_pre_observation_lookup",
  CATALOG_EXACT_ANCHOR_LOOKUP: "catalog_exact_anchor_lookup",
  POST_OBSERVATION_CATALOG_LOOKUP: "post_observation_catalog_lookup",
  OCR_CROP_VERIFIER: "ocr_crop_verifier",
  RESOLVER_SAFETY_CHECK: "resolver_safety_check",
  DETERMINISTIC_RENDERER: "deterministic_renderer",
  CANDIDATE_CONTROL_PLANE: "candidate_control_plane",
  VECTOR_RETRIEVAL: "visual_vector_retrieval",
  EXTERNAL_RETRIEVAL: "external_retrieval",
  EXACT_PARALLEL_RESEARCH: "exact_parallel_research",
  RERANKER: "candidate_reranker",
  SIDECARS: "sidecar_workflow_dispatch",
  WRITER_REVIEW: "writer_review"
});

const criticalConflictFields = new Set([
  "subject",
  "player",
  "players",
  "character",
  "year",
  "product",
  "manufacturer",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "card_number",
  "serial_number",
  "print_run_number",
  "grade",
  "card_grade"
]);

const highRiskFields = [
  "exact_parallel",
  "parallel_exact",
  "ssp",
  "case_hit",
  "official_card_type"
];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "" && cleanText(value).toUpperCase() !== "UNKNOWN";
}

function valueFrom(fields = {}, names = []) {
  return names.map((name) => fields?.[name]).find(hasValue);
}

function fieldNamesFromConflicts(result = {}) {
  const fields = [];
  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      push(value.field || value.field_name || value.name);
      return;
    }
    const normalized = cleanText(value).toLowerCase();
    if (normalized) fields.push(normalized);
  };
  push(result.conflict_map);
  push(result.conflicts);
  push(result.field_conflicts);
  return unique(fields);
}

function unresolvedFieldsFrom(result = {}, fieldStates = {}) {
  const fields = [
    ...arrayFrom(result.unresolved),
    ...arrayFrom(result.unresolved_fields),
    ...Object.entries(fieldStates || {})
      .filter(([, state]) => /REVIEW|CONFLICT/i.test(cleanText(state?.display_status || state?.status)))
      .map(([field]) => field)
  ];
  return unique(fields.map((field) => cleanText(field).toLowerCase()));
}

function criticalConflictPresent(result = {}) {
  const conflicts = fieldNamesFromConflicts(result);
  return conflicts.some((field) => criticalConflictFields.has(field));
}

function coreIdentityReadiness(resolvedFields = {}) {
  const subject = valueFrom(resolvedFields, ["subject", "player", "players", "character"]);
  const product = valueFrom(resolvedFields, ["product", "set", "manufacturer", "brand", "ip"]);
  const anchor = valueFrom(resolvedFields, [
    "collector_number",
    "checklist_code",
    "tcg_card_number",
    "card_number",
    "print_run_number",
    "numbered_to",
    "serial_number",
    "grade_company",
    "card_grade",
    "observable_components",
    "card_name"
  ]);
  return {
    subject_present: hasValue(subject),
    product_present: hasValue(product),
    distinguishing_anchor_present: hasValue(anchor),
    ready: hasValue(subject) && hasValue(product)
  };
}

function highRiskReviewFields(result = {}, resolvedFields = {}, existingReviewFields = []) {
  const reviewSet = new Set(existingReviewFields.map((field) => cleanText(field).toLowerCase()).filter(Boolean));
  highRiskFields.forEach((field) => {
    if (!hasValue(resolvedFields[field])) return;
    if (field === "parallel_exact" || field === "exact_parallel") {
      const supportText = JSON.stringify([
        result.catalog_activation_funnel,
        result.catalog_assist_eligibility,
        result.retrieval_title_assist,
        result.provider_evidence,
        result.evidence
      ]).toLowerCase();
      if (!/catalog|checklist|slab|printed|official|retrieval/.test(supportText)) reviewSet.add(field);
      return;
    }
    reviewSet.add(field);
  });
  return [...reviewSet];
}

function timingValue(timing = {}, ...names) {
  for (const name of names) {
    const value = Number(timing?.[name]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function buildV4ModuleSpeedMetrics({ result = {}, routePlan = {}, stageState = {} } = {}) {
  const timing = result.timing || result.timings || {};
  const moduleLatency = {
    signed_read_url_preparation_ms: timingValue(timing, "signed_url_ms", "signed_read_url_ms"),
    fast_scout_observation_ms: timingValue(timing, "fast_scout_latency_ms"),
    full_card_gpt_observation_ms: timingValue(timing, "provider_total_ms", "provider_ms", "provider_latency_ms"),
    catalog_lookup_ms: timingValue(timing, "catalog_retrieval_ms"),
    vector_retrieval_ms: timingValue(timing, "vector_retrieval_ms"),
    post_observation_retrieval_ms: timingValue(timing, "retrieval_ms", "evidence_completion_ms"),
    resolver_ms: timingValue(timing, "resolver_ms", "identity_resolution_ms"),
    renderer_ms: timingValue(timing, "renderer_ms")
  };
  const observedTotal = (timingValue(timing, "total_ms") ?? Number(result.total_ms || result.latency_ms || 0)) || null;
  const blockingModuleNames = Array.isArray(routePlan.blocking_modules) ? routePlan.blocking_modules : [];
  const blockingModuleTime = Object.entries(moduleLatency)
    .filter(([name]) => blockingModuleNames.some((moduleName) => name.startsWith(moduleName.replace(/_preparation$/, ""))))
    .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);

  return {
    time_to_l1_safe_draft_ms: timingValue(timing, "time_to_l1_safe_draft_ms", "fast_scout_latency_ms", "total_ms") ?? observedTotal,
    time_to_l2_assisted_draft_ms: stageState.assisted_draft ? observedTotal : null,
    time_to_first_field_ms: timingValue(timing, "provider_first_token_ms", "time_to_first_field_ms"),
    time_to_core_identity_ms: timingValue(timing, "provider_total_ms", "time_to_core_identity_ms"),
    time_to_writer_safe_draft_ms: observedTotal,
    time_to_assisted_draft_ms: stageState.assisted_draft ? observedTotal : null,
    l1_route: routePlan.route || null,
    l1_return_reason: stageState.l1_return_reason || stageState.title_stage_reason || null,
    l1_blocking_modules: routePlan.blocking_modules || [],
    l1_background_modules: routePlan.background_modules || [],
    l1_pending_modules: stageState.pending_modules || [],
    full_assist_continued_after_l1: Boolean(stageState.full_assist_continued_after_l1),
    fast_scout_latency_ms: timingValue(timing, "fast_scout_latency_ms"),
    full_observation_latency_ms: timingValue(timing, "provider_total_ms", "provider_ms", "provider_latency_ms"),
    provider_prompt_candidate_count: Number(result.catalog_activation_funnel?.prompt_candidate_count || result.candidate_activation_funnel?.prompt_candidate_count || 0),
    vector_blocked_l1_count: (routePlan.background_modules || []).includes("visual_vector_retrieval") ? 1 : 0,
    external_blocked_l1_count: (routePlan.background_modules || []).includes("external_retrieval") ? 1 : 0,
    catalog_blocked_l1_count: (routePlan.background_modules || []).includes("post_observation_catalog_lookup") ? 1 : 0,
    module_latency: moduleLatency,
    blocking_module_time: blockingModuleTime || null,
    background_module_time: null,
    modules_pending_at_safe_draft: stageState.pending_modules || [],
    modules_skipped_by_route: routePlan.skipped_modules || routePlan.skipped_steps || []
  };
}

export function buildV4TitleStageState({
  result = {},
  routePlan = {},
  writerDraft = {},
  resolvedFields = {},
  fieldStates = {}
} = {}) {
  const title = cleanText(writerDraft.title || result.final_title || result.rendered_title || result.title);
  const failed = cleanText(result.confidence).toUpperCase() === "FAILED" || !title;
  const readiness = coreIdentityReadiness(resolvedFields);
  const reviewFields = highRiskReviewFields(result, resolvedFields, unresolvedFieldsFrom(result, fieldStates));
  const criticalConflict = criticalConflictPresent(result);
  const rendererReady = Boolean(title);
  const writerSafeReady = !failed && rendererReady && readiness.ready && !criticalConflict;
  const assisted = Boolean(
    result.retrieval_title_assist?.used
    || Number(result.catalog_activation_funnel?.prompt_candidate_count || 0) > 0
    || Number(result.vector_activation_funnel?.prompt_candidate_count || 0) > 0
    || result.title_stage === v4TitleStages.L2_ASSISTED_DRAFT
  );
  const stage = failed
    ? v4TitleStages.L0_INSTANT_SKELETON
    : writerSafeReady
      ? v4TitleStages.L1_WRITER_SAFE_DRAFT
      : v4TitleStages.L1_WRITER_SAFE_DRAFT;
  const pendingModules = unique([
    ...(routePlan.pending_modules || routePlan.pending_steps || []),
    ...(routePlan.background_modules || []),
    ...(!assisted ? ["post_observation_catalog_lookup"] : [])
  ]);

  const state = {
    title_stage: stage,
    writer_safe_draft: writerSafeReady || title ? title : "",
    assisted_draft: assisted ? title : null,
    assisted_draft_status: assisted ? "READY" : "PENDING",
    assisted_draft_pending_modules: assisted ? [] : routePlan.background_modules || [],
    pending_modules: pendingModules,
    background_modules: routePlan.background_modules || [],
    blocking_modules: routePlan.blocking_modules || [],
    review_required_fields: reviewFields,
    title_stage_reason: failed
      ? "No safe one-line title is available yet; UI may show an instant skeleton only."
      : writerSafeReady
        ? "Core identity evidence was sufficient for a writer-safe one-line draft; non-blocking modules are tracked as pending/background work."
        : "A conservative writer-safe draft is returned with unresolved or risky fields omitted or marked for review.",
    l1_return_reason: result.l1_return_reason || (failed ? "fast_scout_failed" : "fast_scout_safe_draft_ready"),
    full_assist_continued_after_l1: result.full_assist_continued_after_l1 === true || (routePlan.background_modules || []).includes("full_assisted_observation"),
    readiness: {
      ...readiness,
      renderer_ready: rendererReady,
      critical_unresolved_conflict: criticalConflict,
      high_risk_fields_omitted_or_reviewed: true,
      writer_safe_ready: writerSafeReady
    }
  };

  return {
    ...state,
    module_speed_metrics: buildV4ModuleSpeedMetrics({ result, routePlan, stageState: state })
  };
}

export function providerOptionsForV4ProgressiveL1({
  payload = {},
  routePlan = {}
} = {}) {
  const original = payload.provider_options || payload.providerOptions || {};
  return {
    ...(original && typeof original === "object" && !Array.isArray(original) ? original : {}),
    v4_module_speed_architecture: true,
    v4_title_stage_target: v4TitleStages.L1_WRITER_SAFE_DRAFT,
    single_model_fast: true,
    enable_evidence_completion: false,
    enable_assist_shadow_evidence_completion: false,
    enable_ephemeral_external_retrieval: false,
    enable_vector_assist: false,
    enable_stored_visual_features: false,
    enable_query_visual_embeddings: false,
    enable_vector_retrieval: false,
    vector_retrieval_mode: "off",
    enable_advanced_retrieval: false,
    enable_hybrid_retrieval: false,
    enable_catalog_assist: false,
    deferred_modules: routePlan.background_modules || [],
    non_blocking_modules: routePlan.background_modules || []
  };
}

export function providerOptionsForV4BackgroundL2({
  payload = {},
  routePlan = {}
} = {}) {
  const original = payload.provider_options || payload.providerOptions || {};
  return {
    ...(original && typeof original === "object" && !Array.isArray(original) ? original : {}),
    v4_module_speed_architecture: true,
    v4_title_stage_target: v4TitleStages.L2_ASSISTED_DRAFT,
    deferred_modules: [],
    non_blocking_modules: [],
    l1_route: routePlan.route || null
  };
}
