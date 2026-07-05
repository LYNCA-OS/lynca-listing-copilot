import crypto from "node:crypto";

const defaultWindowMs = 60_000;
const defaultMaxBuckets = 10_000;
const cookieName = "lynca_metaverse_session";
const buckets = new Map();

const legacyLimitEnvByScope = {
  login: "LISTING_LOGIN_RATE_LIMIT",
  listing_feedback: "LISTING_FEEDBACK_RATE_LIMIT",
  listing_image_upload: "LISTING_IMAGE_UPLOAD_RATE_LIMIT",
  listing_image_verify: "LISTING_IMAGE_VERIFY_RATE_LIMIT",
  listing_provider_status: "LISTING_PROVIDER_STATUS_RATE_LIMIT",
  listing_publish: "LISTING_PUBLISH_RATE_LIMIT",
  listing_render_title: "LISTING_RENDER_TITLE_RATE_LIMIT",
  listing_title: "LISTING_TITLE_RATE_LIMIT"
};

function firstHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function headerValue(req, name) {
  const lower = name.toLowerCase();
  return firstHeaderValue(req?.headers?.[lower] ?? req?.headers?.[name]);
}

function cookieValue(header, name) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function truthy(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizedScope(scope) {
  return String(scope || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

function scopedEnvPrefix(scope) {
  return `API_RATE_LIMIT_${normalizedScope(scope).toUpperCase()}`;
}

function hashIdentifier(value, env = process.env) {
  const secret = env.API_RATE_LIMIT_HASH_SECRET || env.METAVERSE_AUTH_SECRET || "";
  if (secret) {
    return crypto.createHmac("sha256", secret).update(value).digest("hex");
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function clientRateLimitIdentifier(req, env = process.env) {
  const session = cookieValue(headerValue(req, "cookie"), cookieName);
  if (session) {
    return {
      source: "session",
      hash: hashIdentifier(`session:${session}`, env)
    };
  }

  const forwardedFor = headerValue(req, "x-forwarded-for").split(",")[0].trim();
  const remoteAddress = forwardedFor || headerValue(req, "x-real-ip") || req?.socket?.remoteAddress || "unknown";
  const userAgent = headerValue(req, "user-agent") || "unknown";

  return {
    source: "network",
    hash: hashIdentifier(`network:${remoteAddress}:${userAgent}`, env)
  };
}

function configuredLimit(scope, fallback, env) {
  const prefix = scopedEnvPrefix(scope);
  return positiveInteger(
    env[`${prefix}_MAX`] ||
      env[`${prefix}_LIMIT`] ||
      env[legacyLimitEnvByScope[normalizedScope(scope)]] ||
      env.API_RATE_LIMIT_MAX,
    fallback,
    { min: 1, max: 100_000 }
  );
}

function configuredWindowMs(scope, fallback, env) {
  const prefix = scopedEnvPrefix(scope);
  return positiveInteger(
    env[`${prefix}_WINDOW_MS`] || env.API_RATE_LIMIT_WINDOW_MS,
    fallback,
    { min: 1_000, max: 24 * 60 * 60 * 1000 }
  );
}

function pruneExpiredBuckets(now, maxBuckets, force = false) {
  if (!force && buckets.size <= maxBuckets) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now || buckets.size > maxBuckets) buckets.delete(key);
  }
}

export function resetApiRateLimitBuckets() {
  buckets.clear();
}

export function checkApiRateLimit({
  req,
  scope = "default",
  limit = 60,
  windowMs = defaultWindowMs,
  env = process.env,
  now = Date.now(),
  identifier
} = {}) {
  const normalized = normalizedScope(scope);
  const max = configuredLimit(normalized, limit, env);
  const configuredWindow = configuredWindowMs(normalized, windowMs, env);
  const maxBuckets = positiveInteger(env.API_RATE_LIMIT_MAX_BUCKETS, defaultMaxBuckets, { min: 100, max: 500_000 });

  if (truthy(env.API_RATE_LIMIT_DISABLED)) {
    return {
      allowed: true,
      disabled: true,
      scope: normalized,
      limit: max,
      remaining: max,
      resetAt: now + configuredWindow,
      retryAfterSeconds: 0,
      identifier_source: "disabled"
    };
  }

  const client = identifier
    ? { source: "custom", hash: hashIdentifier(String(identifier), env) }
    : clientRateLimitIdentifier(req, env);
  const key = `${normalized}:${client.hash}`;
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + configuredWindow };

  bucket.count += 1;
  buckets.set(key, bucket);
  pruneExpiredBuckets(now, maxBuckets);

  const remaining = Math.max(0, max - bucket.count);
  const allowed = bucket.count <= max;
  const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return {
    allowed,
    scope: normalized,
    limit: max,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
    identifier_source: client.source
  };
}

export function applyApiRateLimitHeaders(res, result) {
  if (!res?.setHeader || !result) return;
  res.setHeader("X-RateLimit-Limit", String(result.limit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) res.setHeader("Retry-After", String(result.retryAfterSeconds));
}

export function sendApiRateLimited(res, result, message = "Too many requests. Please try again shortly.") {
  applyApiRateLimitHeaders(res, result);
  res.statusCode = 429;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: false,
    code: "rate_limited",
    message,
    rate_limit: {
      scope: result.scope,
      limit: result.limit,
      retry_after_seconds: result.retryAfterSeconds,
      reset_at: new Date(result.resetAt).toISOString()
    }
  }));
}

export function enforceApiRateLimit(req, res, options = {}) {
  const result = checkApiRateLimit({ req, ...options });
  if (!result.allowed) {
    sendApiRateLimited(res, result, options.message);
    return false;
  }

  applyApiRateLimitHeaders(res, result);
  return true;
}
