export const defaultCaptureProfileId = "standard-card-v1";

export const captureSurfaceTypes = Object.freeze({
  RAW_CARD: "RAW_CARD",
  SLEEVE: "SLEEVE",
  TOP_LOADER: "TOP_LOADER",
  SLAB: "SLAB",
  UNKNOWN: "UNKNOWN"
});

export const glareRoutes = Object.freeze({
  CLEAR: "GLARE_CLEAR",
  RECOVERED: "GLARE_RECOVERED",
  EXTERNALLY_VERIFIED: "GLARE_EXTERNALLY_VERIFIED",
  TARGETED_RESCAN_REQUIRED: "TARGETED_RESCAN_REQUIRED",
  UNRESOLVED_MANUAL: "GLARE_UNRESOLVED_MANUAL"
});

export const criticalRegionStatus = Object.freeze({
  CLEAR: "CLEAR",
  REVIEW: "REVIEW",
  OCCLUDED: "OCCLUDED"
});

export const defaultCaptureProfile = Object.freeze({
  id: defaultCaptureProfileId,
  expected_aspect_ratio: 0.70,
  aspect_ratio_tolerance: 0.18,
  min_long_edge: 900,
  blur_threshold: 0.68,
  glare_threshold: 0.26,
  readability_threshold: 0.34,
  critical_regions: Object.freeze({
    subject_name: { x: 0.14, y: 0.08, width: 0.72, height: 0.22 },
    year_product: { x: 0.10, y: 0.00, width: 0.80, height: 0.18 },
    card_type: { x: 0.10, y: 0.34, width: 0.80, height: 0.22 },
    parallel: { x: 0.08, y: 0.16, width: 0.84, height: 0.58 },
    serial_number: { x: 0.58, y: 0.70, width: 0.34, height: 0.22 },
    collector_number: { x: 0.04, y: 0.70, width: 0.34, height: 0.22 },
    checklist_code: { x: 0.08, y: 0.78, width: 0.50, height: 0.18 },
    grade_label: { x: 0.08, y: 0.00, width: 0.84, height: 0.18 },
    autograph: { x: 0.10, y: 0.54, width: 0.80, height: 0.24 },
    patch_relic: { x: 0.16, y: 0.30, width: 0.68, height: 0.34 }
  })
});

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value) {
  return Number(clamp01(value).toFixed(3));
}

function luminanceAt(data, index) {
  return (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
}

function saturationAt(data, index) {
  const r = data[index] / 255;
  const g = data[index + 1] / 255;
  const b = data[index + 2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function boundsForRegion(region, width, height) {
  return {
    left: Math.max(0, Math.floor(region.x * width)),
    top: Math.max(0, Math.floor(region.y * height)),
    right: Math.min(width, Math.ceil((region.x + region.width) * width)),
    bottom: Math.min(height, Math.ceil((region.y + region.height) * height))
  };
}

function analyzeBounds(imageData, bounds, sampleStep = 4) {
  const { data, width } = imageData;
  let count = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let brightLowSaturation = 0;
  let brightSaturated = 0;
  let edgeCount = 0;
  let edgeSum = 0;

  for (let y = bounds.top; y < bounds.bottom; y += sampleStep) {
    for (let x = bounds.left; x < bounds.right; x += sampleStep) {
      const index = (y * width + x) * 4;
      const luminance = luminanceAt(data, index);
      const saturation = saturationAt(data, index);
      luminanceSum += luminance;
      luminanceSquaredSum += luminance * luminance;
      count += 1;

      if (luminance >= 0.88 && saturation <= 0.18) brightLowSaturation += 1;
      if (luminance >= 0.88 && saturation > 0.18) brightSaturated += 1;

      if (x + sampleStep < bounds.right) {
        const rightIndex = (y * width + Math.min(x + sampleStep, width - 1)) * 4;
        const delta = Math.abs(luminance - luminanceAt(data, rightIndex));
        edgeSum += delta;
        if (delta > 0.08) edgeCount += 1;
      }

      if (y + sampleStep < bounds.bottom) {
        const bottomIndex = (Math.min(y + sampleStep, imageData.height - 1) * width + x) * 4;
        const delta = Math.abs(luminance - luminanceAt(data, bottomIndex));
        edgeSum += delta;
        if (delta > 0.08) edgeCount += 1;
      }
    }
  }

  if (count === 0) {
    return {
      brightness: 0,
      contrast: 0,
      glare_score: 0,
      edge_density: 0,
      readability_score: 0
    };
  }

  const brightness = luminanceSum / count;
  const variance = Math.max(0, luminanceSquaredSum / count - brightness * brightness);
  const contrast = Math.sqrt(variance);
  const lowSatGlareRatio = brightLowSaturation / count;
  const saturatedBrightRatio = brightSaturated / count;
  const edgeDensity = edgeCount / Math.max(1, count * 2);
  const edgeStrength = edgeSum / Math.max(1, count * 2);
  const rawGlareScore = lowSatGlareRatio * 0.66
    + Math.max(0, brightness - 0.82) * 0.20
    + Math.max(0, 0.08 - contrast) * 0.85
    + saturatedBrightRatio * 0.08;
  const glareScore = rawGlareScore - edgeDensity * 1.2 - contrast * 0.55;
  const readabilityScore = edgeDensity * 1.8
    + edgeStrength * 1.5
    + contrast * 1.1
    - lowSatGlareRatio * 0.85;

  return {
    brightness: roundScore(brightness),
    contrast: roundScore(contrast),
    glare_score: roundScore(glareScore),
    edge_density: roundScore(edgeDensity),
    readability_score: roundScore(readabilityScore)
  };
}

function regionStatus(regionQuality, profile) {
  if (
    regionQuality.contrast >= 0.16 &&
    regionQuality.glare_score <= profile.glare_threshold * 1.2
  ) {
    return criticalRegionStatus.CLEAR;
  }

  if (
    regionQuality.glare_score >= profile.glare_threshold &&
    regionQuality.contrast < 0.16
  ) {
    return criticalRegionStatus.OCCLUDED;
  }

  if (
    regionQuality.readability_score < profile.readability_threshold ||
    regionQuality.glare_score >= profile.glare_threshold * 0.62
  ) {
    return criticalRegionStatus.REVIEW;
  }

  return criticalRegionStatus.CLEAR;
}

function likelySurfaceType(width, height, criticalRegions) {
  const aspectRatio = width / Math.max(1, height);
  const gradeRegion = criticalRegions.grade_label;
  if (gradeRegion?.status !== criticalRegionStatus.CLEAR && aspectRatio < 0.68) {
    return captureSurfaceTypes.SLAB;
  }

  return captureSurfaceTypes.UNKNOWN;
}

export function analyzeImageQualityFromImageData(imageData, profile = defaultCaptureProfile) {
  const width = imageData.width;
  const height = imageData.height;
  const longEdge = Math.max(width, height);
  const aspectRatio = width / Math.max(1, height);
  const aspectDeviation = Math.abs(aspectRatio - profile.expected_aspect_ratio) / profile.expected_aspect_ratio;
  const fullBounds = { left: 0, top: 0, right: width, bottom: height };
  const full = analyzeBounds(imageData, fullBounds, Math.max(2, Math.round(longEdge / 280)));
  const criticalRegionOcclusion = {};

  for (const [name, region] of Object.entries(profile.critical_regions)) {
    const quality = analyzeBounds(imageData, boundsForRegion(region, width, height), Math.max(2, Math.round(longEdge / 260)));
    criticalRegionOcclusion[name] = {
      status: regionStatus(quality, profile),
      glare_score: quality.glare_score,
      readability_score: quality.readability_score,
      brightness: quality.brightness,
      contrast: quality.contrast
    };
  }

  const occludedRegions = Object.values(criticalRegionOcclusion)
    .filter((region) => region.status === criticalRegionStatus.OCCLUDED)
    .length;
  const reviewRegions = Object.values(criticalRegionOcclusion)
    .filter((region) => region.status === criticalRegionStatus.REVIEW)
    .length;
  const blurScore = roundScore(1 - Math.min(1, full.edge_density * 4.2 + full.contrast * 1.2));
  const perspectiveScore = roundScore(aspectDeviation / Math.max(0.01, profile.aspect_ratio_tolerance));
  const resolutionSufficient = longEdge >= profile.min_long_edge;
  const cropComplete = aspectDeviation <= profile.aspect_ratio_tolerance;
  const imageQualityDegraded = blurScore >= profile.blur_threshold
    || full.glare_score >= profile.glare_threshold
    || !resolutionSufficient
    || !cropComplete
    || occludedRegions > 0
    || reviewRegions >= 3;
  const route = occludedRegions > 0 ? glareRoutes.TARGETED_RESCAN_REQUIRED : glareRoutes.CLEAR;

  return {
    capture_profile_id: profile.id,
    capture_surface_type: likelySurfaceType(width, height, criticalRegionOcclusion),
    blur_score: blurScore,
    glare_score: full.glare_score,
    perspective_score: perspectiveScore,
    crop_complete: cropComplete,
    text_readability_score: full.readability_score,
    resolution_sufficient: resolutionSufficient,
    image_quality_degraded: imageQualityDegraded,
    critical_region_occlusion: criticalRegionOcclusion,
    glare_route: route
  };
}

export function summarizeAssetImageQuality(images = []) {
  const qualities = images.map((image) => image.imageQuality || image.image_quality).filter(Boolean);
  const degraded = qualities.some((quality) => quality.image_quality_degraded);
  const regionNames = new Set();
  qualities.forEach((quality) => {
    Object.keys(quality.critical_region_occlusion || {}).forEach((regionName) => regionNames.add(regionName));
  });

  const criticalRegionOcclusion = {};
  const recoveredRegions = [];
  const unresolvedRegions = [];

  regionNames.forEach((regionName) => {
    const regionQualities = qualities
      .map((quality, imageIndex) => ({
        image_index: imageIndex,
        ...(quality.critical_region_occlusion?.[regionName] || {})
      }))
      .filter((region) => region.status);
    const clearRegion = regionQualities.find((region) => region.status === criticalRegionStatus.CLEAR);
    const occludedRegions = regionQualities.filter((region) => region.status === criticalRegionStatus.OCCLUDED);
    const reviewRegion = regionQualities.find((region) => region.status === criticalRegionStatus.REVIEW);

    if (occludedRegions.length && clearRegion) {
      recoveredRegions.push(regionName);
      criticalRegionOcclusion[regionName] = {
        status: criticalRegionStatus.CLEAR,
        recovered: true,
        recovery_method: "alternate_view",
        clear_image_index: clearRegion.image_index,
        occluded_image_indices: occludedRegions.map((region) => region.image_index)
      };
      return;
    }

    if (occludedRegions.length) {
      unresolvedRegions.push(regionName);
      criticalRegionOcclusion[regionName] = {
        status: criticalRegionStatus.OCCLUDED,
        recovered: false,
        occluded_image_indices: occludedRegions.map((region) => region.image_index),
        glare_score: Math.max(...occludedRegions.map((region) => Number(region.glare_score || 0))),
        readability_score: Math.min(...occludedRegions.map((region) => Number(region.readability_score ?? 1)))
      };
      return;
    }

    if (clearRegion || reviewRegion) {
      const representative = clearRegion || reviewRegion;
      criticalRegionOcclusion[regionName] = {
        status: representative.status,
        recovered: false,
        image_index: representative.image_index,
        glare_score: representative.glare_score ?? null,
        readability_score: representative.readability_score ?? null
      };
    }
  });

  const route = unresolvedRegions.length
    ? glareRoutes.TARGETED_RESCAN_REQUIRED
    : recoveredRegions.length
      ? glareRoutes.RECOVERED
      : glareRoutes.CLEAR;

  return {
    capture_profile_id: qualities[0]?.capture_profile_id || defaultCaptureProfileId,
    image_count: qualities.length,
    image_quality_degraded: degraded,
    route,
    glare_route: route,
    recovered_regions: recoveredRegions,
    unresolved_regions: unresolvedRegions,
    critical_region_occlusion: criticalRegionOcclusion,
    images: qualities
  };
}
