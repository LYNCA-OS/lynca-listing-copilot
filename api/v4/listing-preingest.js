import v2PreingestHandler from "../listing-preingest.js";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { persistV4PreingestionBundle } from "../../lib/listing/v4/session/session-store.mjs";
import {
  callJsonHandler,
  readJsonPayload,
  requestPayloadErrorStatus,
  sendJson
} from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../../lib/tenant/index.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-preingest" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.UPLOAD_ASSET });
    bindProductionRequestContext(res, context);
  } catch (error) {
    const status = isTenantAuthError(error) ? error.statusCode : 503;
    sendJson(res, status, withV4Version(publicTenantAuthError(error)));
    return;
  }

  let payload;
  try {
    payload = await readJsonPayload(req, { maxBytes: 64 * 1024 });
  } catch (error) {
    const status = requestPayloadErrorStatus(error);
    sendJson(res, status, withV4Version({
      ok: false,
      code: status === 413 ? "preingestion_request_too_large" : "preingestion_invalid_request",
      message: status === 413 ? "Pre-ingestion request is too large." : "Invalid request."
    }));
    return;
  }

  const v2Response = await callJsonHandler(v2PreingestHandler, {
    method: "POST",
    headers: req.headers,
    payload: {
      ...payload,
      tenant_id: context.tenantId,
      v4_preingestion: true
    }
  });
  const body = v2Response.body || {};
  // Only the authenticated v2 handler may mint/resolve bundle identity. A
  // browser-supplied bundle id is never a persistence fallback.
  const bundleId = v2Response.statusCode >= 200 && v2Response.statusCode < 300
    ? String(body.bundle_id || "").trim()
    : "";
  const v4Persistence = bundleId && body.ok !== false
    ? await persistV4PreingestionBundle({
      bundleId,
      tenantId: context.tenantId,
      assetId: payload.asset_id || payload.assetId || null,
      bundle: body,
      summary: body.preprocessing_summary || {}
    })
    : { saved: false, error: "missing_bundle_id" };

  sendJson(res, v2Response.statusCode || 200, withV4Version({
    ...body,
    ok: body.ok !== false && v2Response.statusCode >= 200 && v2Response.statusCode < 300,
    v4_preingestion_bundle_id: bundleId || null,
    v4_persistence: { preingestion_bundle: v4Persistence }
  }));
}
