import {
  isTenantAuthError,
  PERMISSION_SCOPES,
  permissionScopeFor,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { getSessionFromRequest } from "../lib/listing-session.mjs";

function sendJson(res, statusCode, payload, { head = false } = {}) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(head ? undefined : JSON.stringify(payload));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/session" });
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    sendJson(res, 405, { authenticated: false, message: "Method not allowed" });
    return;
  }

  try {
    const context = await requireTenantAccess(req);
    const session = getSessionFromRequest(req);
    bindProductionRequestContext(res, context);
    const permissionScopes = Object.fromEntries(
      Object.values(TENANT_PERMISSIONS)
        .map((permission) => [permission, permissionScopeFor(context.role, permission)])
        .filter(([, scope]) => scope !== PERMISSION_SCOPES.NONE)
    );
    res.setHeader("x-request-id", context.requestId);
    sendJson(res, 200, {
      authenticated: true,
      user: context.email || context.userId,
      user_id: context.userId,
      email: context.email || null,
      tenant_id: context.tenantId,
      tenant_name: context.tenant.name,
      plan: context.tenant.plan,
      role: context.role,
      permission_scopes: permissionScopes,
      expires_at: session?.exp || null
    }, { head: req.method === "HEAD" });
  } catch (error) {
    const unauthenticated = isTenantAuthError(error) && ["AUTH_REQUIRED", "ACCESS_DENIED"].includes(error.code);
    const payload = publicTenantAuthError(error);
    if (payload.request_id) res.setHeader("x-request-id", payload.request_id);
    sendJson(
      res,
      unauthenticated ? 200 : (error?.statusCode || 503),
      { authenticated: false, ...(unauthenticated ? {} : payload) },
      { head: req.method === "HEAD" }
    );
  }
}
