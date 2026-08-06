import { createHash } from "node:crypto";

export const MODEL = "gpt-5.6-luna";
export const REASONING_EFFORT = "none";
export const IMAGE_DETAIL = "high";

export const FROZEN_REQUEST_CONTRACTS = Object.freeze({
  canonical_high: Object.freeze({
    normalized_request_sha256: "a1958fad777b504cf9bf216eeb13f21fed310ec00a5a4acfd0d9dddcdbdcf90a",
    normalized_request_bytes: 8926,
    contract_wire_sha256: "4fc914e7ada083fb2f1cf756941e06ac7ebe34ccdfa83f328335439c83828c7c",
    contract_wire_bytes: 8957
  }),
  canonical_residual_v1_high: Object.freeze({
    normalized_request_sha256: "6598ad4025185aff18a94ab3c1e36f13578c299c886ccae0ca13672ce97feda6",
    normalized_request_bytes: 10052,
    contract_wire_sha256: "2ba71b92c6678f04eed5f08c54b79406233495d6495bee22182fb45b712b1638",
    contract_wire_bytes: 10083
  })
});

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// This is byte-for-byte the request identity used by run-thin-path-eval.mjs.
// Signed URL values are credentials with an expiry, not part of the model
// contract; their positions are stable and remain covered by the wire hash.
export function normalizedRequestBody(request) {
  let imageIndex = 0;
  const normalized = JSON.parse(JSON.stringify(request, (key, value) => {
    if (key === "image_url" && typeof value === "string") {
      imageIndex += 1;
      return `signed-image-${imageIndex}`;
    }
    return value;
  }));
  return JSON.stringify(normalized);
}

export function canonicalRequestFingerprint(request) {
  return sha256(normalizedRequestBody(request));
}

export function requestForAsset(template, imageUrls) {
  const request = structuredClone(template);
  request.input = [{
    role: "user",
    content: [
      ...structuredClone(template.input[0].content),
      ...imageUrls.map((imageUrl) => ({
        type: "input_image",
        image_url: imageUrl,
        detail: IMAGE_DETAIL
      }))
    ]
  }];
  return request;
}

export function requestIdentity(request) {
  const wireBody = JSON.stringify(request);
  const normalizedBody = normalizedRequestBody(request);
  return {
    normalized_request_sha256: sha256(normalizedBody),
    normalized_request_bytes: Buffer.byteLength(normalizedBody),
    wire_sha256: sha256(wireBody),
    wire_bytes: Buffer.byteLength(wireBody)
  };
}
