import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { cookieName, createSignedSessionToken } from "../lib/listing-session.mjs";
import {
  authenticatePassword,
  isTenantAuthError,
  listTenantChoicesForAuthUser,
  publicTenantAuthError,
  resolveTenantIdentityForAuthUser
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

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

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
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
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
    sendJson(res, error?.code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400, {
      ok: false,
      message: error?.code === "REQUEST_BODY_TOO_LARGE" ? "Request is too large." : "Invalid request."
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

    const identity = authenticated.provider === "legacy" || inviteTenantId
      ? authenticated.provider === "legacy"
        ? authenticated
        : await resolveTenantIdentityForAuthUser({
          authUserId: authenticated.authUserId,
          tenantId: inviteTenantId
        })
      : await resolveTenantIdentityForAuthUser({
        authUserId: authenticated.authUserId,
        tenantId: credentials.tenant_id || credentials.tenantId
      });

    const session = buildSignedSession(identity);
    const token = createSignedSessionToken(session, authSecret);

    res.setHeader("set-cookie", serializeCookie(cookieName, token, req));
    sendJson(res, 200, {
      ok: true,
      tenant_id: session.tenant_id,
      role: session.role,
      user_id: session.user_id
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

function buildSignedSession(identity) {
  const tenantId = String(identity?.tenantId || identity?.tenant_id || "").trim();
  const userId = String(identity?.userId || identity?.user_id || identity?.authUserId || "").trim();
  const user = normalizeUsername(identity?.user || identity?.email || userId);

  if (!tenantId || !userId) {
    throw new Error("AUTH_CONFIGURATION_ERROR");
  }

  return {
    user,
    user_id: userId,
    tenant_id: tenantId,
    email: String(identity?.email || "").trim().toLowerCase(),
    role: String(identity?.role || "").trim(),
    sid: identity?.sid || crypto.randomUUID(),
    iat: Date.now(),
    exp: Date.now() + maxAgeSeconds * 1000,
    session_version: Number(identity?.sessionVersion || identity?.session_version || 1)
  };
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
