#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalizeQueueJobs } from "../api/v4/listing-job-enqueue.js";
import {
  RecognitionRequestContractError,
  defaultRecognitionProfileId,
  withRecognitionRequestIntent
} from "../lib/listing/v4/contracts/recognition-request.mjs";
import {
  bindRecognitionProfileToPayload,
  resolveRecognitionProfile
} from "../lib/listing/v4/application/recognition-profile-adapter.mjs";

const clientIntent = withRecognitionRequestIntent({
  asset_id: "asset_11111111-2222-4123-8abc-abcdef123456",
  provider: "client-selected-provider",
  provider_options: { enable_catalog_assist: false },
  force_l2_only: false
});
assert.equal(clientIntent.recognition_profile, defaultRecognitionProfileId);
assert.equal("provider" in clientIntent, false);
assert.equal("provider_options" in clientIntent, false);
assert.equal("force_l2_only" in clientIntent, false);

const env = {
  ENABLE_SINGLE_MODEL_FAST_PATH: "false",
  ENABLE_EVIDENCE_COMPLETION: "true",
  ENABLE_CATALOG_ASSIST_DEFAULT: "true",
  ENABLE_VECTOR_ASSIST_DEFAULT: "true"
};
const profile = resolveRecognitionProfile(defaultRecognitionProfileId, env);
assert.equal(profile.execution.force_l2_only, true);
assert.equal(profile.execution.create_l1_job, false);
assert.equal(profile.execution.create_l2_job, true);
assert.equal(profile.provider_options.enable_catalog_assist, true);
assert.equal(profile.provider_options.enable_vector_assist, true);
assert.equal(profile.provider_options.vector_query_timeout_ms, 8000);

const bound = bindRecognitionProfileToPayload({
  recognition_profile: defaultRecognitionProfileId,
  provider: "untrusted-provider",
  provider_options: { enable_vector_assist: false },
  v4_force_l2_direct: false,
  client_speculative: true
}, { env });
assert.equal(bound.provider, undefined);
assert.equal(bound.provider_options.enable_vector_assist, true);
assert.equal(bound.v4_force_l2_direct, true);
assert.equal(bound.client_speculative, true);

await assert.rejects(
  () => Promise.resolve().then(() => withRecognitionRequestIntent({}, { profileId: "unknown-profile" })),
  RecognitionRequestContractError
);

const assetId = "asset_11111111-2222-4123-8abc-abcdef123456";
const [canonicalJob] = await canonicalizeQueueJobs({
  jobs: [{
    asset_id: assetId,
    provider: "untrusted-provider",
    force_l2_only: false,
    payload: {
      asset_id: assetId,
      client_asset_ref: "card-1",
      recognition_profile: defaultRecognitionProfileId,
      provider_options: { enable_catalog_assist: false },
      force_l2_only: false
    }
  }],
  tenantId: "tenant_a",
  env,
  readCanonical: async () => ({
    image_generation_id: assetId,
    image_set_sha256: "a".repeat(64),
    expected_original_count: 2,
    images: [],
    image_references: [],
    image_paths: {}
  })
});
assert.equal(canonicalJob.provider, undefined);
assert.equal(canonicalJob.force_l2_only, undefined);
assert.equal(canonicalJob.payload.recognition_profile, defaultRecognitionProfileId);
assert.equal(canonicalJob.payload.force_l2_only, true);
assert.equal(canonicalJob.payload.create_l1_job, false);
assert.equal(canonicalJob.payload.create_l2_job, true);
assert.equal(canonicalJob.payload.provider_options.enable_catalog_assist, true);
assert.equal(canonicalJob.payload.provider_options.enable_vector_assist, true);

const frontend = readFileSync(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
assert.match(frontend, /withRecognitionRequestIntent/);
assert.doesNotMatch(frontend, /const defaultProviderOptions/);
assert.doesNotMatch(frontend, /provider_options:\s*\{/);
assert.doesNotMatch(frontend, /enqueueJobPayload\.force_l2_only/);

console.log("Recognition request contract tests passed");
