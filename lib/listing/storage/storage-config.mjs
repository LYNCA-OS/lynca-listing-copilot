const defaultSignedUrlTtlSeconds = 600;
const defaultMaxUploadBytes = 25 * 1024 * 1024;
const defaultMaxImageDimensionPixels = 12_000;
const defaultMaxImageTotalPixels = 50_000_000;
const hardMaxUploadBytes = 100 * 1024 * 1024;
const hardMaxImageDimensionPixels = 24_000;
const hardMaxImageTotalPixels = 100_000_000;

function numberFromEnv(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedNumberFromEnv(env, key, fallback, maximum) {
  return Math.min(numberFromEnv(env, key, fallback), maximum);
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function listingImageStorageReadiness(env = process.env) {
  const url = normalizeBaseUrl(env.SUPABASE_URL);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const bucket = env.LISTING_IMAGE_BUCKET || "listing-card-images";
  const maxUploadBytes = boundedNumberFromEnv(
    env,
    "LISTING_IMAGE_MAX_UPLOAD_BYTES",
    defaultMaxUploadBytes,
    hardMaxUploadBytes
  );
  const signedUrlTtlSeconds = numberFromEnv(
    env,
    "LISTING_IMAGE_SIGNED_URL_TTL_SECONDS",
    defaultSignedUrlTtlSeconds
  );
  const maxImageDimensionPixels = boundedNumberFromEnv(
    env,
    "LISTING_IMAGE_MAX_DIMENSION_PIXELS",
    defaultMaxImageDimensionPixels,
    hardMaxImageDimensionPixels
  );
  const maxImageTotalPixels = boundedNumberFromEnv(
    env,
    "LISTING_IMAGE_MAX_TOTAL_PIXELS",
    defaultMaxImageTotalPixels,
    hardMaxImageTotalPixels
  );
  const missing = [];

  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!bucket) missing.push("LISTING_IMAGE_BUCKET");

  return {
    configured: missing.length === 0,
    missing,
    url,
    service_role_key: serviceRoleKey,
    bucket,
    max_upload_bytes: maxUploadBytes,
    max_image_dimension_pixels: maxImageDimensionPixels,
    max_image_total_pixels: maxImageTotalPixels,
    signed_url_ttl_seconds: signedUrlTtlSeconds,
    reason: missing.length ? `missing_${missing.join("_").toLowerCase()}` : null
  };
}

export function publicStorageReadiness(env = process.env) {
  const readiness = listingImageStorageReadiness(env);

  return {
    configured: readiness.configured,
    missing: readiness.missing,
    bucket: readiness.bucket,
    max_upload_bytes: readiness.max_upload_bytes,
    max_image_dimension_pixels: readiness.max_image_dimension_pixels,
    max_image_total_pixels: readiness.max_image_total_pixels,
    signed_url_ttl_seconds: readiness.signed_url_ttl_seconds,
    reason: readiness.reason
  };
}
