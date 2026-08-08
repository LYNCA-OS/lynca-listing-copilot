import assert from "node:assert/strict";

function makeDomElement() {
  return {
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    appendChild() {}, remove() {}, click() {}, focus() {}, closest() { return null; },
    querySelector() { return makeDomElement(); }, querySelectorAll() { return []; },
    getClientRects() { return []; }, classList: { add() {}, remove() {}, toggle() {} },
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", disabled: false,
    checked: false, hidden: false
  };
}

globalThis.document = {
  body: makeDomElement(), documentElement: makeDomElement(), activeElement: null,
  createElement: () => makeDomElement(), querySelector: () => makeDomElement(),
  querySelectorAll: () => [], addEventListener() {}
};
globalThis.window = { addEventListener() {} };

const assetId = "asset_11111111-1111-4111-8111-111111111111";
const tenantId = "tenant_derived_test";
const intentId = "web-csm-derived-test";
const sessionId = "session-derived-test";
const checkpointReceipt = {
  schema_version: "csm-checkpoint-receipt-v1",
  operation_key: "operation-derived-test",
  payload_sha256: "a".repeat(64),
  task: {
    asset_id: assetId,
    intent_id: intentId,
    model: "gpt-5.6-luna",
    detail: "high",
    prompt_version: "test-prompt",
    image_fingerprints: [`sha256:${"b".repeat(64)}`]
  }
};
const order = [];
let ingestMetadata = null;
let ingestBytes = 0;
let feedbackBody = null;
let derivedIngestCount = 0;
let releaseOriginalPut;
const originalPutGate = new Promise((resolve) => { releaseOriginalPut = resolve; });

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function jsonBody(options = {}) {
  return typeof options.body === "string" ? JSON.parse(options.body) : {};
}

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target === "/api/csm-listing-title-ingest") {
    derivedIngestCount += 1;
    order.push("derived_ingest_dispatched");
    ingestMetadata = JSON.parse(Buffer.from(
      options.headers["x-lynca-ingest-metadata"], "base64url"
    ).toString("utf8"));
    ingestBytes = Number(options.body?.size || 0);
    return jsonResponse({
      ok: true,
      client_asset_ref: ingestMetadata.clientAssetRef,
      asset_id: assetId,
      tenant_id: tenantId,
      image_generation_id: assetId,
      expected_original_count: 1,
      trace_status: "CHECKPOINTED",
      checkpoint_state: "STAGED",
      pending_recognition_session_id: "pending-session",
      checkpoint_receipt: checkpointReceipt,
      title: "Generated Title",
      fields: {},
      csm_rows: {},
      provider_calls: 1,
      provider_replayed: false
    });
  }
  if (target === "/api/listing-asset-create") {
    order.push("original_asset_create");
    const body = jsonBody(options);
    return jsonResponse({
      ok: true,
      asset_id: assetId,
      tenant_id: tenantId,
      image_generation_id: assetId,
      client_asset_ref: body.client_asset_ref,
      expected_original_count: body.expected_original_count
    });
  }
  if (target === "/api/listing-image-upload-url") {
    order.push("original_sign");
    const body = jsonBody(options);
    assert.equal(body.imageId, "original-front");
    return jsonResponse({
      ok: true,
      asset_id: assetId,
      client_asset_ref: body.clientAssetRef,
      upload: {
        tenant_id: tenantId,
        image_id: "original-front",
        storage_role: "image_1_original",
        object_path: `tenants/${tenantId}/listing-assets/2026-08-08/${assetId}/front.jpg`,
        content_type: "image/jpeg",
        signed_upload_url: "https://storage.test/original-front"
      }
    });
  }
  if (target === "https://storage.test/original-front") {
    order.push("original_put");
    assert.equal(options.method, "PUT");
    await originalPutGate;
    return new Response(null, { status: 200 });
  }
  if (target === "/api/listing-image-verify-upload") {
    order.push("original_verify");
    const body = jsonBody(options);
    return jsonResponse({
      ok: true,
      verification: {
        tenant_id: tenantId,
        object_path: body.objectPath,
        bucket: "listing-images",
        verification_token: "verified-original",
        content_sha256: body.contentSha256
      },
      verification_record: { saved: true, durable: true }
    });
  }
  if (target === "/api/csm-listing-title") {
    if (options.method === "GET") return jsonResponse({ ok: true });
    order.push("checkpoint_finalize");
    const body = jsonBody(options);
    assert.equal(body.checkpoint_required, true);
    assert.equal(body.asset_id, assetId);
    assert.equal(body.intent_id, intentId);
    assert.deepEqual(body.checkpoint_receipt, checkpointReceipt);
    assert.ok(order.indexOf("original_verify") < order.indexOf("checkpoint_finalize"));
    return jsonResponse({
      ok: true,
      trace_status: "PERSISTED",
      provider_calls: 0,
      provider_replayed: true,
      recognition_session_id: sessionId,
      csm_rows: { resolution: { recognition_session_id: sessionId } }
    });
  }
  if (target === "/api/v4/listing-feedback") {
    order.push("feedback");
    feedbackBody = jsonBody(options);
    return jsonResponse({
      ok: true,
      status: "EDITED",
      writer_final_title: feedbackBody.writer_final_title,
      feedback_submission_id: feedbackBody.feedback_submission_id,
      feedback_event_id: "feedback-event",
      training_eligible: false,
      v4_persistence: { transaction: { saved: true } }
    });
  }
  if (target.startsWith("/api/csm-resolution-view")) return jsonResponse({}, 404);
  throw new Error(`unexpected network request: ${target}`);
};

const { __listingCopilotAppTestHooks } = await import("../app/listing-copilot.js");

const originalBytes = new Uint8Array(4_000_000).fill(17);
const originalBlob = new Blob([originalBytes], { type: "image/jpeg" });
const original = {
  id: "original-front",
  name: "front.jpg",
  originalType: "image/jpeg",
  type: "image/jpeg",
  size: originalBlob.size,
  originalSize: originalBlob.size,
  originalWidth: 3000,
  originalHeight: 4000,
  width: 3000,
  height: 4000,
  previewUrl: "blob:original",
  sourceFile: originalBlob,
  sourceBlob: null,
  contentSha256: "",
  targetedCrops: [],
  storageFirst: true,
  localMetadataPromise: Promise.resolve({ width: 3000, height: 4000 })
};
const derivedBlob = new Blob([new Uint8Array(400_000).fill(29)], { type: "image/jpeg" });
const derived = {
  id: "derived-front",
  name: "front recognition 1600",
  originalType: "image/jpeg",
  type: "image/jpeg",
  size: derivedBlob.size,
  width: 1200,
  height: 1600,
  originalWidth: 1200,
  originalHeight: 1600,
  sourceBlob: derivedBlob,
  sourceImageId: original.id,
  cropMetadata: {
    source_image_id: original.id,
    transform_version: "readability-downscale-v1"
  },
  derived: true,
  recognitionInput: true,
  contentSha256: ""
};
const asset = {
  id: "asset-1",
  clientAssetRef: "asset-1",
  lifecycleGeneration: 0,
  index: 1,
  images: [original],
  providerImages: [original],
  originalDurabilityStatus: "PENDING",
  titleFinalizationStatus: "PENDING",
  finalizationPromise: null
};

const staged = await __listingCopilotAppTestHooks.requestCsmIngestFastPath(
  asset,
  intentId,
  { recognitionInputs: [derived] }
);
assert.equal(staged.trace_status, "CHECKPOINTED");
assert.equal(order[0], "original_asset_create", "the durable asset root must exist before the paid request");
assert.equal(order[1], "derived_ingest_dispatched", "the small provider request must win byte-upload admission");
assert.equal(ingestMetadata.recognitionInputOnly, true);
assert.equal(ingestMetadata.manualRetry, false);
assert.equal(ingestMetadata.assetId, assetId);
assert.equal(ingestMetadata.expectedOriginalCount, 1);
assert.equal(ingestMetadata.originalFingerprints.length, 1);
assert.match(ingestMetadata.originalFingerprints[0], /^sha256:[0-9a-f]{64}$/);
assert.equal(ingestMetadata.images[0].sourceImageId, original.id);
assert.equal(ingestBytes, derivedBlob.size, "only the bounded derived bytes belong in preview ingest");
assert.equal(asset.images.length, 1, "derived input must not create a duplicate card image");
assert.equal(asset.providerImages.length, 1, "derived input must not enter canonical provider images");
assert.notEqual(
  asset.originalDurabilityStatus,
  "VERIFIED",
  "the staged title must be allowed to return while exact originals remain in the background lane"
);

const result = {
  index: 1,
  asset_id: assetId,
  generatedTitle: "Generated Title",
  title: "Generated Title",
  correctedTitle: "Writer Edited Title",
  csm_trace_status: "CHECKPOINTED",
  recognition_session_id: "",
  checkpoint_receipt: staged.checkpoint_receipt,
  csm_intent_id: intentId,
  confidence: "MEDIUM",
  feedbackStatus: "",
  explicitReviewOutcome: ""
};
const savePromise = __listingCopilotAppTestHooks.saveFeedbackForResult(result, asset);
for (let attempt = 0; attempt < 20 && !order.includes("original_put"); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.ok(order.includes("original_put"), "the background original upload must start without a second writer action");
assert.equal(order.includes("checkpoint_finalize"), false, "formal CSM must wait for verified originals");
releaseOriginalPut();
const saved = await savePromise;
assert.equal(saved, true, `one accept/edit click must wait for finalize and then save feedback: ${JSON.stringify({
  order, feedbackMessage: result.feedbackMessage, trace: result.csm_trace_status,
  session: result.recognition_session_id, original: asset.originalDurabilityStatus
})}`);
assert.equal(asset.originalDurabilityStatus, "VERIFIED");
assert.equal(result.csm_trace_status, "PERSISTED");
assert.equal(result.recognition_session_id, sessionId);
assert.equal(result.title_stage, "FINAL");
assert.equal(result.pending_recognition_session_id, "");
assert.equal(result.checkpoint_receipt, null);
assert.equal(result.correctedTitle, "Writer Edited Title", "finalize must not overwrite a writer edit");
assert.ok(order.indexOf("derived_ingest_dispatched") < order.indexOf("original_sign"));
assert.equal(feedbackBody.recognition_session_id, sessionId);
assert.equal(feedbackBody.writer_final_title, "Writer Edited Title");
assert.equal(order.filter((step) => step === "derived_ingest_dispatched").length, 1);
assert.equal(order.filter((step) => step === "checkpoint_finalize").length, 1);
assert.deepEqual(order.slice(-2), ["checkpoint_finalize", "feedback"]);

// If the first staged HTTP response was lost, the retry button must replay the
// same stable derived operation. It must never fall through to a new direct
// provider request under the current deployment runtime.
asset.finalizationPromise = null;
asset.titleFinalizationStatus = "PENDING";
asset.derivedCheckpointReplayRequired = true;
asset.recognitionInputs = [derived];
const recovered = await __listingCopilotAppTestHooks.processAssetViaCsmThinPath(asset, {
  intentId,
  manualRetry: true,
  retrySubmissionId: "retry-response-lost"
});
assert.equal(derivedIngestCount, 2, "manual recovery must replay the derived checkpoint endpoint");
assert.equal(ingestMetadata.manualRetry, true, "only an explicit writer retry may open a new failed attempt");
assert.equal(asset.derivedCheckpointReplayRequired, false);
assert.ok(["CHECKPOINTED", "PERSISTED"].includes(recovered.csm_trace_status));
assert.equal(
  order.filter((step) => step === "derived_ingest_dispatched").length,
  2,
  "response-loss recovery must dispatch exactly one idempotent preview replay"
);

console.log("staged title client flow tests passed");
