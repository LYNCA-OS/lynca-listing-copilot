import { waitUntil } from "@vercel/functions";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
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

async function countSignedReadUrls(images, env, fetchImpl) {
  let signedReadUrlCount = 0;
  const errors = [];
  for (const image of images) {
    try {
      await createListingImageSignedReadUrl({
        objectPath: image.object_path,
        bucket: image.bucket,
        env,
        fetchImpl
      });
      signedReadUrlCount += 1;
    } catch (error) {
      errors.push({
        object_path: image.object_path,
        reason: String(error.message || "signed_url_failed").slice(0, 160)
      });
    }
  }
  return { signedReadUrlCount, errors };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authenticated = readSignedSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);
  if (!authenticated) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
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
    const verificationRows = await readVerifiedImageRecordsByAssetId({
      assetId,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const derivedRows = await readDerivedImageAssetsByAssetId({
      assetId,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
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
      : await countSignedReadUrls(images, process.env, globalThis.fetch);

    const existingBundleId = await readPreIngestionBundleIdByAsset({
      assetId,
      source: payload.source || "listing_preingest_api",
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const bundle = createPreIngestionBundle({
      assetId,
      bundleId: existingBundleId,
      source: payload.source || "listing_preingest_api",
      status: signed.errors.length ? preingestionStatuses.PARTIAL : preingestionStatuses.READY,
      images,
      derivedImages,
      initialEvidence: payload.initial_evidence || payload.initialEvidence || {},
      evidencePatches: payload.evidence_patches || payload.evidencePatches || [],
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
        enableEmbeddings: payload.enqueue_embeddings !== false,
        enableSurface: payload.enqueue_surface !== false,
        enableQuality: payload.enqueue_quality !== false
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
        assetId,
        bundleId: durableBundle.bundle_id,
        env: process.env,
        fetchImpl: globalThis.fetch
      }).catch(() => {}));
    }

    sendJson(res, 200, {
      ok: true,
      bundle_id: durableBundle.bundle_id,
      bundle_status: durableBundle.status,
      saved: Boolean(writeResult.saved),
      worker_jobs_enqueued: enqueueResult.enqueued || 0,
      signed_read_url_count: signed.signedReadUrlCount,
      signed_read_url_error_count: signed.errors.length,
      preprocessing_summary: {
        ...summarizePreIngestionBundle(durableBundle),
        signed_read_url_count: signed.signedReadUrlCount,
        signed_read_url_error_count: signed.errors.length,
        worker_jobs_enqueued: enqueueResult.enqueued || 0
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
