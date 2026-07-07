import crypto from "node:crypto";
import { v4SchemaVersion } from "../schema/version.mjs";
import { v4SessionStatuses } from "./status.mjs";
import { isV4SupabaseConfigured, patchV4Row, readV4Rows, writeV4Row, writeV4Rows } from "./supabase-rest.mjs";

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

export async function createV4RecognitionSession({
  sessionId = createV4SessionId(),
  payload = {},
  routePlan = {},
  operatorId = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const createdAt = nowIso();
  const row = compact({
    id: sessionId,
    schema_version: v4SchemaVersion,
    status: v4SessionStatuses.CREATED,
    asset_id: payload.asset_id || payload.assetId || null,
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
  const result = await writeV4Row({ table: "v4_recognition_sessions", row, upsert: true, env, fetchImpl });
  return { sessionId, row, persistence: { recognition_session: result } };
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

export async function persistV4PreingestionBundle({
  bundleId,
  assetId = null,
  bundle = {},
  summary = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!bundleId) return { saved: false, error: "missing_bundle_id" };
  return writeV4Row({
    table: "v4_preingestion_bundles",
    row: compact({
      id: bundleId,
      asset_id: assetId || bundle.asset_id || null,
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
  return writeV4Rows({ table: "v4_field_evidence", rows: prepared, env, fetchImpl });
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
    env,
    fetchImpl
  });
}

export async function persistV4QualityLedger({
  ledger = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_production_quality_ledger",
    row: {
      id: ledger.id || `${ledger.recognition_session_id || createV4SessionId("v4ledger")}_quality`,
      schema_version: v4SchemaVersion,
      ...ledger,
      created_at: ledger.created_at || nowIso()
    },
    upsert: true,
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
    row: {
      id: event.id || createV4SessionId("v4feedback"),
      schema_version: v4SchemaVersion,
      ...event,
      created_at: event.created_at || nowIso()
    },
    upsert: true,
    env,
    fetchImpl
  });
}

export async function persistV4LearningEvent({
  event = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_learning_events",
    row: {
      id: event.id || createV4SessionId("v4learn"),
      schema_version: v4SchemaVersion,
      ...event,
      created_at: event.created_at || nowIso()
    },
    upsert: true,
    env,
    fetchImpl
  });
}

export async function persistV4CatalogGap({
  gap = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return writeV4Row({
    table: "v4_catalog_gap_queue",
    row: {
      id: gap.id || `${gap.recognition_session_id || createV4SessionId("v4gap")}_gap`,
      recognition_session_id: gap.recognition_session_id || null,
      asset_id: gap.asset_id || null,
      gap_type: gap.gap_type || "CATALOG_IDENTITY_GAP",
      observed_fields: gap.observed_fields || {},
      candidate_snapshot: gap.candidate_snapshot || {},
      draft_title: gap.draft_title || null,
      status: gap.status || "OPEN",
      created_at: gap.created_at || nowIso(),
      updated_at: gap.updated_at || nowIso()
    },
    upsert: true,
    env,
    fetchImpl
  });
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
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionId) return { ok: false, session: null, error: "missing_session_id" };
  const session = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "*",
    search: { id: `eq.${sessionId}`, limit: "1" },
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
  const tableNames = [
    "v4_recognition_sessions",
    "v4_preingestion_bundles",
    "v4_field_evidence",
    "v4_candidate_traces",
    "v4_writer_feedback_events",
    "v4_learning_events",
    "v4_production_quality_ledger",
    "v4_catalog_gap_queue"
  ];
  const tables = {};
  for (const table of tableNames) {
    const result = await readV4Rows({ table, select: "id", search: { limit: "1" }, env, fetchImpl });
    tables[table] = { ok: result.ok, error: result.error || null };
  }
  return { configured: true, tables, error: null };
}
