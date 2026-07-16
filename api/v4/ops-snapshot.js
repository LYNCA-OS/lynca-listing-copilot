import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { createRequestTelemetry } from "../../lib/observability/production-events.mjs";
import { readTenantOpsSnapshot } from "../../lib/ops/tenant-ops.mjs";
import {
  hasTenantPermission,
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function queryParam(req, name) {
  return new URL(req.url || "/", "https://local.test").searchParams.get(name);
}

export default async function handler(req, res) {
  const telemetry = createRequestTelemetry(req, res, { api: "/api/v4/ops-snapshot" });
  req.headers = { ...(req.headers || {}), "x-request-id": telemetry.requestId };

  if (req.method !== "GET") {
    await telemetry.finish({ statusCode: 405 });
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_tenant_ops_snapshot",
    limit: 120,
    windowMs: 60_000,
    message: "Too many operations snapshot requests."
  })) {
    await telemetry.finish({ statusCode: res.statusCode || 429 });
    return;
  }

  try {
    const context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.VIEW_TEAM });
    telemetry.bindContext(context);
    const canViewCost = hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_COST);
    const result = await readTenantOpsSnapshot({
      tenantId: context.tenantId,
      windowHours: queryParam(req, "window_hours"),
      canViewCost
    });
    if (!result.ok) {
      await telemetry.finish({ statusCode: 503 });
      sendJson(res, 503, withV4Version({
        ok: false,
        retryable: true,
        error_code: "TENANT_OPS_SNAPSHOT_UNAVAILABLE",
        message: "Operations snapshot is temporarily unavailable."
      }));
      return;
    }
    await telemetry.finish({ statusCode: 200 });
    sendJson(res, 200, withV4Version({ ok: true, snapshot: result.snapshot }));
  } catch (error) {
    if (isTenantAuthError(error)) {
      await telemetry.finish({ statusCode: error.statusCode });
      sendJson(res, error.statusCode, withV4Version(publicTenantAuthError(error)));
      return;
    }
    await telemetry.fail(error, { statusCode: 500, recoverable: false });
    sendJson(res, 500, withV4Version({
      ok: false,
      request_id: telemetry.requestId,
      error_code: "TENANT_OPS_SNAPSHOT_FAILED",
      message: "Operations snapshot failed."
    }));
  }
}
