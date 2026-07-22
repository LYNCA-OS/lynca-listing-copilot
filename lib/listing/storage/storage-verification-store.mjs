import {
  normalizeListingAssetId,
  requireTenantListingAsset
} from "../../tenant/assets.mjs";
import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";
import { cropRolesByRegion } from "../image-quality/crop-planner.mjs";
import { normalizeListingImageStorageRole } from "./supabase-image-storage.mjs";

const verificationTable = "listing_image_verifications";
const primaryRoleSlots = new Map([
  ["image_1_original", 0],
  ["front_original", 0],
  ["image_2_original", 1],
  ["back_original", 1]
]);
const canonicalCropRoles = new Set(Object.values(cropRolesByRegion));
const sha256Pattern = /^[0-9a-f]{64}$/;

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

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedImageId(value, field = "image_id") {
  const normalized = safeString(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized)) {
    throw new Error(`Invalid ${field} for listing image crop provenance.`);
  }
  return normalized;
}

function normalizedUnitBounds(value) {
  const input = plainObject(value);
  const bounds = Object.fromEntries(["x", "y", "width", "height"].map((field) => {
    const number = Number(input[field]);
    if (!Number.isFinite(number)) {
      throw new Error("Crop normalized_bounds must contain finite x, y, width, and height values.");
    }
    return [field, Math.round(number * 1_000_000) / 1_000_000];
  }));
  if (
    bounds.x < 0
    || bounds.y < 0
    || bounds.width <= 0
    || bounds.height <= 0
    || bounds.x >= 1
    || bounds.y >= 1
    || bounds.x + bounds.width > 1.000001
    || bounds.y + bounds.height > 1.000001
  ) {
    throw new Error("Crop normalized_bounds must stay inside the source image.");
  }
  return bounds;
}

function pixelBoundsForNormalizedCrop(bounds, width, height) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  const left = Math.max(0, Math.floor(bounds.x * sourceWidth));
  const top = Math.max(0, Math.floor(bounds.y * sourceHeight));
  return {
    left,
    top,
    width: Math.max(1, Math.min(sourceWidth - left, Math.ceil(bounds.width * sourceWidth))),
    height: Math.max(1, Math.min(sourceHeight - top, Math.ceil(bounds.height * sourceHeight)))
  };
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
    parts.length !== 6
    || parts[0] !== "tenants"
    || parts[1] !== normalizedTenantId
    || parts[2] !== "listing-assets"
    || !/^\d{4}-\d{2}-\d{2}$/.test(parts[3])
    || !parts[4]
    || !parts[5]
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
    && (!expected.imageId || safeString(row.image_id) === safeString(expected.imageId))
    && (!expected.role || safeString(row.storage_role) === safeString(expected.role))
    && (!expected.contentSha256 || safeString(row.content_sha256).toLowerCase() === safeString(expected.contentSha256).toLowerCase())
    && row.object_verified === true;
}

async function fetchWithDeadline(fetchImpl, url, init = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("verification_record_read_timeout")), Math.max(250, Number(timeoutMs) || 5000));
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function retryableReadStatus(status) {
  const normalized = Number(status);
  return normalized === 408 || normalized === 425 || normalized === 429 || normalized >= 500;
}

async function fetchReadWithDeadlineRetry(fetchImpl, url, init = {}, {
  timeoutMs = 8000,
  attempts = 2,
  baseDelayMs = 120
} = {}) {
  const maxAttempts = Math.max(1, Math.min(3, Number.parseInt(String(attempts || 2), 10) || 2));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithDeadline(fetchImpl, url, init, timeoutMs);
      if (!retryableReadStatus(response.status) || attempt >= maxAttempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, baseDelayMs * (2 ** (attempt - 1)))));
  }
  throw lastError || new Error("verification_record_read_failed");
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
  cropMetadata = null,
  canonicalEligible = false,
  imageGenerationId = null,
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
    image_generation_id: imageGenerationId ? safeString(imageGenerationId) : null,
    crop_metadata: cropMetadata && Object.keys(cropMetadata).length ? cropMetadata : null,
    canonical_eligible: canonicalEligible === true,
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

export async function canonicalListingCropMetadataForVerification({
  cropMetadata = null,
  tenantId,
  assetId,
  imageId,
  role,
  objectPath,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedRole = normalizeListingImageStorageRole(role);
  const normalizedAssetId = normalizeListingAssetId(assetId);
  const generationId = normalizedAssetId;
  const isPrimary = primaryRoleSlots.has(normalizedRole);
  const isCanonicalCrop = canonicalCropRoles.has(normalizedRole);
  if (isPrimary) {
    if (cropMetadata && Object.keys(plainObject(cropMetadata)).length) {
      throw new Error("Original listing images cannot carry crop provenance.");
    }
    return {
      crop_metadata: null,
      image_generation_id: generationId,
      canonical_role: true
    };
  }
  if (!isCanonicalCrop) {
    return {
      crop_metadata: null,
      image_generation_id: generationId,
      canonical_role: false
    };
  }

  const input = plainObject(cropMetadata);
  const sourceImageId = boundedImageId(input.source_image_id, "source_image_id");
  const derivedImageId = boundedImageId(imageId, "image_id");
  if (sourceImageId === derivedImageId) {
    throw new Error("Crop source_image_id must reference a different original image.");
  }
  const sourceRegion = safeString(input.source_region);
  if (cropRolesByRegion[sourceRegion] !== normalizedRole) {
    throw new Error("Crop source_region does not match the signed storage role.");
  }
  const normalizedBounds = normalizedUnitBounds(input.normalized_bounds);
  const transformVersion = safeString(input.transform_version || "field-crop-v1");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(transformVersion)) {
    throw new Error("Invalid crop transform_version.");
  }

  const { url, serviceRoleKey } = supabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${verificationTable}`);
  endpoint.searchParams.set("select", [
    "tenant_id",
    "asset_id",
    "image_id",
    "storage_role",
    "image_generation_id",
    "object_path",
    "content_sha256",
    "content_hash_verified",
    "object_verified",
    "canonical_eligible",
    "width",
    "height"
  ].join(","));
  endpoint.searchParams.set("tenant_id", `eq.${tenantIdFromRecordInput(tenantId, objectPath, normalizedAssetId)}`);
  endpoint.searchParams.set("asset_id", `eq.${normalizedAssetId}`);
  endpoint.searchParams.set("image_id", `eq.${sourceImageId}`);
  endpoint.searchParams.set("object_verified", "eq.true");
  endpoint.searchParams.set("canonical_eligible", "eq.true");
  endpoint.searchParams.set("limit", "2");
  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Crop source verification read failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const rows = await readResponseJson(response);
  const sources = (Array.isArray(rows) ? rows : []).filter((source) => (
    safeString(source.tenant_id) === safeString(tenantId)
      && safeString(source.asset_id) === normalizedAssetId
      && safeString(source.image_generation_id) === generationId
      && safeString(source.image_id) === sourceImageId
      && primaryRoleSlots.has(safeString(source.storage_role))
      && source.object_verified === true
      && source.canonical_eligible === true
  ));
  if (sources.length !== 1) {
    throw new Error(sources.length ? "Crop source verification is ambiguous." : "Crop source original is not durably verified.");
  }
  const source = sources[0];
  const sourceObjectPath = assertTenantListingAssetObjectPath({
    tenantId,
    assetId: normalizedAssetId,
    objectPath: source.object_path
  });
  const sourceWidth = Number(source.width);
  const sourceHeight = Number(source.height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error("Crop source dimensions are invalid.");
  }
  const sourceContentSha256 = safeString(source.content_sha256).toLowerCase();
  if (source.content_hash_verified !== true || !sha256Pattern.test(sourceContentSha256)) {
    throw new Error("Crop source content hash is not durably verified.");
  }
  const sourceSlot = primaryRoleSlots.get(safeString(source.storage_role));
  return {
    crop_metadata: {
      crop_id: derivedImageId,
      generation_id: generationId,
      asset_id: normalizedAssetId,
      source_image_id: sourceImageId,
      source_object_path: sourceObjectPath,
      source_content_sha256: sourceContentSha256,
      source_side: sourceSlot === 0 ? "front" : "back",
      source_width: sourceWidth,
      source_height: sourceHeight,
      source_region: sourceRegion,
      crop_role: normalizedRole,
      normalized_bounds: normalizedBounds,
      pixel_bounds: pixelBoundsForNormalizedCrop(normalizedBounds, sourceWidth, sourceHeight),
      derived_object_path: assertTenantListingAssetObjectPath({
        tenantId,
        assetId: normalizedAssetId,
        objectPath
      }),
      transform_version: transformVersion
    },
    image_generation_id: generationId,
    canonical_role: true
  };
}

export async function saveListingImageVerificationRecord({
  verification,
  tenantId = null,
  assetId = null,
  requireDurableAssetId = false,
  imageId = null,
  role = null,
  cropMetadata = null,
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
  const lineage = await canonicalListingCropMetadataForVerification({
    cropMetadata,
    tenantId: normalizedTenantId,
    assetId,
    imageId,
    role,
    objectPath: verification?.object_path,
    env,
    fetchImpl
  });
  const contentSha256 = safeString(verification?.content_sha256).toLowerCase();
  const contentVerified = verification?.object_verified === true
    && verification?.content_hash_verified === true
    && sha256Pattern.test(contentSha256)
    && verification?.dimension_source === "object_bytes";
  const row = listingImageVerificationRecordFromResult({
    verification,
    tenantId,
    assetId,
    imageId,
    role,
    cropMetadata: lineage.crop_metadata,
    canonicalEligible: lineage.canonical_role && contentVerified,
    imageGenerationId: lineage.image_generation_id,
    now
  });
  if (lineage.canonical_role && row.canonical_eligible !== true) {
    throw new Error("Listing image content is not fully verified for canonical recognition.");
  }

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
  imageId = null,
  role = null,
  objectPath,
  bucket,
  contentType,
  size,
  width,
  height,
  contentSha256 = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
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
    "image_id",
    "storage_role",
    "image_generation_id",
    "crop_metadata",
    "canonical_eligible",
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

  const response = await fetchReadWithDeadlineRetry(fetchImpl, endpoint, {
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "return=representation"
    })
  }, {
    timeoutMs: Math.max(250, Number(env.LISTING_VERIFICATION_READ_TIMEOUT_MS) || Number(timeoutMs) || 8000),
    attempts: env.LISTING_VERIFICATION_READ_ATTEMPTS || 2
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

  if (!metadataMatches(row, {
    tenantId,
    assetId,
    imageId,
    role,
    objectPath,
    bucket,
    contentType,
    size,
    width,
    height,
    contentSha256
  })) {
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
