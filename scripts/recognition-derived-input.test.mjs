// COS-53: which stored asset Recognition reads.
//
// The selector is given inputs whose answers are arithmetic, including the one
// the decision exists to prevent: a "downscale" that is LARGER than the
// original it came from (a 237KB webp re-encoded to 1600px JPEG produced
// 478KB). Resolution is not the rule; bytes are.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { selectRecognitionImages } from "../lib/listing/storage/canonical-image-references.mjs";
import { canonicalListingCropMetadataForVerification } from "../lib/listing/storage/storage-verification-store.mjs";
import {
  RECOGNITION_DERIVED_LANE_VERSION,
  RECOGNITION_DOWNSCALE_TRANSFORM_VERSION
} from "../app/recognition-derived-contract.mjs";
import {
  buildInlineRecognitionInput,
  normalizeImages,
  recognitionManualRetry,
  validateRecognitionInputAssetId
} from "../api/csm-listing-title-ingest.js";

const original = (slot, size) => ({
  image_id: `img_${slot}`,
  storageRole: slot === 0 ? "image_1_original" : "image_2_original",
  storage_role: slot === 0 ? "image_1_original" : "image_2_original",
  size,
  derived: false
});
const downscale = (sourceId, size, id = `${sourceId}_small`) => ({
  image_id: id,
  storageRole: "readability_derived",
  storage_role: "readability_derived",
  source_image_id: sourceId,
  size,
  derived: true
});

// Smaller derived image wins, and the run states what it read.
{
  const { images, read } = selectRecognitionImages([
    original(0, 7_444_587), downscale("img_0", 745_000)
  ]);
  assert.equal(images.length, 1);
  assert.equal(images[0].image_id, "img_0_small");
  assert.deepEqual(read, [{
    image_role: "front_original",
    read: "readability_derived",
    bytes: 745_000,
    original_bytes: 7_444_587,
    derived_available: true,
    derived_bytes: 745_000
  }]);
}

// The measured counter-case: derived exists and is BIGGER. Original is read,
// and "available but not used" is recorded distinctly from "absent".
{
  const { images, read } = selectRecognitionImages([
    original(0, 237_000), downscale("img_0", 478_000)
  ]);
  assert.equal(images[0].image_id, "img_0");
  assert.equal(read[0].read, "original");
  assert.equal(read[0].derived_available, true);
  assert.equal(read[0].derived_bytes, 478_000);
}

// Equal bytes is not smaller.
{
  const { images } = selectRecognitionImages([original(0, 500_000), downscale("img_0", 500_000)]);
  assert.equal(images[0].image_id, "img_0");
}

// A downscale of the OTHER original may not stand in for this one.
{
  const { images } = selectRecognitionImages([
    original(0, 9_000_000), original(1, 9_000_000), downscale("img_1", 800_000)
  ]);
  assert.deepEqual(images.map((image) => image.image_id), ["img_0", "img_1_small"]);
}

// A derived image with no source lineage is never selected: it cannot be shown
// to be a downscale OF anything.
{
  const orphan = downscale("", 100, "orphan");
  const { images, read } = selectRecognitionImages([original(0, 9_000_000), orphan]);
  assert.equal(images[0].image_id, "img_0");
  assert.equal(read[0].derived_available, false);
}

// A crop is not a recognition input, however small.
{
  const crop = {
    image_id: "crop_1", storageRole: "serial_crop", storage_role: "serial_crop",
    source_image_id: "img_0", size: 4_000, derived: true
  };
  const { images } = selectRecognitionImages([original(0, 9_000_000), crop]);
  assert.equal(images[0].image_id, "img_0");
}

// No originals in, no images out — the endpoint's own
// `canonical_original_image_missing` stays the guard, not this selector.
assert.deepEqual(selectRecognitionImages([]).images, []);
assert.deepEqual(selectRecognitionImages([downscale("img_0", 10)]).images, []);

// Originals stay the system of record: the selector never returns more images
// than there are originals, whatever derived assets exist.
{
  const { images } = selectRecognitionImages([
    original(0, 9_000_000),
    downscale("img_0", 800_000, "a"),
    downscale("img_0", 700_000, "b")
  ]);
  assert.equal(images.length, 1);
}

// ─── Admission: a downscale earns canonical eligibility the way a crop does ──
//
// Before COS-53 this returned `canonical_role: false` for every role outside
// `cropRolesByRegion`, so a stored downscale could never be read however well
// formed it was. The lineage it gets now is completed from the VERIFIED source
// row, not from what the client claimed.
const tenantId = "tenant_test";
const assetId = "asset_cos53";
const day = "2026-08-08";
const sourcePath = `tenants/${tenantId}/listing-assets/${day}/${assetId}/front.jpg`;
const derivedPath = `tenants/${tenantId}/listing-assets/${day}/${assetId}/front-1600.jpg`;
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "k" };
const sourceRow = {
  tenant_id: tenantId,
  asset_id: assetId,
  image_id: "img_front",
  storage_role: "image_1_original",
  image_generation_id: assetId,
  object_path: sourcePath,
  content_sha256: "a".repeat(64),
  content_hash_verified: true,
  object_verified: true,
  canonical_eligible: true,
  width: 3024,
  height: 4032,
  size: 7_444_587
};
const fetchImpl = async () => ({
  ok: true,
  status: 200,
  json: async () => [sourceRow],
  text: async () => JSON.stringify([sourceRow])
});
const downscaleLineage = (over = {}) => canonicalListingCropMetadataForVerification({
  cropMetadata: {
    source_image_id: "img_front",
    derived_role: "readability_derived",
    long_edge: 1600,
    transform_version: "readability-downscale-v1",
    ...over
  },
  tenantId,
  assetId,
  imageId: "img_front_small",
  role: "readability_derived",
  objectPath: derivedPath,
  env,
  fetchImpl
});

{
  const lineage = await downscaleLineage();
  assert.equal(lineage.canonical_role, true, "a downscale is canonical, not a stray object");
  assert.equal(lineage.image_generation_id, assetId);
  // Everything about the source comes from the verified row. A client claiming
  // a different sha, size or path cannot put it here.
  assert.deepEqual(lineage.crop_metadata, {
    derived_id: "img_front_small",
    generation_id: assetId,
    asset_id: assetId,
    source_image_id: "img_front",
    source_object_path: sourcePath,
    source_content_sha256: "a".repeat(64),
    source_side: "front",
    source_width: 3024,
    source_height: 4032,
    source_size: 7_444_587,
    derived_role: "readability_derived",
    derived_object_path: derivedPath,
    long_edge: 1600,
    transform_version: "readability-downscale-v1"
  });
  // No crop vocabulary leaks in: a downscale has no region and no bounds.
  assert.ok(!("source_region" in lineage.crop_metadata));
  assert.ok(!("normalized_bounds" in lineage.crop_metadata));
}

// A downscale must declare what it is and how far it was bounded.
await assert.rejects(() => downscaleLineage({ long_edge: 0 }), /long_edge/);
await assert.rejects(() => downscaleLineage({ long_edge: 99_999 }), /long_edge/);
await assert.rejects(() => downscaleLineage({ derived_role: "" }), /derived_role/);
await assert.rejects(() => downscaleLineage({ derived_role: "serial_crop" }), /derived_role/);

// A derived image may not name itself as its own source.
await assert.rejects(
  () => downscaleLineage({ source_image_id: "img_front_small" }),
  /different original image/
);

// Roles that are neither a crop nor a downscale stay non-canonical, unchanged.
{
  const lineage = await canonicalListingCropMetadataForVerification({
    cropMetadata: null, tenantId, assetId, imageId: "img_alt",
    role: "front_alternate",
    objectPath: `tenants/${tenantId}/listing-assets/${day}/${assetId}/alt.jpg`,
    env, fetchImpl
  });
  assert.equal(lineage.canonical_role, false);
  assert.equal(lineage.crop_metadata, null);
}

// An original still refuses to carry derived provenance.
await assert.rejects(() => canonicalListingCropMetadataForVerification({
  cropMetadata: { source_image_id: "img_front" },
  tenantId, assetId, imageId: "img_front", role: "image_1_original",
  objectPath: sourcePath, env, fetchImpl
}), /cannot carry crop provenance/);

// The new producer is an ephemeral checkpoint lane, not the rolled-back stored
// derived asset. The server hashes the actual inline bytes, reconstructs the
// ledger from bounded metadata, and binds operation identity to original hashes.
{
  const bytes = Buffer.from("bounded-derived-image");
  const contentSha256 = (await import("node:crypto"))
    .createHash("sha256").update(bytes).digest("hex");
  const metadata = {
    assetId: "asset-deterministic",
    expectedOriginalCount: 1,
    originalFingerprints: [`sha256:${"a".repeat(64)}`],
    laneVersion: RECOGNITION_DERIVED_LANE_VERSION,
    images: [{
      size: bytes.length,
      contentSha256,
      imageId: "derived-front",
      fileName: "front-1600.jpg",
      contentType: "image/jpeg",
      width: 1_200,
      height: 1_600,
      sourceImageId: "source-front",
      transformVersion: RECOGNITION_DOWNSCALE_TRANSFORM_VERSION
    }]
  };
  const images = normalizeImages(metadata, bytes, { recognitionInputOnly: true });
  const inline = buildInlineRecognitionInput(metadata, images);
  assert.equal(
    validateRecognitionInputAssetId(metadata, "asset-deterministic"),
    "asset-deterministic"
  );
  assert.equal(recognitionManualRetry({ manualRetry: true }), true);
  assert.equal(recognitionManualRetry({ manual_retry: true }), true);
  assert.equal(recognitionManualRetry({ manualRetry: "true" }), false,
    "only the explicit boolean from the writer retry action authorizes another paid attempt");
  assert.equal(recognitionManualRetry({}), false);
  assert.throws(
    () => validateRecognitionInputAssetId(metadata, "asset-other"),
    /ingest_recognition_asset_id_mismatch/
  );
  assert.equal(inline.expectedOriginalCount, 1);
  assert.deepEqual(inline.originalFingerprints, metadata.originalFingerprints);
  assert.deepEqual(inline.recognitionInput, [{
    image_role: "front_original",
    read: "readability_derived_inline",
    bytes: bytes.length,
    original_bytes: null,
    derived_available: true,
    derived_bytes: bytes.length,
    source_image_id: "source-front",
    transform_version: RECOGNITION_DOWNSCALE_TRANSFORM_VERSION,
    lane_version: RECOGNITION_DERIVED_LANE_VERSION,
    content_sha256: contentSha256,
    original_content_sha256: "a".repeat(64)
  }]);
  assert.throws(
    () => normalizeImages({
      ...metadata,
      images: [{ ...metadata.images[0], contentSha256: "f".repeat(64) }]
    }, bytes, { recognitionInputOnly: true }),
    /ingest_image_hash_mismatch/
  );
  assert.throws(
    () => buildInlineRecognitionInput({
      ...metadata,
      originalFingerprints: [`sha256:${"b".repeat(63)}`]
    }, images),
    /ingest_original_fingerprints_invalid/
  );
  const ingest = await readFile(new URL("../api/csm-listing-title-ingest.js", import.meta.url), "utf8");
  const checkpointBranch = ingest.slice(
    ingest.indexOf("if (recognitionInputOnly)"),
    ingest.indexOf("const bucket = listingImageStorageReadiness")
  );
  assert.match(checkpointBranch, /checkpointOnly:\s*true/);
  assert.match(checkpointBranch, /manualRetry:\s*recognitionManualRetry\(metadata\)/);
  assert.doesNotMatch(checkpointBranch, /persistImage|createListingImageSignedUpload/,
    "inline derived bytes must never enter Storage");
  assert.doesNotMatch(checkpointBranch, /createTenantListingAsset/,
    "recognition-only must use the pre-created deterministic asset without a second upsert");
  assert.ok(
    ingest.indexOf("if (recognitionInputOnly) validateRecognitionInputAssetId")
      < ingest.indexOf("const result = await runDirectCsmAsset", ingest.indexOf("if (recognitionInputOnly)")),
    "the deterministic asset mismatch must be rejected before the provider-capable run"
  );
}

console.log("COS-53 recognition derived input tests passed");
