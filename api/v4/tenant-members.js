import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
import {
  addTenantMember,
  isTenantMemberServiceError,
  listTenantMembers,
  updateTenantMember
} from "../../lib/tenant/members.mjs";

const writeMethods = new Set(["POST", "PUT", "PATCH"]);
const forbiddenTenantFields = new Set(["tenant_id", "tenantId", "workspace_id", "workspaceId"]);

function publicServiceError(error) {
  return {
    ok: false,
    retryable: Number(error?.statusCode || 500) >= 500,
    error_code: error?.code || "MEMBER_DIRECTORY_UNAVAILABLE",
    message: error?.message || "Team member directory is temporarily unavailable."
  };
}

function hasForbiddenTenantField(payload) {
  return payload && typeof payload === "object"
    && [...forbiddenTenantFields].some((field) => Object.hasOwn(payload, field));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/tenant-members" });
  if (req.method !== "GET" && !writeMethods.has(req.method)) {
    sendJson(res, 405, withV4Version({ ok: false, retryable: false, message: "Method not allowed" }));
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, {
      permission: req.method === "GET"
        ? TENANT_PERMISSIONS.VIEW_TEAM
        : TENANT_PERMISSIONS.MANAGE_MEMBERS
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
    scope: req.method === "GET" ? "v4_tenant_members_read" : "v4_tenant_members_write",
    limit: req.method === "GET" ? 120 : 60,
    windowMs: 60_000,
    message: "Too many team member requests. Please wait briefly."
  })) return;

  try {
    if (req.method === "GET") {
      const members = await listTenantMembers({ tenantId: context.tenantId });
      sendJson(res, 200, withV4Version({ ok: true, members }));
      return;
    }

    let payload;
    try {
      payload = await readJsonPayload(req, { maxBytes: 32_000 });
    } catch (error) {
      sendJson(res, requestPayloadErrorStatus(error), withV4Version({
        ok: false,
        retryable: false,
        error_code: "INVALID_MEMBER_REQUEST",
        message: "Invalid team member request."
      }));
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || hasForbiddenTenantField(payload)) {
      sendJson(res, 400, withV4Version({
        ok: false,
        retryable: false,
        error_code: "INVALID_MEMBER_REQUEST",
        message: "Invalid team member request."
      }));
      return;
    }

    const member = req.method === "POST"
      ? await addTenantMember({
        tenantId: context.tenantId,
        userId: payload.user_id || payload.userId,
        email: payload.email,
        role: payload.role
      })
      : await updateTenantMember({
        tenantId: context.tenantId,
        userId: payload.user_id || payload.userId,
        email: payload.email,
        role: payload.role,
        status: payload.status
      });
    sendJson(res, req.method === "POST" ? 201 : 200, withV4Version({ ok: true, member }));
  } catch (error) {
    if (isTenantAuthError(error)) {
      sendJson(res, error.statusCode, withV4Version({ ...publicTenantAuthError(error), retryable: false }));
      return;
    }
    const safeError = isTenantMemberServiceError(error)
      ? error
      : Object.assign(new Error("Team member directory is temporarily unavailable."), {
        code: "MEMBER_DIRECTORY_UNAVAILABLE",
        statusCode: 503
      });
    sendJson(res, Number(safeError.statusCode || 503), withV4Version(publicServiceError(safeError)));
  }
}
