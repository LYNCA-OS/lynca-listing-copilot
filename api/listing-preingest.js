import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { processQueuedPreingestionOcrJobs } from "../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import {
  buildPreingestionCropPlan,
  buildPreingestionQualitySummary,
  buildPreingestionWorkerJobs,
  createPreIngestionBundle,
  dedupePreingestionImages,
  enqueuePreIngestionJobs,
  normalizeDerivedImageRecord,
  normalizePreingestionImageRecord,
  preingestionStatuses,
  readDerivedImageAssetsByAssetId,
  readPreIngestionBundle,
  readPreIngestionBundleIdByAsset,
  readVerifiedImageRecordsByAssetId,
  summarizePreIngestionBundle,
  upsertPreIngestionBundle
} from "../lib/listing/preingestion/preingestion-bundle.mjs";

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

function safeString(value) {
  return String(value || "").trim();
}

function normalizePayloadImages(images = [], assetId = "") {
  return (Array.isArray(images) ? images : [])
    .map((image, index) => normalizePreingestionImageRecord(image, {
      fallbackAssetId: assetId,
      index
    }))
    .filter((image) => image.object_path && image.object_verified);
}

function normalizeVerificationRows(rows = [], assetId = "") {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizePreingestionImageRecord({
      ...row,
      source_table: "listing_image_verifications"
    }, {
      fallbackAssetId: assetId,
      index
    }))
    .filter((image) => image.object_path && image.object_verified);
}

function normalizeDerivedRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeDerivedImageRecord({
      ...row,
      source_table: "image_derived_assets"
    }, { index }))
    .filter((image) => image.object_path);
}

async function countSignedReadUrls(images, tenantId, env, fetchImpl) {
  const results = await Promise.all(images.map(async (image) => {
    try {
      await createListingImageSignedReadUrl({
        objectPath: image.object_path,
        tenantId,
        bucket: image.bucket,
        env,
        fetchImpl
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        object_path: image.object_path,
        reason: String(error.message || "signed_url_failed").slice(0, 160)
      };
    }
  }));
  const signedReadUrlCount = results.filter((result) => result.ok).length;
  const errors = results.filter((result) => !result.ok);
  return { signedReadUrlCount, errors };
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
    limit: 180,
    windowMs: 60_000,
    message: "Too many pre-ingestion requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req) || "{}");
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  const assetId = safeString(payload.asset_id || payload.assetId);
  if (!assetId) {
    sendJson(res, 400, { ok: false, message: "asset_id is required." });
    return;
  }

  try {
    const [verificationRows, derivedRows, existingBundleId] = await Promise.all([
      readVerifiedImageRecordsByAssetId({
        assetId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }),
      readDerivedImageAssetsByAssetId({
        assetId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }),
      readPreIngestionBundleIdByAsset({
        assetId,
        tenantId: context.tenantId,
        source: payload.source || "listing_preingest_api",
        env: process.env,
        fetchImpl: globalThis.fetch
      })
    ]);
    const images = dedupePreingestionImages([
      ...normalizeVerificationRows(verificationRows, assetId),
      ...normalizePayloadImages(payload.images, assetId)
    ]);
    const derivedImages = normalizeDerivedRows(derivedRows);

    if (!images.length) {
      sendJson(res, 400, {
        ok: false,
        code: "preingestion_no_verified_images",
        message: "No verified storage images were found for this asset."
      });
      return;
    }

    const captureQuality = payload.capture_quality || payload.captureQuality || null;
    const cropPlan = buildPreingestionCropPlan({
      assetId,
      images,
      captureQuality,
      requestedFields: payload.requested_fields || payload.requestedFields || []
    });
    const qualitySummary = buildPreingestionQualitySummary({
      images,
      derivedImages,
      captureQuality,
      cropPlan
    });

    const signed = payload.verify_signed_read_urls === false
      ? { signedReadUrlCount: 0, errors: [] }
      : await countSignedReadUrls(images, context.tenantId, process.env, globalThis.fetch);

    const existingBundle = existingBundleId
      ? await readPreIngestionBundle({
        bundleId: existingBundleId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }).then((result) => result.bundle || null).catch(() => null)
      : null;
    const incomingInitialEvidence = payload.initial_evidence || payload.initialEvidence || {};
    const incomingEvidencePatches = payload.evidence_patches || payload.evidencePatches || [];
    const bundle = createPreIngestionBundle({
      tenantId: context.tenantId,
      assetId,
      bundleId: existingBundleId,
      source: payload.source || "listing_preingest_api",
      status: signed.errors.length ? preingestionStatuses.PARTIAL : preingestionStatuses.READY,
      images,
      derivedImages,
      // Re-ingestion refreshes images/crops but must never erase already
      // computed evidence. Old cards therefore reuse OCR instead of paying to
      // rediscover the same serial/grade on every title request.
      initialEvidence: {
        ...(existingBundle?.initial_evidence || {}),
        ...incomingInitialEvidence
      },
      evidencePatches: [
        ...(Array.isArray(existingBundle?.evidence_patches) ? existingBundle.evidence_patches : []),
        ...(Array.isArray(incomingEvidencePatches) ? incomingEvidencePatches : [])
      ],
      qualitySummary,
      cropPlan
    });
    const writeResult = await upsertPreIngestionBundle({
      bundle,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const durableBundle = writeResult.bundle || bundle;
    const enqueueWorkers = payload.enqueue_workers !== false;
    const jobs = enqueueWorkers
      ? buildPreingestionWorkerJobs({
        bundle: durableBundle,
        enableOcr: payload.enqueue_ocr !== false,
        enableOcrDetail: payload.enqueue_ocr_detail === true
          || String(process.env.PREINGESTION_OCR_DETAIL_JOBS_ENABLED || "false").toLowerCase() === "true",
        enableEmbeddings: payload.enqueue_embeddings === true,
        enableSurface: payload.enqueue_surface === true,
        enableQuality: payload.enqueue_quality === true
      })
      : [];
    const enqueueResult = enqueueWorkers
      ? await enqueuePreIngestionJobs({
        jobs,
        env: process.env,
        fetchImpl: globalThis.fetch
      })
      : { enqueued: 0, durable: true, skipped: true };

    if ((enqueueResult.enqueued || 0) > 0) {
      // Consume the OCR jobs right after responding so evidence patches are
      // already on the bundle by the time the title request loads it. The
      // worker fails closed (jobs stay queued) when PaddleOCR is unconfigured;
      // /api/v4/listing-preingest-worker re-sweeps anything left behind.
      waitUntil(processQueuedPreingestionOcrJobs({
        tenantId: context.tenantId,
        assetId,
        bundleId: durableBundle.bundle_id,
        // Writer-critical hard text gets the first wave. Context crops are
        // durable background work and must not occupy serial/grade capacity.
        limit: 6,
        anchorOnly: true,
        env: process.env,
        fetchImpl: globalThis.fetch
      }).catch(() => {}));
    }

    sendJson(res, 200, {
      ok: true,
      tenant_id: context.tenantId,
      bundle_id: durableBundle.bundle_id,
      bundle_status: durableBundle.status,
      saved: Boolean(writeResult.saved),
      worker_jobs_enqueued: enqueueResult.enqueued || 0,
      worker_jobs_attempted: enqueueResult.attempted || jobs.length,
      signed_read_url_count: signed.signedReadUrlCount,
      signed_read_url_error_count: signed.errors.length,
      preprocessing_summary: {
        ...summarizePreIngestionBundle(durableBundle),
        signed_read_url_count: signed.signedReadUrlCount,
        signed_read_url_error_count: signed.errors.length,
        worker_jobs_enqueued: enqueueResult.enqueued || 0,
        worker_jobs_attempted: enqueueResult.attempted || jobs.length
      }
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      code: "preingestion_failed",
      message: String(error.message || "Pre-ingestion failed.").slice(0, 240)
    });
  }
}
