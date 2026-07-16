import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { verifyExistingListingImageObject } from "../lib/listing/storage/supabase-image-storage.mjs";
import {
  assertTenantListingAssetObjectPath,
  saveListingImageVerificationRecord
} from "../lib/listing/storage/storage-verification-store.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { normalizeDurableListingAssetId } from "../lib/tenant/assets.mjs";

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
  instrumentProductionRequest(req, res, { api: "/api/listing-image-verify-existing" });
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
    scope: "listing_image_verify_existing",
    limit: 120,
    windowMs: 60_000,
    message: "Too many existing image verification requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  const objectPath = payload.objectPath || payload.object_path;
  const assetId = payload.assetId || payload.asset_id;
  try {
    if (!assetId) throw new Error("asset_id is required.");
    normalizeDurableListingAssetId(assetId);
    assertTenantListingAssetObjectPath({
      tenantId: context.tenantId,
      assetId,
      objectPath
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: String(error.message || "Invalid listing image object path.").slice(0, 240)
    });
    return;
  }

  try {
    const verification = await verifyExistingListingImageObject({
      tenantId: context.tenantId,
      objectPath,
      bucket: payload.bucket || payload.storage_bucket
    });
    let verificationRecord = {
      saved: false,
      durable: false
    };

    try {
      verificationRecord = await saveListingImageVerificationRecord({
        verification,
        tenantId: context.tenantId,
        assetId,
        requireDurableAssetId: true,
        imageId: payload.imageId || payload.image_id || null,
        role: payload.role || payload.storageRole || payload.storage_role || null
      });
      if (!verificationRecord.saved || !verificationRecord.durable) {
        throw new Error(verificationRecord.reason || "verification_record_write_failed");
      }
    } catch {
      sendJson(res, 503, {
        ok: false,
        retryable: true,
        code: "verification_record_write_failed",
        message: "Image verification could not be persisted."
      });
      return;
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
    sendJson(res, 400, {
      ok: false,
      message: String(error.message || "Unable to verify existing image.").slice(0, 240)
    });
  }
}
