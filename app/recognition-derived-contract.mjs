export const RECOGNITION_DERIVED_LANE_VERSION = "csm-derived-checkpoint-v1";
export const RECOGNITION_DOWNSCALE_TRANSFORM_VERSION = "readability-downscale-v1";
export const RECOGNITION_DOWNSCALE_LONG_EDGE = 1_600;
export const RECOGNITION_DOWNSCALE_QUALITY = 0.8;
export const RECOGNITION_INLINE_MAX_BYTES = 3_200_000;

export function recognitionDerivedInputUseful({
  sourceBytes = 0,
  sourceWidth = 0,
  sourceHeight = 0,
  derivedBytes = 0
} = {}) {
  const sourceSize = Math.max(0, Number(sourceBytes) || 0);
  const derivedSize = Math.max(0, Number(derivedBytes) || 0);
  const sourceLongEdge = Math.max(
    Math.max(0, Number(sourceWidth) || 0),
    Math.max(0, Number(sourceHeight) || 0)
  );
  return sourceLongEdge > RECOGNITION_DOWNSCALE_LONG_EDGE
    && derivedSize > 0
    && derivedSize < sourceSize;
}
export function recognitionDerivedLaneEligible({
  originalCount = 0,
  inputs = [],
  maxBodyBytes = RECOGNITION_INLINE_MAX_BYTES
} = {}) {
  const count = Number(originalCount);
  if (!Number.isInteger(count) || count < 1 || count > 2) return false;
  if (!Array.isArray(inputs) || inputs.length !== count) return false;
  const sizes = inputs.map((input) => Math.max(0, Number(input?.size || input?.sourceBlob?.size) || 0));
  return sizes.every((size) => size > 0)
    && sizes.reduce((total, size) => total + size, 0) <= Math.max(1, Number(maxBodyBytes) || 0);
}

export function validOriginalFingerprintList(values, expectedCount) {
  return Number.isInteger(Number(expectedCount))
    && Number(expectedCount) >= 1
    && Number(expectedCount) <= 2
    && Array.isArray(values)
    && values.length === Number(expectedCount)
    && values.every((value) => /^sha256:[0-9a-f]{64}$/.test(String(value || "")));
}
