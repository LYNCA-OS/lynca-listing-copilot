import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest,
  persistProductionEvent
} from "../lib/observability/production-events.mjs";
import { createListingImageSignedUpload } from "../lib/listing/storage/supabase-image-storage.mjs";
import { requireTenantListingAsset } from "../lib/tenant/assets.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-image-upload-url" });
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.UPLOAD_ASSET });
    bindProductionRequestContext(res, context);
  } catch (error) {
    const status = isTenantAuthError(error) ? error.statusCode : 503;
    sendJson(res, status, publicTenantAuthError(error));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_image_upload",
    limit: 120,
    windowMs: 60_000,
    message: "Too many image upload URL requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  try {
    const assetId = payload.assetId || payload.asset_id;
    const clientAssetRef = String(payload.clientAssetRef || payload.client_asset_ref || "").trim().slice(0, 160);
    await requireTenantListingAsset({
      tenantId: context.tenantId,
      assetId,
      requireDurable: true,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const upload = await createListingImageSignedUpload({
      tenantId: context.tenantId,
      assetId,
      imageId: payload.imageId || payload.image_id,
      role: payload.role,
      fileName: payload.fileName,
      contentType: payload.contentType,
      size: payload.size,
      width: payload.width || payload.imageWidth,
      height: payload.height || payload.imageHeight,
      signatureHex: payload.signatureHex || payload.signature_hex || payload.fileSignature,
      signatureBytes: payload.signatureBytes,
      contentSha256: payload.contentSha256 || payload.content_sha256 || payload.sha256
    });
    await persistProductionEvent({
      eventType: "upload_started",
      requestId: context.requestId,
      context,
      metadata: {
        asset_id: assetId,
        client_asset_ref: clientAssetRef || null,
        storage_role: payload.role || null,
        content_type: upload.content_type,
        size: upload.size
      }
    });

    sendJson(res, 200, {
      ok: true,
      request_id: context.requestId,
      asset_id: assetId,
      client_asset_ref: clientAssetRef || null,
      upload
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: String(error.message || "Unable to create image upload URL.").slice(0, 240)
    });
  }
}
