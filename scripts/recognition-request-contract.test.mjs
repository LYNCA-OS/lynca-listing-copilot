#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalizeQueueJobs } from "../api/v4/listing-job-enqueue.js";
import {
  RecognitionRequestContractError,
  defaultRecognitionProfileId,
  recognitionProfileIds,
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
assert.equal(profile.provider_options.v4_title_stage_target, "L2_ASSISTED_DRAFT");
assert.equal(profile.provider_options.v4_compact_l2_prompt, true);
assert.equal(profile.provider_options.v4_ultra_fast_l2, false);
assert.equal(profile.provider_options.v4_ultra_sparse_transport, false);
assert.equal(profile.provider_options.enable_pre_provider_rescue_shadow, true);
assert.equal(profile.provider_options.v4_provider_service_tier, "priority");
assert.equal(profile.provider_options.v4_provider_done_capacity_handoff, true);
assert.equal(profile.provider_options.enable_fast_initial_provider_prompt, false);
assert.equal(profile.provider_options.exclude_current_source_feedback, false);

const fastV5Profile = resolveRecognitionProfile(recognitionProfileIds.WRITER_ASSISTED_FAST_V5, env);
assert.equal(fastV5Profile.provider_options.v4_ultra_fast_l2, true);
assert.equal(fastV5Profile.provider_options.v4_ultra_fast_image_detail, "auto");
assert.equal(fastV5Profile.provider_options.v4_ultra_fast_text_verbosity, "medium");
assert.equal(fastV5Profile.provider_options.v4_ultra_fast_service_tier, "priority");
assert.equal(fastV5Profile.provider_options.v4_provider_done_capacity_handoff, true);
assert.equal(fastV5Profile.provider_options.enable_catalog_assist, true);
assert.equal(fastV5Profile.provider_options.enable_vector_assist, true);
assert.deepEqual(fastV5Profile.execution, profile.execution);

const evaluationProfile = resolveRecognitionProfile(recognitionProfileIds.WRITER_ASSISTED_EVALUATION, env);
assert.equal(evaluationProfile.provider_options.evaluation_profile, "v4_writer_assisted_evaluation_v1");
assert.equal(evaluationProfile.provider_options.disable_identity_result_cache, true);
assert.equal(evaluationProfile.provider_options.disable_approved_identity_memory, true);
assert.equal(evaluationProfile.provider_options.enable_vector_lazy_mode, profile.provider_options.enable_vector_lazy_mode);
assert.equal(evaluationProfile.provider_options.force_vector_assist, profile.provider_options.force_vector_assist);
assert.equal(evaluationProfile.provider_options.exclude_current_source_feedback, true);
assert.equal(evaluationProfile.provider_options.card_domain_selection_mode, "trusted_catalog_margin_v1");
assert.deepEqual(evaluationProfile.execution, profile.execution);

const oracleProfile = resolveRecognitionProfile(recognitionProfileIds.ACCURACY_CEILING_ORACLE, env);
assert.equal(oracleProfile.provider_options.require_terminal_preingestion_ocr, true);
assert.equal(oracleProfile.provider_options.preingestion_ocr_post_provider_wait_ms, 90_000);
assert.equal(oracleProfile.provider_options.evaluation_profile, "v4_accuracy_ceiling_oracle_v1");
assert.equal(oracleProfile.provider_options.enable_vector_lazy_mode, false);
assert.equal(oracleProfile.provider_options.force_vector_assist, true);
assert.equal(oracleProfile.provider_options.vector_index_ready, true);
assert.equal(oracleProfile.provider_options.vector_retrieval_top_k, 20);
assert.equal(oracleProfile.provider_options.vector_retrieval_internal_top_n, 20);
assert.equal(oracleProfile.provider_options.enable_post_observation_retrieval_deadline, false);
assert.equal(oracleProfile.provider_options.disable_identity_result_cache, true);
assert.equal(oracleProfile.provider_options.disable_approved_identity_memory, true);
assert.equal(oracleProfile.provider_options.force_retrieval_application_resolution, undefined);
assert.equal(oracleProfile.provider_options.v4_ultra_fast_l2, false);
assert.equal(oracleProfile.provider_options.exclude_current_source_feedback, true);

const bound = bindRecognitionProfileToPayload({
  recognition_profile: defaultRecognitionProfileId,
  provider: "untrusted-provider",
  provider_options: { enable_vector_assist: false },
  v4_force_l2_direct: false,
  client_speculative: true
}, { env });
assert.equal(bound.provider, undefined);
assert.equal(bound.provider_options.enable_vector_assist, true);
assert.equal(bound.provider_options.v4_compact_l2_prompt, true);
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
    image_generation_id: assetId,
    provider: "untrusted-provider",
    force_l2_only: false,
    payload: {
      asset_id: assetId,
      image_generation_id: assetId,
      client_asset_ref: "card-1",
      recognition_profile: defaultRecognitionProfileId,
      provider_options: { enable_catalog_assist: false },
      force_l2_only: false,
      images: [{ object_path: "legacy/four/segment/path.jpg" }],
      image_references: [{ object_path: "legacy/four/segment/path.jpg" }]
    }
  }],
  tenantId: "tenant_a",
  env,
  createVerificationToken: () => "server-refreshed-verification-token",
  readCanonical: async () => ({
    image_generation_id: assetId,
    image_set_sha256: "a".repeat(64),
    expected_original_count: 2,
    images: [{
      image_role: "front_original",
      object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg`
    }],
    image_references: [{
      image_role: "front_original",
      object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg`
    }],
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
assert.equal(canonicalJob.payload.image_references.length, 1);
assert.equal(canonicalJob.payload.image_references[0].object_path.includes("legacy/four/segment"), false);

const frontend = readFileSync(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
assert.match(frontend, /withRecognitionRequestIntent/);
assert.doesNotMatch(frontend, /const defaultProviderOptions/);
assert.doesNotMatch(frontend, /provider_options:\s*\{/);
assert.doesNotMatch(frontend, /enqueueJobPayload\.force_l2_only/);

console.log("Recognition request contract tests passed");
