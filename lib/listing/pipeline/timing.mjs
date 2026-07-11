// Pipeline timing utilities — first extraction of the v2 monolith retirement
// (docs/REFORM_PLAN.md R1). Copied verbatim from api/listing-copilot-title.js
// and delegated; behavior must stay bit-identical.

export function nowMs() {
  return Date.now();
}

export function emptyTiming() {
  return {
    client_image_prepare_ms: null,
    client_upload_ms: null,
    client_request_prepare_ms: null,
    client_api_roundtrip_ms: null,
    client_background_prepare_ms: null,
    client_background_prepare_wait_ms: null,
    client_fast_scout_prewarm_wait_ms: null,
    client_speculative_ms: null,
    client_speculative_wait_ms: null,
    server_queue_ms: 0,
    provider_connect_ms: null,
    provider_first_token_ms: null,
    provider_total_ms: 0,
    approved_memory_lookup_ms: 0,
    identity_cache_lookup_ms: 0,
    memory_lookup_ms: 0,
    preingestion_bundle_load_ms: 0,
    preingestion_retrieval_anchor_refresh_ms: 0,
    post_observation_catalog_vector_hedge_wait_ms: 0,
    post_observation_catalog_vector_overlap_ms: 0,
    signed_url_ms: 0,
    image_quality_check_ms: 0,
    recognition_preflight_ms: 0,
    stored_visual_feature_lookup_ms: 0,
    catalog_retrieval_ms: 0,
    catalog_cache_ms: 0,
    vector_embedding_ms: 0,
    vector_retrieval_ms: 0,
    evidence_completion_ms: 0,
    retrieval_ms: 0,
    focused_reread_ms: 0,
    resolver_ms: 0,
    renderer_ms: 0,
    identity_cache_write_ms: 0,
    total_ms: 0
  };
}

export function createTimingContext(payload = {}) {
  const timing = emptyTiming();
  const clientTiming = payload.clientTiming || payload.client_timing || {};
  [
    "client_image_prepare_ms",
    "client_upload_ms",
    "client_request_prepare_ms",
    "client_api_roundtrip_ms",
    "client_background_prepare_ms",
    "client_background_prepare_wait_ms",
    "client_fast_scout_prewarm_wait_ms",
    "client_speculative_ms",
    "client_speculative_wait_ms"
  ].forEach((key) => {
    const value = Number(clientTiming[key]);
    timing[key] = Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  });
  return {
    started_at_ms: nowMs(),
    timing,
    node_observability: {
      schema_version: "pipeline-node-span-v1",
      sequence: 0,
      spans: [],
      request_context: {
        asset_id: String(payload.asset_id || payload.assetId || "").trim() || null,
        recognition_session_id: String(payload.recognition_session_id || "").trim() || null,
        image_count: Array.isArray(payload.images) ? payload.images.length : 0
      }
    }
  };
}

function nodeIdFromTimingKey(key = "") {
  return String(key || "").trim().replace(/_ms$/, "") || "unknown";
}

function safeErrorCode(error = null) {
  if (!error) return null;
  const explicit = String(error.code || error.error_code || "").trim();
  if (explicit) return explicit.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 100);
  const status = Number(error.status || error.statusCode || error.http_status);
  if (Number.isFinite(status) && status > 0) return `HTTP_${status}`;
  const name = String(error.name || "Error").trim();
  return name.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 100) || "Error";
}

function outputCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return null;
  for (const key of ["rows", "items", "candidates", "patches", "features", "results", "sources"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return null;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function recordNodeSpan(timingContext, {
  key = "",
  startedAtMs = null,
  durationMs = null,
  status = "COMPLETED",
  result = null,
  error = null,
  inputCount = null,
  outputCount: explicitOutputCount = null,
  metrics = null
} = {}) {
  const observability = timingContext?.node_observability;
  if (!observability || !Array.isArray(observability.spans)) return null;
  const safeDuration = Number.isFinite(Number(durationMs))
    ? Math.max(0, Math.round(Number(durationMs)))
    : Math.max(0, Math.round(nowMs() - Number(startedAtMs || nowMs())));
  observability.sequence = Number(observability.sequence || 0) + 1;
  const span = {
    span_id: `span_${observability.sequence}`,
    sequence: observability.sequence,
    node_id: nodeIdFromTimingKey(key),
    timing_key: String(key || "").trim() || null,
    started_offset_ms: Number.isFinite(Number(startedAtMs))
      ? Math.max(0, Math.round(Number(startedAtMs) - Number(timingContext.started_at_ms || startedAtMs)))
      : null,
    duration_ms: safeDuration,
    status: String(status || "COMPLETED").toUpperCase(),
    input_count: optionalFiniteNumber(inputCount),
    output_count: optionalFiniteNumber(explicitOutputCount) ?? outputCount(result),
    error_code: safeErrorCode(error),
    ...(metrics && typeof metrics === "object" ? { metrics } : {})
  };
  observability.spans.push(span);
  return span;
}

export function snapshotNodeSpans(timingContext) {
  const observability = timingContext?.node_observability || {};
  return {
    schema_version: observability.schema_version || "pipeline-node-span-v1",
    request_context: { ...(observability.request_context || {}) },
    spans: Array.isArray(observability.spans)
      ? observability.spans.map((span) => ({ ...span }))
      : []
  };
}

export function addTiming(timingContext, key, elapsedMs) {
  if (!timingContext?.timing || !key) return;
  const value = Number(elapsedMs);
  if (!Number.isFinite(value) || value < 0) return;
  timingContext.timing[key] = Math.round(Number(timingContext.timing[key] || 0) + value);
  if (key === "approved_memory_lookup_ms" || key === "identity_cache_lookup_ms") {
    timingContext.timing.memory_lookup_ms = Math.round(
      Number(timingContext.timing.approved_memory_lookup_ms || 0)
      + Number(timingContext.timing.identity_cache_lookup_ms || 0)
    );
  }
}

export async function timeAsync(timingContext, key, work) {
  const startedAt = nowMs();
  let result;
  let caughtError = null;
  try {
    result = await work();
    return result;
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    const durationMs = nowMs() - startedAt;
    addTiming(timingContext, key, durationMs);
    recordNodeSpan(timingContext, {
      key,
      startedAtMs: startedAt,
      durationMs,
      status: caughtError ? "FAILED" : "COMPLETED",
      result,
      error: caughtError
    });
  }
}

export function timeSync(timingContext, key, work) {
  const startedAt = nowMs();
  let result;
  let caughtError = null;
  try {
    result = work();
    return result;
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    const durationMs = nowMs() - startedAt;
    addTiming(timingContext, key, durationMs);
    recordNodeSpan(timingContext, {
      key,
      startedAtMs: startedAt,
      durationMs,
      status: caughtError ? "FAILED" : "COMPLETED",
      result,
      error: caughtError
    });
  }
}
