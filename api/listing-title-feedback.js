import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { publicTenantAuthError, requireTenantAccess } from "../lib/tenant/index.mjs";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-title-feedback" });
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_feedback",
    limit: 120,
    windowMs: 60_000,
    message: "Too many feedback requests. Please try again shortly."
  })) return;

  try {
    const context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
    return;
  }

  sendJson(res, 410, {
    ok: false,
    code: "tenant_feedback_route_required",
    message: "Use /api/v4/listing-feedback for tenant-scoped feedback."
  });
}
