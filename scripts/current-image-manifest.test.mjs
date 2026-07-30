import assert from "node:assert/strict";

import {
  buildVerifiedCurrentImageManifest,
  currentImageManifestMatches,
  matchStampedSourceToCurrentImageManifest,
  sourceIdentityForVerifiedImage
} from "../lib/listing/evidence/current-image-manifest.mjs";

const tenantId = "tenant_manifest_test";
const assetId = "asset-manifest-test";
const primary = {
  image_id: "front",
  object_path: `tenants/${tenantId}/listing-assets/2026-07-30/${assetId}/front.jpg`,
  content_sha256: "a".repeat(64),
  tenant_id: tenantId,
  asset_id: assetId,
  image_generation_id: assetId,
  width: 1000,
  height: 1400,
  storage_verified: true
};
const crop = {
  image_id: "card-code-crop",
  object_path: `tenants/${tenantId}/listing-assets/2026-07-30/${assetId}/card-code-crop.jpg`,
  content_sha256: "b".repeat(64),
  tenant_id: tenantId,
  asset_id: assetId,
  image_generation_id: assetId,
  storage_verified: true,
  derived: true,
  crop_metadata: {
    crop_id: "card-code-crop",
    asset_id: assetId,
    generation_id: assetId,
    source_image_id: "front",
    source_object_path: primary.object_path,
    source_content_sha256: primary.content_sha256,
    derived_object_path: `tenants/${tenantId}/listing-assets/2026-07-30/${assetId}/card-code-crop.jpg`,
    crop_role: "card_code_crop",
    source_region: "checklist_code",
    source_side: "front",
    source_width: 1000,
    source_height: 1400,
    transform_version: "field-crop-v1",
    normalized_bounds: { x: 0.1, y: 0.7, width: 0.4, height: 0.2 },
    pixel_bounds: { left: 100, top: 979, width: 400, height: 280 }
  }
};
const context = {
  tenant_id: tenantId,
  asset_id: assetId,
  image_generation_id: assetId,
  images: [primary, crop]
};

const manifest = buildVerifiedCurrentImageManifest(context);
assert.equal(manifest.status, "COMPLETE");
assert.match(manifest.image_set_fingerprint, /^sha256:[0-9a-f]{64}$/);
assert.equal(currentImageManifestMatches(manifest, context).valid, true);

const primaryIdentity = sourceIdentityForVerifiedImage(context.images, primary);
assert.equal(primaryIdentity.tenant_id, tenantId);
assert.equal(matchStampedSourceToCurrentImageManifest(primaryIdentity, context)?.image.image_id, "front");

const cropIdentity = sourceIdentityForVerifiedImage(context.images, crop);
assert.equal(cropIdentity.source_crop_id, "card-code-crop");
assert.equal(cropIdentity.derived_content_sha256, "b".repeat(64));
assert.equal(matchStampedSourceToCurrentImageManifest(cropIdentity, context)?.image.image_id, "card-code-crop");

assert.equal(buildVerifiedCurrentImageManifest({
  tenant_id: tenantId,
  asset_id: assetId,
  image_generation_id: assetId,
  images: [{}]
}).status, "UNKNOWN");
assert.equal(buildVerifiedCurrentImageManifest({
  ...context,
  images: [{ ...primary, tenant_id: undefined }]
}).status, "UNKNOWN");
assert.equal(matchStampedSourceToCurrentImageManifest({
  ...primaryIdentity,
  image_generation_id: "asset-old-generation"
}, context), null);
assert.equal(matchStampedSourceToCurrentImageManifest({
  source_image_id: "front"
}, context), null);
assert.equal(matchStampedSourceToCurrentImageManifest({
  ...cropIdentity,
  crop_lineage: { ...cropIdentity.crop_lineage, source_content_sha256: "c".repeat(64) }
}, context), null);

for (const missingField of [
  "crop_role",
  "source_region",
  "source_side",
  "source_width",
  "source_height",
  "transform_version",
  "normalized_bounds",
  "pixel_bounds"
]) {
  const invalidCrop = structuredClone(crop);
  delete invalidCrop.crop_metadata[missingField];
  assert.equal(
    buildVerifiedCurrentImageManifest({ ...context, images: [primary, invalidCrop] }).status,
    "UNKNOWN",
    `derived crop without ${missingField} must fail closed`
  );
}
const wrongRole = structuredClone(crop);
wrongRole.crop_metadata.crop_role = "serial_crop";
assert.equal(buildVerifiedCurrentImageManifest({ ...context, images: [primary, wrongRole] }).status, "UNKNOWN");
const wrongTransform = structuredClone(crop);
wrongTransform.crop_metadata.transform_version = "attacker-transform-v1";
assert.equal(buildVerifiedCurrentImageManifest({ ...context, images: [primary, wrongTransform] }).status, "UNKNOWN");
const outOfBounds = structuredClone(crop);
outOfBounds.crop_metadata.normalized_bounds = { x: 0.9, y: 0.9, width: 0.2, height: 0.2 };
assert.equal(buildVerifiedCurrentImageManifest({ ...context, images: [primary, outOfBounds] }).status, "UNKNOWN");

console.log("current image manifest tests passed");
