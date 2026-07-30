import crypto from "node:crypto";

import {
  cropRolesByRegion,
  fieldCropTransformVersion
} from "../image-quality/crop-planner.mjs";
import { assertTenantListingAssetObjectPath } from "../storage/storage-verification-store.mjs";

export const currentImageManifestSchemaVersion = "current-image-manifest-v1";
export const currentImageCropPolicyVersion = "canonical-field-crop-policy-v1";

const sha256Pattern = /^[0-9a-f]{64}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function firstText(...values) {
  return values.map(text).find(Boolean) || "";
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function invalid(reasonCode) {
  return deepFreeze({
    schema_version: currentImageManifestSchemaVersion,
    status: "UNKNOWN",
    reason_code: reasonCode,
    tenant_id: null,
    asset_id: null,
    image_generation_id: null,
    images: [],
    image_set_fingerprint: null
  });
}

function normalizedImage(image = {}) {
  const crop = object(image.crop_metadata || image.cropMetadata || image.crop_lineage);
  return {
    image_id: firstText(image.image_id, image.imageId, image.id, image.derived_id),
    object_path: firstText(image.object_path, image.objectPath, image.storage_path),
    content_sha256: firstText(image.content_sha256, image.contentSha256, image.sha256).toLowerCase(),
    tenant_id: firstText(image.tenant_id, image.tenantId),
    asset_id: firstText(image.asset_id, image.assetId),
    image_generation_id: firstText(image.image_generation_id, image.imageGenerationId),
    width: Number(image.width || image.originalWidth || image.original_width) || null,
    height: Number(image.height || image.originalHeight || image.original_height) || null,
    storage_verified: image.storage_verified === true || image.storageVerified === true,
    derived: image.derived === true || Object.keys(crop).length > 0,
    crop_metadata: crop
  };
}

function normalizedCropBounds(value = {}) {
  const input = object(value);
  const bounds = Object.fromEntries(["x", "y", "width", "height"].map((field) => {
    const number = Number(input[field]);
    return [field, Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : null];
  }));
  if (Object.values(bounds).some((number) => number === null)
    || bounds.x < 0
    || bounds.y < 0
    || bounds.width <= 0
    || bounds.height <= 0
    || bounds.x >= 1
    || bounds.y >= 1
    || bounds.x + bounds.width > 1.000001
    || bounds.y + bounds.height > 1.000001) return null;
  return bounds;
}

function pixelBoundsForCrop(bounds, width, height) {
  const left = Math.max(0, Math.floor(bounds.x * width));
  const top = Math.max(0, Math.floor(bounds.y * height));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.ceil(bounds.width * width))),
    height: Math.max(1, Math.min(height - top, Math.ceil(bounds.height * height)))
  };
}

function normalizedPixelBounds(value = {}) {
  const input = object(value);
  const output = Object.fromEntries(["left", "top", "width", "height"].map((field) => {
    const number = Number(input[field]);
    return [field, Number.isInteger(number) ? number : null];
  }));
  return Object.values(output).some((number) => number === null) ? null : output;
}

function cropLineage(row, byId, tenantId, assetId, generationId) {
  if (!row.derived) return { ok: true, value: null };
  const crop = row.crop_metadata;
  const sourceImageId = firstText(crop.source_image_id, crop.sourceImageId);
  const source = byId.get(sourceImageId);
  const cropId = firstText(crop.crop_id, crop.cropId);
  const sourcePath = firstText(crop.source_object_path, crop.sourceObjectPath);
  const sourceSha = firstText(crop.source_content_sha256, crop.sourceContentSha256).toLowerCase();
  const derivedPath = firstText(crop.derived_object_path, crop.derivedObjectPath);
  const cropRole = firstText(crop.crop_role, crop.cropRole);
  const sourceRegion = firstText(crop.source_region, crop.sourceRegion);
  const sourceSide = firstText(crop.source_side, crop.sourceSide).toLowerCase();
  const transformVersion = firstText(crop.transform_version, crop.transformVersion);
  const normalizedBounds = normalizedCropBounds(crop.normalized_bounds || crop.normalizedBounds);
  const sourceWidth = Number(crop.source_width || crop.sourceWidth);
  const sourceHeight = Number(crop.source_height || crop.sourceHeight);
  const pixelBounds = normalizedPixelBounds(crop.pixel_bounds || crop.pixelBounds);
  const expectedPixelBounds = normalizedBounds
    && Number.isFinite(sourceWidth) && sourceWidth > 0
    && Number.isFinite(sourceHeight) && sourceHeight > 0
    ? pixelBoundsForCrop(normalizedBounds, sourceWidth, sourceHeight)
    : null;
  if (!source
    || source.derived
    || !cropId
    || cropId !== row.image_id
    || firstText(crop.asset_id, crop.assetId) !== assetId
    || firstText(crop.generation_id, crop.image_generation_id, crop.imageGenerationId) !== generationId
    || source.tenant_id !== tenantId
    || source.asset_id !== assetId
    || source.image_generation_id !== generationId
    || sourcePath !== source.object_path
    || sourceSha !== source.content_sha256
    || derivedPath !== row.object_path
    || !cropRole
    || !sourceRegion
    || cropRolesByRegion[sourceRegion] !== cropRole
    || !["front", "back"].includes(sourceSide)
    || transformVersion !== fieldCropTransformVersion
    || !normalizedBounds
    || !expectedPixelBounds
    || source.width !== sourceWidth
    || source.height !== sourceHeight
    || JSON.stringify(pixelBounds) !== JSON.stringify(expectedPixelBounds)) {
    return { ok: false, value: null };
  }
  return {
    ok: true,
    value: {
      crop_id: cropId,
      source_image_id: source.image_id,
      source_object_path: source.object_path,
      source_content_sha256: source.content_sha256,
      derived_image_id: row.image_id,
      derived_object_path: row.object_path,
      derived_content_sha256: row.content_sha256,
      asset_id: assetId,
      image_generation_id: generationId,
      crop_role: cropRole,
      source_region: sourceRegion,
      source_side: sourceSide,
      transform_version: transformVersion,
      source_width: sourceWidth,
      source_height: sourceHeight,
      normalized_bounds: normalizedBounds,
      pixel_bounds: pixelBounds,
      crop_policy_version: currentImageCropPolicyVersion
    }
  };
}

export function buildVerifiedCurrentImageManifest(context = {}) {
  const input = object(context);
  const tenantId = firstText(input.tenant_id, input.tenantId);
  const assetId = firstText(input.asset_id, input.assetId);
  const generationId = firstText(input.image_generation_id, input.imageGenerationId);
  if (!tenantId || !assetId || !generationId) return invalid("CURRENT_IMAGE_CONTEXT_IDENTITY_MISSING");
  const sourceRows = Array.isArray(input.images) ? input.images : [];
  if (!sourceRows.length) return invalid("CURRENT_IMAGE_CONTEXT_IMAGES_MISSING");
  const rows = sourceRows.map(normalizedImage);
  const byId = new Map();
  const paths = new Set();
  for (const row of rows) {
    if (!row.storage_verified
      || !row.image_id
      || !row.object_path
      || !sha256Pattern.test(row.content_sha256)
      || row.tenant_id !== tenantId
      || row.asset_id !== assetId
      || row.image_generation_id !== generationId) {
      return invalid("CURRENT_IMAGE_CONTEXT_IMAGE_IDENTITY_INVALID");
    }
    try {
      assertTenantListingAssetObjectPath({ tenantId, assetId, objectPath: row.object_path });
    } catch {
      return invalid("CURRENT_IMAGE_CONTEXT_IMAGE_PATH_INVALID");
    }
    if (byId.has(row.image_id) || paths.has(row.object_path)) {
      return invalid("CURRENT_IMAGE_CONTEXT_IMAGE_DUPLICATE");
    }
    byId.set(row.image_id, row);
    paths.add(row.object_path);
  }
  const images = [];
  for (const row of rows) {
    const lineage = cropLineage(row, byId, tenantId, assetId, generationId);
    if (!lineage.ok) return invalid("CURRENT_IMAGE_CONTEXT_CROP_LINEAGE_INVALID");
    images.push({
      image_id: row.image_id,
      object_path: row.object_path,
      content_sha256: row.content_sha256,
      tenant_id: tenantId,
      asset_id: assetId,
      image_generation_id: generationId,
      width: row.width,
      height: row.height,
      storage_verified: true,
      derived: row.derived,
      crop_lineage: lineage.value
    });
  }
  images.sort((left, right) => left.image_id.localeCompare(right.image_id));
  const fingerprintInput = {
    tenant_id: tenantId,
    asset_id: assetId,
    image_generation_id: generationId,
    images
  };
  return deepFreeze({
    schema_version: currentImageManifestSchemaVersion,
    status: "COMPLETE",
    reason_code: null,
    ...fingerprintInput,
    image_set_fingerprint: fingerprint(fingerprintInput)
  });
}

export function verifiedCurrentImageManifestFromImages(images = []) {
  const rows = Array.isArray(images) ? images : [];
  const first = normalizedImage(rows[0] || {});
  return buildVerifiedCurrentImageManifest({
    tenant_id: first.tenant_id,
    asset_id: first.asset_id,
    image_generation_id: first.image_generation_id,
    images: rows
  });
}

export function currentImageManifestMatches(left = {}, rightContext = {}) {
  if (left?.schema_version !== currentImageManifestSchemaVersion || left?.status !== "COMPLETE") {
    return { valid: false, reason_code: "CURRENT_IMAGE_SNAPSHOT_MANIFEST_INVALID" };
  }
  const rebuiltLeft = buildVerifiedCurrentImageManifest(left);
  if (rebuiltLeft.status !== "COMPLETE"
    || rebuiltLeft.image_set_fingerprint !== left.image_set_fingerprint) {
    return { valid: false, reason_code: "CURRENT_IMAGE_SNAPSHOT_FINGERPRINT_INVALID" };
  }
  const right = buildVerifiedCurrentImageManifest(rightContext);
  if (right.status !== "COMPLETE") {
    return { valid: false, reason_code: right.reason_code || "CURRENT_IMAGE_REPLAY_CONTEXT_INVALID" };
  }
  if (right.image_set_fingerprint !== rebuiltLeft.image_set_fingerprint) {
    return { valid: false, reason_code: "CURRENT_IMAGE_REPLAY_CONTEXT_MISMATCH" };
  }
  return { valid: true, reason_code: null, manifest: rebuiltLeft };
}

export function sourceIdentityForVerifiedImage(images = [], selectedImage = {}) {
  const manifest = verifiedCurrentImageManifestFromImages(images);
  if (manifest.status !== "COMPLETE") return null;
  const selectedId = firstText(
    selectedImage.image_id,
    selectedImage.imageId,
    selectedImage.id,
    selectedImage.derived_id
  );
  const row = manifest.images.find((image) => image.image_id === selectedId);
  if (!row) return null;
  if (row.derived) {
    const lineage = row.crop_lineage;
    return deepFreeze({
      tenant_id: manifest.tenant_id,
      asset_id: manifest.asset_id,
      image_generation_id: manifest.image_generation_id,
      source_image_id: lineage.source_image_id,
      source_object_path: lineage.source_object_path,
      source_content_sha256: lineage.source_content_sha256,
      source_crop_id: lineage.crop_id,
      derived_image_id: lineage.derived_image_id,
      derived_object_path: lineage.derived_object_path,
      derived_content_sha256: lineage.derived_content_sha256,
      crop_lineage: lineage,
      current_image_manifest_fingerprint: manifest.image_set_fingerprint
    });
  }
  return deepFreeze({
    tenant_id: manifest.tenant_id,
    asset_id: manifest.asset_id,
    image_generation_id: manifest.image_generation_id,
    source_image_id: row.image_id,
    source_object_path: row.object_path,
    source_content_sha256: row.content_sha256,
    source_crop_id: null,
    derived_image_id: null,
    derived_object_path: null,
    derived_content_sha256: null,
    crop_lineage: null,
    current_image_manifest_fingerprint: manifest.image_set_fingerprint
  });
}

export function matchStampedSourceToCurrentImageManifest(source = {}, manifestContext = {}) {
  const manifest = buildVerifiedCurrentImageManifest(manifestContext);
  if (manifest.status !== "COMPLETE") return null;
  // This is the authority boundary, not a compatibility parser. Every field
  // must be the exact server-stamped snake_case member; aliases and inferred
  // fallbacks are intentionally rejected.
  const tenantId = text(source.tenant_id);
  const assetId = text(source.asset_id);
  const generationId = text(source.image_generation_id);
  const imageId = text(source.source_image_id);
  const sourcePath = text(source.source_object_path);
  const sourceSha = text(source.source_content_sha256).toLowerCase();
  const sourceCropId = text(source.source_crop_id);
  const manifestFingerprint = firstText(source.current_image_manifest_fingerprint);
  if (!tenantId || !assetId || !generationId || !imageId || !sourcePath
    || !sha256Pattern.test(sourceSha) || !manifestFingerprint
    || tenantId !== manifest.tenant_id
    || assetId !== manifest.asset_id
    || generationId !== manifest.image_generation_id
    || manifestFingerprint !== manifest.image_set_fingerprint) return null;

  if (sourceCropId) {
    const row = manifest.images.find((image) => image.crop_lineage?.crop_id === sourceCropId);
    const lineage = object(source.crop_lineage);
    if (!row
      || imageId !== row.crop_lineage.source_image_id
      || sourcePath !== row.crop_lineage.source_object_path
      || sourceSha !== row.crop_lineage.source_content_sha256
      || firstText(source.derived_image_id) !== row.crop_lineage.derived_image_id
      || firstText(source.derived_object_path) !== row.crop_lineage.derived_object_path
      || firstText(source.derived_content_sha256).toLowerCase() !== row.crop_lineage.derived_content_sha256
      || JSON.stringify(canonical(lineage)) !== JSON.stringify(canonical(row.crop_lineage))) return null;
    return { manifest, image: row, crop_lineage: row.crop_lineage };
  }
  const row = manifest.images.find((image) => !image.derived && image.image_id === imageId);
  if (!row || sourcePath !== row.object_path || sourceSha !== row.content_sha256
    || source.derived_object_path || source.derived_image_id || source.crop_lineage) return null;
  return { manifest, image: row, crop_lineage: null };
}
