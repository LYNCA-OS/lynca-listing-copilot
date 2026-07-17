import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDurableSmokeItem } from "./v4-ebay-smoke.mjs";

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
  assert.equal(prepared.item.source_feedback_id, "ebay:image-only:source");
  assert.deepEqual(prepared.images.map((image) => image.storageRole), ["image_1_original", "image_2_original"]);
  assert.ok(prepared.images.every((image) => image.storageVerified === true));
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-asset-create").length, 1);
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-image-upload-url").length, 2);
  assert.equal(calls.filter((call) => call.pathname.startsWith("/upload/") && call.method === "PUT").length, 2);
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-image-verify-upload").length, 2);
  assert.equal(calls.filter((call) => call.pathname === "/api/listing-image-verify-existing").length, 0);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("v4 smoke durable upload tests passed");
