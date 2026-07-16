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

function enabledExactly(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function productionRuntime(env = process.env) {
  return String(env.VERCEL_ENV || "").trim().toLowerCase() === "production"
    || String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

// Runtime HTTP migration handlers are retained only for explicit, isolated
// non-production rehearsals. Production migrations are maintenance-window
// operations and must never become reachable merely because an admin secret
// is configured in the application runtime.
export function runtimeMigrationAuth(req, env = process.env) {
  if (productionRuntime(env) || !enabledExactly(env.LYNCA_RUNTIME_MIGRATIONS_ENABLED)) {
    return Object.freeze({
      ok: false,
      statusCode: 403,
      error: "runtime_migrations_disabled",
      mode: ""
    });
  }
  if (!isPlatformAdminRequest(req, env)) {
    return Object.freeze({ ok: false, statusCode: 401, error: "unauthorized", mode: "" });
  }
  return Object.freeze({
    ok: true,
    statusCode: 200,
    error: "",
    mode: "platform_admin_secret_nonproduction_rehearsal"
  });
}
