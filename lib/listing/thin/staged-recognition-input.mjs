import { createHash } from "node:crypto";

export const STAGED_RECOGNITION_ROLE = "readability_derived";
export const STAGED_RECOGNITION_LONG_EDGE = 1600;
export const STAGED_RECOGNITION_MAX_BODY_BYTES = 3_200_000;
export const STAGED_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;
export const STAGED_RECOGNITION_LANE_VERSION = "readability-derived-inline-v2";

const sha256Pattern = /^[0-9a-f]{64}$/;
const primaryRoles = ["image_1_original", "image_2_original"];

function fail(code, { statusCode = 400, retryable = false } = {}) {
  return Object.assign(new Error(code), { code, statusCode, retryable });
}

function text(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized) throw fail(code);
  return normalized;
}

function positiveInteger(value, code) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw fail(code);
  return normalized;
}

function normalizedSha256(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!sha256Pattern.test(normalized)) throw fail(code);
  return normalized;
}

function stagedRequested(metadata = {}) {
  return metadata.recognitionInputOnly === true || metadata.recognition_input_only === true;
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

/** Read the encoded dimensions before the paid boundary; client dimensions
 * are telemetry, not authority over an ephemeral body that never reaches the
 * Storage verifier. */
export function inspectStagedRecognitionJpeg(bytes) {
  if (!bytes || bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw fail("staged_recognition_jpeg_invalid");
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) throw fail("staged_recognition_jpeg_invalid");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw fail("staged_recognition_jpeg_invalid");
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw fail("staged_recognition_jpeg_invalid");
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) throw fail("staged_recognition_jpeg_invalid");
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }
    if (marker === 0xda) {
      sawScan = true;
      break;
    }
    offset += segmentLength;
  }
  if (
    !width || !height || !sawScan
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9
  ) {
    throw fail("staged_recognition_jpeg_invalid");
  }
  return { width, height };
}

/**
 * Validate the only safe staged-input shape.
 *
 * The inline images are expendable recognition bytes. Original descriptors are
 * the paid-operation identity and are checked again against the durable,
 * server-verified image set before a session or title may be persisted.
 */
export function buildStagedRecognitionContract({
  metadata = {},
  inlineImages = [],
  bodyBytes = 0,
  maxBodyBytes = STAGED_RECOGNITION_MAX_BODY_BYTES
} = {}) {
  if (!stagedRequested(metadata)) return null;
  const laneVersion = String(metadata.laneVersion || metadata.lane_version || "").trim();
  if (laneVersion !== STAGED_RECOGNITION_LANE_VERSION) {
    throw fail("staged_lane_version_invalid");
  }

  const originalsInput = Array.isArray(metadata.originalImages)
    ? metadata.originalImages
    : metadata.original_images;
  if (!Array.isArray(originalsInput) || originalsInput.length < 1 || originalsInput.length > 2) {
    throw fail("staged_original_manifest_invalid");
  }
  if (!Array.isArray(inlineImages) || inlineImages.length !== originalsInput.length) {
    throw fail("staged_recognition_image_count_mismatch");
  }
  const expectedOriginalCount = positiveInteger(
    metadata.expectedOriginalCount ?? metadata.expected_original_count,
    "staged_expected_original_count_invalid"
  );
  if (expectedOriginalCount !== originalsInput.length) {
    throw fail("staged_expected_original_count_mismatch");
  }

  const originals = originalsInput.map((input, index) => {
    if (input.storageFirst !== true && input.storage_first !== true) {
      throw fail("staged_original_not_storage_first");
    }
    const role = text(input.role || input.storageRole || input.storage_role, "staged_original_role_missing");
    if (role !== primaryRoles[index]) throw fail("staged_original_role_invalid");
    const size = positiveInteger(input.size, "staged_original_size_invalid");
    const contentType = String(input.contentType || input.content_type || "").trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
      throw fail("staged_original_content_type_invalid");
    }
    if (size > STAGED_ORIGINAL_MAX_BYTES) throw fail("staged_original_too_large", { statusCode: 413 });
    return {
      imageId: text(input.imageId || input.image_id, "staged_original_image_id_missing"),
      role,
      contentType,
      size,
      width: positiveInteger(input.width, "staged_original_width_invalid"),
      height: positiveInteger(input.height, "staged_original_height_invalid"),
      contentSha256: normalizedSha256(
        input.contentSha256 || input.content_sha256,
        "staged_original_hash_invalid"
      )
    };
  });
  if (new Set(originals.map((image) => image.imageId)).size !== originals.length) {
    throw fail("staged_original_image_id_duplicate");
  }

  const inlineBySource = new Map();
  for (const image of inlineImages) {
    if (String(image.role || "").trim() !== STAGED_RECOGNITION_ROLE) {
      throw fail("staged_recognition_role_invalid");
    }
    const sourceImageId = text(
      image.sourceImageId || image.source_image_id,
      "staged_recognition_source_missing"
    );
    if (inlineBySource.has(sourceImageId)) throw fail("staged_recognition_source_duplicate");
    inlineBySource.set(sourceImageId, image);
  }

  const recognition = originals.map((original) => {
    const inline = inlineBySource.get(original.imageId);
    if (!inline) throw fail("staged_recognition_source_mismatch");
    const size = positiveInteger(inline.size, "staged_recognition_size_invalid");
    const width = positiveInteger(inline.width, "staged_recognition_width_invalid");
    const height = positiveInteger(inline.height, "staged_recognition_height_invalid");
    if (size >= original.size) throw fail("staged_recognition_not_smaller");
    if (Math.max(width, height) > STAGED_RECOGNITION_LONG_EDGE) {
      throw fail("staged_recognition_long_edge_exceeded");
    }
    if (String(inline.contentType || inline.content_type || "").trim().toLowerCase() !== "image/jpeg") {
      throw fail("staged_recognition_content_type_invalid");
    }
    const bytes = inline.bytes;
    if (!bytes || bytes.length !== size) throw fail("staged_recognition_byte_size_mismatch");
    const encoded = inspectStagedRecognitionJpeg(bytes);
    if (encoded.width !== width || encoded.height !== height) {
      throw fail("staged_recognition_dimensions_mismatch");
    }
    const contentSha256 = normalizedSha256(
      inline.contentSha256 || inline.content_sha256,
      "staged_recognition_hash_invalid"
    );
    if (createHash("sha256").update(bytes).digest("hex") !== contentSha256) {
      throw fail("staged_recognition_hash_mismatch");
    }
    return {
      imageId: text(inline.imageId || inline.image_id, "staged_recognition_image_id_missing"),
      sourceImageId: original.imageId,
      role: STAGED_RECOGNITION_ROLE,
      size,
      width,
      height,
      contentSha256
    };
  });
  if (new Set(recognition.map((image) => image.imageId)).size !== recognition.length) {
    throw fail("staged_recognition_image_id_duplicate");
  }

  const declaredBodyBytes = positiveInteger(bodyBytes, "staged_recognition_body_empty");
  const inlineBytes = recognition.reduce((total, image) => total + image.size, 0);
  const originalBytes = originals.reduce((total, image) => total + image.size, 0);
  if (declaredBodyBytes !== inlineBytes) throw fail("staged_recognition_body_size_mismatch");
  if (inlineBytes > Math.max(1, Number(maxBodyBytes) || 0)) {
    throw fail("staged_recognition_body_too_large", { statusCode: 413 });
  }
  // If originals already fit the integrated ingest, staging only changes the
  // pixels seen by the model and adds a second network path without a latency
  // benefit. Refuse it at the authority boundary.
  if (originalBytes <= Math.max(1, Number(maxBodyBytes) || 0)) {
    throw fail("staged_originals_fast_ingest_eligible");
  }

  const originalManifestSha256 = createHash("sha256").update(JSON.stringify(
    originals.map((image) => [image.imageId, image.role, image.size, image.contentSha256])
  )).digest("hex");
  return {
    laneVersion,
    expectedOriginalCount,
    originals,
    recognition,
    originalFingerprints: originals.map((image) => `sha256:${image.contentSha256}`),
    originalManifestSha256,
    originalBytes,
    inlineBytes
  };
}

/**
 * An internal, non-persistable canonical view used only to derive the stable
 * paid-operation identity. Its references are replaced with verified Storage
 * references before the formal recognition session is created.
 */
export function buildStagedIdentityCanonical({ tenantId, assetId, contract } = {}) {
  if (!contract?.originals?.length) throw fail("staged_contract_missing");
  const images = contract.originals.map((image) => ({
    id: image.imageId,
    image_id: image.imageId,
    size: image.size,
    width: image.width,
    height: image.height,
    storageRole: image.role,
    storage_role: image.role,
    role: image.role,
    contentSha256: image.contentSha256,
    content_sha256: image.contentSha256,
    derived: false
  }));
  return {
    tenant_id: String(tenantId || "").trim(),
    asset_id: String(assetId || "").trim(),
    image_generation_id: String(assetId || "").trim(),
    expected_original_count: contract.expectedOriginalCount,
    image_set_sha256: contract.originalManifestSha256,
    image_paths: {},
    images,
    // Empty by construction. The deferred formal session is rebound to exact
    // Storage references after verification; an accidental early write must
    // fail its image-set invariant rather than persist a placeholder path.
    image_references: [],
    staged_unverified_identity: true
  };
}

export function buildStagedResumeReceipt({ tenantId, assetId, intentId, contract } = {}) {
  if (!contract?.originalFingerprints?.length) throw fail("staged_contract_missing");
  const digest = createHash("sha256").update([
    "staged-recognition-resume-v1",
    String(tenantId || "").trim(),
    String(assetId || "").trim(),
    String(intentId || "").trim(),
    contract.laneVersion,
    contract.originalManifestSha256,
    ...contract.originalFingerprints
  ].join("\u001f")).digest("hex");
  return `stgr_${digest}`;
}

export function assertStagedResumeReceipt({ receipt, ...identity } = {}) {
  const expected = buildStagedResumeReceipt(identity);
  if (String(receipt || "").trim() !== expected) {
    throw fail("staged_resume_receipt_invalid", { statusCode: 409 });
  }
  return expected;
}

export function buildStagedRecognitionSelection({ contract, inlineImages = [] } = {}) {
  if (!contract?.recognition?.length || inlineImages.length !== contract.recognition.length) {
    throw fail("staged_recognition_selection_invalid");
  }
  const byId = new Map(inlineImages.map((image) => [String(image.image_id || image.id || ""), image]));
  const images = contract.recognition.map((recognition) => {
    const image = byId.get(recognition.imageId);
    if (!image) throw fail("staged_recognition_selection_missing");
    return image;
  });
  return {
    images,
    read: contract.originals.map((original, index) => ({
      image_role: index === 0 ? "front_original" : "back_original",
      read: STAGED_RECOGNITION_ROLE,
      bytes: contract.recognition[index].size,
      original_bytes: original.size,
      derived_available: true,
      derived_bytes: contract.recognition[index].size,
      source_image_id: original.imageId,
      transform_version: "readability-downscale-v1",
      lane_version: contract.laneVersion,
      content_sha256: contract.recognition[index].contentSha256,
      original_content_sha256: original.contentSha256
    }))
  };
}

export function assertStagedVerifiedOriginals({ contract, canonical } = {}) {
  const actual = Array.isArray(canonical?.images)
    ? canonical.images.filter((image) => image?.derived !== true
      && primaryRoles.includes(String(image?.storageRole || image?.storage_role || "")))
    : [];
  const references = Array.isArray(canonical?.image_references)
    ? canonical.image_references.filter((reference) => reference?.derived !== true
      && ["front_original", "back_original"].includes(String(reference?.image_role || "")))
    : [];
  if (actual.length !== contract?.expectedOriginalCount) {
    throw fail("staged_verified_original_count_mismatch", { statusCode: 409 });
  }
  if (references.length !== contract.expectedOriginalCount) {
    throw fail("staged_verified_original_reference_count_mismatch", { statusCode: 409 });
  }
  for (let index = 0; index < contract.originals.length; index += 1) {
    const expected = contract.originals[index];
    const image = actual[index];
    const reference = references[index];
    const expectedReferenceRole = index === 0 ? "front_original" : "back_original";
    if (
      image?.derived === true
      || reference?.derived === true
      || String(image?.image_id || image?.id || "") !== expected.imageId
      || String(image?.storageRole || image?.storage_role || "") !== expected.role
      || String(image?.content_sha256 || image?.contentSha256 || "").toLowerCase() !== expected.contentSha256
      || Number(image?.size) !== expected.size
      || String(reference?.image_id || "") !== expected.imageId
      || String(reference?.image_role || "") !== expectedReferenceRole
      || String(reference?.content_sha256 || "").toLowerCase() !== expected.contentSha256
      || !String(reference?.bucket || "").trim()
      || !String(reference?.object_path || "").trim()
      || /(?:^|\/)staged-unverified(?:\/|$)/.test(String(reference?.object_path || ""))
      || String(reference?.bucket || "") === "staged-unverified"
    ) {
      throw fail("staged_verified_original_identity_mismatch", { statusCode: 409 });
    }
  }
  // Validation is original-only, but the formal session must retain the full
  // canonical verified set. Production's session trigger compares refs/hash
  // byte-for-byte with canonical_listing_asset_image_set, which intentionally
  // includes canonical-eligible derived crops that may finish concurrently.
  return canonical;
}

export async function waitForStagedVerifiedOriginals({
  tenantId,
  assetId,
  contract,
  readCanonical,
  // 145s admission + 120s provider leaves 35s in the 300s function budget.
  // Keep enough of that remainder for formal session and atomic persistence;
  // a slower upload retains the checkpoint and finishes through resume-only.
  deadlineMs = 20_000,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now = Date.now
} = {}) {
  if (typeof readCanonical !== "function") throw new TypeError("readCanonical is required");
  const startedAt = now();
  let poll = 0;
  let lastError = null;
  while (now() - startedAt < deadlineMs) {
    const remainingBeforeRead = deadlineMs - (now() - startedAt);
    if (remainingBeforeRead < 250) break;
    try {
      const canonical = await readCanonical({
        tenantId,
        assetId,
        timeoutMs: Math.min(2_000, remainingBeforeRead),
        attempts: 1
      });
      return assertStagedVerifiedOriginals({ contract, canonical });
    } catch (error) {
      if (error?.retryable !== true) throw error;
      lastError = error;
      const elapsed = now() - startedAt;
      const remaining = deadlineMs - elapsed;
      if (remaining <= 0) break;
      // Polling starts only after the provider checkpoint exists. A short ramp
      // catches an upload finishing at the same time; the one-second cap avoids
      // turning a slow phone upload into dozens of database RTTs.
      const delayMs = Math.min(remaining, [250, 500, 750, 1000][Math.min(poll, 3)]);
      poll += 1;
      await sleep(delayMs);
    }
  }
  throw fail(`staged_original_upload_timeout:${String(lastError?.code || "not_ready")}`, {
    statusCode: 504,
    retryable: true
  });
}

export function bindStagedSessionToVerifiedCanonical({
  deferredSessionArgs,
  verifiedCanonical,
  recognitionRead
} = {}) {
  if (!deferredSessionArgs || !verifiedCanonical?.image_references?.length) {
    throw fail("staged_deferred_session_binding_missing", { statusCode: 503, retryable: true });
  }
  return {
    ...deferredSessionArgs,
    payload: {
      ...(deferredSessionArgs.payload || {}),
      asset_id: verifiedCanonical.asset_id,
      client_asset_ref: verifiedCanonical.asset_id,
      images: verifiedCanonical.image_references,
      image_references: verifiedCanonical.image_references,
      image_generation_id: verifiedCanonical.image_generation_id,
      image_set_sha256: verifiedCanonical.image_set_sha256,
      expected_original_count: verifiedCanonical.expected_original_count,
      recognition_input: recognitionRead
    }
  };
}
