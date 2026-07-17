import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-retry" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, retryable: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    requirePermission(context, TENANT_PERMISSIONS.RETRY_JOB);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version({
      ...publicTenantAuthError(error),
      retryable: false
    }));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_retry",
    limit: 120,
    windowMs: 60_000,
    message: "Too many retry requests. Please wait briefly."
  })) return;
  // A failed job may contain object paths from an older upload generation.
  // Replaying its persisted payload can therefore reintroduce a mixed 4/6
  // segment image set. The enqueue route is the only retry boundary: it reads
  // the current verified records and fully replaces client image references.
  sendJson(res, 410, withV4Version({
    ok: false,
    retryable: false,
    error_code: "V4_FRESH_ENQUEUE_REQUIRED",
    message: "Create a fresh priority enqueue from the current verified image set; persisted job payloads cannot be replayed."
  }));
}
