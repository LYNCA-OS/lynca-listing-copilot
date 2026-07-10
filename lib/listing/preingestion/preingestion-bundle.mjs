import crypto from "node:crypto";
import {
  defaultHighRiskCropRegions,
  planTargetedCrops
} from "../image-quality/crop-planner.mjs";

export const preingestionBundleVersion = "preingestion-bundle-v1";
// v4 collapses overlapping hard-text crops per image and preserves an explicit
// serial-first order. The version is part of the idempotency key so existing
// assets are reprocessed exactly once under the more efficient contract.
export const preingestionOcrJobVersion = "ocr-crop-v4";

export const preingestionStatuses = Object.freeze({
  READY: "READY",
  PARTIAL: "PARTIAL",
  PENDING_WORKER: "PENDING_WORKER",
  FAILED: "FAILED"
});

const primaryRoles = new Set([
  "image_1_original",
  "image_2_original",
  "front_original",
  "back_original",
  "front_alternate",
  "back_alternate"
]);

const roleAliases = new Map([
  ["image_1", "image_1_original"],
  ["image_1_original", "image_1_original"],
  ["image_2", "image_2_original"],
  ["image_2_original", "image_2_original"],
  ["front", "front_original"],
  ["card_front", "front_original"],
  ["front_original", "front_original"],
  ["back", "back_original"],
  ["card_back", "back_original"],
  ["back_original", "back_original"],
  ["serial", "serial_crop"],
  ["serial_number", "serial_crop"],
  ["card_number", "card_code_crop"],
  ["collector_number", "card_code_crop"],
  ["checklist_code", "card_code_crop"],
  ["grade", "grade_label_crop"],
  ["grade_label", "grade_label_crop"],
  ["year_product", "year_product_crop"],
  ["subject", "subject_crop"],
  ["player", "subject_crop"],
  ["surface", "surface_view"],
  ["parallel", "parallel_crop"]
]);

const initialEvidenceFields = Object.freeze([
  "card_number_candidate",
  "checklist_code_candidate",
  "print_run_candidate",
  "grade_candidate",
  "product_text_candidate",
  "player_text_candidate"
]);

function safeString(value) {
  return String(value || "").trim();
}

function stringOrNull(value) {
  const normalized = safeString(value);
  return normalized ? normalized : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoNow(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function normalizeSha256(value) {
  const normalized = safeString(value).toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function stripEphemeralImageFields(image = {}) {
  const {
    signedUrl,
    signedURL,
    signed_url,
    signed_read_url,
    signedUploadUrl,
    signed_upload_url,
    dataUrl,
    data_url,
    base64,
    ...rest
  } = image || {};
  return rest;
}

export function normalizePreingestionImageRole(role = "") {
  const normalized = safeString(role).toLowerCase();
  return roleAliases.get(normalized) || normalized || "image_1_original";
}

export function preingestionImageIsPrimary(image = {}) {
  return primaryRoles.has(normalizePreingestionImageRole(image.role || image.storage_role || image.storageRole));
}

function imageObjectPath(image = {}) {
  return stringOrNull(image.object_path || image.objectPath || image.storage_path || image.storagePath);
}

function imageContentType(image = {}) {
  return stringOrNull(image.content_type || image.contentType || image.original_type || image.originalType || image.type);
}

function imageSize(image = {}) {
  return numberOrNull(image.size || image.original_size || image.originalSize);
}

function imageWidth(image = {}) {
  return numberOrNull(image.width || image.original_width || image.originalWidth);
}

function imageHeight(image = {}) {
  return numberOrNull(image.height || image.original_height || image.originalHeight);
}

function imageIdForRecord(image = {}, index = 0) {
  return stringOrNull(image.image_id || image.imageId || image.id)
    || `image_${index + 1}`;
}

export function normalizePreingestionImageRecord(image = {}, {
  fallbackAssetId = "",
  index = 0
} = {}) {
  const clean = stripEphemeralImageFields(image);
  const objectPath = imageObjectPath(clean);
  const role = normalizePreingestionImageRole(clean.role || clean.storage_role || clean.storageRole);
  const contentSha256 = normalizeSha256(clean.content_sha256 || clean.contentSha256 || clean.sha256);
  const imageId = imageIdForRecord(clean, index);

  return {
    image_id: imageId,
    asset_id: stringOrNull(clean.asset_id || clean.assetId) || stringOrNull(fallbackAssetId),
    role,
    object_path: objectPath,
    bucket: stringOrNull(clean.bucket || clean.storage_bucket || clean.storageBucket),
    content_sha256: contentSha256,
    width: imageWidth(clean),
    height: imageHeight(clean),
    size: imageSize(clean),
    content_type: imageContentType(clean),
    object_verified: clean.object_verified === true || clean.storageVerified === true || clean.storage_verified === true,
    content_hash_verified: clean.content_hash_verified === true,
    provenance: {
      source_table: clean.source_table || (clean.object_path ? "listing_image_verifications" : "payload"),
      object_verified: clean.object_verified === true || clean.storageVerified === true || clean.storage_verified === true,
      dimension_source: clean.dimension_source || null,
      verified_at: clean.verified_at || null
    }
  };
}

export function dedupePreingestionImages(images = []) {
  const seen = new Set();
  const deduped = [];
  for (const image of images) {
    const key = image.content_sha256
      ? `sha:${image.content_sha256}:${image.role}`
      : `path:${image.bucket || ""}:${image.object_path || ""}:${image.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(image);
  }
  return deduped;
}

function normalizeCropBox(cropBox = {}) {
  if (!cropBox || typeof cropBox !== "object") return null;
  const x = numberOrNull(cropBox.x ?? cropBox.left);
  const y = numberOrNull(cropBox.y ?? cropBox.top);
  const width = numberOrNull(cropBox.width);
  const height = numberOrNull(cropBox.height);
  if ([x, y, width, height].some((value) => value === null)) return null;
  return { x, y, width, height };
}

export function normalizeDerivedImageRecord(image = {}, {
  index = 0
} = {}) {
  const clean = stripEphemeralImageFields(image);
  const role = normalizePreingestionImageRole(clean.role || clean.storage_role || clean.storageRole || clean.crop_role);
  return {
    derived_id: stringOrNull(clean.derived_id || clean.derivedId || clean.crop_id || clean.id) || `derived_${index + 1}`,
    asset_id: stringOrNull(clean.asset_id || clean.assetId),
    source_image_id: stringOrNull(clean.source_image_id || clean.sourceImageId),
    role,
    object_path: imageObjectPath(clean),
    bucket: stringOrNull(clean.bucket || clean.storage_bucket || clean.storageBucket),
    content_sha256: normalizeSha256(clean.content_sha256 || clean.contentSha256 || clean.sha256),
    crop_box: normalizeCropBox(clean.crop_box || clean.cropBox || clean.normalized_bounds),
    width: imageWidth(clean),
    height: imageHeight(clean),
    size: imageSize(clean),
    content_type: imageContentType(clean),
    created_by: stringOrNull(clean.created_by || clean.createdBy) || "preingestion",
    provenance: {
      source_table: clean.source_table || "image_derived_assets",
      transform_version: clean.transform_version || clean.transformVersion || null,
      source_region: clean.source_region || clean.sourceRegion || null
    }
  };
}

export function normalizeEvidencePatch(patch = {}) {
  const field = stringOrNull(patch.field || patch.evidence_field);
  const value = patch.value ?? patch.normalized_value ?? patch.raw_text ?? null;
  const sourceType = stringOrNull(patch.source_type || patch.sourceType);
  const sourceImageId = stringOrNull(patch.source_image_id || patch.sourceImageId);
  const cropId = stringOrNull(patch.crop_id || patch.cropId);
  const provenance = patch.provenance && typeof patch.provenance === "object"
    ? patch.provenance
    : {};

  if (!field || !sourceType || !sourceImageId) {
    return null;
  }

  return {
    patch_id: stringOrNull(patch.patch_id || patch.patchId) || crypto.randomUUID(),
    field,
    value,
    raw_text: patch.raw_text ?? patch.rawText ?? null,
    text_candidates: Array.isArray(patch.text_candidates || patch.textCandidates)
      ? (patch.text_candidates || patch.textCandidates)
      : [],
    source_type: sourceType,
    source_image_id: sourceImageId,
    crop_id: cropId,
    confidence: numberOrNull(patch.confidence),
    provenance: {
      ...provenance,
      source_type: sourceType,
      source_image_id: sourceImageId,
      crop_id: cropId
    }
  };
}

function dedupeEvidencePatches(patches = []) {
  const seen = new Set();
  const deduped = [];
  for (const patch of patches.map(normalizeEvidencePatch).filter(Boolean)) {
    const key = [
      patch.field,
      patch.source_type,
      patch.source_image_id,
      patch.crop_id || "",
      safeString(patch.value)
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(patch);
  }
  return deduped;
}

export function normalizeInitialEvidence(initialEvidence = {}) {
  const output = {};
  for (const field of initialEvidenceFields) {
    const value = initialEvidence[field] ?? initialEvidence[field.replace(/_candidate$/, "")];
    if (value === undefined || value === null || value === "") continue;
    const patch = normalizeEvidencePatch({
      field,
      value: typeof value === "object" && value !== null ? value.value : value,
      raw_text: typeof value === "object" && value !== null ? value.raw_text : null,
      source_type: typeof value === "object" && value !== null ? value.source_type : "PREINGESTION_DETERMINISTIC",
      source_image_id: typeof value === "object" && value !== null ? value.source_image_id : "bundle",
      crop_id: typeof value === "object" && value !== null ? value.crop_id : null,
      confidence: typeof value === "object" && value !== null ? value.confidence : null,
      provenance: typeof value === "object" && value !== null ? value.provenance : { generated_by: "preingestion" }
    });
    if (patch) output[field] = patch;
  }
  return output;
}

export function buildPreingestionQualitySummary({
  images = [],
  derivedImages = [],
  captureQuality = null,
  cropPlan = []
} = {}) {
  const primaryImages = images.filter(preingestionImageIsPrimary);
  const roles = images
    .map((image) => normalizePreingestionImageRole(image.role || image.storageRole || image.storage_role))
    .filter(Boolean);
  const shaCounts = new Map();
  for (const image of images) {
    const sha = image.content_sha256 || image.contentSha256 || image.sha256;
    if (!sha) continue;
    shaCounts.set(sha, (shaCounts.get(sha) || 0) + 1);
  }

  return {
    image_count: images.length,
    primary_image_count: primaryImages.length,
    derived_image_count: derivedImages.length,
    has_front: roles.some((role) => role === "front_original" || role === "front_alternate"),
    has_back: roles.some((role) => role === "back_original" || role === "back_alternate"),
    total_bytes: images.reduce((sum, image) => sum + (Number(image.size || image.originalSize || image.original_size) || 0), 0),
    max_width: Math.max(0, ...images.map((image) => Number(image.width || image.originalWidth || image.original_width) || 0)),
    max_height: Math.max(0, ...images.map((image) => Number(image.height || image.originalHeight || image.original_height) || 0)),
    roles,
    duplicate_sha256_count: [...shaCounts.values()].filter((count) => count > 1).length,
    crop_plan_count: Array.isArray(cropPlan) ? cropPlan.length : 0,
    capture_quality: captureQuality || null
  };
}

export function buildPreingestionCropPlan({
  assetId = "",
  images = [],
  captureQuality = null,
  requestedFields = [],
  maxCropsPerImage = 6
} = {}) {
  const primary = images.filter(preingestionImageIsPrimary);
  return primary.flatMap((image) => planTargetedCrops({
    assetId,
    imageId: image.image_id || image.imageId || image.id,
    sourceObjectPath: image.object_path || image.objectPath || image.storage_path || image.storagePath,
    sourceSide: image.role || image.storageRole || image.storage_role,
    sourceWidth: image.width || image.originalWidth || image.original_width,
    sourceHeight: image.height || image.originalHeight || image.original_height,
    imageQuality: captureQuality,
    requestedFields,
    highRiskFields: defaultHighRiskCropRegions,
    maxCrops: maxCropsPerImage
  }));
}

export function createPreIngestionBundle({
  assetId,
  source = "listing_preingest_api",
  status = preingestionStatuses.READY,
  images = [],
  derivedImages = [],
  initialEvidence = {},
  evidencePatches = [],
  qualitySummary = null,
  cropPlan = [],
  now = new Date(),
  bundleId = null,
  bundleVersion = preingestionBundleVersion
} = {}) {
  const normalizedImages = dedupePreingestionImages(images.map((image, index) => normalizePreingestionImageRecord(image, {
    fallbackAssetId: assetId,
    index
  }))).filter((image) => image.object_path);
  const normalizedDerivedImages = dedupePreingestionImages(derivedImages.map((image, index) => normalizeDerivedImageRecord(image, {
    index
  }))).filter((image) => image.object_path);
  const normalizedPatches = dedupeEvidencePatches(evidencePatches);
  const normalizedInitialEvidence = normalizeInitialEvidence(initialEvidence);
  const createdAt = isoNow(now);

  return {
    bundle_id: bundleId || crypto.randomUUID(),
    asset_id: stringOrNull(assetId) || null,
    source: safeString(source) || "listing_preingest_api",
    status,
    images: normalizedImages,
    derived_images: normalizedDerivedImages,
    quality_summary: qualitySummary || buildPreingestionQualitySummary({
      images: normalizedImages,
      derivedImages: normalizedDerivedImages,
      cropPlan
    }),
    initial_evidence: normalizedInitialEvidence,
    evidence_patches: normalizedPatches,
    crop_plan: Array.isArray(cropPlan) ? cropPlan : [],
    created_at: createdAt,
    updated_at: createdAt,
    bundle_version: bundleVersion
  };
}

export function imagesFromPreIngestionBundle(bundle = {}) {
  const rawImages = Array.isArray(bundle.images) ? bundle.images : [];
  const derivedImages = Array.isArray(bundle.derived_images) ? bundle.derived_images : [];
  const fromRaw = rawImages.map((image) => ({
    id: image.image_id,
    image_id: image.image_id,
    storageRole: image.role,
    storage_role: image.role,
    objectPath: image.object_path,
    object_path: image.object_path,
    bucket: image.bucket,
    storage_bucket: image.bucket,
    contentSha256: image.content_sha256,
    content_sha256: image.content_sha256,
    originalType: image.content_type,
    original_type: image.content_type,
    originalSize: image.size,
    original_size: image.size,
    originalWidth: image.width,
    original_width: image.width,
    originalHeight: image.height,
    original_height: image.height,
    width: image.width,
    height: image.height,
    storageVerified: true,
    storage_verified: true
  }));
  const fromDerived = derivedImages.map((image) => ({
    id: image.derived_id,
    image_id: image.derived_id,
    storageRole: image.role,
    storage_role: image.role,
    objectPath: image.object_path,
    object_path: image.object_path,
    bucket: image.bucket,
    storage_bucket: image.bucket,
    contentSha256: image.content_sha256,
    content_sha256: image.content_sha256,
    originalType: image.content_type,
    original_type: image.content_type,
    originalSize: image.size,
    original_size: image.size,
    originalWidth: image.width,
    original_width: image.width,
    originalHeight: image.height,
    original_height: image.height,
    width: image.width,
    height: image.height,
    derived: true,
    source_image_id: image.source_image_id,
    sourceRegion: image.provenance?.source_region || null,
    source_region: image.provenance?.source_region || null,
    crop_box: image.crop_box,
    storageVerified: true,
    storage_verified: true
  }));
  return [...fromRaw, ...fromDerived];
}

export function summarizePreIngestionBundle(bundle = {}) {
  const quality = bundle.quality_summary || {};
  return {
    bundle_id: bundle.bundle_id || null,
    bundle_version: bundle.bundle_version || null,
    status: bundle.status || null,
    image_count: quality.image_count ?? (Array.isArray(bundle.images) ? bundle.images.length : 0),
    primary_image_count: quality.primary_image_count ?? 0,
    derived_image_count: quality.derived_image_count ?? (Array.isArray(bundle.derived_images) ? bundle.derived_images.length : 0),
    has_front: Boolean(quality.has_front),
    has_back: Boolean(quality.has_back),
    crop_plan_count: quality.crop_plan_count ?? (Array.isArray(bundle.crop_plan) ? bundle.crop_plan.length : 0),
    evidence_patch_count: Array.isArray(bundle.evidence_patches) ? bundle.evidence_patches.length : 0,
    initial_evidence_count: bundle.initial_evidence && typeof bundle.initial_evidence === "object"
      ? Object.keys(bundle.initial_evidence).length
      : 0
  };
}

export function preingestionSupabaseConfigured(env = process.env) {
  return Boolean(String(env.SUPABASE_URL || "").trim() && env.SUPABASE_SERVICE_ROLE_KEY);
}

function preingestionSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase preingestion storage is not configured.");
  }
  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readVerifiedImageRecordsByAssetId({
  assetId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  limit = 80
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return [];
  const safeAssetId = stringOrNull(assetId);
  if (!safeAssetId || typeof fetchImpl !== "function") return [];

  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/listing_image_verifications`);
  endpoint.searchParams.set("select", [
    "object_path",
    "bucket",
    "asset_id",
    "image_id",
    "storage_role",
    "content_type",
    "size",
    "width",
    "height",
    "content_sha256",
    "object_verified",
    "content_hash_verified",
    "dimension_source",
    "verified_at",
    "updated_at"
  ].join(","));
  endpoint.searchParams.set("asset_id", `eq.${safeAssetId}`);
  endpoint.searchParams.set("object_verified", "eq.true");
  endpoint.searchParams.set("order", "verified_at.desc");
  endpoint.searchParams.set("limit", String(limit));

  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase preingestion image read failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const rows = await readResponseJson(response);
  return Array.isArray(rows) ? rows : [];
}

export async function readDerivedImageAssetsByAssetId({
  assetId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  limit = 80
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return [];
  const safeAssetId = stringOrNull(assetId);
  if (!safeAssetId || typeof fetchImpl !== "function") return [];

  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/image_derived_assets`);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("asset_id", `eq.${safeAssetId}`);
  endpoint.searchParams.set("status", "eq.ready");
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", String(limit));

  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    const message = await response.text();
    if (/relation .*image_derived_assets.* does not exist/i.test(message)) return [];
    throw new Error(`Supabase derived image read failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const rows = await readResponseJson(response);
  return Array.isArray(rows) ? rows : [];
}

function bundleRowFromBundle(bundle = {}) {
  return {
    bundle_id: bundle.bundle_id,
    asset_id: bundle.asset_id,
    source: bundle.source,
    status: bundle.status,
    images: bundle.images || [],
    derived_images: bundle.derived_images || [],
    quality_summary: bundle.quality_summary || {},
    initial_evidence: bundle.initial_evidence || {},
    evidence_patches: bundle.evidence_patches || [],
    crop_plan: bundle.crop_plan || [],
    bundle_version: bundle.bundle_version || preingestionBundleVersion,
    created_at: bundle.created_at,
    updated_at: bundle.updated_at
  };
}

// Re-preingesting an asset must keep the existing bundle_id: preingestion_jobs
// rows reference it by FK, so letting the upsert overwrite the primary key
// with a fresh uuid fails with 23503 once any job exists for the bundle.
export async function readPreIngestionBundleIdByAsset({
  assetId,
  source = "listing_preingest_api",
  bundleVersion = preingestionBundleVersion,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) return null;
  const safeAssetId = stringOrNull(assetId);
  if (!safeAssetId || typeof fetchImpl !== "function") return null;
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
  endpoint.searchParams.set("select", "bundle_id");
  endpoint.searchParams.set("asset_id", `eq.${safeAssetId}`);
  endpoint.searchParams.set("source", `eq.${safeString(source) || "listing_preingest_api"}`);
  endpoint.searchParams.set("bundle_version", `eq.${bundleVersion}`);
  endpoint.searchParams.set("limit", "1");
  try {
    const response = await fetchImpl(endpoint, {
      headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
    });
    if (!response.ok) return null;
    const rows = await readResponseJson(response);
    return Array.isArray(rows) && rows[0]?.bundle_id ? rows[0].bundle_id : null;
  } catch {
    // A failed lookup must never fail pre-ingestion: fall back to a fresh
    // bundle id (the upsert path then behaves as before this optimization).
    return null;
  }
}

export async function upsertPreIngestionBundle({
  bundle,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) {
    return { saved: false, durable: false, reason: "supabase_not_configured", bundle };
  }
  if (!bundle?.asset_id) {
    throw new Error("Pre-ingestion bundle asset_id is required.");
  }
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
  endpoint.searchParams.set("on_conflict", "asset_id,source,bundle_version");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(bundleRowFromBundle(bundle))
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase preingestion bundle write failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const rows = await readResponseJson(response);
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    saved: true,
    durable: true,
    bundle: row || bundle
  };
}

export async function readPreIngestionBundle({
  bundleId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!preingestionSupabaseConfigured(env)) {
    return { found: false, durable: false, reason: "supabase_not_configured" };
  }
  const safeBundleId = stringOrNull(bundleId);
  if (!safeBundleId) return { found: false, durable: true, reason: "bundle_id_missing" };
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_bundles`);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("bundle_id", `eq.${safeBundleId}`);
  endpoint.searchParams.set("limit", "1");
  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey, { prefer: "return=representation" })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase preingestion bundle read failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const rows = await readResponseJson(response);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row
    ? { found: true, durable: true, bundle: row }
    : { found: false, durable: true, reason: "bundle_not_found" };
}

// Only OCR crop verification has a consumer today (preingestion-ocr-worker).
// The other job types default OFF until their consumers exist: enqueueing
// consumerless jobs just grows the table and hides real gaps (441 dead rows
// were cancelled on 2026-07-09 for exactly this reason).
const ocrWorkerPriorityByRole = Object.freeze({
  serial_crop: 10,
  grade_label_crop: 20,
  card_code_crop: 30
});

function unionCropBounds(left = null, right = null) {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const useLeftTop = Object.prototype.hasOwnProperty.call(left, "left")
    || Object.prototype.hasOwnProperty.call(right, "left");
  const leftX = Number(left.x ?? left.left ?? 0);
  const leftY = Number(left.y ?? left.top ?? 0);
  const rightX = Number(right.x ?? right.left ?? 0);
  const rightY = Number(right.y ?? right.top ?? 0);
  const x = Math.min(leftX, rightX);
  const y = Math.min(leftY, rightY);
  const edgeX = Math.max(leftX + Number(left.width || 0), rightX + Number(right.width || 0));
  const edgeY = Math.max(leftY + Number(left.height || 0), rightY + Number(right.height || 0));
  return useLeftTop
    ? { left: x, top: y, width: edgeX - x, height: edgeY - y }
    : { x, y, width: edgeX - x, height: edgeY - y };
}

function mergedOcrCrops(cropPlan = []) {
  const groups = new Map();
  for (const crop of cropPlan.filter((item) => Object.hasOwn(ocrWorkerPriorityByRole, item.role))) {
    const metadata = crop.crop_metadata || {};
    const sourceImageId = crop.source_image_id || metadata.source_image_id || metadata.source_object_path || "image";
    const key = `${sourceImageId}:${crop.role}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...crop, crop_metadata: { ...metadata } });
      continue;
    }
    const regions = [...new Set([
      ...(String(existing.source_region || "").split("+").filter(Boolean)),
      crop.source_region
    ].filter(Boolean))];
    groups.set(key, {
      ...existing,
      source_region: regions.join("+"),
      crop_region: unionCropBounds(existing.crop_region, crop.crop_region),
      crop_metadata: {
        ...existing.crop_metadata,
        crop_id: `${sourceImageId}__${crop.role}__${preingestionOcrJobVersion}`,
        source_region: regions.join("+"),
        normalized_bounds: unionCropBounds(
          existing.crop_metadata?.normalized_bounds,
          metadata.normalized_bounds
        ),
        pixel_bounds: unionCropBounds(
          existing.crop_metadata?.pixel_bounds,
          metadata.pixel_bounds
        )
      }
    });
  }
  return [...groups.values()].sort((left, right) => (
    Number(ocrWorkerPriorityByRole[left.role] || 99)
    - Number(ocrWorkerPriorityByRole[right.role] || 99)
  ));
}

export function buildPreingestionWorkerJobs({
  bundle = {},
  enableOcr = true,
  enableEmbeddings = false,
  enableSurface = false,
  enableQuality = false,
  now = new Date()
} = {}) {
  const createdAt = isoNow(now);
  const jobs = [];
  const assetId = bundle.asset_id;
  const bundleId = bundle.bundle_id;
  const cropPlan = Array.isArray(bundle.crop_plan) ? bundle.crop_plan : [];

  if (enableOcr) {
    for (const crop of mergedOcrCrops(cropPlan)) {
      jobs.push({
        // The version is part of the durable idempotency key. v2 repairs the
        // old path that could erase completed OCR patches during re-ingestion;
        // existing assets are reprocessed exactly once under the fixed contract.
        job_key: `ocr:${preingestionOcrJobVersion}:${bundleId}:${crop.crop_metadata?.crop_id || crop.source_region}`,
        asset_id: assetId,
        bundle_id: bundleId,
        job_type: "ocr_crop_verification",
        status: "queued",
        priority: ocrWorkerPriorityByRole[crop.role] || 40,
        payload: { crop },
        created_at: createdAt,
        updated_at: createdAt
      });
    }
  }

  if (enableEmbeddings) {
    jobs.push({
      job_key: `visual_embedding:${bundleId}`,
      asset_id: assetId,
      bundle_id: bundleId,
      job_type: "visual_embedding",
      status: "queued",
      priority: 50,
      payload: { images: bundle.images || [], derived_images: bundle.derived_images || [] },
      created_at: createdAt,
      updated_at: createdAt
    });
  }

  if (enableSurface && cropPlan.some((item) => item.role === "parallel_crop" || item.role === "surface_view")) {
    jobs.push({
      job_key: `surface:${bundleId}`,
      asset_id: assetId,
      bundle_id: bundleId,
      job_type: "surface_crop_analysis",
      status: "queued",
      priority: 60,
      payload: { crop_plan: cropPlan.filter((item) => item.role === "parallel_crop" || item.role === "surface_view") },
      created_at: createdAt,
      updated_at: createdAt
    });
  }

  if (enableQuality) {
    jobs.push({
      job_key: `quality:${bundleId}`,
      asset_id: assetId,
      bundle_id: bundleId,
      job_type: "image_quality_deep_analysis",
      status: "queued",
      priority: 70,
      payload: { images: bundle.images || [] },
      created_at: createdAt,
      updated_at: createdAt
    });
  }

  return jobs;
}

export async function enqueuePreIngestionJobs({
  jobs = [],
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!jobs.length) return { enqueued: 0, durable: preingestionSupabaseConfigured(env) };
  if (!preingestionSupabaseConfigured(env)) {
    return { enqueued: 0, durable: false, reason: "supabase_not_configured" };
  }
  const { url, serviceRoleKey } = preingestionSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/preingestion_jobs`);
  endpoint.searchParams.set("on_conflict", "job_key");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey, {
      prefer: "resolution=ignore-duplicates,return=representation"
    }),
    body: JSON.stringify(jobs)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase preingestion job enqueue failed: ${response.status} ${message.slice(0, 180)}`);
  }
  const inserted = await readResponseJson(response);
  return {
    enqueued: Array.isArray(inserted) ? inserted.length : 0,
    attempted: jobs.length,
    durable: true
  };
}
