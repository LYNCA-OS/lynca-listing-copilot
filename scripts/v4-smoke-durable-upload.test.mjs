import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalBatchIdForPoll,
  prepareDurableSmokeItem
} from "./v4-ebay-smoke.mjs";
import { canonicalizeQueueJobs } from "../api/v4/listing-job-enqueue.js";

const tempDirectory = await mkdtemp(join(tmpdir(), "lynca-v4-smoke-upload-"));
const firstPath = join(tempDirectory, "image-1.jpg");
const secondPath = join(tempDirectory, "image-2.jpg");
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
await Promise.all([writeFile(firstPath, jpegBytes), writeFile(secondPath, jpegBytes)]);

const durableAssetId = "asset_11111111-2222-4333-8444-555555555555";
const calls = [];
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" }
});

const fetchImpl = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ pathname: url.pathname, method: init.method || "GET", body });
  if (url.pathname === "/api/listing-asset-create") {
    return jsonResponse({
      ok: true,
      asset_id: durableAssetId,
      tenant_id: "tenant_legacy",
      image_generation_id: durableAssetId,
      client_asset_ref: body.client_asset_ref,
      expected_original_count: body.expected_original_count
    }, 201);
  }
  if (url.pathname === "/api/listing-image-upload-url") {
    const fileName = `${body.role}-${body.imageId}.jpg`;
    return jsonResponse({
      ok: true,
      asset_id: durableAssetId,
      client_asset_ref: body.clientAssetRef,
      upload: {
        tenant_id: "tenant_legacy",
        image_id: body.imageId,
        storage_role: body.role,
        object_path: `tenants/tenant_legacy/listing-assets/2026-07-18/${durableAssetId}/${fileName}`,
        bucket: "listing-images",
        content_type: body.contentType,
        size: body.size,
        width: body.width,
        height: body.height,
        content_sha256: body.contentSha256,
        signed_upload_url: `https://storage.example/upload/${body.role}`
      }
    });
  }
  if (url.hostname === "storage.example" && init.method === "PUT") {
    return new Response("", { status: 200 });
  }
  if (url.pathname === "/api/listing-image-verify-upload") {
    return jsonResponse({
      ok: true,
      verification: {
        tenant_id: "tenant_legacy",
        object_path: body.objectPath,
        bucket: "listing-images",
        content_type: body.contentType,
        size: body.size,
        width: body.width,
        height: body.height,
        content_sha256: body.contentSha256,
        verification_token: `verified-${body.imageId}`,
        object_verified: true
      },
      verification_record: { saved: true, durable: true }
    });
  }
  throw new Error(`unexpected request: ${init.method || "GET"} ${url}`);
};

assert.equal(
  canonicalBatchIdForPoll([
    { batch_id: "v4batch_canonical", job: { job_id: "v4job_one" } },
    { batch_id: "v4batch_canonical", job: { job_id: "v4job_two" } }
  ], "client-token"),
  "v4batch_canonical",
  "status polling must use the server-issued canonical batch id"
);
assert.equal(
  canonicalBatchIdForPoll([
    { batch_id: "client-token", job: null },
    { batch_id: "v4batch_canonical", job: { job_id: "v4job_ok" } }
  ], "client-token"),
  "v4batch_canonical",
  "failed enqueue rows must not split a valid canonical polling identity"
);
assert.equal(
  canonicalBatchIdForPoll([
    { batch_id: "v4batch_a", job: { job_id: "v4job_a" } },
    { batch_id: "v4batch_b", job: { job_id: "v4job_b" } }
  ]),
  null,
  "split streaming batches must switch the smoke harness to job-id polling"
);

try {
  const prepared = await prepareDurableSmokeItem({
    item: {
      asset_id: "ebay_legacy_source",
      source_feedback_id: "ebay:image-only:source",
      category: "collectible_card",
      images: [
        { image_id: "source-one", local_path: firstPath, content_type: "image/jpeg", width: 520, height: 800 },
        { image_id: "source-two", local_path: secondPath, content_type: "image/jpeg", width: 520, height: 800 }
      ]
    },
    index: 0,
    baseUrl: "https://listing.example",
    cookie: "session=test",
    requestTimeoutMs: 5000,
    fetchImpl
  });

  assert.equal(prepared.source_asset_id, "ebay_legacy_source");
  assert.equal(prepared.asset.asset_id, durableAssetId);
  assert.equal(prepared.item.asset_id, durableAssetId);
  assert.equal(prepared.item.image_generation_id, durableAssetId);
  assert.equal(prepared.item.source_feedback_id, "ebay:image-only:source");
  assert.deepEqual(prepared.images.map((image) => image.storageRole), ["image_1_original", "image_2_original"]);
  assert.ok(prepared.images.every((image) => image.storageVerified === true));
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-asset-create").length, 1);
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-image-upload-url").length, 2);
  assert.equal(calls.filter((call) => call.pathname.startsWith("/upload/") && call.method === "PUT").length, 2);
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-image-verify-upload").length, 2);
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-image-verify-existing").length, 0);

  const canonicalImages = prepared.images.map((image) => ({ ...image }));
  const canonicalReferences = canonicalImages.map((image, index) => ({
    image_id: image.imageId,
    image_role: index === 0 ? "front_original" : "back_original",
    bucket: image.storageBucket,
    object_path: image.objectPath,
    content_sha256: image.contentSha256,
    derived: false,
    source_image_id: null,
    source_region: null,
    crop_metadata: null
  }));
  const [canonicalJob] = await canonicalizeQueueJobs({
    tenantId: "tenant_legacy",
    jobs: [{
      asset_id: prepared.item.asset_id,
      image_generation_id: prepared.item.image_generation_id,
      payload: {
        asset_id: prepared.item.asset_id,
        client_asset_ref: prepared.asset.client_asset_ref,
        preingestion_bundle_id: "browser-must-not-own-this",
        images: [{ object_path: "listing-assets/legacy-path.jpg" }]
      }
    }],
    readCanonical: async () => ({
      asset_id: durableAssetId,
      image_generation_id: durableAssetId,
      expected_original_count: 2,
      image_set_sha256: "b".repeat(64),
      images: canonicalImages,
      image_references: canonicalReferences,
      image_paths: {
        front_bucket: canonicalReferences[0].bucket,
        front_object_path: canonicalReferences[0].object_path,
        front_content_sha256: canonicalReferences[0].content_sha256,
        back_bucket: canonicalReferences[1].bucket,
        back_object_path: canonicalReferences[1].object_path,
        back_content_sha256: canonicalReferences[1].content_sha256,
        additional_image_paths: []
      }
    })
  });
  assert.equal(canonicalJob.asset_id, durableAssetId);
  assert.equal(canonicalJob.payload.image_generation_id, durableAssetId);
  assert.deepEqual(canonicalJob.payload.image_references, canonicalReferences);
  assert.equal("preingestion_bundle_id" in canonicalJob.payload, false);
  assert.equal(JSON.stringify(canonicalJob).includes("legacy-path.jpg"), false);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("v4 durable upload and enqueue transaction-boundary canary passed");
