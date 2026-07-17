export const LEGACY_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const allowedClockSkewMs = 5 * 60 * 1000;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identityTokenPattern = /^[a-z0-9][a-z0-9._:-]*$/i;

function validTemporalSessionClaims(session, {
  now = Date.now(),
  maxAgeMs = LEGACY_SESSION_MAX_AGE_MS
} = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;

  const issuedAt = Number(session.iat);
  const expiresAt = Number(session.exp);
  const boundedMaxAge = Math.max(1, Number(maxAgeMs) || LEGACY_SESSION_MAX_AGE_MS);

  if (!sessionIdPattern.test(String(session.sid ?? ""))) return false;
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return false;
  if (issuedAt > Number(now) + allowedClockSkewMs || expiresAt <= Number(now)) return false;
  if (expiresAt <= issuedAt || expiresAt - issuedAt > boundedMaxAge + allowedClockSkewMs) return false;
  return true;
}

function validIdentityToken(value, maxLength = 160) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 && normalized.length <= maxLength && identityTokenPattern.test(normalized);
}

export function validLegacySessionClaims(session, {
  now = Date.now(),
  maxAgeMs = LEGACY_SESSION_MAX_AGE_MS
} = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  const user = String(session.user ?? "").trim();
  if (!user || user.length > 254 || /[\u0000-\u001f\u007f]/.test(user)) return false;
  return validTemporalSessionClaims(session, { now, maxAgeMs });
}

export function validListingSessionClaims(session, {
  now = Date.now(),
  maxAgeMs = LEGACY_SESSION_MAX_AGE_MS
} = {}) {
  if (!validTemporalSessionClaims(session, { now, maxAgeMs })) return false;

  const legacyUser = String(session.user ?? "").trim();
  if (legacyUser) {
    return legacyUser.length <= 254 && !/[\u0000-\u001f\u007f]/.test(legacyUser);
  }

  const email = String(session.email ?? "").trim().toLowerCase();
  const sessionVersion = Number(session.session_version ?? session.sessionVersion);
  return validIdentityToken(session.user_id ?? session.userId) &&
    validIdentityToken(session.tenant_id ?? session.tenantId) &&
    email.length > 0 &&
    email.length <= 320 &&
    !/[\u0000-\u001f\u007f]/.test(email) &&
    Number.isSafeInteger(sessionVersion) &&
    sessionVersion >= 1;
}
