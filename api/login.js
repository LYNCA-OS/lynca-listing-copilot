import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  cookieName,
  createListingSessionToken
} from "../lib/listing-session.mjs";
import {
  authenticatePassword,
  isTenantAuthError,
  listTenantChoicesForAuthUser,
  publicTenantAuthError,
  resolveTenantIdentityForAuthUser
} from "../lib/tenant/index.mjs";

const maxAgeSeconds = 60 * 60 * 24 * 7;
const maxLoginBodyBytes = 16 * 1024;

function isHttps(req) {
  const host = String(req.headers.host || "");
  return req.headers["x-forwarded-proto"] === "https" ||
    (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function serializeCookie(name, value, req) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxLoginBodyBytes) {
        const error = new Error("login_request_too_large");
        error.code = "REQUEST_BODY_TOO_LARGE";
        reject(error);
        req.destroy?.();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/login" });
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "login",
    limit: 20,
    windowMs: 5 * 60_000,
    message: "Too many login attempts. Please wait before trying again."
  })) return;

  const authSecret = process.env.METAVERSE_AUTH_SECRET;

  if (!authSecret) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Listing auth is not configured." }));
    return;
  }

  let credentials;
  try {
    credentials = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Invalid request." }));
    return;
  }

  let authenticated = null;
  try {
    authenticated = await authenticatePassword({
      email: credentials.email || credentials.username,
      username: credentials.username,
      password: credentials.password
    });
    const identity = authenticated.provider === "legacy"
      ? authenticated
      : await resolveTenantIdentityForAuthUser({
        authUserId: authenticated.authUserId,
        tenantId: credentials.tenant_id || credentials.tenantId
      });
    const token = createListingSessionToken(identity, authSecret, {
      maxAgeMs: maxAgeSeconds * 1000
    });
    bindProductionRequestContext(res, identity);

    res.statusCode = 200;
    res.setHeader("set-cookie", serializeCookie(cookieName, token, req));
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      tenant_id: identity.tenantId,
      role: identity.role
    }));
  } catch (error) {
    let tenantChoices = [];
    if (isTenantAuthError(error) && error.code === "TENANT_SELECTION_REQUIRED") {
      try {
        if (authenticated?.authUserId) {
          tenantChoices = await listTenantChoicesForAuthUser({ authUserId: authenticated.authUserId });
        }
      } catch {
        tenantChoices = [];
      }
    }
    const statusCode = isTenantAuthError(error) ? error.statusCode : 503;
    const payload = publicTenantAuthError(error);
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ...payload,
      message: error?.code === "INVALID_CREDENTIALS"
        ? "账号或密码不正确。"
        : error?.code === "TENANT_SELECTION_REQUIRED"
          ? "请选择要进入的客户空间。"
          : payload.message,
      tenants: tenantChoices
    }));
  }
}
