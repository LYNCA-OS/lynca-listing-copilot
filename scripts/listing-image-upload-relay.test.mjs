import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

import {
  createListingImageUploadRelayHandler,
  decodeRelayMetadata,
  LISTING_IMAGE_RELAY_MAX_BYTES,
  readBoundedBinaryBody
} from "../api/listing-image-upload-relay.js";

const bytes = Buffer.from("exact-original-image-bytes");
const metadata = {
  assetId: "asset_12345678-abcd-8abc-8abc-123456789abc",
  imageId: "image-1",
  role: "image_1_original",
  fileName: "正面.jpg",
  contentType: "image/jpeg",
  size: bytes.length,
  width: 1085,
  height: 1429,
  signatureHex: "ffd8ff",
  contentSha256: "a".repeat(64)
};
const encoded = Buffer.from(JSON.stringify(metadata)).toString("base64url");
assert.deepEqual(decodeRelayMetadata(encoded), metadata);
assert.throws(() => decodeRelayMetadata("not+base64"), /Invalid upload relay metadata/);
assert.equal(LISTING_IMAGE_RELAY_MAX_BYTES, 3_200_000);

{
  const oversized = Readable.from([
    Buffer.alloc(4, 1), Buffer.alloc(4, 2), Buffer.alloc(64 * 1024, 3)
  ]);
  oversized.headers = {};
  await assert.rejects(
    readBoundedBinaryBody(oversized, 6),
    (error) => error.code === "relay_body_too_large"
  );
  if (!oversized.readableEnded) await new Promise((resolve) => oversized.once("end", resolve));
  assert.equal(oversized.readableEnded, true,
    "an oversized stream is drained while all bytes after the boundary are discarded");
}

class ResponseStub {
  constructor() {
    this.headers = new Map();
    this.statusCode = 200;
    this.body = "";
  }
  setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value); }
  getHeader(name) { return this.headers.get(String(name).toLowerCase()); }
  end(body = "") { this.body = String(body); }
}

const req = Readable.from([bytes]);
req.method = "POST";
req.url = "/api/listing-image-upload-relay";
req.headers = {
  "content-length": String(bytes.length),
  "content-type": "image/jpeg",
  "x-lynca-upload-metadata": encoded
};
const res = new ResponseStub();
const objectPath = "tenants/tenant_a/listing-assets/2026-08-02/asset_12345678-abcd-8abc-8abc-123456789abc/image_1_original-image-1.jpg";
let uploadBody = null;
const handler = createListingImageUploadRelayHandler({
  requireAccess: async () => ({ tenantId: "tenant_a", requestId: "request-1", owner: "writer" }),
  requireAsset: async ({ tenantId, assetId }) => {
    assert.equal(tenantId, "tenant_a");
    assert.equal(assetId, metadata.assetId);
    return { id: assetId };
  },
  signUpload: async (input) => {
    assert.equal(input.fileName, "正面.jpg");
    assert.equal(input.size, bytes.length);
    return {
      tenant_id: "tenant_a",
      image_id: metadata.imageId,
      storage_role: metadata.role,
      object_path: objectPath,
      content_type: "image/jpeg",
      size: bytes.length,
      signed_upload_url: "https://storage.invalid/signed"
    };
  },
  uploadFetch: async (_url, init) => {
    uploadBody = init.body;
    return new Response(null, { status: 200 });
  },
  verifyPayload: async (payload, context) => {
    assert.equal(payload.objectPath, objectPath);
    assert.equal(context.tenantId, "tenant_a");
    return {
      statusCode: 200,
      body: {
        ok: true,
        verification: {
          tenant_id: "tenant_a",
          object_path: objectPath,
          bucket: "listing-card-images",
          content_sha256: metadata.contentSha256,
          verification_token: "verified"
        },
        verification_record: { saved: true, durable: true }
      }
    };
  },
  enforceRateLimit: () => true
});
await handler(req, res);
assert.equal(res.statusCode, 200);
assert.deepEqual(uploadBody, bytes, "relay must preserve original bytes exactly");
const payload = JSON.parse(res.body);
assert.equal(payload.ok, true);
assert.equal(payload.asset_id, metadata.assetId);
assert.equal(payload.upload.object_path, objectPath);
assert.equal(payload.upload.signed_upload_url, undefined, "signed URL must not leave the relay");
assert.equal(payload.relay_timing.browser_body_bytes, bytes.length);

const appSource = readFileSync(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
assert.match(appSource, /\/api\/listing-image-upload-relay/);
assert.match(appSource, /row\.source\.size <= STORAGE_UPLOAD_RELAY_MAX_BYTES/);
assert.match(appSource, /Any relay failure falls back to the existing signed direct path/);
assert.match(appSource, /\/api\/csm-listing-title-ingest/);
assert.match(appSource, /body: new Blob\(images\.map\(\(image\) => image\.source\)/);
assert.match(appSource, /上传与 Luna 并行/);

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
assert.deepEqual(vercel.functions["api/listing-image-upload-relay.js"].regions, ["sin1"]);
assert.deepEqual(vercel.functions["api/csm-listing-title-ingest.js"].regions, ["sin1"]);

const ingestSource = readFileSync(new URL("../api/csm-listing-title-ingest.js", import.meta.url), "utf8");
assert.match(ingestSource, /deferredSessionArgs = args/);
assert.match(ingestSource, /await storagePromise;[\s\S]+createCsmRecognitionSession/);
assert.match(ingestSource, /upload_recovered: true/);

console.log("listing image upload relay tests passed");
