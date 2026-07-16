import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { processQueuedPreingestionOcrJobs } from "../../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import { isV4CronRequest, isV4WorkerRequest } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../../lib/tenant/index.mjs";

// Sweep endpoint for queued `ocr_crop_verification` preingestion jobs.
// The primary consumer is the in-process waitUntil dispatch inside
// api/listing-preingest.js; this endpoint exists to re-sweep jobs that
// survived a cold start or a failed dispatch.
export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-preingest-worker" });
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  const internalAuthorized = isV4WorkerRequest(req, process.env) || isV4CronRequest(req, process.env);
  let context = null;
  if (!internalAuthorized) {
    try {
      context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.UPLOAD_ASSET });
      bindProductionRequestContext(res, context);
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
      return;
    }
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_preingest_worker",
    limit: 120,
    windowMs: 60_000,
    message: "Too many pre-ingestion worker sweeps. Please try again shortly."
  })) return;

  const payload = req.method === "POST" ? await readJsonPayload(req) : {};
  const includeDetail = payload.include_detail === true || payload.includeDetail === true;

  try {
    const result = await processQueuedPreingestionOcrJobs({
      tenantId: context?.tenantId || payload.tenant_id || payload.tenantId || "",
      assetId: payload.asset_id || payload.assetId || "",
      bundleId: payload.bundle_id || payload.bundleId || "",
      limit: payload.limit,
      // Scheduled recovery keeps the scarce OCR pool on serial, grade and
      // printed card codes. Detail crops require an explicit maintenance call.
      anchorOnly: includeDetail
        ? false
        : payload.anchor_only !== false && payload.anchorOnly !== false,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    sendJson(res, result.ok ? 200 : 503, withV4Version(result));
  } catch (error) {
    sendJson(res, 500, withV4Version({
      ok: false,
      code: "preingestion_worker_failed",
      message: String(error?.message || "Pre-ingestion worker sweep failed.").slice(0, 240)
    }));
  }
}
