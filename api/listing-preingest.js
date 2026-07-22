import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  CanonicalImageReferenceError,
  readCanonicalListingImageReferences
} from "../lib/listing/storage/canonical-image-references.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { assertTenantListingAssetObjectPath } from "../lib/listing/storage/storage-verification-store.mjs";
import { isTenantAuthError, publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { normalizeDurableListingAssetId } from "../lib/tenant/assets.mjs";
import {
  buildPreingestionCropPlan,
  buildPreingestionQualitySummary,
  buildPreingestionWorkerJobs,
  createPreIngestionBundle,
  dedupePreingestionImages,
  enqueuePreIngestionJobs,
  normalizePreingestionImageRecord,
  preingestionBundleVersion,
  preingestionOcrJobVersion,
  preingestionStatuses,
  readCurrentPreingestionOcrJobsByAsset,
  readPreIngestionBundleByAsset,
  summarizePreIngestionBundle,
  upsertPreIngestionBundle
} from "../lib/listing/preingestion/preingestion-bundle.mjs";
import { paddleOcrConfig } from "../lib/listing/ocr/paddle-ocr-client.mjs";
import { scheduleTrustedPreingestionOcrWake } from "../lib/listing/preingestion/internal-ocr-wake.mjs";

const allowedBrowserSources = new Set([
  "listing_preingest_api",
  "listing_copilot_background_prepare"
]);

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

function trustedExistingEvidencePatches(bundle = {}, images = []) {
  const persistedBundle = bundle && typeof bundle === "object" ? bundle : {};
  const bundleId = safeString(persistedBundle.bundle_id);
  const sourceImageIds = new Set(images.map((image) => safeString(image.image_id)).filter(Boolean));
  const jobPrefix = `ocr:${preingestionOcrJobVersion}:${bundleId}:`;
  return (Array.isArray(persistedBundle.evidence_patches) ? persistedBundle.evidence_patches : []).filter((patch) => {
    const provenance = patch?.provenance && typeof patch.provenance === "object"
      ? patch.provenance
      : {};
    return safeString(patch?.source_type).toUpperCase() === "OCR"
      && safeString(provenance.generated_by) === "preingestion_ocr_worker"
      && safeString(provenance.job_key).startsWith(jobPrefix)
      && sourceImageIds.has(safeString(patch?.source_image_id));
  });
}

function stableImageIdentity(image = {}) {
  return [
    safeString(image.image_id || image.imageId || image.id),
    safeString(image.object_path || image.objectPath),
    safeString(image.content_sha256 || image.contentSha256 || image.sha256)
  ].join("\u0000");
}

function exactImageIdentityMatch(existingImages = [], canonicalImages = []) {
  if (!Array.isArray(existingImages) || existingImages.length !== canonicalImages.length) return false;
  const persisted = existingImages.map(stableImageIdentity).sort();
  const canonical = canonicalImages.map(stableImageIdentity).sort();
  return persisted.every((identity, index) => identity && identity === canonical[index]);
}

function stableCropContract(crop = {}) {
  const box = crop.crop_box || crop.cropBox || {};
  const metadata = crop.crop_metadata || crop.cropMetadata || {};
  return JSON.stringify({
    crop_id: safeString(crop.crop_id || crop.cropId || crop.id),
    source_image_id: safeString(crop.source_image_id || crop.sourceImageId),
    source_object_path: safeString(crop.source_object_path || crop.sourceObjectPath),
    role: safeString(crop.role),
    box: [box.x, box.y, box.width, box.height].map((value) => Number(value)),
    source_side: safeString(metadata.source_side || metadata.sourceSide),
    source_width: Number(metadata.source_width || metadata.sourceWidth || 0),
    source_height: Number(metadata.source_height || metadata.sourceHeight || 0)
  });
}

function exactCropContractMatch(existingCropPlan = [], requestedCropPlan = []) {
  if (!Array.isArray(existingCropPlan) || existingCropPlan.length !== requestedCropPlan.length) return false;
  const persisted = existingCropPlan.map(stableCropContract).sort();
  const requested = requestedCropPlan.map(stableCropContract).sort();
  return persisted.every((contract, index) => contract === requested[index]);
}

export function reusablePreingestionBundle({
  existingBundle,
  tenantId,
  assetId,
  source,
  images = [],
  cropPlan = [],
  currentOcrJobs = null,
  enqueueWorkers = true,
  enqueueOcr = false,
  enableOcrDetail = false,
  additionalWorkersRequested = false
} = {}) {
  const bundle = existingBundle && typeof existingBundle === "object" ? existingBundle : null;
  if (!bundle) return { reusable: false, reason: "missing_bundle" };
  if (
    safeString(bundle.bundle_version) !== preingestionBundleVersion
    || safeString(bundle.tenant_id) !== safeString(tenantId)
    || safeString(bundle.asset_id) !== safeString(assetId)
    || safeString(bundle.source) !== safeString(source)
  ) return { reusable: false, reason: "bundle_scope_or_version_mismatch" };
  if (safeString(bundle.status) !== preingestionStatuses.READY) {
    return { reusable: false, reason: "bundle_not_ready" };
  }
  if (!exactImageIdentityMatch(bundle.images, images)) {
    return { reusable: false, reason: "canonical_image_identity_changed" };
  }
  if (!exactCropContractMatch(bundle.crop_plan, cropPlan)) {
    return { reusable: false, reason: "crop_contract_changed" };
  }
  if (additionalWorkersRequested) {
    return { reusable: false, reason: "additional_worker_contract_requested" };
  }
  if (!enqueueWorkers || !enqueueOcr) {
    return { reusable: true, reason: "immutable_bundle_no_ocr_requested", expected_ocr_job_count: 0 };
  }

  const expectedJobs = buildPreingestionWorkerJobs({
    bundle,
    enableOcr: true,
    enableOcrDetail
  });
  const expectedCount = expectedJobs.length;
  const expectedKeys = new Set(expectedJobs.map((job) => safeString(job.job_key)).filter(Boolean));
  const completedKeys = new Set((Array.isArray(currentOcrJobs) ? currentOcrJobs : [])
    .filter((job) => (
      safeString(job.bundle_id) === safeString(bundle.bundle_id)
      && safeString(job.status).toLowerCase() === "succeeded"
    ))
    .map((job) => safeString(job.job_key))
    .filter((jobKey) => expectedKeys.has(jobKey)));
  const successful = expectedCount > 0 && completedKeys.size === expectedKeys.size;
  return successful
    ? { reusable: true, reason: "immutable_bundle_current_ocr_complete", expected_ocr_job_count: expectedCount }
    : { reusable: false, reason: "current_ocr_contract_not_complete", expected_ocr_job_count: expectedCount };
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
  const requestStartedAt = Date.now();
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
    payload = JSON.parse(await readBody(req) || "{}");
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
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
    const canonicalLookupStartedAt = Date.now();
    let canonicalReadMs = 0;
    let existingBundleReadMs = 0;
    let currentOcrJobsReadMs = 0;
    const measured = async (operation, recordElapsed) => {
      const startedAt = Date.now();
      try {
        return await operation();
      } finally {
        recordElapsed(Date.now() - startedAt);
      }
    };
    const [canonical, existingBundle, currentOcrJobs] = await Promise.all([
      measured(() => readCanonicalListingImageReferences({
        assetId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }), (elapsed) => { canonicalReadMs = elapsed; }),
      measured(() => readPreIngestionBundleByAsset({
        assetId,
        tenantId: context.tenantId,
        source,
        env: process.env,
        fetchImpl: globalThis.fetch
      }), (elapsed) => { existingBundleReadMs = elapsed; }),
      measured(() => readCurrentPreingestionOcrJobsByAsset({
        assetId,
        tenantId: context.tenantId,
        env: process.env,
        fetchImpl: globalThis.fetch
      }), (elapsed) => { currentOcrJobsReadMs = elapsed; })
    ]);
    const canonicalLookupMs = Date.now() - canonicalLookupStartedAt;
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

    const enqueueWorkers = payload.enqueue_workers !== false;
    const paddleOcr = paddleOcrConfig(process.env);
    // Never create durable OCR work that the current runtime cannot consume.
    const enqueueOcr = payload.enqueue_ocr !== false
      && paddleOcr.enabled === true
      && paddleOcr.configured === true
      && Boolean(paddleOcr.token);
    const enableOcrDetail = payload.enqueue_ocr_detail === true
      || String(process.env.PREINGESTION_OCR_DETAIL_JOBS_ENABLED || "false").toLowerCase() === "true";
    const reuse = reusablePreingestionBundle({
      existingBundle,
      tenantId: context.tenantId,
      assetId,
      source,
      images,
      cropPlan,
      currentOcrJobs,
      enqueueWorkers,
      enqueueOcr,
      enableOcrDetail,
      additionalWorkersRequested: payload.enqueue_embeddings === true
        || payload.enqueue_surface === true
        || payload.enqueue_quality === true
    });
    if (reuse.reusable) {
      const summary = summarizePreIngestionBundle(existingBundle);
      sendJson(res, 200, {
        ok: true,
        tenant_id: context.tenantId,
        bundle_id: existingBundle.bundle_id,
        bundle_status: existingBundle.status,
        saved: false,
        preingestion_cache_hit: true,
        preingestion_cache_reason: reuse.reason,
        worker_jobs_enqueued: 0,
        worker_jobs_attempted: 0,
        ocr_dispatch_started: false,
        signed_read_url_count: 0,
        signed_read_url_error_count: 0,
        signed_read_url_check_skipped: true,
        preingestion_timing: {
          canonical_bundle_lookup_ms: canonicalLookupMs,
          canonical_image_read_ms: canonicalReadMs,
          signed_read_url_check_ms: 0,
          existing_bundle_read_ms: existingBundleReadMs,
          current_ocr_jobs_read_ms: currentOcrJobsReadMs,
          bundle_write_ms: 0,
          worker_job_enqueue_ms: 0,
          total_ms: Date.now() - requestStartedAt
        },
        preprocessing_summary: {
          ...summary,
          signed_read_url_count: 0,
          signed_read_url_error_count: 0,
          signed_read_url_check_skipped: true,
          worker_jobs_enqueued: 0,
          worker_jobs_attempted: 0,
          ocr_dispatch_started: false,
          ocr_verifier_enabled: paddleOcr.enabled === true,
          ocr_verifier_configured: paddleOcr.configured === true && Boolean(paddleOcr.token),
          ocr_jobs_suppressed_unavailable: payload.enqueue_ocr !== false && !enqueueOcr,
          preingestion_cache_hit: true,
          preingestion_cache_reason: reuse.reason,
          expected_ocr_job_count: reuse.expected_ocr_job_count
        }
      });
      return;
    }

    const signedReadStartedAt = Date.now();
    const signed = payload.verify_signed_read_urls === false
      ? { signedReadUrlCount: 0, errors: [] }
      : await countSignedReadUrls(images, context.tenantId, process.env, globalThis.fetch);
    const signedReadMs = Date.now() - signedReadStartedAt;

    const bundle = createPreIngestionBundle({
      tenantId: context.tenantId,
      assetId,
      bundleId: existingBundle?.bundle_id || null,
      source,
      status: signed.errors.length ? preingestionStatuses.PARTIAL : preingestionStatuses.READY,
      images,
      derivedImages,
      // This browser-facing endpoint never accepts evidence. Only evidence
      // written by the authenticated OCR worker survives a re-ingestion; old
      // client-authored initial evidence is intentionally retired.
      initialEvidence: {},
      evidencePatches: trustedExistingEvidencePatches(existingBundle, images),
      qualitySummary,
      cropPlan
    });
    const bundleWriteStartedAt = Date.now();
    const writeResult = await upsertPreIngestionBundle({
      bundle,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    const bundleWriteMs = Date.now() - bundleWriteStartedAt;
    const durableBundle = writeResult.bundle || bundle;
    // Never create durable OCR work that the current runtime cannot consume.
    // A disabled verifier used to leave six queued rows per two-image card,
    // which looked like a long-tail backlog even though no worker could claim
    // a single row. Launch-gate preflight separately fails closed when OCR is
    // required, so this guard cannot silently turn a broken evaluator green.
    const jobs = enqueueWorkers
      ? buildPreingestionWorkerJobs({
        bundle: durableBundle,
        enableOcr: enqueueOcr,
        enableOcrDetail,
        enableEmbeddings: payload.enqueue_embeddings === true,
        enableSurface: payload.enqueue_surface === true,
        enableQuality: payload.enqueue_quality === true
      })
      : [];
    const workerEnqueueStartedAt = Date.now();
    const enqueueResult = enqueueWorkers
      ? await enqueuePreIngestionJobs({
        jobs,
        env: process.env,
        fetchImpl: globalThis.fetch
      })
      : { enqueued: 0, durable: true, skipped: true };
    const workerEnqueueMs = Date.now() - workerEnqueueStartedAt;

    // Wake the independent OCR consumer as soon as durable enqueue finishes.
    // This endpoint still only persists/schedules work: leases, retries and OCR
    // execution remain behind the authenticated worker boundary.
    const ocrDispatchStarted = enqueueOcr && Number(enqueueResult.enqueued || 0) > 0;
    if (ocrDispatchStarted) {
      scheduleTrustedPreingestionOcrWake({
        tenantId: context.tenantId,
        assetId,
        bundleId: durableBundle.bundle_id,
        limit: 3,
        env: process.env,
        fetchImpl: globalThis.fetch
      });
    }

    sendJson(res, 200, {
      ok: true,
      tenant_id: context.tenantId,
      bundle_id: durableBundle.bundle_id,
      bundle_status: durableBundle.status,
      saved: Boolean(writeResult.saved),
      worker_jobs_enqueued: enqueueResult.enqueued || 0,
      worker_jobs_attempted: enqueueResult.attempted || jobs.length,
      ocr_dispatch_started: ocrDispatchStarted,
      signed_read_url_count: signed.signedReadUrlCount,
      signed_read_url_error_count: signed.errors.length,
      preingestion_timing: {
        canonical_bundle_lookup_ms: canonicalLookupMs,
        canonical_image_read_ms: canonicalReadMs,
        signed_read_url_check_ms: signedReadMs,
        existing_bundle_read_ms: existingBundleReadMs,
        current_ocr_jobs_read_ms: currentOcrJobsReadMs,
        bundle_write_ms: bundleWriteMs,
        worker_job_enqueue_ms: workerEnqueueMs,
        total_ms: Date.now() - requestStartedAt
      },
      preprocessing_summary: {
        ...summarizePreIngestionBundle(durableBundle),
        signed_read_url_count: signed.signedReadUrlCount,
        signed_read_url_error_count: signed.errors.length,
        worker_jobs_enqueued: enqueueResult.enqueued || 0,
        worker_jobs_attempted: enqueueResult.attempted || jobs.length,
        ocr_dispatch_started: ocrDispatchStarted,
        ocr_verifier_enabled: paddleOcr.enabled === true,
        ocr_verifier_configured: paddleOcr.configured === true && Boolean(paddleOcr.token),
        ocr_jobs_suppressed_unavailable: payload.enqueue_ocr !== false && !enqueueOcr
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
