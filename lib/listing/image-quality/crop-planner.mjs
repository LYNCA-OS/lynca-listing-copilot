import {
  criticalRegionStatus,
  defaultCaptureProfile
} from "./quality-gate.mjs";

export const cropRolesByRegion = Object.freeze({
  subject_name: "subject_crop",
  subject_slot_1: "subject_crop",
  subject_slot_2: "subject_crop",
  subject_slot_3: "subject_crop",
  serial_number: "serial_crop",
  surface_color: "parallel_crop",
  parallel_family: "parallel_crop",
  parallel_exact: "parallel_crop",
  parallel: "parallel_crop",
  parallel_surface: "parallel_crop",
  variation: "parallel_crop",
  collector_number: "card_code_crop",
  checklist_code: "card_code_crop",
  grade_label: "grade_label_crop",
  year_product: "year_product_crop",
  card_type: "card_type_crop",
  autograph: "autograph_crop",
  patch_relic: "patch_relic_crop"
});

const priorityByRegion = Object.freeze({
  serial_number: 10,
  year_product: 9,
  grade_label: 8.5,
  subject_name: 8,
  subject_slot_1: 7.9,
  subject_slot_2: 7.8,
  subject_slot_3: 7.7,
  collector_number: 7,
  checklist_code: 7,
  card_type: 6,
  surface_color: 5,
  parallel_family: 5,
  parallel_exact: 5,
  parallel: 5,
  parallel_surface: 5,
  variation: 8,
  autograph: 4,
  patch_relic: 4
});

export const fieldCropTransformVersion = "field-crop-v1";

export const defaultHighRiskCropRegions = Object.freeze([
  "serial_number",
  "year_product",
  "grade_label",
  "subject_name",
  "collector_number",
  "checklist_code",
  "card_type"
]);

function cropBoundsForRegion(region, margin = 0.06) {
  const x = Math.max(0, region.x - margin);
  const y = Math.max(0, region.y - margin);
  const right = Math.min(1, region.x + region.width + margin);
  const bottom = Math.min(1, region.y + region.height + margin);

  return {
    x,
    y,
    width: Math.max(0.01, right - x),
    height: Math.max(0.01, bottom - y)
  };
}

function shouldCrop(status) {
  return status === criticalRegionStatus.OCCLUDED || status === criticalRegionStatus.REVIEW;
}

function normalizeFieldSet(fields = []) {
  return new Set((Array.isArray(fields) ? fields : [])
    .map((field) => String(field || "").trim())
    .filter(Boolean));
}

function stableIdPart(value, fallback) {
  return String(value || fallback || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function pixelBoundsForCrop(cropRegion, width = 0, height = 0) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return {};
  }

  const left = Math.max(0, Math.floor(cropRegion.x * sourceWidth));
  const top = Math.max(0, Math.floor(cropRegion.y * sourceHeight));
  const cropWidth = Math.max(1, Math.min(sourceWidth - left, Math.ceil(cropRegion.width * sourceWidth)));
  const cropHeight = Math.max(1, Math.min(sourceHeight - top, Math.ceil(cropRegion.height * sourceHeight)));

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight
  };
}

function reasonForRegion({ quality, regionName, requestedFields, highRiskFields, reviewFields, conflictFields } = {}) {
  if (quality && shouldCrop(quality.status)) {
    return quality.status === criticalRegionStatus.OCCLUDED
      ? "critical_region_occluded"
      : "critical_region_review";
  }
  if (conflictFields.has(regionName)) return "field_conflict";
  if (reviewFields.has(regionName)) return "field_review";
  if (requestedFields.has(regionName)) return "field_requested";
  if (highRiskFields.has(regionName)) return "high_risk_field";
  return "";
}

function sourceSideForImage(sourceSide = "") {
  const normalized = String(sourceSide || "").trim().toLowerCase();
  if (normalized.includes("back")) return "back";
  if (normalized.includes("front")) return "front";
  return null;
}

export function createFieldCropMetadata({
  assetId = "",
  imageId = "",
  sourceObjectPath = "",
  sourceSide = "",
  sourceRegion = "",
  cropRole = "",
  cropRegion = {},
  sourceWidth = 0,
  sourceHeight = 0,
  transformVersion = fieldCropTransformVersion,
  derivedObjectPath = "",
  createdAt = null
} = {}) {
  const cropId = [
    stableIdPart(assetId, "asset"),
    stableIdPart(imageId, "image"),
    stableIdPart(sourceRegion, "region"),
    stableIdPart(transformVersion, "transform")
  ].join("__");

  return {
    crop_id: cropId,
    asset_id: assetId || "",
    source_image_id: imageId || "",
    source_object_path: sourceObjectPath || "",
    source_side: sourceSideForImage(sourceSide),
    source_region: sourceRegion || "",
    crop_role: cropRole || "",
    normalized_bounds: {
      x: cropRegion.x ?? 0,
      y: cropRegion.y ?? 0,
      width: cropRegion.width ?? 0,
      height: cropRegion.height ?? 0
    },
    pixel_bounds: pixelBoundsForCrop(cropRegion, sourceWidth, sourceHeight),
    derived_object_path: derivedObjectPath || "",
    transform_version: transformVersion,
    created_at: createdAt || new Date().toISOString()
  };
}

export function planTargetedCrops({
  assetId = "",
  imageId,
  sourceObjectPath = "",
  sourceSide = "",
  sourceWidth = 0,
  sourceHeight = 0,
  imageQuality,
  profile = defaultCaptureProfile,
  requestedFields = [],
  highRiskFields = defaultHighRiskCropRegions,
  reviewFields = [],
  conflictFields = [],
  maxCrops = 6,
  transformVersion = fieldCropTransformVersion
} = {}) {
  const occlusion = imageQuality?.critical_region_occlusion || {};
  const requested = normalizeFieldSet(requestedFields);
  const highRisk = normalizeFieldSet(highRiskFields);
  const review = normalizeFieldSet(reviewFields);
  const conflict = normalizeFieldSet(conflictFields);

  return Object.entries(cropRolesByRegion)
    .map(([regionName, role]) => {
      const quality = occlusion[regionName];
      const region = profile.critical_regions[regionName];
      if (!region) return null;
      const reason = reasonForRegion({
        quality,
        regionName,
        requestedFields: requested,
        highRiskFields: highRisk,
        reviewFields: review,
        conflictFields: conflict
      });
      if (!reason) return null;
      const cropRegion = cropBoundsForRegion(region);

      return {
        source_image_id: imageId || null,
        source_region: regionName,
        role,
        status: quality?.status || null,
        reason,
        priority: priorityByRegion[regionName] || 0,
        crop_region: cropRegion,
        crop_metadata: createFieldCropMetadata({
          assetId,
          imageId,
          sourceObjectPath,
          sourceSide,
          sourceRegion: regionName,
          cropRole: role,
          cropRegion,
          sourceWidth,
          sourceHeight,
          transformVersion
        }),
        glare_score: quality?.glare_score ?? null,
        readability_score: quality?.readability_score ?? null
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxCrops);
}
