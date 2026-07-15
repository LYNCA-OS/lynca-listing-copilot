import { timingSafeStringEqual } from "./listing-session.mjs";

export const platformAdminHeader = "x-lynca-platform-admin-secret";

function headerValue(req, name) {
  const value = req?.headers?.[String(name).toLowerCase()] ?? req?.headers?.[name];
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

function bearerToken(req) {
  return headerValue(req, "authorization").replace(/^Bearer\s+/i, "").trim();
}

export function configuredPlatformAdminSecret(env = process.env) {
  return String(env.LYNCA_PLATFORM_ADMIN_SECRET || "").trim();
}

export function isPlatformAdminRequest(req, env = process.env) {
  const expected = configuredPlatformAdminSecret(env);
  const supplied = headerValue(req, platformAdminHeader) || bearerToken(req);
  return Boolean(expected && supplied && timingSafeStringEqual(supplied, expected));
}

export function platformAdminAuth(req, env = process.env) {
  return isPlatformAdminRequest(req, env)
    ? Object.freeze({ ok: true, mode: "platform_admin_secret" })
    : Object.freeze({ ok: false, mode: "" });
}
