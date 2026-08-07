import crypto from "node:crypto";
import {
  normalizeDurableListingAssetId,
  requireTenantListingAsset
} from "../../tenant/assets.mjs";
import { readSupabaseRows } from "../../supabase-rest.mjs";
import { cropRolesByRegion } from "../image-quality/crop-planner.mjs";
import { assertTenantListingAssetObjectPath } from "./storage-verification-store.mjs";
import { normalizeListingImageStorageRole } from "./supabase-image-storage.mjs";

const primaryRoles = new Set([
  "image_1_original",
  "image_2_original",
  "front_original",
  "back_original"
]);
const primaryRoleSlots = new Map([
  ["image_1_original", 0],
  ["front_original", 0],
  ["image_2_original", 1],
  ["back_original", 1]
]);
const sha256Pattern = /^[0-9a-f]{64}$/;
const canonicalCropRoles = new Set(Object.values(cropRolesByRegion));
// COS-53's recognition input: one bounded downscale per primary slot.
const readabilityDerivedRole = "readability_derived";
const readabilityTransformVersion = "readability-downscale-v1";

export class CanonicalImageReferenceError extends Error {
  constructor(code, {
    statusCode = 422,
    retryable = false,
    cause = null
  } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = "CanonicalImageReferenceError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function cleanText(value) {
  return String(value || "").trim();
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new CanonicalImageReferenceError(`canonical_image_${field}_invalid`);
  }
  return number;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedBounds(value) {
  const input = plainObject(value);
  const bounds = Object.fromEntries(["x", "y", "width", "height"].map((field) => {
    const number = Number(input[field]);
    if (!Number.isFinite(number)) {
      throw new CanonicalImageReferenceError("canonical_crop_bounds_invalid");
    }
    return [field, Math.round(number * 1_000_000) / 1_000_000];
  }));
  if (
    bounds.x < 0
    || bounds.y < 0
    || bounds.width <= 0
    || bounds.height <= 0
    || bounds.x >= 1
    || bounds.y >= 1
    || bounds.x + bounds.width > 1.000001
    || bounds.y + bounds.height > 1.000001
  ) {
    throw new CanonicalImageReferenceError("canonical_crop_bounds_out_of_scope");
  }
  return bounds;
}

function pixelBounds(bounds, width, height) {
  const sourceWidth = positiveNumber(width, "source_width");
  const sourceHeight = positiveNumber(height, "source_height");
  const left = Math.max(0, Math.floor(bounds.x * sourceWidth));
  const top = Math.max(0, Math.floor(bounds.y * sourceHeight));
  return {
    left,
    top,
    width: Math.max(1, Math.min(sourceWidth - left, Math.ceil(bounds.width * sourceWidth))),
    height: Math.max(1, Math.min(sourceHeight - top, Math.ceil(bounds.height * sourceHeight)))
  };
}

function rolePriority(role) {
  return primaryRoleSlots.get(role) ?? 2;
}

function compareCanonicalImages(left, right) {
  return rolePriority(left.storageRole) - rolePriority(right.storageRole)
    || cleanText(left.image_id).localeCompare(cleanText(right.image_id))
    || cleanText(left.objectPath).localeCompare(cleanText(right.objectPath));
}

export function canonicalImageFromVerificationRecord(row = {}, {
  tenantId,
  assetId
} = {}) {
  const normalizedAssetId = normalizeDurableListingAssetId(assetId);
  if (cleanText(row.tenant_id) !== cleanText(tenantId)) {
    throw new CanonicalImageReferenceError("canonical_image_tenant_mismatch");
  }
  if (cleanText(row.asset_id) !== normalizedAssetId) {
    throw new CanonicalImageReferenceError("canonical_image_asset_mismatch");
  }
  if (row.object_verified !== true) {
    throw new CanonicalImageReferenceError("canonical_image_not_verified");
  }
  if (row.canonical_eligible !== true) {
    throw new CanonicalImageReferenceError("canonical_image_not_eligible");
  }
  if (cleanText(row.image_generation_id) !== normalizedAssetId) {
    throw new CanonicalImageReferenceError("canonical_image_generation_mismatch");
  }

  let objectPath;
  try {
    objectPath = assertTenantListingAssetObjectPath({
      tenantId,
      assetId: normalizedAssetId,
      objectPath: row.object_path
    });
  } catch (error) {
    throw new CanonicalImageReferenceError("canonical_image_object_path_out_of_scope", {
      statusCode: 422,
      retryable: false,
      cause: error
    });
  }
  const bucket = cleanText(row.bucket);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(bucket)) {
    throw new CanonicalImageReferenceError("canonical_image_bucket_invalid");
  }
  let storageRole;
  try {
    storageRole = normalizeListingImageStorageRole(row.storage_role);
  } catch {
    throw new CanonicalImageReferenceError("canonical_image_role_invalid");
  }
  const contentType = cleanText(row.content_type).toLowerCase();
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType)) {
    throw new CanonicalImageReferenceError("canonical_image_content_type_invalid");
  }
  const storedContentSha256 = cleanText(row.content_sha256).toLowerCase();
  const contentHashVerified = row.content_hash_verified === true;
  if (!contentHashVerified || !sha256Pattern.test(storedContentSha256)) {
    throw new CanonicalImageReferenceError("canonical_image_content_sha256_invalid");
  }
  const contentSha256 = storedContentSha256;
  const imageId = cleanText(row.image_id);
  if (!imageId) {
    throw new CanonicalImageReferenceError("canonical_image_id_missing");
  }
  const derived = !primaryRoles.has(storageRole);
  const storedCropMetadata = Object.keys(plainObject(row.crop_metadata)).length
    ? plainObject(row.crop_metadata)
    : null;
  if (!derived && storedCropMetadata) {
    throw new CanonicalImageReferenceError("canonical_original_crop_metadata_forbidden");
  }
  // COS-53 (approved 2026-08-07): Recognition may read a stored DERIVED asset
  // when the original is large, provided the original is still stored in full.
  // That derived asset is a bounded DOWNSCALE, not a crop, so it has no
  // normalized bounds and this layer knew only crops -- a stored
  // `readability_derived` row was an allowed storage role and an inadmissible
  // canonical reference. Its lineage is checked in `canonicalDownscaleLineage`,
  // which is as strict as the crop path about naming its source.
  if (derived && !storedCropMetadata) {
    throw new CanonicalImageReferenceError("canonical_derived_lineage_missing");
  }
  if (derived && !canonicalCropRoles.has(storageRole) && storageRole !== readabilityDerivedRole) {
    throw new CanonicalImageReferenceError("canonical_derived_lineage_missing");
  }

  return {
    id: imageId,
    image_id: imageId,
    name: objectPath.split("/").at(-1),
    type: contentType,
    originalType: contentType,
    content_type: contentType,
    size: positiveNumber(row.size, "size"),
    originalSize: positiveNumber(row.size, "size"),
    width: positiveNumber(row.width, "width"),
    height: positiveNumber(row.height, "height"),
    originalWidth: positiveNumber(row.width, "width"),
    originalHeight: positiveNumber(row.height, "height"),
    storageRole,
    storage_role: storageRole,
    role: storageRole,
    contentSha256,
    content_sha256: contentSha256,
    objectPath,
    object_path: objectPath,
    bucket,
    storageVerified: true,
    storage_verified: true,
    storageUploaded: true,
    assetId: normalizedAssetId,
    asset_id: normalizedAssetId,
    imageGenerationId: normalizedAssetId,
    image_generation_id: normalizedAssetId,
    cropMetadata: storedCropMetadata,
    crop_metadata: storedCropMetadata,
    verifiedAt: row.verified_at || null,
    verified_at: row.verified_at || null,
    derived
  };
}

function canonicalCropLineage(image, source, assetId) {
  const metadata = plainObject(image.cropMetadata);
  const sourceRegion = cleanText(metadata.source_region);
  if (cropRolesByRegion[sourceRegion] !== image.storageRole) {
    throw new CanonicalImageReferenceError("canonical_crop_region_role_mismatch");
  }
  if (
    cleanText(metadata.generation_id) !== assetId
    || cleanText(metadata.asset_id) !== assetId
    || cleanText(metadata.source_image_id) !== source.image_id
    || cleanText(metadata.source_object_path) !== source.object_path
    || cleanText(metadata.source_content_sha256).toLowerCase() !== source.content_sha256
    || cleanText(metadata.derived_object_path) !== image.object_path
    || cleanText(metadata.crop_role) !== image.storage_role
  ) {
    throw new CanonicalImageReferenceError("canonical_crop_lineage_mismatch");
  }
  const sourceSlot = primaryRoleSlots.get(source.storageRole);
  const sourceSide = sourceSlot === 0 ? "front" : "back";
  if (
    cleanText(metadata.source_side) !== sourceSide
    || Number(metadata.source_width) !== source.width
    || Number(metadata.source_height) !== source.height
  ) {
    throw new CanonicalImageReferenceError("canonical_crop_source_identity_mismatch");
  }
  const bounds = normalizedBounds(metadata.normalized_bounds);
  return {
    crop_id: image.image_id,
    generation_id: assetId,
    asset_id: assetId,
    source_image_id: source.image_id,
    source_object_path: source.object_path,
    source_content_sha256: source.content_sha256,
    source_side: sourceSide,
    source_width: source.width,
    source_height: source.height,
    source_region: sourceRegion,
    crop_role: image.storage_role,
    normalized_bounds: bounds,
    pixel_bounds: pixelBounds(bounds, source.width, source.height),
    derived_object_path: image.object_path,
    transform_version: cleanText(metadata.transform_version) || "field-crop-v1"
  };
}

/**
 * COS-53's derived recognition input: a bounded downscale of one primary image.
 *
 * It names the same lineage a crop does -- same asset, same source image, same
 * source bytes -- and differs in what it asserts about the transform: no
 * bounds, a long-edge ceiling, and a BYTE COUNT that must be smaller than the
 * source. The byte rule is the decision's own clause 3 and it is enforced here
 * rather than left to the producer, because it is not theoretical: re-encoding
 * a 237KB webp to 1600px JPEG produced 478KB. Resolution went down and bytes
 * went up, and a downscale that is bigger than its original is a slower
 * recognition input that also reads less.
 */
function canonicalDownscaleLineage(image, source, assetId) {
  const metadata = plainObject(image.cropMetadata);
  if (
    cleanText(metadata.generation_id) !== assetId
    || cleanText(metadata.asset_id) !== assetId
    || cleanText(metadata.source_image_id) !== source.image_id
    || cleanText(metadata.source_object_path) !== source.object_path
    || cleanText(metadata.source_content_sha256).toLowerCase() !== source.content_sha256
    || cleanText(metadata.derived_object_path) !== image.object_path
    || cleanText(metadata.derived_role) !== readabilityDerivedRole
  ) {
    throw new CanonicalImageReferenceError("canonical_downscale_lineage_mismatch");
  }
  const sourceSlot = primaryRoleSlots.get(source.storageRole);
  const sourceSide = sourceSlot === 0 ? "front" : "back";
  if (
    cleanText(metadata.source_side) !== sourceSide
    || Number(metadata.source_width) !== source.width
    || Number(metadata.source_height) !== source.height
    || Number(metadata.source_size) !== source.size
  ) {
    throw new CanonicalImageReferenceError("canonical_downscale_source_identity_mismatch");
  }
  const longEdge = positiveNumber(metadata.long_edge, "downscale_long_edge");
  if (Math.max(image.width, image.height) > longEdge) {
    throw new CanonicalImageReferenceError("canonical_downscale_long_edge_exceeded");
  }
  if (image.size >= source.size) {
    throw new CanonicalImageReferenceError("canonical_downscale_not_smaller");
  }
  return {
    derived_id: image.image_id,
    generation_id: assetId,
    asset_id: assetId,
    source_image_id: source.image_id,
    source_object_path: source.object_path,
    source_content_sha256: source.content_sha256,
    source_side: sourceSide,
    source_width: source.width,
    source_height: source.height,
    source_size: source.size,
    derived_role: readabilityDerivedRole,
    derived_object_path: image.object_path,
    derived_width: image.width,
    derived_height: image.height,
    derived_size: image.size,
    long_edge: longEdge,
    transform_version: cleanText(metadata.transform_version) || readabilityTransformVersion
  };
}

function finalizeCanonicalCropLineage(images, assetId) {
  const primaryById = new Map(images
    .filter((image) => !image.derived)
    .map((image) => [image.image_id, image]));
  return images.map((image) => {
    if (!image.derived) return image;
    const sourceImageId = cleanText(image.cropMetadata?.source_image_id);
    const source = primaryById.get(sourceImageId);
    if (!source) {
      throw new CanonicalImageReferenceError("canonical_crop_source_original_missing", {
        statusCode: 409,
        retryable: true
      });
    }
    if (image.storageRole === readabilityDerivedRole) {
      const downscaleMetadata = canonicalDownscaleLineage(image, source, assetId);
      return {
        ...image,
        sourceImageId: source.image_id,
        source_image_id: source.image_id,
        sourceRegion: null,
        source_region: null,
        cropMetadata: downscaleMetadata,
        crop_metadata: downscaleMetadata
      };
    }
    const cropMetadata = canonicalCropLineage(image, source, assetId);
    return {
      ...image,
      sourceImageId: source.image_id,
      source_image_id: source.image_id,
      sourceRegion: cropMetadata.source_region,
      source_region: cropMetadata.source_region,
      cropMetadata,
      crop_metadata: cropMetadata
    };
  });
}

/**
 * COS-53: which stored asset Recognition reads.
 *
 * The originals stay the system of record and are returned unchanged when
 * there is nothing better. A bounded downscale replaces one only when it
 * exists for that exact original AND is actually smaller -- re-checked here
 * rather than trusted from admission, because a selector that assumes its
 * input was validated is a selector that silently sends a 478KB "downscale" of
 * a 237KB original.
 *
 * The result names what was read, per slot, so a run can state it instead of
 * being reconstructed from byte counts afterwards.
 */
export function selectRecognitionImages(images = [], { slots = 2 } = {}) {
  const source = Array.isArray(images) ? images : [];
  const originals = source
    .filter((image) => image?.derived !== true)
    .slice(0, slots);
  const downscales = source.filter((image) => image?.derived === true
    && (image.storageRole || image.storage_role) === readabilityDerivedRole);

  const selected = [];
  const read = [];
  for (const original of originals) {
    const originalSize = Number(original.size) || 0;
    const downscale = downscales.find((candidate) => {
      const sourceId = cleanText(candidate.source_image_id || candidate.sourceImageId);
      return sourceId && sourceId === cleanText(original.image_id);
    });
    const downscaleSize = Number(downscale?.size) || 0;
    const useDownscale = Boolean(downscale) && downscaleSize > 0
      && originalSize > 0 && downscaleSize < originalSize;
    selected.push(useDownscale ? downscale : original);
    read.push({
      image_role: canonicalPrimaryRole(original),
      read: useDownscale ? "readability_derived" : "original",
      bytes: useDownscale ? downscaleSize : originalSize,
      original_bytes: originalSize,
      // Present but not used is worth recording separately from absent: it is
      // the case the byte rule exists for.
      derived_available: Boolean(downscale),
      derived_bytes: downscale ? downscaleSize : null
    });
  }
  return { images: selected, read };
}

function canonicalPrimaryRole(image = {}) {
  const slot = primaryRoleSlots.get(image.storageRole || image.storage_role);
  return slot === 0 ? "front_original" : slot === 1 ? "back_original" : (image.storage_role || null);
}

function canonicalImageReference(image = {}) {
  const primarySlot = primaryRoleSlots.get(image.storageRole);
  const canonicalRole = primarySlot === 0
    ? "front_original"
    : primarySlot === 1
      ? "back_original"
      : image.storage_role;
  return {
    image_id: image.image_id,
    image_role: canonicalRole,
    bucket: image.bucket,
    object_path: image.object_path,
    content_sha256: image.content_sha256 || null,
    derived: image.derived === true,
    source_image_id: image.source_image_id || null,
    source_region: image.source_region || null,
    crop_metadata: image.crop_metadata || null
  };
}

function canonicalImagePathProjection(imageReferences = []) {
  const front = imageReferences.find((reference) => reference.image_role === "front_original") || null;
  const back = imageReferences.find((reference) => reference.image_role === "back_original") || null;
  const additional = imageReferences.filter(
    (reference) => !["front_original", "back_original"].includes(reference.image_role)
  );
  return {
    front_bucket: front?.bucket || null,
    front_object_path: front?.object_path || null,
    front_content_sha256: front?.content_sha256 || null,
    back_bucket: back?.bucket || null,
    back_object_path: back?.object_path || null,
    back_content_sha256: back?.content_sha256 || null,
    additional_image_paths: additional
  };
}

export async function readCanonicalListingImageReferences({
  tenantId,
  assetId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedAssetId = normalizeDurableListingAssetId(assetId);
  const assetPromise = requireTenantListingAsset({
      tenantId,
      assetId: normalizedAssetId,
      requireDurable: true,
      env,
      fetchImpl
    }).catch((error) => {
    const missing = String(error?.message || "").includes("listing_asset_not_found");
    throw new CanonicalImageReferenceError(
      missing ? "canonical_listing_asset_not_found" : "canonical_listing_asset_read_failed",
      { statusCode: missing ? 404 : 503, retryable: !missing, cause: error }
    );
  });

  const verificationPromise = readSupabaseRows({
    table: "listing_image_verifications",
    select: [
      "tenant_id",
      "asset_id",
      "image_id",
      "storage_role",
      "image_generation_id",
      "crop_metadata",
      "canonical_eligible",
      "object_path",
      "bucket",
      "content_type",
      "size",
      "width",
      "height",
      "content_sha256",
      "object_verified",
      "content_hash_verified",
      "verified_at",
      "created_at",
      "updated_at"
    ].join(","),
    search: {
      tenant_id: `eq.${tenantId}`,
      asset_id: `eq.${normalizedAssetId}`,
      image_generation_id: `eq.${normalizedAssetId}`,
      object_verified: "eq.true",
      canonical_eligible: "eq.true",
      order: "object_path.asc",
      limit: "101"
    },
    env,
    fetchImpl
  });
  // Both reads are independently tenant/asset scoped and are validated again
  // below before any canonical reference is accepted. Running them together
  // removes one Supabase round trip from enqueue without weakening the six-part
  // storage identity or immutable-generation checks.
  const [asset, result] = await Promise.all([assetPromise, verificationPromise]);
  if (!result.ok) {
    throw new CanonicalImageReferenceError("canonical_image_verification_read_failed", {
      statusCode: 503,
      retryable: true,
      cause: new Error(result.error || "unknown_error")
    });
  }
  if (!result.rows.length) {
    throw new CanonicalImageReferenceError("canonical_verified_image_set_incomplete", {
      statusCode: 409,
      retryable: true
    });
  }
  if (result.rows.length > 100) {
    throw new CanonicalImageReferenceError("canonical_image_limit_exceeded", {
      statusCode: 409,
      retryable: false
    });
  }

  let images = result.rows
    .map((row) => canonicalImageFromVerificationRecord(row, {
      tenantId,
      assetId: normalizedAssetId
    }))
    .sort(compareCanonicalImages);
  if (!images.some((image) => !image.derived)) {
    throw new CanonicalImageReferenceError("canonical_original_image_missing", {
      statusCode: 409,
      retryable: true
    });
  }
  for (const slot of new Set(primaryRoleSlots.values())) {
    if (images.filter((image) => primaryRoleSlots.get(image.storageRole) === slot).length > 1) {
      throw new CanonicalImageReferenceError("canonical_primary_image_role_duplicate");
    }
  }
  if (new Set(images.map((image) => image.objectPath)).size !== images.length) {
    throw new CanonicalImageReferenceError("canonical_image_object_path_duplicate");
  }
  const expectedOriginalCount = Number(asset?.row?.expected_original_count);
  if (!Number.isInteger(expectedOriginalCount) || expectedOriginalCount < 1 || expectedOriginalCount > 2) {
    throw new CanonicalImageReferenceError("canonical_image_manifest_missing", {
      statusCode: 409,
      retryable: false
    });
  }
  const primaryImages = images.filter((image) => !image.derived);
  const presentSlots = new Set(primaryImages.map((image) => primaryRoleSlots.get(image.storageRole)));
  if (
    cleanText(asset?.row?.image_generation_id) !== normalizedAssetId
    || primaryImages.length !== expectedOriginalCount
    || [...Array(expectedOriginalCount).keys()].some((slot) => !presentSlots.has(slot))
  ) {
    throw new CanonicalImageReferenceError("canonical_verified_image_set_incomplete", {
      statusCode: 409,
      retryable: true
    });
  }
  images = finalizeCanonicalCropLineage(images, normalizedAssetId);
  const imageReferences = images.map(canonicalImageReference);
  const imagePaths = canonicalImagePathProjection(imageReferences);
  const imageSetSha256 = crypto.createHash("sha256")
    .update(imageReferences.map((reference) => [
      reference.image_role,
      reference.image_id,
      reference.bucket,
      reference.object_path,
      reference.content_sha256,
      reference.source_image_id,
      reference.source_region
    ].map((value) => cleanText(value)).join("\u001f")).join("\u001e"))
    .digest("hex");

  return {
    tenant_id: cleanText(tenantId),
    asset_id: normalizedAssetId,
    image_generation_id: normalizedAssetId,
    expected_original_count: expectedOriginalCount,
    image_set_sha256: imageSetSha256,
    image_paths: imagePaths,
    images,
    image_references: imageReferences
  };
}
