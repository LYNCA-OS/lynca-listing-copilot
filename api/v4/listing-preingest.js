import v2PreingestHandler from "../listing-preingest.js";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { persistV4PreingestionBundle } from "../../lib/listing/v4/session/session-store.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../../lib/tenant/index.mjs";

export default async function handler(req, res) {
  const requestStartedAt = Date.now();
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
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const v2StartedAt = Date.now();
  const v2Response = await callJsonHandler(v2PreingestHandler, {
    method: "POST",
    headers: req.headers,
    payload: {
      ...payload,
      tenant_id: context.tenantId,
      v4_preingestion: true
    }
  });
  const v2HandlerMs = Date.now() - v2StartedAt;
  const body = v2Response.body || {};
  const bundleId = body.bundle_id || payload.preingestion_bundle_id || payload.preingestionBundleId || "";
  const v4PersistenceStartedAt = Date.now();
  const v4Persistence = bundleId
    ? await persistV4PreingestionBundle({
      bundleId,
      tenantId: context.tenantId,
      assetId: payload.asset_id || payload.assetId || null,
      bundle: body,
      summary: body.preprocessing_summary || {}
    })
    : { saved: false, error: "missing_bundle_id" };
  const v4PersistenceMs = Date.now() - v4PersistenceStartedAt;

  sendJson(res, v2Response.statusCode || 200, withV4Version({
    ...body,
    ok: body.ok !== false && v2Response.statusCode >= 200 && v2Response.statusCode < 300,
    v4_preingestion_bundle_id: bundleId || null,
    preingestion_timing: {
      ...(body.preingestion_timing || {}),
      v2_handler_ms: v2HandlerMs,
      v4_persistence_ms: v4PersistenceMs,
      v4_total_ms: Date.now() - requestStartedAt
    },
    v4_persistence: { preingestion_bundle: v4Persistence }
  }));
}
