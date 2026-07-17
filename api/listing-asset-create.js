import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest
} from "../lib/observability/production-events.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { createTenantListingAsset } from "../lib/tenant/assets.mjs";

const maxBodyBytes = 16 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBodyBytes) {
        reject(new Error("asset_create_request_too_large"));
        req.destroy?.();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-asset-create" });
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, {
      permission: TENANT_PERMISSIONS.UPLOAD_ASSET
    });
    bindProductionRequestContext(res, context);
  } catch (error) {
    const status = isTenantAuthError(error) ? error.statusCode : 503;
    sendJson(res, status, publicTenantAuthError(error));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_asset_create",
    limit: 120,
    windowMs: 60_000,
    message: "Too many asset creation requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req) || "{}");
  } catch (error) {
    sendJson(res, String(error?.message).includes("too_large") ? 413 : 400, {
      ok: false,
      message: "Invalid request."
    });
    return;
  }

  try {
    const asset = await createTenantListingAsset({
      tenantId: context.tenantId,
      clientAssetRef: payload.client_asset_ref || payload.clientAssetRef,
      captureProfileId: payload.capture_profile_id || payload.captureProfileId,
      category: payload.category,
      expectedOriginalCount: payload.expected_original_count ?? payload.expectedOriginalCount,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    sendJson(res, 201, {
      ok: true,
      request_id: context.requestId,
      ...asset
    });
  } catch (error) {
    const invalidRequest = error instanceof TypeError;
    sendJson(res, invalidRequest ? 400 : 503, {
      ok: false,
      retryable: !invalidRequest,
      code: invalidRequest ? "listing_asset_create_invalid" : "listing_asset_create_failed",
      message: String(error.message || "Unable to create listing asset.").slice(0, 240)
    });
  }
}
