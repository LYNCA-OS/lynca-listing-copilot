import {
  criticalRegionStatus,
  defaultCaptureProfile
} from "./quality-gate.mjs";

export const cropRolesByRegion = Object.freeze({
  serial_number: "serial_crop",
  parallel: "parallel_crop",
  variation: "parallel_crop",
  collector_number: "card_code_crop",
  checklist_code: "card_code_crop",
  grade_label: "grade_label_crop",
  year_product: "year_product_crop"
});

const priorityByRegion = Object.freeze({
  serial_number: 10,
  parallel: 9,
  variation: 8,
  checklist_code: 7,
  collector_number: 6,
  grade_label: 5,
  year_product: 4
});

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

export function planTargetedCrops({
  imageId,
  imageQuality,
  profile = defaultCaptureProfile,
  maxCrops = 4
} = {}) {
  const occlusion = imageQuality?.critical_region_occlusion || {};

  return Object.entries(cropRolesByRegion)
    .map(([regionName, role]) => {
      const quality = occlusion[regionName];
      const region = profile.critical_regions[regionName];
      if (!quality || !region || !shouldCrop(quality.status)) return null;

      return {
        source_image_id: imageId || null,
        source_region: regionName,
        role,
        status: quality.status,
        reason: quality.status === criticalRegionStatus.OCCLUDED
          ? "critical_region_occluded"
          : "critical_region_review",
        priority: priorityByRegion[regionName] || 0,
        crop_region: cropBoundsForRegion(region),
        glare_score: quality.glare_score,
        readability_score: quality.readability_score
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxCrops);
}
