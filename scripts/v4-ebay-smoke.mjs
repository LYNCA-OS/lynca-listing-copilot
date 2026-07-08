import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fairTokenRecall, policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, String(value || ""));
}

function loadDatasetItems(dataset) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || dataset.cards || [];
}

async function readDataset(path) {
  const dataset = JSON.parse(await readFile(resolve(path), "utf8"));
  return loadDatasetItems(dataset);
}

async function readSealedLabels(path) {
  const byCaseId = new Map();
  if (!path) return byCaseId;
  const text = await readFile(resolve(path), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.case_id) byCaseId.set(row.case_id, row);
    } catch {
      // Ignore bad sealed-label rows; smoke should still run.
    }
  }
  return byCaseId;
}

function candidateId(item = {}, index = 0) {
  return cleanText(item.asset_id || item.candidate_id || item.id || item.physical_card_id || `v4-ebay-smoke-${index + 1}`);
}

function itemImages(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.bucket && image?.object_path)
    .slice(0, 2)
    .map((image, index) => ({
      id: image.image_id || `${candidateId(item)}_${index + 1}`,
      image_id: image.image_id || `${candidateId(item)}_${index + 1}`,
      name: `${image.role || `image_${index + 1}`}:${candidateId(item)}`,
      bucket: image.bucket,
      object_path: image.object_path,
      role: image.role || `image_${index + 1}_original`,
      capture_angle: image.capture_angle || `image_${index + 1}`,
      width: image.width || null,
      height: image.height || null
    }));
}

function verificationCacheKey(image = {}) {
  return `${image.bucket || ""}:${image.object_path || image.objectPath || ""}`;
}

async function verifyExistingImage({
  baseUrl,
  cookie,
  image,
  assetId,
  requestTimeoutMs,
  verificationCache,
  fetchImpl = globalThis.fetch
}) {
  const cacheKey = verificationCacheKey(image);
  if (verificationCache?.has(cacheKey)) return verificationCache.get(cacheKey);
  const response = await postJson({
    baseUrl,
    path: "/api/listing-image-verify-existing",
    cookie,
    payload: {
      object_path: image.object_path,
      bucket: image.bucket,
      image_id: image.image_id,
      asset_id: assetId,
      role: image.role
    },
    requestTimeoutMs,
    fetchImpl
  });
  const verification = response.data?.verification || {};
  if (!response.ok || response.data?.ok !== true || !verification.verification_token) {
    throw new Error(`image verification failed HTTP ${response.http_status}: ${cleanText(response.data?.message).slice(0, 180)}`);
  }
  const verifiedImage = {
    ...image,
    objectPath: verification.object_path,
    object_path: verification.object_path,
    bucket: verification.bucket,
    storageVerified: true,
    storage_verified: true,
    storageVerificationToken: verification.verification_token,
    storage_verification_token: verification.verification_token,
    contentType: verification.content_type,
    content_type: verification.content_type,
    originalType: verification.content_type,
    original_type: verification.content_type,
    size: verification.size,
    originalSize: verification.size,
    original_size: verification.size,
    width: verification.width,
    originalWidth: verification.width,
    original_width: verification.width,
    height: verification.height,
    originalHeight: verification.height,
    original_height: verification.height,
    contentSha256: verification.content_sha256 || "",
    content_sha256: verification.content_sha256 || ""
  };
  verificationCache?.set(cacheKey, verifiedImage);
  return verifiedImage;
}

async function verifiedItemImages({
  item = {},
  index = 0,
  baseUrl,
  cookie,
  requestTimeoutMs,
  verificationCache
}) {
  const assetId = candidateId(item, index);
  const images = itemImages(item);
  const verified = [];
  for (const image of images) {
    verified.push(await verifyExistingImage({
      baseUrl,
      cookie,
      image,
      assetId,
      requestTimeoutMs,
      verificationCache
    }));
  }
  return verified;
}

function payloadForItem(item = {}, index = 0, images = itemImages(item), {
  forceL2Direct = false,
  modelOverride = "",
  enableL1 = false
} = {}) {
  const providerOptions = {
    enable_catalog_assist: true,
    enable_vector_retrieval: true,
    vector_retrieval_mode: "assist",
    vector_query_timeout_ms: 20000,
    enable_v4_progressive_l1: true,
    cloud_eval_blind_to_corrected_title_hint: true,
    corrected_title_as_temporary_gt: false,
    send_corrected_title_hint_to_cloud: false
  };
  if (modelOverride) providerOptions.openai_listing_model_override = modelOverride;
  return {
    asset_id: candidateId(item, index),
    source_feedback_id: item.source_feedback_id || item.source_record_id || null,
    physical_card_id: item.physical_card_id || candidateId(item, index),
    category: item.category || "collectible_card",
    maxTitleLength: 80,
    captureProfileId: "v4_ebay_blind_smoke",
    provider: "openai_legacy",
    provider_id: "openai_legacy",
    vision_provider: "openai_legacy",
    provider_options: providerOptions,
    ...(enableL1 ? { v4_force_fast_scout_l1: true } : {}),
    ...(forceL2Direct
      ? {
        force_l2_only: true,
        v4_worker_synchronous: true,
        v4_force_l2_direct: true,
        disable_fast_scout_l1: true
      }
      : {}),
    images
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function login({ baseUrl, username, password, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`login failed HTTP ${response.status}: ${JSON.stringify(payload || {}).slice(0, 200)}`);
  }
  const cookie = cleanText(response.headers.get("set-cookie")).split(";")[0];
  if (!cookie) throw new Error("login did not return a session cookie");
  return cookie;
}

async function postJson({ baseUrl, path, cookie, payload, requestTimeoutMs, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request_timeout")), requestTimeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await readJsonResponse(response);
    return {
      ok: response.ok,
      http_status: response.status,
      latency_ms: Date.now() - started,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson({ baseUrl, path, cookie, requestTimeoutMs, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request_timeout")), requestTimeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { cookie },
      signal: controller.signal
    });
    const data = await readJsonResponse(response);
    return {
      ok: response.ok,
      http_status: response.status,
      latency_ms: Date.now() - started,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

async function preingestItem({
  baseUrl,
  cookie,
  assetId,
  images,
  requestTimeoutMs,
  fetchImpl = globalThis.fetch
}) {
  const payload = {
    asset_id: assetId,
    assetId,
    images,
    source: "v4_ebay_smoke_preingestion",
    requested_fields: [
      "serial_number",
      "collector_number",
      "checklist_code",
      "grade_label",
      "year_product",
      "subject",
      "surface"
    ],
    enqueue_workers: true,
    enqueue_ocr: true,
    enqueue_embeddings: true,
    enqueue_surface: true,
    enqueue_quality: true,
    verify_signed_read_urls: true
  };
  const response = await postJson({
    baseUrl,
    path: "/api/v4/listing-preingest",
    cookie,
    payload,
    requestTimeoutMs,
    fetchImpl
  });
  const bundleId = response.data?.bundle_id || response.data?.v4_preingestion_bundle_id || null;
  return {
    ok: response.ok && response.data?.ok !== false && Boolean(bundleId),
    http_status: response.http_status,
    latency_ms: response.latency_ms,
    bundle_id: bundleId,
    bundle_status: response.data?.bundle_status || null,
    worker_jobs_enqueued: response.data?.worker_jobs_enqueued ?? null,
    signed_read_url_count: response.data?.signed_read_url_count ?? null,
    signed_read_url_error_count: response.data?.signed_read_url_error_count ?? null,
    preprocessing_summary: response.data?.preprocessing_summary || null,
    error: response.ok && response.data?.ok !== false ? null : response.data
  };
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, Number(ms) || 0)));
}

const openAiRateLimitHeaderNames = Object.freeze([
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens"
]);
const openAiProviderPoolDiagnosticNames = Object.freeze([
  "provider_key_pool_size",
  "provider_key_slot",
  "provider_key_source",
  "provider_key_rotation_attempted",
  "provider_key_rotation_attempts"
]);

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function providerDiagnosticsFromSummary(summary = {}) {
  const source = objectOrNull(summary) || {};
  const request = objectOrNull(source.provider_request_diagnostics)
    || objectOrNull(source.request_diagnostics)
    || {};
  const token = objectOrNull(source.provider_token_diagnostics)
    || objectOrNull(source.token_diagnostics)
    || objectOrNull(source.usage)
    || {};
  const rateLimit = objectOrNull(source.provider_rate_limit_diagnostics)
    || objectOrNull(source.rate_limit_diagnostics)
    || request;
  const output = {
    input_tokens: numberOrNull(token.input_tokens ?? request.input_tokens),
    output_tokens: numberOrNull(token.output_tokens ?? request.output_tokens),
    total_tokens: numberOrNull(token.total_tokens),
    provider_latency_ms: numberOrNull(source.provider_latency_ms ?? request.provider_latency_ms ?? source.usage?.latency_ms),
    response_status: source.provider_finish_reason || token.response_status || request.response_status || null,
    incomplete_reason: token.incomplete_reason || null,
    output_cap: numberOrNull(token.output_cap),
    output_utilization: numberOrNull(token.output_utilization)
  };
  for (const field of openAiProviderPoolDiagnosticNames) {
    output[field] = source[field] ?? request[field] ?? null;
  }
  for (const header of openAiRateLimitHeaderNames) {
    output[header] = rateLimit?.[header] ?? request?.[header] ?? null;
  }
  return output;
}

function providerDiagnosticsFromApiData(data = {}) {
  const providerResult = objectOrNull(data.provider_result) || {};
  return providerDiagnosticsFromSummary({
    provider_latency_ms: data.provider_latency_ms ?? providerResult.provider_latency_ms ?? providerResult.fast_scout?.latency_ms,
    provider_finish_reason: data.provider_finish_reason || providerResult.provider_finish_reason || null,
    provider_token_diagnostics: data.provider_token_diagnostics || providerResult.token_diagnostics || null,
    provider_rate_limit_diagnostics: data.provider_rate_limit_diagnostics || providerResult.rate_limit_diagnostics || null,
    provider_request_diagnostics: data.provider_request_diagnostics || providerResult.request_diagnostics || null,
    usage: data.usage || providerResult.usage || null
  });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function vectorRuntimeFromSummary(...sources) {
  const flattened = Object.assign({}, ...sources.filter((source) => source && typeof source === "object"));
  const vectorContext = sources
    .map((source) => source?.candidate_context?.vector)
    .find((value) => value && typeof value === "object") || {};
  const vectorSignal = vectorContext.signal || {};
  const providerMetadata = vectorContext.provider_metadata || {};
  const unavailableReasons = firstArray(
    flattened.vector_runtime_unavailable_reasons,
    vectorSignal.unavailable_reasons,
    flattened.runtime_unavailable_reasons,
    vectorContext.runtime_unavailable_reasons
  );
  return {
    vector_runtime_status: firstNonEmptyString(flattened.vector_runtime_status, flattened.runtime_status, vectorSignal.status, vectorContext.runtime_status) || null,
    vector_runtime_status_code: firstPresent(flattened.vector_runtime_status_code, flattened.runtime_status_code, vectorSignal.status_code, vectorContext.runtime_status_code),
    vector_runtime_unavailable_reasons: unavailableReasons.length
      ? unavailableReasons.join("; ")
      : firstNonEmptyString(flattened.vector_runtime_unavailable_reasons, flattened.runtime_unavailable_reasons),
    vector_worker_status: firstNonEmptyString(flattened.vector_worker_status, flattened.worker_status, vectorContext.worker_status) || null,
    vector_worker_reason: firstNonEmptyString(flattened.vector_worker_reason, flattened.worker_reason, vectorContext.worker_reason),
    vector_worker_feature_count: firstPresent(flattened.vector_worker_feature_count, flattened.worker_feature_count, vectorContext.worker_feature_count),
    vector_worker_latency_ms: firstPresent(flattened.vector_worker_latency_ms, flattened.worker_latency_ms, vectorContext.worker_latency_ms),
    vector_query_embedding_role: firstNonEmptyString(flattened.vector_query_embedding_role, flattened.query_embedding_role, vectorContext.query_embedding_role, providerMetadata.query_embedding_role),
    vector_role_agnostic_fallback_used: flattened.vector_role_agnostic_fallback_used === true
      || flattened.role_agnostic_fallback_used === true
      || vectorContext.role_agnostic_fallback_used === true
      || providerMetadata.role_agnostic_fallback_used === true,
    vector_role_agnostic_fallback_reason: firstNonEmptyString(
      flattened.vector_role_agnostic_fallback_reason,
      flattened.role_agnostic_fallback_reason,
      vectorContext.role_agnostic_fallback_reason,
      providerMetadata.role_agnostic_fallback_reason
    ),
    vector_returned_row_count: firstPresent(flattened.vector_returned_row_count, flattened.returned_row_count, vectorContext.returned_row_count, providerMetadata.returned_row_count),
    vector_self_excluded_count: firstPresent(flattened.vector_self_excluded_count, flattened.self_excluded_count, vectorContext.self_excluded_count, providerMetadata.self_excluded_count)
  };
}

function sessionL2Summary(statusPayload = {}) {
  const session = statusPayload.session || {};
  const summary = session.provider_result_summary || {};
  const trace = session.candidate_control_plane_trace || {};
  const catalogFunnel = trace.catalog_activation_funnel || {};
  const vectorFunnel = trace.vector_activation_funnel || {};
  const providerDiagnostics = providerDiagnosticsFromSummary(summary);
  const vectorRuntime = vectorRuntimeFromSummary(summary, vectorFunnel);
  return {
    session_status: session.status || null,
    l2_status: session.l2_status || null,
    assisted_draft_status: summary.assisted_draft_status || null,
    title: session.final_title || summary.final_title || null,
    route: session.route || null,
    prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0)
      + Number(vectorFunnel.prompt_candidate_count || 0),
    catalog_raw_candidate_count: Number(catalogFunnel.raw_candidate_count || 0),
    catalog_approved_candidate_count: Number(catalogFunnel.approved_candidate_count || 0),
    catalog_conflict_blocked_count: Number(catalogFunnel.conflict_blocked_count || 0),
    catalog_prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0),
    catalog_evidence_support_field_count: Number(catalogFunnel.evidence_support_field_count || 0),
    catalog_participation_level: catalogFunnel.participation_level || null,
    catalog_pre_observation_query_attempted: catalogFunnel.pre_observation_query_attempted ?? null,
    catalog_post_observation_query_attempted: catalogFunnel.post_observation_query_attempted ?? null,
    vector_raw_candidate_count: Number(vectorFunnel.raw_candidate_count || 0),
    vector_approved_candidate_count: Number(vectorFunnel.approved_candidate_count || 0),
    vector_conflict_blocked_count: Number(vectorFunnel.conflict_blocked_count || 0),
    vector_prompt_candidate_count: Number(vectorFunnel.prompt_candidate_count || 0),
    vector_evidence_support_field_count: Number(vectorFunnel.evidence_support_field_count || 0),
    vector_participation_level: vectorFunnel.participation_level || null,
    vector_pre_observation_query_attempted: vectorFunnel.pre_observation_query_attempted ?? null,
    vector_post_observation_query_attempted: vectorFunnel.post_observation_query_attempted ?? null,
    ...vectorRuntime,
    provider_diagnostics: providerDiagnostics,
    v4_l2_timing: summary.v4_l2_timing || null,
    input_tokens: providerDiagnostics.input_tokens,
    output_tokens: providerDiagnostics.output_tokens,
    total_tokens: providerDiagnostics.total_tokens,
    provider_latency_ms: providerDiagnostics.provider_latency_ms,
    "x-ratelimit-limit-requests": providerDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": providerDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": providerDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": providerDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": providerDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": providerDiagnostics["x-ratelimit-reset-tokens"],
    related_counts: statusPayload.related_counts || {}
  };
}

function jobL2Summary(statusPayload = {}) {
  const job = (statusPayload.jobs || [])[0] || {};
  const session = job.session || {};
  const summary = session.provider_result_summary || {};
  const trace = session.candidate_control_plane_trace || {};
  const catalogFunnel = trace.catalog_activation_funnel || {};
  const vectorFunnel = trace.vector_activation_funnel || {};
  const providerDiagnostics = providerDiagnosticsFromSummary(summary);
  const vectorRuntime = vectorRuntimeFromSummary(summary, vectorFunnel);
  return {
    session_status: session.status || job.internal_status || null,
    l2_status: session.l2_status || job.l2_status || null,
    assisted_draft_status: summary.assisted_draft_status || null,
    title: session.final_title || session.l2_title || job.display_title || job.writer_display_title || null,
    route: session.l2_route || job.l2_route || null,
    job_status: job.status || null,
    job_id: job.job_id || null,
    recognition_session_id: job.recognition_session_id || null,
    worker_queue_wait_ms: job.timing?.worker_queue_wait_ms ?? null,
    worker_processing_ms: job.timing?.worker_processing_ms ?? null,
    time_to_l2_ready_ms: job.timing?.time_to_l2_ready_ms ?? null,
    prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0)
      + Number(vectorFunnel.prompt_candidate_count || 0),
    catalog_raw_candidate_count: Number(catalogFunnel.raw_candidate_count || 0),
    catalog_approved_candidate_count: Number(catalogFunnel.approved_candidate_count || 0),
    catalog_conflict_blocked_count: Number(catalogFunnel.conflict_blocked_count || 0),
    catalog_prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0),
    catalog_evidence_support_field_count: Number(catalogFunnel.evidence_support_field_count || 0),
    catalog_participation_level: catalogFunnel.participation_level || null,
    catalog_pre_observation_query_attempted: catalogFunnel.pre_observation_query_attempted ?? null,
    catalog_post_observation_query_attempted: catalogFunnel.post_observation_query_attempted ?? null,
    vector_raw_candidate_count: Number(vectorFunnel.raw_candidate_count || 0),
    vector_approved_candidate_count: Number(vectorFunnel.approved_candidate_count || 0),
    vector_conflict_blocked_count: Number(vectorFunnel.conflict_blocked_count || 0),
    vector_prompt_candidate_count: Number(vectorFunnel.prompt_candidate_count || 0),
    vector_evidence_support_field_count: Number(vectorFunnel.evidence_support_field_count || 0),
    vector_participation_level: vectorFunnel.participation_level || null,
    vector_pre_observation_query_attempted: vectorFunnel.pre_observation_query_attempted ?? null,
    vector_post_observation_query_attempted: vectorFunnel.post_observation_query_attempted ?? null,
    ...vectorRuntime,
    provider_diagnostics: providerDiagnostics,
    v4_l2_timing: summary.v4_l2_timing || null,
    input_tokens: providerDiagnostics.input_tokens,
    output_tokens: providerDiagnostics.output_tokens,
    total_tokens: providerDiagnostics.total_tokens,
    provider_latency_ms: providerDiagnostics.provider_latency_ms,
    "x-ratelimit-limit-requests": providerDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": providerDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": providerDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": providerDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": providerDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": providerDiagnostics["x-ratelimit-reset-tokens"]
  };
}

function summaryHasVisibleL2Title(summary = {}) {
  return summary.session_status !== "FAILED"
    && summary.l2_status === "READY"
    && cleanText(summary.title);
}

function activeJobStatus(status = "") {
  return ["QUEUED", "RUNNING", "RETRYING"].includes(String(status || "").toUpperCase());
}

function terminalJobStatus(status = "") {
  return ["FAILED", "CANCELLED"].includes(String(status || "").toUpperCase());
}

function compactCandidateTrace(trace = {}) {
  const rows = Array.isArray(trace.candidate_application_trace)
    ? trace.candidate_application_trace
    : [];
  return {
    participation_level: trace.participation_level || null,
    selected_candidate_id: trace.selected_candidate_decision?.selected_candidate_id || trace.selected_candidate_id || "",
    selection_margin: trace.selected_candidate_decision?.selection_margin ?? null,
    selected_reason_codes: trace.selected_candidate_decision?.selected_reason_codes || [],
    rejected_candidate_reasons: trace.selected_candidate_decision?.rejected_candidate_reasons || [],
    catalog_activation_funnel: trace.catalog_activation_funnel || {},
    vector_activation_funnel: trace.vector_activation_funnel || {},
    candidate_application_trace: rows.map((row) => ({
      candidate_id: row.candidate_id || "",
      candidate_identity_id: row.candidate_identity_id || "",
      candidate_lane: row.candidate_lane || "",
      provider_id: row.provider_id || "",
      source_type: row.source_type || "",
      source_trust: row.source_trust || "",
      participation_level: row.participation_level || "",
      match_level: row.match_level || "",
      blocked_fields: row.blocked_fields || [],
      support_only_fields: row.support_only_fields || [],
      can_apply_fields: row.can_apply_fields || [],
      anchor_agreement: row.anchor_agreement || null
    }))
  };
}

async function pollSessionStatus({
  baseUrl,
  cookie,
  sessionId,
  waitMs = 18000,
  intervalMs = 1500,
  requestTimeoutMs = 30000
}) {
  if (!sessionId) return { polls: 0, ready: false, summary: null, last: null };
  const started = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - started <= waitMs) {
    polls += 1;
    last = await getJson({
      baseUrl,
      path: `/api/v4/listing-session-status?recognition_session_id=${encodeURIComponent(sessionId)}`,
      cookie,
      requestTimeoutMs
    });
    const summary = sessionL2Summary(last.data || {});
    const candidateDebug = compactCandidateTrace(last.data?.session?.candidate_control_plane_trace || {});
    if (summaryHasVisibleL2Title(summary)) {
      return { polls, ready: true, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (summary.session_status === "FAILED" || summary.assisted_draft_status === "FAILED" || summary.assisted_draft_status === "TIMEOUT") {
      return { polls, ready: false, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (!summary.assisted_draft_status && summary.session_status === "DRAFT_READY") {
      return { polls, ready: false, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    await delay(intervalMs);
  }
  return {
    polls,
    ready: false,
    summary: sessionL2Summary(last?.data || {}),
    candidateDebug: compactCandidateTrace(last?.data?.session?.candidate_control_plane_trace || {}),
    last,
    elapsed_ms: Date.now() - started
  };
}

async function pollJobStatus({
  baseUrl,
  cookie,
  jobId,
  waitMs = 18000,
  intervalMs = 1500,
  requestTimeoutMs = 30000
}) {
  if (!jobId) return { polls: 0, ready: false, summary: null, last: null };
  const started = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - started <= waitMs) {
    polls += 1;
    last = await getJson({
      baseUrl,
      path: `/api/v4/listing-job-status?job_ids=${encodeURIComponent(jobId)}&limit=1`,
      cookie,
      requestTimeoutMs
    });
    const summary = jobL2Summary(last.data || {});
    const candidateDebug = compactCandidateTrace(last.data?.jobs?.[0]?.session?.candidate_control_plane_trace || {});
    if (summaryHasVisibleL2Title(summary)) {
      return { polls, ready: true, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (terminalJobStatus(summary.job_status)
      || (!activeJobStatus(summary.job_status) && (summary.assisted_draft_status === "FAILED" || summary.assisted_draft_status === "TIMEOUT"))) {
      return { polls, ready: false, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    await delay(intervalMs);
  }
  return {
    polls,
    ready: false,
    summary: jobL2Summary(last?.data || {}),
    candidateDebug: compactCandidateTrace(last?.data?.jobs?.[0]?.session?.candidate_control_plane_trace || {}),
    last,
    elapsed_ms: Date.now() - started
  };
}

function titleTokens(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function rawTokenRecall(referenceTitle = "", predictionTitle = "") {
  const reference = new Set(titleTokens(referenceTitle));
  if (!reference.size) return null;
  const predicted = new Set(titleTokens(predictionTitle));
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function serialMatches(value = "") {
  return [...String(value || "").matchAll(/(?<![\d.])0*(\d+)\s*\/\s*(\d+)\b/g)].map((match) => ({
    exact: `${Number(match[1])}/${Number(match[2])}`,
    denominator: String(Number(match[2]))
  }));
}

function serialTitleAnalysis(referenceTitle = "", predictionTitle = "") {
  const reference = serialMatches(referenceTitle);
  const prediction = serialMatches(predictionTitle);
  const exactSet = new Set(prediction.map((item) => item.exact));
  const denominatorSet = new Set(prediction.map((item) => item.denominator));
  for (const match of String(predictionTitle || "").matchAll(/(?:^|\s)#?\/\s*0*(\d+)\b/g)) {
    denominatorSet.add(String(Number(match[1])));
  }
  const details = reference.map((serial) => {
    const exact = exactSet.has(serial.exact);
    const denominator = denominatorSet.has(serial.denominator);
    return {
      reference_serial: serial.exact,
      numerical_rarity: `/${serial.denominator}`,
      exact_match: exact,
      denominator_match: denominator,
      numerator_omitted: !exact && denominator,
      missing: !exact && !denominator
    };
  });
  return {
    reference_serial_count: reference.length,
    prediction_serial_count: prediction.length,
    exact_match_count: details.filter((item) => item.exact_match).length,
    denominator_match_count: details.filter((item) => item.denominator_match).length,
    numerator_omission_count: details.filter((item) => item.numerator_omitted).length,
    missing_count: details.filter((item) => item.missing).length,
    details
  };
}

function scoreTitles(referenceTitle = "", predictionTitle = "") {
  return {
    raw_token_recall: rawTokenRecall(referenceTitle, predictionTitle),
    fair_token_recall: fairTokenRecall(referenceTitle, predictionTitle),
    policy_fair_token_recall: policyFairTokenRecall(referenceTitle, predictionTitle),
    serial_number_title_analysis: serialTitleAnalysis(referenceTitle, predictionTitle)
  };
}

function quantile(values, q) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * q) - 1));
  return clean[index];
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!clean.length) return null;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(6));
}

function countPass(values, threshold) {
  return values.filter((value) => Number.isFinite(Number(value)) && Number(value) >= threshold).length;
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function resultTitle(response = {}) {
  return cleanText(response.final_title || response.writer_safe_draft || response.title || "");
}

function cacheStatusFromResponse(data = {}) {
  const fastScout = data.provider_result?.fast_scout || null;
  const explicitBlocking = data.fast_scout_blocking_call_used;
  return {
    cache_hit: data.fast_scout_cache_hit === true || fastScout?.cache_hit === true,
    cache_status: data.fast_scout_cache_status || (fastScout?.cache_hit ? "HIT" : null),
    prewarmer_used: data.fast_scout_prewarmer_used === true,
    blocking_call_used: explicitBlocking === true || (explicitBlocking !== false && Boolean(fastScout))
  };
}

async function runOne({
  item,
  index,
  sealedLabels,
  baseUrl,
  cookie,
  prewarm,
  queueMode = false,
  forceL2Direct = false,
  modelOverride = "",
  enableL1 = false,
  usePreingestion = false,
  l2WaitMs,
  requestTimeoutMs
}) {
  const id = candidateId(item, index);
  const verificationCache = runOne.verificationCache || new Map();
  runOne.verificationCache = verificationCache;
  const images = await verifiedItemImages({
    item,
    index,
    baseUrl,
    cookie,
    requestTimeoutMs: Math.min(requestTimeoutMs, 45000),
    verificationCache
  });
  const payload = payloadForItem(item, index, images, { forceL2Direct, modelOverride, enableL1 });
  let preingestionResult = null;
  if (usePreingestion) {
    try {
      preingestionResult = await preingestItem({
        baseUrl,
        cookie,
        assetId: id,
        images,
        requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
      });
      if (preingestionResult.ok && preingestionResult.bundle_id) {
        payload.preingestion_bundle_id = preingestionResult.bundle_id;
        payload.preingestionBundleId = preingestionResult.bundle_id;
        payload.preingestion_bundle_status = preingestionResult.bundle_status;
        payload.preingestion_summary = preingestionResult.preprocessing_summary;
      }
    } catch (error) {
      preingestionResult = {
        ok: false,
        http_status: null,
        latency_ms: null,
        bundle_id: null,
        bundle_status: "preingestion_request_failed",
        worker_jobs_enqueued: null,
        signed_read_url_count: null,
        signed_read_url_error_count: null,
        preprocessing_summary: null,
        error: { message: String(error.message || error).slice(0, 240) }
      };
    }
  }
  const sealedKey = item.sealed_eval_label_ref?.key || "";
  const sealed = sealedLabels.get(id.replace(/^ebay_image_only_/, "")) || sealedLabels.get(item.source_record?.case_id) || null;
  const fallbackSealed = [...sealedLabels.values()].find((row) => row.key === sealedKey) || null;
  const label = sealed || fallbackSealed || {};
  const sellerTitle = cleanText(label.title || item.corrected_title || item.canonical_title || "");
  let prewarmResult = null;
  if (prewarm) {
    prewarmResult = await postJson({
      baseUrl,
      path: "/api/v4/fast-scout-prewarm",
      cookie,
      payload,
      requestTimeoutMs
    });
  }

  if (queueMode) {
    const batchId = `smoke-v4-${Date.now()}-${index}`;
    const queuedPayload = {
      ...payload,
      force_l2_only: true,
      create_l1_job: false,
      create_l2_job: true,
      disable_fast_scout_l1: true,
      v4_force_l2_direct: true
    };
    const enqueue = await postJson({
      baseUrl,
      path: "/api/v4/listing-job-enqueue",
      cookie,
      payload: {
        batch_id: batchId,
        tenant_id: batchId,
        priority: 100,
        jobs: [{
          asset_id: id,
          force_l2_only: true,
          create_l1_job: false,
          create_l2_job: true,
          payload: queuedPayload
        }]
      },
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
    });
    const job = (enqueue.data?.jobs || []).find((entry) => entry?.ok && entry.job_type === "FINAL_ASSISTED_TITLE")
      || (enqueue.data?.jobs || []).find((entry) => entry?.ok)
      || {};
    const l2 = await pollJobStatus({
      baseUrl,
      cookie,
      jobId: job.job_id,
      waitMs: l2WaitMs,
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
    });
    const finalTitle = cleanText(l2.summary?.title || "");
    const finalScore = scoreTitles(sellerTitle, finalTitle);
    const finalProviderDiagnostics = objectOrNull(l2.summary?.provider_diagnostics)
      || providerDiagnosticsFromSummary(l2.summary || {});
    const writerReady = Boolean(l2.ready || finalTitle);
    return compactObject({
      asset_id: id,
      sealed_label_key: sealedKey || label.key || null,
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: Boolean(sellerTitle),
      seller_title: sellerTitle,
      image_count: payload.images.length,
      preingestion_used: usePreingestion,
      preingestion_ok: preingestionResult?.ok ?? null,
      preingestion_http_status: preingestionResult?.http_status ?? null,
      preingestion_latency_ms: preingestionResult?.latency_ms ?? null,
      preingestion_bundle_id: preingestionResult?.bundle_id || null,
      preingestion_bundle_status: preingestionResult?.bundle_status || null,
      preingestion_worker_jobs_enqueued: preingestionResult?.worker_jobs_enqueued ?? null,
      preingestion_signed_read_url_count: preingestionResult?.signed_read_url_count ?? null,
      preingestion_signed_read_url_error_count: preingestionResult?.signed_read_url_error_count ?? null,
      preingestion_error: preingestionResult?.error ? JSON.stringify(preingestionResult.error).slice(0, 500) : null,
      queue_mode: true,
      job_id: job.job_id || null,
      http_status: enqueue.http_status,
      ok: writerReady,
      l1_ok: Boolean(enqueue.ok && enqueue.data?.ok !== false),
      writer_ready: writerReady,
      error: enqueue.ok ? null : enqueue.data,
      l1_wall_latency_ms: enqueue.latency_ms,
      l1_internal_scout_ms: null,
      l1_time_to_safe_draft_ms: null,
      route: l2.summary?.route || null,
      title_stage: "V4_QUEUE_L2",
      recognition_session_id: job.recognition_session_id || l2.summary?.recognition_session_id || null,
      l1_title: "",
      l2_ready: Boolean(l2.ready),
      l2_poll_count: l2.polls,
      l2_poll_elapsed_ms: l2.elapsed_ms ?? null,
      time_to_writer_ready_ms: l2.ready ? enqueue.latency_ms + Number(l2.elapsed_ms || 0) : null,
      worker_queue_wait_ms: l2.summary?.worker_queue_wait_ms ?? null,
      worker_processing_ms: l2.summary?.worker_processing_ms ?? null,
      time_to_l2_ready_ms: l2.summary?.time_to_l2_ready_ms ?? null,
      l2_status: l2.summary,
      l2_candidate_debug: l2.candidateDebug || {},
      final_title: finalTitle,
      fast_scout_cache_hit: null,
      fast_scout_cache_status: null,
      fast_scout_prewarmer_used: prewarmResult?.data?.ok === true,
      fast_scout_blocking_call_used: false,
      prewarm_status: prewarmResult?.data?.prewarm_status || null,
      force_l2_direct: true,
      prewarm_latency_ms: prewarmResult?.latency_ms || null,
      prewarm_cache_hit: prewarmResult?.data?.fast_scout_cache_hit ?? null,
      prewarm_cache_status: prewarmResult?.data?.fast_scout_cache_status || null,
      catalog_prompt_candidate_count: 0,
      vector_prompt_candidate_count: 0,
      provider_prompt_candidate_count: 0,
      l2_catalog_raw_candidate_count: l2.summary?.catalog_raw_candidate_count ?? null,
      l2_catalog_approved_candidate_count: l2.summary?.catalog_approved_candidate_count ?? null,
      l2_catalog_conflict_blocked_count: l2.summary?.catalog_conflict_blocked_count ?? null,
      l2_catalog_prompt_candidate_count: l2.summary?.catalog_prompt_candidate_count ?? null,
      l2_catalog_evidence_support_field_count: l2.summary?.catalog_evidence_support_field_count ?? null,
      l2_catalog_participation_level: l2.summary?.catalog_participation_level ?? null,
      l2_catalog_pre_observation_query_attempted: l2.summary?.catalog_pre_observation_query_attempted ?? null,
      l2_catalog_post_observation_query_attempted: l2.summary?.catalog_post_observation_query_attempted ?? null,
      l2_vector_raw_candidate_count: l2.summary?.vector_raw_candidate_count ?? null,
      l2_vector_approved_candidate_count: l2.summary?.vector_approved_candidate_count ?? null,
      l2_vector_conflict_blocked_count: l2.summary?.vector_conflict_blocked_count ?? null,
      l2_vector_prompt_candidate_count: l2.summary?.vector_prompt_candidate_count ?? null,
      l2_vector_evidence_support_field_count: l2.summary?.vector_evidence_support_field_count ?? null,
      l2_vector_participation_level: l2.summary?.vector_participation_level ?? null,
      l2_vector_pre_observation_query_attempted: l2.summary?.vector_pre_observation_query_attempted ?? null,
      l2_vector_post_observation_query_attempted: l2.summary?.vector_post_observation_query_attempted ?? null,
      vector_runtime_status: l2.summary?.vector_runtime_status ?? null,
      vector_runtime_status_code: l2.summary?.vector_runtime_status_code ?? null,
      vector_runtime_unavailable_reasons: l2.summary?.vector_runtime_unavailable_reasons ?? null,
      vector_worker_status: l2.summary?.vector_worker_status ?? null,
      vector_worker_reason: l2.summary?.vector_worker_reason ?? null,
      vector_worker_feature_count: l2.summary?.vector_worker_feature_count ?? null,
      vector_worker_latency_ms: l2.summary?.vector_worker_latency_ms ?? null,
      vector_query_embedding_role: l2.summary?.vector_query_embedding_role ?? null,
      vector_role_agnostic_fallback_used: l2.summary?.vector_role_agnostic_fallback_used ?? null,
      vector_role_agnostic_fallback_reason: l2.summary?.vector_role_agnostic_fallback_reason ?? null,
      vector_returned_row_count: l2.summary?.vector_returned_row_count ?? null,
      vector_self_excluded_count: l2.summary?.vector_self_excluded_count ?? null,
      provider_diagnostics: finalProviderDiagnostics,
      v4_l2_timing: l2.summary?.v4_l2_timing || null,
      input_tokens: finalProviderDiagnostics.input_tokens,
      output_tokens: finalProviderDiagnostics.output_tokens,
      total_tokens: finalProviderDiagnostics.total_tokens,
      provider_latency_ms: finalProviderDiagnostics.provider_latency_ms,
      provider_key_pool_size: finalProviderDiagnostics.provider_key_pool_size,
      provider_key_slot: finalProviderDiagnostics.provider_key_slot,
      provider_key_source: finalProviderDiagnostics.provider_key_source,
      provider_key_rotation_attempted: finalProviderDiagnostics.provider_key_rotation_attempted,
      provider_key_rotation_attempts: finalProviderDiagnostics.provider_key_rotation_attempts,
      response_status: finalProviderDiagnostics.response_status,
      incomplete_reason: finalProviderDiagnostics.incomplete_reason,
      output_cap: finalProviderDiagnostics.output_cap,
      output_utilization: finalProviderDiagnostics.output_utilization,
      "x-ratelimit-limit-requests": finalProviderDiagnostics["x-ratelimit-limit-requests"],
      "x-ratelimit-remaining-requests": finalProviderDiagnostics["x-ratelimit-remaining-requests"],
      "x-ratelimit-limit-tokens": finalProviderDiagnostics["x-ratelimit-limit-tokens"],
      "x-ratelimit-remaining-tokens": finalProviderDiagnostics["x-ratelimit-remaining-tokens"],
      "x-ratelimit-reset-requests": finalProviderDiagnostics["x-ratelimit-reset-requests"],
      "x-ratelimit-reset-tokens": finalProviderDiagnostics["x-ratelimit-reset-tokens"],
      l1_scoring: scoreTitles(sellerTitle, ""),
      final_scoring: finalScore,
      item_web_url: label.item_web_url || null
    });
  }

  const l1 = await postJson({
    baseUrl,
    path: "/api/v4/listing-copilot-title",
    cookie,
    payload,
    requestTimeoutMs
  });
  const data = l1.data || {};
  const l1ProviderDiagnostics = providerDiagnosticsFromApiData(data);
  const sessionId = data.recognition_session_id || null;
  const l2 = forceL2Direct
    ? {
      polls: 0,
      ready: Boolean(data.ok),
      elapsed_ms: 0,
      summary: {
        assisted_draft_status: data.assisted_draft_status || (data.ok ? "READY" : "FAILED"),
        title: resultTitle(data),
        route: data.route_plan?.route || data.route || null,
        catalog_raw_candidate_count: Number(data.catalog_activation_funnel?.raw_candidate_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.raw_candidate_count || 0),
        catalog_approved_candidate_count: Number(data.catalog_activation_funnel?.approved_candidate_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.approved_candidate_count || 0),
        catalog_conflict_blocked_count: Number(data.catalog_activation_funnel?.conflict_blocked_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.conflict_blocked_count || 0),
        catalog_prompt_candidate_count: Number(data.catalog_activation_funnel?.prompt_candidate_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.prompt_candidate_count || 0),
        catalog_evidence_support_field_count: Number(data.catalog_activation_funnel?.evidence_support_field_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.evidence_support_field_count || 0),
        vector_raw_candidate_count: Number(data.vector_activation_funnel?.raw_candidate_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.raw_candidate_count || 0),
        vector_approved_candidate_count: Number(data.vector_activation_funnel?.approved_candidate_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.approved_candidate_count || 0),
        vector_conflict_blocked_count: Number(data.vector_activation_funnel?.conflict_blocked_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.conflict_blocked_count || 0),
        vector_prompt_candidate_count: Number(data.vector_activation_funnel?.prompt_candidate_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.prompt_candidate_count || 0),
        vector_evidence_support_field_count: Number(data.vector_activation_funnel?.evidence_support_field_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.evidence_support_field_count || 0),
        ...vectorRuntimeFromSummary(
          data.provider_result || {},
          data.provider_result_summary || {},
          data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel || {},
          data.candidate_control_plane_trace?.vector_activation_funnel || {},
          data.vector_activation_funnel || {},
          data
        ),
        provider_diagnostics: l1ProviderDiagnostics,
        input_tokens: l1ProviderDiagnostics.input_tokens,
        output_tokens: l1ProviderDiagnostics.output_tokens,
        total_tokens: l1ProviderDiagnostics.total_tokens,
        provider_latency_ms: l1ProviderDiagnostics.provider_latency_ms,
        "x-ratelimit-limit-requests": l1ProviderDiagnostics["x-ratelimit-limit-requests"],
        "x-ratelimit-remaining-requests": l1ProviderDiagnostics["x-ratelimit-remaining-requests"],
        "x-ratelimit-limit-tokens": l1ProviderDiagnostics["x-ratelimit-limit-tokens"],
        "x-ratelimit-remaining-tokens": l1ProviderDiagnostics["x-ratelimit-remaining-tokens"],
        "x-ratelimit-reset-requests": l1ProviderDiagnostics["x-ratelimit-reset-requests"],
        "x-ratelimit-reset-tokens": l1ProviderDiagnostics["x-ratelimit-reset-tokens"]
      },
      candidateDebug: compactCandidateTrace(data.provider_result?.candidate_control_plane_trace || data.candidate_control_plane_trace || {})
    }
    : await pollSessionStatus({
      baseUrl,
      cookie,
      sessionId,
      waitMs: l2WaitMs,
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
    });
  const l1Title = resultTitle(data);
  const l2Title = cleanText(l2.summary?.title || "");
  const finalTitle = l2Title || l1Title;
  const l1Score = scoreTitles(sellerTitle, l1Title);
  const finalScore = scoreTitles(sellerTitle, finalTitle);
  const fastScout = data.provider_result?.fast_scout || {};
  const l2ProviderDiagnostics = objectOrNull(l2.summary?.provider_diagnostics)
    || providerDiagnosticsFromSummary(l2.summary || {});
  const finalProviderDiagnostics = l2ProviderDiagnostics.input_tokens !== null
    || l2ProviderDiagnostics.output_tokens !== null
    || l2ProviderDiagnostics.provider_latency_ms !== null
    ? l2ProviderDiagnostics
    : l1ProviderDiagnostics;
  const cache = cacheStatusFromResponse(data);
  const l1InternalScoutMs = cache.blocking_call_used || cache.cache_hit
    ? (cache.cache_hit
      ? l1.latency_ms
      : (data.module_speed_metrics?.time_to_l1_internal_scout_ms || data.module_speed_metrics?.time_to_l1_safe_draft_ms || l1.latency_ms))
    : null;
  const l1Ok = Boolean(l1.ok && data.ok);
  const writerReady = Boolean(l2.ready || cleanText(finalTitle));
  return compactObject({
    asset_id: id,
    sealed_label_key: sealedKey || label.key || null,
    seller_title_visible_to_model: false,
    seller_title_used_for_local_eval_only: Boolean(sellerTitle),
    seller_title: sellerTitle,
    image_count: payload.images.length,
    preingestion_used: usePreingestion,
    preingestion_ok: preingestionResult?.ok ?? null,
    preingestion_http_status: preingestionResult?.http_status ?? null,
    preingestion_latency_ms: preingestionResult?.latency_ms ?? null,
    preingestion_bundle_id: preingestionResult?.bundle_id || null,
    preingestion_bundle_status: preingestionResult?.bundle_status || null,
    preingestion_worker_jobs_enqueued: preingestionResult?.worker_jobs_enqueued ?? null,
    preingestion_signed_read_url_count: preingestionResult?.signed_read_url_count ?? null,
    preingestion_signed_read_url_error_count: preingestionResult?.signed_read_url_error_count ?? null,
    preingestion_error: preingestionResult?.error ? JSON.stringify(preingestionResult.error).slice(0, 500) : null,
    http_status: l1.http_status,
    ok: writerReady,
    l1_ok: l1Ok,
    writer_ready: writerReady,
    error: l1.ok ? null : data,
    l1_wall_latency_ms: l1.latency_ms,
    l1_internal_scout_ms: l1InternalScoutMs,
    l1_time_to_safe_draft_ms: cache.blocking_call_used || cache.cache_hit
      ? (cache.cache_hit ? l1.latency_ms : (data.module_speed_metrics?.time_to_l1_safe_draft_ms || null))
      : null,
    cached_fast_scout_source_latency_ms: fastScout.latency_ms ?? data.provider_result?.timing?.fast_scout_latency_ms ?? null,
    route: data.route_plan?.route || null,
    title_stage: data.title_stage || null,
    recognition_session_id: sessionId,
    l1_title: l1Title,
    l2_ready: Boolean(l2.ready),
    l2_poll_count: l2.polls,
    l2_poll_elapsed_ms: l2.elapsed_ms ?? null,
    time_to_writer_ready_ms: forceL2Direct
      ? l1.latency_ms
      : (l2.ready ? l1.latency_ms + Number(l2.elapsed_ms || 0) : null),
    l2_status: l2.summary,
    l2_candidate_debug: l2.candidateDebug || {},
    final_title: finalTitle,
    l1_return_reason: data.l1_return_reason || null,
    l1_return_barrier_version: data.l1_return_barrier_version || null,
    l1_blocking_modules: data.l1_blocking_modules || data.blocking_modules || [],
    l1_deferred_modules: data.l1_deferred_modules || data.background_modules || [],
    deferred_persistence_status: data.deferred_persistence_status || null,
    l2_background_status: data.l2_background_status || null,
    time_after_l1_spent_on_persistence_ms: data.time_after_l1_spent_on_persistence_ms ?? null,
    fast_scout_cache_hit: cache.cache_hit,
    fast_scout_cache_status: cache.cache_status,
    fast_scout_prewarmer_used: cache.prewarmer_used,
    fast_scout_blocking_call_used: cache.blocking_call_used,
    fast_scout_input_image_count: fastScout.input_image_count || null,
    fast_scout_input_roles: (fastScout.input_images || []).map((image) => image.role).filter(Boolean),
    prewarm_status: prewarmResult?.data?.prewarm_status || null,
    force_l2_direct: forceL2Direct,
    prewarm_latency_ms: prewarmResult?.latency_ms || null,
    prewarm_cache_hit: prewarmResult?.data?.fast_scout_cache_hit ?? null,
    prewarm_cache_status: prewarmResult?.data?.fast_scout_cache_status || null,
    catalog_prompt_candidate_count: Number(data.catalog_activation_funnel?.prompt_candidate_count || 0),
    vector_prompt_candidate_count: Number(data.vector_activation_funnel?.prompt_candidate_count || 0),
    provider_prompt_candidate_count: Number(data.provider_result?.prompt_candidate_count || 0),
    l2_catalog_raw_candidate_count: l2.summary?.catalog_raw_candidate_count ?? null,
    l2_catalog_approved_candidate_count: l2.summary?.catalog_approved_candidate_count ?? null,
    l2_catalog_conflict_blocked_count: l2.summary?.catalog_conflict_blocked_count ?? null,
    l2_catalog_prompt_candidate_count: l2.summary?.catalog_prompt_candidate_count ?? null,
    l2_catalog_evidence_support_field_count: l2.summary?.catalog_evidence_support_field_count ?? null,
    l2_catalog_participation_level: l2.summary?.catalog_participation_level ?? null,
    l2_catalog_pre_observation_query_attempted: l2.summary?.catalog_pre_observation_query_attempted ?? null,
    l2_catalog_post_observation_query_attempted: l2.summary?.catalog_post_observation_query_attempted ?? null,
    l2_vector_raw_candidate_count: l2.summary?.vector_raw_candidate_count ?? null,
    l2_vector_approved_candidate_count: l2.summary?.vector_approved_candidate_count ?? null,
    l2_vector_conflict_blocked_count: l2.summary?.vector_conflict_blocked_count ?? null,
    l2_vector_prompt_candidate_count: l2.summary?.vector_prompt_candidate_count ?? null,
    l2_vector_evidence_support_field_count: l2.summary?.vector_evidence_support_field_count ?? null,
    l2_vector_participation_level: l2.summary?.vector_participation_level ?? null,
    l2_vector_pre_observation_query_attempted: l2.summary?.vector_pre_observation_query_attempted ?? null,
    l2_vector_post_observation_query_attempted: l2.summary?.vector_post_observation_query_attempted ?? null,
    vector_runtime_status: l2.summary?.vector_runtime_status ?? null,
    vector_runtime_status_code: l2.summary?.vector_runtime_status_code ?? null,
    vector_runtime_unavailable_reasons: l2.summary?.vector_runtime_unavailable_reasons ?? null,
    vector_worker_status: l2.summary?.vector_worker_status ?? null,
    vector_worker_reason: l2.summary?.vector_worker_reason ?? null,
    vector_worker_feature_count: l2.summary?.vector_worker_feature_count ?? null,
    vector_worker_latency_ms: l2.summary?.vector_worker_latency_ms ?? null,
    vector_query_embedding_role: l2.summary?.vector_query_embedding_role ?? null,
    vector_role_agnostic_fallback_used: l2.summary?.vector_role_agnostic_fallback_used ?? null,
    vector_role_agnostic_fallback_reason: l2.summary?.vector_role_agnostic_fallback_reason ?? null,
    vector_returned_row_count: l2.summary?.vector_returned_row_count ?? null,
    vector_self_excluded_count: l2.summary?.vector_self_excluded_count ?? null,
    provider_diagnostics: finalProviderDiagnostics,
    l1_provider_diagnostics: l1ProviderDiagnostics,
    l2_provider_diagnostics: l2ProviderDiagnostics,
    v4_l2_timing: l2.summary?.v4_l2_timing || null,
    input_tokens: finalProviderDiagnostics.input_tokens,
    output_tokens: finalProviderDiagnostics.output_tokens,
    total_tokens: finalProviderDiagnostics.total_tokens,
    provider_latency_ms: finalProviderDiagnostics.provider_latency_ms,
    response_status: finalProviderDiagnostics.response_status,
    incomplete_reason: finalProviderDiagnostics.incomplete_reason,
    output_cap: finalProviderDiagnostics.output_cap,
    output_utilization: finalProviderDiagnostics.output_utilization,
    "x-ratelimit-limit-requests": finalProviderDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": finalProviderDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": finalProviderDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": finalProviderDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": finalProviderDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": finalProviderDiagnostics["x-ratelimit-reset-tokens"],
    l1_scoring: l1Score,
    final_scoring: finalScore,
    item_web_url: label.item_web_url || null
  });
}

function summarize(results = []) {
  const l1Raw = results.map((item) => item.l1_scoring?.raw_token_recall);
  const l1Fair = results.map((item) => item.l1_scoring?.fair_token_recall);
  const l1Policy = results.map((item) => item.l1_scoring?.policy_fair_token_recall);
  const finalRaw = results.map((item) => item.final_scoring?.raw_token_recall);
  const finalFair = results.map((item) => item.final_scoring?.fair_token_recall);
  const finalPolicy = results.map((item) => item.final_scoring?.policy_fair_token_recall);
  const countBy = (field) => results.reduce((acc, item) => {
    const key = cleanText(item[field] ?? "missing") || "missing";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    attempted_count: results.length,
    ok_count: results.filter((item) => item.ok).length,
    l2_ready_count: results.filter((item) => item.l2_ready).length,
    fast_scout_cache_hit_count: results.filter((item) => item.fast_scout_cache_hit).length,
    fast_scout_blocking_call_count: results.filter((item) => item.fast_scout_blocking_call_used).length,
    prewarm_cache_hit_count: results.filter((item) => item.prewarm_cache_hit === true).length,
    preingestion_used_count: results.filter((item) => item.preingestion_used === true).length,
    preingestion_ok_count: results.filter((item) => item.preingestion_ok === true).length,
    preingestion_p50_ms: quantile(results.map((item) => item.preingestion_latency_ms), 0.5),
    preingestion_p95_ms: quantile(results.map((item) => item.preingestion_latency_ms), 0.95),
    preingestion_worker_jobs_enqueued_count: results.reduce((sum, item) => sum + Number(item.preingestion_worker_jobs_enqueued || 0), 0),
    l1_p50_ms: quantile(results.map((item) => item.l1_wall_latency_ms), 0.5),
    l1_p95_ms: quantile(results.map((item) => item.l1_wall_latency_ms), 0.95),
    l1_internal_scout_p50_ms: quantile(results.map((item) => item.l1_internal_scout_ms), 0.5),
    l1_internal_scout_p95_ms: quantile(results.map((item) => item.l1_internal_scout_ms), 0.95),
    l1_safe_draft_p50_ms: quantile(results.map((item) => item.l1_time_to_safe_draft_ms), 0.5),
    l1_safe_draft_p95_ms: quantile(results.map((item) => item.l1_time_to_safe_draft_ms), 0.95),
    writer_ready_p50_ms: quantile(results.map((item) => item.time_to_writer_ready_ms), 0.5),
    writer_ready_p95_ms: quantile(results.map((item) => item.time_to_writer_ready_ms), 0.95),
    prewarm_p50_ms: quantile(results.map((item) => item.prewarm_latency_ms), 0.5),
    prewarm_p95_ms: quantile(results.map((item) => item.prewarm_latency_ms), 0.95),
    queue_mode_count: results.filter((item) => item.queue_mode === true).length,
    worker_queue_wait_p50_ms: quantile(results.map((item) => item.worker_queue_wait_ms), 0.5),
    worker_queue_wait_p95_ms: quantile(results.map((item) => item.worker_queue_wait_ms), 0.95),
    worker_processing_p50_ms: quantile(results.map((item) => item.worker_processing_ms), 0.5),
    worker_processing_p95_ms: quantile(results.map((item) => item.worker_processing_ms), 0.95),
    catalog_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.catalog_prompt_candidate_count || 0), 0),
    vector_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.vector_prompt_candidate_count || 0), 0),
    l2_catalog_raw_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_raw_candidate_count || 0), 0),
    l2_catalog_approved_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_approved_candidate_count || 0), 0),
    l2_catalog_conflict_blocked_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_conflict_blocked_count || 0), 0),
    l2_catalog_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_prompt_candidate_count || 0), 0),
    l2_catalog_evidence_support_field_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_evidence_support_field_count || 0), 0),
    l2_vector_raw_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_raw_candidate_count || 0), 0),
    l2_vector_approved_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_approved_candidate_count || 0), 0),
    l2_vector_conflict_blocked_count: results.reduce((sum, item) => sum + Number(item.l2_vector_conflict_blocked_count || 0), 0),
    l2_vector_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_prompt_candidate_count || 0), 0),
    l2_vector_evidence_support_field_count: results.reduce((sum, item) => sum + Number(item.l2_vector_evidence_support_field_count || 0), 0),
    vector_runtime_status_breakdown: countBy("vector_runtime_status"),
    vector_runtime_status_code_breakdown: countBy("vector_runtime_status_code"),
    vector_worker_status_breakdown: countBy("vector_worker_status"),
    vector_role_agnostic_fallback_count: results.filter((item) => item.vector_role_agnostic_fallback_used === true).length,
    provider_diagnostics: {
      input_tokens_total: results.reduce((sum, item) => sum + Number(item.input_tokens || 0), 0),
      output_tokens_total: results.reduce((sum, item) => sum + Number(item.output_tokens || 0), 0),
      total_tokens_total: results.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0),
      provider_latency_p50_ms: quantile(results.map((item) => item.provider_latency_ms), 0.5),
      provider_latency_p95_ms: quantile(results.map((item) => item.provider_latency_ms), 0.95),
      key_pool_size_latest: [...results].reverse().find((item) => item.provider_key_pool_size)?.provider_key_pool_size || null,
      key_slots_used: [...new Set(results.map((item) => item.provider_key_slot).filter((value) => value !== null && value !== undefined && value !== ""))],
      key_rotation_attempt_count: results.reduce((sum, item) => sum + Number(item.provider_key_rotation_attempts || 0), 0),
      key_rotation_card_count: results.filter((item) => item.provider_key_rotation_attempted === true).length,
      diagnostics_missing_count: results.filter((item) => item.input_tokens === null && item.output_tokens === null && item.provider_latency_ms === null).length,
      latest_remaining_requests: [...results].reverse().find((item) => item["x-ratelimit-remaining-requests"])?.["x-ratelimit-remaining-requests"] || null,
      latest_remaining_tokens: [...results].reverse().find((item) => item["x-ratelimit-remaining-tokens"])?.["x-ratelimit-remaining-tokens"] || null
    },
    l1_accuracy_proxy: {
      note: "L1 is internal scout only; use final_accuracy_proxy for writer-visible title quality.",
      writer_visible_title_count: results.filter((item) => cleanText(item.l1_title)).length,
      raw_token_recall_avg: average(l1Raw),
      fair_token_recall_avg: average(l1Fair),
      policy_fair_token_recall_avg: average(l1Policy),
      raw_pass_at_0_72: countPass(l1Raw, 0.72),
      fair_pass_at_0_72: countPass(l1Fair, 0.72),
      policy_fair_pass_at_0_72: countPass(l1Policy, 0.72),
      policy_fair_pass_at_0_80: countPass(l1Policy, 0.8)
    },
    final_accuracy_proxy: {
      raw_token_recall_avg: average(finalRaw),
      fair_token_recall_avg: average(finalFair),
      policy_fair_token_recall_avg: average(finalPolicy),
      raw_pass_at_0_72: countPass(finalRaw, 0.72),
      fair_pass_at_0_72: countPass(finalFair, 0.72),
      policy_fair_pass_at_0_72: countPass(finalPolicy, 0.72),
      policy_fair_pass_at_0_80: countPass(finalPolicy, 0.8)
    },
    serial_title_analysis: {
      reference_serial_cards: results.filter((item) => item.final_scoring?.serial_number_title_analysis?.reference_serial_count > 0).length,
      exact_match_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.exact_match_count || 0), 0),
      denominator_match_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.denominator_match_count || 0), 0),
      numerator_omission_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.numerator_omission_count || 0), 0),
      missing_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.missing_count || 0), 0)
    }
  };
}

function tsvEscape(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function perCardTsv(results = []) {
  const columns = [
    "asset_id",
    "ok",
    "l1_ok",
    "writer_ready",
    "preingestion_used",
    "preingestion_ok",
    "preingestion_http_status",
    "preingestion_ms",
    "preingestion_bundle_id",
    "preingestion_bundle_status",
    "preingestion_worker_jobs",
    "preingestion_signed_urls",
    "preingestion_signed_url_errors",
    "preingestion_error",
    "l1_ms",
    "l1_internal_scout_ms",
    "l1_safe_ms",
    "cache",
    "l2_ready",
    "writer_ready_ms",
    "queue_mode",
    "worker_queue_wait_ms",
    "worker_processing_ms",
    "l1_policy_fair",
    "final_policy_fair",
    "catalog_prompt",
    "vector_prompt",
    "l2_catalog_raw",
    "l2_catalog_approved",
    "l2_catalog_blocked",
    "l2_catalog_prompt",
    "l2_vector_raw",
    "l2_vector_approved",
    "l2_vector_blocked",
    "l2_vector_prompt",
    "vector_status",
    "vector_status_code",
    "vector_unavailable_reasons",
    "vector_worker_status",
    "vector_worker_reason",
    "vector_worker_feature_count",
    "vector_worker_latency_ms",
    "vector_query_embedding_role",
    "vector_role_fallback",
    "vector_role_fallback_reason",
    "vector_returned_rows",
    "vector_self_excluded",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "provider_latency_ms",
    "provider_key_pool_size",
    "provider_key_slot",
    "provider_key_source",
    "provider_key_rotation_attempted",
    "provider_key_rotation_attempts",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "l1_title",
    "final_title",
    "seller_title"
  ];
  const rows = results.map((item) => [
    item.asset_id,
    item.ok,
    item.l1_ok,
    item.writer_ready,
    item.preingestion_used,
    item.preingestion_ok,
    item.preingestion_http_status,
    item.preingestion_latency_ms,
    item.preingestion_bundle_id,
    item.preingestion_bundle_status,
    item.preingestion_worker_jobs_enqueued,
    item.preingestion_signed_read_url_count,
    item.preingestion_signed_read_url_error_count,
    item.preingestion_error,
    item.l1_wall_latency_ms,
    item.l1_internal_scout_ms,
    item.l1_time_to_safe_draft_ms,
    item.fast_scout_cache_status,
    item.l2_ready,
    item.time_to_writer_ready_ms,
    item.queue_mode,
    item.worker_queue_wait_ms,
    item.worker_processing_ms,
    item.l1_scoring?.policy_fair_token_recall,
    item.final_scoring?.policy_fair_token_recall,
    item.catalog_prompt_candidate_count,
    item.vector_prompt_candidate_count,
    item.l2_catalog_raw_candidate_count,
    item.l2_catalog_approved_candidate_count,
    item.l2_catalog_conflict_blocked_count,
    item.l2_catalog_prompt_candidate_count,
    item.l2_vector_raw_candidate_count,
    item.l2_vector_approved_candidate_count,
    item.l2_vector_conflict_blocked_count,
    item.l2_vector_prompt_candidate_count,
    item.vector_runtime_status,
    item.vector_runtime_status_code,
    item.vector_runtime_unavailable_reasons,
    item.vector_worker_status,
    item.vector_worker_reason,
    item.vector_worker_feature_count,
    item.vector_worker_latency_ms,
    item.vector_query_embedding_role,
    item.vector_role_agnostic_fallback_used,
    item.vector_role_agnostic_fallback_reason,
    item.vector_returned_row_count,
    item.vector_self_excluded_count,
    item.input_tokens,
    item.output_tokens,
    item.total_tokens,
    item.provider_latency_ms,
    item.provider_key_pool_size,
    item.provider_key_slot,
    item.provider_key_source,
    item.provider_key_rotation_attempted,
    item.provider_key_rotation_attempts,
    item["x-ratelimit-limit-requests"],
    item["x-ratelimit-remaining-requests"],
    item["x-ratelimit-limit-tokens"],
    item["x-ratelimit-remaining-tokens"],
    item["x-ratelimit-reset-requests"],
    item["x-ratelimit-reset-tokens"],
    item.l1_title,
    item.final_title,
    item.seller_title
  ].map(tsvEscape).join("\t"));
  return `${columns.join("\t")}\n${rows.join("\n")}\n`;
}

export async function runV4EbaySmoke({
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  limit = 10,
  offset = 0,
  prewarm = false,
  queueMode = false,
  forceL2Direct = false,
  modelOverride = "",
  enableL1 = false,
  usePreingestion = false,
  l2WaitMs = 18000,
  requestTimeoutMs = 90000,
  outPath = "",
  progress = true
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  if (!baseUrl) throw new Error("--base-url is required");
  if (!username || !password) throw new Error("--username and --password are required");
  const items = (await readDataset(datasetPath)).slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
  if (!items.length) throw new Error("dataset slice has no items");
  const sealedLabels = await readSealedLabels(sealedLabelsPath);
  const cookie = await login({ baseUrl, username, password });
  const results = [];
  for (const [localIndex, item] of items.entries()) {
    const index = offset + localIndex;
    if (progress) process.stderr.write(`v4 ebay smoke ${localIndex + 1}/${items.length} asset=${candidateId(item, index)} prewarm=${prewarm} preingestion=${usePreingestion} queue=${queueMode} force_l2_direct=${forceL2Direct}\n`);
    const row = await runOne({
      item,
      index,
      sealedLabels,
      baseUrl,
      cookie,
      prewarm,
      queueMode,
      forceL2Direct,
      modelOverride,
      enableL1,
      usePreingestion,
      l2WaitMs,
      requestTimeoutMs
    });
    results.push(row);
    if (progress) {
      process.stderr.write(`  ok=${row.ok} l1=${row.l1_wall_latency_ms}ms cache=${row.fast_scout_cache_status || "n/a"} final_policy=${row.final_scoring?.policy_fair_token_recall ?? "n/a"} title=${row.final_title}\n`);
    }
  }
  const report = {
    schema_version: "v4-ebay-smoke-v1",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    dataset_path: datasetPath,
    sealed_labels_path: sealedLabelsPath || null,
    limit,
    offset,
    prewarm_enabled: prewarm,
    queue_mode: queueMode,
    force_l2_direct: forceL2Direct,
    l1_explicitly_enabled: enableL1,
    preingestion_enabled: usePreingestion,
    model_override: modelOverride || null,
    blind_policy: {
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: true,
      seller_title_is_ground_truth: false
    },
    summary: summarize(results),
    results
  };
  if (outPath) {
    await writeJson(outPath, report);
    await writeText(outPath.replace(/\.json$/i, ".tsv"), perCardTsv(results));
  }
  return report;
}

export async function main(argv = process.argv, env = process.env) {
  const stamp = nowStamp();
  const outPath = argValue(argv, "--out", `data/eval/workflow-sidecar-smoke/v4-ebay-smoke-${stamp}.json`);
  const report = await runV4EbaySmoke({
    datasetPath: argValue(argv, "--dataset", env.V4_EBAY_SMOKE_DATASET || "data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json"),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.V4_EBAY_SMOKE_SEALED_LABELS || "data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl"),
    baseUrl: cleanText(argValue(argv, "--base-url", env.V4_EBAY_SMOKE_BASE_URL || env.API_BASE_URL || "https://listing.lyncafei.team")).replace(/\/+$/, ""),
    username: cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME || "metaverse")),
    password: cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD || "mtv")),
    limit: Math.max(1, Math.trunc(numberArg(argv, "--limit", 10))),
    offset: Math.max(0, Math.trunc(numberArg(argv, "--offset", 0))),
    prewarm: hasFlag(argv, "--prewarm"),
    queueMode: hasFlag(argv, "--queue"),
    forceL2Direct: hasFlag(argv, "--force-l2-direct"),
    enableL1: hasFlag(argv, "--enable-l1"),
    usePreingestion: hasFlag(argv, "--use-preingestion"),
    modelOverride: cleanText(argValue(argv, "--model", env.V4_EBAY_SMOKE_MODEL_OVERRIDE || "")),
    l2WaitMs: Math.max(0, Math.trunc(numberArg(argv, "--l2-wait-ms", 18000))),
    requestTimeoutMs: Math.max(10000, Math.trunc(numberArg(argv, "--request-timeout-ms", 90000))),
    outPath,
    progress: !hasFlag(argv, "--quiet")
  });
  process.stdout.write([
    `v4 ebay smoke completed`,
    `report_json: ${resolve(outPath)}`,
    `report_tsv: ${resolve(outPath.replace(/\.json$/i, ".tsv"))}`,
    `attempted: ${report.summary.attempted_count}`,
    `ok: ${report.summary.ok_count}`,
    `l2_ready: ${report.summary.l2_ready_count}`,
    `l1_p50_ms: ${report.summary.l1_p50_ms}`,
    `l1_p95_ms: ${report.summary.l1_p95_ms}`,
    `preingestion_enabled: ${report.preingestion_enabled}`,
    `preingestion_ok: ${report.summary.preingestion_ok_count}/${report.summary.preingestion_used_count}`,
    `preingestion_p50_ms: ${report.summary.preingestion_p50_ms}`,
    `preingestion_p95_ms: ${report.summary.preingestion_p95_ms}`,
    `preingestion_worker_jobs_enqueued: ${report.summary.preingestion_worker_jobs_enqueued_count}`,
    `writer_ready_p50_ms: ${report.summary.writer_ready_p50_ms}`,
    `writer_ready_p95_ms: ${report.summary.writer_ready_p95_ms}`,
    `fast_scout_cache_hit_count: ${report.summary.fast_scout_cache_hit_count}`,
    `provider_input_tokens_total: ${report.summary.provider_diagnostics.input_tokens_total}`,
    `provider_output_tokens_total: ${report.summary.provider_diagnostics.output_tokens_total}`,
    `provider_latency_p50_ms: ${report.summary.provider_diagnostics.provider_latency_p50_ms}`,
    `provider_latency_p95_ms: ${report.summary.provider_diagnostics.provider_latency_p95_ms}`,
    `final_policy_fair_avg: ${report.summary.final_accuracy_proxy.policy_fair_token_recall_avg}`,
    `final_policy_fair_pass@0.72: ${report.summary.final_accuracy_proxy.policy_fair_pass_at_0_72}/${report.summary.attempted_count}`,
    `final_policy_fair_pass@0.80: ${report.summary.final_accuracy_proxy.policy_fair_pass_at_0_80}/${report.summary.attempted_count}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`v4 ebay smoke failed: ${error.message}`);
    process.exit(1);
  });
}
