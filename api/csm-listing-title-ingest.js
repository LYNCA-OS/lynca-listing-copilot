import { createHash } from "node:crypto";

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest,
  sanitizeOperationalText,
  safeClientTiming
} from "../lib/observability/production-events.mjs";
import { listingImageStorageReadiness } from "../lib/listing/storage/storage-config.mjs";
import {
  buildListingImageObjectPath,
  createListingImageSignedUpload
} from "../lib/listing/storage/supabase-image-storage.mjs";
import { readCanonicalListingImageReferences } from "../lib/listing/storage/canonical-image-references.mjs";
import {
  RECOGNITION_DERIVED_LANE_VERSION,
  RECOGNITION_DOWNSCALE_LONG_EDGE,
  RECOGNITION_DOWNSCALE_TRANSFORM_VERSION,
  recognitionDerivedLaneEligible,
  validOriginalFingerprintList
} from "../app/recognition-derived-contract.mjs";
import {
  createIdempotentListingAssetId,
  createTenantListingAsset
} from "../lib/tenant/assets.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { runDirectCsmAsset } from "./csm-listing-title.js";
import { verifyListingImagePayload } from "./listing-image-verify-upload.js";
import {
  decodeRelayMetadata,
  LISTING_IMAGE_RELAY_MAX_BYTES,
  readBoundedBinaryBody
} from "./listing-image-upload-relay.js";

const MAX_IMAGES = 2;
const MAX_BODY_BYTES = LISTING_IMAGE_RELAY_MAX_BYTES;
const STORAGE_TIMEOUT_MS = 10_000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function headerValue(req, name) {
  const value = req?.headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function requiredText(value, code) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(code), { statusCode: 400 });
  return text;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeImages(metadata, body, { recognitionInputOnly = false } = {}) {
  const input = Array.isArray(metadata.images) ? metadata.images : [];
  if (!input.length || input.length > MAX_IMAGES) {
    throw Object.assign(new Error("ingest_image_count_invalid"), { statusCode: 400 });
  }
  let offset = 0;
  return input.map((image, index) => {
    const size = Number(image.size || 0);
    if (!Number.isInteger(size) || size < 1 || offset + size > body.length) {
      throw Object.assign(new Error("ingest_image_size_invalid"), { statusCode: 400 });
    }
    const bytes = body.subarray(offset, offset + size);
    offset += size;
    const contentSha256 = requiredText(image.contentSha256 || image.content_sha256, "ingest_image_hash_missing").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(contentSha256) || sha256(bytes) !== contentSha256) {
      throw Object.assign(new Error("ingest_image_hash_mismatch"), { statusCode: 400 });
    }
    return {
      bytes,
      imageId: requiredText(image.imageId || image.image_id, "ingest_image_id_missing"),
      role: String(image.role || (index === 0 ? "image_1_original" : "image_2_original")),
      fileName: requiredText(image.fileName || image.file_name, "ingest_image_name_missing"),
      contentType: requiredText(image.contentType || image.content_type, "ingest_image_type_missing").toLowerCase(),
      size,
      width: Number(image.width),
      height: Number(image.height),
      signatureHex: recognitionInputOnly
        ? String(image.signatureHex || image.signature_hex || "").trim()
        : requiredText(image.signatureHex || image.signature_hex, "ingest_image_signature_missing"),
      contentSha256,
      sourceImageId: String(image.sourceImageId || image.source_image_id || "").trim(),
      transformVersion: String(image.transformVersion || image.transform_version || "").trim()
    };
  }).map((image, index, images) => {
    if (offset !== body.length && index === images.length - 1) {
      throw Object.assign(new Error("ingest_body_size_mismatch"), { statusCode: 400 });
    }
    return image;
  });
}

function strictExpectedOriginalCount(metadata = {}) {
  const count = Number(metadata.expectedOriginalCount || metadata.expected_original_count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES) {
    throw Object.assign(new Error("ingest_expected_original_count_invalid"), { statusCode: 400 });
  }
  return count;
}

export function buildInlineRecognitionInput(metadata, images) {
  const expectedOriginalCount = strictExpectedOriginalCount(metadata);
  const originalFingerprints = metadata.originalFingerprints || metadata.original_fingerprints;
  const laneVersion = String(metadata.laneVersion || metadata.lane_version || "").trim();
  if (laneVersion !== RECOGNITION_DERIVED_LANE_VERSION) {
    throw Object.assign(new Error("ingest_recognition_lane_version_invalid"), { statusCode: 400 });
  }
  if (!validOriginalFingerprintList(originalFingerprints, expectedOriginalCount)) {
    throw Object.assign(new Error("ingest_original_fingerprints_invalid"), { statusCode: 400 });
  }
  if (!recognitionDerivedLaneEligible({
    originalCount: expectedOriginalCount,
    inputs: images
  })) {
    throw Object.assign(new Error("ingest_recognition_input_not_eligible"), { statusCode: 400 });
  }
  const expectedRoles = ["front_original", "back_original"];
  const recognitionInput = images.map((image, index) => {
    if (!image.sourceImageId
        || image.transformVersion !== RECOGNITION_DOWNSCALE_TRANSFORM_VERSION
        || !Number.isFinite(image.width)
        || !Number.isFinite(image.height)
        || image.width < 1
        || image.height < 1
        || Math.max(image.width, image.height) > RECOGNITION_DOWNSCALE_LONG_EDGE) {
      throw Object.assign(new Error("ingest_recognition_input_lineage_invalid"), { statusCode: 400 });
    }
    return {
      image_role: expectedRoles[index],
      read: "readability_derived_inline",
      bytes: image.size,
      original_bytes: null,
      derived_available: true,
      derived_bytes: image.size,
      source_image_id: image.sourceImageId,
      transform_version: image.transformVersion,
      lane_version: laneVersion,
      content_sha256: image.contentSha256,
      original_content_sha256: String(originalFingerprints[index]).slice("sha256:".length)
    };
  });
  return { expectedOriginalCount, originalFingerprints, laneVersion, recognitionInput };
}

export function validateRecognitionInputAssetId(metadata, deterministicAssetId) {
  const supplied = requiredText(
    metadata.assetId || metadata.asset_id,
    "ingest_recognition_asset_id_missing"
  );
  if (supplied !== deterministicAssetId) {
    throw Object.assign(new Error("ingest_recognition_asset_id_mismatch"), { statusCode: 409 });
  }
  return supplied;
}

export function recognitionManualRetry(metadata = {}) {
  return metadata.manualRetry === true || metadata.manual_retry === true;
}

function buildCanonical({ tenantId, assetId, images, bucket, now }) {
  const canonicalImages = images.map((image, index) => {
    const objectPath = buildListingImageObjectPath({
      tenantId,
      assetId,
      imageId: image.imageId,
      role: image.role,
      fileName: image.fileName,
      contentType: image.contentType,
      now
    });
    return {
      id: image.imageId,
      image_id: image.imageId,
      name: image.fileName,
      type: image.contentType,
      content_type: image.contentType,
      size: image.size,
      width: image.width,
      height: image.height,
      storageRole: image.role,
      storage_role: image.role,
      role: image.role,
      contentSha256: image.contentSha256,
      content_sha256: image.contentSha256,
      objectPath,
      object_path: objectPath,
      bucket,
      storageVerified: true,
      storage_verified: true,
      storageUploaded: true,
      assetId,
      asset_id: assetId,
      imageGenerationId: assetId,
      image_generation_id: assetId,
      derived: false,
      source: image
    };
  });
  const imageReferences = canonicalImages.map((image, index) => ({
    image_id: image.image_id,
    image_role: index === 0 ? "front_original" : "back_original",
    bucket: image.bucket,
    object_path: image.object_path,
    content_sha256: image.content_sha256,
    derived: false,
    source_image_id: null,
    source_region: null,
    crop_metadata: null
  }));
  const imageSetSha256 = sha256(imageReferences.map((reference) => [
    reference.image_role,
    reference.image_id,
    reference.bucket,
    reference.object_path,
    reference.content_sha256,
    "",
    ""
  ].join("\u001f")).join("\u001e"));
  return {
    tenant_id: tenantId,
    asset_id: assetId,
    image_generation_id: assetId,
    expected_original_count: canonicalImages.length,
    image_set_sha256: imageSetSha256,
    image_paths: {
      front_bucket: imageReferences[0]?.bucket || null,
      front_object_path: imageReferences[0]?.object_path || null,
      front_content_sha256: imageReferences[0]?.content_sha256 || null,
      back_bucket: imageReferences[1]?.bucket || null,
      back_object_path: imageReferences[1]?.object_path || null,
      back_content_sha256: imageReferences[1]?.content_sha256 || null,
      additional_image_paths: []
    },
    images: canonicalImages,
    image_references: imageReferences
  };
}

async function persistImage({ image, tenantId, assetId, context, now }) {
  const upload = await createListingImageSignedUpload({
    tenantId,
    assetId,
    imageId: image.imageId,
    role: image.role,
    fileName: image.fileName,
    contentType: image.contentType,
    size: image.size,
    width: image.width,
    height: image.height,
    signatureHex: image.signatureHex,
    contentSha256: image.contentSha256,
    now
  });
  const response = await fetch(upload.signed_upload_url, {
    method: "PUT",
    headers: { "content-type": upload.content_type },
    body: image.bytes,
    signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS)
  });
  if (!response.ok) throw Object.assign(new Error(`ingest_storage_upload_failed:${response.status}`), { statusCode: 503 });
  const verified = await verifyListingImagePayload({
    assetId,
    imageId: image.imageId,
    role: image.role,
    fileName: image.fileName,
    objectPath: upload.object_path,
    contentType: upload.content_type,
    size: image.size,
    width: image.width,
    height: image.height,
    signatureHex: image.signatureHex,
    contentSha256: image.contentSha256
  }, context);
  if (verified.statusCode !== 200 || verified.body?.ok !== true) {
    throw Object.assign(new Error(verified.body?.code || "ingest_storage_verification_failed"), {
      statusCode: verified.statusCode,
      retryable: verified.body?.retryable === true
    });
  }
  const { signed_upload_url: _signedUrl, ...publicUpload } = upload;
  return { image_id: image.imageId, upload: publicUpload, ...verified.body };
}

/**
 * Client-reported stage timings, reduced to plain bounded numbers.
 *
 * These arrive in a header the browser controls, so they are shaped and capped
 * before they reach a column: snake_case keys only, finite non-negative numbers
 * only, and a bounded count. They describe the client's own work and are never
 * read back as truth about the server.
 */
export default async function handler(req, res) {
  const startedAt = Date.now();
  let recoveryIdentity = null;
  let storagePromise = null;
  instrumentProductionRequest(req, res, { api: "/api/csm-listing-title-ingest" });
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, message: "Method not allowed" });
  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.CREATE_JOB });
    bindProductionRequestContext(res, context);
  } catch (error) {
    const status = isTenantAuthError(error) ? error.statusCode : 503;
    return sendJson(res, status, publicTenantAuthError(error));
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "csm_listing_title_ingest",
    limit: 600,
    windowMs: 60_000,
    identifier: `${context.tenantId}:${context.userId}`,
    message: "Too many recognition requests. Please try again shortly."
  })) return;

  try {
    const metadata = decodeRelayMetadata(headerValue(req, "x-lynca-ingest-metadata"));
    const body = await readBoundedBinaryBody(req, MAX_BODY_BYTES);
    const recognitionInputOnly = metadata.recognitionInputOnly === true
      || metadata.recognition_input_only === true;
    const images = normalizeImages(metadata, body, { recognitionInputOnly });
    const idempotencyKey = requiredText(metadata.idempotencyKey || metadata.idempotency_key, "ingest_idempotency_key_missing");
    const clientAssetRef = requiredText(metadata.clientAssetRef || metadata.client_asset_ref, "ingest_client_asset_ref_missing");
    const intentId = requiredText(metadata.intentId || metadata.intent_id, "ingest_intent_id_missing");
    const assetId = createIdempotentListingAssetId({ tenantId: context.tenantId, idempotencyKey });
    if (recognitionInputOnly) validateRecognitionInputAssetId(metadata, assetId);
    const now = new Date();
    recoveryIdentity = {
      asset_id: assetId,
      tenant_id: context.tenantId,
      client_asset_ref: clientAssetRef,
      image_generation_id: assetId,
      expected_original_count: images.length
    };

    if (recognitionInputOnly) {
      const inline = buildInlineRecognitionInput(metadata, images);
      if (inline.expectedOriginalCount !== images.length) {
        throw Object.assign(new Error("ingest_recognition_input_count_mismatch"), { statusCode: 400 });
      }
      recoveryIdentity.expected_original_count = inline.expectedOriginalCount;
      // The browser has already created and awaited this deterministic asset
      // while preparing the derived bytes. Recognition-only must not race a
      // second asset upsert after the provider returns.
      const recognitionImages = images.map((image, index) => ({
        ...image,
        objectPath: `inline-derived/${index}/${image.contentSha256}`,
        object_path: `inline-derived/${index}/${image.contentSha256}`,
        derived: true
      }));
      const result = await runDirectCsmAsset({
        tenantId: context.tenantId,
        userId: context.userId,
        assetId,
        intentId,
        imageDetail: metadata.imageDetail || metadata.image_detail || "high",
        checkpointOnly: true,
        manualRetry: recognitionManualRetry(metadata),
        clientTiming: metadata.clientTiming || metadata.client_timing || null,
        serverPrologueStages: { ingest_body_bytes: body.length },
        dependencies: {
          readImages: async () => ({
            tenant_id: context.tenantId,
            asset_id: assetId,
            image_generation_id: assetId,
            expected_original_count: inline.expectedOriginalCount,
            images: [],
            image_references: []
          }),
          imageFingerprints: inline.originalFingerprints,
          recognitionImages,
          recognitionInput: inline.recognitionInput,
          operationScope: "derived_checkpoint",
          laneVersion: inline.laneVersion,
          signImage: async ({ image }) => {
            if (!image?.bytes || !Buffer.isBuffer(image.bytes)) {
              throw new Error("ingest_recognition_inline_bytes_missing");
            }
            return `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
          }
        }
      });
      return sendJson(res, 200, {
        ok: true,
        route: "CSM_THIN_DIRECT_INGEST",
        cloud_run_calls: 0,
        vector_calls: 0,
        asset_id: assetId,
        tenant_id: context.tenantId,
        client_asset_ref: clientAssetRef,
        image_generation_id: assetId,
        expected_original_count: inline.expectedOriginalCount,
        trace_status: "CHECKPOINTED",
        checkpoint_state: "STAGED",
        ingest_timing: { body_bytes: body.length, total_ms: Date.now() - startedAt },
        ...result,
        latency_stages_ms: {
          ...safeClientTiming(metadata.clientTiming || metadata.client_timing),
          ...(result?.latency_stages_ms || {}),
          ingest_body_bytes: body.length,
          ingest_total_ms: Date.now() - startedAt
        }
      });
    }

    const bucket = listingImageStorageReadiness(process.env).bucket;
    const canonical = buildCanonical({ tenantId: context.tenantId, assetId, images, bucket, now });

    const assetPromise = createTenantListingAsset({
      tenantId: context.tenantId,
      clientAssetRef,
      idempotencyKey,
      captureProfileId: metadata.captureProfileId || metadata.capture_profile_id,
      category: metadata.category,
      expectedOriginalCount: images.length
    });
    storagePromise = assetPromise.then(() => Promise.all(images.map((image) => persistImage({
      image,
      tenantId: context.tenantId,
      assetId,
      context,
      now
    }))));
    // The provider precondition can fail before persistPath awaits this branch.
    // Observe the rejection immediately so a concurrent Storage error cannot
    // terminate the function before the structured CSM response is returned.
    void storagePromise.catch(() => null);
    const imageByPath = new Map(canonical.images.map((image) => [image.object_path, image.source]));
    const result = await runDirectCsmAsset({
      tenantId: context.tenantId,
      userId: context.userId,
      assetId,
      intentId,
      imageDetail: metadata.imageDetail || metadata.image_detail || "high",
      // Into the run, not merged onto the response afterwards.
      //
      // The merge below happens after `runDirectCsmAsset` has already written
      // `latency_stages_ms` to the session, so it only ever decorated the HTTP
      // reply and never reached a column. Three consecutive production batches
      // recorded ten server stages and no client stages because of this, and
      // the absence was misread twice: first as the client not sending them,
      // then as the request taking the other endpoint -- a conclusion drawn
      // from "the row has no ingest_ keys", which is not evidence of the path,
      // since those keys are added after the row is written too.
      clientTiming: metadata.clientTiming || metadata.client_timing || null,
      // The uploaded size is known before the run and is the number the
      // latency question turns on, so it goes in rather than being added to
      // the reply. `ingest_total_ms` stays out: it measures the request that
      // contains the persistence, so it cannot precede it.
      serverPrologueStages: { ingest_body_bytes: body.length },
      dependencies: {
        readImages: async () => canonical,
        signImage: async ({ objectPath }) => {
          const image = imageByPath.get(objectPath);
          if (!image) throw new Error("ingest_image_reference_missing");
          return `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
        },
        readSessionImages: async () => {
          await storagePromise;
          return readCanonicalListingImageReferences({
            tenantId: context.tenantId,
            assetId,
            env: process.env,
            fetchImpl: globalThis.fetch
          });
        }
      }
    });
    const verifications = await storagePromise;
    return sendJson(res, 200, {
      ok: true,
      route: "CSM_THIN_DIRECT_INGEST",
      cloud_run_calls: 0,
      vector_calls: 0,
      asset_id: assetId,
      tenant_id: context.tenantId,
      client_asset_ref: clientAssetRef,
      image_generation_id: assetId,
      expected_original_count: images.length,
      verifications,
      recognition_session_id: result.csm_rows.resolution.recognition_session_id,
      trace_status: "PERSISTED",
      ingest_timing: { body_bytes: body.length, total_ms: Date.now() - startedAt },
      ...result,
      // The client's own stages, merged with the server's, so one row in
      // `request_logs` accounts for the whole journey.
      //
      // A production run measured 4,652ms here against roughly 23 seconds in
      // front of the operator. Everything unexplained happens on the client
      // before this request exists -- decoding, hashing and shipping the image
      // bytes -- and it was recorded nowhere: the browser computed
      // `client_total_ms` into local state and threw it away. Reading what the
      // client already sends costs nothing and makes the gap attributable.
      latency_stages_ms: {
        ...safeClientTiming(metadata.clientTiming || metadata.client_timing),
        ...(result?.latency_stages_ms || {}),
        ingest_body_bytes: body.length,
        ingest_total_ms: Date.now() - startedAt
      }
    });
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 503);
    const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503;
    const recoveredVerifications = storagePromise
      ? await storagePromise.catch(() => null)
      : null;
    return sendJson(res, safeStatus, {
      ok: false,
      route: "CSM_THIN_DIRECT_INGEST",
      code: String(error?.code || error?.message || "csm_ingest_failed").split(":")[0],
      retryable: error?.retryable === true || safeStatus >= 500,
      message: sanitizeOperationalText(error?.message || "CSM ingest failed", 240),
      ...(recoveryIdentity && recoveredVerifications ? {
        ...recoveryIdentity,
        verifications: recoveredVerifications,
        upload_recovered: true
      } : {})
    });
  }
}
