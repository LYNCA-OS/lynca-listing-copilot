import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("app/index.html", "utf8");
const js = await readFile("app/listing-copilot.js", "utf8");
const css = await readFile("app/listing-copilot.css", "utf8");

assert.match(html, /id="providerControl"/, "the product must retain a visible recognition-provider status area");
assert.match(html, /id="providerStatusText"/, "the fixed Luna route must remain legible to writers");
assert.match(html, /id="processButton"[^>]*hidden[^>]*aria-hidden="true"/, "upload intent must not require a second visible action");
assert.match(html, /name="assetMode" value="pair" checked/, "two-image paired recognition must remain the default");
assert.match(html, /每两张图片组成一张卡/, "pairing must be explained without front/back assumptions");
assert.doesNotMatch(html, /正面|背面/, "the writer surface must not infer image sides");
assert.doesNotMatch(html, /name="model_id"|name="endpoint"|id="modelId"|id="providerEndpoint"/i, "writers must not select an arbitrary model or endpoint");

const providerControlSource = js.slice(
  js.indexOf("function renderProviderControl"),
  js.indexOf("function canGenerateTitles")
);
assert.match(providerControlSource, /<strong>Luna 5\.6<\/strong>/, "the production route must identify Luna 5.6");
assert.match(providerControlSource, /CSM \/ SEM 单次识别/, "the provider control must describe the thin CSM/SEM route");
assert.match(providerControlSource, /上传后自动识别/, "the provider control must state the upload intent");
assert.doesNotMatch(js, /state\.selectedProvider|loadProviderStatus|providerStatusReadyPromise/, "the browser must not own provider selection or readiness polling");

assert.match(js, /const CSM_THIN_API_ENDPOINT = "\/api\/csm-listing-title"/);
assert.match(js, /const FEEDBACK_API_ENDPOINT = "\/api\/v4\/listing-feedback"/, "the existing durable feedback product boundary must remain available");
assert.match(js, /const EXPORT_WORKBOOK_API_ENDPOINT = "\/api\/v4\/listing-export-workbook"/, "the existing workbook product boundary must remain available");
for (const retiredBoundary of [
  "listing-provider-status",
  "listing-job-enqueue",
  "listing-job-status",
  "listing-job-retry",
  "listing-session-status",
  "listing-preingest",
  "processAssetViaQueue",
  "pollV4",
  "ENABLE_CSM_THIN_PATH",
  "ENABLE_SPECULATIVE_RECOGNITION",
  "withRecognitionRequestIntent",
  "defaultRecognitionProfileId"
]) {
  assert.equal(js.includes(retiredBoundary), false, `retired browser boundary must be absent: ${retiredBoundary}`);
}
assert.doesNotMatch(js, /Cloud Run|vector_prompt_assist|FAST_SCOUT|preingestion/i, "retired recognition branches must not survive as browser code");

const directRecognitionSource = js.slice(
  js.indexOf("async function processAssetViaCsmThinPath"),
  js.indexOf("function backgroundPreparationAvailable")
);
assert.match(directRecognitionSource, /await ensureAssetPreparedForRecognition\(asset\)/, "all automatic premodel recovery must settle before paid recognition");
assert.match(directRecognitionSource, /fetchJsonWithRetry\(CSM_THIN_API_ENDPOINT/);
assert.match(directRecognitionSource, /asset_id:\s*canonicalAssetId\(asset\)/);
assert.match(directRecognitionSource, /intent_id:\s*durableIntentId/);
assert.match(directRecognitionSource, /image_detail:\s*"high"/);
assert.match(directRecognitionSource, /manual_retry:\s*manualRetry === true/);
assert.match(directRecognitionSource, /timeoutMs:\s*CSM_THIN_REQUEST_TIMEOUT_MS/);
assert.match(directRecognitionSource, /maxAttempts:\s*1/);
assert.match(directRecognitionSource, /retryNetworkErrors:\s*false/, "the browser must not duplicate a paid operation behind the server authority");
assert.doesNotMatch(directRecognitionSource, /\bimages\s*:|\bobject_path\s*:|\bdata_url\s*:/, "the browser must not send image transport in the recognition body");

const handleFilesSource = js.slice(
  js.indexOf("async function handleFiles"),
  js.indexOf("function failedResult")
);
assert.doesNotMatch(handleFilesSource, /state\.processing\)\s*return/, "a later selection must be able to append to an active intent");
assert.match(handleFilesSource, /scheduleAssetBackgroundPreparation\(asset, backgroundRunId\)/, "each readable card must start durable original preparation immediately");
assert.match(handleFilesSource, /requestRecognitionContinuation\(\{ lifecycleGeneration, filePreparationRunId \}\)/, "each prepared group and the completed upload selection must continue recognition");
assert.match(handleFilesSource, /state\.backgroundPreparationRunId \|\| beginBackgroundPreparationRun\(\)/, "appended cards must inherit the active preparation intent");
assert.match(handleFilesSource, /state\.assets\.sort\(\(left, right\) => left\.index - right\.index\)/, "progressive preparation must preserve upload order");

const processTitlesSource = js.slice(
  js.indexOf("async function processTitles"),
  js.indexOf("function successorClientAssetRef")
);
assert.match(processTitlesSource, /const workerCount = directRecognitionConcurrencyLimit\(\)/, "the browser must use one bounded direct pool");
assert.match(processTitlesSource, /const claimedAssetIndexes = new Set\(completedAssetIndexes\)/, "append runs must preserve completed cards");
assert.match(processTitlesSource, /if \(state\.preparingFiles\) \{\s*await wait\(50\);\s*continue;/, "workers must remain open for cards still arriving in the same intent");
assert.match(processTitlesSource, /processAssetViaCsmThinPath\(asset, \{ intentId: recognitionBatchId \}\)/);
assert.doesNotMatch(processTitlesSource, /processAssetViaQueue|JOB_|SESSION_STATUS|provider_options/);

const retrySource = js.slice(
  js.indexOf("async function retryFailedAsset"),
  js.indexOf("async function copyTitle")
);
assert.match(retrySource, /resetAssetPreparationForRetry\(asset, \{[\s\S]*inputRebind: retryState\.input_rebind_required/);
assert.match(retrySource, /processAssetViaCsmThinPath\(asset, \{[\s\S]*manualRetry:\s*true/, "manual failure recovery must use the same thin route");
assert.match(retrySource, /const writerEditedTitle = String\(current\.correctedTitle/, "retry must preserve a writer edit");
assert.match(retrySource, /assetLifecycleMatches\(asset, lifecycleGeneration\)/, "stale retry responses must fail closed");
assert.doesNotMatch(retrySource, /processAssetViaQueue|listing-job|Cloud Run|v4_job_id/);

assert.match(js, /fetchStorageApiJson\("\/api\/listing-image-upload-url"/, "originals must use server-scoped signed upload URLs");
assert.match(js, /fetchStorageApiJson\("\/api\/listing-image-verify-upload"/, "recognition must depend on verified storage state");
assert.match(js, /uploadOriginalAssetImagesBatch/, "paired originals should share bounded signing and verification calls");
assert.match(js, /pendingStorageVerification/, "a successful PUT must retain enough state for verification retry");
assert.match(js, /throw failedOriginal\.error/, "a verification failure must reopen the original-upload promise");
assert.match(js, /function createImagePreviewUrl/);
assert.match(js, /URL\.revokeObjectURL/, "local preview object URLs must be released");
assert.match(js, /function renderAssetRowInPlace/, "large batches must update one result card at a time");
assert.match(js, /function updateAssetProgressDom/, "progress updates must not rebuild the full result list");
assert.match(js, /function updateGenerationTimingDom/, "timer updates must not rebuild the full result list");

assert.match(js, /function pendingFeedbackSubmission/);
assert.match(js, /recognition_session_id:\s*sessionId/, "feedback must bind the durable recognition session");
assert.match(js, /feedback_submission_id:\s*submission\.id/, "feedback retry must retain its idempotency key");
assert.match(js, /payload\.v4_persistence\?\.transaction\?\.saved !== true/, "feedback must fail closed without transaction acknowledgement");
assert.match(js, /fetchJsonWithRetry\(EXPORT_WORKBOOK_API_ENDPOINT/, "workbook export must remain wired");

assert.match(js, /bindEvents\(\);\s*renderProviderControl\(\);\s*renderPreviews\(\);\s*renderResults\(\);\s*$/s, "startup must be local and must not wait on a retired provider probe");
assert.match(css, /\.provider-option\.active/);
assert.match(css, /\.title-output/);
assert.match(css, /\.reject-button/);
assert.match(css, /\.loading-spinner/);
assert.match(css, /\.status-spinner/);
assert.match(css, /prefers-reduced-motion/);
assert.doesNotMatch(css, /\.side-decision-panel/, "removed front/back decisions must not keep dead styling");

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
  activeElement: null,
  createElement(tagName) {
    if (tagName !== "canvas") return makeDomElement();
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          drawImage() {},
          getImageData() { return { data: new Uint8ClampedArray(4) }; }
        };
      },
      toDataURL() { return "data:image/jpeg;base64,test"; }
    };
  },
  querySelector() { return makeDomElement(); },
  querySelectorAll() { return []; },
  addEventListener() {}
};
globalThis.window = { addEventListener() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

const { __listingCopilotAppTestHooks } = await import("../app/listing-copilot.js");

{
  let finishPreparation;
  let settled = false;
  const backgroundPreparationPromise = new Promise((resolve) => {
    finishPreparation = resolve;
  });
  const prepared = __listingCopilotAppTestHooks.ensureAssetPreparedForRecognition({
    backgroundPreparationPromise,
    backgroundPreparationRunId: 0
  }).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "recognition must wait for the complete automatic preparation recovery");
  finishPreparation({ ok: true, attempt_count: 2 });
  await prepared;
  assert.equal(settled, true);
}

assert.equal(__listingCopilotAppTestHooks.directRecognitionConcurrencyLimit(), 6);
assert.equal(__listingCopilotAppTestHooks.directRecognitionConcurrencyLimit({ maxWorkers: 3 }), 3);

assert.deepEqual(
  __listingCopilotAppTestHooks.retryStateForResult({
    confidence: "FAILED",
    unresolved: ["request"]
  }),
  {
    retryable: true,
    submitting: false,
    disabled: false,
    terminal_failure: true,
    terminal_without_title: true,
    input_rebind_required: false,
    recovery_mode: "CSM_DIRECT_RETRY"
  },
  "a failed direct request must remain manually retryable"
);
assert.equal(
  __listingCopilotAppTestHooks.retryStateForResult({ confidence: "FAILED", retryable: false }).disabled,
  true,
  "a server-declared terminal failure must remain disabled"
);
assert.equal(
  __listingCopilotAppTestHooks.retryStateForResult({
    confidence: "FAILED",
    recoveryAction: "INPUT_REBIND"
  }).recovery_mode,
  "INPUT_REBIND",
  "an immutable image conflict must choose the rebind recovery mode"
);
assert.equal(
  __listingCopilotAppTestHooks.retryStateForResult({
    confidence: "FAILED",
    feedbackStatus: "saved",
    persistenceStatus: "persisted"
  }).disabled,
  true,
  "persisted writer feedback must lock further mutation"
);

assert.equal(
  __listingCopilotAppTestHooks.shouldUseStorageFirstImage(
    { name: "card.jpg", type: "image/jpeg", size: 5_000_000 },
    { storageConfigured: true, maxUploadBytes: 25_000_000 }
  ),
  true
);
assert.equal(
  __listingCopilotAppTestHooks.shouldUseStorageFirstImage(
    { name: "card.heic", type: "image/heic", size: 5_000_000 },
    { storageConfigured: true, maxUploadBytes: 25_000_000 }
  ),
  false
);

const tenantId = "tenant-current";
const assetId = "asset-current";
const verifiedImage = {
  objectPath: "tenants/tenant-current/listing-assets/2026-08-01/asset-current/front.jpg",
  storageVerificationToken: "verification-token",
  storageVerified: true,
  storageUploaded: true,
  storageAssetId: assetId,
  storageTenantId: tenantId,
  cropMetadata: { source_object_path: "source", derived_object_path: "derived" },
  cropPlan: { crop_metadata: { source_object_path: "stale" } }
};
assert.equal(__listingCopilotAppTestHooks.imageHasVerifiedStorageReference(verifiedImage, assetId, tenantId), true);
assert.equal(
  __listingCopilotAppTestHooks.imageHasVerifiedStorageReference({ ...verifiedImage, storageAssetId: "asset-old" }, assetId, tenantId),
  false
);
__listingCopilotAppTestHooks.clearImageStorageBinding(verifiedImage);
assert.equal(verifiedImage.objectPath, "");
assert.equal(verifiedImage.storageVerificationToken, "");
assert.equal(verifiedImage.cropMetadata.source_object_path, "");

const missingPendingImage = { pendingStorageVerification: { objectPath: "exact/path.jpg" } };
assert.deepEqual(
  __listingCopilotAppTestHooks.notePendingStorageConfirmationFailure(missingPendingImage),
  { retained: true, exhausted: false, attempts: 1 }
);
assert.deepEqual(
  __listingCopilotAppTestHooks.notePendingStorageConfirmationFailure(missingPendingImage),
  { retained: false, exhausted: true, attempts: 2 }
);
assert.equal(missingPendingImage.pendingStorageVerification, undefined, "an absent ambiguous object must eventually reopen signing");

const rebindImage = {
  sourceBlob: { local: true },
  objectPath: "tenants/tenant-current/listing-assets/2026-08-01/asset-current/front.jpg",
  storageVerified: true,
  storageUploaded: true,
  storageAssetId: assetId,
  storageTenantId: tenantId
};
const rebindAsset = {
  id: "asset-1",
  clientAssetRef: "asset-1",
  durableAssetId: assetId,
  durableTenantId: tenantId,
  imageGenerationId: assetId,
  durableAssetPromise: Promise.resolve(),
  assetCreateIdempotencyKey: "11111111-2222-4333-8444-555555555555",
  originalStorageUploadPromise: Promise.resolve(),
  images: [rebindImage],
  providerImages: [rebindImage]
};
__listingCopilotAppTestHooks.resetAssetPreparationForRetry(rebindAsset, { inputRebind: true });
assert.equal(rebindAsset.durableAssetId, "");
assert.equal(rebindAsset.imageGenerationId, "");
assert.equal(rebindAsset.assetCreateIdempotencyKey, "", "an immutable-input rebind must receive a fresh create key");
assert.equal(rebindAsset.backgroundPreparationScheduledRunId, null);
assert.match(rebindAsset.clientAssetRef, /^asset-1:rebind:/);
assert.deepEqual(rebindImage.sourceBlob, { local: true }, "input rebind must preserve the local original");
assert.equal(rebindImage.objectPath, "");

assert.equal(__listingCopilotAppTestHooks.assetLifecycleMatches({ lifecycleGeneration: 4 }, 4, 4), true);
assert.equal(__listingCopilotAppTestHooks.assetLifecycleMatches({ lifecycleGeneration: 4 }, 4, 5), false);
assert.equal(__listingCopilotAppTestHooks.assetLifecycleMatches({ lifecycleGeneration: 3 }, 4, 4), false);

const oversizedOriginal = new Blob([new Uint8Array(30)], { type: "image/png" });
const compressedFallback = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
const uploadImage = {
  sourceFile: oversizedOriginal,
  sourceBlob: compressedFallback,
  originalWidth: 8000,
  originalHeight: 6000,
  width: 2200,
  height: 1650
};
assert.equal(__listingCopilotAppTestHooks.storageSourceForImage(uploadImage, 20), compressedFallback);
assert.deepEqual(
  __listingCopilotAppTestHooks.storageDimensionsForImage(uploadImage, compressedFallback),
  { width: 2200, height: 1650 }
);
assert.equal(__listingCopilotAppTestHooks.storageSourceForImage(uploadImage, 40), oversizedOriginal);

const createKeyAsset = {};
const firstCreateKey = __listingCopilotAppTestHooks.assetCreateIdempotencyKey(createKeyAsset);
assert.match(firstCreateKey, /^[0-9a-f-]{36}$/i);
assert.equal(
  __listingCopilotAppTestHooks.assetCreateIdempotencyKey(createKeyAsset),
  firstCreateKey,
  "asset-create retries must retain one idempotency key"
);

const firstImage = {
  id: "first",
  targetedCrops: Array.from({ length: 6 }, (_, index) => ({
    id: `first-crop-${index}`,
    derived: true,
    cropPlan: { priority: 100 - index }
  }))
};
const secondImage = {
  id: "second",
  targetedCrops: Array.from({ length: 6 }, (_, index) => ({
    id: `second-crop-${index}`,
    derived: true,
    cropPlan: { priority: 90 - index }
  }))
};
const providerImages = __listingCopilotAppTestHooks.imagesForProvider([firstImage, secondImage]);
assert.equal(providerImages.length, 10);
assert.equal(providerImages[0], firstImage);
assert.equal(providerImages[1], secondImage);
assert.equal(providerImages.filter((image) => image.derived).length, 8);

{
  const batchAssetId = "asset_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const batchTenantId = "tenant_current";
  const images = ["one", "two"].map((id, index) => ({
    id,
    name: `${id}.jpg`,
    originalType: "image/jpeg",
    type: "image/jpeg",
    originalWidth: 640,
    originalHeight: 960,
    width: 640,
    height: 960,
    sourceFile: new Blob([new Uint8Array([0xff, 0xd8, 0xff, index])], { type: "image/jpeg" }),
    contentSha256: "",
    objectPath: ""
  }));
  const persistedObjects = new Set();
  const calls = { sign: 0, put: 0, verify: 0, csm: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), "https://listing.test");
    if (url.pathname === "/api/listing-image-upload-url") {
      calls.sign += 1;
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        ok: true,
        uploads: body.images.map((image) => ({
          tenant_id: batchTenantId,
          image_id: image.imageId,
          storage_role: image.role,
          object_path: `tenants/${batchTenantId}/listing-assets/2026-08-02/${batchAssetId}/${image.role}-${image.imageId}.jpg`,
          content_type: image.contentType,
          signed_upload_url: `https://storage.test/${image.imageId}`
        }))
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "storage.test") {
      calls.put += 1;
      persistedObjects.add(url.pathname);
      if (url.pathname === "/one") {
        throw new TypeError("response lost after object commit");
      }
      return new Response("", { status: 200 });
    }
    if (url.pathname === "/api/listing-image-verify-upload") {
      calls.verify += 1;
      const body = JSON.parse(init.body);
      if (calls.verify === 1) {
        throw new TypeError("verification response lost after record commit");
      }
      return new Response(JSON.stringify({
        ok: true,
        verifications: body.images.map((image) => ({
          image_id: image.imageId,
          ok: true,
          verification: {
            tenant_id: batchTenantId,
            object_path: image.objectPath,
            bucket: "listing-card-images",
            content_type: image.contentType,
            size: image.size,
            width: image.width,
            height: image.height,
            content_sha256: image.contentSha256,
            verification_token: `verified-${image.imageId}`
          },
          verification_record: { saved: true, durable: true }
        }))
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/csm-listing-title") calls.csm += 1;
    throw new Error(`unexpected request ${url}`);
  };

  const outcomes = await __listingCopilotAppTestHooks.uploadOriginalAssetImagesBatch({
    durableAssetId: batchAssetId,
    durableTenantId: batchTenantId,
    clientAssetRef: "asset-1",
    images
  }, images.map((image, imageIndex) => ({ image, imageIndex })));
  assert.equal(outcomes.every((outcome) => outcome.ok === true), true);
  assert.equal(calls.sign, 1, "ambiguous PUT recovery must not re-sign the batch");
  assert.equal(calls.put, 4, "the ambiguous object uses only the bounded same-URL PUT attempts");
  assert.equal(calls.verify, 2, "a lost verify response must replay exact durable-state confirmation once");
  assert.equal(calls.csm, 0, "premodel recovery must never manufacture a paid Luna call");
  assert.equal(persistedObjects.has("/one"), true);
  assert.equal(images.every((image) => image.storageVerified === true), true);
}

const clock = __listingCopilotAppTestHooks.recognitionClockFromServerPayload({
  provider_result_summary: {
    recognition_clock_started_at: "2026-08-01T00:00:01.000Z",
    recognition_clock_source: "gpt_provider_request"
  },
  recognition_completed_at: "2026-08-01T00:00:03.000Z"
});
assert.equal(clock.startedAt, Date.parse("2026-08-01T00:00:01.000Z"));
assert.equal(clock.completedAt, Date.parse("2026-08-01T00:00:03.000Z"));
assert.equal(clock.startSource, "gpt_provider_request");

console.log("provider UI thin-path tests passed");
