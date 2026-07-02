import crypto from "node:crypto";

export const workflowSidecarStatuses = Object.freeze({
  NOT_TRIGGERED: "NOT_TRIGGERED",
  QUEUED: "QUEUED",
  CREATED: "CREATED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  NOT_CONFIGURED: "NOT_CONFIGURED"
});

const sidecarKeys = Object.freeze(["paddle_ocr", "splink", "cleanlab", "label_studio", "cvat", "fiftyone"]);
const sensitiveKeyPattern = /(?:key|token|secret|authorization|cookie|password|signed_url|signedUrl|data_url|dataUrl|base64|image_url|imageUrl|url)$/i;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== "") : [];
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeId(value, fallbackPrefix = "workflow") {
  const text = cleanText(value);
  if (text) return text.slice(0, 120);
  return `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== "object") {
    if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}...`;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .slice(0, 80)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
  );
}

function sanitizeImage(image = {}) {
  return {
    image_id: cleanText(image.image_id || image.imageId || image.id) || null,
    role: cleanText(image.role || image.image_role || image.imageRole) || null,
    bucket: cleanText(image.bucket) || null,
    object_path: cleanText(image.object_path || image.objectPath) || null,
    content_sha256: cleanText(image.content_sha256 || image.contentSha256).toLowerCase() || null,
    width: finiteNumber(image.width, null),
    height: finiteNumber(image.height, null),
    size: finiteNumber(image.size || image.byte_size || image.byteSize, null)
  };
}

function candidateId(candidate = {}) {
  return cleanText(
    candidate.candidate_identity_id
    || candidate.identity_id
    || candidate.candidate_id
    || candidate.id
    || candidate.source_url
  );
}

function normalizeConflictingFields(candidate = {}) {
  return [
    ...compactArray(candidate.conflicting_fields),
    ...compactArray(candidate.direct_evidence_conflicts),
    ...compactArray(candidate.conflicts)
  ]
    .map((field) => typeof field === "string" ? field : cleanText(field?.field || field?.name || field?.type))
    .filter(Boolean);
}

function sanitizeCandidate(candidate = {}, index = 0) {
  return {
    candidate_id: candidateId(candidate) || `candidate_${index + 1}`,
    rank: finiteNumber(candidate.rank, index + 1),
    provider: cleanText(candidate.provider || candidate.provider_id || candidate.source_type) || null,
    source_trust: cleanText(candidate.source_trust || candidate.retrieval_status || candidate.review_status) || null,
    title: cleanText(candidate.title || candidate.canonical_title || candidate.canonical_candidate_title).slice(0, 220) || null,
    normalized_score: finiteNumber(candidate.normalized_score ?? candidate.combined_score ?? candidate.match_score, null),
    raw_score: finiteNumber(candidate.raw_score ?? candidate.similarity, null),
    match_probability: finiteNumber(candidate.match_probability ?? candidate.splink_match_probability, null),
    supporting_fields: compactArray(candidate.supporting_fields || candidate.matched_fields).slice(0, 20),
    conflicting_fields: normalizeConflictingFields(candidate).slice(0, 20),
    fields: sanitizeValue(candidate.fields || candidate.candidate_fields || candidate.canonical_fields || {})
  };
}

function candidatesFromPacket(packet = {}) {
  if (Array.isArray(packet)) return packet;
  if (Array.isArray(packet.candidates)) return packet.candidates;
  if (Array.isArray(packet.vector_retrieval?.candidates)) return packet.vector_retrieval.candidates;
  if (Array.isArray(packet.sources)) return packet.sources;
  if (Array.isArray(packet.catalog_candidates)) return packet.catalog_candidates;
  return [];
}

function catalogCandidatesFromResult(result = {}) {
  return [
    ...candidatesFromPacket(result.catalog_assist_packet),
    ...candidatesFromPacket(result.catalog_candidate_packet),
    ...candidatesFromPacket(result.catalog_retrieval),
    ...candidatesFromPacket(result.catalog_candidates)
  ]
    .map(sanitizeCandidate)
    .filter((candidate, index, source) => source.findIndex((item) => item.candidate_id === candidate.candidate_id) === index)
    .slice(0, 25);
}

function vectorCandidatesFromResult(result = {}) {
  return [
    ...candidatesFromPacket(result.vector_assist_packet),
    ...candidatesFromPacket(result.vector_candidate_packet),
    ...candidatesFromPacket(result.vector_retrieval),
    ...candidatesFromPacket(result.retrieval),
    ...candidatesFromPacket(result.vector_candidates)
  ]
    .map(sanitizeCandidate)
    .filter((candidate, index, source) => source.findIndex((item) => item.candidate_id === candidate.candidate_id) === index)
    .slice(0, 25);
}

function fieldTaskReport(result = {}) {
  const report = result.field_task_orchestration || result.field_tasks || {};
  if (Array.isArray(report.tasks)) return report;
  return {
    status: report.status || null,
    tasks: Array.isArray(report) ? report : []
  };
}

function reviewFieldsFromResult(result = {}) {
  const fromTasks = compactArray(fieldTaskReport(result).tasks)
    .filter((task) => /REVIEW|CONFLICT|FAILED|REQUIRED/i.test(cleanText(task.status || task.route || task.reason)))
    .flatMap((task) => compactArray(task.fields || task.field_names || [task.field || task.id || task.task_id]));
  const fromUnresolved = compactArray(result.unresolved || result.unresolved_fields);
  const fromStates = Object.entries(result.field_states || {})
    .filter(([, state]) => /REVIEW|CONFLICT|AMBIG|ABSTAIN/i.test(cleanText(state?.display_status || state?.status || state?.resolution_reason)))
    .map(([field]) => field);
  return [...new Set([...fromTasks, ...fromUnresolved, ...fromStates].map(cleanText).filter(Boolean))].slice(0, 40);
}

function riskFlagsFromResult(result = {}) {
  const flags = new Set();
  if (cleanText(result.confidence).toUpperCase() === "FAILED" || result.provider_error_code || result.provider_error_type) flags.add("PROVIDER_FAILURE");
  if (compactArray(result.conflict_map).length || compactArray(result.conflicts).length) flags.add("FIELD_CONFLICT");
  if (reviewFieldsFromResult(result).length) flags.add("WRITER_REVIEW_REQUIRED");
  if (result.cold_start_status && /GAP|NONE|UNKNOWN|REVIEW/i.test(result.cold_start_status)) flags.add(cleanText(result.cold_start_status));
  if (result.open_set_status && /NONE|LOW|NO_EXACT|FAMILY/i.test(result.open_set_status)) flags.add(cleanText(result.open_set_status));
  if (result.provider_error_code === "OCR_FIELD_CONFLICT" || cleanText(result.reason).includes("OCR_FIELD_CONFLICT")) flags.add("OCR_FIELD_CONFLICT");
  if (result.retrieval_title_assist_used || result.retrieval_title_assist?.used) flags.add("SAFE_ASSIST_USED");
  if (result.vector_lazy_skip === true) flags.add("VECTOR_LAZY_SKIP");
  return [...flags].slice(0, 40);
}

function selectedCandidateFromResult(result = {}) {
  const selected = result.selected_candidate
    || result.candidate_proxy_decision?.selected_candidate
    || result.candidate_proxy_decision
    || result.catalog_selected_candidate
    || result.vector_selected_candidate;
  if (!selected) return null;
  return sanitizeCandidate({
    ...selected,
    candidate_identity_id: selected.selected_candidate_id || selected.candidate_identity_id || selected.id
  });
}

export function defaultWorkflowSidecars(status = workflowSidecarStatuses.NOT_TRIGGERED, reason = "") {
  return {
    paddle_ocr: {
      status,
      task_count: 0,
      crop_types: [],
      reason: reason || null
    },
    splink: {
      status,
      cluster_id: null,
      duplicate_warning: false,
      match_probability: null,
      reason: reason || null
    },
    cleanlab: {
      status,
      quality_finding_count: 0,
      review_priority: "NONE",
      reason: reason || null
    },
    label_studio: {
      status,
      task_created: false,
      task_id: null,
      review_url: null,
      reason: reason || null
    },
    cvat: {
      status,
      task_created: false,
      task_id: null,
      review_url: null,
      reason: reason || null
    },
    fiftyone: {
      status,
      sample_exported: false,
      dataset_name: null,
      sample_id: null,
      reason: reason || null
    }
  };
}

export function buildRecognitionWorkflowEvent({
  result = {},
  payload = {},
  timing = null,
  now = new Date()
} = {}) {
  const images = compactArray(payload.images || result.images).map(sanitizeImage);
  const resolvedFields = sanitizeValue(result.resolved_fields || result.resolved || result.fields || {});
  const catalogCandidates = catalogCandidatesFromResult(result);
  const vectorCandidates = vectorCandidatesFromResult(result);
  const reviewRequiredFields = reviewFieldsFromResult(result);
  const riskFlags = riskFlagsFromResult(result);

  return {
    event_id: crypto.randomUUID(),
    analysis_run_id: safeId(
      result.analysis_run_id
      || result.analysisRunId
      || result.usage?.analysis_run_id
      || payload.analysis_run_id
      || payload.analysisRunId,
      "analysis"
    ),
    asset_id: cleanText(result.asset_id || result.assetId || payload.asset_id || payload.assetId || payload.candidate_id) || null,
    source_record_id: cleanText(
      result.source_record_id
      || result.source_feedback_id
      || payload.source_record_id
      || payload.source_feedback_id
      || payload.sourceFeedbackId
      || payload.candidate_id
    ) || null,
    created_at: now.toISOString(),
    images,
    provider_mode: cleanText(result.provider || result.provider_mode || payload.provider) || null,
    cold_start_status: cleanText(result.cold_start_status) || null,
    open_set_status: cleanText(result.open_set_status) || null,
    final_title: cleanText(result.final_title || result.title).slice(0, 300) || null,
    rendered_title: cleanText(result.rendered_title || result.rendered_fields?.rendered_title || result.rendered_fields?.title).slice(0, 300) || null,
    resolved_fields: resolvedFields,
    evidence_patches: sanitizeValue(result.evidence_patches || result.ocr_evidence_patches || result.evidence || {}),
    field_task_orchestration: sanitizeValue(fieldTaskReport(result)),
    catalog_candidates: catalogCandidates,
    vector_candidates: vectorCandidates,
    selected_candidate: selectedCandidateFromResult(result),
    retrieval_title_assist_used: result.retrieval_title_assist_used === true || result.retrieval_title_assist?.used === true,
    vector_lazy_skip: result.vector_lazy_skip === true,
    catalog_cache_hit: result.catalog_cache_hit === true,
    timing: sanitizeValue(timing || result.timing || {}),
    risk_flags: riskFlags,
    review_required_fields: reviewRequiredFields
  };
}

function candidateHasConflict(candidate = {}) {
  return compactArray(candidate.conflicting_fields).length > 0;
}

function hasCropIssue(event = {}) {
  const fields = event.review_required_fields || [];
  const flags = event.risk_flags || [];
  const taskText = JSON.stringify(event.field_task_orchestration || {}).toLowerCase();
  return fields.some((field) => /serial|collector|card_number|checklist|grade|cert|tcg|product|player|surface/i.test(field))
    || flags.some((flag) => /OCR|IMAGE|CROP|MULTI/i.test(flag))
    || /ocr_|crop|region|slab|serial/.test(taskText);
}

export function summarizeWorkflowTriggers(event = {}) {
  const catalogCandidates = event.catalog_candidates || [];
  const vectorCandidates = event.vector_candidates || [];
  const conflictedCandidates = [...catalogCandidates, ...vectorCandidates].filter(candidateHasConflict);
  const reviewFields = event.review_required_fields || [];
  const riskFlags = event.risk_flags || [];
  const providerFailed = riskFlags.includes("PROVIDER_FAILURE");
  const lowConfidence = reviewFields.length > 0 || providerFailed || riskFlags.some((flag) => /LOW|REVIEW|ABSTAIN|AMBIG|GAP|FAIL/i.test(flag));
  const duplicateRisk = catalogCandidates.length > 1
    || conflictedCandidates.length > 0
    || riskFlags.some((flag) => /DUPLICATE|CATALOG_GAP|CANDIDATE|CONFLICT/i.test(flag));

  return {
    splink: duplicateRisk,
    cleanlab: lowConfidence || conflictedCandidates.length > 0,
    label_studio: reviewFields.length > 0 || riskFlags.some((flag) => /REVIEW|GAP|CONFLICT|NO_EXACT|NONE_OF_THE_ABOVE/i.test(flag)),
    cvat: hasCropIssue(event),
    fiftyone: providerFailed
      || conflictedCandidates.length > 0
      || riskFlags.some((flag) => /FAIL|REGRESSION|CONFLICT|GAP|SAFE_ASSIST|VECTOR|CRITICAL/i.test(flag))
  };
}

export function mergeWorkflowSidecars(result = {}, sidecars = {}) {
  const defaults = defaultWorkflowSidecars();
  return {
    ...result,
    workflow_sidecars: Object.fromEntries(
      sidecarKeys.map((key) => [key, { ...defaults[key], ...(sidecars[key] || {}) }])
    )
  };
}

export function workflowSidecarsEnabled(env = process.env) {
  return boolValue(env.DATA_LOOP_SIDECARS_ENABLED, true);
}
