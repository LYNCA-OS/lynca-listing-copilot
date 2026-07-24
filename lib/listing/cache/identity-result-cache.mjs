import crypto from "node:crypto";
import { resolvedFieldsToLegacyFields } from "../evidence/provider-evidence-normalizer.mjs";
import { identityStatuses } from "../../identity-resolution/types.mjs";
import {
  buildIdentityCacheVersionVector,
  identityCacheContractVersion,
  identityCacheVersionMatches
} from "./identity-cache-version-contract.mjs";

export const identityResultCacheTable = "listing_identity_resolution_cache";
export const identityResultCacheSource = "internal_identity_result_cache";
export const identityResultCacheRoute = "IDENTITY_RESULT_CACHE";

const sha256HexPattern = /^[0-9a-f]{64}$/;
const defaultCacheTtlDays = 30;
const maxCacheTtlDays = 365;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSha256(value) {
  const normalized = normalizeText(value).toLowerCase();
  return sha256HexPattern.test(normalized) ? normalized : "";
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  if (/front/.test(role)) return "front";
  if (/back/.test(role)) return "back";
  return role || "primary";
}

function tenantIdForPayload(payload = {}) {
  return normalizeText(payload.tenant_id || payload.tenantId);
}

function isPrimaryImage(image = {}) {
  const role = image.storageRole || image.storage_role || image.role || "";
  if (image.derived || image.sourceRegion || image.source_region) return false;
  const normalized = normalizeRole(role);
  return ["front", "back", "primary"].includes(normalized);
}

function primaryImages(payload = {}) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const primary = images.filter(isPrimaryImage);
  return primary.length ? primary : images.slice(0, 2);
}

function contentShaForImage(image = {}) {
  return normalizeSha256(image.contentSha256 || image.content_sha256 || image.sha256 || image.content_hash);
}

function objectPathForImage(image = {}) {
  return normalizeText(image.objectPath || image.object_path || image.storagePath || image.storage_path);
}

function storageVerified(image = {}) {
  return image.storageVerified === true || image.storage_verified === true;
}

function hasValue(value, field = "") {
  if (field === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function subjectPresent(resolved = {}) {
  return hasValue(resolved.players, "players") || hasValue(resolved.player, "player") || hasValue(resolved.character, "character");
}

function jsonContainer(value, fallback) {
  return value && typeof value === "object" ? value : fallback;
}

function supabaseConfigured(env = process.env) {
  return Boolean(normalizeText(env.SUPABASE_URL) && env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseConfig(env = process.env) {
  const url = normalizeText(env.SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase identity result cache is not configured.");
  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cacheTtlDays(env = process.env) {
  const value = Number(env.LISTING_IDENTITY_CACHE_TTL_DAYS);
  if (!Number.isFinite(value) || value <= 0) return defaultCacheTtlDays;
  return Math.min(maxCacheTtlDays, Math.max(1, Math.round(value)));
}

function expiresAtIso({ now = new Date(), env = process.env } = {}) {
  return new Date(now.getTime() + cacheTtlDays(env) * 24 * 60 * 60 * 1000).toISOString();
}

export function identityResultCacheReadEnabled(env = process.env) {
  return truthy(env.LISTING_IDENTITY_CACHE_ENABLED) || truthy(env.LISTING_IDENTITY_CACHE_READ_ENABLED);
}

export function identityResultCacheWriteEnabled(env = process.env) {
  return truthy(env.LISTING_IDENTITY_CACHE_ENABLED) || truthy(env.LISTING_IDENTITY_CACHE_WRITE_ENABLED);
}

export function identityResultCacheWriteResolvedEnabled(env = process.env) {
  return truthy(env.LISTING_IDENTITY_CACHE_WRITE_RESOLVED);
}

export function buildIdentityResultCacheKey(payload = {}, env = process.env) {
  const images = primaryImages(payload);
  if (!images.length) return { ok: false, reason: "primary_images_missing", cache_key: "" };

  const fingerprints = images.map((image, index) => ({
    index,
    role: normalizeRole(image.storageRole || image.storage_role || image.role),
    object_path: objectPathForImage(image) || null,
    content_sha256: contentShaForImage(image),
    storage_verified: storageVerified(image)
  }));

  if (fingerprints.some((item) => !item.content_sha256)) {
    return { ok: false, reason: "content_hash_required", cache_key: "", image_fingerprints: fingerprints };
  }
  if (fingerprints.some((item) => item.storage_verified !== true)) {
    return { ok: false, reason: "verified_storage_required", cache_key: "", image_fingerprints: fingerprints };
  }

  const normalized = fingerprints
    .map((item) => ({
      role: item.role,
      content_sha256: item.content_sha256
    }))
    .sort((left, right) => `${left.role}:${left.content_sha256}`.localeCompare(`${right.role}:${right.content_sha256}`));
  const imageGenerationHash = crypto.createHash("sha256")
    .update(JSON.stringify({ images: normalized }))
    .digest("hex");
  const tenantId = tenantIdForPayload(payload);
  if (!tenantId) return { ok: false, reason: "tenant_id_missing", cache_key: "" };
  const resultVersion = buildIdentityCacheVersionVector(payload, env);
  const cacheKey = crypto.createHash("sha256")
    .update(JSON.stringify({
      version: identityCacheContractVersion,
      tenant_id: tenantId,
      image_generation_hash: imageGenerationHash,
      version_fingerprint: resultVersion.fingerprint
    }))
    .digest("hex");

  return {
    ok: true,
    cache_key: cacheKey,
    tenant_id: tenantId,
    image_generation_hash: imageGenerationHash,
    version_fingerprint: resultVersion.fingerprint,
    result_version: resultVersion.vector,
    image_fingerprints: fingerprints,
    image_count: fingerprints.length
  };
}

export function isCacheableIdentityResult(result = {}, {
  env = process.env
} = {}) {
  const status = result.identity_resolution_status;
  const resolved = result.resolved || {};

  if (status === identityStatuses.RESOLVED && !identityResultCacheWriteResolvedEnabled(env)) {
    return { ok: false, reason: "resolved_cache_write_disabled" };
  }
  if (![identityStatuses.CONFIRMED, identityStatuses.RESOLVED, identityStatuses.ABSTAIN].includes(status)) {
    return { ok: false, reason: "identity_status_not_cacheable" };
  }
  if (!normalizeText(result.final_title || result.title)) return { ok: false, reason: "final_title_required" };
  if (result.technical_failure === true || result.provider_error_type || result.provider_error_code) {
    return { ok: false, reason: "technical_failure_not_cacheable" };
  }
  if (normalizeText(result.assisted_draft_status).toUpperCase() === "FAILED") {
    return { ok: false, reason: "failed_draft_not_cacheable" };
  }
  if (status === identityStatuses.ABSTAIN) {
    return { ok: true, reason: "cacheable_terminal_l2_draft" };
  }
  if (!hasValue(resolved.year, "year")) return { ok: false, reason: "year_required" };
  if (!hasValue(resolved.product, "product")) return { ok: false, reason: "product_required" };
  if (!subjectPresent(resolved)) return { ok: false, reason: "subject_required" };
  if (result.ambiguity_status === "AMBIGUOUS") return { ok: false, reason: "ambiguity_status_ambiguous" };
  if (Array.isArray(result.unresolved)
    && result.unresolved.some((item) => /identity resolution abstain/i.test(String(item)))) {
    return { ok: false, reason: "unresolved_identity_abstain" };
  }

  return { ok: true, reason: "cacheable_identity_result" };
}

export function identityResultToCacheRow({
  result = {},
  payload = {},
  cacheKey = null,
  imageFingerprints = null,
  env = process.env,
  now = new Date()
} = {}) {
  const builtKey = buildIdentityResultCacheKey(payload, env);
  const key = cacheKey
    ? {
      ...builtKey,
      ok: builtKey.ok,
      cache_key: cacheKey,
      image_fingerprints: imageFingerprints || builtKey.image_fingerprints || []
    }
    : builtKey;
  if (!key.ok) return { ok: false, reason: key.reason };

  const cacheable = isCacheableIdentityResult(result, { env });
  if (!cacheable.ok) return { ok: false, reason: cacheable.reason, cache_key: key.cache_key };

  const resolved = result.resolved || {};
  const finalTitle = normalizeText(result.final_title || result.title);
  return {
    ok: true,
    reason: cacheable.reason,
    row: {
      cache_key: key.cache_key,
      tenant_id: key.tenant_id,
      image_generation_hash: key.image_generation_hash,
      version_fingerprint: key.version_fingerprint,
      result_version: key.result_version,
      image_fingerprints: key.image_fingerprints,
      image_count: key.image_count || key.image_fingerprints.length,
      identity_status: result.identity_resolution_status,
      ambiguity_status: result.ambiguity_status || null,
      final_title: finalTitle,
      resolved_fields: resolved,
      legacy_fields: result.fields || resolvedFieldsToLegacyFields(resolved),
      evidence_snapshot: result.evidence || {},
      identity_resolution: result.identity_resolution || null,
      field_states: jsonContainer(result.field_states, []),
      conflict_map: result.conflict_map || [],
      resolution_trace: result.resolution_trace || result.identity_resolution?.resolution_trace || [],
      confidence_report: result.confidence_report || null,
      source_provider: result.provider || result.source || null,
      cache_status: "active",
      expires_at: expiresAtIso({ now, env }),
      updated_at: now.toISOString()
    }
  };
}

export async function readIdentityResultCacheRecord({
  cacheKey,
  tenantId = null,
  imageGenerationHash = null,
  expectedVersion = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!identityResultCacheReadEnabled(env)) return { hit: false, reason: "identity_cache_read_disabled" };
  if (!supabaseConfigured(env)) return { hit: false, reason: "supabase_not_configured" };
  if (typeof fetchImpl !== "function") return { hit: false, reason: "fetch_unavailable" };
  if (!normalizeSha256(cacheKey)) return { hit: false, reason: "cache_key_invalid" };

  const { url, serviceRoleKey } = supabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${identityResultCacheTable}`);
  endpoint.searchParams.set("select", [
    "cache_key",
    "tenant_id",
    "image_generation_hash",
    "version_fingerprint",
    "result_version",
    "image_fingerprints",
    "image_count",
    "identity_status",
    "ambiguity_status",
    "final_title",
    "resolved_fields",
    "legacy_fields",
    "evidence_snapshot",
    "identity_resolution",
    "field_states",
    "conflict_map",
    "resolution_trace",
    "confidence_report",
    "source_provider",
    "cache_status",
    "expires_at",
    "created_at",
    "updated_at"
  ].join(","));
  endpoint.searchParams.set("cache_key", `eq.${cacheKey}`);
  endpoint.searchParams.set("cache_status", "eq.active");
  endpoint.searchParams.set("expires_at", `gt.${new Date().toISOString()}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "return=representation"
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase identity result cache read failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await readResponseJson(response);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row) {
    const versionMatch = expectedVersion
      ? identityCacheVersionMatches(row, expectedVersion)
      : true;
    if (!versionMatch) {
      return {
        hit: false,
        reason: "cached_result_version_mismatch",
        cached_result_version_match: false,
        record: row
      };
    }
    return {
      hit: true,
      reason: "identity_cache_hit",
      cached_result_version_match: true,
      record: row
    };
  }

  const normalizedTenant = normalizeText(tenantId);
  const normalizedGenerationHash = normalizeSha256(imageGenerationHash);
  if (!normalizedTenant || !normalizedGenerationHash) {
    return { hit: false, reason: "identity_cache_miss", cached_result_version_match: null };
  }

  const mismatchEndpoint = new URL(`${url}/rest/v1/${identityResultCacheTable}`);
  mismatchEndpoint.searchParams.set("select", "cache_key,version_fingerprint,result_version,updated_at");
  mismatchEndpoint.searchParams.set("tenant_id", `eq.${normalizedTenant}`);
  mismatchEndpoint.searchParams.set("image_generation_hash", `eq.${normalizedGenerationHash}`);
  mismatchEndpoint.searchParams.set("cache_status", "eq.active");
  mismatchEndpoint.searchParams.set("expires_at", `gt.${new Date().toISOString()}`);
  mismatchEndpoint.searchParams.set("order", "updated_at.desc");
  mismatchEndpoint.searchParams.set("limit", "1");
  const mismatchResponse = await fetchImpl(mismatchEndpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (!mismatchResponse.ok) {
    const message = await mismatchResponse.text();
    throw new Error(`Supabase identity result cache version probe failed: ${mismatchResponse.status} ${message.slice(0, 180)}`);
  }
  const mismatchRows = await readResponseJson(mismatchResponse);
  const staleRecord = Array.isArray(mismatchRows) ? mismatchRows[0] : null;
  if (staleRecord) {
    return {
      hit: false,
      reason: "cached_result_version_mismatch",
      cached_result_version_match: false,
      record: staleRecord
    };
  }
  return { hit: false, reason: "identity_cache_miss", cached_result_version_match: null };
}

export async function saveIdentityResultCacheRecord({
  result,
  payload,
  cacheKey = null,
  imageFingerprints = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  if (!identityResultCacheWriteEnabled(env)) return { saved: false, reason: "identity_cache_write_disabled" };
  if (!supabaseConfigured(env)) return { saved: false, reason: "supabase_not_configured" };
  if (typeof fetchImpl !== "function") return { saved: false, reason: "fetch_unavailable" };

  const built = identityResultToCacheRow({
    result,
    payload,
    cacheKey,
    imageFingerprints,
    env,
    now
  });
  if (!built.ok) return { saved: false, reason: built.reason, cache_key: built.cache_key || cacheKey || null };

  const { url, serviceRoleKey } = supabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${identityResultCacheTable}`);
  endpoint.searchParams.set("on_conflict", "cache_key");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(built.row)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase identity result cache write failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await readResponseJson(response);
  return {
    saved: true,
    reason: built.reason,
    cache_key: built.row.cache_key,
    record: Array.isArray(rows) ? rows[0] : rows
  };
}

export function identityResultCacheRecordToListingResult({
  record = {},
  payload = {},
  expectedVersion = null,
  latencyMs = 0
} = {}) {
  const resolved = record.resolved_fields && typeof record.resolved_fields === "object" ? record.resolved_fields : {};
  const title = normalizeText(record.final_title);
  const cachedTrace = Array.isArray(record.resolution_trace) ? record.resolution_trace : [];
  const cachedResultVersionMatch = expectedVersion
    ? identityCacheVersionMatches(record, expectedVersion)
    : Boolean(record.version_fingerprint);
  return {
    title,
    final_title: title,
    rendered_title: title,
    title_render_source: "identity_result_cache",
    confidence: record.identity_status === identityStatuses.CONFIRMED ? "HIGH" : "MEDIUM",
    reason: "Exact verified image content hash matched a cached evidence-grounded identity result.",
    fields: record.legacy_fields && typeof record.legacy_fields === "object" ? record.legacy_fields : resolvedFieldsToLegacyFields(resolved),
    resolved,
    evidence: record.evidence_snapshot && typeof record.evidence_snapshot === "object" ? record.evidence_snapshot : {},
    identity_resolution_status: record.identity_status || identityStatuses.RESOLVED,
    ambiguity_status: record.ambiguity_status || "RESOLVED",
    identity_resolution: record.identity_resolution || null,
    field_states: jsonContainer(record.field_states, []),
    conflict_map: Array.isArray(record.conflict_map) ? record.conflict_map : [],
    confidence_report: record.confidence_report || null,
    unresolved: [],
    source: identityResultCacheSource,
    provider: identityResultCacheSource,
    route: identityResultCacheRoute,
    route_reason: "Exact verified image content hash matched cached identity; skipped recognition and vision providers.",
    asset_id: payload.assetId || payload.asset_id || null,
    analysis_run_id: payload.analysisRunId || payload.analysis_run_id || `analysis_identity_cache_${record.cache_key || "hit"}`,
    capture_profile_id: payload.captureProfileId || payload.capture_profile_id || null,
    capture_quality: payload.captureQuality || payload.capture_quality || {},
    identity_cache: {
      cache_hit: true,
      miss_reason: null,
      provider_call_skipped: true,
      cached_result_version_match: cachedResultVersionMatch,
      source: "identity_result_cache",
      cache_key: record.cache_key || null,
      tenant_id: record.tenant_id || null,
      image_generation_hash: record.image_generation_hash || null,
      version_fingerprint: record.version_fingerprint || null,
      result_version: record.result_version || null,
      identity_status: record.identity_status || null,
      source_provider: record.source_provider || null,
      expires_at: record.expires_at || null,
      image_count: record.image_count || null
    },
    usage: {
      provider_calls: 0,
      recognition_worker_calls: 0,
      retrieval_calls: 0,
      latency_ms: Math.max(0, Math.round(Number(latencyMs) || 0)),
      estimated_cost_usd: 0,
      resolution_rounds: 0
    },
    resolution_trace: [
      {
        phase: "identity_result_cache",
        step: "verified_content_hash_cache_hit",
        input: {
          cache_key: record.cache_key || null
        },
        output: {
          cache_hit: true,
          provider_call_skipped: true,
          cached_result_version_match: cachedResultVersionMatch,
          identity_status: record.identity_status || null,
          source_provider: record.source_provider || null
        },
        decision: "reuse_cached_identity_result",
        created_at: new Date().toISOString()
      },
      ...cachedTrace
    ]
  };
}
