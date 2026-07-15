import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  deleteListingImageObject,
  verifyListingImageUploadedObject
} from "../lib/listing/storage/supabase-image-storage.mjs";
import { saveListingImageVerificationRecord } from "../lib/listing/storage/storage-verification-store.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";

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

async function cleanupFailedUpload(payload, tenantId) {
  const objectPath = payload?.objectPath || payload?.object_path;
  if (!objectPath) return { attempted: false };

  try {
    const cleanup = await deleteListingImageObject({ objectPath, tenantId });
    return {
      attempted: true,
      deleted: Boolean(cleanup.deleted),
      already_absent: Boolean(cleanup.already_absent),
      status: cleanup.status
    };
  } catch {
    return {
      attempted: true,
      deleted: false,
      cleanup_failed: true
    };
  }
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-image-verify-upload" });
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
    scope: "listing_image_verify",
    limit: 120,
    windowMs: 60_000,
    message: "Too many image verification requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  try {
    const verification = await verifyListingImageUploadedObject({
      tenantId: context.tenantId,
      objectPath: payload.objectPath || payload.object_path,
      contentType: payload.contentType || payload.content_type,
      size: payload.size,
      width: payload.width || payload.imageWidth,
      height: payload.height || payload.imageHeight,
      signatureHex: payload.signatureHex || payload.signature_hex || payload.fileSignature,
      signatureBytes: payload.signatureBytes,
      contentSha256: payload.contentSha256 || payload.content_sha256 || payload.sha256
    });
    let verificationRecord = {
      saved: false,
      durable: false
    };

    try {
      verificationRecord = await saveListingImageVerificationRecord({
        verification,
        tenantId: context.tenantId,
        assetId: payload.assetId || payload.asset_id || null,
        imageId: payload.imageId || payload.image_id || null,
        role: payload.role || payload.storageRole || payload.storage_role || null
      });
    } catch {
      verificationRecord = {
        saved: false,
        durable: true,
        reason: "verification_record_write_failed"
      };
    }

    sendJson(res, 200, {
      ok: true,
      verification,
      verification_record: {
        saved: Boolean(verificationRecord.saved),
        durable: Boolean(verificationRecord.durable),
        reason: verificationRecord.reason || null
      }
    });
  } catch (error) {
    const cleanup = await cleanupFailedUpload(payload, context.tenantId);
    sendJson(res, 400, {
      ok: false,
      message: String(error.message || "Unable to verify uploaded image.").slice(0, 240),
      cleanup
    });
  }
}
