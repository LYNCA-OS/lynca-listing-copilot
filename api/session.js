import {
  isTenantAuthError,
  PERMISSION_SCOPES,
  permissionScopeFor,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/session" });
  try {
    const context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    const permissionScopes = Object.fromEntries(
      Object.values(TENANT_PERMISSIONS)
        .map((permission) => [permission, permissionScopeFor(context.role, permission)])
        .filter(([, scope]) => scope !== PERMISSION_SCOPES.NONE)
    );
    res.statusCode = 200;
    res.setHeader("x-request-id", context.requestId);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      authenticated: true,
      user: context.email,
      user_id: context.userId,
      email: context.email,
      tenant_id: context.tenantId,
      tenant_name: context.tenant.name,
      plan: context.tenant.plan,
      role: context.role,
      permission_scopes: permissionScopes
    }));
  } catch (error) {
    const unauthenticated = isTenantAuthError(error) && ["AUTH_REQUIRED", "ACCESS_DENIED"].includes(error.code);
    const payload = publicTenantAuthError(error);
    res.statusCode = unauthenticated ? 200 : (error?.statusCode || 503);
    if (payload.request_id) res.setHeader("x-request-id", payload.request_id);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ authenticated: false, ...(unauthenticated ? {} : payload) }));
  }
}
