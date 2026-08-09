import { createHash } from "node:crypto";

import {
  CANONICAL_FIELDS_SCHEMA,
  CANONICAL_IMAGE_DETAILS
} from "./canonical-fields.mjs";
import {
  resolveCsmModelOptimizationPack,
  sha256OptimizationPack
} from "./csm-model-optimization-pack.mjs";
import {
  CSM_ACTIVE_MODEL_PROFILE,
  CSM_LUNA_MODEL_PROFILE
} from "./csm-model-profile.mjs";
import { resolveCsmProviderAdapter } from "./csm-provider-adapter.mjs";
import {
  resolveCsmPromptAsset,
  CSM_NEUTRAL_PROMPT_STYLE_VERSION
} from "./csm-prompt-assets.mjs";
import {
  resolveCsmRecognitionTransportReceipt,
  sha256CsmRecognitionTransportReceipt,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_RECOGNITION_TRANSPORT_PROFILES,
  CSM_STAGED_TRANSPORT_PROFILE
} from "./csm-recognition-transport.mjs";

export { CSM_ACTIVE_MODEL_PROFILE, CSM_LUNA_MODEL_PROFILE } from "./csm-model-profile.mjs";
export { buildCsmModelProfile } from "./csm-model-profile.mjs";
export {
  CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  resolveCsmPromptAsset
} from "./csm-prompt-assets.mjs";
export {
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_RECOGNITION_TRANSPORT_PROFILES,
  CSM_STAGED_TRANSPORT_PROFILE,
  resolveCsmRecognitionTransportReceipt,
  sha256CsmRecognitionTransportReceipt
} from "./csm-recognition-transport.mjs";
export {
  CSM_LUNA_OPTIMIZATION_PACK,
  CSM_LUNA_OPTIMIZATION_PACK_SHA256,
  sha256OptimizationPack
} from "./csm-model-optimization-pack.mjs";
export {
  CSM_CANONICAL_REQUEST_BUILDER_VERSION,
  CSM_CANONICAL_RESPONSE_PARSER_VERSION,
  CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  CSM_OPENAI_RESPONSES_ADAPTER_VERSION
} from "./csm-provider-adapter.mjs";

export const CSM_MODEL_EXECUTION_CONTRACT_VERSION = "csm-model-execution-v2";
export const CSM_MODEL_EXECUTION_CONTRACT_LEGACY_VERSION = "csm-model-execution-v1";

const CSM_MODEL_EXECUTION_CONTRACT_V1_KEYS = Object.freeze([
  "contract_version",
  "model_profile_id",
  "account_scope",
  "model_profile_sha256",
  "optimization_pack_id",
  "optimization_pack_sha256",
  "transport_profile_id",
  "provider",
  "provider_adapter_version",
  "provider_adapter_sha256",
  "request_builder_version",
  "response_parser_version",
  "model",
  "requested_effort",
  "image_detail",
  "max_output_tokens",
  "sampling_parameters",
  "semantic_prompt_version",
  "prompt_style_version",
  "rendered_prompt_sha256",
  "schema_sha256",
  "wire_template_sha256",
  "capabilities_sha256"
]);
const CSM_MODEL_EXECUTION_CONTRACT_KEYS = Object.freeze([
  ...CSM_MODEL_EXECUTION_CONTRACT_V1_KEYS,
  "transport_profile_sha256"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requiredText(value, name) {
  if (typeof value !== "string") throw new TypeError(`invalid_${name}`);
  const text = value.trim();
  if (!text) throw new TypeError(`missing_${name}`);
  return text;
}

function requiredContent(value, name) {
  if (typeof value !== "string") throw new TypeError(`invalid_${name}`);
  const content = value;
  if (!content.trim()) throw new TypeError(`missing_${name}`);
  return content;
}

function positiveInteger(value, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`invalid_${name}`);
  }
  return value;
}

function exactPlainObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

const CSM_MODEL_CAPABILITY_KEYS = Object.freeze([
  "structured_output",
  "image_input",
  "image_detail",
  "sampling_parameters"
]);

function validatedDispatchCapabilities(value, { imageDetail, samplingParameters } = {}) {
  if (!exactPlainObject(value, CSM_MODEL_CAPABILITY_KEYS)) {
    throw new TypeError("model_capabilities_shape_invalid");
  }
  if (value.structured_output !== "json_schema_strict") {
    throw new TypeError("model_capability_structured_output_incompatible");
  }
  if (value.image_input !== "url") {
    throw new TypeError("model_capability_image_input_incompatible");
  }
  if (!Array.isArray(value.image_detail)
      || value.image_detail.length < 1
      || new Set(value.image_detail).size !== value.image_detail.length
      || value.image_detail.some((detail) => !CANONICAL_IMAGE_DETAILS.includes(detail))
      || !value.image_detail.includes(imageDetail)) {
    throw new TypeError("model_capability_image_detail_incompatible");
  }
  if (value.sampling_parameters !== "unsupported" || samplingParameters !== "omit") {
    throw new TypeError("model_capability_sampling_parameters_incompatible");
  }
  return Object.freeze({
    structured_output: value.structured_output,
    image_input: value.image_input,
    image_detail: Object.freeze([...value.image_detail]),
    sampling_parameters: value.sampling_parameters
  });
}

function canonicalText(value, name, { lowercase = false } = {}) {
  const text = requiredText(value, name);
  const canonical = lowercase ? text.toLowerCase() : text;
  if (value !== canonical) throw new TypeError(`noncanonical_${name}`);
  return canonical;
}

function requiredSha256(value, name) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`invalid_${name}`);
  }
  return value;
}

function nullableCanonicalText(value, name) {
  return value === null ? null : canonicalText(value, name);
}

function nullableSha256(value, name) {
  return value === null ? null : requiredSha256(value, name);
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("execution_contract_value_not_plain");
    }
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError("execution_contract_value_undefined");
      return [key, canonicalValue(value[key])];
    }));
  }
  throw new TypeError("execution_contract_value_invalid");
}

export function canonicalExecutionContractJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256ExecutionContractValue(value) {
  const input = typeof value === "string" ? value : canonicalExecutionContractJson(value);
  return createHash("sha256").update(input).digest("hex");
}

export function csmExecutionContractImageUrls(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 2) {
    throw new TypeError("execution_contract_image_count_invalid");
  }
  return Object.freeze(Array.from(
    { length: count },
    (_, index) => `https://execution-contract.invalid/image-${index + 1}`
  ));
}

/**
 * Hash the exact provider request template without binding ephemeral signed
 * image URLs into the execution identity. Array order and object insertion
 * order are intentionally preserved because they determine the bytes sent by
 * JSON.stringify. Ordered image content is bound separately by recognition
 * fingerprints; these placeholders only preserve each image slot.
 */
export function sha256ProviderWireTemplate(wireRequest) {
  if (!wireRequest || typeof wireRequest !== "object" || Array.isArray(wireRequest)) {
    throw new TypeError("provider_wire_request_invalid");
  }
  const template = structuredClone(wireRequest);
  let imageIndex = 0;
  for (const input of Array.isArray(template.input) ? template.input : []) {
    for (const part of Array.isArray(input?.content) ? input.content : []) {
      if (part?.type !== "input_image") continue;
      if (typeof part.image_url !== "string" || !part.image_url) {
        throw new TypeError("provider_wire_image_url_invalid");
      }
      part.image_url = `__LYNCA_IMAGE_SLOT_${imageIndex}__`;
      imageIndex += 1;
    }
  }
  return createHash("sha256").update(JSON.stringify(template)).digest("hex");
}

/**
 * Validate a durable execution identity without consulting today's active
 * profile or adapter registry. A settled checkpoint is historical evidence:
 * it must be exact and self-consistent, but it must not be relabelled or
 * rejected merely because a later deployment selected another model profile.
 */
export function validateCsmModelExecutionContract(value, {
  expectedSha256 = null
} = {}) {
  const contractVersion = canonicalText(value?.contract_version, "contract_version");
  const expectedKeys = contractVersion === CSM_MODEL_EXECUTION_CONTRACT_VERSION
    ? CSM_MODEL_EXECUTION_CONTRACT_KEYS
    : contractVersion === CSM_MODEL_EXECUTION_CONTRACT_LEGACY_VERSION
      ? CSM_MODEL_EXECUTION_CONTRACT_V1_KEYS
      : null;
  if (!expectedKeys) throw new TypeError("execution_contract_version_unsupported");
  if (!exactPlainObject(value, expectedKeys)) {
    throw new TypeError("execution_contract_shape_invalid");
  }
  const contract = {
    contract_version: contractVersion,
    model_profile_id: canonicalText(value.model_profile_id, "model_profile_id"),
    account_scope: canonicalText(value.account_scope, "account_scope"),
    model_profile_sha256: requiredSha256(
      value.model_profile_sha256,
      "model_profile_sha256"
    ),
    optimization_pack_id: nullableCanonicalText(
      value.optimization_pack_id,
      "optimization_pack_id"
    ),
    optimization_pack_sha256: nullableSha256(
      value.optimization_pack_sha256,
      "optimization_pack_sha256"
    ),
    transport_profile_id: canonicalText(
      value.transport_profile_id,
      "transport_profile_id"
    ),
    ...(contractVersion === CSM_MODEL_EXECUTION_CONTRACT_VERSION ? {
      transport_profile_sha256: requiredSha256(
        value.transport_profile_sha256,
        "transport_profile_sha256"
      )
    } : {}),
    provider: canonicalText(value.provider, "provider", { lowercase: true }),
    provider_adapter_version: canonicalText(
      value.provider_adapter_version,
      "provider_adapter_version"
    ),
    provider_adapter_sha256: requiredSha256(
      value.provider_adapter_sha256,
      "provider_adapter_sha256"
    ),
    request_builder_version: canonicalText(
      value.request_builder_version,
      "request_builder_version"
    ),
    response_parser_version: canonicalText(
      value.response_parser_version,
      "response_parser_version"
    ),
    model: canonicalText(value.model, "model"),
    requested_effort: canonicalText(value.requested_effort, "requested_effort", {
      lowercase: true
    }),
    image_detail: canonicalText(value.image_detail, "image_detail", { lowercase: true }),
    max_output_tokens: positiveInteger(value.max_output_tokens, "max_output_tokens"),
    sampling_parameters: canonicalText(
      value.sampling_parameters,
      "sampling_parameters",
      { lowercase: true }
    ),
    semantic_prompt_version: canonicalText(
      value.semantic_prompt_version,
      "semantic_prompt_version"
    ),
    prompt_style_version: canonicalText(
      value.prompt_style_version,
      "prompt_style_version"
    ),
    rendered_prompt_sha256: requiredSha256(
      value.rendered_prompt_sha256,
      "rendered_prompt_sha256"
    ),
    schema_sha256: requiredSha256(value.schema_sha256, "schema_sha256"),
    wire_template_sha256: requiredSha256(
      value.wire_template_sha256,
      "wire_template_sha256"
    ),
    capabilities_sha256: requiredSha256(
      value.capabilities_sha256,
      "capabilities_sha256"
    )
  };
  if (!CANONICAL_IMAGE_DETAILS.includes(contract.image_detail)) {
    throw new TypeError("invalid_image_detail");
  }
  if ((contract.optimization_pack_id === null)
      !== (contract.optimization_pack_sha256 === null)) {
    throw new TypeError("execution_contract_optimization_pack_receipt_incomplete");
  }
  if (expectedSha256 !== null) {
    const expected = requiredSha256(expectedSha256, "execution_contract_sha256");
    if (sha256ExecutionContractValue(contract) !== expected) {
      throw new TypeError("execution_contract_sha256_mismatch");
    }
  }
  return deepFreeze(contract);
}

/**
 * Exact paid-execution identity for a canonical-fields call.
 *
 * CSM/SEM, schema ownership, Resolver and Composer stay outside the model
 * profile. The schema and rendered prompt are hashed here only because a paid
 * checkpoint must never be replayed under different bytes that happen to keep
 * the same human-readable version label.
 */
function compileCsmModelExecutionArtifacts({
  profile = CSM_ACTIVE_MODEL_PROFILE,
  provider = profile?.provider,
  accountScope = profile?.account_scope,
  providerAdapterVersion = null,
  responseParserVersion = null,
  model = profile?.model,
  requestedEffort = profile?.reasoning_effort,
  imageDetail = profile?.image_detail,
  maxOutputTokens = profile?.max_output_tokens,
  semanticPromptVersion = null,
  renderedPrompt = null,
  schema = CANONICAL_FIELDS_SCHEMA,
  promptStyleVersion = profile?.prompt_style_version,
  capabilities = profile?.capabilities,
  providerAdapterContract = null,
  transportProfile = null,
  imageUrls = [],
  requireActiveAdapter = false
} = {}) {
  const resolvedAdapter = resolveCsmProviderAdapter(provider);
  const resolvedAdapterContract = providerAdapterContract || resolvedAdapter.contract;
  if (requireActiveAdapter && providerAdapterContract
      && providerAdapterContract !== resolvedAdapter.contract) {
    throw new TypeError("provider_adapter_override_not_dispatchable");
  }
  const effectiveProvider = requiredText(provider, "provider").toLowerCase();
  const effectiveModel = requiredText(model, "model");
  const effectivePromptStyleVersion = canonicalText(promptStyleVersion, "prompt_style_version");
  const promptAsset = resolveCsmPromptAsset(effectivePromptStyleVersion);
  if (semanticPromptVersion !== null
      && semanticPromptVersion !== promptAsset.semantic_prompt_version) {
    throw new TypeError("prompt_asset_semantic_version_mismatch");
  }
  if (renderedPrompt !== null && renderedPrompt !== promptAsset.rendered_prompt) {
    throw new TypeError("prompt_asset_override_mismatch");
  }
  if (transportProfile === null) {
    throw new TypeError("missing_recognition_transport_receipt");
  }
  const recognitionTransport = resolveCsmRecognitionTransportReceipt(transportProfile);
  if (!Array.isArray(imageUrls)
      || imageUrls.length < 1
      || imageUrls.length > recognitionTransport.maximum_images) {
    throw new TypeError("recognition_transport_image_count_invalid");
  }
  const optimizationPack = resolveCsmModelOptimizationPack({
    id: profile?.optimization_pack_id ?? null,
    sha256: profile?.optimization_pack_sha256 ?? null,
    provider: effectiveProvider,
    model: effectiveModel
  });
  const providerRequest = resolvedAdapter.compileRequest({
    imageUrls,
    model: effectiveModel,
    effort: requiredText(requestedEffort, "requested_effort").toLowerCase(),
    imageDetail: requiredText(imageDetail, "image_detail").toLowerCase(),
    maxOutputTokens: positiveInteger(maxOutputTokens, "max_output_tokens"),
    prompt: requiredContent(promptAsset.rendered_prompt, "rendered_prompt"),
    schema,
    samplingParameters: optimizationPack?.request_defaults.sampling_parameters || "omit"
  });
  const detail = requiredText(providerRequest.image_detail, "image_detail").toLowerCase();
  if (!CANONICAL_IMAGE_DETAILS.includes(detail)) throw new TypeError("invalid_image_detail");
  const dispatchCapabilities = validatedDispatchCapabilities(capabilities, {
    imageDetail: detail,
    samplingParameters: providerRequest.sampling_parameters
  });
  const profileReceipt = {
    id: requiredText(profile?.id, "model_profile_id"),
    account_scope: requiredText(accountScope, "account_scope"),
    provider: effectiveProvider,
    model: requiredText(providerRequest.model, "model"),
    requested_effort: requiredText(
      providerRequest.requested_effort,
      "requested_effort"
    ).toLowerCase(),
    image_detail: detail,
    max_output_tokens: positiveInteger(
      providerRequest.max_output_tokens,
      "max_output_tokens"
    ),
    prompt_style_version: effectivePromptStyleVersion,
    optimization_pack_id: optimizationPack?.id || null,
    optimization_pack_sha256: optimizationPack
      ? sha256OptimizationPack(optimizationPack)
      : null,
    estimated_tokens_per_attempt: positiveInteger(
      profile?.estimated_tokens_per_attempt,
      "estimated_tokens_per_attempt"
    ),
    provider_timeout_ms: positiveInteger(
      profile?.provider_timeout_ms,
      "provider_timeout_ms"
    ),
    capabilities: dispatchCapabilities
  };
  // Canonicalize now so mutable/non-plain/undefined capability declarations
  // fail before a provider operation is admitted.
  const capabilitiesSha256 = sha256ExecutionContractValue(profileReceipt.capabilities);
  const profileSha256 = sha256ExecutionContractValue(profileReceipt);
  const adapterVersion = requiredText(
    providerAdapterVersion || resolvedAdapterContract?.id,
    "provider_adapter_version"
  );
  const parserVersion = requiredText(
    responseParserVersion || resolvedAdapterContract?.response_parser_version,
    "response_parser_version"
  );
  const requestBuilderVersion = requiredText(
    resolvedAdapterContract?.request_builder_version,
    "request_builder_version"
  );
  if (resolvedAdapter.provider !== profileReceipt.provider
      || resolvedAdapterContract?.provider !== profileReceipt.provider
      || resolvedAdapterContract?.id !== adapterVersion
      || providerRequest.provider !== profileReceipt.provider
      || providerRequest.request_builder_version !== requestBuilderVersion
      || resolvedAdapterContract?.response_parser_version !== parserVersion) {
    throw new TypeError("provider_adapter_contract_mismatch");
  }
  const providerAdapterSha256 = sha256ExecutionContractValue(resolvedAdapterContract);
  const executionContract = validateCsmModelExecutionContract({
    contract_version: CSM_MODEL_EXECUTION_CONTRACT_VERSION,
    model_profile_id: profileReceipt.id,
    account_scope: profileReceipt.account_scope,
    model_profile_sha256: profileSha256,
    optimization_pack_id: profileReceipt.optimization_pack_id,
    optimization_pack_sha256: profileReceipt.optimization_pack_sha256,
    transport_profile_id: recognitionTransport.id,
    transport_profile_sha256: sha256CsmRecognitionTransportReceipt(recognitionTransport),
    provider: profileReceipt.provider,
    provider_adapter_version: adapterVersion,
    provider_adapter_sha256: providerAdapterSha256,
    request_builder_version: requestBuilderVersion,
    response_parser_version: parserVersion,
    model: profileReceipt.model,
    requested_effort: profileReceipt.requested_effort,
    image_detail: profileReceipt.image_detail,
    max_output_tokens: profileReceipt.max_output_tokens,
    sampling_parameters: requiredText(
      providerRequest.sampling_parameters,
      "sampling_parameters"
    ).toLowerCase(),
    semantic_prompt_version: promptAsset.semantic_prompt_version,
    prompt_style_version: profileReceipt.prompt_style_version,
    rendered_prompt_sha256: sha256ExecutionContractValue(
      requiredContent(providerRequest.rendered_prompt, "rendered_prompt")
    ),
    schema_sha256: sha256ExecutionContractValue(providerRequest.schema),
    wire_template_sha256: sha256ProviderWireTemplate(providerRequest.wire_request),
    capabilities_sha256: capabilitiesSha256
  });
  return Object.freeze({
    provider_request: providerRequest,
    execution_contract: executionContract,
    execution_contract_sha256: sha256ExecutionContractValue(executionContract)
  });
}

export function buildCsmModelExecutionContract(options = {}) {
  return compileCsmModelExecutionArtifacts(options).execution_contract;
}

/**
 * Production compile seam: the frozen request returned here is the request
 * that must be dispatched. Its exact prompt, schema and request-builder
 * version produced the adjacent durable execution contract in the same call.
 */
export function compileCsmModelExecution(options = {}) {
  return compileCsmModelExecutionArtifacts({
    ...options,
    providerAdapterContract: null,
    requireActiveAdapter: true
  });
}

export function buildCsmModelExecutionContractSha256(options = {}) {
  return sha256ExecutionContractValue(buildCsmModelExecutionContract(options));
}
