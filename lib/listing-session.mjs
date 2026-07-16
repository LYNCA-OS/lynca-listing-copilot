import crypto from "node:crypto";
import {
  LEGACY_TENANT_ID,
  LEGACY_USER_ID,
  LISTING_SESSION_VERSION
} from "./tenant/constants.mjs";

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

function requestCookieHeader(req) {
  if (typeof req?.headers?.get === "function") return req.headers.get("cookie") || "";
  return req?.headers?.cookie || req?.headers?.Cookie || "";
}

export function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeListingSessionClaims(session, env = process.env) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  const legacyUser = cleanText(session.user, 320);
  const userId = cleanText(session.user_id ?? session.userId ?? (legacyUser ? LEGACY_USER_ID : ""), 160);
  const tenantId = cleanText(session.tenant_id ?? session.tenantId ?? (legacyUser ? LEGACY_TENANT_ID : ""), 160);
  const email = cleanText(
    session.email ?? (legacyUser ? env.METAVERSE_EMAIL || legacyUser : ""),
    320
  ).toLowerCase();
  const version = Number(
    session.session_version ?? session.sessionVersion ?? (legacyUser ? LISTING_SESSION_VERSION : NaN)
  );
  if (!userId || !tenantId || !email || !Number.isSafeInteger(version) || version < 1) return null;

  return {
    ...session,
    user_id: userId,
    tenant_id: tenantId,
    email,
    session_version: version
  };
}

export function createSignedSessionToken(session, secret, { env = process.env } = {}) {
  if (!secret) throw new Error("missing_session_secret");
  // Existing `{ user, sid, iat, exp }` callers are upgraded in place to the
  // bounded legacy tenant. Arbitrary non-listing signed payloads remain valid.
  const payloadValue = normalizeListingSessionClaims(session, env) || session || {};
  const payload = Buffer.from(JSON.stringify(payloadValue)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSignedSession(cookie, secret) {
  if (!cookie || !secret) return null;
  const tokenParts = cookie.split(".");
  if (tokenParts.length !== 2) return null;
  const [payload, signature] = tokenParts;
  if (!payload || !signature || !timingSafeStringEqual(signature, sign(payload, secret))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Number(session.exp) <= Date.now()) return null;
    return session;
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
    : cleanText(identity?.user, 320);
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
  const session = normalizeListingSessionClaims(readSignedSession(cookie, secret), env);
  if (!session || !Number.isFinite(Number(session.exp)) || Number(session.exp) <= Date.now()) return null;
  return session;
}

export function getSessionFromRequest(req, env = process.env) {
  const cookies = parseCookies(requestCookieHeader(req));
  return readListingSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET, { env });
}

export function operatorIdFromRequest(req) {
  const session = getSessionFromRequest(req);
  return String(session?.user || session?.user_id || "").trim() || internalOperatorPlaceholder;
}
