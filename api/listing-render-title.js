import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { publicTenantAuthError, requireTenantAccess } from "../lib/tenant/index.mjs";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-render-title" });
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

  // This legacy renderer accepted caller-supplied recognition fields without a
  // persisted session or assignment boundary. Title edits in the multi-tenant
  // pilot must use the assigned V4 feedback workflow instead.
  sendJson(res, 410, {
    ok: false,
    code: "tenant_title_route_required",
    message: "Use /api/v4/listing-feedback for assigned title edits."
  });
}
