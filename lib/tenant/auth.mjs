import { timingSafeStringEqual } from "../listing-session.mjs";
import {
  LEGACY_TENANT_ID,
  LEGACY_USER_ID,
  LISTING_SESSION_VERSION,
  TENANT_ROLES
} from "./constants.mjs";
import { TenantAuthError } from "./errors.mjs";

const defaultTimeoutMs = 8_000;

function cleanText(value, maxLength = 1_024) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function normalizeBaseUrl(value) {
  const url = cleanText(value, 2_048).replace(/\/+$/, "");
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
      ? parsed.origin
      : "";
  } catch {
    return "";
  }
}

function jwtRole(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return "";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return cleanText(payload?.role, 80).toLowerCase();
  } catch {
    return "";
  }
}

export function isPrivilegedSupabaseKey(value, env = process.env) {
  const key = cleanText(value, 8_192);
  if (!key) return false;
  if (/^sb_secret_/i.test(key) || jwtRole(key) === "service_role") return true;
  const configuredSecrets = [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY]
    .map((candidate) => cleanText(candidate, 8_192))
    .filter(Boolean);
  return configuredSecrets.some((candidate) => timingSafeStringEqual(key, candidate));
}

export function supabasePasswordAuthConfig(env = process.env) {
  const url = normalizeBaseUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanText(
    env.SUPABASE_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    8_192
  );
  return {
    url,
    key: key && !isPrivilegedSupabaseKey(key, env) ? key : "",
    configured: Boolean(url && key && !isPrivilegedSupabaseKey(key, env))
  };
}

function abortAfter(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || defaultTimeoutMs));
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export async function authenticateSupabasePassword({ email, password } = {}, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = defaultTimeoutMs
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const secret = String(password ?? "");
  if (!normalizedEmail || !secret || secret.length > 4_096) {
    throw new TenantAuthError("INVALID_CREDENTIALS");
  }

  const config = supabasePasswordAuthConfig(env);
  if (!config.configured || typeof fetchImpl !== "function") {
    throw new TenantAuthError("AUTH_CONFIGURATION_ERROR");
  }

  const timeout = abortAfter(timeoutMs);
  let response;
  try {
    const headers = {
      apikey: config.key,
      "content-type": "application/json"
    };
    // New sb_publishable keys are opaque API keys, not JWTs. Legacy anon keys
    // remain JWTs and retain the historical Authorization header behavior.
    if (jwtRole(config.key) === "anon") headers.authorization = `Bearer ${config.key}`;
    response = await fetchImpl(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: normalizedEmail, password: secret }),
      signal: timeout.signal
    });
  } catch {
    throw new TenantAuthError("AUTH_UNAVAILABLE");
  } finally {
    timeout.cancel();
  }

  if (response?.status === 400 || response?.status === 401) {
    throw new TenantAuthError("INVALID_CREDENTIALS");
  }
  if (response?.status === 429) {
    throw new TenantAuthError("AUTH_RATE_LIMITED");
  }
  if (!response?.ok) {
    throw new TenantAuthError("AUTH_UNAVAILABLE");
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new TenantAuthError("AUTH_UNAVAILABLE");
  }

  const authUserId = cleanText(body?.user?.id, 160);
  if (!authUserId) throw new TenantAuthError("AUTH_UNAVAILABLE");

  // Provider access and refresh tokens are intentionally not returned or put in
  // the application session. The server only needs this verified identity proof.
  return Object.freeze({
    provider: "supabase",
    authUserId,
    email: normalizeEmail(body?.user?.email || normalizedEmail)
  });
}

function legacyEmail(env, fallback) {
  return normalizeEmail(env.METAVERSE_EMAIL || fallback);
}

export function legacyPasswordAuthConfigured(env = process.env) {
  return Boolean(normalizeEmail(env.METAVERSE_USERNAME) && String(env.METAVERSE_PASSWORD ?? ""));
}

export function tryAuthenticateLegacyPassword({ email, username, password } = {}, {
  env = process.env
} = {}) {
  const expectedUser = normalizeEmail(env.METAVERSE_USERNAME);
  const expectedPassword = String(env.METAVERSE_PASSWORD ?? "");
  const suppliedUser = normalizeEmail(email || username);
  const suppliedPassword = String(password ?? "");
  if (!expectedUser || !expectedPassword || !suppliedUser || !suppliedPassword) return null;
  if (suppliedUser !== expectedUser || !timingSafeStringEqual(suppliedPassword, expectedPassword)) return null;

  return Object.freeze({
    provider: "legacy",
    authUserId: null,
    userId: LEGACY_USER_ID,
    tenantId: LEGACY_TENANT_ID,
    email: legacyEmail(env, expectedUser),
    role: TENANT_ROLES.OWNER,
    sessionVersion: LISTING_SESSION_VERSION
  });
}

export function authenticateLegacyPassword(credentials = {}, options = {}) {
  const identity = tryAuthenticateLegacyPassword(credentials, options);
  if (!identity) throw new TenantAuthError("INVALID_CREDENTIALS");
  return identity;
}

export async function authenticatePassword(credentials = {}, options = {}) {
  const legacy = tryAuthenticateLegacyPassword(credentials, options);
  if (legacy) return legacy;
  const env = options.env || process.env;
  const suppliedUser = normalizeEmail(credentials.email || credentials.username);
  const expectedLegacyUser = normalizeEmail(env.METAVERSE_USERNAME);
  if (expectedLegacyUser && suppliedUser === expectedLegacyUser) {
    throw new TenantAuthError("INVALID_CREDENTIALS");
  }
  if (!supabasePasswordAuthConfig(env).configured && legacyPasswordAuthConfigured(env)) {
    throw new TenantAuthError("INVALID_CREDENTIALS");
  }
  return authenticateSupabasePassword({
    email: credentials.email || credentials.username,
    password: credentials.password
  }, options);
}
