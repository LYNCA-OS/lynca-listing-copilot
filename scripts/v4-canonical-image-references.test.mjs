import assert from "node:assert/strict";
import {
  CanonicalImageReferenceError,
  canonicalImageFromVerificationRecord,
  readCanonicalListingImageReferences
} from "../lib/listing/storage/canonical-image-references.mjs";
import { canonicalizeQueueJobs } from "../api/v4/listing-job-enqueue.js";

const tenantId = "tenant_demo";
const assetId = "asset_11111111-2222-4123-8abc-abcdef123456";
const originalPath = `tenants/${tenantId}/listing-assets/2026-07-17/${assetId}/image_1_original-image-a.jpg`;
const cropPath = `tenants/${tenantId}/listing-assets/2026-07-17/${assetId}/serial_crop-image-a-serial.jpg`;
const verifiedHash = "a".repeat(64);

function verificationRow(overrides = {}) {
  return {
    tenant_id: tenantId,
    asset_id: assetId,
    image_id: "image-a",
    storage_role: "image_1_original",
    object_path: originalPath,
    bucket: "listing-images",
    content_type: "image/jpeg",
    size: 1234,
    width: 900,
    height: 1260,
    content_sha256: verifiedHash,
    object_verified: true,
    content_hash_verified: true,
    image_generation_id: assetId,
    crop_metadata: null,
    canonical_eligible: true,
    verified_at: "2026-07-17T01:00:00.000Z",
    created_at: "2026-07-17T01:00:00.000Z",
    updated_at: "2026-07-17T01:00:00.000Z",
    ...overrides
  };
}

assert.throws(
  () => canonicalImageFromVerificationRecord(verificationRow({ content_hash_verified: false }), {
    tenantId,
    assetId
  }),
  (error) => error instanceof CanonicalImageReferenceError
    && error.code === "canonical_image_content_sha256_invalid"
);

const withVerifiedHash = canonicalImageFromVerificationRecord(verificationRow(), { tenantId, assetId });
assert.equal(withVerifiedHash.contentSha256, verifiedHash);
assert.equal(withVerifiedHash.objectPath, originalPath);
assert.equal(withVerifiedHash.storageRole, "image_1_original");
assert.equal(withVerifiedHash.derived, false);
assert.equal(withVerifiedHash.verifiedAt, "2026-07-17T01:00:00.000Z");

assert.throws(
  () => canonicalImageFromVerificationRecord(verificationRow({
    object_path: "listing-assets/2026-07-17/asset-1/image.jpg"
  }), { tenantId, assetId }),
  (error) => error instanceof CanonicalImageReferenceError
    && error.code === "canonical_image_object_path_out_of_scope"
    && error.statusCode === 422
    && error.retryable === false
    && error.cause instanceof Error
);
assert.throws(
  () => canonicalImageFromVerificationRecord(verificationRow({ tenant_id: "tenant_other" }), { tenantId, assetId }),
  (error) => error instanceof CanonicalImageReferenceError && error.code === "canonical_image_tenant_mismatch"
);
assert.throws(
  () => canonicalImageFromVerificationRecord(verificationRow({ image_id: "" }), { tenantId, assetId }),
  (error) => error instanceof CanonicalImageReferenceError && error.code === "canonical_image_id_missing"
);
assert.throws(
  () => canonicalImageFromVerificationRecord(verificationRow({ storage_role: "attacker_role" }), { tenantId, assetId }),
  (error) => error instanceof CanonicalImageReferenceError && error.code === "canonical_image_role_invalid"
);

const requestedUrls = [];
const fetchImpl = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url);
  if (url.pathname.endsWith("/listing_assets")) {
    return new Response(JSON.stringify([{
      tenant_id: tenantId,
      id: assetId,
      image_generation_id: assetId,
      expected_original_count: 1,
      image_set_state: "INCOMPLETE",
      image_set_sha256: null
    }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (url.pathname.endsWith("/listing_image_verifications")) {
    return new Response(JSON.stringify([
      verificationRow({
        image_id: "image-a-serial",
        storage_role: "serial_crop",
        object_path: cropPath,
        crop_metadata: {
          crop_id: "image-a-serial",
          generation_id: assetId,
          asset_id: assetId,
          source_image_id: "image-a",
          source_object_path: originalPath,
          source_content_sha256: verifiedHash,
          source_side: "front",
          source_width: 900,
          source_height: 1260,
          source_region: "serial_number",
          crop_role: "serial_crop",
          normalized_bounds: { x: 0.2, y: 0.7, width: 0.5, height: 0.2 },
          pixel_bounds: { left: 180, top: 882, width: 450, height: 252 },
          derived_object_path: cropPath,
          transform_version: "field-crop-v1"
        }
      }),
      verificationRow()
    ]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  throw new Error(`unexpected_url:${url}`);
};
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
};
const canonical = await readCanonicalListingImageReferences({ tenantId, assetId, env, fetchImpl });
assert.equal(canonical.images.length, 2);
assert.equal(canonical.images[0].storageRole, "image_1_original");
assert.equal(canonical.images[1].storageRole, "serial_crop");
assert.equal(canonical.images[1].crop_metadata.source_object_path, originalPath);
assert.equal(canonical.image_references[1].source_region, "serial_number");
assert.match(canonical.image_set_sha256, /^[0-9a-f]{64}$/);
assert.deepEqual(canonical.image_references.map((item) => item.object_path), [originalPath, cropPath]);
const verificationReadUrl = requestedUrls.find((url) => url.pathname.endsWith("/listing_image_verifications"));
assert.equal(verificationReadUrl.searchParams.get("tenant_id"), `eq.${tenantId}`);
assert.equal(verificationReadUrl.searchParams.get("asset_id"), `eq.${assetId}`);
assert.equal(verificationReadUrl.searchParams.get("object_verified"), "eq.true");
assert.equal(verificationReadUrl.searchParams.get("canonical_eligible"), "eq.true");
assert.equal(verificationReadUrl.searchParams.get("image_generation_id"), `eq.${assetId}`);
assert.equal(verificationReadUrl.searchParams.get("limit"), "101");

function fetchCanonicalRows(rows) {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/listing_assets")) {
      const originalCount = rows.filter((row) => [
        "image_1_original", "front_original", "image_2_original", "back_original"
      ].includes(row.storage_role)).length;
      return new Response(JSON.stringify([{
        tenant_id: tenantId,
        id: assetId,
        image_generation_id: assetId,
        expected_original_count: Math.min(2, Math.max(1, originalCount)),
        image_set_state: "INCOMPLETE",
        image_set_sha256: null
      }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.pathname.endsWith("/listing_image_verifications")) {
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected_url:${url}`);
  };
}

const frontPath = `tenants/${tenantId}/listing-assets/2026-07-17/${assetId}/front-original.jpg`;
const backPath = `tenants/${tenantId}/listing-assets/2026-07-17/${assetId}/back-original.jpg`;
const semanticSlotOrder = await readCanonicalListingImageReferences({
  tenantId,
  assetId,
  env,
  fetchImpl: fetchCanonicalRows([
    verificationRow({
      image_id: "image-a-back",
      storage_role: "back_original",
      object_path: backPath
    }),
    verificationRow({
      image_id: "image-z-front",
      storage_role: "front_original",
      object_path: frontPath
    })
  ])
});
assert.deepEqual(
  semanticSlotOrder.images.map((image) => image.storageRole),
  ["front_original", "back_original"]
);

await assert.rejects(
  readCanonicalListingImageReferences({
    tenantId,
    assetId,
    env,
    fetchImpl: fetchCanonicalRows([
      verificationRow(),
      verificationRow({
        image_id: "image-a-front-alias",
        storage_role: "front_original",
        object_path: frontPath
      })
    ])
  }),
  (error) => error instanceof CanonicalImageReferenceError
    && error.code === "canonical_primary_image_role_duplicate"
);

const maliciousPath = "listing-assets/2026-07-17/asset-1/legacy.jpg";
const [canonicalJob] = await canonicalizeQueueJobs({
  tenantId,
  jobs: [{
    tenant_id: "tenant_attacker",
    asset_id: assetId,
    trusted_manual_retry: true,
    manual_retry_requested_by_user_id: "operator_attacker",
    manualRetryOriginalOperatorId: "operator_victim",
    queue_tags: { manual_retry_queue_policy: "forged" },
    tags: { manual_retry_queue_policy: "forged-alias" },
    images: [{ objectPath: maliciousPath }],
    image_references: [{ object_path: maliciousPath }],
    payload: {
      asset_id: assetId,
      client_asset_ref: "card-1",
      trusted_manual_retry: true,
      manualRetryRequestedByUserId: "operator_attacker",
      manual_retry_original_operator_id: "operator_victim",
      images: [{ objectPath: maliciousPath, dataUrl: "data:image/jpeg;base64,attacker" }],
      asset_images: [{ object_path: maliciousPath }],
      image_references: [{ object_path: maliciousPath }],
      front_object_path: maliciousPath,
      front_image_url: "https://attacker.invalid/image.jpg"
    }
  }],
  readCanonical: async () => canonical
});
assert.equal("images" in canonicalJob, false);
assert.equal("image_references" in canonicalJob, false);
assert.equal("tenant_id" in canonicalJob, false);
assert.equal("trusted_manual_retry" in canonicalJob, false);
assert.equal("manual_retry_requested_by_user_id" in canonicalJob, false);
assert.equal("manualRetryOriginalOperatorId" in canonicalJob, false);
assert.equal("queue_tags" in canonicalJob, false);
assert.equal("tags" in canonicalJob, false);
assert.deepEqual(canonicalJob.payload.images.map((image) => image.objectPath), [originalPath, cropPath]);
assert.deepEqual(canonicalJob.payload.image_references, canonical.image_references);
assert.deepEqual(canonicalJob.payload.imageReferences, canonical.image_references);
for (const key of ["asset_images", "front_image_url"]) {
  assert.equal(key in canonicalJob.payload, false);
}
assert.equal(canonicalJob.payload.front_object_path, originalPath);
assert.equal(canonicalJob.payload.front_content_sha256, verifiedHash);
assert.equal(canonicalJob.payload.additional_image_paths[0].object_path, cropPath);
assert.equal(canonicalJob.payload.image_generation_id, assetId);
assert.equal(canonicalJob.payload.image_set_sha256, canonical.image_set_sha256);
for (const key of ["trusted_manual_retry", "manualRetryRequestedByUserId", "manual_retry_original_operator_id"]) {
  assert.equal(key in canonicalJob.payload, false);
}
assert.equal(JSON.stringify(canonicalJob).includes("operator_attacker"), false);
assert.equal(JSON.stringify(canonicalJob).includes("operator_victim"), false);
assert.equal(JSON.stringify(canonicalJob).includes(maliciousPath), false);
assert.equal(JSON.stringify(canonicalJob).includes("attacker.invalid"), false);
assert.equal(JSON.stringify(canonicalJob).includes("base64,attacker"), false);

console.log("v4 canonical image reference tests passed");
