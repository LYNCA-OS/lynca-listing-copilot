#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalizeQueueJobs } from "../api/v4/listing-job-enqueue.js";
import {
  RecognitionRequestContractError,
  defaultRecognitionProfileId,
  recognitionProfileIds,
  recognitionRequestContractVersion,
  withRecognitionRequestIntent
} from "../lib/listing/v4/contracts/recognition-request.mjs";
import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import {
  bindRecognitionProfileToPayload,
  buildRecognitionEffectiveConfiguration,
  resolveRecognitionProfile
} from "../lib/listing/v4/application/recognition-profile-adapter.mjs";

assert.equal(recognitionRequestContractVersion, "recognition-request-v3");

const clientIntent = withRecognitionRequestIntent({
  asset_id: "asset_11111111-2222-4123-8abc-abcdef123456",
  category: "browser-owned-category-is-forbidden",
  provider: "client-selected-provider",
  idempotency_key: "browser-nonce-must-not-own-paid-work",
  provider_options: { enable_catalog_assist: false },
  force_l2_only: false
});
assert.equal(clientIntent.recognition_profile, defaultRecognitionProfileId);
assert.equal("provider" in clientIntent, false);
assert.equal("provider_options" in clientIntent, false);
assert.equal("force_l2_only" in clientIntent, false);
assert.equal("category" in clientIntent, false);
assert.equal("idempotency_key" in clientIntent, false);

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
assert.equal(profile.provider_options.enable_fast_initial_provider_prompt, false);
assert.equal(profile.provider_options.exact_anchor_fast_final_shadow_only, true);

const pinnedProfile = resolveRecognitionProfile(defaultRecognitionProfileId, {
  ...env,
  OPENAI_LISTING_MODEL: "gpt-5-mini",
  OPENAI_LISTING_MODEL_REVISION: "gpt-5-mini-2025-08-07"
});
assert.equal(pinnedProfile.provider_options.openai_listing_model_override, "gpt-5-mini-2025-08-07");
assert.equal(pinnedProfile.provider_options.openai_listing_model_revision, "gpt-5-mini-2025-08-07");
const mismatchedPinnedProfile = resolveRecognitionProfile(defaultRecognitionProfileId, {
  ...env,
  OPENAI_LISTING_MODEL: "gpt-4.1-mini",
  OPENAI_LISTING_MODEL_REVISION: "gpt-5-mini-2025-08-07"
});
assert.equal(mismatchedPinnedProfile.provider_options.openai_listing_model_override, undefined);
assert.equal(mismatchedPinnedProfile.provider_options.openai_listing_model_revision, undefined);

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
assert.equal(bound.maxTitleLength, 80);
assert.equal(bound.max_title_length, 80);
assert.equal(bound.category, "collectible_card");

const evaluationBound = bindRecognitionProfileToPayload({
  recognition_profile: recognitionProfileIds.EVALUATION,
  recognition_benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
  evaluation_assist_profile: "none",
  provider_options: { disable_identity_result_cache_read: false, enable_catalog_assist: true }
}, {
  profileId: recognitionProfileIds.EVALUATION,
  env
});
assert.equal(evaluationBound.recognition_profile, recognitionProfileIds.EVALUATION);
assert.equal(evaluationBound.provider_options.recognition_benchmark_profile, recognitionBenchmarkProfileIds.COLD_ALGORITHM);
assert.equal(evaluationBound.provider_options.disable_identity_result_cache_read, true);
assert.equal(evaluationBound.provider_options.disable_identity_result_cache_write, true);
assert.equal(evaluationBound.provider_options.enable_catalog_assist, false);
assert.equal(evaluationBound.provider_options.enable_vector_assist, false);
assert.deepEqual(buildRecognitionEffectiveConfiguration(evaluationBound, env), {
  schema_version: "recognition-effective-configuration-v1",
  recognition_profile: recognitionProfileIds.EVALUATION,
  benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
  benchmark_phase: null,
  evaluation_assist_profile: "none",
  provider_options: {
    enable_catalog_assist: false,
    enable_vector_assist: false,
    enable_vector_retrieval: false,
    vector_retrieval_mode: "off",
    disable_identity_result_cache_read: true,
    disable_identity_result_cache_write: true,
    disable_approved_identity_memory: true,
    disable_writer_final_replay: true,
    disable_identity_inflight_replay: true,
    disable_recognition_worker_fast_final: true,
    exact_anchor_fast_final_shadow_only: true,
    openai_listing_model_override: "gpt-5-mini",
    v4_compact_l2_prompt: true,
    v4_ultra_fast_l2: false,
    v4_ultra_fast_image_detail: "high",
    enable_fast_initial_provider_prompt: false,
    cold_start_blind: false
  },
  execution: {
    force_l2_only: true,
    create_l1_job: false,
    create_l2_job: true,
    disable_fast_scout_l1: true,
    v4_force_l2_direct: true
  }
});

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
      category: "tcg",
      recognition_profile: defaultRecognitionProfileId,
      provider_options: { enable_catalog_assist: false },
      force_l2_only: false,
      images: [{ object_path: "legacy/four/segment/path.jpg" }],
      image_references: [{ object_path: "legacy/four/segment/path.jpg" }]
    }
  }],
  tenantId: "tenant_a",
  env,
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
assert.equal(canonicalJob.payload.category, "collectible_card");
assert.equal(canonicalJob.payload.resolutionMap["SR-KD"], "Star Swatch Signatures");
assert.match(canonicalJob.payload.resolution_map_revision, /^[0-9a-f]{64}$/);
assert.equal(canonicalJob.payload.effective_capture_quality.authority, "SERVER_CANONICAL_METADATA");
assert.equal(canonicalJob.payload.image_references.length, 1);
assert.equal(canonicalJob.payload.image_references[0].object_path.includes("legacy/four/segment"), false);

const canonicalRead = async () => ({
  image_generation_id: assetId,
  image_set_sha256: "b".repeat(64),
  expected_original_count: 1,
  images: [{
    image_role: "front_original",
    object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg`
  }],
  image_references: [{
    image_role: "front_original",
    object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg`
  }],
  image_paths: {}
});
const [defaultBoundJob] = await canonicalizeQueueJobs({
  jobs: [{
    asset_id: assetId,
    image_generation_id: assetId,
    payload: {
      asset_id: assetId,
      image_generation_id: assetId,
      provider_options: {
        enable_catalog_assist: false,
        recognition_benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM
      },
      maxTitleLength: 999,
      max_title_length: 1,
      resolved: { year: "2099", product: "Injected Product" },
      resolvedHint: { players: ["Injected Subject"] },
      catalog_candidates: [{ candidate_id: "forged-catalog" }],
      retrieval_candidates: [{ candidate_id: "forged-retrieval" }],
      approved_candidate_count: 999,
      provider_eval_mode: "forged",
      disable_exact_anchor_finalize: true,
      exact_anchor_fast_final_shadow_only: false,
      v4_l2_exact_anchor_allow_blocking_scout: true,
      l2_exact_anchor_allow_blocking_scout: true,
      v4_defer_noncritical_persistence: false,
      v4_atomic_writer_ready_capacity_release: false,
      product_schema_shadow_enabled: true,
      product_schema_shadow_profile: "shadow",
      enable_anchor_route_late_shadow: true,
      trace_level: "evaluation",
      serial_numerator_verified: true,
      active_catalog_snapshot_revision: "forged-catalog-revision",
      recognition_worker_revision: "forged-worker"
      , queue_decision_fingerprint: "f".repeat(64)
      , queue_decision_contract_version: "forged-contract"
      , recognition_profile_adapter_version: "forged-adapter"
      , resolutionMap: { HACK: "Injected title fact" }
      , captureProfileId: "ebay-blind-client-override"
      , captureQuality: {
        route: "TARGETED_RESCAN_REQUIRED",
        capture_surface_type: "SLAB",
        unresolved_regions: ["grade_label"]
      }
    }
  }],
  tenantId: "tenant_a",
  env,
  readCanonical: canonicalRead
});
assert.equal(defaultBoundJob.payload.recognition_profile, defaultRecognitionProfileId);
assert.equal(defaultBoundJob.recognition_profile, defaultRecognitionProfileId);
assert.equal(defaultBoundJob.payload.maxTitleLength, 80);
assert.equal(defaultBoundJob.payload.max_title_length, 80);
assert.equal(defaultBoundJob.payload.captureProfileId, "standard-card-v1");
assert.match(defaultBoundJob.payload.queue_decision_fingerprint, /^[0-9a-f]{64}$/);
assert.notEqual(defaultBoundJob.payload.queue_decision_fingerprint, "f".repeat(64));
assert.equal(defaultBoundJob.payload.queue_decision_contract_version, "queue-decision-fingerprint-v1");
assert.equal(defaultBoundJob.payload.recognition_profile_adapter_version, "recognition-profile-adapter-v3-pinned-model-shadow-anchor");
assert.equal(defaultBoundJob.payload.effective_capture_quality.route, null);
assert.equal(defaultBoundJob.payload.effective_capture_quality.glare_route, null);
assert.equal(defaultBoundJob.payload.effective_capture_quality.image_quality_degraded, null);
assert.equal(defaultBoundJob.payload.client_capture_quality.route, "TARGETED_RESCAN_REQUIRED");
assert.equal(defaultBoundJob.payload.resolutionMap.HACK, undefined);
for (const forbidden of [
  "resolved",
  "resolvedHint",
  "catalog_candidates",
  "retrieval_candidates",
  "approved_candidate_count",
  "provider_eval_mode",
  "disable_exact_anchor_finalize",
  "exact_anchor_fast_final_shadow_only",
  "v4_l2_exact_anchor_allow_blocking_scout",
  "l2_exact_anchor_allow_blocking_scout",
  "v4_defer_noncritical_persistence",
  "v4_atomic_writer_ready_capacity_release",
  "product_schema_shadow_enabled",
  "product_schema_shadow_profile",
  "enable_anchor_route_late_shadow",
  "trace_level",
  "serial_numerator_verified",
  "active_catalog_snapshot_revision",
  "recognition_worker_revision"
]) {
  assert.equal(forbidden in defaultBoundJob.payload, false, `${forbidden} must not cross the client-to-Queue boundary`);
}

const schedulingAttack = {
  asset_id: assetId,
  image_generation_id: assetId,
  priority: 0,
  max_attempts: 10,
  not_before: "2099-01-01T00:00:00.000Z",
  stage_result: { forged: true },
  result: { forged: true },
  error: { forged: true },
  timing: { forged: true },
  lane: "interactive",
  job_type: "FAST_SCOUT_DRAFT",
  provider_id: "forged",
  queue_tags: { forged: true },
  payload: {
    asset_id: assetId,
    image_generation_id: assetId,
    idempotency_key: "x".repeat(2_000),
    mode: "not-a-mode"
  }
};
const [schedulingSafeJob] = await canonicalizeQueueJobs({
  jobs: [schedulingAttack],
  tenantId: "tenant_a",
  env,
  readCanonical: canonicalRead
});
for (const forbidden of [
  "priority", "max_attempts", "not_before", "stage_result", "result", "error",
  "timing", "lane", "job_type", "provider_id", "queue_tags"
]) {
  assert.equal(forbidden in schedulingSafeJob, false, `${forbidden} must remain server-owned`);
}
assert.equal("idempotency_key" in schedulingSafeJob.payload, false);
assert.equal(schedulingSafeJob.payload.mode, "pair");

const productionWorkload = resolveRecognitionProfile(recognitionProfileIds.EVALUATION, env, {
  evaluationIntent: { benchmark_profile: recognitionBenchmarkProfileIds.PRODUCTION_WORKLOAD }
});
assert.deepEqual(productionWorkload.execution, profile.execution);
for (const key of ["enable_catalog_assist", "enable_vector_assist", "v4_compact_l2_prompt", "v4_ultra_fast_l2"]) {
  assert.equal(productionWorkload.provider_options[key], profile.provider_options[key], `${key} must match writer production`);
}

await assert.rejects(
  canonicalizeQueueJobs({
    jobs: [{
      asset_id: assetId,
      payload: {
        asset_id: assetId,
        image_generation_id: assetId,
        recognition_profile: "Evaluation-V1",
        recognition_benchmark_profile: "cold_algorithm_benchmark"
      }
    }],
    tenantId: "tenant_writer",
    allowEvaluationProfile: false,
    env: {},
    readCanonical: canonicalRead
  }),
  (error) => error instanceof RecognitionRequestContractError
    && error.code === "recognition_profile_not_authorized"
    && error.statusCode === 403
);
assert.equal(defaultBoundJob.payload.provider_options.enable_catalog_assist, true);
assert.equal(defaultBoundJob.payload.provider_options.recognition_benchmark_profile, undefined);

const evaluationJob = {
  asset_id: assetId,
  image_generation_id: assetId,
  payload: {
    asset_id: assetId,
    image_generation_id: assetId,
    recognition_profile: recognitionProfileIds.EVALUATION,
    recognition_benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
    evaluation_assist_profile: "catalog_only"
  }
};
await assert.rejects(
  () => canonicalizeQueueJobs({
    jobs: [evaluationJob],
    tenantId: "tenant_a",
    env,
    readCanonical: canonicalRead
  }),
  (error) => error instanceof RecognitionRequestContractError && error.statusCode === 403
);
const [authorizedEvaluationJob] = await canonicalizeQueueJobs({
  jobs: [evaluationJob],
  tenantId: "tenant_a",
  allowEvaluationProfile: true,
  env,
  readCanonical: canonicalRead
});
assert.equal(authorizedEvaluationJob.payload.recognition_profile, recognitionProfileIds.EVALUATION);
assert.equal(authorizedEvaluationJob.payload.provider_options.recognition_benchmark_profile, recognitionBenchmarkProfileIds.COLD_ALGORITHM);
assert.equal(authorizedEvaluationJob.payload.provider_options.enable_catalog_assist, true);
assert.equal(authorizedEvaluationJob.payload.provider_options.enable_vector_assist, false);

const frontend = readFileSync(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
assert.match(frontend, /withRecognitionRequestIntent/);
assert.doesNotMatch(frontend, /const defaultProviderOptions/);
assert.doesNotMatch(frontend, /provider_options:\s*\{/);
assert.doesNotMatch(frontend, /enqueueJobPayload\.force_l2_only/);
assert.doesNotMatch(frontend, /resolutionMap:\s*state\.resolutionMap/);

console.log("Recognition request contract tests passed");
