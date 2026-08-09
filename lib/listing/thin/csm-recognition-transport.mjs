import { createHash } from "node:crypto";

const TRANSPORT_RECEIPT_KEYS = Object.freeze([
  "id",
  "lane_version",
  "image_delivery",
  "recognition_source",
  "original_durability",
  "recognition_long_edge",
  "recognition_max_body_bytes",
  "provider_original_overlap",
  "maximum_images"
]);

function exactPlainObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(`invalid_${name}`);
  }
  return value;
}

function validateReceipt(value) {
  if (!exactPlainObject(value, TRANSPORT_RECEIPT_KEYS)) {
    throw new TypeError("recognition_transport_receipt_shape_invalid");
  }
  const receipt = {
    id: requiredText(value.id, "recognition_transport_id"),
    lane_version: requiredText(value.lane_version, "recognition_transport_lane_version"),
    image_delivery: requiredText(value.image_delivery, "recognition_transport_image_delivery"),
    recognition_source: requiredText(
      value.recognition_source,
      "recognition_transport_recognition_source"
    ),
    original_durability: requiredText(
      value.original_durability,
      "recognition_transport_original_durability"
    ),
    recognition_long_edge: value.recognition_long_edge,
    recognition_max_body_bytes: value.recognition_max_body_bytes,
    provider_original_overlap: requiredText(
      value.provider_original_overlap,
      "recognition_transport_provider_original_overlap"
    ),
    maximum_images: value.maximum_images
  };
  if (!Number.isSafeInteger(receipt.maximum_images) || receipt.maximum_images !== 2) {
    throw new TypeError("recognition_transport_maximum_images_invalid");
  }
  for (const key of ["recognition_long_edge", "recognition_max_body_bytes"]) {
    if (receipt[key] !== null
        && (!Number.isSafeInteger(receipt[key]) || receipt[key] < 1)) {
      throw new TypeError(`recognition_transport_${key}_invalid`);
    }
  }
  return Object.freeze(receipt);
}

export function sha256CsmRecognitionTransportReceipt(value) {
  const receipt = validateReceipt(value);
  return createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}

export const CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE = validateReceipt({
  id: "canonical-signed-url-v1",
  lane_version: "canonical-signed-url-v1",
  image_delivery: "signed_https_url",
  recognition_source: "canonical_original_or_smaller_readability_derived",
  original_durability: "verified_before_provider",
  recognition_long_edge: null,
  recognition_max_body_bytes: null,
  provider_original_overlap: "none",
  maximum_images: 2
});

export const CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE = validateReceipt({
  id: "original-inline-v1",
  lane_version: "original-inline-v1",
  image_delivery: "data_url",
  recognition_source: "original_inline",
  original_durability: "verified_before_title",
  recognition_long_edge: null,
  recognition_max_body_bytes: 3_200_000,
  provider_original_overlap: "provider_after_original_bytes_received",
  maximum_images: 2
});

export const CSM_STAGED_TRANSPORT_PROFILE = validateReceipt({
  id: "staged-readability-derived-v2",
  lane_version: "readability-derived-inline-v2",
  image_delivery: "data_url",
  recognition_source: "readability_derived_inline",
  original_durability: "verified_before_title",
  recognition_long_edge: 1_600,
  recognition_max_body_bytes: 3_200_000,
  provider_original_overlap: "provider_with_original_upload",
  maximum_images: 2
});

export const CSM_RECOGNITION_TRANSPORT_PROFILES = Object.freeze([
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_STAGED_TRANSPORT_PROFILE
]);

const profilesById = new Map(CSM_RECOGNITION_TRANSPORT_PROFILES.map((profile) => [
  profile.id,
  profile
]));

/**
 * Resolve an exact executable transport receipt. An ID alone is insufficient:
 * callers must pass the same frozen policy whose hash is written into the paid
 * execution contract.
 */
export function resolveCsmRecognitionTransportReceipt(value) {
  const receipt = validateReceipt(value);
  const registered = profilesById.get(receipt.id);
  if (!registered) {
    throw new TypeError(`unsupported_recognition_transport:${receipt.id}`);
  }
  if (sha256CsmRecognitionTransportReceipt(receipt)
      !== sha256CsmRecognitionTransportReceipt(registered)) {
    throw new TypeError("recognition_transport_receipt_mismatch");
  }
  return registered;
}
