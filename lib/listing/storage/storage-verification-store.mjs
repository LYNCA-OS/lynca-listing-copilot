import {
  normalizeListingAssetId,
  requireTenantListingAsset
} from "../../tenant/assets.mjs";
import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";

const verificationTable = "listing_image_verifications";

function isSupabaseConfigured(env = process.env) {
  return Boolean(String(env.SUPABASE_URL || "").trim() && env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase image verification storage is not configured.");
  }

  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey, extra = {}) {
  return supabaseServiceHeaders(serviceRoleKey, {
    "content-type": "application/json",
    ...extra
  });
}

function sanitizeObjectPath(objectPath) {
  const safePath = String(objectPath || "").trim();
  if (!safePath || safePath.includes("..") || safePath.startsWith("/")) {
    throw new Error("Invalid listing image object path.");
  }
  return safePath;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeString(value) {
  return String(value || "").trim();
}

function storageAssetSlug(assetId) {
  return normalizeListingAssetId(assetId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "asset";
}

export function assertTenantListingAssetObjectPath({
  tenantId,
  assetId = null,
  objectPath
} = {}) {
  const safePath = sanitizeObjectPath(objectPath);
  const normalizedTenantId = safeString(tenantId);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalizedTenantId)) {
    throw new Error("Invalid tenant for listing image verification record.");
  }
  const parts = safePath.split("/");
  if (
    parts.length !== 6 ||
    parts[0] !== "tenants" ||
    parts[1] !== normalizedTenantId ||
    parts[2] !== "listing-assets" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(parts[3]) ||
    !parts[4] ||
    !parts[5]
  ) {
    throw new Error("Listing image object path must belong to the signed tenant.");
  }
  if (assetId && parts[4] !== storageAssetSlug(assetId)) {
    throw new Error("Listing image object path does not match asset_id.");
  }
  return safePath;
}

function tenantIdFromRecordInput(tenantId, objectPath, assetId = null) {
  const explicit = safeString(tenantId);
  assertTenantListingAssetObjectPath({ tenantId: explicit, assetId, objectPath });
  return explicit;
}

function metadataMatches(row = {}, expected = {}) {
  return safeString(row.tenant_id) === tenantIdFromRecordInput(expected.tenantId, expected.objectPath, expected.assetId)
    && safeString(row.object_path) === sanitizeObjectPath(expected.objectPath)
    && (!expected.assetId || safeString(row.asset_id) === normalizeListingAssetId(expected.assetId))
    && safeString(row.bucket) === safeString(expected.bucket)
    && safeString(row.content_type).toLowerCase() === safeString(expected.contentType).toLowerCase()
    && numberOrNull(row.size) === Number(expected.size)
    && numberOrNull(row.width) === Number(expected.width)
    && numberOrNull(row.height) === Number(expected.height)
    && row.object_verified === true;
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

export function listingImageVerificationRecordFromResult({
  verification,
  tenantId = null,
  assetId = null,
  imageId = null,
  role = null,
  now = new Date()
} = {}) {
  const verifiedAt = verification?.verified_at || now.toISOString();

  return {
    tenant_id: tenantIdFromRecordInput(
      tenantId || verification?.tenant_id,
      verification?.object_path,
      assetId
    ),
    object_path: sanitizeObjectPath(verification?.object_path),
    bucket: safeString(verification?.bucket),
    asset_id: assetId ? safeString(assetId) : null,
    image_id: imageId ? safeString(imageId) : null,
    storage_role: role ? safeString(role) : null,
    content_type: safeString(verification?.content_type).toLowerCase(),
    size: Number(verification?.size),
    width: Number(verification?.width),
    height: Number(verification?.height),
    content_sha256: verification?.content_sha256 ? safeString(verification.content_sha256).toLowerCase() : null,
    object_verified: verification?.object_verified === true,
    content_hash_verified: verification?.content_hash_verified === true,
    dimension_source: verification?.dimension_source || null,
    verified_at: verifiedAt,
    updated_at: now.toISOString()
  };
}

export async function saveListingImageVerificationRecord({
  verification,
  tenantId = null,
  assetId = null,
  requireDurableAssetId = false,
  imageId = null,
  role = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  if (!isSupabaseConfigured(env)) {
    return {
      saved: false,
      durable: false,
      reason: "supabase_not_configured"
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      saved: false,
      durable: false,
      reason: "fetch_unavailable"
    };
  }

  const { url, serviceRoleKey } = supabaseConfig(env);
  const normalizedTenantId = tenantIdFromRecordInput(
    tenantId || verification?.tenant_id,
    verification?.object_path,
    assetId
  );
  if (assetId) {
    await requireTenantListingAsset({
      tenantId: normalizedTenantId,
      assetId,
      requireDurable: requireDurableAssetId,
      env,
      fetchImpl
    });
  }
  const endpoint = new URL(`${url}/rest/v1/${verificationTable}`);
  endpoint.searchParams.set("on_conflict", "tenant_id,object_path");
  const row = listingImageVerificationRecordFromResult({
    verification,
    tenantId,
    assetId,
    imageId,
    role,
    now
  });

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase image verification write failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await readResponseJson(response);
  return {
    saved: true,
    durable: true,
    record: Array.isArray(rows) ? rows[0] : rows
  };
}

export async function readListingImageVerificationRecord({
  tenantId,
  assetId = null,
  objectPath,
  bucket,
  contentType,
  size,
  width,
  height,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!isSupabaseConfigured(env)) {
    return {
      verified: false,
      durable: false,
      reason: "supabase_not_configured"
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      verified: false,
      durable: false,
      reason: "fetch_unavailable"
    };
  }

  const safePath = sanitizeObjectPath(objectPath);
  const { url, serviceRoleKey } = supabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${verificationTable}`);
  endpoint.searchParams.set("select", [
    "tenant_id",
    "object_path",
    "bucket",
    "asset_id",
    "content_type",
    "size",
    "width",
    "height",
    "content_sha256",
    "object_verified",
    "content_hash_verified",
    "dimension_source",
    "verified_at",
    "updated_at"
  ].join(","));
  endpoint.searchParams.set("tenant_id", `eq.${tenantIdFromRecordInput(tenantId, safePath, assetId)}`);
  endpoint.searchParams.set("object_path", `eq.${safePath}`);
  if (assetId) endpoint.searchParams.set("asset_id", `eq.${normalizeListingAssetId(assetId)}`);
  endpoint.searchParams.set("limit", "1");

  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "return=representation"
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase image verification read failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await readResponseJson(response);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return {
      verified: false,
      durable: true,
      reason: "verification_record_missing"
    };
  }

  if (!metadataMatches(row, { tenantId, assetId, objectPath, bucket, contentType, size, width, height })) {
    return {
      verified: false,
      durable: true,
      reason: "verification_record_mismatch"
    };
  }

  return {
    verified: true,
    durable: true,
    record: row
  };
}
