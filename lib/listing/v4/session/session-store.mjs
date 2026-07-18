import crypto from "node:crypto";
import { buildDataIdentitySnapshot } from "../../feedback/data-identity.mjs";
import { v4SchemaVersion } from "../schema/version.mjs";
import { v4SessionStatuses } from "./status.mjs";
import { callV4Rpc, isV4SupabaseConfigured, patchV4Row, readV4Rows, writeV4Row, writeV4Rows } from "./supabase-rest.mjs";

function nowIso() {
  return new Date().toISOString();
}

export function createV4SessionId(prefix = "v4sess") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function compact(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, next]) => next !== undefined)
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalJson(value[key])])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function immutableSessionIdentity(row = {}) {
  return canonicalJson({
    id: row.id || null,
    schema_version: row.schema_version || null,
    tenant_id: row.tenant_id || null,
    user_id: row.user_id || null,
    operator_id: row.operator_id || null,
    asset_id: row.asset_id || null,
    stable_asset_id: row.stable_asset_id || null,
    client_asset_ref: row.client_asset_ref || null,
    asset_fingerprint: row.asset_fingerprint || null,
    identity_snapshot: row.identity_snapshot && typeof row.identity_snapshot === "object"
      ? row.identity_snapshot
      : {}
  });
}

function sessionIdentityMatches(actual = {}, expected = {}) {
  return JSON.stringify(immutableSessionIdentity(actual))
    === JSON.stringify(immutableSessionIdentity(expected));
}

export function buildV4RecognitionSessionRow({
  sessionId = createV4SessionId(),
  payload = {},
  routePlan = {},
  operatorId = "",
  tenantId = "",
  userId = ""
} = {}) {
  const createdAt = nowIso();
  const identity = buildDataIdentitySnapshot({ payload, tenantId, userId, operatorId });
  return compact({
    id: sessionId,
    schema_version: v4SchemaVersion,
    status: v4SessionStatuses.CREATED,
    asset_id: payload.asset_id || payload.assetId || null,
    stable_asset_id: identity.stable_asset_id,
    client_asset_ref: identity.client_asset_ref,
    asset_fingerprint: identity.asset_fingerprint,
    tenant_id: identity.tenant_id,
    user_id: identity.user_id,
    identity_snapshot: identity,
    preingestion_bundle_id: payload.preingestion_bundle_id || payload.preingestionBundleId || null,
    route: routePlan.route || null,
    route_reason: routePlan.route_reason || null,
    route_plan: routePlan,
    request_summary: {
      image_count: Array.isArray(payload.images) ? payload.images.length : 0,
      has_preingestion_bundle: Boolean(payload.preingestion_bundle_id || payload.preingestionBundleId),
      provider: payload.provider || payload.vision_provider || payload.provider_id || null,
      mode: payload.mode || null
    },
    operator_id: operatorId || null,
    created_at: createdAt,
    updated_at: createdAt
  });
}

export async function createV4RecognitionSession({
  sessionId = createV4SessionId(),
  payload = {},
  routePlan = {},
  operatorId = "",
  tenantId = "",
  userId = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const row = buildV4RecognitionSessionRow({ sessionId, payload, routePlan, operatorId, tenantId, userId });
  const result = await writeV4Row({
    table: "v4_recognition_sessions",
    row,
    upsert: true,
    duplicateResolution: "ignore",
    env,
    fetchImpl
  });
  if (!result.saved) {
    return { sessionId, row, persistence: { recognition_session: result } };
  }

  const persisted = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "id,schema_version,tenant_id,user_id,operator_id,asset_id,stable_asset_id,client_asset_ref,asset_fingerprint,identity_snapshot",
    search: {
      id: `eq.${sessionId}`,
      tenant_id: `eq.${row.tenant_id}`,
      limit: "2"
    },
    env,
    fetchImpl
  });
  const persistedRow = persisted.rows?.[0] || null;
  const verified = persisted.ok === true
    && persisted.rows.length === 1
    && sessionIdentityMatches(persistedRow, row);
  return {
    sessionId,
    row: persistedRow || row,
    persistence: {
      recognition_session: {
        ...result,
        saved: verified,
        row: persistedRow,
        verified_after_write: verified,
        error: verified
          ? null
          : persisted.error || "recognition_session_post_write_identity_conflict"
      }
    }
  };
}

export async function updateV4RecognitionSession({
  sessionId,
  patch = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId) return { saved: false, error: "missing_session_id" };
  return patchV4Row({
    table: "v4_recognition_sessions",
    id: sessionId,
    patch: compact({ ...patch, updated_at: nowIso() }),
    env,
    fetchImpl
  });
}

export async function updateV4RecognitionSessionWithRetry({
  sessionId,
  patch = {},
  attempts = 3,
  retryBaseMs = 100,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(attempts) || 3));
  const baseMs = Math.max(10, Math.min(2_000, Number(retryBaseMs) || 100));
  let result = { saved: false, error: "session_update_not_attempted" };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await updateV4RecognitionSession({ sessionId, patch, env, fetchImpl });
    if (result.saved) return { ...result, write_attempts: attempt };
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, baseMs * (2 ** (attempt - 1))));
    }
  }
  return { ...result, write_attempts: maxAttempts };
}

export async function persistV4WriterReadyAndReleaseCapacity({
  sessionId,
  patch = {},
  jobId,
  workerId = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId) return { saved: false, released: false, error: "missing_session_id" };
  if (!jobId) return { saved: false, released: false, error: "missing_job_id" };
  const response = await callV4Rpc({
    fn: "persist_v4_writer_ready_and_release_capacity",
    payload: {
      p_session_id: String(sessionId),
      p_session_patch: compact(patch),
      p_job_id: String(jobId),
      p_worker_id: workerId ? String(workerId).slice(0, 120) : null
    },
    env,
    fetchImpl
  });
  const transaction = response.rows?.[0] && typeof response.rows[0] === "object"
    ? response.rows[0]
    : {};
  return {
    saved: response.ok === true && transaction.session_saved === true,
    released: response.ok === true && transaction.provider_capacity_released === true,
    released_count: Number(transaction.provider_capacity_released_count || 0),
    release_boundary: transaction.release_boundary || "writer_ready_atomic",
    persistence_mode: "writer_ready_capacity_atomic_rpc",
    transaction,
    error: response.error || null,
    sanitized_nul_byte_count: Number(response.sanitized_nul_byte_count || 0)
  };
}

export async function persistV4PreingestionBundle({
  bundleId,
  tenantId,
  assetId = null,
  bundle = {},
  summary = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!bundleId) return { saved: false, error: "missing_bundle_id" };
  const safeTenantId = String(tenantId || "").trim();
  const safeAssetId = String(assetId || bundle.asset_id || "").trim();
  if (!safeTenantId) return { saved: false, error: "missing_tenant_id" };
  if (bundle.tenant_id && String(bundle.tenant_id).trim() !== safeTenantId) {
    return { saved: false, error: "preingestion_bundle_tenant_mismatch" };
  }
  if (assetId && bundle.asset_id && String(bundle.asset_id).trim() !== String(assetId).trim()) {
    return { saved: false, error: "preingestion_bundle_asset_mismatch" };
  }
  return writeV4Row({
    table: "v4_preingestion_bundles",
    row: compact({
      id: bundleId,
      tenant_id: safeTenantId,
      asset_id: safeAssetId || null,
      schema_version: v4SchemaVersion,
      status: bundle.bundle_status || bundle.status || "READY",
      bundle,
      summary,
      created_at: nowIso(),
      updated_at: nowIso()
    }),
    upsert: true,
    env,
    fetchImpl
  });
}

export async function persistV4FieldEvidence({
  sessionId,
  rows = [],
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const prepared = rows.map((row, index) => compact({
    id: row.id || `${sessionId}_field_${index + 1}`,
    recognition_session_id: sessionId,
    field_name: row.field_name || row.field || "",
    field_value: row.field_value ?? row.value ?? null,
    display_status: row.display_status || row.status || "NORMAL",
    source_type: row.source_type || "V4_RESULT_ADAPTER",
    provenance: row.provenance || {},
    confidence: row.confidence ?? null,
    created_at: nowIso()
  })).filter((row) => row.recognition_session_id && row.field_name);
  return writeV4Rows({
    table: "v4_field_evidence",
    rows: prepared,
    returnRepresentation: false,
    env,
    fetchImpl
  });
}

export async function persistV4CandidateTrace({
  sessionId,
  trace = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId) return { saved: false, error: "missing_session_id" };
  return writeV4Row({
    table: "v4_candidate_traces",
    row: {
      id: `${sessionId}_candidate_trace`,
      recognition_session_id: sessionId,
      schema_version: v4SchemaVersion,
      trace,
      created_at: nowIso()
    },
    upsert: true,
    returnRepresentation: false,
    env,
    fetchImpl
  });
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const sensitiveDiagnosticKey = /(?:api[_-]?key|secret|authorization|cookie|password|signed[_-]?url|image[_-]?(?:url|data)|base64|prompt|response[_-]?body|raw[_-]?text|seller[_-]?title|corrected[_-]?title|answer[_-]?key)/i;

function sanitizeDiagnosticValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value !== "object") {
    if (typeof value === "string") return value.slice(0, 500);
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveDiagnosticKey.test(key))
      .slice(0, 150)
      .map(([key, item]) => [key, sanitizeDiagnosticValue(item, depth + 1)])
  );
}

export function normalizeV4QualityLedgerRow(ledger = {}) {
  const tokenDiagnostics = ledger.token_diagnostics && typeof ledger.token_diagnostics === "object"
    ? ledger.token_diagnostics
    : {};
  const timing = ledger.timing && typeof ledger.timing === "object" ? ledger.timing : {};
  return {
    id: ledger.id || `${ledger.recognition_session_id || createV4SessionId("v4ledger")}_quality`,
    recognition_session_id: ledger.recognition_session_id || null,
    schema_version: v4SchemaVersion,
    route: ledger.route || null,
    provider: ledger.provider || null,
    model: ledger.model || null,
    status: ledger.status || null,
    confidence: ledger.confidence || null,
    latency_ms: finiteNumberOrNull(ledger.latency_ms ?? timing.provider_total_ms ?? timing.total_ms),
    input_tokens: finiteNumberOrNull(ledger.input_tokens ?? tokenDiagnostics.input_tokens ?? tokenDiagnostics.prompt_tokens),
    output_tokens: finiteNumberOrNull(ledger.output_tokens ?? tokenDiagnostics.output_tokens ?? tokenDiagnostics.completion_tokens),
    total_tokens: finiteNumberOrNull(ledger.total_tokens ?? tokenDiagnostics.total_tokens),
    provider_error_type: ledger.provider_error_type || null,
    token_diagnostics: sanitizeDiagnosticValue(tokenDiagnostics),
    timing: sanitizeDiagnosticValue(timing),
    route_plan: sanitizeDiagnosticValue(ledger.route_plan || {}),
    warnings: sanitizeDiagnosticValue(Array.isArray(ledger.warnings) ? ledger.warnings : []),
    persistence_summary: sanitizeDiagnosticValue(ledger.persistence_summary || {}),
    provider_diagnostics: sanitizeDiagnosticValue({
      rate_limit: ledger.rate_limit_diagnostics || null,
      request: ledger.request_diagnostics || null,
      initial_token: ledger.initial_token_diagnostics || null,
      initial_rate_limit: ledger.initial_rate_limit_diagnostics || null,
      initial_request: ledger.initial_request_diagnostics || null,
      key_pool_size: finiteNumberOrNull(ledger.key_pool_size),
      key_slot: finiteNumberOrNull(ledger.key_slot),
      key_source: ledger.key_source || null,
      key_rotation_attempted: ledger.key_rotation_attempted === true,
      key_rotation_attempts: finiteNumberOrNull(ledger.key_rotation_attempts) || 0,
      fast_scout: ledger.fast_scout || null,
      title_length_policy: ledger.title_length_policy || null,
      title_reconciliation_reasons: ledger.title_reconciliation_reasons || [],
      gpt5_empty_result_retry_attempted: ledger.gpt5_empty_result_retry_attempted === true,
      gpt5_empty_result_retry_success: ledger.gpt5_empty_result_retry_success === true,
      failure_reason: ledger.failure_reason || null
    }),
    pipeline_node_ledger: sanitizeDiagnosticValue(ledger.pipeline_node_ledger || {}),
    created_at: ledger.created_at || nowIso()
  };
}

export async function persistV4QualityLedger({
  ledger = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!ledger.recognition_session_id) return { saved: false, error: "missing_recognition_session_id" };
  const normalizedLedger = normalizeV4QualityLedgerRow(ledger);
  return writeV4Row({
    table: "v4_production_quality_ledger",
    row: normalizedLedger,
    upsert: true,
    returnRepresentation: false,
    env,
    fetchImpl
  });
}

export async function persistV4FeedbackEvent({
  event = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_writer_feedback_events",
    row: buildV4FeedbackEventRow(event),
    upsert: false,
    env,
    fetchImpl
  });
}

export function buildV4FeedbackEventRow(event = {}) {
  return {
    id: event.id || createV4SessionId("v4feedback"),
    schema_version: v4SchemaVersion,
    ...event,
    created_at: event.created_at || nowIso()
  };
}

export async function persistV4LearningEvent({
  event = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_learning_events",
    row: buildV4LearningEventRow(event),
    upsert: true,
    env,
    fetchImpl
  });
}

export async function persistV4SemValidationEvent({
  event = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_sem_validation_events",
    row: event,
    upsert: false,
    env,
    fetchImpl
  });
}

export function buildV4LearningEventRow(event = {}) {
  return {
    id: event.id || createV4SessionId("v4learn"),
    schema_version: v4SchemaVersion,
    ...event,
    created_at: event.created_at || nowIso()
  };
}

export async function persistV4WriterFeedbackTransaction({
  sessionId,
  tenantId,
  operatorId,
  status,
  feedbackEvent = {},
  learningEvent = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId || !tenantId || !operatorId || !status) {
    return { saved: false, transaction: null, error: "missing_feedback_transaction_identity" };
  }
  const result = await callV4Rpc({
    fn: "persist_v4_writer_feedback_transaction",
    payload: {
      p_session_id: String(sessionId),
      p_tenant_id: String(tenantId),
      p_operator_id: String(operatorId),
      p_session_status: String(status),
      p_feedback_event: buildV4FeedbackEventRow({ ...feedbackEvent, tenant_id: String(tenantId) }),
      p_learning_event: buildV4LearningEventRow({ ...learningEvent, tenant_id: String(tenantId) })
    },
    env,
    fetchImpl
  });
  const transaction = result.rows?.[0] || null;
  return {
    saved: result.ok && transaction?.saved === true,
    transaction,
    error: result.error || (transaction?.saved === true ? null : "feedback_transaction_not_saved")
  };
}

export function buildV4CatalogGapRow(gap = {}) {
  // Deterministic id per (asset, gap type, printed code): re-recognizing the
  // same card updates ONE queue row instead of appending one per run (the
  // queue held 551 rows for 34 assets before this). Run-consensus counts
  // for promotion come from recognition sessions, not row multiplicity.
  const anchorCode = String(
    gap.observed_fields?.checklist_code
    || gap.observed_fields?.collector_number
    || gap.observed_fields?.card_number
    || "nocode"
  ).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
  const deterministicId = gap.asset_id
    ? `v4gap_${gap.asset_id}_${gap.gap_type || "CATALOG_IDENTITY_GAP"}_${anchorCode}`.slice(0, 160)
    : `${gap.recognition_session_id || createV4SessionId("v4gap")}_gap`;
  return {
    id: gap.id || deterministicId,
    recognition_session_id: gap.recognition_session_id || null,
    asset_id: gap.asset_id || null,
    gap_type: gap.gap_type || "CATALOG_IDENTITY_GAP",
    observed_fields: gap.observed_fields || {},
    candidate_snapshot: gap.candidate_snapshot || {},
    draft_title: gap.draft_title || null,
    status: gap.status || "OPEN",
    created_at: gap.created_at || nowIso(),
    updated_at: gap.updated_at || nowIso()
  };
}

export async function persistV4CatalogGap({
  gap = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_catalog_gap_queue",
    row: buildV4CatalogGapRow(gap),
    upsert: true,
    returnRepresentation: false,
    env,
    fetchImpl
  });
}

export async function persistV4NonCriticalArtifactsAtomic({
  sessionId,
  fieldEvidenceRows = [],
  candidateTrace = {},
  catalogGap = null,
  qualityLedger = {},
  attempts = 2,
  retryBaseMs = 120,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId) return { saved: false, transaction: null, error: "missing_session_id", write_attempts: 0 };
  const evidenceRows = (Array.isArray(fieldEvidenceRows) ? fieldEvidenceRows : [])
    .map((row, index) => compact({
      id: row.id || `${sessionId}_field_${index + 1}`,
      recognition_session_id: sessionId,
      field_name: row.field_name || row.field || "",
      field_value: row.field_value ?? row.value ?? null,
      display_status: row.display_status || row.status || "NORMAL",
      source_type: row.source_type || "V4_RESULT_ADAPTER",
      provenance: row.provenance || {},
      confidence: row.confidence ?? null,
      created_at: row.created_at || nowIso()
    }))
    .filter((row) => row.field_name);
  const traceRow = {
    id: `${sessionId}_candidate_trace`,
    recognition_session_id: sessionId,
    schema_version: v4SchemaVersion,
    trace: candidateTrace || {},
    created_at: nowIso()
  };
  const gapRow = catalogGap ? buildV4CatalogGapRow({ ...catalogGap, recognition_session_id: sessionId }) : null;
  const ledgerRow = normalizeV4QualityLedgerRow({
    ...qualityLedger,
    id: qualityLedger.id || `${sessionId}_quality`,
    recognition_session_id: sessionId
  });
  const maxAttempts = Math.max(1, Math.min(3, Number(attempts) || 2));
  const baseMs = Math.max(10, Math.min(1_000, Number(retryBaseMs) || 120));
  let response = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await callV4Rpc({
      fn: "persist_v4_noncritical_artifacts",
      payload: {
        p_session_id: sessionId,
        p_field_evidence: evidenceRows,
        p_candidate_trace: traceRow,
        p_catalog_gap: gapRow,
        p_quality_ledger: ledgerRow
      },
      env,
      fetchImpl
    });
    const transaction = response.rows?.[0] || null;
    if (response.ok && transaction?.saved === true) {
      return { saved: true, transaction, error: null, write_attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, baseMs * (2 ** (attempt - 1))));
    }
  }
  return {
    saved: false,
    transaction: response?.rows?.[0] || null,
    error: response?.error || "atomic_noncritical_persistence_failed",
    write_attempts: maxAttempts
  };
}

export async function persistV4FastScoutCache({
  cache = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!cache.id) return { saved: false, error: "missing_cache_id" };
  const now = nowIso();
  const row = compact({
    id: cache.id,
    scout_id: cache.scout_id || cache.id,
    asset_id: cache.asset_id || null,
    image_hash: cache.image_hash || null,
    image_role: cache.image_role || null,
    model_id: cache.model_id || null,
    model_revision: cache.model_revision || null,
    scout_fields: cache.scout_fields || {},
    review_fields: cache.review_fields || [],
    confidence: cache.confidence ?? null,
    route_hint: cache.route_hint || {},
    status: cache.status || "READY",
    error_message: cache.error_message || null,
    result_payload: cache.result_payload || {},
    expires_at: cache.expires_at || null,
    created_at: cache.created_at || now,
    updated_at: cache.updated_at || now
  });
  const primary = await writeV4Row({
    table: "v4_fast_scout_cache",
    row,
    upsert: true,
    env,
    fetchImpl
  });
  if (primary.ok || primary.saved) return { ...primary, cache_backend: "v4_fast_scout_cache" };
  const fallback = await writeV4Row({
    table: "v4_preingestion_bundles",
    row: compact({
      id: cache.id,
      asset_id: cache.asset_id || null,
      schema_version: v4SchemaVersion,
      status: "FAST_SCOUT_CACHE",
      bundle: {
        kind: "FAST_SCOUT_CACHE",
        cache: row
      },
      summary: {
        cache_backend: "v4_preingestion_bundles",
        primary_error: primary.error || null,
        image_hash: row.image_hash || null,
        status: row.status || "READY"
      },
      created_at: row.created_at || now,
      updated_at: row.updated_at || now
    }),
    upsert: true,
    env,
    fetchImpl
  });
  return { ...fallback, cache_backend: "v4_preingestion_bundles", primary_error: primary.error || null };
}

export async function readV4FastScoutCache({
  cacheId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!cacheId) return { ok: false, row: null, error: "missing_cache_id" };
  const result = await readV4Rows({
    table: "v4_fast_scout_cache",
    select: "*",
    search: { id: `eq.${cacheId}`, limit: "1" },
    env,
    fetchImpl
  });
  if (result.ok && result.rows[0]) return { ok: true, row: result.rows[0], error: null, cache_backend: "v4_fast_scout_cache" };
  const fallback = await readV4Rows({
    table: "v4_preingestion_bundles",
    select: "id,bundle,status,updated_at",
    search: { id: `eq.${cacheId}`, limit: "1" },
    env,
    fetchImpl
  });
  if (!fallback.ok) return { ok: false, row: null, error: fallback.error || result.error };
  const cache = fallback.rows[0]?.bundle?.cache || null;
  return {
    ok: true,
    row: cache,
    error: cache ? null : (result.error || null),
    cache_backend: cache ? "v4_preingestion_bundles" : null
  };
}

export async function readV4SessionStatus({
  sessionId,
  tenantId = "",
  operatorId = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId) return { ok: false, session: null, error: "missing_session_id" };
  const session = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "*",
    search: {
      id: `eq.${sessionId}`,
      ...(tenantId ? { tenant_id: `eq.${tenantId}` } : {}),
      ...(operatorId ? { operator_id: `eq.${operatorId}` } : {}),
      limit: "1"
    },
    env,
    fetchImpl
  });
  if (!session.ok) return { ok: false, session: null, error: session.error };
  return { ok: true, session: session.rows[0] || null, error: null };
}

export async function checkV4Tables({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!isV4SupabaseConfigured(env)) {
    return { configured: false, tables: {}, error: "supabase_not_configured" };
  }
  const tableSpecs = [
    ["v4_recognition_sessions", "id"],
    ["v4_preingestion_bundles", "id"],
    ["v4_field_evidence", "id"],
    ["v4_candidate_traces", "id"],
    ["v4_writer_feedback_events", "id"],
    ["v4_learning_events", "id"],
    ["v4_sem_validation_events", "id"],
    ["v4_production_quality_ledger", "id,provider_diagnostics,pipeline_node_ledger"],
    ["v4_catalog_gap_queue", "id"],
    ["v4_recognition_jobs", "id"],
    ["v4_writer_export_batches", "id"],
    ["v4_writer_export_items", "id"],
    ["listing_assets", "id,tenant_id,image_generation_id,expected_original_count,image_set_state,image_set_sha256"],
    ["listing_image_verifications", "object_path,tenant_id,asset_id,image_generation_id,object_verified,content_hash_verified,canonical_eligible"]
  ];
  const tables = {};
  for (const [table, select] of tableSpecs) {
    const result = await readV4Rows({ table, select, search: { limit: "1" }, env, fetchImpl });
    tables[table] = { ok: result.ok, error: result.error || null };
  }
  const assetLifecycleTables = ["listing_assets", "listing_image_verifications"];
  return {
    configured: true,
    tables,
    asset_lifecycle: {
      ready: assetLifecycleTables.every((table) => tables[table]?.ok === true),
      tables: Object.fromEntries(assetLifecycleTables.map((table) => [table, tables[table]]))
    },
    error: null
  };
}
