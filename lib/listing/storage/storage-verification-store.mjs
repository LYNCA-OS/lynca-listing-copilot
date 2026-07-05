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
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
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

function metadataMatches(row = {}, expected = {}) {
  return safeString(row.object_path) === sanitizeObjectPath(expected.objectPath)
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
  assetId = null,
  imageId = null,
  role = null,
  now = new Date()
} = {}) {
  const verifiedAt = verification?.verified_at || now.toISOString();

  return {
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
  assetId = null,
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
  const endpoint = new URL(`${url}/rest/v1/${verificationTable}`);
  endpoint.searchParams.set("on_conflict", "object_path");
  const row = listingImageVerificationRecordFromResult({
    verification,
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
    "object_path",
    "bucket",
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
  endpoint.searchParams.set("object_path", `eq.${safePath}`);
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

  if (!metadataMatches(row, { objectPath, bucket, contentType, size, width, height })) {
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
