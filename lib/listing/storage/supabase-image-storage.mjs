import crypto from "node:crypto";
import { listingImageStorageReadiness } from "./storage-config.mjs";

const storageApiPrefix = "/storage/v1";
const defaultVerificationTokenTtlSeconds = 2 * 60 * 60;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const extensionByMime = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif"
};

const allowedRoles = new Set([
  "image_1_original",
  "image_2_original",
  "front_original",
  "back_original",
  "front_alternate",
  "back_alternate",
  "serial_crop",
  "subject_crop",
  "card_code_crop",
  "grade_label_crop",
  "year_product_crop",
  "card_type_crop",
  "autograph_crop",
  "patch_relic_crop",
  "parallel_crop",
  "readability_derived",
  "surface_view"
]);

const maxSignatureHexLength = 128;
const objectVerificationPrefixBytes = 64 * 1024;
const sha256HexPattern = /^[0-9a-f]{64}$/;
const heifFamilyBrands = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heis",
  "heim",
  "hevm",
  "hevs",
  "heif",
  "mif1",
  "msf1"
]);

function storageHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  };
}

function storageObjectHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    ...extra
  };
}

function safeSlug(value, fallback = "asset") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || fallback;
}

function extensionForUpload({ fileName = "", contentType = "" } = {}) {
  const mimeExtension = extensionByMime[String(contentType || "").toLowerCase()];
  if (mimeExtension) return mimeExtension;

  const extension = String(fileName || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }

  return "jpg";
}

function encodedObjectPath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeStorageUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

async function readJsonResponse(response, providerLabel) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${providerLabel} returned a non-JSON response.`);
  }
}

function assertStorageConfigured(config) {
  if (!config.configured) {
    throw new Error(`Listing image storage is not configured: ${config.missing.join(", ")}`);
  }
}

function storageVerificationSecret(env = process.env) {
  return env.LISTING_IMAGE_VERIFICATION_SECRET
    || env.METAVERSE_AUTH_SECRET
    || env.SUPABASE_SERVICE_ROLE_KEY
    || "";
}

function storageVerificationTtlSeconds(env = process.env) {
  const value = Number(env.LISTING_IMAGE_VERIFICATION_TOKEN_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : defaultVerificationTokenTtlSeconds;
}

function signVerificationPayload(payload, secret) {
  return crypto.createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeVerificationDescriptor({
  tenantId,
  objectPath,
  bucket,
  contentType,
  size,
  width,
  height
} = {}) {
  const safePath = safeStorageObjectPath(objectPath);
  const pathTenantId = tenantIdFromListingImageObjectPath(safePath);
  const normalizedTenantId = tenantId ? safeTenantStorageId(tenantId) : pathTenantId;
  if (normalizedTenantId && pathTenantId && normalizedTenantId !== pathTenantId) {
    throw new Error("Listing image object path belongs to a different tenant.");
  }
  return {
    tenant_id: normalizedTenantId,
    object_path: safePath,
    bucket: String(bucket || "").trim(),
    content_type: String(contentType || "").toLowerCase(),
    size: Number(size),
    width: Number(width),
    height: Number(height)
  };
}

function descriptorMatches(left, right) {
  return left.tenant_id === right.tenant_id
    && left.object_path === right.object_path
    && left.bucket === right.bucket
    && left.content_type === right.content_type
    && left.size === right.size
    && left.width === right.width
    && left.height === right.height;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => Number(byte).toString(16).padStart(2, "0"))
    .join("");
}

function normalizeSignatureHex({ signatureHex, signatureBytes, fileSignature } = {}) {
  const candidate = signatureHex ?? fileSignature;

  if (Array.isArray(signatureBytes)) {
    if (signatureBytes.length === 0) return "";
    if (!signatureBytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error("Invalid image file signature.");
    }
    return bytesToHex(signatureBytes).slice(0, maxSignatureHexLength);
  }

  if (ArrayBuffer.isView(signatureBytes)) {
    return bytesToHex(signatureBytes).slice(0, maxSignatureHexLength);
  }

  if (Array.isArray(candidate)) {
    if (candidate.length === 0) return "";
    if (!candidate.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error("Invalid image file signature.");
    }
    return bytesToHex(candidate).slice(0, maxSignatureHexLength);
  }

  if (typeof candidate !== "string") return "";

  const normalized = candidate.trim().toLowerCase().replace(/[\s:_-]+/g, "");
  if (!normalized) return "";
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Invalid image file signature.");
  }

  return normalized.slice(0, maxSignatureHexLength);
}

function normalizeSha256Hex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (!sha256HexPattern.test(normalized)) {
    throw new Error("Invalid image SHA-256 hash.");
  }
  return normalized;
}

function heifSignatureMatches(signatureHex) {
  const bytes = Buffer.from(signatureHex, "hex");
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;

  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    const brand = bytes.toString("ascii", offset, offset + 4);
    if (heifFamilyBrands.has(brand)) return true;
  }

  return false;
}

function signatureMatchesMime(contentType, signatureHex) {
  if (contentType === "image/jpeg") {
    return signatureHex.startsWith("ffd8ff");
  }

  if (contentType === "image/png") {
    return signatureHex.startsWith("89504e470d0a1a0a");
  }

  if (contentType === "image/webp") {
    return signatureHex.length >= 24 && signatureHex.startsWith("52494646") && signatureHex.slice(16, 24) === "57454250";
  }

  if (contentType === "image/heic" || contentType === "image/heif") {
    return heifSignatureMatches(signatureHex);
  }

  return false;
}

function safeStorageObjectPath(objectPath) {
  const safePath = String(objectPath || "").trim();
  if (!safePath || safePath.includes("..") || safePath.startsWith("/")) {
    throw new Error("Invalid listing image object path.");
  }
  return safePath;
}

function safeTenantStorageId(tenantId) {
  const normalized = String(tenantId || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error("Invalid tenant id for listing image storage.");
  }
  return normalized;
}

export function tenantIdFromListingImageObjectPath(objectPath) {
  const safePath = safeStorageObjectPath(objectPath);
  const match = safePath.match(/^tenants\/([a-zA-Z0-9_-]{1,128})\//);
  return match?.[1] || null;
}

export function assertTenantListingImageObjectPath(objectPath, tenantId) {
  const safePath = safeStorageObjectPath(objectPath);
  const normalizedTenantId = safeTenantStorageId(tenantId);
  const pathTenantId = tenantIdFromListingImageObjectPath(safePath);
  // Compatibility objects predate tenant prefixes and are reachable only from
  // the bounded legacy tenant. Every commercial tenant must use its exact
  // tenants/{tenant_id}/ prefix.
  if (normalizedTenantId === "tenant_legacy" && pathTenantId === null) return safePath;
  if (pathTenantId !== normalizedTenantId) {
    throw new Error("Listing image object path belongs to a different tenant.");
  }
  return safePath;
}

function safeStorageBucket(bucket, fallback) {
  const candidate = String(bucket || fallback || "").trim();
  if (!candidate || candidate.includes("/") || candidate.includes("..") || !/^[a-zA-Z0-9._-]+$/.test(candidate)) {
    throw new Error("Invalid listing image storage bucket.");
  }
  return candidate;
}

function normalizeImageDimension(value, label) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error(`Image ${label} is required.`);
  }

  const roundedValue = Math.round(numericValue);
  if (roundedValue <= 0) {
    throw new Error(`Image ${label} is required.`);
  }

  return roundedValue;
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function parsePngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    bytesToHex(bytes.slice(0, 8)) !== "89504e470d0a1a0a" ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function parseJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }

    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;

    if (sofMarkers.has(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function parseWebpDimensions(bytes) {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = bytes.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27)
    };
  }

  if (chunkType === "VP8 " && bytes.length >= 30 && bytesToHex(bytes.slice(23, 26)) === "9d012a") {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }

  return null;
}

function parseImageDimensionsFromBytes(bytes, contentType) {
  if (contentType === "image/png") return parsePngDimensions(bytes);
  if (contentType === "image/jpeg") return parseJpegDimensions(bytes);
  if (contentType === "image/webp") return parseWebpDimensions(bytes);
  return null;
}

function parseObjectContentLength(response) {
  const contentRange = headerValue(response.headers, "content-range");
  const contentRangeMatch = String(contentRange || "").match(/\/(\d+)$/);
  if (contentRangeMatch) return Number(contentRangeMatch[1]);

  const contentLength = Number(headerValue(response.headers, "content-length"));
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
}

export function validateListingImageUpload({
  contentType,
  size,
  width,
  height,
  signatureHex,
  signatureBytes,
  fileSignature
}) {
  const normalizedType = String(contentType || "").toLowerCase();

  if (!allowedMimeTypes.has(normalizedType)) {
    throw new Error("Unsupported image MIME type.");
  }

  const numericSize = Number(size);
  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    throw new Error("Image size is required.");
  }

  const normalizedWidth = normalizeImageDimension(width, "width");
  const normalizedHeight = normalizeImageDimension(height, "height");

  const normalizedSignatureHex = normalizeSignatureHex({ signatureHex, signatureBytes, fileSignature });
  if (!normalizedSignatureHex) {
    throw new Error("Image file signature is required.");
  }

  if (!signatureMatchesMime(normalizedType, normalizedSignatureHex)) {
    throw new Error("Image file signature does not match MIME type.");
  }

  return {
    content_type: normalizedType,
    size: numericSize,
    width: normalizedWidth,
    height: normalizedHeight,
    signature_validated: true
  };
}

export function createListingImageVerificationToken({
  tenantId,
  objectPath,
  bucket,
  contentType,
  size,
  width,
  height,
  env = process.env,
  now = new Date()
} = {}) {
  const secret = storageVerificationSecret(env);
  if (!secret) {
    throw new Error("Listing image verification token secret is not configured.");
  }

  const descriptor = normalizeVerificationDescriptor({
    tenantId,
    objectPath,
    bucket,
    contentType,
    size,
    width,
    height
  });
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    ...descriptor,
    verified_at: now.toISOString()
  })).toString("base64url");
  const signature = signVerificationPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyListingImageVerificationToken({
  token,
  tenantId,
  objectPath,
  bucket,
  contentType,
  size,
  width,
  height,
  env = process.env,
  now = new Date()
} = {}) {
  const secret = storageVerificationSecret(env);
  if (!secret) {
    throw new Error("Listing image verification token secret is not configured.");
  }

  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) {
    throw new Error("Listing image verification token is required.");
  }

  const expectedSignature = signVerificationPayload(payload, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    throw new Error("Listing image verification token is invalid.");
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Listing image verification token is invalid.");
  }

  const expectedDescriptor = normalizeVerificationDescriptor({
    tenantId,
    objectPath,
    bucket,
    contentType,
    size,
    width,
    height
  });
  const actualDescriptor = normalizeVerificationDescriptor({
    tenantId: parsed.tenant_id,
    objectPath: parsed.object_path,
    bucket: parsed.bucket,
    contentType: parsed.content_type,
    size: parsed.size,
    width: parsed.width,
    height: parsed.height
  });
  if (!descriptorMatches(actualDescriptor, expectedDescriptor)) {
    throw new Error("Listing image verification token does not match image metadata.");
  }

  const verifiedAt = Date.parse(parsed.verified_at);
  if (!Number.isFinite(verifiedAt)) {
    throw new Error("Listing image verification token is invalid.");
  }

  const ageSeconds = (now.getTime() - verifiedAt) / 1000;
  if (ageSeconds < -60 || ageSeconds > storageVerificationTtlSeconds(env)) {
    throw new Error("Listing image verification token has expired.");
  }

  return {
    ...actualDescriptor,
    verified_at: parsed.verified_at
  };
}

export function buildListingImageObjectPath({
  tenantId,
  assetId,
  imageId,
  role = "front_original",
  fileName = "",
  contentType = "",
  now = new Date()
} = {}) {
  const tenantSlug = safeTenantStorageId(tenantId);
  const safeRole = allowedRoles.has(role) ? role : "front_original";
  const date = now.toISOString().slice(0, 10);
  const assetSlug = safeSlug(assetId, "asset");
  const imageSlug = safeSlug(imageId || crypto.randomUUID(), "image");
  const extension = extensionForUpload({ fileName, contentType });

  return `tenants/${tenantSlug}/listing-assets/${date}/${assetSlug}/${safeRole}-${imageSlug}.${extension}`;
}

export async function createListingImageSignedUpload({
  tenantId,
  assetId,
  imageId,
  role,
  fileName,
  contentType,
  size,
  width,
  height,
  signatureHex,
  signatureBytes,
  fileSignature,
  contentSha256,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
}) {
  const config = listingImageStorageReadiness(env);
  assertStorageConfigured(config);
  const upload = validateListingImageUpload({
    contentType,
    size,
    width,
    height,
    signatureHex,
    signatureBytes,
    fileSignature
  });
  const normalizedContentSha256 = normalizeSha256Hex(contentSha256);

  if (upload.size > config.max_upload_bytes) {
    throw new Error(`Image exceeds max upload size of ${config.max_upload_bytes} bytes.`);
  }

  if (Math.max(upload.width, upload.height) > config.max_image_dimension_pixels) {
    throw new Error(`Image exceeds max dimension of ${config.max_image_dimension_pixels} pixels.`);
  }

  if (upload.width * upload.height > config.max_image_total_pixels) {
    throw new Error(`Image exceeds max pixel area of ${config.max_image_total_pixels} pixels.`);
  }

  const objectPath = buildListingImageObjectPath({
    tenantId,
    assetId,
    imageId,
    role,
    fileName,
    contentType: upload.content_type,
    now
  });
  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/upload/sign/${encodeURIComponent(config.bucket)}/${encodedObjectPath(objectPath)}`;

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: storageHeaders(config.service_role_key),
    body: JSON.stringify({ upsert: false })
  });

  const payload = await readJsonResponse(response, "Supabase Storage");
  if (!response.ok) {
    throw new Error(`Supabase signed upload URL failed: ${response.status} ${String(payload.message || payload.error || "").slice(0, 180)}`);
  }

  const signedPath = payload.url || payload.signedURL || payload.signedUrl;
  if (!signedPath) {
    throw new Error("Supabase signed upload URL response did not include a signed URL.");
  }

  return {
    tenant_id: safeTenantStorageId(tenantId),
    object_path: objectPath,
    bucket: config.bucket,
    content_type: upload.content_type,
    size: upload.size,
    width: upload.width,
    height: upload.height,
    content_sha256: normalizedContentSha256 || null,
    signature_validated: upload.signature_validated,
    signed_upload_url: signedPath.startsWith("http") ? signedPath : `${storageUrl}${signedPath}`,
    expires_in_seconds: 7200
  };
}

// Storage HTTP calls had no timeout at all: one hung upstream socket kept a
// verification or signed-URL request pinned for the caller's entire request
// timeout (observed as intermittent 45s client hangs). Bound each operation
// and retry once — a ranged 32KB read or URL signing normally completes in
// well under a second, so a slow attempt is a dead socket, not real work.
const storageOperationTimeoutMs = 8000;

async function timedStorageOperation(operation, {
  timeoutMs = storageOperationTimeoutMs,
  retries = 1,
  label = "storage request"
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Supabase ${label} failed after retries: ${String(lastError?.message || lastError || "aborted").slice(0, 160)}`);
}

export async function createListingImageSignedReadUrl({
  objectPath,
  tenantId = null,
  bucket = "",
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const config = listingImageStorageReadiness(env);
  assertStorageConfigured(config);

  const safePath = tenantId
    ? assertTenantListingImageObjectPath(objectPath, tenantId)
    : safeStorageObjectPath(objectPath);
  const safeBucket = safeStorageBucket(bucket, config.bucket);

  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/sign/${encodeURIComponent(safeBucket)}/${encodedObjectPath(safePath)}`;
  const { response, payload } = await timedStorageOperation(async (signal) => {
    const signResponse = await fetchImpl(endpoint, {
      method: "POST",
      headers: storageHeaders(config.service_role_key),
      body: JSON.stringify({ expiresIn: config.signed_url_ttl_seconds }),
      signal
    });
    return { response: signResponse, payload: await readJsonResponse(signResponse, "Supabase Storage") };
  }, { label: "signed read URL" });
  if (!response.ok) {
    throw new Error(`Supabase signed read URL failed: ${response.status} ${String(payload.message || payload.error || "").slice(0, 180)}`);
  }

  const signedPath = payload.signedURL || payload.signedUrl || payload.signedUrlPath;
  if (!signedPath) {
    throw new Error("Supabase signed read URL response did not include a signed URL.");
  }

  return signedPath.startsWith("http") ? signedPath : `${storageUrl}${signedPath}`;
}

export async function verifyExistingListingImageObject({
  objectPath,
  tenantId = null,
  bucket = "",
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const config = listingImageStorageReadiness(env);
  assertStorageConfigured(config);

  const safePath = tenantId
    ? assertTenantListingImageObjectPath(objectPath, tenantId)
    : safeStorageObjectPath(objectPath);
  const safeBucket = safeStorageBucket(bucket, config.bucket);
  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/${encodeURIComponent(safeBucket)}/${encodedObjectPath(safePath)}`;
  const { contentType, size, bytes } = await timedStorageOperation(async (signal) => {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: storageObjectHeaders(config.service_role_key, {
        range: `bytes=0-${objectVerificationPrefixBytes - 1}`
      }),
      signal
    });
    if (!response.ok) {
      throw new Error(`Supabase existing image verification failed: ${response.status}`);
    }
    return {
      contentType: String(headerValue(response.headers, "content-type") || "").split(";")[0].toLowerCase(),
      size: parseObjectContentLength(response),
      bytes: Buffer.from(await response.arrayBuffer())
    };
  }, { label: "existing image verification" });
  if (!bytes.length) {
    throw new Error("Existing image verification returned empty object bytes.");
  }

  const signatureHex = bytesToHex(bytes).slice(0, maxSignatureHexLength);
  const dimensions = parseImageDimensionsFromBytes(bytes, contentType);
  if (!dimensions) {
    throw new Error("Existing image dimensions could not be read from object bytes.");
  }

  const upload = validateListingImageUpload({
    contentType,
    size,
    width: dimensions.width,
    height: dimensions.height,
    signatureHex
  });

  if (upload.size > config.max_upload_bytes) {
    throw new Error(`Image exceeds max upload size of ${config.max_upload_bytes} bytes.`);
  }
  if (Math.max(upload.width, upload.height) > config.max_image_dimension_pixels) {
    throw new Error(`Image exceeds max dimension of ${config.max_image_dimension_pixels} pixels.`);
  }
  if (upload.width * upload.height > config.max_image_total_pixels) {
    throw new Error(`Image exceeds max pixel area of ${config.max_image_total_pixels} pixels.`);
  }

  const contentSha256 = bytes.length === upload.size
    ? crypto.createHash("sha256").update(bytes).digest("hex")
    : null;
  const verificationToken = createListingImageVerificationToken({
    tenantId,
    objectPath: safePath,
    bucket: safeBucket,
    contentType: upload.content_type,
    size: upload.size,
    width: upload.width,
    height: upload.height,
    env
  });

  return {
    tenant_id: tenantIdFromListingImageObjectPath(safePath),
    object_path: safePath,
    bucket: safeBucket,
    content_type: upload.content_type,
    size: upload.size,
    width: upload.width,
    height: upload.height,
    content_sha256: contentSha256,
    verification_token: verificationToken,
    object_verified: true,
    signature_validated: true,
    content_hash_verified: Boolean(contentSha256),
    dimension_source: "object_bytes"
  };
}

export async function deleteListingImageObject({
  objectPath,
  tenantId = null,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const config = listingImageStorageReadiness(env);
  assertStorageConfigured(config);
  const safePath = tenantId
    ? assertTenantListingImageObjectPath(objectPath, tenantId)
    : safeStorageObjectPath(objectPath);
  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/${encodeURIComponent(config.bucket)}/${encodedObjectPath(safePath)}`;
  const response = await fetchImpl(endpoint, {
    method: "DELETE",
    headers: storageObjectHeaders(config.service_role_key)
  });

  if (response.ok || response.status === 404) {
    return {
      object_path: safePath,
      bucket: config.bucket,
      deleted: response.ok,
      already_absent: response.status === 404,
      status: response.status
    };
  }

  throw new Error(`Supabase object cleanup failed: ${response.status}`);
}

export async function verifyListingImageUploadedObject({
  objectPath,
  tenantId = null,
  contentType,
  size,
  width,
  height,
  signatureHex,
  signatureBytes,
  fileSignature,
  contentSha256,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const config = listingImageStorageReadiness(env);
  assertStorageConfigured(config);
  const safePath = tenantId
    ? assertTenantListingImageObjectPath(objectPath, tenantId)
    : safeStorageObjectPath(objectPath);
  const expectedUpload = validateListingImageUpload({
    contentType,
    size,
    width,
    height,
    signatureHex,
    signatureBytes,
    fileSignature
  });
  const expectedSignatureHex = normalizeSignatureHex({ signatureHex, signatureBytes, fileSignature });
  const expectedContentSha256 = normalizeSha256Hex(contentSha256);

  if (expectedUpload.size > config.max_upload_bytes) {
    throw new Error(`Image exceeds max upload size of ${config.max_upload_bytes} bytes.`);
  }
  if (Math.max(expectedUpload.width, expectedUpload.height) > config.max_image_dimension_pixels) {
    throw new Error(`Image exceeds max dimension of ${config.max_image_dimension_pixels} pixels.`);
  }
  if (expectedUpload.width * expectedUpload.height > config.max_image_total_pixels) {
    throw new Error(`Image exceeds max pixel area of ${config.max_image_total_pixels} pixels.`);
  }

  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/${encodeURIComponent(config.bucket)}/${encodedObjectPath(safePath)}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: storageObjectHeaders(config.service_role_key, {
      range: `bytes=0-${objectVerificationPrefixBytes - 1}`
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase uploaded image verification failed: ${response.status}`);
  }

  const actualContentType = String(headerValue(response.headers, "content-type") || "").split(";")[0].toLowerCase();
  if (actualContentType && actualContentType !== expectedUpload.content_type) {
    throw new Error("Uploaded image content type does not match expected MIME type.");
  }

  const actualSize = parseObjectContentLength(response);
  if (actualSize !== null && actualSize !== expectedUpload.size) {
    throw new Error("Uploaded image size does not match expected size.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (!bytes.length) {
    throw new Error("Uploaded image verification returned empty object bytes.");
  }

  const actualSignatureHex = bytesToHex(bytes).slice(0, maxSignatureHexLength);
  if (!actualSignatureHex.startsWith(expectedSignatureHex)) {
    throw new Error("Uploaded image signature does not match the signed upload request.");
  }

  validateListingImageUpload({
    contentType: expectedUpload.content_type,
    size: expectedUpload.size,
    width: expectedUpload.width,
    height: expectedUpload.height,
    signatureHex: actualSignatureHex
  });

  const actualDimensions = parseImageDimensionsFromBytes(bytes, expectedUpload.content_type);
  if (
    actualDimensions &&
    (actualDimensions.width !== expectedUpload.width || actualDimensions.height !== expectedUpload.height)
  ) {
    throw new Error("Uploaded image dimensions do not match expected dimensions.");
  }
  const contentHashVerified = expectedContentSha256 && bytes.length === expectedUpload.size
    ? crypto.createHash("sha256").update(bytes).digest("hex") === expectedContentSha256
    : false;
  if (expectedContentSha256 && bytes.length === expectedUpload.size && !contentHashVerified) {
    throw new Error("Uploaded image SHA-256 hash does not match expected content hash.");
  }

  const verificationToken = createListingImageVerificationToken({
    tenantId,
    objectPath: safePath,
    bucket: config.bucket,
    contentType: expectedUpload.content_type,
    size: expectedUpload.size,
    width: expectedUpload.width,
    height: expectedUpload.height,
    env
  });

  return {
    tenant_id: tenantIdFromListingImageObjectPath(safePath),
    object_path: safePath,
    bucket: config.bucket,
    content_type: expectedUpload.content_type,
    size: expectedUpload.size,
    width: expectedUpload.width,
    height: expectedUpload.height,
    content_sha256: expectedContentSha256 || null,
    verification_token: verificationToken,
    object_verified: true,
    signature_validated: true,
    content_hash_verified: Boolean(contentHashVerified),
    dimension_source: actualDimensions ? "object_bytes" : "client_metadata"
  };
}
