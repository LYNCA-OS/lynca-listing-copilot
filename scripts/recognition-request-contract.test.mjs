#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalizeQueueJobs,
  listingEvaluationRequestAuthorization,
  listingEvaluationRequestAuthorized
} from "../api/v4/listing-job-enqueue.js";
import {
  LEGACY_TENANT_ID,
  LEGACY_USER_ID,
  TENANT_ROLES
} from "../lib/tenant/index.mjs";
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
assert.equal(profile.provider_options.v4_title_stage_target, "L2_ASSISTED_DRAFT");
assert.equal(profile.provider_options.v4_compact_l2_prompt, true);
assert.equal(profile.provider_options.v4_ultra_fast_l2, false);
assert.equal(profile.provider_options.v4_ultra_sparse_transport, false);
assert.equal(profile.provider_options.enable_fast_initial_provider_prompt, false);

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

const [legacyUnprofiledJob] = await canonicalizeQueueJobs({
  jobs: [{
    asset_id: assetId,
    image_generation_id: assetId,
    payload: {
      asset_id: assetId,
      image_generation_id: assetId,
      provider_options: {
        recognition_benchmark_profile: "cold_targeted_assist_benchmark",
        enable_targeted_visual_assist_candidate: true
      }
    }
  }],
  tenantId: "tenant_a",
  env,
  readCanonical: async () => ({
    image_generation_id: assetId,
    image_set_sha256: "b".repeat(64),
    expected_original_count: 1,
    images: [{ image_role: "front_original", object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg` }],
    image_references: [{ image_role: "front_original", object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg` }],
    image_paths: {}
  })
});
assert.equal(legacyUnprofiledJob.payload.recognition_profile, defaultRecognitionProfileId);
assert.notEqual(
  legacyUnprofiledJob.payload.provider_options.recognition_benchmark_profile,
  "cold_targeted_assist_benchmark"
);
assert.notEqual(legacyUnprofiledJob.payload.provider_options.enable_targeted_visual_assist_candidate, true);

const [authorizedEvaluationJob] = await canonicalizeQueueJobs({
  jobs: [{
    asset_id: assetId,
    image_generation_id: assetId,
    payload: {
      asset_id: assetId,
      image_generation_id: assetId,
      provider_options: {
        recognition_benchmark_profile: "cold_targeted_assist_benchmark",
        enable_targeted_visual_assist_candidate: true
      }
    }
  }],
  tenantId: "tenant_a",
  allowAlgorithmOverrides: true,
  env,
  readCanonical: async () => ({
    image_generation_id: assetId,
    image_set_sha256: "c".repeat(64),
    expected_original_count: 1,
    images: [{ image_role: "front_original", object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg` }],
    image_references: [{ image_role: "front_original", object_path: `tenants/tenant_a/listing-assets/2026-07-19/${assetId}/front.jpg` }],
    image_paths: {}
  })
});
assert.equal(authorizedEvaluationJob.payload.provider_options.recognition_benchmark_profile, "cold_targeted_assist_benchmark");
assert.equal(authorizedEvaluationJob.payload.provider_options.enable_targeted_visual_assist_candidate, true);
const legacyEvaluationOwner = {
  userId: LEGACY_USER_ID,
  tenantId: LEGACY_TENANT_ID,
  role: TENANT_ROLES.OWNER
};
assert.equal(listingEvaluationRequestAuthorized({
  headers: { "x-lynca-launch-gate-secret": "eval-secret" }
}, legacyEvaluationOwner, { LAUNCH_GATE_EVAL_SECRET: "eval-secret" }), true);
assert.equal(listingEvaluationRequestAuthorized({
  headers: { "x-lynca-launch-gate-secret": "wrong" }
}, legacyEvaluationOwner, { LAUNCH_GATE_EVAL_SECRET: "eval-secret" }), false);
assert.deepEqual(listingEvaluationRequestAuthorization({ headers: {} }, legacyEvaluationOwner, {
  LAUNCH_GATE_EVAL_SECRET: "eval-secret"
}), {
  requested: false,
  authorized: false,
  reason_code: "NOT_REQUESTED"
});
assert.equal(listingEvaluationRequestAuthorized({
  headers: { "x-lynca-launch-gate-secret": "eval-secret" }
}, { ...legacyEvaluationOwner, role: TENANT_ROLES.MANAGER }, {
  LAUNCH_GATE_EVAL_SECRET: "eval-secret"
}), false);
assert.equal(listingEvaluationRequestAuthorized({
  headers: { "x-lynca-launch-gate-secret": "eval-secret" }
}, { ...legacyEvaluationOwner, userId: "user_other" }, {
  LAUNCH_GATE_EVAL_SECRET: "eval-secret"
}), false);
assert.equal(listingEvaluationRequestAuthorized({
  headers: { "x-lynca-launch-gate-secret": "eval-secret" }
}, { ...legacyEvaluationOwner, tenantId: "tenant_other" }, {
  LAUNCH_GATE_EVAL_SECRET: "eval-secret"
}), false);
assert.equal(listingEvaluationRequestAuthorized({
  headers: { "x-lynca-launch-gate-secret": "eval-secret" }
}, legacyEvaluationOwner, {}), false);

const frontend = readFileSync(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
const directRecognitionSource = frontend.slice(
  frontend.indexOf("async function processAssetViaCsmThinPath"),
  frontend.indexOf("function backgroundPreparationAvailable")
);
assert.match(frontend, /const CSM_THIN_API_ENDPOINT = "\/api\/csm-listing-title"/);
assert.match(directRecognitionSource, /fetchJsonWithRetry\(CSM_THIN_API_ENDPOINT/);
assert.match(directRecognitionSource, /asset_id:\s*canonicalAssetId\(asset\)/);
assert.match(directRecognitionSource, /intent_id:\s*durableIntentId/);
assert.match(directRecognitionSource, /image_detail:\s*"high"/);
assert.match(directRecognitionSource, /manual_retry:\s*manualRetry === true/);
assert.match(directRecognitionSource, /maxAttempts:\s*1/);
assert.match(directRecognitionSource, /retryNetworkErrors:\s*false/);
assert.doesNotMatch(frontend, /withRecognitionRequestIntent|defaultRecognitionProfileId/);
assert.doesNotMatch(frontend, /const defaultProviderOptions/);
assert.doesNotMatch(frontend, /provider_options:\s*\{/);
assert.doesNotMatch(frontend, /enqueueJobPayload\.force_l2_only/);

const nativeCore = readFileSync(
  new URL("../lib/listing/v4/pipeline/native-recognition-core.mjs", import.meta.url),
  "utf8"
);
assert.match(nativeCore, /const providerExecutionSignal = requestContext\?\.signal \|\| null/);
assert.match(nativeCore, /requestContext: fullProviderRequestContext,\s+signal: providerExecutionSignal/);

// The strip must report what it took. Silence here is what let a paired run
// vary --model against an unauthorized deployment, measure the env-pinned model
// on both arms, and look like a clean comparison.
{
  const { stripClientAlgorithmControlsReporting } = await import(
    "../lib/listing/v4/contracts/recognition-request.mjs"
  );

  const stripped = stripClientAlgorithmControlsReporting({
    asset_id: "asset-1",
    provider_options: { openai_listing_model_override: "gpt-5.6-luna" },
    model: "gpt-5.6-luna"
  });
  assert.deepEqual(stripped.removed.sort(), ["model", "provider_options"]);
  assert.equal(stripped.value.provider_options, undefined);
  assert.equal(stripped.value.asset_id, "asset-1", "non-control keys survive");

  // A caller that sent nothing forbidden must not be told anything was taken --
  // otherwise the signal is noise and gets ignored when it matters.
  assert.deepEqual(stripClientAlgorithmControlsReporting({ asset_id: "asset-1" }).removed, []);
}

// An env-pinned model silently outranks the source default. Readiness has to be
// able to say so, or "we switched the model" stays unfalsifiable.
{
  const { providerModelPinning, visionProviderIds: ids, defaultProviderModels: defaults } = await import(
    "../lib/listing/providers/provider-contract.mjs"
  );
  const provider = ids.OPENAI_LEGACY;

  const pinned = providerModelPinning(provider, { OPENAI_LISTING_MODEL: "gpt-5-mini-2025-08-07" });
  assert.equal(pinned.effective_model, "gpt-5-mini-2025-08-07");
  assert.equal(pinned.code_default, defaults[provider]);
  assert.equal(pinned.code_default_is_inert, true);
  assert.match(pinned.remedy, /overrides the source default/);

  const unpinned = providerModelPinning(provider, {});
  assert.equal(unpinned.effective_model, defaults[provider]);
  assert.equal(unpinned.code_default_is_inert, false);
  assert.equal(unpinned.remedy, null);

  // Agreement is not a conflict.
  const agreeing = providerModelPinning(provider, { OPENAI_LISTING_MODEL: defaults[provider] });
  assert.equal(agreeing.code_default_is_inert, false);
}

// Dotted gpt-5 minor versions belong to the gpt-5 family. Classifying one as
// legacy sends it `temperature`, which OpenAI rejects with a 400 -- the whole
// provider call fails rather than degrading, so this is not cosmetic.
{
  const { isGpt5ResponsesModel, openAiResponsesModelControls } = await import(
    "../lib/listing/providers/openai-responses-request.mjs"
  );

  for (const model of ["gpt-5", "gpt-5-mini", "gpt-5-mini-2025-08-07", "gpt-5.6-luna"]) {
    assert.equal(isGpt5ResponsesModel(model), true, `${model} is a gpt-5 model`);
    const controls = openAiResponsesModelControls(model, { env: {} });
    assert.equal(controls.temperature, undefined, `${model} must not be sent temperature`);
    assert.ok(controls.reasoning?.effort, `${model} carries a reasoning effort`);
  }

  // The separator class must not swallow models that merely start with the same
  // digits. "gpt-50" is not a gpt-5.
  for (const model of ["gpt-4.1", "gpt-4.1-mini", "gpt-50-fake", ""]) {
    assert.equal(isGpt5ResponsesModel(model), false, `${model || "(empty)"} is not a gpt-5 model`);
  }
  assert.equal(openAiResponsesModelControls("gpt-4.1-mini", { env: {} }).temperature, 0);
}

// Reasoning-effort names are not uniform across the gpt-5 family, and the API
// rejects an unsupported one instead of ignoring it. "minimal" and "none" are
// the same intent under two names, so the configured value has to translate
// rather than be passed through and fail.
{
  const { openAiResponsesModelControls, supportedReasoningEfforts } = await import(
    "../lib/listing/providers/openai-responses-request.mjs"
  );
  const effortFor = (model, env = {}) => openAiResponsesModelControls(model, { env }).reasoning.effort;

  assert.equal(effortFor("gpt-5-mini"), "minimal");
  assert.equal(effortFor("gpt-5.6-luna"), "none", "dotted models have no 'minimal'");
  assert.equal(effortFor("gpt-5.6-luna", { OPENAI_GPT5_REASONING_EFFORT: "minimal" }), "none");
  assert.equal(effortFor("gpt-5-mini", { OPENAI_GPT5_REASONING_EFFORT: "none" }), "minimal");

  // A value both models understand passes through untranslated.
  assert.equal(effortFor("gpt-5.6-luna", { OPENAI_GPT5_REASONING_EFFORT: "medium" }), "medium");
  assert.equal(effortFor("gpt-5-mini", { OPENAI_GPT5_REASONING_EFFORT: "medium" }), "medium");

  // Nonsense must land on something the model accepts, never be forwarded.
  for (const model of ["gpt-5-mini", "gpt-5.6-luna"]) {
    const effort = effortFor(model, { OPENAI_GPT5_REASONING_EFFORT: "garbage" });
    assert.ok(supportedReasoningEfforts(model).includes(effort), `${model} got ${effort}`);
  }

  // Efforts only the dotted models offer must not leak onto the older ones.
  assert.equal(effortFor("gpt-5-mini", { OPENAI_GPT5_REASONING_EFFORT: "xhigh" }), "minimal");
  assert.equal(effortFor("gpt-5.6-luna", { OPENAI_GPT5_REASONING_EFFORT: "xhigh" }), "xhigh");
}

console.log("Recognition request contract tests passed");
