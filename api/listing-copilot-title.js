import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { publicTenantAuthError, requireTenantAccess } from "../lib/tenant/index.mjs";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

// Compatibility endpoint only. Recognition ownership lives in the native V4
// pipeline; legacy clients must migrate to the tenant-scoped durable queue.
export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-copilot-title" });
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  try {
    const context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
    return;
  }

  sendJson(res, 410, {
    ok: false,
    code: "v4_tenant_route_required",
    message: "Use /api/v4/listing-copilot-title for tenant-scoped recognition."
  });
}
