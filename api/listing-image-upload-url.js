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
    // One card can legitimately contain two originals plus eight evidence crops.
    // The old demo limit rejected the tail of 20-100 card writer batches.
    limit: 1200,
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
    const imagePayloads = Array.isArray(payload.images) ? payload.images : [payload];
    if (!imagePayloads.length || imagePayloads.length > 10) throw new Error("Image upload batch must contain 1-10 images.");
    const uploads = await Promise.all(imagePayloads.map((image) => createListingImageSignedUpload({
      tenantId: context.tenantId,
      assetId,
      imageId: image.imageId || image.image_id,
      role: image.role,
      fileName: image.fileName,
      contentType: image.contentType,
      size: image.size,
      width: image.width || image.imageWidth,
      height: image.height || image.imageHeight,
      signatureHex: image.signatureHex || image.signature_hex || image.fileSignature,
      signatureBytes: image.signatureBytes,
      contentSha256: image.contentSha256 || image.content_sha256 || image.sha256
    })));
    await Promise.all(uploads.map((upload) => persistProductionEvent({
      eventType: "upload_started",
      requestId: context.requestId,
      context,
      metadata: {
        asset_id: assetId,
        client_asset_ref: clientAssetRef || null,
        storage_role: upload.storage_role || null,
        content_type: upload.content_type,
        size: upload.size
      }
    })));

    sendJson(res, 200, {
      ok: true,
      request_id: context.requestId,
      asset_id: assetId,
      client_asset_ref: clientAssetRef || null,
      ...(Array.isArray(payload.images) ? { uploads } : { upload: uploads[0] })
    });
  } catch (error) {
    sendJson(res, error.retryable === true ? 503 : 400, {
      ok: false,
      code: error.code || (error.retryable === true ? "storage_signing_temporarily_unavailable" : "storage_signing_failed"),
      retryable: error.retryable === true,
      message: String(error.message || "Unable to create image upload URL.").slice(0, 240)
    });
  }
}
