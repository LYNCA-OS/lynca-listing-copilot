import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  assertListingImageUploadObjectIdentity,
  verifyExistingListingImageObject
} from "../lib/listing/storage/supabase-image-storage.mjs";
import {
  assertTenantListingAssetObjectPath,
  saveListingImageVerificationRecord
} from "../lib/listing/storage/storage-verification-store.mjs";
import { normalizeDurableListingAssetId } from "../lib/tenant/assets.mjs";
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
  const expectedContentSha256 = String(
    payload.contentSha256 || payload.content_sha256 || ""
  ).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedContentSha256)) {
    sendJson(res, 400, {
      ok: false,
      code: "expected_content_sha256_required",
      retryable: false,
      message: "A valid content SHA-256 is required to verify an existing image."
    });
    return;
  }
  let uploadIdentity;
  try {
    normalizeDurableListingAssetId(assetId);
    assertTenantListingAssetObjectPath({ tenantId: context.tenantId, assetId, objectPath });
    uploadIdentity = assertListingImageUploadObjectIdentity({
      tenantId: context.tenantId,
      assetId,
      imageId: payload.imageId || payload.image_id,
      role: payload.role || payload.storageRole || payload.storage_role,
      objectPath,
      fileName: payload.fileName || payload.file_name,
      contentType: payload.contentType || payload.content_type
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: String(error.message || "Invalid listing image object path.").slice(0, 240)
    });
    return;
  }

  try {
    // The client already knows the sha256 of the bytes it holds, and sends it.
    // This endpoint used to ignore it entirely, which is why the verification
    // could never conclude anything: with nothing to compare against,
    // `content_hash_verified` stayed false and the record was refused.
    const verification = await verifyExistingListingImageObject({
      tenantId: context.tenantId,
      objectPath,
      bucket: payload.bucket || payload.storage_bucket,
      expectedContentSha256
    });
    if (verification.content_hash_matches_expected !== true
        || String(verification.content_sha256 || "").toLowerCase() !== expectedContentSha256) {
      sendJson(res, 409, {
        ok: false,
        code: "existing_object_content_hash_mismatch",
        retryable: false,
        message: "The existing image does not match the bytes being recovered."
      });
      return;
    }
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
        imageId: uploadIdentity.image_id,
        role: uploadIdentity.storage_role,
        cropMetadata: payload.cropMetadata || payload.crop_metadata || null
      });
      if (!verificationRecord.saved || !verificationRecord.durable) {
        throw new Error(verificationRecord.reason || "verification_record_write_failed");
      }
    } catch (error) {
      // The reason used to be discarded here, so a caller saw only "could not be
      // persisted" and finding the cause meant calling the store by hand.
      const reason = String(error?.message || "verification_record_write_failed").slice(0, 200);
      sendJson(res, 503, {
        ok: false,
        retryable: true,
        code: "verification_record_write_failed",
        reason,
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
