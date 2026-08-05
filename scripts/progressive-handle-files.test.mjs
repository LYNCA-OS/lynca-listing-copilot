#!/usr/bin/env node

import assert from "node:assert/strict";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeDomElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    focus() {},
    closest() { return null; },
    querySelector() { return makeDomElement(); },
    querySelectorAll() { return []; },
    getClientRects() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    checked: false,
    hidden: false
  };
}

globalThis.document = {
  body: makeDomElement(),
  documentElement: makeDomElement(),
  activeElement: null,
  createElement: () => makeDomElement(),
  querySelector: () => makeDomElement(),
  querySelectorAll: () => [],
  addEventListener() {}
};
globalThis.window = { addEventListener() {} };

const secondInitialGroup = deferred();
const modelResponses = deferred();
const createdAssets = new Set();
const verifiedAssets = new Set();
const csmRequests = [];
const networkRequests = [];
let secondInitialGroupReleased = false;
let initialHandleSettled = false;

function assetIdForIndex(index) {
  return `asset_${String(index).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

globalThis.fetch = async (url, options = {}) => {
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  networkRequests.push({ url: String(url), body });
  if (url === "/api/listing-asset-create") {
    const index = Number(String(body.client_asset_ref || "").replace("asset-", ""));
    const assetId = assetIdForIndex(index);
    createdAssets.add(assetId);
    return jsonResponse({
      ok: true,
      asset_id: assetId,
      tenant_id: "tenant_progressive_test",
      image_generation_id: assetId,
      client_asset_ref: body.client_asset_ref,
      expected_original_count: body.expected_original_count
    });
  }
  if (url === "/api/listing-image-upload-url") {
    assert.ok(createdAssets.has(body.assetId), "asset creation must precede original upload signing");
    return jsonResponse({
      ok: true,
      uploads: body.images.map((image) => ({
        tenant_id: "tenant_progressive_test",
        image_id: image.imageId,
        storage_role: image.role,
        object_path: `tenants/tenant_progressive_test/listing-assets/2026-08-01/${body.assetId}/${image.fileName}`,
        content_type: image.contentType,
        signed_upload_url: `https://storage.test/${image.imageId}`
      }))
    });
  }
  if (String(url).startsWith("https://storage.test/")) {
    assert.equal(options.method, "PUT");
    return new Response(null, { status: 200 });
  }
  if (url === "/api/listing-image-verify-upload") {
    verifiedAssets.add(body.assetId);
    return jsonResponse({
      ok: true,
      verifications: body.images.map((image) => ({
        ok: true,
        image_id: image.imageId,
        verification: {
          tenant_id: "tenant_progressive_test",
          object_path: image.objectPath,
          bucket: "listing-images",
          verification_token: `verified-${image.imageId}`,
          content_sha256: image.contentSha256
        },
        verification_record: { saved: true, durable: true }
      }))
    });
  }
  if (url === "/api/csm-listing-title") {
    assert.ok(verifiedAssets.has(body.asset_id), "verified original persistence must precede recognition");
    csmRequests.push({
      assetId: body.asset_id,
      intentId: body.intent_id,
      initialHandleSettled,
      secondInitialGroupReleased
    });
    await modelResponses.promise;
    return jsonResponse({
      ok: true,
      title: `Title ${body.asset_id}`,
      fields: {},
      low_confidence_fields: [],
      unreadable_fields: [],
      trace_status: "PERSISTED",
      recognition_session_id: `session-${body.asset_id}`,
      csm_rows: [],
      route: "CSM_THIN_DIRECT",
      model: "gpt-5.6-luna"
    });
  }
  throw new Error(`unexpected network request: ${url}`);
};

const { __listingCopilotAppTestHooks } = await import("../app/listing-copilot.js");

function fakeFile(index) {
  const bytes = new TextEncoder().encode(`card-${index}`);
  return {
    name: `card-${index}.jpg`,
    type: "image/jpeg",
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.buffer.slice(0); },
    slice() { return this; }
  };
}

async function prepareImage(file) {
  const fileIndex = Number(file.name.match(/\d+/)?.[0]);
  const assetIndex = Math.ceil(fileIndex / 2);
  if (assetIndex === 2 && !secondInitialGroupReleased) await secondInitialGroup.promise;
  return {
    id: `image-${fileIndex}`,
    name: file.name,
    originalType: file.type,
    type: file.type,
    size: file.size,
    originalSize: file.size,
    originalWidth: 1200,
    originalHeight: 1680,
    width: 1200,
    height: 1680,
    previewUrl: "",
    sourceFile: file,
    targetedCrops: []
  };
}

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${message}: ${JSON.stringify(networkRequests)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const initialHandle = __listingCopilotAppTestHooks.handleFiles(
  [1, 2, 3, 4].map(fakeFile),
  {},
  { prepareFileForIntake: prepareImage }
).then(() => { initialHandleSettled = true; });

await waitFor(
  () => csmRequests.length === 1,
  "first persisted group did not start recognition progressively"
);
assert.equal(csmRequests[0].secondInitialGroupReleased, false);
assert.equal(csmRequests[0].initialHandleSettled, false, "recognition must start before whole-batch intake settles");

secondInitialGroupReleased = true;
secondInitialGroup.resolve();
await initialHandle;

await __listingCopilotAppTestHooks.handleFiles(
  [5, 6].map(fakeFile),
  {},
  { prepareFileForIntake: prepareImage }
);
await waitFor(() => csmRequests.length === 3, "appended card did not join the active recognition intent");

assert.deepEqual(
  csmRequests.map(({ assetId }) => assetId),
  [1, 2, 3].map(assetIdForIndex),
  "each prepared card must be recognized exactly once"
);
assert.equal(new Set(csmRequests.map(({ intentId }) => intentId)).size, 1, "progressive and appended cards must share one intent");

modelResponses.resolve();
await waitFor(() => {
  const snapshot = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
  return !snapshot.processing && snapshot.resultIndexes.length === 3;
}, "progressive recognition did not settle");

assert.deepEqual(__listingCopilotAppTestHooks.listingCopilotStateSnapshot().resultIndexes, [1, 2, 3]);
console.log("progressive handleFiles control-flow tests passed");
