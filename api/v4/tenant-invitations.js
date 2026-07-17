import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  TENANT_PERMISSIONS,
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess
} from "../../lib/tenant/index.mjs";
import {
  TENANT_INVITATION_DURATIONS,
  TenantInvitationServiceError,
  createTenantInvitation,
  isTenantInvitationServiceError,
  listTenantInvitations
} from "../../lib/tenant/invitations.mjs";

const writeMethods = new Set(["POST"]);

function cleanText(value, maxLength = 512) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function serviceError(error, fallbackCode = "INVITATION_STORAGE_UNAVAILABLE") {
  const code = error?.code || fallbackCode;
  const status = error?.statusCode || 503;
  return {
    ok: false,
    error_code: code,
    message: error?.message || "Invitation service is temporarily unavailable."
  };
}

function requestOrigin(req) {
  const host = String(req?.headers?.host || "").trim();
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const scheme = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : host.includes("localhost")
      ? "http"
      : "https";
  return `${scheme}://${host || "localhost:3000"}`;
}

function buildInviteUrl(req, token) {
  return `${requestOrigin(req)}/login?invite_token=${encodeURIComponent(token)}`;
}

function normalizeDurationInput(value) {
  const duration = cleanText(value, 32).toLowerCase();
  return duration || "permanent";
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  const rounded = Math.floor(parsed);
  if (rounded < 1) return 1;
  if (rounded > 200) return 200;
  return rounded;
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/tenant-invitations" });
  if (req.method !== "GET" && !writeMethods.has(req.method)) {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, {
      permission: TENANT_PERMISSIONS.MANAGE_MEMBERS
    });
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version({
      ...publicTenantAuthError(error),
      retryable: false
    }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: req.method === "GET" ? "v4_tenant_invitations_read" : "v4_tenant_invitations_write",
    limit: req.method === "GET" ? 120 : 60,
    windowMs: 60_000,
    message: "Too many tenant invitation requests. Please wait briefly."
  })) return;

  try {
    if (req.method === "GET") {
      const requestUrl = new URL(req.url || "/", "http://localhost");
      const status = cleanText(requestUrl.searchParams.get("status") || "", 40);
      const limit = parseLimit(requestUrl.searchParams.get("limit"));
      const invitations = await listTenantInvitations({
        tenantId: context.tenantId,
        status,
        limit,
        env: process.env,
        fetchImpl: globalThis.fetch
      });
      sendJson(res, 200, withV4Version({
        ok: true,
        durations: TENANT_INVITATION_DURATIONS,
        invitations
      }));
      return;
    }

    let payload;
    try {
      payload = await readJsonPayload(req, { maxBytes: 16_000 });
    } catch (error) {
      sendJson(res, requestPayloadErrorStatus(error), withV4Version(serviceError(error, "INVALID_INVITATION_REQUEST")));
      return;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      sendJson(res, 400, withV4Version(serviceError({ code: "INVALID_INVITATION_REQUEST", message: "Invalid invitation request." })));
      return;
    }

    const result = await createTenantInvitation({
      tenantId: context.tenantId,
      inviterUserId: context.userId,
      email: payload.email || payload.invitee_email || payload.destination,
      role: payload.role,
      duration: normalizeDurationInput(payload.duration),
      resend: Boolean(payload.resend),
      env: process.env,
      fetchImpl: globalThis.fetch
    });

    sendJson(res, 201, withV4Version({
      ok: true,
      invitation: result.invitation,
      invite_url: buildInviteUrl(req, result.token)
    }));
    return;
  } catch (error) {
    if (isTenantAuthError(error) && error.code === "TENANT_SELECTION_REQUIRED") {
      sendJson(res, 403, withV4Version(serviceError(error)));
      return;
    }
    if (isTenantInvitationServiceError(error)) {
      sendJson(res, error.statusCode, withV4Version(serviceError(error)));
      return;
    }
    sendJson(res, 503, withV4Version(serviceError(error, "INVITATION_STORAGE_UNAVAILABLE")));
  }
}
