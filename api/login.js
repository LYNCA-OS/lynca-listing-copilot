import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  cookieName,
  createListingSessionToken,
  listingSessionCookieIsSecure,
  requestHasJsonContentType,
  sameOriginBrowserRequest
} from "../lib/listing-session.mjs";
import {
  authenticatePassword,
  isTenantAuthError,
  listTenantChoicesForAuthUser,
  publicTenantAuthError,
  resolveTenantIdentityForAuthUser,
  resolveTenantIdentityForPrincipal
} from "../lib/tenant/index.mjs";
import {
  claimTenantInvitation,
  isTenantInvitationServiceError
} from "../lib/tenant/invitations.mjs";

const maxAgeSeconds = 60 * 60 * 24 * 7;
const maxLoginBodyBytes = 16 * 1024;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function serializeCookie(name, value, req) {
  const secure = listingSessionCookieIsSecure(req) ? "; Secure" : "";
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
    res.setHeader("allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (!sameOriginBrowserRequest(req, { allowMissingBrowserContext: true })) {
    sendJson(res, 403, { ok: false, message: "Forbidden" });
    return;
  }

  if (!requestHasJsonContentType(req)) {
    sendJson(res, 415, { ok: false, message: "Content-Type must be application/json." });
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
    sendJson(res, 500, { ok: false, message: "Listing auth is not configured." });
    return;
  }

  let credentials;
  try {
    credentials = JSON.parse(await readBody(req));
  } catch (error) {
    const tooLarge = error?.code === "REQUEST_BODY_TOO_LARGE";
    sendJson(res, tooLarge ? 413 : 400, {
      ok: false,
      message: tooLarge ? "Request is too large." : "Invalid request."
    });
    return;
  }

  let authenticated = null;
  try {
    authenticated = await authenticatePassword({
      email: credentials.email || credentials.username,
      username: credentials.username,
      password: credentials.password
    });
    const inviteTenantId = await resolveInvitationTenant({
      inviteToken: cleanInviteToken(credentials?.invite_token),
      email: credentials.email || credentials.username,
      authenticated
    });
    const resolvedIdentity = authenticated.provider === "legacy" || inviteTenantId
      ? authenticated.provider === "legacy"
        ? await resolveTenantIdentityForPrincipal({
            tenantId: authenticated.tenantId,
            userId: authenticated.userId
          }, {
            allowLegacyBreakGlass: true,
            fallbackEmail: authenticated.email,
            env: process.env,
            fetchImpl: globalThis.fetch
          })
        : await resolveTenantIdentityForAuthUser({
          authUserId: authenticated.authUserId,
          tenantId: inviteTenantId
        })
      : await resolveTenantIdentityForAuthUser({
        authUserId: authenticated.authUserId,
        tenantId: credentials.tenant_id || credentials.tenantId
      });
    const identity = Object.freeze({
      ...resolvedIdentity,
      email: resolvedIdentity.email || authenticated.email
    });
    const token = createListingSessionToken(identity, authSecret, {
      maxAgeMs: maxAgeSeconds * 1000
    });
    bindProductionRequestContext(res, identity);

    res.setHeader("set-cookie", serializeCookie(cookieName, token, req));
    sendJson(res, 200, {
      ok: true,
      tenant_id: identity.tenantId,
      role: identity.role
    });
  } catch (error) {
    let tenantChoices = [];
    if (isTenantInvitationServiceError(error)) {
      const code = error.code;
      sendJson(res, Number(error.statusCode || 400), {
        ok: false,
        code,
        error_code: code,
        message: error.message
      });
      return;
    }
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
    sendJson(res, statusCode, {
      ...payload,
      message: error?.code === "INVALID_CREDENTIALS"
        ? "账号或密码不正确。"
        : error?.code === "TENANT_SELECTION_REQUIRED"
          ? "请选择要进入的客户空间。"
          : payload.message,
      tenants: tenantChoices
    });
  }
}

function cleanInviteToken(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveInvitationTenant({ inviteToken, email, authenticated }) {
  if (!inviteToken || !authenticated || authenticated.provider === "legacy") return "";
  const claim = await claimTenantInvitation({
    token: inviteToken,
    email,
    env: process.env,
    fetchImpl: globalThis.fetch
  });
  return claim?.tenantId || "";
}
