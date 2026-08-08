import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest,
  sanitizeOperationalText
} from "../lib/observability/production-events.mjs";
import { createListingImageSignedUpload } from "../lib/listing/storage/supabase-image-storage.mjs";
import { requireTenantListingAsset } from "../lib/tenant/assets.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { verifyListingImagePayload } from "./listing-image-verify-upload.js";

export const LISTING_IMAGE_RELAY_MAX_BYTES = 3_200_000;
const RELAY_METADATA_MAX_CHARS = 8_192;
const RELAY_STORAGE_TIMEOUT_MS = 10_000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function headerValue(req, name) {
  const value = req?.headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

export function decodeRelayMetadata(value) {
  const encoded = String(value || "").trim();
  if (!encoded || encoded.length > RELAY_METADATA_MAX_CHARS || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw Object.assign(new Error("Invalid upload relay metadata."), { code: "relay_metadata_invalid" });
  }
  try {
    const metadata = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("invalid");
    return metadata;
  } catch {
    throw Object.assign(new Error("Invalid upload relay metadata."), { code: "relay_metadata_invalid" });
  }
}

export function readBoundedBinaryBody(req, maxBytes = LISTING_IMAGE_RELAY_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(headerValue(req, "content-length") || 0);
    if (declared > maxBytes) {
      req.resume?.();
      reject(Object.assign(new Error("Image is too large for the upload relay."), { code: "relay_body_too_large" }));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(Object.assign(new Error("Image is too large for the upload relay."), { code: "relay_body_too_large" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    });
  });
}

function publicUploadIdentity(upload = {}) {
  const { signed_upload_url: _signedUploadUrl, ...identity } = upload;
  return identity;
}

export function createListingImageUploadRelayHandler({
  requireAccess = requireTenantAccess,
  requireAsset = requireTenantListingAsset,
  signUpload = createListingImageSignedUpload,
  uploadFetch = globalThis.fetch,
  verifyPayload = verifyListingImagePayload,
  enforceRateLimit = enforceApiRateLimit
} = {}) {
  return async function listingImageUploadRelayHandler(req, res) {
    const startedAt = Date.now();
    instrumentProductionRequest(req, res, { api: "/api/listing-image-upload-relay" });
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, message: "Method not allowed" });
      return;
    }

    let context;
    try {
      context = await requireAccess(req, { permission: TENANT_PERMISSIONS.UPLOAD_ASSET });
      bindProductionRequestContext(res, context);
    } catch (error) {
      const status = isTenantAuthError(error) ? error.statusCode : 503;
      sendJson(res, status, publicTenantAuthError(error));
      return;
    }

    if (!enforceRateLimit(req, res, {
      scope: "listing_image_upload_relay",
      limit: 1200,
      windowMs: 60_000,
      message: "Too many relayed image uploads. Please try again shortly."
    })) return;

    try {
      const metadata = decodeRelayMetadata(headerValue(req, "x-lynca-upload-metadata"));
      const body = await readBoundedBinaryBody(req);
      const expectedSize = Number(metadata.size || 0);
      if (!body.length || expectedSize !== body.length) {
        throw Object.assign(new Error("Upload relay body size mismatch."), { code: "relay_body_size_mismatch" });
      }

      const assetId = metadata.assetId || metadata.asset_id;
      await requireAsset({
        tenantId: context.tenantId,
        assetId,
        requireDurable: true,
        env: process.env,
        fetchImpl: globalThis.fetch
      });
      const upload = await signUpload({
        tenantId: context.tenantId,
        assetId,
        imageId: metadata.imageId || metadata.image_id,
        role: metadata.role,
        fileName: metadata.fileName,
        contentType: metadata.contentType,
        size: expectedSize,
        width: metadata.width,
        height: metadata.height,
        signatureHex: metadata.signatureHex,
        contentSha256: metadata.contentSha256
      });
      const expectedObjectPath = String(metadata.objectPath || metadata.object_path || "").trim();
      if (expectedObjectPath && expectedObjectPath !== upload.object_path) {
        throw Object.assign(new Error("Upload relay object identity mismatch."), { code: "relay_object_identity_mismatch" });
      }

      const uploadStartedAt = Date.now();
      const uploadResponse = await uploadFetch(upload.signed_upload_url, {
        method: "PUT",
        headers: { "content-type": upload.content_type },
        body,
        signal: AbortSignal.timeout(RELAY_STORAGE_TIMEOUT_MS)
      });
      if (!uploadResponse.ok) {
        throw Object.assign(new Error(`Relayed storage upload failed: ${uploadResponse.status}`), {
          code: "relay_storage_upload_failed",
          retryable: uploadResponse.status >= 500
        });
      }

      const verified = await verifyPayload({
        ...metadata,
        assetId,
        objectPath: upload.object_path,
        contentType: upload.content_type,
        size: expectedSize
      }, context, startedAt);
      if (verified.statusCode !== 200 || verified.body?.ok !== true) {
        sendJson(res, verified.statusCode, verified.body);
        return;
      }

      sendJson(res, 200, {
        ...verified.body,
        asset_id: assetId,
        upload: publicUploadIdentity(upload),
        relay_timing: {
          browser_body_bytes: body.length,
          storage_upload_ms: Date.now() - uploadStartedAt,
          total_ms: Date.now() - startedAt
        }
      });
    } catch (error) {
      const code = String(error?.code || "listing_image_upload_relay_failed");
      const tooLarge = code === "relay_body_too_large";
      const invalid = code.startsWith("relay_") && !code.includes("storage_upload_failed") && !tooLarge;
      console.warn(JSON.stringify({
        event: "listing_image_upload_relay_failed",
        request_id: context.requestId,
        tenant_id: context.tenantId,
        code,
        elapsed_ms: Date.now() - startedAt,
        message: sanitizeOperationalText(error?.message || code, 200)
      }));
      sendJson(res, tooLarge ? 413 : invalid ? 400 : 503, {
        ok: false,
        code,
        retryable: !invalid && !tooLarge,
        message: sanitizeOperationalText(error?.message || "Unable to relay image upload.", 240)
      });
    }
  };
}

export default createListingImageUploadRelayHandler();
