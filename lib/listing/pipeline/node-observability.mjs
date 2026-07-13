import { snapshotNodeSpans } from "./timing.mjs";

const ledgerSchemaVersion = "pipeline-node-ledger-v1";

const fieldGroups = Object.freeze({
  year: ["year"],
  manufacturer: ["manufacturer", "brand"],
  product: ["product"],
  set: ["set", "subset", "insert"],
  subject: ["players", "player", "subjects", "subject", "character"],
  card_name: ["card_name"],
  card_type: ["card_type", "official_card_type"],
  parallel_exact: ["parallel_exact", "parallel"],
  surface_color: ["surface_color"],
  collector_number: ["collector_number", "card_number", "checklist_code"],
  numerical_rarity: ["print_run_number", "numerical_rarity", "serial_number"],
  grade: ["grade_company", "card_grade", "grade", "auto_grade"]
});

const compositeSemanticGroups = new Set([
  "product",
  "set",
  "card_name",
  "card_type",
  "parallel_exact",
  "surface_color"
]);

const compositeDestinationFields = new Set([
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "insert",
  "card_name",
  "card_type",
  "official_card_type",
  "parallel_exact",
  "parallel",
  "surface_color",
  "release_variant",
  "design_variation",
  "print_finish",
  "product_finish",
  "descriptive_rarity"
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonEmpty(value) {
  if (Array.isArray(value)) return value.some(nonEmpty);
  if (value && typeof value === "object") return Object.values(value).some(nonEmpty);
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function fieldContainer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value.fields && typeof value.fields === "object" && !Array.isArray(value.fields)
    ? value.fields
    : value;
}

function groupPresent(fields = {}, aliases = []) {
  return aliases.some((field) => nonEmpty(fields[field]));
}

function firstPresentValue(fields = {}, aliases = []) {
  return aliases.map((field) => fields[field]).find(nonEmpty);
}

function comparableFieldText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function comparableContains(haystack, needle) {
  const normalizedHaystack = comparableFieldText(haystack);
  const normalizedNeedle = comparableFieldText(needle);
  if (!normalizedHaystack || normalizedNeedle.length < 3) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedNeedle} `);
}

function compositeTokenRetention({ group, aliases, raw, resolved, rendered, result }) {
  if (!compositeSemanticGroups.has(group)) return { retained: false, destination_fields: [] };
  const rawValue = firstPresentValue(raw, aliases);
  const rawToken = comparableFieldText(rawValue);
  const title = cleanText(result.final_title || result.title || result.model_title_suggestion || result.writing?.title);
  if (rawToken.length < 3 || !comparableContains(title, rawToken)) {
    return { retained: false, destination_fields: [] };
  }

  const sourceAliases = new Set(aliases);
  const destinationFields = [];
  for (const fields of [resolved, rendered]) {
    for (const [field, value] of Object.entries(fields || {})) {
      if (sourceAliases.has(field) || !compositeDestinationFields.has(field)) continue;
      if (comparableContains(value, rawToken)) destinationFields.push(field);
    }
  }
  return {
    retained: destinationFields.length > 0,
    destination_fields: [...new Set(destinationFields)].sort(),
    token: rawToken || null
  };
}

function exactParallelWasSafelyNarrowed(result = {}, raw = {}, resolved = {}, rendered = {}) {
  const guard = result.open_set_presentation_guard;
  if (guard?.used === true
    && guard.action === "downgraded_exact_parallel_to_surface_color"
    && nonEmpty(guard.preserved_surface_color)) {
    return true;
  }

  const exact = comparableFieldText(firstPresentValue(raw, ["parallel_exact", "parallel"]));
  const color = comparableFieldText(firstPresentValue(resolved, ["surface_color"])
    || firstPresentValue(rendered, ["surface_color"]));
  if (!exact || !color) return false;
  return ` ${exact} `.includes(` ${color} `);
}

function countPresentFields(fields = {}) {
  return Object.values(fieldGroups).reduce((count, aliases) => count + (groupPresent(fields, aliases) ? 1 : 0), 0);
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== "") : [];
}

function funnelFromResult(result = {}, kind = "catalog") {
  const direct = result[`${kind}_activation_funnel`];
  const trace = result.candidate_control_plane_trace?.[`${kind}_activation_funnel`];
  const context = result.candidate_context?.[kind]?.activation_funnel;
  return (direct && typeof direct === "object" ? direct : null)
    || (trace && typeof trace === "object" ? trace : null)
    || (context && typeof context === "object" ? context : null)
    || {};
}

function funnelMetrics(funnel = {}) {
  const rawCandidateCount = finiteNumber(funnel.raw_candidate_count, 0);
  const approvedCandidateCount = finiteNumber(funnel.approved_candidate_count, 0);
  return {
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    trust_blocked_count: finiteNumber(
      funnel.trust_blocked_count,
      Math.max(0, rawCandidateCount - approvedCandidateCount)
    ),
    conflict_blocked_count: finiteNumber(funnel.conflict_blocked_count, 0),
    prompt_candidate_count: finiteNumber(funnel.prompt_candidate_count, 0),
    evidence_support_field_count: finiteNumber(funnel.evidence_support_field_count, 0),
    participation_level: cleanText(funnel.participation_level) || null
  };
}

function timingDuration(timing = {}, keys = []) {
  const values = keys.map((key) => finiteNumber(timing[key], 0));
  return values.some((value) => value > 0) ? Math.round(values.reduce((sum, value) => sum + value, 0)) : null;
}

function spanSummary(spans = [], keys = []) {
  const nodeIds = new Set(keys.map((key) => String(key).replace(/_ms$/, "")));
  const matched = spans.filter((span) => nodeIds.has(span.node_id));
  return {
    count: matched.length,
    failed_count: matched.filter((span) => span.status === "FAILED").length,
    duration_ms: matched.length ? matched.reduce((sum, span) => sum + Number(span.duration_ms || 0), 0) : null,
    attempts: matched.length,
    output_count: matched.reduce((sum, span) => sum + Number(span.output_count || 0), 0) || null,
    error_code: matched.find((span) => span.error_code)?.error_code || null
  };
}

function safeNode({
  nodeId,
  category,
  status = "NOT_RUN",
  expected = false,
  durationMs = null,
  attempts = 0,
  inputCount = null,
  outputCount = null,
  errorCode = null,
  skipReason = null,
  metrics = {}
}) {
  return {
    node_id: nodeId,
    category,
    status,
    expected,
    duration_ms: finiteNumber(durationMs, null),
    attempts: finiteNumber(attempts, 0),
    input_count: finiteNumber(inputCount, null),
    output_count: finiteNumber(outputCount, null),
    error_code: cleanText(errorCode) || null,
    skip_reason: cleanText(skipReason) || null,
    metrics
  };
}

function statusFromObservation({ span, timingDurationMs, expected = false, skipReason = "" }) {
  if (span.failed_count > 0) return "FAILED";
  if (span.count > 0 || Number(timingDurationMs || 0) > 0) return "COMPLETED";
  if (skipReason) return "SKIPPED";
  return expected ? "NOT_RUN" : "SKIPPED";
}

function providerTokenMetrics(result = {}) {
  const diagnostics = result.provider_token_diagnostics || result.token_diagnostics || result.usage || {};
  return {
    input_tokens: finiteNumber(diagnostics.input_tokens ?? diagnostics.prompt_tokens, null),
    output_tokens: finiteNumber(diagnostics.output_tokens ?? diagnostics.completion_tokens, null),
    total_tokens: finiteNumber(diagnostics.total_tokens, null),
    output_cap: finiteNumber(diagnostics.output_cap ?? result.output_cap, null),
    finish_reason: cleanText(result.provider_finish_reason || diagnostics.finish_reason) || null,
    model: cleanText(result.model || result.model_id) || null,
    provider: cleanText(result.provider || result.provider_id) || null,
    response_profile: cleanText(result.provider_response_profile) || null,
    image_detail: cleanText(result.provider_image_detail) || null,
    text_verbosity: cleanText(result.provider_text_verbosity) || null,
    requested_service_tier: cleanText(result.provider_requested_service_tier) || null,
    service_tier: cleanText(result.provider_service_tier) || null
  };
}

function sidecarMetrics(result = {}) {
  const sidecars = result.workflow_sidecars && typeof result.workflow_sidecars === "object"
    ? result.workflow_sidecars
    : {};
  const statusCounts = Object.values(sidecars).reduce((counts, sidecar) => {
    const status = cleanText(sidecar?.status).toUpperCase() || "UNKNOWN";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  return { sidecar_count: Object.keys(sidecars).length, status_counts: statusCounts };
}

function safeOcrMetrics(ocr = {}) {
  return {
    status: cleanText(ocr.status).toUpperCase() || null,
    terminal: ocr.terminal === true,
    evidence_ready: ocr.evidence_ready === true,
    critical_fields_settled: ocr.critical_fields_settled === true,
    waited_ms: finiteNumber(ocr.waited_ms, null),
    post_provider_wait_ms: finiteNumber(ocr.post_provider_wait_ms, null),
    state_reads: finiteNumber(ocr.state_reads, null),
    job_count: finiteNumber(ocr.job_count, null),
    active_count: finiteNumber(ocr.active_count, null),
    status_counts: ocr.status_counts && typeof ocr.status_counts === "object" ? ocr.status_counts : {},
    patch_count: finiteNumber(ocr.patch_count, null),
    raw_patch_count: finiteNumber(ocr.raw_patch_count, null),
    historical_patch_count: finiteNumber(ocr.historical_patch_count, null),
    serial_patch_count: finiteNumber(ocr.serial_patch_count, null),
    verified_serial_ready: ocr.verified_serial_ready === true,
    verified_serial_conflict: ocr.verified_serial_conflict === true,
    verified_slab_parallel_ready: ocr.verified_slab_parallel_ready === true,
    verified_slab_parallel_conflict: ocr.verified_slab_parallel_conflict === true,
    critical_job_count: finiteNumber(ocr.critical_job_count, null),
    critical_active_count: finiteNumber(ocr.critical_active_count, null),
    serial_job_count: finiteNumber(ocr.serial_job_count, null),
    serial_active_count: finiteNumber(ocr.serial_active_count, null),
    grade_label_job_count: finiteNumber(ocr.grade_label_job_count, null),
    grade_label_active_count: finiteNumber(ocr.grade_label_active_count, null),
    card_code_job_count: finiteNumber(ocr.card_code_job_count, null),
    card_code_active_count: finiteNumber(ocr.card_code_active_count, null),
    patch_fields: compactArray(ocr.patch_fields).map(cleanText).filter(Boolean).slice(0, 30),
    job_observability: compactArray(ocr.job_observability).slice(0, 32).map((job) => ({
      job_id: cleanText(job?.job_id) || null,
      crop_role: cleanText(job?.crop_role) || null,
      status: cleanText(job?.status).toUpperCase() || "UNKNOWN",
      attempts: finiteNumber(job?.attempts, 0),
      lifecycle_ms: finiteNumber(job?.lifecycle_ms, null),
      duration_ms: finiteNumber(job?.duration_ms, null),
      patch_count: finiteNumber(job?.patch_count, null),
      patches_appended: finiteNumber(job?.patches_appended, null),
      error_code: cleanText(job?.error_code) || null
    }))
  };
}

function stageCapacityMetrics({ result = {}, timing = {}, kind } = {}) {
  const direct = kind === "catalog"
    ? result.catalog_stage_capacity
    : result.vector_stage_capacity
      || result.vector_worker?.stage_capacity
      || result.candidate_context?.vector?.worker?.stage_capacity;
  const capacity = direct && typeof direct === "object" ? direct : {};
  const prefix = `${kind}_stage_capacity`;
  const controlledCount = finiteNumber(timing[`${prefix}_controlled_count`], capacity.coordinated === true ? 1 : 0);
  const deferredCount = finiteNumber(timing[`${prefix}_deferred_count`], capacity.coordinated === true && capacity.acquired !== true ? 1 : 0);
  const releaseMissingCount = finiteNumber(
    timing[`${prefix}_release_missing_count`],
    capacity.coordinated === true && capacity.acquired === true && capacity.released !== true ? 1 : 0
  );
  const waitMs = finiteNumber(timing[`${prefix}_wait_ms`], finiteNumber(capacity.wait_ms, null));
  const observed = controlledCount > 0 || capacity.coordinated === true;
  let status = "SKIPPED";
  if (observed) status = releaseMissingCount > 0 ? "FAILED" : deferredCount > 0 ? "PARTIAL" : "COMPLETED";
  return {
    observed,
    status,
    wait_ms: waitMs,
    controlled_count: controlledCount,
    deferred_count: deferredCount,
    release_missing_count: releaseMissingCount,
    acquired: capacity.acquired === true,
    coordinated: capacity.coordinated === true,
    configured: capacity.configured === true,
    released: capacity.released === true ? true : capacity.released === false ? false : null,
    attempts: finiteNumber(capacity.attempts, null),
    slot: finiteNumber(capacity.slot, null),
    cache_hit: capacity.cache_hit === true,
    error: cleanText(capacity.error || capacity.release_error) || null
  };
}

function fieldReviewSet(result = {}) {
  const values = new Set(compactArray(result.unresolved || result.unresolved_fields).map(cleanText));
  for (const [entryKey, state] of Object.entries(result.field_states || {})) {
    const field = cleanText(state?.field_name || state?.field || entryKey);
    const status = cleanText(state?.display_status || state?.status || state?.resolution_reason).toUpperCase();
    if (/REVIEW|CONFLICT|AMBIG|ABSTAIN|UNRESOLVED/.test(status)) values.add(field);
  }
  return values;
}

function groupIsReviewed(reviewSet, group, aliases) {
  return reviewSet.has(group) || aliases.some((alias) => reviewSet.has(alias));
}

function fieldFlow(result = {}) {
  const raw = fieldContainer(result.raw_provider_fields || {});
  const resolved = fieldContainer(result.resolved_fields || result.resolved || result.fields || {});
  const rendered = fieldContainer(result.rendered_fields || {});
  const reviewSet = fieldReviewSet(result);
  const rows = Object.entries(fieldGroups).map(([group, aliases]) => {
    const rawPresent = groupPresent(raw, aliases);
    const resolvedPresent = groupPresent(resolved, aliases);
    const renderedPresent = groupPresent(rendered, aliases);
    const reviewed = groupIsReviewed(reviewSet, group, aliases);
    const safelyNarrowed = group === "parallel_exact"
      && rawPresent
      && !resolvedPresent
      && exactParallelWasSafelyNarrowed(result, raw, resolved, rendered);
    const compositeRetention = rawPresent && !resolvedPresent
      ? compositeTokenRetention({ group, aliases, raw, resolved, rendered, result })
      : { retained: false, destination_fields: [] };
    let disposition = "NOT_OBSERVED";
    if (rawPresent && resolvedPresent) disposition = "RETAINED_IN_RESOLUTION";
    else if (rawPresent && renderedPresent) disposition = "RETAINED_IN_PRESENTATION";
    else if (safelyNarrowed) disposition = "NARROWED_TO_SUPPORTED_SURFACE_COLOR";
    else if (compositeRetention.retained) disposition = "RETAINED_AS_COMPOSITE_TOKEN";
    else if (rawPresent && !resolvedPresent && reviewed) disposition = "INTENTIONALLY_ROUTED_TO_REVIEW";
    else if (rawPresent && !resolvedPresent) disposition = "UNEXPLAINED_RESOLUTION_DROP";
    else if (!rawPresent && resolvedPresent) disposition = "ADDED_BY_EVIDENCE_OR_CATALOG";
    return {
      field_group: group,
      raw_provider_present: rawPresent,
      resolved_present: resolvedPresent,
      rendered_present: renderedPresent,
      review_flagged: reviewed,
      composite_destination_fields: compositeRetention.destination_fields,
      disposition
    };
  });
  return {
    raw_provider_field_count: countPresentFields(raw),
    resolved_field_count: countPresentFields(resolved),
    rendered_field_count: countPresentFields(rendered),
    composite_token_migration_count: rows.filter((row) => row.disposition === "RETAINED_AS_COMPOSITE_TOKEN").length,
    composite_token_migration_fields: rows
      .filter((row) => row.disposition === "RETAINED_AS_COMPOSITE_TOKEN")
      .map((row) => row.field_group),
    unexplained_resolution_drop_count: rows.filter((row) => row.disposition === "UNEXPLAINED_RESOLUTION_DROP").length,
    unexplained_resolution_drop_fields: rows
      .filter((row) => row.disposition === "UNEXPLAINED_RESOLUTION_DROP")
      .map((row) => row.field_group),
    fields: rows,
    grade_atomic: {
      raw: gradeAtomicPresence(raw),
      resolved: gradeAtomicPresence(resolved),
      rendered: gradeAtomicPresence(rendered)
    }
  };
}

function gradeAtomicPresence(fields = {}) {
  return {
    grade_company: nonEmpty(fields.grade_company),
    card_grade: nonEmpty(fields.card_grade || fields.grade),
    auto_grade: nonEmpty(fields.auto_grade),
    grade_type: nonEmpty(fields.grade_type)
  };
}

function directGradePatchPresence(payload = {}) {
  const patches = Array.isArray(payload.preingestion_evidence_patches)
    ? payload.preingestion_evidence_patches
    : [];
  const names = new Set(patches.map((patch) => cleanText(patch?.field || patch?.evidence_field).toLowerCase()));
  return {
    grade_company: names.has("grade_company"),
    card_grade: names.has("card_grade"),
    auto_grade: names.has("auto_grade")
  };
}

function titleContainsAtomicValue(title = "", value = "") {
  const comparableTitle = comparableFieldText(title);
  const comparableValue = comparableFieldText(value);
  if (!comparableTitle || !comparableValue) return false;
  return ` ${comparableTitle} `.includes(` ${comparableValue} `);
}

function check(checkId, ok, { expected = null, actual = null, severity = "ERROR", detail = "" } = {}) {
  return {
    check_id: checkId,
    status: ok ? "PASS" : "FAIL",
    severity,
    expected,
    actual,
    detail: cleanText(detail) || null
  };
}

function reconciliationChecks({ result, payload, catalog, vector, ocr, tokens, fieldFlowReport, title, catalogCapacity, vectorCapacity }) {
  const checks = [];
  if (finiteNumber(ocr.job_count, null) !== null) {
    const statusTotal = Object.values(ocr.status_counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    checks.push(check("ocr_job_status_count_conservation", statusTotal === Number(ocr.job_count || 0), {
      expected: Number(ocr.job_count || 0), actual: statusTotal
    }));
  }
  if (finiteNumber(ocr.raw_patch_count, null) !== null) {
    const classified = Number(ocr.patch_count || 0) + Number(ocr.historical_patch_count || 0);
    checks.push(check("ocr_patch_version_count_conservation", classified === Number(ocr.raw_patch_count || 0), {
      expected: Number(ocr.raw_patch_count || 0), actual: classified
    }));
  }
  for (const [kind, funnel] of [["catalog", catalog], ["vector", vector]]) {
    checks.push(check(`${kind}_prompt_not_above_approved`, funnel.prompt_candidate_count <= funnel.approved_candidate_count, {
      expected: `<=${funnel.approved_candidate_count}`, actual: funnel.prompt_candidate_count
    }));
    checks.push(check(`${kind}_approved_not_above_raw`, funnel.approved_candidate_count <= funnel.raw_candidate_count, {
      expected: `<=${funnel.raw_candidate_count}`, actual: funnel.approved_candidate_count
    }));
    checks.push(check(`${kind}_trust_blocked_not_above_raw`, funnel.trust_blocked_count <= funnel.raw_candidate_count, {
      expected: `<=${funnel.raw_candidate_count}`, actual: funnel.trust_blocked_count
    }));
    const classifiedCandidateCount = funnel.approved_candidate_count + funnel.trust_blocked_count;
    if (funnel.raw_candidate_count > classifiedCandidateCount) {
      checks.push(check(`${kind}_candidate_drop_has_explanation`, false, {
        severity: "WARNING",
        expected: "every raw candidate classified as approved or trust-blocked",
        actual: `${funnel.raw_candidate_count - classifiedCandidateCount} raw candidates with no classified outcome`
      }));
    }
  }
  if (tokens.input_tokens !== null && tokens.output_tokens !== null && tokens.total_tokens !== null) {
    checks.push(check("provider_token_count_conservation", tokens.input_tokens + tokens.output_tokens === tokens.total_tokens, {
      expected: tokens.input_tokens + tokens.output_tokens, actual: tokens.total_tokens
    }));
  }
  for (const [kind, capacity] of [["catalog", catalogCapacity], ["vector", vectorCapacity]]) {
    if (!capacity?.observed) continue;
    checks.push(check(`${kind}_stage_capacity_release_complete`, capacity.release_missing_count === 0, {
      expected: 0,
      actual: capacity.release_missing_count,
      detail: capacity.error || ""
    }));
  }
  const failedResult = Boolean(result.provider_error_type || result.provider_error_code || cleanText(result.confidence).toUpperCase() === "FAILED");
  checks.push(check("writer_title_matches_result_status", failedResult ? !title : Boolean(title), {
    expected: failedResult ? "no writer title" : "writer title present",
    actual: title ? "writer title present" : "writer title absent"
  }));
  checks.push(check("critical_field_flow_has_no_silent_drop", fieldFlowReport.unexplained_resolution_drop_count === 0, {
    expected: 0,
    actual: fieldFlowReport.unexplained_resolution_drop_count,
    detail: fieldFlowReport.unexplained_resolution_drop_fields.join(",")
  }));
  checks.push(check("field_flow_has_no_cross_bracket_composite_migration", fieldFlowReport.composite_token_migration_count === 0, {
    severity: "WARNING",
    expected: 0,
    actual: fieldFlowReport.composite_token_migration_count,
    detail: fieldFlowReport.composite_token_migration_fields.join(",")
  }));
  const resolvedFields = fieldContainer(result.resolved_fields || result.resolved || result.fields || {});
  const directGradePatches = directGradePatchPresence(payload);
  const resolvedGrade = fieldFlowReport.grade_atomic?.resolved || {};
  const resolvedGradeScorePresent = resolvedGrade.card_grade || resolvedGrade.auto_grade;
  checks.push(check("resolved_grade_score_has_company", !resolvedGradeScorePresent || resolvedGrade.grade_company, {
    expected: "grade company present whenever a grade score is resolved",
    actual: resolvedGradeScorePresent && !resolvedGrade.grade_company ? "score without company" : "complete or absent"
  }));
  checks.push(check("direct_grade_company_reaches_resolution", !directGradePatches.grade_company || resolvedGrade.grade_company, {
    expected: directGradePatches.grade_company ? "resolved grade_company" : "not applicable",
    actual: resolvedGrade.grade_company ? "resolved" : "missing"
  }));
  checks.push(check("direct_card_grade_reaches_resolution", !directGradePatches.card_grade || resolvedGrade.card_grade, {
    expected: directGradePatches.card_grade ? "resolved card_grade" : "not applicable",
    actual: resolvedGrade.card_grade ? "resolved" : "missing"
  }));
  if (resolvedGrade.grade_company && resolvedGradeScorePresent) {
    const gradeCompany = resolvedFields.grade_company;
    const gradeScore = resolvedFields.card_grade || resolvedFields.grade || resolvedFields.auto_grade;
    checks.push(check(
      "resolved_grade_is_rendered",
      titleContainsAtomicValue(title, gradeCompany) && titleContainsAtomicValue(title, gradeScore),
      {
        expected: `${gradeCompany || "grade company"} ${gradeScore || "grade score"}`,
        actual: title
      }
    ));
  }
  return checks;
}

export function buildPipelineNodeLedger({ result = {}, timingContext = null, payload = {} } = {}) {
  const spanSnapshot = snapshotNodeSpans(timingContext);
  const spans = spanSnapshot.spans;
  const timing = result.timing || timingContext?.timing || {};
  const imageCount = Array.isArray(payload.images)
    ? payload.images.length
    : finiteNumber(result.provider_input_image_count, spanSnapshot.request_context.image_count || 0);
  const catalog = funnelMetrics(funnelFromResult(result, "catalog"));
  const vector = funnelMetrics(funnelFromResult(result, "vector"));
  const ocr = result.preingestion_ocr_rendezvous && typeof result.preingestion_ocr_rendezvous === "object"
    ? result.preingestion_ocr_rendezvous
    : {};
  const ocrMetrics = safeOcrMetrics(ocr);
  const tokens = providerTokenMetrics(result);
  const flow = fieldFlow(result);
  const title = cleanText(result.final_title || result.title || result.model_title_suggestion || result.writing?.title);
  const bundleUsed = result.bundle_used === true || payload.preingestion_bundle_used === true || Boolean(result.preingestion_bundle_id);
  const bundleLoadedByV4PreL2 = payload.v4_pre_l2_bundle_loaded === true;
  const clientTiming = payload.clientTiming || payload.client_timing || {};
  const preingestionSummary = result.preprocessing_summary || payload.preingestion_summary || {};
  const hasProviderEvidence = Boolean(tokens.provider || flow.raw_provider_field_count || result.provider_error_type || result.provider_error_code);
  const hasCatalogTrace = Object.keys(funnelFromResult(result, "catalog")).length > 0;
  const hasVectorTrace = Object.keys(funnelFromResult(result, "vector")).length > 0
    || Boolean(result.candidate_context?.vector?.signal?.status || result.vector_runtime_status);
  const hasResolution = Boolean(result.identity_resolution || result.field_states || flow.resolved_field_count);
  const sidecars = sidecarMetrics(result);
  const providerCapacityHandoff = result.provider_capacity_stage_handoff || {};
  const catalogCapacity = stageCapacityMetrics({ result, timing, kind: "catalog" });
  const vectorCapacity = stageCapacityMetrics({ result, timing, kind: "vector" });

  const definitions = [
    { id: "client_image_prepare", category: "client", keys: ["client_image_prepare_ms"], expected: finiteNumber(clientTiming.client_image_prepare_ms, 0) > 0, input: imageCount, output: imageCount, skip: finiteNumber(clientTiming.client_image_prepare_ms, 0) > 0 ? "" : "client_timing_not_reported" },
    { id: "client_image_upload", category: "client", keys: ["client_upload_ms"], expected: finiteNumber(clientTiming.client_upload_ms, 0) > 0, input: imageCount, output: imageCount, skip: finiteNumber(clientTiming.client_upload_ms, 0) > 0 ? "" : "storage_objects_reused_or_timing_not_reported" },
    {
      id: "client_preingestion_build",
      category: "preingestion",
      keys: ["client_background_prepare_ms"],
      expected: bundleUsed,
      status: bundleUsed ? "COMPLETED" : null,
      input: imageCount,
      output: bundleUsed ? 1 : 0,
      skip: bundleUsed ? "" : "no_preingestion_bundle",
      metrics: {
        background_wait_ms: finiteNumber(clientTiming.client_background_prepare_wait_ms, null),
        bundle_reused: clientTiming.client_preingestion_bundle_reused === true,
        worker_jobs_enqueued: finiteNumber(preingestionSummary.worker_jobs_enqueued, null),
        worker_jobs_attempted: finiteNumber(preingestionSummary.worker_jobs_attempted, null),
        signed_read_url_count: finiteNumber(preingestionSummary.signed_read_url_count, null),
        signed_read_url_error_count: finiteNumber(preingestionSummary.signed_read_url_error_count, null)
      }
    },
    { id: "client_fast_scout_prewarm", category: "client", keys: ["client_fast_scout_prewarm_wait_ms"], expected: finiteNumber(clientTiming.client_fast_scout_prewarm_wait_ms, 0) > 0, input: imageCount, output: null, skip: finiteNumber(clientTiming.client_fast_scout_prewarm_wait_ms, 0) > 0 ? "" : "prewarm_cached_or_not_reported" },
    {
      id: "client_speculative_recognition",
      category: "client",
      keys: ["client_speculative_ms", "client_speculative_wait_ms"],
      expected: clientTiming.client_speculative_used === true,
      status: clientTiming.client_speculative_used === true ? "COMPLETED" : null,
      input: clientTiming.client_speculative_used === true ? 1 : 0,
      output: clientTiming.client_speculative_used === true ? 1 : 0,
      skip: clientTiming.client_speculative_used === true ? "" : "speculative_recognition_not_used"
    },
    { id: "client_request_prepare", category: "client", keys: ["client_request_prepare_ms"], expected: finiteNumber(clientTiming.client_request_prepare_ms, 0) > 0, input: imageCount, output: 1, skip: finiteNumber(clientTiming.client_request_prepare_ms, 0) > 0 ? "" : "client_timing_not_reported" },
    { id: "image_quality", category: "input", keys: ["image_quality_check_ms"], expected: true, input: imageCount },
    { id: "approved_memory_lookup", category: "memory", keys: ["approved_memory_lookup_ms"], expected: true, input: 1 },
    { id: "identity_cache_lookup", category: "memory", keys: ["identity_cache_lookup_ms"], expected: true, input: 1 },
    {
      id: "preingestion_bundle_load",
      category: "preingestion",
      keys: ["preingestion_bundle_load_ms"],
      expected: bundleUsed && !bundleLoadedByV4PreL2,
      input: bundleUsed ? 1 : null,
      skip: bundleLoadedByV4PreL2
        ? "bundle_already_loaded_by_v4_pre_l2"
        : bundleUsed ? "" : "no_preingestion_bundle"
    },
    {
      id: "preingestion_retrieval_anchor_refresh",
      category: "evidence",
      keys: ["preingestion_retrieval_anchor_refresh_ms"],
      expected: Boolean(result.preingestion_retrieval_refresh),
      input: bundleUsed ? 1 : null,
      output: compactArray(result.preingestion_retrieval_anchor_fields).length,
      skip: result.preingestion_retrieval_refresh ? "" : "retrieval_did_not_wait_for_provider_observation",
      metrics: {
        refreshed: result.preingestion_retrieval_refresh?.refreshed === true,
        added_patch_count: finiteNumber(result.preingestion_retrieval_refresh?.added_patch_count, null),
        anchor_fields: compactArray(result.preingestion_retrieval_anchor_fields).map(cleanText).filter(Boolean).slice(0, 20)
      }
    },
    { id: "signed_image_access", category: "input", keys: ["signed_url_ms"], expected: hasProviderEvidence, input: imageCount },
    { id: "recognition_preflight", category: "perception", keys: ["recognition_preflight_ms"], expected: false, input: imageCount, skip: "optional_recognition_worker_path" },
    { id: "stored_visual_feature_lookup", category: "retrieval", keys: ["stored_visual_feature_lookup_ms"], expected: false, input: imageCount, skip: "optional_precomputed_feature_path" },
    {
      id: "catalog_stage_capacity",
      category: "orchestration",
      keys: ["catalog_stage_capacity_wait_ms"],
      expected: catalogCapacity.observed,
      status: catalogCapacity.status,
      input: catalogCapacity.observed ? 1 : 0,
      output: catalogCapacity.acquired ? 1 : 0,
      skip: catalogCapacity.observed ? "" : "catalog_stage_capacity_control_not_observed",
      metrics: catalogCapacity
    },
    { id: "catalog_retrieval", category: "retrieval", keys: ["catalog_retrieval_ms"], expected: hasCatalogTrace, input: 1, output: catalog.raw_candidate_count, metrics: catalog },
    {
      id: "vector_stage_capacity",
      category: "orchestration",
      keys: ["vector_stage_capacity_wait_ms"],
      expected: vectorCapacity.observed,
      status: vectorCapacity.status,
      input: vectorCapacity.observed ? 1 : 0,
      output: vectorCapacity.acquired ? 1 : 0,
      skip: vectorCapacity.observed ? "" : "vector_stage_capacity_control_not_observed",
      metrics: vectorCapacity
    },
    { id: "vector_embedding", category: "retrieval", keys: ["vector_embedding_ms", "vector_embedding_overlap_ms"], expected: hasVectorTrace, input: imageCount, output: finiteNumber(result.candidate_context?.vector?.worker_feature_count, null) },
    {
      id: "post_observation_retrieval_hedge",
      category: "retrieval",
      keys: ["post_observation_catalog_vector_hedge_wait_ms", "post_observation_catalog_vector_overlap_ms"],
      expected: false,
      input: hasVectorTrace && hasCatalogTrace ? 2 : null,
      output: hasVectorTrace && hasCatalogTrace ? 2 : null,
      skip: Number(timing.post_observation_catalog_vector_hedge_wait_ms || 0) > 0
        ? ""
        : "post_observation_hedge_not_used"
    },
    {
      id: "post_observation_retrieval_deadline",
      category: "retrieval",
      keys: ["post_observation_retrieval_deadline_ms"],
      expected: false,
      input: hasVectorTrace || hasCatalogTrace ? 1 : null,
      output: finiteNumber(timing.post_observation_retrieval_deferred_count, 0) > 0 ? 0 : 1,
      skip: Number(timing.post_observation_retrieval_deadline_ms || 0) > 0
        ? ""
        : "post_observation_deadline_not_used",
      metrics: {
        deferred_count: finiteNumber(timing.post_observation_retrieval_deferred_count, 0),
        catalog_settled_within_budget_count: finiteNumber(timing.post_observation_catalog_settled_within_budget_count, 0),
        vector_settled_within_budget_count: finiteNumber(timing.post_observation_vector_settled_within_budget_count, 0)
      }
    },
    { id: "vector_retrieval", category: "retrieval", keys: ["vector_retrieval_ms"], expected: hasVectorTrace, input: 1, output: vector.raw_candidate_count, metrics: vector },
    { id: "provider", category: "perception", keys: ["provider_total_ms"], expected: hasProviderEvidence, input: imageCount, output: flow.raw_provider_field_count, metrics: { ...tokens, server_queue_ms: finiteNumber(timing.server_queue_ms, 0) } },
    {
      id: "provider_capacity_handoff",
      category: "orchestration",
      keys: ["provider_capacity_handoff_ms"],
      expected: providerCapacityHandoff.enabled === true,
      input: providerCapacityHandoff.enabled === true ? 1 : 0,
      output: providerCapacityHandoff.released === true ? 1 : 0,
      skip: providerCapacityHandoff.enabled === true ? "" : "provider_done_handoff_disabled",
      metrics: {
        release_boundary: providerCapacityHandoff.release_boundary || null,
        released: providerCapacityHandoff.released === true,
        refill_triggered: providerCapacityHandoff.refill?.triggered === true,
        overlapped_after_initial_provider: providerCapacityHandoff.overlapped_after_initial_provider === true,
        overlap_window_ms: finiteNumber(providerCapacityHandoff.overlap_window_ms, null),
        join_wait_ms: finiteNumber(providerCapacityHandoff.join_wait_ms, null),
        error: providerCapacityHandoff.error || null
      }
    },
    { id: "preingestion_ocr", category: "perception", keys: ["preingestion_ocr_rendezvous_wait_ms"], expected: bundleUsed, input: finiteNumber(ocr.job_count, null), output: finiteNumber(ocr.patch_count, null), metrics: ocrMetrics },
    {
      id: "preingestion_evidence_refresh",
      category: "evidence",
      keys: ["preingestion_evidence_refresh_ms"],
      expected: result.preingestion_evidence_refresh?.refreshed === true,
      output: finiteNumber(result.preingestion_evidence_refresh?.added_patch_count, null),
      skip: result.preingestion_evidence_refresh?.refreshed === true
        ? ""
        : cleanText(result.preingestion_evidence_refresh?.reason)
          || (Number(ocr.patch_count || 0) > 0
            ? "ocr_patches_already_available_or_no_refresh_needed"
            : "no_current_ocr_patches")
    },
    { id: "evidence_completion", category: "evidence", keys: ["evidence_completion_ms"], expected: false, skip: "only_runs_for_unresolved_or_conflicting_fields" },
    { id: "identity_resolution", category: "decision", keys: ["resolver_ms"], expected: hasResolution, input: flow.raw_provider_field_count, output: flow.resolved_field_count, metrics: { conflict_count: compactArray(result.conflict_map || result.conflicts).length, unresolved_count: compactArray(result.unresolved || result.unresolved_fields).length } },
    { id: "renderer", category: "output", keys: ["renderer_ms"], expected: !Boolean(result.provider_error_type || result.provider_error_code), input: flow.resolved_field_count, output: title ? 1 : 0, metrics: { title_length: title.length, rendered_field_count: flow.rendered_field_count } },
    { id: "identity_cache_write", category: "memory", keys: ["identity_cache_write_ms"], expected: false, input: title ? 1 : 0, skip: "optional_cache_write" },
    { id: "workflow_sidecars", category: "learning", keys: ["workflow_sidecars_ms"], expected: true, input: title ? 1 : 0, output: sidecars.sidecar_count, metrics: sidecars }
  ];

  const nodes = definitions.map((definition) => {
    const span = spanSummary(spans, definition.keys);
    const durationMs = span.duration_ms ?? timingDuration(timing, definition.keys);
    let status = definition.status || statusFromObservation({
      span,
      timingDurationMs: durationMs,
      expected: definition.expected,
      skipReason: definition.skip
    });
    let errorCode = span.error_code;
    let skipReason = definition.skip || null;
    const metrics = { ...(definition.metrics || {}) };
    if (definition.id === "catalog_retrieval") {
      metrics.trace_observed = hasCatalogTrace;
      metrics.timing_observed = span.count > 0 || durationMs !== null;
      if (status === "NOT_RUN" && hasCatalogTrace) {
        status = "COMPLETED";
        skipReason = null;
      }
    }
    if (definition.id === "post_observation_retrieval_deadline"
      && Number(timing.post_observation_retrieval_deferred_count || 0) > 0) {
      status = "PARTIAL";
      skipReason = null;
    }
    if (definition.id === "provider" && (result.provider_error_type || result.provider_error_code)) {
      status = "FAILED";
      errorCode = result.provider_error_type || result.provider_error_code;
    }
    if (definition.id === "preingestion_ocr" && Object.keys(ocr).length) {
      const ocrStatus = cleanText(ocr.status).toUpperCase();
      status = /TIMEOUT|FAIL/.test(ocrStatus) ? "PARTIAL" : "COMPLETED";
      skipReason = null;
    }
    if (definition.id === "vector_retrieval") {
      const runtime = cleanText(result.candidate_context?.vector?.signal?.status || result.vector_runtime_status).toUpperCase();
      if (/UNAVAILABLE|ERROR|FAILED/.test(runtime)) status = "PARTIAL";
      if (runtime) skipReason = null;
    }
    if (definition.id === "workflow_sidecars" && sidecars.sidecar_count) {
      status = Number(sidecars.status_counts.FAILED || 0) > 0 ? "PARTIAL" : "COMPLETED";
      skipReason = null;
    }
    return safeNode({
      nodeId: definition.id,
      category: definition.category,
      status,
      expected: definition.expected,
      durationMs,
      attempts: span.attempts,
      inputCount: definition.input,
      outputCount: definition.output ?? span.output_count,
      errorCode,
      skipReason: status === "SKIPPED" ? skipReason : null,
      metrics
    });
  });

  const checks = reconciliationChecks({
    result,
    payload,
    catalog,
    vector,
    ocr,
    tokens,
    fieldFlowReport: flow,
    title,
    catalogCapacity,
    vectorCapacity
  });
  const anomalies = checks.filter((item) => item.status === "FAIL");
  const missingRequired = nodes.filter((node) => node.expected && node.status === "NOT_RUN");
  const statusCounts = nodes.reduce((counts, node) => {
    counts[node.status] = (counts[node.status] || 0) + 1;
    return counts;
  }, {});

  return {
    schema_version: ledgerSchemaVersion,
    request_context: {
      asset_id: cleanText(payload.asset_id || payload.assetId || spanSnapshot.request_context.asset_id) || null,
      recognition_session_id: cleanText(payload.recognition_session_id || spanSnapshot.request_context.recognition_session_id) || null,
      image_count: imageCount,
      bundle_used: bundleUsed
    },
    coverage: {
      declared_node_count: nodes.length,
      observed_node_count: nodes.filter((node) => !["NOT_RUN", "SKIPPED"].includes(node.status)).length,
      expected_node_count: nodes.filter((node) => node.expected).length,
      missing_required_node_count: missingRequired.length,
      missing_required_node_ids: missingRequired.map((node) => node.node_id),
      status_counts: statusCounts
    },
    nodes,
    spans,
    field_flow: flow,
    reconciliation: {
      check_count: checks.length,
      pass_count: checks.filter((item) => item.status === "PASS").length,
      anomaly_count: anomalies.length,
      error_count: anomalies.filter((item) => item.severity === "ERROR").length,
      warning_count: anomalies.filter((item) => item.severity === "WARNING").length,
      checks,
      anomalies
    }
  };
}
