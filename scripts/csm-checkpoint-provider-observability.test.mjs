import { strict as assert } from "node:assert";

// A post-provider persistence-checkpoint rejection used to reach the operation
// wrap with `provider_ms: null` and empty latency stages, which read as a
// pre-provider failure. On 2026-08-16 that ambiguity cost hours: the failed
// ops each held a 7.5-11.8s provider attempt, invisible in terminal_result.
// This file pins the fix: checkpoint errors minted after the provider carry
// the paid-attempt timing on the error itself.
//
// Kept OUTSIDE the activation core freeze, like csm-lot-checkpoint-regression.

import {
  runDirectCsmAsset,
  buildProviderFailureReceipt
} from "../api/csm-listing-title.js";

const originalSha256 = [
  "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
  "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
];

const canonical = {
  asset_id: "asset-observability-1",
  image_generation_id: "asset-observability-1",
  image_set_sha256: "e".repeat(64),
  expected_original_count: 2,
  image_references: originalSha256.map((content_sha256, index) => ({
    image_id: `original-${index + 1}`,
    image_role: index === 0 ? "front_original" : "back_original",
    bucket: "cards",
    object_path: `tenant-1/asset-observability-1/original-${index + 1}.jpg`,
    content_sha256,
    derived: false
  })),
  images: originalSha256.map((content_sha256, index) => ({
    image_id: `original-${index + 1}`,
    objectPath: `tenant-1/asset-observability-1/original-${index + 1}.jpg`,
    bucket: "cards",
    size: 1_000 + index,
    storageRole: index === 0 ? "image_1_original" : "image_2_original",
    derived: false,
    content_sha256
  }))
};

const passthroughAuthority = () => ({
  lookupOperationResult: async () => ({ status: "not_found" }),
  lookupOperationResultByKey: async () => ({ status: "not_found" }),
  enqueueAttempt: async () => {},
  runAttempt: async ({ execute }) => execute()
});

function baseDependencies() {
  return {
    checkReadiness: async () => ({ ready: true, reason: null }),
    readImages: async () => canonical,
    signImage: async ({ objectPath }) => `https://signed.invalid/${objectPath}`,
    createSession: async () => ({
      persistence: { recognition_session: { saved: true } }
    }),
    providerAdmission: passthroughAuthority()
  };
}

async function runWithPreparePath(preparePath) {
  const dependencies = baseDependencies();
  dependencies.preparePath = preparePath;
  return runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: canonical.asset_id,
    intentId: "intent-observability-1",
    dependencies
  });
}

// 1. A checkpoint rejection minted AFTER the provider ran keeps the paid
//    attempt's timing on the error.
{
  const error = await runWithPreparePath(async () => ({
    // latency_ms only exists after a provider call; the prepared result is
    // otherwise empty, so buildCsmPersistenceCheckpoint rejects at identity.
    latency_ms: 1234
  })).then(() => null, (failure) => failure);
  assert.ok(error, "the empty prepared result must fail the checkpoint");
  assert.equal(error.code, "csm_persistence_checkpoint_invalid");
  assert.equal(error.provider_attempt_started, true,
    "a finite provider duration proves the paid attempt ran");
  assert.equal(error.provider_ms, 1234,
    "the provider duration rides the checkpoint error");
  assert.equal(error.latency_stages_ms.provider_ms, 1234);
  assert.equal(error.latency_stages_ms.provider_prepare_ms >= 0, true);
  const receipt = buildProviderFailureReceipt(error);
  assert.equal(receipt.provider_ms, 1234,
    "the failure receipt no longer reports a phantom pre-provider failure");
  assert.equal(receipt.latency_stages_ms.provider_ms, 1234);
}

// 2. Pre-provider failures are not mislabelled as paid attempts.
{
  const error = await runWithPreparePath(async () => {
    throw Object.assign(new Error("compile_failed_before_provider"), {
      code: "compile_failed_before_provider",
      statusCode: 500,
      retryable: true
    });
  }).then(() => null, (failure) => failure);
  assert.ok(error);
  assert.notEqual(error.provider_attempt_started, true,
    "no provider duration means no paid attempt claim");
}

console.log("csm checkpoint provider observability: ok");
