import crypto from "node:crypto";

import { readSupabaseRows, writeSupabaseRow } from "../../supabase-rest.mjs";
import { buildDataIdentitySnapshot } from "../feedback/data-identity.mjs";

// The physical table is retained until a dedicated CSM root-table migration is
// justified. It is storage compatibility only; the active module and row
// contract are CSM-owned.
export const CSM_RECOGNITION_SESSION_TABLE = "v4_recognition_sessions";
export const CSM_SESSION_SCHEMA_VERSION = "csm-recognition-session-v1";

export function createCsmSessionId(prefix = "csmsess") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function compact(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalJson(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function immutableSessionIdentity(row = {}) {
  row = row || {};
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

function sessionIdentityMatches(actual, expected) {
  return JSON.stringify(immutableSessionIdentity(actual))
    === JSON.stringify(immutableSessionIdentity(expected));
}

function durableSessionOwnerIdentity(row = {}) {
  const snapshot = row?.identity_snapshot && typeof row.identity_snapshot === "object"
    ? row.identity_snapshot
    : {};
  const originalImageReferences = (Array.isArray(snapshot.image_references)
    ? snapshot.image_references
    : [])
    .filter((reference) => reference?.derived !== true)
    .map((reference = {}) => ({
      image_id: reference.image_id || null,
      image_role: reference.image_role || null,
      bucket: reference.bucket || null,
      object_path: reference.object_path || null,
      content_sha256: reference.content_sha256 || null
    }));
  return canonicalJson({
    id: row?.id || null,
    schema_version: row?.schema_version || null,
    tenant_id: row?.tenant_id || null,
    user_id: row?.user_id || null,
    operator_id: row?.operator_id || null,
    asset_id: row?.asset_id || null,
    client_asset_ref: row?.client_asset_ref || null,
    image_generation_id: snapshot.image_generation_id || row?.asset_id || null,
    expected_original_count: snapshot.expected_original_count || null,
    original_image_references: originalImageReferences
  });
}

function durableSessionOwnerMatches(actual, expected) {
  return JSON.stringify(durableSessionOwnerIdentity(actual))
    === JSON.stringify(durableSessionOwnerIdentity(expected));
}

async function readStoredRecognitionSession({ sessionId, tenantId, env, fetchImpl }) {
  return readSupabaseRows({
    table: CSM_RECOGNITION_SESSION_TABLE,
    select: "id,schema_version,tenant_id,user_id,operator_id,asset_id,stable_asset_id,client_asset_ref,asset_fingerprint,identity_snapshot",
    search: { id: `eq.${sessionId}`, tenant_id: `eq.${tenantId}`, limit: "2" },
    env,
    fetchImpl
  });
}

export function buildCsmRecognitionSessionRow({
  sessionId = createCsmSessionId(), payload = {}, routePlan = {},
  operatorId = "", tenantId = "", userId = ""
} = {}) {
  const createdAt = new Date().toISOString();
  const identity = buildDataIdentitySnapshot({ payload, tenantId, userId, operatorId });
  return compact({
    id: sessionId,
    schema_version: CSM_SESSION_SCHEMA_VERSION,
    status: "CREATED",
    asset_id: payload.asset_id || payload.assetId || null,
    stable_asset_id: identity.stable_asset_id,
    client_asset_ref: identity.client_asset_ref,
    asset_fingerprint: identity.asset_fingerprint,
    tenant_id: identity.tenant_id,
    user_id: identity.user_id,
    identity_snapshot: identity,
    route: routePlan.route || null,
    route_reason: routePlan.route_reason || null,
    route_plan: routePlan,
    request_summary: {
      image_count: Array.isArray(payload.images) ? payload.images.length : 0,
      provider: payload.provider || payload.vision_provider || payload.provider_id || null,
      mode: payload.mode || null,
      // COS-53 clause 4: a run states which asset the model read, per slot.
      //
      // This builder takes named keys off `payload` and drops everything else,
      // so passing `recognition_input` to `createCsmRecognitionSession` was not
      // enough -- the endpoint sent it, the row never carried it, and nothing
      // failed. Same shape as the three ordering defects fixed on 2026-08-07:
      // a value merged into an object that is not the one being persisted.
      ...(Array.isArray(payload.recognition_input) && payload.recognition_input.length
        ? { recognition_input: payload.recognition_input }
        : {})
    },
    operator_id: operatorId || null,
    created_at: createdAt,
    updated_at: createdAt
  });
}

export async function createCsmRecognitionSession({
  sessionId = createCsmSessionId(), payload = {}, routePlan = {},
  operatorId = "", tenantId = "", userId = "",
  reuseExistingSnapshot = false,
  env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const row = buildCsmRecognitionSessionRow({
    sessionId, payload, routePlan, operatorId, tenantId, userId
  });
  if (reuseExistingSnapshot === true) {
    const existing = await readStoredRecognitionSession({
      sessionId,
      tenantId: row.tenant_id,
      env,
      fetchImpl
    });
    if (!existing.ok) {
      return {
        sessionId,
        row,
        persistence: {
          recognition_session: {
            saved: false,
            row: null,
            reused_existing_snapshot: false,
            error: existing.error || "csm_recognition_session_snapshot_read_failed"
          }
        }
      };
    }
    if (existing.rows.length > 1) {
      return {
        sessionId,
        row,
        persistence: {
          recognition_session: {
            saved: false,
            row: null,
            reused_existing_snapshot: false,
            error: "csm_recognition_session_snapshot_ambiguous"
          }
        }
      };
    }
    if (existing.rows.length === 1) {
      const stored = existing.rows[0];
      const verified = durableSessionOwnerMatches(stored, row);
      return {
        sessionId,
        row: stored,
        persistence: {
          recognition_session: {
            saved: verified,
            row: stored,
            reused_existing_snapshot: verified,
            verified_after_write: false,
            error: verified ? null : "csm_recognition_session_existing_owner_conflict"
          }
        }
      };
    }
  }
  const result = await writeSupabaseRow({
    table: CSM_RECOGNITION_SESSION_TABLE,
    row,
    upsert: true,
    duplicateResolution: "ignore",
    env,
    fetchImpl
  });
  if (!result.saved) {
    return { sessionId, row, persistence: { recognition_session: result } };
  }

  // A normal insert returns the representation we just wrote. Verify that
  // immutable identity in-process and avoid a second Supabase round trip. An
  // ignore-duplicates upsert can return an empty representation; retain the
  // read-back path for that replay/conflict case.
  let persisted = null;
  let persistedRow = result.row || null;
  let verified = result.saved === true && sessionIdentityMatches(persistedRow, row);
  if (!verified) {
    persisted = await readStoredRecognitionSession({
      sessionId,
      tenantId: row.tenant_id,
      env,
      fetchImpl
    });
    persistedRow = persisted.rows?.[0] || null;
    verified = persisted.ok === true
      && persisted.rows.length === 1
      && (reuseExistingSnapshot === true
        ? durableSessionOwnerMatches(persistedRow, row)
        : sessionIdentityMatches(persistedRow, row));
  }
  return {
    sessionId,
    row: persistedRow || row,
    persistence: {
      recognition_session: {
        ...result,
        saved: verified,
        row: persistedRow,
        verified_after_write: verified,
        reused_existing_snapshot: verified && reuseExistingSnapshot === true
          && !sessionIdentityMatches(persistedRow, row),
        error: verified
          ? null
          : persisted?.error || "csm_recognition_session_post_write_identity_conflict"
      }
    }
  };
}
