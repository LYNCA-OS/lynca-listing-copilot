#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AssetLifecycleContractError,
  assertMatchingImageGeneration,
  assetRecoveryActions,
  classifyAssetLifecycleFailure,
  clientForbiddenImageTransportKeys,
  requestedImageGenerationId,
  stripClientImageTransport
} from "../lib/listing/v4/assets/asset-lifecycle-contract.mjs";

const assetId = "asset_11111111-2222-4123-8abc-abcdef123456";
const staleAssetId = "asset_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const maliciousIntent = Object.fromEntries(clientForbiddenImageTransportKeys.map((key) => [key, `attacker:${key}`]));
const stripped = stripClientImageTransport({
  ...maliciousIntent,
  asset_id: assetId,
  image_generation_id: assetId,
  maxTitleLength: 80
});

for (const key of clientForbiddenImageTransportKeys) {
  assert.equal(Object.hasOwn(stripped, key), false, `browser image transport key must be removed: ${key}`);
}
assert.equal(stripped.asset_id, assetId);
assert.equal(stripped.image_generation_id, assetId);
assert.equal(requestedImageGenerationId({ payload: stripped }), assetId);
assert.equal(assertMatchingImageGeneration({
  requestedGenerationId: assetId,
  canonicalGenerationId: assetId
}), assetId);

assert.throws(
  () => requestedImageGenerationId({ asset_id: assetId }),
  (error) => error instanceof AssetLifecycleContractError
    && error.code === "canonical_image_generation_missing"
    && error.recoveryAction === assetRecoveryActions.INPUT_REBIND
);
assert.throws(
  () => assertMatchingImageGeneration({
    requestedGenerationId: staleAssetId,
    canonicalGenerationId: assetId
  }),
  (error) => error instanceof AssetLifecycleContractError
    && error.code === "canonical_image_generation_stale"
    && error.retryable === false
    && error.recoveryAction === assetRecoveryActions.INPUT_REBIND
);

const classified = classifyAssetLifecycleFailure({
  code: "CANONICAL_IMAGE_GENERATION_STALE",
  retryable: true
});
assert.deepEqual(classified, {
  code: "CANONICAL_IMAGE_GENERATION_STALE",
  recovery_action: assetRecoveryActions.INPUT_REBIND,
  retryable: false
});
assert.deepEqual(classifyAssetLifecycleFailure({
  code: "CANONICAL_IMAGE_VERIFICATION_READ_FAILED",
  retryable: true
}), {
  code: "CANONICAL_IMAGE_VERIFICATION_READ_FAILED",
  recovery_action: assetRecoveryActions.NONE,
  retryable: null
});
assert.equal(
  classifyAssetLifecycleFailure({ code: "CANONICAL_IMAGE_GENERATION_MISSING" }).recovery_action,
  assetRecoveryActions.INPUT_REBIND
);
assert.equal(
  classifyAssetLifecycleFailure({ code: "legacy_code", recoveryAction: "INPUT_REBIND" }).recovery_action,
  assetRecoveryActions.INPUT_REBIND
);

const appSource = readFileSync(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
const directRecognitionSource = appSource.slice(
  appSource.indexOf("async function processAssetViaCsmThinPath"),
  appSource.indexOf("function backgroundPreparationAvailable")
);
assert.match(directRecognitionSource, /await ensureAssetPreparedForRecognition\(asset\)/, "recognition must establish canonical originals and settle bounded automatic recovery first");
assert.match(directRecognitionSource, /asset_id:\s*canonicalAssetId\(asset\)/, "browser recognition intent must bind the durable asset identity");
assert.match(directRecognitionSource, /intent_id:\s*durableIntentId/, "browser recognition intent must carry one stable operation identity");
assert.doesNotMatch(directRecognitionSource, /\bimages\s*:|\bobjectPath\s*:|\bobject_path\s*:/, "browser recognition intent must not carry images or object paths");
assert.doesNotMatch(directRecognitionSource, /image_generation_id\s*:/, "the server must resolve the canonical image generation from the asset identity");
assert.match(appSource, /resetAssetPreparationForRetry\(asset, \{[\s\S]*inputRebind:/);
assert.doesNotMatch(appSource, /buildAssetQueueIntentBody|listing-job-enqueue/, "the production browser must not retain the retired queue submission path");

const enqueueSource = readFileSync(new URL("../api/v4/listing-job-enqueue.js", import.meta.url), "utf8");
assert.match(enqueueSource, /readCanonicalListingImageReferences/, "server must reconstruct canonical images");
assert.match(
  enqueueSource,
  /v4ProductionStrategy\.asset_lifecycle\.assert_image_generation/,
  "server must delegate stale-generation policy to the versioned strategy"
);
assert.match(enqueueSource, /stripClientImageTransport\(withoutClientSessionIdentity\(job\)\)/);

const smokeSource = readFileSync(new URL("./v4-ebay-smoke.mjs", import.meta.url), "utf8");
assert.match(smokeSource, /image_generation_id:\s*asset\.image_generation_id/);
assert.match(smokeSource, /image_generation_id:\s*payload\.image_generation_id/);

console.log("V4 asset lifecycle contract tests passed");
