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

assert.deepEqual(
  __listingCopilotAppTestHooks.workspaceActionLocks({
    processing: true,
    preparingFiles: false,
    writerSaveInFlight: false,
    exportingWorkbook: false,
    retryInFlight: 0
  }),
  { intakeLocked: false, resetLocked: true },
  "active recognition must still accept appended files while reset remains locked"
);
const repeatedSelectionInput = { files: ["same-card.jpg"], value: "same-card.jpg" };
assert.deepEqual(
  __listingCopilotAppTestHooks.consumeSelectedFiles(repeatedSelectionInput),
  ["same-card.jpg"],
  "file selection must be snapshotted before the input is cleared"
);
assert.equal(repeatedSelectionInput.value, "", "the same failed file must be selectable again");

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
  if (assetIndex > 1 && !secondInitialGroupReleased) await secondInitialGroup.promise;
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
    sourceFile: file
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
  Array.from({ length: 20 }, (_, index) => fakeFile(index + 1)),
  {},
  { prepareFileForIntake: prepareImage }
).then(() => { initialHandleSettled = true; });

await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(csmRequests.length, 0,
  "one readable pair must not dispatch before the whole file-picker selection is prepared");
assert.deepEqual(__listingCopilotAppTestHooks.listingCopilotStateSnapshot().assetIndexes, [],
  "selection preparation must not publish a partial directory");

secondInitialGroupReleased = true;
secondInitialGroup.resolve();
await initialHandle;
await waitFor(() => csmRequests.length === 6, "prepared selection did not fill the bounded recognition pool");
assert.ok(csmRequests.every((request) => request.secondInitialGroupReleased),
  "no provider request may start before the complete selection passes preparation");

const initialDirectorySessionId = __listingCopilotAppTestHooks
  .listingCopilotStateSnapshot().writerDirectory.sessionId;
__listingCopilotAppTestHooks.setWorkspaceMode("standard");

const beforeRejectedAppend = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
await __listingCopilotAppTestHooks.handleFiles(
  Array.from({ length: 6 }, (_, index) => fakeFile(index + 21)),
  {},
  {
    prepareFileForIntake: async (file) => {
      if (file.name === "card-24.jpg") throw new Error("synthetic back preparation failure");
      return prepareImage(file);
    }
  }
);
const afterRejectedAppend = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
assert.deepEqual(afterRejectedAppend.assetIndexes, beforeRejectedAppend.assetIndexes,
  "Queue Overview must not let odd, unsupported, or half-prepared pairs mutate the shared directory");
assert.equal(afterRejectedAppend.writerDirectory.eventCount, beforeRejectedAppend.writerDirectory.eventCount,
  "malformed appends from Queue Overview must not mutate the Writer ledger");
assert.equal(afterRejectedAppend.writerDirectory.sessionId, beforeRejectedAppend.writerDirectory.sessionId,
  "a rejected Queue Overview append must preserve the Writer session");
assert.equal(csmRequests.length, 6,
  "a selection with valid pairs around one failed pair must dispatch none of them");

await __listingCopilotAppTestHooks.handleFiles(
  Array.from({ length: 40 }, (_, index) => fakeFile(index + 21)),
  {},
  { prepareFileForIntake: prepareImage }
);
await waitFor(() => csmRequests.length === 6, "appended cards did not fill the bounded recognition pool");

const intakeSnapshot = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
assert.equal(intakeSnapshot.workspaceMode, "standard", "Queue Overview remains a projection over the same active session");
assert.deepEqual(intakeSnapshot.assetIndexes, Array.from({ length: 30 }, (_, index) => index + 1),
  "10 cards followed by 20 cards must form one stable 30-card directory");
assert.deepEqual(intakeSnapshot.writerDirectory && {
  turns: intakeSnapshot.writerDirectory.turns,
  assets: intakeSnapshot.writerDirectory.assets
}, { turns: 2, assets: 30 }, "the two file-picker selections remain two conversational turns");
assert.equal(intakeSnapshot.writerDirectory.sessionId, initialDirectorySessionId,
  "adding 20 cards from Queue Overview must extend, not replace, the Writer directory");

__listingCopilotAppTestHooks.setWorkspaceMode("terminal");
assert.equal(__listingCopilotAppTestHooks.listingCopilotStateSnapshot().workspaceMode, "writer",
  "the old experiment key aliases to the upgraded Writer entry");

assert.equal(new Set(csmRequests.map(({ intentId }) => intentId)).size, 1, "progressive and appended cards must share one intent");

modelResponses.resolve();
await waitFor(() => {
  const snapshot = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
  return !snapshot.processing && snapshot.resultIndexes.length === 30;
}, "progressive recognition did not settle");

const settledSnapshot = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
assert.deepEqual(settledSnapshot.resultIndexes, Array.from({ length: 30 }, (_, index) => index + 1));
assert.deepEqual(
  [...new Set(csmRequests.map(({ assetId }) => assetId))].sort(),
  Array.from({ length: 30 }, (_, index) => assetIdForIndex(index + 1)).sort(),
  "each physical card must receive one independent recognition request"
);
assert.equal(csmRequests.length, 30, "no provider response may be reused across cards");
assert.deepEqual(settledSnapshot.writerDirectory && {
  turns: settledSnapshot.writerDirectory.turns,
  assets: settledSnapshot.writerDirectory.assets,
  completed: settledSnapshot.writerDirectory.completed,
  eventCount: settledSnapshot.writerDirectory.eventCount
}, { turns: 2, assets: 30, completed: 30, eventCount: 60 });

const directorySessionId = settledSnapshot.writerDirectory.sessionId;
assert.equal(settledSnapshot.writerDirectory.exportReady, true,
  "a fully settled directory must be export-ready before projection recovery");
__listingCopilotAppTestHooks.injectTerminalProjectionErrorForTest();
assert.equal(__listingCopilotAppTestHooks.listingCopilotStateSnapshot().writerDirectory.exportReady, false,
  "a projection defect must fail the export authority closed");
__listingCopilotAppTestHooks.setWorkspaceMode("standard");
__listingCopilotAppTestHooks.setWorkspaceMode("terminal");
const restoredSnapshot = __listingCopilotAppTestHooks.listingCopilotStateSnapshot();
assert.equal(restoredSnapshot.workspaceMode, "writer", "the old experiment key aliases to Writer Terminal");
assert.equal(restoredSnapshot.writerDirectory.sessionId, directorySessionId,
  "switching between Queue Overview and Writer Terminal must not replace the session ledger");
assert.equal(restoredSnapshot.writerDirectory.eventCount, 60,
  "projection switching must retain append-only recognition history");
assert.equal(restoredSnapshot.writerDirectory.projectionError, "",
  "returning to Writer Terminal must rebuild a failed projection from canonical assets and results");
assert.equal(restoredSnapshot.writerDirectory.exportReady, true,
  "projection recovery must restore the shared export authority in both views");
console.log("atomic selection and progressive append handleFiles tests passed");
