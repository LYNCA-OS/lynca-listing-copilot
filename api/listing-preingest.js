import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  CanonicalImageReferenceError,
  readCanonicalListingImageReferences
} from "../lib/listing/storage/canonical-image-references.mjs";
import { assertTenantListingAssetObjectPath } from "../lib/listing/storage/storage-verification-store.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { normalizeDurableListingAssetId } from "../lib/tenant/assets.mjs";
import {
  buildPreingestionCropPlan,
  buildPreingestionQualitySummary,
  createPreIngestionBundle,
  dedupePreingestionImages,
  normalizePreingestionImageRecord,
  preingestionOcrJobKeyPrefix,
  preingestionStatuses,
  readPreIngestionBundle,
  readPreIngestionBundleIdByAsset,
  summarizePreIngestionBundle,
  upsertPreIngestionBundle
} from "../lib/listing/preingestion/preingestion-bundle.mjs";
import { buildServerCaptureQualityFromCanonicalImages } from "../lib/listing/image-quality/quality-gate.mjs";
import { paddleOcrConfig } from "../lib/listing/ocr/paddle-ocr-client.mjs";
import {
  readJsonPayload,
  requestPayloadErrorStatus
} from "../lib/listing/v4/session/http-handler-utils.mjs";

const allowedBrowserSources = new Set([
  "listing_preingest_api",
  "listing_copilot_background_prepare"
]);
const preingestionRequestMaxBytes = 64 * 1024;
const productionRequestedFields = Object.freeze([
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_label",
  "year_product",
  "subject",
  "surface"
]);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function safeString(value) {
  return String(value || "").trim();
}

function allowedBrowserSource(value) {
  const source = safeString(value);
  return allowedBrowserSources.has(source) ? source : "listing_preingest_api";
}

function normalizeCanonicalImages(canonical = {}, assetId = "", tenantId = "") {
  if (safeString(canonical.tenant_id) !== tenantId) {
    throw new CanonicalImageReferenceError("canonical_image_tenant_mismatch");
  }
  if (
    safeString(canonical.asset_id) !== assetId
    || safeString(canonical.image_generation_id) !== assetId
  ) {
    throw new CanonicalImageReferenceError("canonical_image_generation_mismatch");
  }

  const normalizedImages = (Array.isArray(canonical.images) ? canonical.images : []).map((image, index) => {
    if (
      safeString(image.asset_id || image.assetId) !== assetId
      || safeString(image.image_generation_id || image.imageGenerationId) !== assetId
    ) {
      throw new CanonicalImageReferenceError("canonical_image_generation_mismatch");
    }
    try {
      assertTenantListingAssetObjectPath({
        tenantId,
        assetId,
        objectPath: image.object_path || image.objectPath
      });
    } catch (error) {
      throw new CanonicalImageReferenceError("canonical_image_object_path_out_of_scope", { cause: error });
    }
    const normalized = normalizePreingestionImageRecord({
      ...image,
      // The canonical resolver already requires and verifies the persisted
      // full-object digest before returning an image.
      content_hash_verified: true,
      source_table: "listing_image_verifications"
    }, {
      fallbackAssetId: assetId,
      index
    });
    if (
      !normalized.object_path
      || !normalized.object_verified
      || !normalized.content_hash_verified
      || !normalized.content_sha256
    ) {
      throw new CanonicalImageReferenceError("canonical_image_verification_incomplete");
    }
    return normalized;
  });
  const deduped = dedupePreingestionImages(normalizedImages);
  if (deduped.length !== normalizedImages.length) {
    throw new CanonicalImageReferenceError("canonical_image_semantic_duplicate");
  }
  return deduped;
}

function trustedExistingEvidencePatches(bundle = {}, images = [], { ocrWorkerRevision = "" } = {}) {
  const persistedBundle = bundle && typeof bundle === "object" ? bundle : {};
  const bundleId = safeString(persistedBundle.bundle_id);
  const sourceImageIds = new Set(images.map((image) => safeString(image.image_id)).filter(Boolean));
  const versionPrefix = preingestionOcrJobKeyPrefix({ ocrWorkerRevision });
  const jobPrefix = versionPrefix && bundleId ? `${versionPrefix}${bundleId}:` : "";
  return (Array.isArray(persistedBundle.evidence_patches) ? persistedBundle.evidence_patches : []).filter((patch) => {
    const provenance = patch?.provenance && typeof patch.provenance === "object"
      ? patch.provenance
      : {};
    return safeString(patch?.source_type).toUpperCase() === "OCR"
      && safeString(provenance.generated_by) === "preingestion_ocr_worker"
      && Boolean(jobPrefix)
      && safeString(provenance.job_key).startsWith(jobPrefix)
      && sourceImageIds.has(safeString(patch?.source_image_id));
  });
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-preingest" });
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
    scope: "listing_preingest",
    // Background preparation is one request per card and is idempotent by
    // asset/source/version. Leave headroom for bounded retries in 100-card runs.
    limit: 600,
    windowMs: 60_000,
    message: "Too many pre-ingestion requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req, { maxBytes: preingestionRequestMaxBytes });
  } catch (error) {
    const status = requestPayloadErrorStatus(error);
    sendJson(res, status, {
      ok: false,
      code: status === 413 ? "preingestion_request_too_large" : "preingestion_invalid_request",
      message: status === 413 ? "Pre-ingestion request is too large." : "Invalid request."
    });
    return;
  }

  const rawAssetId = safeString(payload.asset_id || payload.assetId);
  if (!rawAssetId) {
    sendJson(res, 400, { ok: false, message: "asset_id is required." });
    return;
  }
  let assetId;
  try {
    assetId = normalizeDurableListingAssetId(rawAssetId);
  } catch {
    sendJson(res, 400, {
      ok: false,
      code: "invalid_durable_listing_asset_id",
      message: "asset_id must be a server-created durable listing asset id."
    });
    return;
  }

  try {
    const source = allowedBrowserSource(payload.source);
    const [canonical, existingBundleId] = await Promise.all([
      readCanonicalListingImageReferences({
        assetId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }),
      readPreIngestionBundleIdByAsset({
        assetId,
        tenantId: context.tenantId,
        source,
        env: process.env,
        fetchImpl: globalThis.fetch
      })
    ]);
    // The browser is scheduling work, not defining image identity. Replace
    // every client image claim with the current server-verified canonical set.
    const images = normalizeCanonicalImages(canonical, assetId, context.tenantId);
    const derivedImages = [];

    if (!images.length) {
      sendJson(res, 400, {
        ok: false,
        code: "preingestion_no_verified_images",
        message: "No verified storage images were found for this asset."
      });
      return;
    }

    const captureQuality = buildServerCaptureQualityFromCanonicalImages(images, {
      imageGenerationHash: canonical.image_set_sha256
    });
    const cropPlan = buildPreingestionCropPlan({
      assetId,
      images,
      captureQuality,
      requestedFields: productionRequestedFields
    });
    const qualitySummary = buildPreingestionQualitySummary({
      images,
      derivedImages,
      captureQuality,
      clientCaptureQuality: null,
      cropPlan
    });
    // This endpoint only prepares canonical metadata before the writer clicks
    // Generate. Signed provider reads and paid OCR work are committed by the
    // server after durable recognition enqueue, never by browser flags.
    const signed = { signedReadUrlCount: 0, errors: [] };
    const paddleOcr = paddleOcrConfig(process.env);

    const existingBundle = existingBundleId
      ? await readPreIngestionBundle({
        bundleId: existingBundleId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }).then((result) => result.bundle || null)
      : null;
    const bundle = createPreIngestionBundle({
      tenantId: context.tenantId,
      assetId,
      bundleId: existingBundleId,
      source,
      status: signed.errors.length ? preingestionStatuses.PARTIAL : preingestionStatuses.READY,
      images,
      derivedImages,
      // This browser-facing endpoint never accepts evidence. Only evidence
      // written by the authenticated OCR worker survives a re-ingestion; old
      // client-authored initial evidence is intentionally retired.
      initialEvidence: {},
      evidencePatches: trustedExistingEvidencePatches(existingBundle, images, {
        ocrWorkerRevision: paddleOcr.worker_revision
      }),
      qualitySummary,
      cropPlan
    });
    const writeResult = await upsertPreIngestionBundle({
      bundle,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const durableBundle = writeResult.bundle || bundle;
    const enqueueResult = { enqueued: 0, attempted: 0, durable: true, skipped: true };
    const ocrDispatchStarted = false;

    sendJson(res, 200, {
      ok: true,
      tenant_id: context.tenantId,
      bundle_id: durableBundle.bundle_id,
      bundle_status: durableBundle.status,
      saved: Boolean(writeResult.saved),
      worker_jobs_enqueued: enqueueResult.enqueued || 0,
      worker_jobs_attempted: 0,
      ocr_dispatch_started: ocrDispatchStarted,
      signed_read_url_count: signed.signedReadUrlCount,
      signed_read_url_error_count: signed.errors.length,
      preprocessing_summary: {
        ...summarizePreIngestionBundle(durableBundle),
        signed_read_url_count: signed.signedReadUrlCount,
        signed_read_url_error_count: signed.errors.length,
        worker_jobs_enqueued: enqueueResult.enqueued || 0,
        worker_jobs_attempted: 0,
        ocr_dispatch_started: ocrDispatchStarted,
        ocr_verifier_enabled: paddleOcr.enabled === true,
        ocr_verifier_configured: paddleOcr.configured === true && Boolean(paddleOcr.token),
        ocr_jobs_suppressed_unavailable: false,
        paid_work_deferred_until_recognition_commit: true
      }
    });
  } catch (error) {
    if (error instanceof CanonicalImageReferenceError) {
      sendJson(res, error.statusCode || 422, {
        ok: false,
        code: error.code,
        retryable: error.retryable === true,
        message: "The verified image set is not ready for pre-ingestion."
      });
      return;
    }
    sendJson(res, 500, {
      ok: false,
      code: "preingestion_failed",
      message: String(error.message || "Pre-ingestion failed.").slice(0, 240)
    });
  }
}
