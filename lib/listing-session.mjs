import crypto from "node:crypto";
import {
  LEGACY_TENANT_ID,
  LEGACY_USER_ID,
  LISTING_SESSION_VERSION
} from "./tenant/constants.mjs";
import { validListingSessionClaims } from "./listing-session-claims.mjs";

export const cookieName = "lynca_metaverse_session";
export const internalOperatorPlaceholder = "internal-operator";
export const listingSessionVersion = LISTING_SESSION_VERSION;
export const defaultListingSessionMaxAgeMs = 7 * 24 * 60 * 60 * 1_000;

export function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function cleanText(value, maxLength = 512) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validIdentityToken(value, maxLength = 160) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 &&
    normalized.length <= maxLength &&
    /^[a-z0-9][a-z0-9._:-]*$/i.test(normalized)
    ? normalized
    : "";
}

function requestCookieHeader(req) {
  if (typeof req?.headers?.get === "function") return req.headers.get("cookie") || "";
  return req?.headers?.cookie || req?.headers?.Cookie || "";
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").split(",")[0].trim().toLowerCase();
}

export function listingSessionCookieIsSecure(req, env = process.env) {
  const vercelEnvironment = String(env.VERCEL_ENV || "").trim().toLowerCase();
  // Vercel production and preview terminate TLS before invoking the function.
  // `vercel dev` also sets VERCEL=1, but serves plain HTTP locally; forcing a
  // Secure cookie there causes the browser to discard the session immediately.
  if (["production", "preview"].includes(vercelEnvironment)) {
    return true;
  }
  if (req?.socket?.encrypted === true || req?.connection?.encrypted === true) return true;

  // Non-Vercel reverse proxies must opt in explicitly. In particular, do not
  // infer HTTPS from a non-local Host: Docker/LAN HTTP hosts are still HTTP.
  const trustForwardedProto = ["1", "true", "yes", "on"].includes(
    String(env.LYNCA_TRUST_PROXY_PROTO || "").trim().toLowerCase()
  );
  return trustForwardedProto && firstHeaderValue(req?.headers?.["x-forwarded-proto"]) === "https";
}

export function sameOriginBrowserRequest(req, { allowMissingBrowserContext = false } = {}) {
  const origin = String(req?.headers?.origin || "").trim();
  const fetchSite = firstHeaderValue(req?.headers?.["sec-fetch-site"]);
  const host = firstHeaderValue(req?.headers?.host);

  if (!origin && !fetchSite) return allowMissingBrowserContext;
  if (!origin || fetchSite !== "same-origin" || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function requestHasJsonContentType(req) {
  return firstHeaderValue(req?.headers?.["content-type"]).split(";")[0].trim() === "application/json";
}

export function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  const leftDigest = crypto.createHash("sha256").update(leftBuffer).digest();
  const rightDigest = crypto.createHash("sha256").update(rightBuffer).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && leftBuffer.length === rightBuffer.length;
}

export function normalizeListingSessionClaims(session, env = process.env) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  const legacyUser = cleanText(session.user, 320);
  const userId = validIdentityToken(
    session.user_id ?? session.userId ?? (legacyUser ? LEGACY_USER_ID : "")
  );
  const tenantId = validIdentityToken(
    session.tenant_id ?? session.tenantId ?? (legacyUser ? LEGACY_TENANT_ID : "")
  );
  const email = cleanText(
    session.email ?? (legacyUser ? env.METAVERSE_EMAIL || legacyUser : ""),
    320
  ).toLowerCase();
  const version = Number(
    session.session_version ?? session.sessionVersion ?? (legacyUser ? LISTING_SESSION_VERSION : NaN)
  );
  const legacyIdentity = userId === LEGACY_USER_ID && tenantId === LEGACY_TENANT_ID;
  if (legacyUser && !legacyIdentity) return null;
  if (!userId || !tenantId || !email || /[\u0000-\u001f\u007f]/.test(email)) return null;
  if (!Number.isSafeInteger(version) || version < 1) return null;

  return {
    ...(legacyIdentity && legacyUser ? { user: legacyUser } : {}),
    user_id: userId,
    tenant_id: tenantId,
    email,
    session_version: version,
    sid: session.sid,
    iat: session.iat,
    exp: session.exp
  };
}

export function createSignedSessionToken(session, secret, { env = process.env } = {}) {
  if (!secret) throw new Error("missing_session_secret");
  // The compatibility `user` claim can only map to the fixed legacy principal;
  // browser-supplied tenant or operator values never become authorization facts.
  const payloadValue = normalizeListingSessionClaims(session, env) || {};
  const payload = Buffer.from(JSON.stringify(payloadValue)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSignedSession(cookie, secret, { env = process.env } = {}) {
  if (!cookie || !secret) return null;
  const parts = String(cookie).split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature || !timingSafeStringEqual(signature, sign(payload, secret))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const session = normalizeListingSessionClaims(decoded, env);
    if (!session) return null;
    return validListingSessionClaims(session, {
      maxAgeMs: defaultListingSessionMaxAgeMs
    }) ? session : null;
  } catch {
    return null;
  }
}

export function createListingSessionToken(identity, secret = process.env.METAVERSE_AUTH_SECRET, {
  env = process.env,
  now = Date.now(),
  maxAgeMs = defaultListingSessionMaxAgeMs
} = {}) {
  const identityUserId = identity?.user_id ?? identity?.userId;
  const identityTenantId = identity?.tenant_id ?? identity?.tenantId;
  const legacyUser = identityUserId === LEGACY_USER_ID && identityTenantId === LEGACY_TENANT_ID
    ? cleanText(identity?.user || env.METAVERSE_USERNAME, 320)
    : "";
  const session = normalizeListingSessionClaims({
    ...(identity || {}),
    ...(legacyUser ? { user: legacyUser } : {}),
    user_id: identityUserId,
    tenant_id: identityTenantId,
    session_version: identity?.session_version ?? identity?.sessionVersion ?? LISTING_SESSION_VERSION,
    sid: identity?.sid || crypto.randomUUID(),
    iat: Number(identity?.iat) || now,
    exp: Number(identity?.exp) || now + maxAgeMs
  }, env);
  if (!session) throw new Error("missing_session_identity");
  return createSignedSessionToken(session, secret, { env });
}

export const createListingSession = createListingSessionToken;

export function readListingSession(cookie, secret = process.env.METAVERSE_AUTH_SECRET, {
  env = process.env
} = {}) {
  return readSignedSession(cookie, secret, { env });
}

export function getSessionFromRequest(req, env = process.env) {
  const cookies = parseCookies(requestCookieHeader(req));
  return readListingSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET, { env });
}

export function operatorIdFromRequest(req) {
  const session = getSessionFromRequest(req);
  return String(session?.user_id || "").trim() || internalOperatorPlaceholder;
}

export function tenantIdFromRequest(req) {
  return String(getSessionFromRequest(req)?.tenant_id || "").trim() || null;
}

export function userIdFromRequest(req) {
  return String(getSessionFromRequest(req)?.user_id || "").trim() || null;
}
