#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import healthHandler from "../api/health.js";
import {
  buildCanonicalFieldsRequest,
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_PROMPT_VERSION
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  buildCsmModelExecutionContract,
  buildCsmModelExecutionContractSha256,
  buildCsmModelProfile,
  csmExecutionContractImageUrls,
  compileCsmModelExecution,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_CANONICAL_REQUEST_BUILDER_VERSION,
  CSM_LUNA_MODEL_PROFILE,
  CSM_LUNA_OPTIMIZATION_PACK,
  CSM_LUNA_OPTIMIZATION_PACK_SHA256,
  CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_RECOGNITION_TRANSPORT_PROFILES,
  CSM_MODEL_EXECUTION_CONTRACT_LEGACY_VERSION,
  resolveCsmPromptAsset,
  sha256CsmRecognitionTransportReceipt,
  sha256ExecutionContractValue,
  sha256ProviderWireTemplate,
  sha256OptimizationPack,
  validateCsmModelExecutionContract
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { resolveCsmProviderAdapter } from "../lib/listing/thin/csm-provider-adapter.mjs";
import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";

function reorderedPack(pack) {
  return {
    resource_hints: {
      provider_timeout_ms: pack.resource_hints.provider_timeout_ms,
      estimated_tokens_per_attempt: pack.resource_hints.estimated_tokens_per_attempt
    },
    request_defaults: {
      sampling_parameters: pack.request_defaults.sampling_parameters,
      max_output_tokens: pack.request_defaults.max_output_tokens,
      image_detail: pack.request_defaults.image_detail,
      reasoning_effort: pack.request_defaults.reasoning_effort
    },
    model: pack.model,
    provider: pack.provider,
    id: pack.id
  };
}

assert.equal(
  sha256OptimizationPack(reorderedPack(CSM_LUNA_OPTIMIZATION_PACK)),
  CSM_LUNA_OPTIMIZATION_PACK_SHA256,
  "pack identity must ignore object insertion order"
);

for (const mutate of [
  (pack) => { pack.request_defaults.reasoning_effort = "none"; },
  (pack) => { pack.request_defaults.image_detail = "original"; },
  (pack) => { pack.request_defaults.max_output_tokens = 8_191; },
  (pack) => { pack.request_defaults.sampling_parameters = "future"; },
  (pack) => { pack.resource_hints.estimated_tokens_per_attempt = 6_499; },
  (pack) => { pack.resource_hints.provider_timeout_ms = 119_999; }
]) {
  const changed = structuredClone(CSM_LUNA_OPTIMIZATION_PACK);
  mutate(changed);
  assert.notEqual(
    sha256OptimizationPack(changed),
    CSM_LUNA_OPTIMIZATION_PACK_SHA256,
    "every effective Luna knob must change the canonical pack receipt"
  );
}

assert.equal(CSM_LUNA_MODEL_PROFILE.reasoning_effort, "low");
assert.equal(CSM_LUNA_MODEL_PROFILE.image_detail, "high");
assert.equal(CSM_LUNA_MODEL_PROFILE.max_output_tokens, 8_192);
assert.equal(CSM_LUNA_MODEL_PROFILE.estimated_tokens_per_attempt, 6_500);
assert.equal(CSM_LUNA_MODEL_PROFILE.provider_timeout_ms, 120_000);
assert.equal(CSM_LUNA_MODEL_PROFILE.optimization_pack_id, CSM_LUNA_OPTIMIZATION_PACK.id);
assert.equal(
  CSM_LUNA_MODEL_PROFILE.optimization_pack_sha256,
  CSM_LUNA_OPTIMIZATION_PACK_SHA256
);
assert.equal(Object.hasOwn(CSM_LUNA_MODEL_PROFILE, "transport_profile_id"), false);
assert.equal(Object.hasOwn(CSM_LUNA_OPTIMIZATION_PACK, "transport_profile_id"), false);
assert.equal(Object.hasOwn(CSM_LUNA_OPTIMIZATION_PACK, "request_extensions"), false);
assert.equal(CSM_LUNA_MODEL_PROFILE.prompt_style_version, CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  "Luna-specific behavior belongs in the removable pack until distinct prompt bytes pass a gate");
assert.deepEqual(resolveCsmPromptAsset(CSM_NEUTRAL_PROMPT_STYLE_VERSION), {
  semantic_prompt_version: CANONICAL_FIELDS_PROMPT_VERSION,
  rendered_prompt: CANONICAL_FIELDS_PROMPT
});
assert.throws(
  () => resolveCsmPromptAsset("luna-canonical-direct-v1"),
  /unsupported_prompt_style_version:luna-canonical-direct-v1/,
  "a cosmetic Luna alias must not change execution identity"
);
assert.throws(
  () => resolveCsmPromptAsset("unknown-prompt-style-v1"),
  /unsupported_prompt_style_version:unknown-prompt-style-v1/
);

const imageUrls = [
  "https://example.test/front.jpg",
  "https://example.test/back.jpg"
];
const compiled = compileCsmModelExecution({
  imageUrls,
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
});
const directRequest = buildCanonicalFieldsRequest({
  imageUrls,
  model: "gpt-5.6-luna",
  effort: "low",
  imageDetail: "high",
  maxOutputTokens: 8_192
});
assert.deepEqual(compiled.provider_request.wire_request, directRequest);
const wireBytes = JSON.stringify(compiled.provider_request.wire_request);
assert.equal(wireBytes.length, 11_185);
assert.equal(
  createHash("sha256").update(wireBytes).digest("hex"),
  "79ff68337c102f8263036747b52834e6f72beee7ff3c7634a8e37d66c3510b45",
  "extracting the Luna pack must not alter ordinary OpenAI request bytes"
);
for (const unsupported of ["temperature", "top_p", "seed"]) {
  assert.equal(Object.hasOwn(compiled.provider_request.wire_request, unsupported), false);
}
assert.equal(Object.hasOwn(compiled.provider_request.wire_request, "prompt_cache_key"), false);
assert.equal(Object.hasOwn(compiled.provider_request.wire_request.text, "verbosity"), false);
assert.equal(Object.hasOwn(compiled.provider_request.wire_request.reasoning, "context"), false);
const openAiAdapter = resolveCsmProviderAdapter("openai");
assert.throws(() => openAiAdapter.compileRequest({
  imageUrls,
  model: "gpt-5.6-luna",
  effort: "low",
  imageDetail: "high",
  maxOutputTokens: 8_192,
  samplingParameters: "temperature"
}), /openai_sampling_parameters_must_be_omitted/);
assert.equal(
  compiled.execution_contract.request_builder_version,
  CSM_CANONICAL_REQUEST_BUILDER_VERSION
);
assert.equal(compiled.execution_contract.optimization_pack_id, CSM_LUNA_OPTIMIZATION_PACK.id);
assert.equal(
  compiled.execution_contract.optimization_pack_sha256,
  CSM_LUNA_OPTIMIZATION_PACK_SHA256
);
assert.equal(
  compiled.execution_contract.rendered_prompt_sha256,
  sha256ExecutionContractValue(compiled.provider_request.rendered_prompt)
);
assert.equal(
  compiled.execution_contract.schema_sha256,
  sha256ExecutionContractValue(compiled.provider_request.schema)
);
assert.equal(
  compiled.execution_contract.wire_template_sha256,
  sha256ProviderWireTemplate(compiled.provider_request.wire_request)
);
const sameTemplateDifferentUrls = compileCsmModelExecution({
  imageUrls: ["https://different.test/one", "https://different.test/two"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
});
assert.equal(
  sameTemplateDifferentUrls.execution_contract.wire_template_sha256,
  compiled.execution_contract.wire_template_sha256,
  "ephemeral image URLs must not change the static provider template identity"
);
assert.notEqual(
  compileCsmModelExecution({
    imageUrls: [imageUrls[0]],
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
  })
    .execution_contract.wire_template_sha256,
  compiled.execution_contract.wire_template_sha256,
  "image-slot count must remain part of the provider template identity"
);
const changedStaticWire = structuredClone(compiled.provider_request.wire_request);
changedStaticWire.text.format.strict = false;
assert.notEqual(
  sha256ProviderWireTemplate(changedStaticWire),
  compiled.execution_contract.wire_template_sha256,
  "static wire changes must alter execution identity without relying on a manual version bump"
);

const baseDigest = compiled.execution_contract_sha256;
const legacyExecutionContract = {
  ...compiled.execution_contract,
  contract_version: CSM_MODEL_EXECUTION_CONTRACT_LEGACY_VERSION
};
delete legacyExecutionContract.transport_profile_sha256;
assert.deepEqual(
  validateCsmModelExecutionContract(legacyExecutionContract, {
    expectedSha256: sha256ExecutionContractValue(legacyExecutionContract)
  }),
  legacyExecutionContract,
  "historical v1 receipts remain self-validating and provider-incapable"
);
assert.throws(
  () => compileCsmModelExecution({ imageUrls }),
  /missing_recognition_transport_receipt/,
  "compile must receive the actual lane instead of inheriting a model-owned transport"
);
assert.throws(() => compileCsmModelExecution({
  imageUrls: [],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
}), /recognition_transport_image_count_invalid/);
assert.throws(() => compileCsmModelExecution({
  imageUrls,
  transportProfile: {
    ...CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    image_delivery: "data_url"
  }
}), /recognition_transport_receipt_mismatch/);
assert.throws(() => compileCsmModelExecution({
  imageUrls,
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  promptStyleVersion: "unknown-prompt-style-v1"
}), /unsupported_prompt_style_version:unknown-prompt-style-v1/);
assert.throws(() => compileCsmModelExecution({
  imageUrls,
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  renderedPrompt: `${CANONICAL_FIELDS_PROMPT} `
}), /prompt_asset_override_mismatch/);
assert.throws(() => compileCsmModelExecution({
  imageUrls,
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  capabilities: { ...CSM_LUNA_MODEL_PROFILE.capabilities, image_input: "bytes" }
}), /model_capability_image_input_incompatible/);
for (const change of [
  { requestedEffort: "none" },
  { imageDetail: "original" },
  { maxOutputTokens: 8_191 },
  { transportProfile: CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE }
]) {
  assert.notEqual(buildCsmModelExecutionContractSha256({
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    ...change,
    imageUrls
  }), baseDigest);
}
assert.deepEqual(csmExecutionContractImageUrls(2), [
  "https://execution-contract.invalid/image-1",
  "https://execution-contract.invalid/image-2"
]);
for (const invalidCount of [0, 3, 1.5, NaN]) {
  assert.throws(
    () => csmExecutionContractImageUrls(invalidCount),
    /execution_contract_image_count_invalid/
  );
}

const changedKnownPack = structuredClone(CSM_LUNA_OPTIMIZATION_PACK);
changedKnownPack.request_defaults.max_output_tokens = 8_191;
const mismatchedPackProfile = buildCsmModelProfile({
  id: "mismatched-pack-profile",
  provider: "openai",
  accountScope: "lynca-primary",
  model: "gpt-5.6-luna",
  promptStyleVersion: CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  optimizationPack: changedKnownPack,
  capabilities: CSM_LUNA_MODEL_PROFILE.capabilities
});
assert.throws(
  () => buildCsmModelExecutionContract({
    profile: mismatchedPackProfile,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(1)
  }),
  /model_optimization_pack_sha256_mismatch/
);

const unknownPack = structuredClone(CSM_LUNA_OPTIMIZATION_PACK);
unknownPack.id = "unknown-luna-pack-v1";
const unknownPackProfile = buildCsmModelProfile({
  id: "unknown-pack-profile",
  provider: "openai",
  accountScope: "lynca-primary",
  model: "gpt-5.6-luna",
  promptStyleVersion: CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  optimizationPack: unknownPack,
  capabilities: CSM_LUNA_MODEL_PROFILE.capabilities
});
assert.throws(
  () => buildCsmModelExecutionContract({
    profile: unknownPackProfile,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(1)
  }),
  /unsupported_model_optimization_pack:unknown-luna-pack-v1/
);
assert.throws(() => buildCsmModelProfile({
  id: "wrong-model-pack-profile",
  provider: "openai",
  accountScope: "lynca-primary",
  model: "future-model",
  promptStyleVersion: "canonical-direct-v1",
  optimizationPack: CSM_LUNA_OPTIMIZATION_PACK,
  capabilities: CSM_LUNA_MODEL_PROFILE.capabilities
}), /model_optimization_pack_profile_mismatch/);

const neutralProfile = buildCsmModelProfile({
  id: "openai-neutral-csm-v1",
  provider: "openai",
  accountScope: "lynca-primary",
  model: "future-model",
  promptStyleVersion: "canonical-direct-v1",
  optimizationPack: null,
  reasoningEffort: "none",
  imageDetail: "high",
  maxOutputTokens: 4_096,
  estimatedTokensPerAttempt: 4_000,
  providerTimeoutMs: 60_000,
  capabilities: {
    structured_output: "json_schema_strict",
    image_input: "url",
    image_detail: ["high"],
    sampling_parameters: "unsupported"
  }
});
const neutralContract = buildCsmModelExecutionContract({
  profile: neutralProfile,
  transportProfile: CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  imageUrls: csmExecutionContractImageUrls(1)
});
assert.equal(neutralContract.optimization_pack_id, null);
assert.equal(neutralContract.optimization_pack_sha256, null);
assert.equal(neutralContract.model, "future-model");
assert.equal(neutralContract.requested_effort, "none");
assert.notEqual(
  sha256ExecutionContractValue(neutralContract),
  compiled.execution_contract_sha256,
  "detaching the Luna pack must produce a distinct neutral execution identity"
);

let healthBody = null;
healthHandler({ method: "GET" }, {
  statusCode: 0,
  setHeader() {},
  end(body) { healthBody = JSON.parse(body); }
});
assert.deepEqual(healthBody.runtime.optimization_pack, {
  id: CSM_LUNA_OPTIMIZATION_PACK.id,
  sha256: CSM_LUNA_OPTIMIZATION_PACK_SHA256
});
assert.equal(
  healthBody.runtime.request_builder_version,
  CSM_CANONICAL_REQUEST_BUILDER_VERSION
);
assert.deepEqual(
  healthBody.runtime.recognition_transport_profiles,
  Object.fromEntries(CSM_RECOGNITION_TRANSPORT_PROFILES.map((profile) => [
    profile.lane_version,
    { ...profile, sha256: sha256CsmRecognitionTransportReceipt(profile) }
  ]))
);
assert.deepEqual(
  healthBody.runtime.external_identity,
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  "health must expose the exact active pack, index, resolution and Registry release receipts"
);
for (const receipt of [
  healthBody.runtime.external_identity.support_pack.sha256,
  healthBody.runtime.external_identity.index.sha256,
  healthBody.runtime.external_identity.resolution_contract.sha256,
  healthBody.runtime.external_identity.registry_release.content_sha256
]) assert.match(receipt, /^[a-f0-9]{64}$/);
assert.equal(
  healthBody.runtime.provider_timeout_ms,
  CSM_LUNA_OPTIMIZATION_PACK.resource_hints.provider_timeout_ms
);
assert.deepEqual(
  healthBody.runtime.execution_contract_sha256_by_transport_lane_and_image_count,
  Object.fromEntries(CSM_RECOGNITION_TRANSPORT_PROFILES.map((profile) => [
    profile.lane_version,
    Object.fromEntries([1, 2].map((count) => [
      String(count),
      buildCsmModelExecutionContractSha256({
        transportProfile: profile,
        imageUrls: csmExecutionContractImageUrls(count)
      })
    ]))
  ])),
  "health must advertise each supported lane's exact one- and two-image execution identities"
);
assert.equal(
  healthBody.capacity.estimated_tokens_per_attempt,
  CSM_LUNA_OPTIMIZATION_PACK.resource_hints.estimated_tokens_per_attempt
);
for (const cosmeticCounter of ["cloud_run_calls", "vector_calls", "generic_ocr_calls"]) {
  assert.equal(
    Object.hasOwn(healthBody.runtime, cosmeticCounter),
    false,
    "health must not present a static configuration constant as a measured call count"
  );
}
assert.equal(typeof healthBody.runtime.retired_capabilities_disabled, "boolean");

console.log("csm-model-optimization-pack tests passed");
