import assert from "node:assert/strict";
import {
  analyzeImageQualityFromImageData,
  buildServerCaptureQualityFromCanonicalImages,
  criticalRegionStatus,
  defaultCaptureProfile,
  glareRoutes,
  summarizeAssetImageQuality
} from "../lib/listing/image-quality/quality-gate.mjs";
import { captureQualityPromptSummary } from "../lib/listing/pipeline/provider-prompt.mjs";

const width = 200;
const height = 286;
const testProfile = {
  ...defaultCaptureProfile,
  min_long_edge: 160
};

function imageData(fillPixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fillPixel(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

function paintRegion(data, region, pixel) {
  const left = Math.floor(region.x * width);
  const top = Math.floor(region.y * height);
  const right = Math.ceil((region.x + region.width) * width);
  const bottom = Math.ceil((region.y + region.height) * height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      const [r, g, b] = pixel(x, y);
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
    }
  }
}

const clearCard = imageData((x, y) => {
  const stripe = (x + y) % 12 < 6 ? 70 : 180;
  return [stripe, Math.max(30, stripe - 18), Math.min(220, stripe + 18)];
});
const clearQuality = analyzeImageQualityFromImageData(clearCard, testProfile);
assert.equal(clearQuality.glare_route, glareRoutes.CLEAR);
assert.equal(clearQuality.resolution_sufficient, true);
assert.equal(clearQuality.crop_complete, true);
assert.notEqual(clearQuality.critical_region_occlusion.serial_number.status, criticalRegionStatus.OCCLUDED);

const texturedWhiteCard = imageData((x, y) => {
  const line = x % 11 === 0 || y % 17 === 0;
  return line ? [80, 80, 80] : [242, 242, 238];
});
const texturedWhiteQuality = analyzeImageQualityFromImageData(texturedWhiteCard, testProfile);
assert.equal(texturedWhiteQuality.glare_route, glareRoutes.CLEAR, "textured white card surface should not be treated as glare by brightness alone");

const glareCard = imageData((x, y) => {
  const stripe = (x + y) % 12 < 6 ? 65 : 175;
  return [stripe, stripe + 8, stripe + 18];
});
paintRegion(glareCard.data, testProfile.critical_regions.serial_number, () => [252, 252, 250]);
const glareQuality = analyzeImageQualityFromImageData(glareCard, testProfile);
assert.equal(glareQuality.glare_route, glareRoutes.TARGETED_RESCAN_REQUIRED);
assert.equal(glareQuality.image_quality_degraded, true);
assert.equal(glareQuality.critical_region_occlusion.serial_number.status, criticalRegionStatus.OCCLUDED);

const summary = summarizeAssetImageQuality([
  { imageQuality: clearQuality },
  { imageQuality: glareQuality }
]);
assert.equal(summary.image_count, 2);
assert.equal(summary.image_quality_degraded, true);
assert.equal(summary.route, glareRoutes.RECOVERED);
assert.deepEqual(summary.recovered_regions, ["serial_number"]);
assert.deepEqual(summary.unresolved_regions, []);
assert.equal(summary.critical_region_occlusion.serial_number.recovery_method, "alternate_view");

const unresolvedSummary = summarizeAssetImageQuality([
  { imageQuality: glareQuality }
]);
assert.equal(unresolvedSummary.route, glareRoutes.TARGETED_RESCAN_REQUIRED);
assert.deepEqual(unresolvedSummary.recovered_regions, []);
assert.deepEqual(unresolvedSummary.unresolved_regions, ["serial_number"]);
assert.equal(unresolvedSummary.critical_region_occlusion.serial_number.status, criticalRegionStatus.OCCLUDED);

const clearSummary = summarizeAssetImageQuality([
  { imageQuality: clearQuality }
]);
assert.equal(clearSummary.route, glareRoutes.CLEAR);
assert.deepEqual(clearSummary.recovered_regions, []);
assert.deepEqual(clearSummary.unresolved_regions, []);

const metadataOnlyUnknown = buildServerCaptureQualityFromCanonicalImages([{
  image_id: "front",
  storage_verified: true
}], { imageGenerationHash: "a".repeat(64) });
assert.equal(metadataOnlyUnknown.route, null, "metadata alone must not claim a glare-clear visual observation");
assert.equal(metadataOnlyUnknown.glare_route, null);
assert.equal(metadataOnlyUnknown.image_quality_degraded, null, "missing dimensions are UNKNOWN, not degraded");
assert.equal(metadataOnlyUnknown.images[0].resolution_sufficient, null);
assert.equal(metadataOnlyUnknown.images[0].crop_complete, null);
assert.equal(metadataOnlyUnknown.images[0].image_quality_degraded, null);
const metadataOnlyPrompt = captureQualityPromptSummary({
  image_set_sha256: "a".repeat(64),
  effective_capture_quality: metadataOnlyUnknown,
  images: [{}]
});
assert.equal(metadataOnlyPrompt.route, null);
assert.equal(metadataOnlyPrompt.glare_route, null);
assert.equal(metadataOnlyPrompt.image_quality_degraded, null);
assert.equal(metadataOnlyPrompt.images.length, 0, "unmeasured images must not become false visual facts in the prompt");

const metadataOnlyMeasured = buildServerCaptureQualityFromCanonicalImages([{
  image_id: "front",
  width: 900,
  height: 1260,
  storage_verified: true
}]);
assert.equal(metadataOnlyMeasured.images[0].resolution_sufficient, true);
assert.equal(metadataOnlyMeasured.images[0].crop_complete, true);
assert.equal(metadataOnlyMeasured.image_quality_degraded, false);
assert.equal(metadataOnlyMeasured.glare_route, null, "dimensions still cannot prove glare state");

console.log("image quality gate tests passed");
