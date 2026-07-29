// Pipeline timing utilities — first extraction of the v2 monolith retirement
// (docs/REFORM_PLAN.md R1). Copied verbatim from api/listing-copilot-title.js
// and delegated; behavior must stay bit-identical.

export function nowMs() {
  return Date.now();
}

export const recognitionCriticalPathSchemaVersion = "recognition-critical-path-v1";

export const recognitionCriticalPathScope = "NATIVE_RECOGNITION_CORE";

export const recognitionCriticalPathExclusions = Object.freeze([
  "V4_ADAPTER",
  "SESSION_PERSISTENCE",
  "QUEUE_COMPLETION",
  "HTTP_SERIALIZATION"
]);

const recognitionPathKinds = new Set([
  "UNKNOWN",
  "EXACT_REPLAY",
  "PRE_PROVIDER_FAST_FINAL",
  "FULL_PROVIDER",
  "DETERMINISTIC_FAST_FINAL",
  "INFLIGHT_REPLAY"
]);

export const recognitionBoundaryIds = Object.freeze([
  "core_started",
  "full_path_started",
  "provider_waiting",
  "provider_started",
  "provider_completed",
  "decision_ready",
  "identity_cache_stage_completed",
  "core_terminal_ready",
  "response_built"
]);

const recognitionBoundaryIdSet = new Set(recognitionBoundaryIds);
function recognitionSegmentDefinitions({ pathKind, providerExpected, identityCacheStageExpected }) {
  const segments = [];
  if (["EXACT_REPLAY", "PRE_PROVIDER_FAST_FINAL"].includes(pathKind)) {
    segments.push(["core_to_decision", "core_started", "decision_ready"]);
  } else {
    segments.push(["core_to_full_path", "core_started", "full_path_started"]);
    if (providerExpected) {
      segments.push(
        ["full_path_to_provider_waiting", "full_path_started", "provider_waiting"],
        ["provider_wait", "provider_waiting", "provider_started"],
        ["provider_window", "provider_started", "provider_completed"],
        ["provider_to_decision", "provider_completed", "decision_ready"]
      );
    } else {
      segments.push(["full_path_to_decision", "full_path_started", "decision_ready"]);
    }
  }
  if (identityCacheStageExpected) {
    segments.push(
      ["decision_to_identity_cache_stage", "decision_ready", "identity_cache_stage_completed"],
      ["identity_cache_stage_to_core_terminal", "identity_cache_stage_completed", "core_terminal_ready"]
    );
  } else {
    segments.push(["decision_to_core_terminal", "decision_ready", "core_terminal_ready"]);
  }
  segments.push(["core_terminal_to_response", "core_terminal_ready", "response_built"]);
  return segments;
}

function isoTimestamp(value) {
  const number = optionalTimestampMs(value);
  return Number.isFinite(number) ? new Date(number).toISOString() : null;
}

function optionalTimestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeBoundaryMetadata(metadata = null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const allowed = [
    "status",
    "reason",
    "route",
    "write_attempted",
    "write_saved",
    "write_reason",
    "coalesced"
  ];
  const result = Object.fromEntries(allowed.flatMap((key) => {
    const value = metadata[key];
    if (!["string", "number", "boolean"].includes(typeof value)) return [];
    return [[key, typeof value === "string" ? value.slice(0, 160) : value]];
  }));
  return Object.keys(result).length ? result : null;
}

function boundaryRecord(timingContext, atMs, metadata = null) {
  const timestampMs = Number(atMs);
  return {
    at: isoTimestamp(timestampMs),
    at_ms: timestampMs,
    offset_ms: Math.round(timestampMs - Number(timingContext.started_at_ms)),
    ...(safeBoundaryMetadata(metadata) ? { metadata: safeBoundaryMetadata(metadata) } : {})
  };
}

function addCriticalPathAnomaly(timingContext, anomaly = {}) {
  const criticalPath = timingContext?.recognition_critical_path;
  if (!criticalPath || !Array.isArray(criticalPath.anomalies)) return;
  const attempt = optionalFiniteNumber(anomaly.attempt);
  criticalPath.anomalies.push({
    code: String(anomaly.code || "UNKNOWN_CRITICAL_PATH_ANOMALY"),
    boundary_id: anomaly.boundary_id || null,
    attempt
  });
}

export function recognitionBoundaryRecorded(timingContext, boundaryId) {
  return Boolean(timingContext?.recognition_critical_path?.boundaries?.[boundaryId]);
}

export function setRecognitionPathIntent(timingContext, {
  pathKind,
  providerExpected,
  identityCacheStageExpected
} = {}) {
  const criticalPath = timingContext?.recognition_critical_path;
  if (!criticalPath) return null;
  const normalizedPathKind = String(pathKind || "UNKNOWN").trim().toUpperCase();
  if (!recognitionPathKinds.has(normalizedPathKind)
    || typeof providerExpected !== "boolean"
    || typeof identityCacheStageExpected !== "boolean") {
    addCriticalPathAnomaly(timingContext, { code: "INVALID_PATH_INTENT" });
    return null;
  }
  criticalPath.intent = {
    path_kind: normalizedPathKind,
    provider_expected: providerExpected,
    identity_cache_stage_expected: identityCacheStageExpected
  };
  return { ...criticalPath.intent };
}

export function setRecognitionPathOutcome(timingContext, {
  status,
  reason = null
} = {}) {
  const criticalPath = timingContext?.recognition_critical_path;
  if (!criticalPath) return null;
  const normalizedStatus = String(status || "UNKNOWN").trim().toUpperCase();
  if (!["UNKNOWN", "COMPLETED", "FAILED"].includes(normalizedStatus)) {
    addCriticalPathAnomaly(timingContext, { code: "INVALID_PATH_OUTCOME" });
    return null;
  }
  criticalPath.outcome = {
    status: normalizedStatus,
    reason: reason === null || reason === undefined || reason === ""
      ? null
      : String(reason).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 100)
  };
  return { ...criticalPath.outcome };
}

export function markRecognitionBoundary(timingContext, boundaryId, {
  atMs = nowMs(),
  metadata = null
} = {}) {
  const criticalPath = timingContext?.recognition_critical_path;
  if (!criticalPath || !recognitionBoundaryIdSet.has(boundaryId)) return null;
  const timestampMs = optionalTimestampMs(atMs);
  if (!Number.isFinite(timestampMs)) {
    addCriticalPathAnomaly(timingContext, { code: "INVALID_BOUNDARY_TIMESTAMP", boundary_id: boundaryId });
    return null;
  }
  if (criticalPath.boundaries[boundaryId]) {
    addCriticalPathAnomaly(timingContext, { code: "DUPLICATE_BOUNDARY_IGNORED", boundary_id: boundaryId });
    return { ...criticalPath.boundaries[boundaryId] };
  }
  criticalPath.boundaries[boundaryId] = boundaryRecord(timingContext, timestampMs, metadata);
  return { ...criticalPath.boundaries[boundaryId] };
}

function updateProviderEnvelopeBoundary(timingContext, boundaryId, atMs, mode) {
  const criticalPath = timingContext?.recognition_critical_path;
  const timestampMs = optionalTimestampMs(atMs);
  if (!criticalPath || !Number.isFinite(timestampMs)) return;
  const existing = criticalPath.boundaries[boundaryId];
  if (!existing
    || (mode === "EARLIEST" && timestampMs < existing.at_ms)
    || (mode === "LATEST" && timestampMs > existing.at_ms)) {
    criticalPath.boundaries[boundaryId] = boundaryRecord(timingContext, timestampMs);
  }
}

export function recordProviderAttempt(timingContext, {
  queuedAtMs = null,
  startedAtMs = null,
  completedAtMs = null,
  status = "COMPLETED",
  errorCode = null
} = {}) {
  const criticalPath = timingContext?.recognition_critical_path;
  if (!criticalPath || !Array.isArray(criticalPath.provider_attempts)) return null;
  const queued = optionalTimestampMs(queuedAtMs);
  const started = optionalTimestampMs(startedAtMs);
  const completed = optionalTimestampMs(completedAtMs);
  const attemptNumber = criticalPath.provider_attempts.length + 1;
  const valid = [queued, started, completed].every(Number.isFinite)
    && queued <= started
    && started <= completed;
  const attempt = {
    attempt: attemptNumber,
    status: String(status || "COMPLETED").toUpperCase(),
    queued_at: isoTimestamp(queued),
    started_at: isoTimestamp(started),
    completed_at: isoTimestamp(completed),
    queued_offset_ms: Number.isFinite(queued) ? Math.round(queued - timingContext.started_at_ms) : null,
    started_offset_ms: Number.isFinite(started) ? Math.round(started - timingContext.started_at_ms) : null,
    completed_offset_ms: Number.isFinite(completed) ? Math.round(completed - timingContext.started_at_ms) : null,
    queue_ms: valid ? Math.round(started - queued) : null,
    execution_ms: valid ? Math.round(completed - started) : null,
    error_code: errorCode ? String(errorCode).slice(0, 100) : null,
    valid
  };
  criticalPath.provider_attempts.push(attempt);
  if (Number.isFinite(queued)) {
    updateProviderEnvelopeBoundary(timingContext, "provider_waiting", queued, "EARLIEST");
  }
  if (Number.isFinite(started)) {
    updateProviderEnvelopeBoundary(timingContext, "provider_started", started, "EARLIEST");
  }
  if (Number.isFinite(completed)) {
    updateProviderEnvelopeBoundary(timingContext, "provider_completed", completed, "LATEST");
  }
  if (!valid) {
    addCriticalPathAnomaly(timingContext, {
      code: "INVALID_PROVIDER_ATTEMPT_TIMESTAMPS",
      attempt: attemptNumber
    });
    return { ...attempt };
  }
  return { ...attempt };
}

function intervalUnionMs(intervals = []) {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let active = null;
  for (const [start, end] of sorted) {
    if (!active || start > active[1]) {
      if (active) total += active[1] - active[0];
      active = [start, end];
    } else {
      active[1] = Math.max(active[1], end);
    }
  }
  if (active) total += active[1] - active[0];
  return Math.max(0, Math.round(total));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export function snapshotRecognitionCriticalPath(timingContext) {
  const criticalPath = timingContext?.recognition_critical_path || {};
  const intent = criticalPath.intent && typeof criticalPath.intent === "object"
    ? criticalPath.intent
    : {};
  const normalizedPathKind = recognitionPathKinds.has(String(intent.path_kind || "").toUpperCase())
    ? String(intent.path_kind).toUpperCase()
    : "UNKNOWN";
  const boundaries = Object.fromEntries(recognitionBoundaryIds.map((id) => [
    id,
    criticalPath.boundaries?.[id] ? { ...criticalPath.boundaries[id] } : null
  ]));
  const attempts = Array.isArray(criticalPath.provider_attempts)
    ? criticalPath.provider_attempts.map((attempt) => ({ ...attempt }))
    : [];
  const providerIsExpected = typeof intent.provider_expected === "boolean"
    ? intent.provider_expected
    : null;
  const cacheStageIsExpected = typeof intent.identity_cache_stage_expected === "boolean"
    ? intent.identity_cache_stage_expected
    : null;
  const intentComplete = normalizedPathKind !== "UNKNOWN"
    && providerIsExpected !== null
    && cacheStageIsExpected !== null;
  const expected = new Set(["core_started", "decision_ready", "core_terminal_ready", "response_built"]);
  if (!["EXACT_REPLAY", "PRE_PROVIDER_FAST_FINAL"].includes(normalizedPathKind)) {
    expected.add("full_path_started");
  }
  if (providerIsExpected === true) {
    expected.add("provider_waiting");
    expected.add("provider_started");
    expected.add("provider_completed");
  }
  if (cacheStageIsExpected === true) expected.add("identity_cache_stage_completed");
  const missing = [...expected].filter((id) => !boundaries[id]);
  const dynamicAnomalies = [];
  const segments = Object.fromEntries(recognitionSegmentDefinitions({
    pathKind: normalizedPathKind,
    providerExpected: providerIsExpected === true,
    identityCacheStageExpected: cacheStageIsExpected === true
  }).map(([id, from, to]) => {
    const start = boundaries[from]?.at_ms;
    const end = boundaries[to]?.at_ms;
    const applicable = expected.has(from) || expected.has(to) || Boolean(start) || Boolean(end);
    if (!applicable) return [id, { status: "NOT_APPLICABLE", from, to, duration_ms: null }];
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return [id, { status: "NOT_MEASURED", from, to, duration_ms: null }];
    }
    if (end < start) {
      dynamicAnomalies.push({ code: "NON_MONOTONIC_BOUNDARY", boundary_id: to, attempt: null });
      return [id, { status: "INVALID", from, to, duration_ms: null }];
    }
    return [id, { status: "MEASURED", from, to, duration_ms: Math.round(end - start) }];
  }));
  const providerIntervals = attempts
    .filter((attempt) => attempt.valid)
    .map((attempt) => [Number(attempt.started_offset_ms), Number(attempt.completed_offset_ms)]);
  const providerActiveUnionMs = providerIsExpected === true && providerIntervals.length > 0
    ? intervalUnionMs(providerIntervals)
    : null;
  const providerEnvelopeMs = providerIsExpected === true
    && boundaries.provider_started && boundaries.provider_completed
    ? Math.max(0, Math.round(boundaries.provider_completed.at_ms - boundaries.provider_started.at_ms))
    : null;
  const coreStartedMs = boundaries.core_started?.at_ms;
  const responseBuiltMs = boundaries.response_built?.at_ms;
  const totalWallMs = Number.isFinite(coreStartedMs) && Number.isFinite(responseBuiltMs)
    && responseBuiltMs >= coreStartedMs
    ? Math.round(responseBuiltMs - coreStartedMs)
    : null;
  const measuredIntervals = Object.values(segments)
    .filter((segment) => segment.status === "MEASURED")
    .map((segment) => [boundaries[segment.from].offset_ms, boundaries[segment.to].offset_ms]);
  const measuredSegmentUnionMs = intervalUnionMs(measuredIntervals);
  const anomalies = [
    ...(Array.isArray(criticalPath.anomalies) ? criticalPath.anomalies.map((item) => ({ ...item })) : []),
    ...dynamicAnomalies
  ];
  const status = anomalies.length ? "INVALID" : (!intentComplete || missing.length) ? "PARTIAL" : "COMPLETE";
  const outcome = criticalPath.outcome && typeof criticalPath.outcome === "object"
    ? criticalPath.outcome
    : { status: "UNKNOWN", reason: null };
  return deepFreeze({
    schema_version: recognitionCriticalPathSchemaVersion,
    scope: recognitionCriticalPathScope,
    excludes: [...recognitionCriticalPathExclusions],
    path_kind: normalizedPathKind,
    status,
    termination_status: outcome.status || "UNKNOWN",
    termination_reason: outcome.reason || null,
    provider_expected: providerIsExpected,
    identity_cache_stage_expected: cacheStageIsExpected,
    total_wall_ms: totalWallMs,
    measured_segment_union_ms: measuredSegmentUnionMs,
    unattributed_wall_ms: totalWallMs === null ? null : Math.max(0, totalWallMs - measuredSegmentUnionMs),
    provider_active_union_ms: providerActiveUnionMs,
    provider_stage_status: providerIsExpected === false
      ? "NOT_APPLICABLE"
      : providerActiveUnionMs === null
        ? "NOT_MEASURED"
        : "MEASURED",
    provider_envelope_ms: providerEnvelopeMs,
    provider_internal_gap_ms: providerEnvelopeMs === null || providerActiveUnionMs === null
      ? null
      : Math.max(0, providerEnvelopeMs - providerActiveUnionMs),
    missing_contract_fields: intentComplete
      ? []
      : [
        ...(normalizedPathKind === "UNKNOWN" ? ["path_kind"] : []),
        ...(providerIsExpected === null ? ["provider_expected"] : []),
        ...(cacheStageIsExpected === null ? ["identity_cache_stage_expected"] : [])
      ],
    missing_boundary_ids: missing,
    boundaries,
    segments,
    provider_attempts: attempts,
    provider_attempt_semantics: "CAPACITY_STAGE_INVOCATION; internal HTTP retries remain inside execution windows",
    anomalies
  });
}

export function compactRecognitionCriticalPath(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const totalWallMs = optionalFiniteNumber(value.total_wall_ms);
  const unattributedWallMs = optionalFiniteNumber(value.unattributed_wall_ms);
  const providerActiveUnionMs = optionalFiniteNumber(value.provider_active_union_ms);
  const providerInternalGapMs = optionalFiniteNumber(value.provider_internal_gap_ms);
  const providerAttemptCount = optionalFiniteNumber(value.provider_attempt_count);
  const missingBoundaryCount = optionalFiniteNumber(value.missing_boundary_count);
  const missingContractFieldCount = optionalFiniteNumber(value.missing_contract_field_count);
  const anomalyCount = optionalFiniteNumber(value.anomaly_count);
  return deepFreeze({
    schema_version: value.schema_version || recognitionCriticalPathSchemaVersion,
    scope: value.scope || recognitionCriticalPathScope,
    path_kind: value.path_kind || "UNKNOWN",
    status: value.status || "PARTIAL",
    termination_status: value.termination_status || "UNKNOWN",
    termination_reason: value.termination_reason || null,
    total_wall_ms: totalWallMs,
    unattributed_wall_ms: unattributedWallMs,
    provider_stage_status: value.provider_stage_status || null,
    provider_active_union_ms: providerActiveUnionMs,
    provider_internal_gap_ms: providerInternalGapMs,
    provider_attempt_count: providerAttemptCount === null
      ? (Array.isArray(value.provider_attempts) ? value.provider_attempts.length : 0)
      : Math.max(0, Math.trunc(providerAttemptCount)),
    missing_boundary_count: missingBoundaryCount === null
      ? (Array.isArray(value.missing_boundary_ids) ? value.missing_boundary_ids.length : 0)
      : Math.max(0, Math.trunc(missingBoundaryCount)),
    missing_contract_field_count: missingContractFieldCount === null
      ? (Array.isArray(value.missing_contract_fields) ? value.missing_contract_fields.length : 0)
      : Math.max(0, Math.trunc(missingContractFieldCount)),
    anomaly_count: anomalyCount === null
      ? (Array.isArray(value.anomalies) ? value.anomalies.length : 0)
      : Math.max(0, Math.trunc(anomalyCount))
  });
}

export function emptyTiming() {
  return {
    client_image_prepare_ms: null,
    client_upload_ms: null,
    client_storage_sign_ms: null,
    client_storage_put_ms: null,
    client_storage_verify_ms: null,
    client_preingestion_request_ms: null,
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
    post_observation_retrieval_deadline_ms: 0,
    post_observation_retrieval_deferred_count: 0,
    post_observation_catalog_settled_within_budget_count: 0,
    post_observation_vector_settled_within_budget_count: 0,
    post_observation_exact_anchor_budget_used_count: 0,
    post_observation_exact_anchor_budget_ms: 0,
    post_observation_structured_anchor_budget_used_count: 0,
    post_observation_structured_anchor_budget_ms: 0,
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
  const startedAtMs = nowMs();
  const timing = emptyTiming();
  const clientTiming = payload.clientTiming || payload.client_timing || {};
  [
    "client_image_prepare_ms",
    "client_upload_ms",
    "client_storage_sign_ms",
    "client_storage_put_ms",
    "client_storage_verify_ms",
    "client_preingestion_request_ms",
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
    started_at_ms: startedAtMs,
    timing,
    recognition_critical_path: {
      schema_version: recognitionCriticalPathSchemaVersion,
      boundaries: {
        core_started: {
          at: isoTimestamp(startedAtMs),
          at_ms: startedAtMs,
          offset_ms: 0
        }
      },
      provider_attempts: [],
      anomalies: [],
      intent: {
        path_kind: "UNKNOWN",
        provider_expected: null,
        identity_cache_stage_expected: null
      },
      outcome: {
        status: "UNKNOWN",
        reason: null
      }
    },
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
