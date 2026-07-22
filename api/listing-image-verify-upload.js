import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest
} from "../lib/observability/production-events.mjs";
import {
  assertListingImageUploadObjectIdentity,
  createListingImageVerificationToken,
  deleteListingImageObject,
  verifyListingImageUploadedObject
} from "../lib/listing/storage/supabase-image-storage.mjs";
import {
  assertTenantListingAssetObjectPath,
  readListingImageVerificationRecord,
  saveListingImageVerificationRecord
} from "../lib/listing/storage/storage-verification-store.mjs";
import { listingImageStorageReadiness } from "../lib/listing/storage/storage-config.mjs";
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
  const requestStartedAt = Date.now();
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
    limit: 1200,
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

  const objectPath = payload.objectPath || payload.object_path;
  const assetId = payload.assetId || payload.asset_id;
  const expectedContentSha256 = String(
    payload.contentSha256 || payload.content_sha256 || payload.sha256 || ""
  ).trim().toLowerCase();
  let uploadIdentity;
  try {
    normalizeDurableListingAssetId(assetId);
    assertTenantListingAssetObjectPath({
      tenantId: context.tenantId,
      assetId,
      objectPath
    });
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

  // An aborted client retry can arrive after the first Vercel invocation has
  // already persisted the exact verified bytes. Reuse only a fully matching,
  // hash-verified canonical record; any mismatch falls through to a fresh
  // full-byte verification.
  const storageConfig = listingImageStorageReadiness(process.env);
  const fastReadStartedAt = Date.now();
  let existingVerification = null;
  try {
    existingVerification = await readListingImageVerificationRecord({
      tenantId: context.tenantId,
      assetId,
      imageId: uploadIdentity.image_id,
      role: uploadIdentity.storage_role,
      objectPath,
      bucket: storageConfig.bucket,
      contentType: payload.contentType || payload.content_type,
      size: payload.size,
      width: payload.width || payload.imageWidth,
      height: payload.height || payload.imageHeight,
      contentSha256: expectedContentSha256,
      timeoutMs: 1500
    });
  } catch {
    existingVerification = null;
  }
  if (
    /^[0-9a-f]{64}$/.test(expectedContentSha256)
    && existingVerification?.verified === true
    && existingVerification.record?.canonical_eligible === true
    && existingVerification.record?.content_hash_verified === true
    && existingVerification.record?.dimension_source === "object_bytes"
  ) {
    const record = existingVerification.record;
    const verification = {
      tenant_id: record.tenant_id,
      object_path: record.object_path,
      bucket: record.bucket,
      content_type: record.content_type,
      size: Number(record.size),
      width: Number(record.width),
      height: Number(record.height),
      content_sha256: record.content_sha256,
      verification_token: createListingImageVerificationToken({
        tenantId: record.tenant_id,
        objectPath: record.object_path,
        bucket: record.bucket,
        contentType: record.content_type,
        size: record.size,
        width: record.width,
        height: record.height
      }),
      object_verified: true,
      signature_validated: true,
      content_hash_verified: true,
      dimension_source: "object_bytes",
      verified_at: record.verified_at
    };
    sendJson(res, 200, {
      ok: true,
      verification,
      verification_record: { saved: true, durable: true, reason: "exact_record_reused" },
      verification_timing: {
        exact_record_reused: true,
        exact_record_read_ms: Date.now() - fastReadStartedAt,
        total_ms: Date.now() - requestStartedAt
      }
    });
    return;
  }

  try {
    const objectVerificationStartedAt = Date.now();
    const verification = await verifyListingImageUploadedObject({
      tenantId: context.tenantId,
      objectPath,
      contentType: payload.contentType || payload.content_type,
      size: payload.size,
      width: payload.width || payload.imageWidth,
      height: payload.height || payload.imageHeight,
      signatureHex: payload.signatureHex || payload.signature_hex || payload.fileSignature,
      signatureBytes: payload.signatureBytes,
      contentSha256: expectedContentSha256
    });
    const objectVerificationMs = Date.now() - objectVerificationStartedAt;
    let verificationRecord = {
      saved: false,
      durable: false
    };

    const recordWriteStartedAt = Date.now();
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
    } catch {
      const cleanup = await cleanupFailedUpload(payload, context.tenantId);
      sendJson(res, 503, {
        ok: false,
        retryable: true,
        code: "verification_record_write_failed",
        message: "Image verification could not be persisted.",
        cleanup
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
      },
      verification_timing: {
        exact_record_reused: false,
        exact_record_read_ms: objectVerificationStartedAt - fastReadStartedAt,
        object_verification_ms: objectVerificationMs,
        record_write_ms: Date.now() - recordWriteStartedAt,
        total_ms: Date.now() - requestStartedAt
      }
    });
  } catch (error) {
    // A storage timeout/429/5xx says nothing about object correctness. Preserve
    // the upload so the client can verify it again instead of paying to upload
    // the same original and crops twice.
    const retryable = error.retryable === true;
    const cleanup = retryable
      ? { attempted: false, preserved_for_retry: true }
      : await cleanupFailedUpload(payload, context.tenantId);
    sendJson(res, retryable ? 503 : 400, {
      ok: false,
      code: error.code || (retryable ? "storage_verification_temporarily_unavailable" : "storage_verification_failed"),
      retryable,
      message: String(error.message || "Unable to verify uploaded image.").slice(0, 240),
      cleanup
    });
  }
}
