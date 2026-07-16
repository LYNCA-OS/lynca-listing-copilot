import v2PreingestHandler from "../listing-preingest.js";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { persistV4PreingestionBundle } from "../../lib/listing/v4/session/session-store.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../../lib/tenant/index.mjs";

export function v4PreingestionResponseStatus(statusCode, v4Saved) {
  const normalizedStatus = Number(statusCode);
  const delegatedStatus = Number.isInteger(normalizedStatus) && normalizedStatus >= 100
    ? normalizedStatus
    : 500;
  return delegatedStatus >= 200 && delegatedStatus < 300 && v4Saved !== true
    ? 503
    : delegatedStatus;
}

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
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
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
  const delegatedStatusCode = Number(v2Response.statusCode);
  const statusCode = Number.isInteger(delegatedStatusCode) && delegatedStatusCode >= 100
    ? delegatedStatusCode
    : 500;
  const serverBundleId = typeof body.bundle_id === "string" ? body.bundle_id.trim() : "";
  const delegatedSaved = statusCode >= 200
    && statusCode < 300
    && body.ok !== false
    && body.saved === true
    && Boolean(serverBundleId);
  const v4Persistence = delegatedSaved
    ? await persistV4PreingestionBundle({
      bundleId: serverBundleId,
      tenantId: context.tenantId,
      assetId: payload.asset_id || payload.assetId || null,
      bundle: body,
      summary: body.preprocessing_summary || {}
    })
    : {
        saved: false,
        error: statusCode < 200 || statusCode >= 300 || body.ok === false
          ? "delegated_preingestion_failed"
          : body.saved !== true
            ? "delegated_preingestion_not_saved"
            : "missing_server_bundle_id"
      };
  const v4Saved = delegatedSaved && v4Persistence.saved === true;
  // A 2xx delegated response without both durable layers is not a successful
  // V4 contract. In standalone mode V2 can legitimately report saved=false,
  // which must not be exposed as an HTTP success by the V4 API.
  const responseStatusCode = v4PreingestionResponseStatus(statusCode, v4Saved);

  sendJson(res, responseStatusCode, withV4Version({
    ...body,
    ok: v4Saved,
    v4_preingestion_bundle_id: v4Saved ? serverBundleId : null,
    v4_persistence: { preingestion_bundle: v4Persistence }
  }));
}
