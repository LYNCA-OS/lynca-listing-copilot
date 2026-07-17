#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { createLaunchGateSourceImagesHandler } from "../api/v4/launch-gate-source-images.js";
import {
  launchGateImageSourceCount,
  resolveLaunchGateImageSources
} from "../lib/listing/evaluation/launch-gate-image-access.mjs";
import { materializeLaunchGateImages } from "./materialize-launch-gate-images.mjs";

const require = createRequire(import.meta.url);
const reviewedDataset = require("../data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json");
const ebayDataset = require("../data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json");
const reviewedItem = reviewedDataset.items[0];
const ebayItem = ebayDataset.items[0];
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

function assertNoReferenceTextKeys(value) {
  if (Array.isArray(value)) return value.forEach(assertNoReferenceTextKeys);
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.doesNotMatch(key, /title|label/i);
    assertNoReferenceTextKeys(entry);
  }
}

function mockReq(body = {}) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = "POST";
  request.headers = {};
  return request;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(value = "") { this.body = String(value); }
  };
}

assert.ok(launchGateImageSourceCount() >= 300);
assert.equal(
  Object.hasOwn(vercelConfig.functions["api/v4/launch-gate-source-images.js"], "includeFiles"),
  false
);
const allowlisted = resolveLaunchGateImageSources([
  reviewedItem.source_feedback_id,
  ebayItem.source_feedback_id
]);
assert.equal(allowlisted.length, 2);
assert.equal(allowlisted[0].evaluation_cohort, "INTERNAL_REVIEWED_GT");
assert.equal(allowlisted[1].evaluation_cohort, "EBAY_COLD_START");
assertNoReferenceTextKeys(allowlisted);
assert.throws(
  () => resolveLaunchGateImageSources(["not-in-the-reviewed-source-index"]),
  /launch_gate_source_not_allowlisted/
);

const signedCalls = [];
const handler = createLaunchGateSourceImagesHandler({
  requireAccess: async (_req, options) => {
    assert.equal(options.permission, "CONFIGURE_TENANT");
    return { tenantId: "tenant_legacy", userId: "owner", role: "OWNER", requestId: "test-request" };
  },
  signImage: async (input) => {
    signedCalls.push(input);
    return `https://signed.test/${signedCalls.length}`;
  }
});
const response = mockRes();
await handler(mockReq({
  source_feedback_ids: [reviewedItem.source_feedback_id, ebayItem.source_feedback_id]
}), response);
assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body);
assert.equal(payload.ok, true);
assert.equal(payload.source_count, 2);
assert.equal(payload.image_count, signedCalls.length);
assert.ok(payload.image_count >= 2);
assertNoReferenceTextKeys(payload);

const rejectedResponse = mockRes();
await handler(mockReq({ source_feedback_ids: ["not-in-the-reviewed-source-index"] }), rejectedResponse);
assert.equal(rejectedResponse.statusCode, 403);
assert.equal(JSON.parse(rejectedResponse.body).error, "launch_gate_source_not_allowlisted");

const png = Buffer.alloc(24);
Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
png.writeUInt32BE(640, 16);
png.writeUInt32BE(900, 20);
const tempRoot = await mkdtemp(join(tmpdir(), "launch-gate-materialize-test-"));
try {
  const dataset = {
    items: [{
      asset_id: "blind-item",
      source_feedback_id: "reviewed-source-1",
      images: [{
        image_id: "image-1",
        bucket: "listing-feedback-images",
        object_path: "feedback/2026-07/test/front.png"
      }]
    }]
  };
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/v4/launch-gate-source-images")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.cookie, "session=test");
      return new Response(JSON.stringify({
        ok: true,
        sources: [{
          source_feedback_id: "reviewed-source-1",
          images: [{
            image_id: "image-1",
            bucket: "listing-feedback-images",
            object_path: "feedback/2026-07/test/front.png",
            signed_url: "https://signed.test/front.png"
          }]
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url) === "https://signed.test/front.png") {
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected test URL: ${url}`);
  };
  const materialized = await materializeLaunchGateImages({
    dataset,
    outputDirectory: join(tempRoot, "images"),
    baseUrl: "https://listing.test",
    cookie: "session=test",
    fetchImpl
  });
  const image = materialized.dataset.items[0].images[0];
  assert.equal(image.width, 640);
  assert.equal(image.height, 900);
  assert.equal(image.content_type, "image/png");
  assert.equal(materialized.summary.downloaded_count, 1);
  assert.equal((await readFile(image.local_path)).equals(png), true);
  assert.doesNotMatch(JSON.stringify(materialized.dataset), /signed\.test|signed_url/);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("launch gate image materialization tests passed");
