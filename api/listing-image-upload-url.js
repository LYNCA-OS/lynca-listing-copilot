import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest,
  persistProductionEvent,
  sanitizeOperationalText
} from "../lib/observability/production-events.mjs";
import {
  createListingImageSignedUpload,
  STORAGE_OBJECT_ALREADY_EXISTS
} from "../lib/listing/storage/supabase-image-storage.mjs";
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
    // allSettled, not all: `all` rejects on the FIRST collision, so a batch
    // where two images collide reported one and the caller recovered one per
    // round trip. Collect every collision so one verification pass clears the
    // batch. Non-collision failures still take the original error path.
    const settled = await Promise.allSettled(imagePayloads.map((image) => createListingImageSignedUpload({
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
    const rejected = settled
      .map((outcome, index) => ({ outcome, image: imagePayloads[index] }))
      .filter(({ outcome }) => outcome.status === "rejected");
    if (rejected.length) {
      // A batch that mixes a collision with a real failure is a real failure:
      // reporting only the recoverable half would send the caller into a
      // verification loop for a problem verification cannot fix.
      const nonCollision = rejected.find(({ outcome }) => (
        outcome.reason?.code !== STORAGE_OBJECT_ALREADY_EXISTS
      ));
      if (nonCollision) throw nonCollision.outcome.reason;
      throw Object.assign(new Error("Signed upload URL collided with existing immutable objects."), {
        code: STORAGE_OBJECT_ALREADY_EXISTS,
        retryable: true,
        collisions: rejected.map(({ outcome, image }) => ({
          image_id: String(image.imageId || image.image_id || "").trim(),
          role: image.role,
          object_path: outcome.reason?.object_path || null,
          bucket: outcome.reason?.bucket || null
        }))
      });
    }
    const uploads = settled.map((outcome) => outcome.value);
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
    const code = error.code || (error.retryable === true ? "storage_signing_temporarily_unavailable" : "storage_signing_failed");
    const message = sanitizeOperationalText(error.message || "Unable to create image upload URL.", 240);
    console.warn(JSON.stringify({
      event: "listing_image_upload_signing_failed",
      request_id: context.requestId,
      tenant_id: context.tenantId,
      code,
      retryable: error.retryable === true,
      message
    }));
    // COS-51: a collision with an already-written object is the one signing
    // failure the caller can act on, so it must arrive as an identity rather
    // than as a message. 409 rather than 503 -- the request will never succeed
    // as sent, and a blind retry is exactly the loop this replaces.
    const collision = error.code === STORAGE_OBJECT_ALREADY_EXISTS;
    sendJson(res, collision ? 409 : (error.retryable === true ? 503 : 400), {
      ok: false,
      request_id: context.requestId,
      failure_stage: "storage_signing",
      code,
      retryable: error.retryable === true,
      message,
      ...(collision ? {
        recovery_action: "VERIFY_EXISTING_OR_INPUT_REBIND",
        object_path: error.object_path || null,
        bucket: error.bucket || null,
        // Present for a batch request; a single-image request carries the path
        // on `object_path` above. Callers should prefer this when it exists.
        ...(Array.isArray(error.collisions) ? { collisions: error.collisions } : {})
      } : {})
    });
  }
}
