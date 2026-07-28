import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest
} from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-prewarm" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    requirePermission(context, TENANT_PERMISSIONS.CREATE_JOB);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_prewarm_retired",
    limit: 60,
    windowMs: 60_000,
    message: "Too many retired prewarm requests."
  })) return;

  // This route previously assembled queue rows independently and therefore
  // bypassed the canonical enqueue/profile boundary. No production caller uses
  // it. Fail permanently instead of maintaining a second recognition contract.
  const tenantId = context.tenantId;
  sendJson(res, 410, withV4Version({
    ok: false,
    retryable: false,
    error_code: "V4_PREWARM_ROUTE_RETIRED_USE_CANONICAL_ENQUEUE",
    message: "This prewarm route is retired. Submit work through listing-job-enqueue.",
    tenant_id: tenantId
  }));
}
