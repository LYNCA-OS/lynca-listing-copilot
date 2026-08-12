#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  buildLegacyCurrentLunaDirectPayloadHash,
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash,
  buildLegacyLowLunaDirectPayloadHash,
  classifyLunaDirectFailure,
  createLunaDirectDispatcher,
  definitive502TransportRetryEligible,
  lunaRetryDelayMs,
  retryAfterMs,
  validateDefinitive502TransportRetryReceipt
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";
import {
  buildCanonicalFieldsRequest,
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_PROMPT_VERSION,
  CANONICAL_FIELDS_SCHEMA
} from "../lib/listing/thin/canonical-fields.mjs";
import {
  buildCsmModelExecutionContract,
  buildCsmModelExecutionContractSha256,
  canonicalExecutionContractJson,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_CANONICAL_RESPONSE_PARSER_VERSION,
  CSM_LUNA_MODEL_PROFILE,
  CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  sha256ExecutionContractValue
} from "../lib/listing/thin/csm-model-execution-contract.mjs";

const TEST_EXECUTION_SHA256 = "d".repeat(64);
const FUTURE_EXECUTION_SHA256 = "e".repeat(64);

const dispatcherSource = await readFile(
  new URL("../lib/listing/thin/luna-direct-dispatcher.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  dispatcherSource,
  /(?:listing-job|provider-status|cloud\s*run|recognition-worker|vector|ocr)/i,
  "the Luna dispatcher must remain an isolated direct path"
);

function task(assetId, overrides = {}) {
  const imageSha256 = createHash("sha256").update(String(assetId)).digest("hex");
  return {
    tenant_id: "tenant-1",
    intent_id: "intent-1",
    asset_id: assetId,
    model: "gpt-5.6-luna",
    detail: "high",
    reasoning_effort: "low",
    prompt_version: "csm-canonical-fields-v1",
    estimated_tokens: 5_262,
    image_urls: [`https://example.test/${assetId}.jpg`],
    image_fingerprints: [`sha256:${imageSha256}`],
    recognition_fingerprints: [`sha256:${imageSha256}`],
    execution_contract_sha256: TEST_EXECUTION_SHA256,
    ...overrides
  };
}

function deterministicClientRequestId(operationKey, payloadHash, attempt) {
  return `lynca-${createHash("sha256")
    .update(`${operationKey}\u0000${payloadHash}\u0000${attempt}`)
    .digest("hex")}`;
}

function definitive502Failure(payload, overrides = {}) {
  const providerClientRequestId = deterministicClientRequestId(
    payload.operation_key,
    payload.payload_hash,
    1
  );
  const failureResult = {
    error_name: "CanonicalProviderError",
    status: 502,
    actual_tokens: null,
    ambiguous: false,
    returned_http_response: true,
    response_body_complete: true,
    provider_output_present: false,
    provider_contract_failure: false,
    provider_business_failure: false,
    definitive_response: true,
    safe_to_retry: true,
    provider_request_id: "req-definitive-502",
    provider_client_request_id: providerClientRequestId,
    provider_error_code: "server_error",
    provider_error_type: "server_error",
    provider_error_param: null,
    provider_ms: 120,
    ...overrides.failureResult
  };
  const providerFailureSettlement = {
    operation_key_sha256: createHash("sha256").update(payload.operation_key).digest("hex"),
    payload_sha256: payload.payload_hash,
    attempt: 1,
    attempt_class: "fresh",
    estimated_tokens: payload.estimated_tokens,
    settle_code: "settled",
    operation_status: "FAILED",
    ...overrides.providerFailureSettlement
  };
  return Object.assign(new Error("definitive provider 502"), {
    name: "CsmProviderAdmissionError",
    status: 502,
    statusCode: 502,
    retryable: true,
    ambiguous: false,
    provider_attempt_started: true,
    returned_http_response: true,
    response_body_complete: true,
    provider_output_present: false,
    provider_contract_failure: false,
    provider_business_failure: false,
    definitive_response: true,
    safe_to_retry: true,
    provider_failure_result: failureResult,
    provider_failure_settlement: providerFailureSettlement,
    ...overrides.error
  });
}

// The staged execution receipt binds every byte/policy that can change a paid
// result. The ordinary operation key remains byte-for-byte compatible while
// its new payload hash becomes execution-bound.
{
  const normal = task("asset-1");
  assert.equal(
    buildLunaDirectOperationKey(normal),
    "luna-direct:v2:7547a2302c7d67f88b8e3bcccb1a119f524a1f403cb1f35eb5cb8d7255a98081"
  );
  assert.equal(
    buildLunaDirectPayloadHash(normal),
    "2b75511adf93d9bce0735a657b0d2aebd732bce78437eaded11055b70ba1bd8d"
  );
  const request = buildCanonicalFieldsRequest({
    imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
    model: "gpt-5.6-luna",
    effort: "low",
    imageDetail: "high"
  });
  assert.deepEqual(request.tools, [{ type: "web_search" }]);
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.max_tool_calls, 2);
  assert.deepEqual(request.include, ["web_search_call.action.sources"]);
  const requestBytes = JSON.stringify(request);
  assert.equal(requestBytes.length, 12_778);
  assert.equal(
    createHash("sha256").update(requestBytes).digest("hex"),
    "8b14694f8ea9e506c4327f825a79c40f81c6707ff4b87d841f090b36b37e6b1d"
  );

  const baseOptions = {
    model: "gpt-5.6-luna",
    requestedEffort: "low",
    imageDetail: "high",
    maxOutputTokens: 8192,
    semanticPromptVersion: CANONICAL_FIELDS_PROMPT_VERSION,
    renderedPrompt: CANONICAL_FIELDS_PROMPT,
    schema: CANONICAL_FIELDS_SCHEMA,
    promptStyleVersion: "canonical-direct-v1",
    providerAdapterVersion: "openai-responses-v1",
    responseParserVersion: CSM_CANONICAL_RESPONSE_PARSER_VERSION,
    capabilities: CSM_LUNA_MODEL_PROFILE.capabilities,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: ["https://execution-contract.invalid/image-1"],
    providerAdapterContract: CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT
  };
  const baseDigest = buildCsmModelExecutionContractSha256(baseOptions);
  assert.match(baseDigest, /^[0-9a-f]{64}$/);
  assert.throws(
    () => buildCsmModelExecutionContract({ ...baseOptions, provider: "future-provider" }),
    /unsupported_csm_provider:future-provider/,
    "an unregistered provider must fail before health or a paid execution can claim readiness"
  );
  assert.throws(
    () => buildCsmModelExecutionContract({ ...baseOptions, model: "future-model" }),
    /model_optimization_pack_model_mismatch/,
    "a Luna pack cannot silently label a different model"
  );
  for (const change of [
    { requestedEffort: "none" },
    { imageDetail: "original" },
    { maxOutputTokens: 8191 },
    { schema: { ...CANONICAL_FIELDS_SCHEMA, description: "changed" } },
    { transportProfile: CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE },
    {
      providerAdapterVersion: "openai-responses-v2",
      providerAdapterContract: {
        ...CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
        id: "openai-responses-v2"
      }
    },
    {
      responseParserVersion: "canonical-output-v3",
      providerAdapterContract: {
        ...CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
        response_parser_version: "canonical-output-v3"
      }
    },
    {
      providerAdapterContract: {
        ...CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
        served_effort_receipt: {
          ...CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.served_effort_receipt,
          required: false,
          missing_policy: "requested_effort_fallback",
          attested_when_present: false
        }
      }
    }
  ]) {
    assert.notEqual(buildCsmModelExecutionContractSha256({ ...baseOptions, ...change }), baseDigest);
  }
  for (const change of [
    { semanticPromptVersion: "csm-canonical-fields-v2" },
    { renderedPrompt: `${CANONICAL_FIELDS_PROMPT} ` },
    { promptStyleVersion: "luna-canonical-direct-v2" },
    { capabilities: { ...CSM_LUNA_MODEL_PROFILE.capabilities, sampling_parameters: "future" } }
  ]) {
    assert.throws(
      () => buildCsmModelExecutionContractSha256({ ...baseOptions, ...change }),
      /prompt_asset_|unsupported_prompt_style_version|model_capability_/
    );
  }
  assert.equal(
    canonicalExecutionContractJson({ z: 1, a: { y: 2, b: 3 } }),
    '{"a":{"b":3,"y":2},"z":1}'
  );
  assert.equal(
    sha256ExecutionContractValue({ z: 1, a: { y: 2, b: 3 } }),
    sha256ExecutionContractValue({ a: { b: 3, y: 2 }, z: 1 }),
    "object insertion order must not change the execution identity"
  );
  const receipt = buildCsmModelExecutionContract(baseOptions);
  assert.equal(
    receipt.rendered_prompt_sha256,
    createHash("sha256").update(CANONICAL_FIELDS_PROMPT).digest("hex")
  );
  assert.equal(
    CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.served_effort_receipt.missing_policy,
    "null",
    "a missing provider echo must stay UNKNOWN instead of copying requested effort"
  );
  assert.equal(
    CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.served_effort_receipt.attested_when_present,
    true,
    "served effort is attested only by a non-empty provider echo"
  );
}

const TEST_ONLY_SINGLE_PROCESS_ADMISSION = Object.freeze({
  enqueueAttempt: async (metadata) => metadata,
  runAttempt: async ({ queuedAttempt, execute }) => {
    await queuedAttempt;
    return execute();
  }
});

function createTestDispatcher(options) {
  return createLunaDirectDispatcher({
    providerAdmission: TEST_ONLY_SINGLE_PROCESS_ADMISSION,
    ...options
  });
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

assert.throws(
  () => createLunaDirectDispatcher({ executeTask: async () => ({ ok: true }) }),
  /invalid_csm_direct_concurrency/,
  "production capacity must be supplied by the Luna pool, never inherited from a legacy default"
);
assert.throws(
  () => createLunaDirectDispatcher({
    csmDirectConcurrency: 1,
    executeTask: async () => ({ ok: true })
  }),
  /missing_luna_global_attempt_admission/,
  "a dispatcher may not bypass the per-physical-attempt global capacity boundary"
);

// The already-deployed ordinary operation key is now a permanent logical key:
// only tenant/intent/asset change it. Every paid-execution change moves the
// payload hash instead, so an upgrade conflicts under the same authority row.
{
  const first = buildLunaDirectOperationKey(task("asset-1"));
  const same = buildLunaDirectOperationKey({ ...task("asset-1"), image_urls: ["https://rotated.test/front.jpg"] });
  assert.equal(first, same);
  assert.match(first, /^luna-direct:v2:[0-9a-f]{64}$/);
  for (const change of [
    { tenant_id: "tenant-2" },
    { intent_id: "intent-2" },
    { asset_id: "asset-2" }
  ]) {
    assert.notEqual(buildLunaDirectOperationKey(task("asset-1", change)), first);
  }
  for (const change of [
    { model: "gpt-5.6-luna-next", execution_contract_sha256: FUTURE_EXECUTION_SHA256 },
    { detail: "original", execution_contract_sha256: FUTURE_EXECUTION_SHA256 },
    { prompt_version: "csm-canonical-fields-v2", execution_contract_sha256: FUTURE_EXECUTION_SHA256 },
    { reasoning_effort: "none", execution_contract_sha256: FUTURE_EXECUTION_SHA256 }
  ]) {
    const changed = task("asset-1", change);
    assert.equal(buildLunaDirectOperationKey(changed), first);
    assert.notEqual(buildLunaDirectPayloadHash(changed), buildLunaDirectPayloadHash(task("asset-1")));
  }
  assert.equal(
    buildLunaDirectOperationKey(task("asset-1", { detail: " HIGH " })),
    first,
    "detail normalization must not create a second operation"
  );
  assert.equal(buildLunaDirectPayloadHash(task("asset-1")).length, 64);
  assert.equal(
    buildLunaDirectOperationKey(task("asset-1", {
      reasoning_effort: "none",
      execution_contract_sha256: FUTURE_EXECUTION_SHA256
    })),
    first,
    "an effort deployment must retain the durable user operation identity"
  );
  assert.notEqual(
    buildLunaDirectPayloadHash(task("asset-1", {
      reasoning_effort: "none",
      execution_contract_sha256: FUTURE_EXECUTION_SHA256
    })),
    buildLunaDirectPayloadHash(task("asset-1")),
    "but the execution payload must fail closed rather than replay a different effort"
  );
  assert.equal(
    buildLegacyLowLunaDirectPayloadHash(task("asset-1")),
    "bcf1201acc0a256d8e86c3b7d273fa518ac3fe4cd63d8c2642c5fefa4e09ffdd",
    "legacy recovery must reproduce the exact pre-effort payload digest"
  );
  assert.equal(
    buildLegacyCurrentLunaDirectPayloadHash(task("asset-1")),
    "01b2f42445985e06c04f6d05c56fb5f7cc41cff1ac4348d48143129899cc9fe2"
  );
  assert.throws(
    () => buildLunaDirectOperationKey(task("asset-1", { reasoning_effort: undefined })),
    /missing_reasoning_effort/,
    "callers must bind the actual effort instead of inheriting a hidden default"
  );
  assert.equal(
    buildLunaDirectPayloadHash(task("asset-1")),
    buildLunaDirectPayloadHash({ ...task("asset-1"), image_urls: ["https://rotated.test/front.jpg"] }),
    "short-lived signed URLs are outside durable payload identity"
  );
  const stableMaterial = task("asset-1");
  assert.equal(
    buildLunaDirectPayloadHash(stableMaterial),
    buildLunaDirectPayloadHash({
      ...stableMaterial,
      image_urls: ["https://newly-signed.test/front.jpg"]
    }),
    "short-lived signed URL rotation must not create a second durable operation"
  );
  assert.notEqual(
    buildLunaDirectPayloadHash(stableMaterial),
    buildLunaDirectPayloadHash({
      ...stableMaterial,
      recognition_fingerprints: [`sha256:${"0".repeat(64)}`]
    })
  );
  const resolutionBound = task("asset-1", {
    resolution_contract_sha256: "b".repeat(64),
    original_set_sha256: "c".repeat(64)
  });
  const changedOriginalSet = {
    ...resolutionBound,
    original_set_sha256: "f".repeat(64)
  };
  assert.equal(
    buildLunaDirectOperationKey(resolutionBound),
    buildLunaDirectOperationKey(changedOriginalSet),
    "verified-original identity is execution payload, not a second paid operation"
  );
  assert.notEqual(
    buildLunaDirectPayloadHash(resolutionBound),
    buildLunaDirectPayloadHash(changedOriginalSet),
    "a different verified-original set must conflict before provider use"
  );
  assert.notEqual(
    buildLunaDirectPayloadHash(resolutionBound),
    buildLunaDirectPayloadHash({ ...resolutionBound, original_set_sha256: null }),
    "the payload explicitly binds both presence and absence of original-set identity"
  );
  assert.throws(
    () => buildLunaDirectPayloadHash({
      ...task("asset-1"), original_set_sha256: "c".repeat(64)
    }),
    /original_set_sha256_requires_resolution_contract/
  );
  assert.throws(
    () => buildLunaDirectPayloadHash({
      ...resolutionBound, original_set_sha256: "not-a-digest"
    }),
    /invalid_original_set_sha256/
  );
  const derived = task("asset-staged", {
    image_fingerprints: [`sha256:${"a".repeat(64)}`],
    operation_scope: "derived_checkpoint",
    lane_version: "readability-derived-inline-v2",
    original_manifest_sha256: "c".repeat(64),
    recognition_fingerprints: [`sha256:${"f".repeat(64)}`],
    execution_contract_sha256: "d".repeat(64)
  });
  const changedExecution = { ...derived, execution_contract_sha256: "e".repeat(64) };
  assert.equal(
    buildLunaDirectOperationKey(derived),
    buildLunaDirectOperationKey(changedExecution),
    "model execution is payload identity, not a second staged user operation"
  );
  assert.notEqual(
    buildLunaDirectPayloadHash(derived),
    buildLunaDirectPayloadHash(changedExecution),
    "a staged checkpoint may not cross execution contracts"
  );
  for (const changedExecutionPolicy of [
    { detail: "original", execution_contract_sha256: "e".repeat(64) },
    { lane_version: "readability-derived-inline-v3", execution_contract_sha256: "e".repeat(64) }
  ]) {
    const changed = { ...derived, ...changedExecutionPolicy };
    assert.equal(
      buildLunaDirectOperationKey(changed),
      buildLunaDirectOperationKey(derived),
      "model detail and transport lane must not create a second staged user operation"
    );
    assert.notEqual(
      buildLunaDirectPayloadHash(changed),
      buildLunaDirectPayloadHash(derived),
      "model detail and transport lane must conflict at the paid payload boundary"
    );
  }
  const changedRecognition = {
    ...derived,
    recognition_fingerprints: [`sha256:${"0".repeat(64)}`]
  };
  assert.equal(buildLunaDirectOperationKey(derived), buildLunaDirectOperationKey(changedRecognition),
    "transport bytes must not create a second user operation");
  assert.notEqual(buildLunaDirectPayloadHash(derived), buildLunaDirectPayloadHash(changedRecognition),
    "transport-byte drift must conflict at the payload boundary before another call");
  assert.throws(
    () => buildLunaDirectPayloadHash({ ...task("asset-ordinary"), execution_contract_sha256: undefined }),
    /missing_execution_contract_sha256/
  );
  assert.throws(
    () => buildLunaDirectPayloadHash({ ...task("asset-ordinary"), recognition_fingerprints: [] }),
    /invalid_recognition_fingerprints/
  );
  assert.throws(
    () => buildLunaDirectPayloadHash({ ...derived, execution_contract_sha256: undefined }),
    /missing_execution_contract_sha256/
  );
  assert.throws(
    () => buildLunaDirectOperationKey({ ...derived, execution_contract_sha256: "not-a-digest" }),
    /invalid_execution_contract_sha256/
  );
}

// Only the explicitly transient HTTP statuses and recognizable network
// failures retry. A generic application error still fails immediately.
{
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(classifyLunaDirectFailure({ status }).retryable, true);
  }
  assert.equal(classifyLunaDirectFailure({ status: 502 }).ambiguous, true);
  assert.equal(classifyLunaDirectFailure({ status: 503 }).ambiguous, true);
  assert.equal(classifyLunaDirectFailure({ status: 504 }).ambiguous, true);
  assert.equal(classifyLunaDirectFailure({ status: 503, safe_to_retry: true }).ambiguous, false);
  assert.deepEqual(
    classifyLunaDirectFailure({ status: 502, definitive_response: true, retryable: false }),
    { retryable: false, ambiguous: false, kind: "http", status: 502 },
    "a complete malformed provider response is not a lost response and must not buy another call"
  );
  for (const status of [400, 408]) {
    assert.equal(classifyLunaDirectFailure({ status }).retryable, false);
  }
  assert.deepEqual(
    classifyLunaDirectFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })),
    { retryable: true, ambiguous: true, kind: "network", status: null }
  );
  assert.deepEqual(
    classifyLunaDirectFailure(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" })),
    { retryable: true, ambiguous: false, kind: "network", status: null }
  );
  assert.equal(classifyLunaDirectFailure(Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" })).ambiguous, true);
  assert.equal(classifyLunaDirectFailure(new TypeError("bad application value")).retryable, false);
}

// Retry-After is a floor, exponential delay is bounded, and injected jitter is
// deterministic in tests. The dispatcher never retries earlier than the
// server's bounded Retry-After instruction.
{
  const nowMs = Date.parse("2026-08-01T00:00:00Z");
  assert.equal(retryAfterMs({ headers: { "Retry-After": "2" } }, { nowMs }), 2_000);
  assert.equal(
    retryAfterMs({ headers: new Headers({ "retry-after": "Sat, 01 Aug 2026 00:00:03 GMT" }) }, { nowMs }),
    3_000
  );
  assert.equal(lunaRetryDelayMs({
    error: { headers: { "retry-after": "2" } }, failedAttempt: 1,
    baseDelayMs: 100, maxDelayMs: 5_000, jitterRatio: 0.2, random: () => 0.5, nowMs
  }), 2_200);
  assert.equal(lunaRetryDelayMs({
    error: {}, failedAttempt: 9, baseDelayMs: 100, maxDelayMs: 1_000,
    jitterRatio: 1, random: () => 1, nowMs
  }), 1_000);
}

// The only automatic provider retry is one durable, definitive HTTP 502. It
// preserves the logical operation/payload/model while using a distinct
// per-attempt observability ID; that ID is not provider-side idempotency.
{
  const calls = [];
  const sleeps = [];
  const admissionEvents = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 9,
    maxAttempts: 2,
    jitterRatio: 0,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      admissionEvents.push(`sleep:${delayMs}`);
    },
    providerAdmission: {
      enqueueAttempt: async (metadata) => {
        admissionEvents.push(`enqueue:${metadata.attemptClass}:${metadata.attempt}`);
        return metadata;
      },
      runAttempt: async ({ queuedAttempt, execute }) => {
        const metadata = await queuedAttempt;
        admissionEvents.push(`claim:${metadata.attempt}`);
        try {
          return await execute();
        } finally {
          admissionEvents.push(`settle:${metadata.attempt}`);
        }
      }
    },
    executeTask: async (payload) => {
      calls.push(payload);
      if (calls.length === 1) {
        const failure = definitive502Failure(payload);
        assert.equal(definitive502TransportRetryEligible(failure, {
          failedAttempt: 1,
          maximumAttempts: 2,
          operationKey: payload.operation_key,
          payloadHash: payload.payload_hash,
          estimatedTokens: payload.estimated_tokens,
          elapsedMs: 120
        }), true);
        throw failure;
      }
      validateDefinitive502TransportRetryReceipt(
        payload.provider_transport_retry_receipt,
        { operationKey: payload.operation_key, payloadHash: payload.payload_hash }
      );
      return { title: "recovered" };
    }
  });
  const result = await dispatcher.enqueue(task("definitive-502"));
  assert.deepEqual(result, { title: "recovered" });
  assert.equal(dispatcher.csmDirectConcurrency, 9, "direct concurrency must not inherit an old provider cap");
  assert.deepEqual(sleeps, [250]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation_key, calls[1].operation_key);
  assert.equal(calls[0].manual_retry, false);
  assert.equal(calls[1].attempt, 2);
  assert.equal(calls[0].tenant_id, "tenant-1");
  assert.equal(calls[0].estimated_tokens, 5_262);
  assert.deepEqual(calls.map(({ attempt_class }) => attempt_class), ["fresh", "retry"]);
  assert.equal(calls[0].provider_transport_retry_receipt, undefined);
  assert.equal(
    calls[1].provider_transport_retry_receipt.provider_client_request_id,
    deterministicClientRequestId(calls[0].operation_key, calls[0].payload_hash, 1)
  );
  assert.equal(
    calls[1].provider_transport_retry_receipt.retry_provider_client_request_id,
    deterministicClientRequestId(calls[0].operation_key, calls[0].payload_hash, 2)
  );
  for (const mutate of [
    (value) => { value.provider_client_request_id = null; },
    (value) => { value.retry_provider_client_request_id = null; },
    (value) => {
      value.retry_provider_client_request_id = value.provider_client_request_id;
    }
  ]) {
    const invalid = structuredClone(calls[1].provider_transport_retry_receipt);
    mutate(invalid);
    assert.throws(
      () => validateDefinitive502TransportRetryReceipt(invalid),
      /invalid_definitive_502_transport_retry_receipt_contract/,
      "receipt-only validation must require distinct non-null attempt traces"
    );
  }
  assert.deepEqual(admissionEvents, [
    "enqueue:fresh:1", "claim:1", "settle:1", "sleep:250",
    "enqueue:retry:2", "claim:2", "settle:2"
  ]);
}

// Status alone is never enough. Every non-502 status and every ambiguous,
// partial-body, output-bearing, token-bearing, contract, or stale 502 is one
// physical attempt only.
for (const [name, mutate] of [
  ["429", (error) => { error.status = error.statusCode = 429; error.provider_failure_result.status = 429; }],
  ["500", (error) => { error.status = error.statusCode = 500; error.provider_failure_result.status = 500; }],
  ["503", (error) => { error.status = error.statusCode = 503; error.provider_failure_result.status = 503; }],
  ["504", (error) => { error.status = error.statusCode = 504; error.provider_failure_result.status = 504; }],
  ["ambiguous", (error) => { error.ambiguous = true; error.provider_failure_result.ambiguous = true; }],
  ["partial-body", (error) => { error.response_body_complete = false; error.provider_failure_result.response_body_complete = false; }],
  ["output", (error) => { error.provider_output_present = true; error.provider_failure_result.provider_output_present = true; }],
  ["tokens", (error) => { error.provider_failure_result.actual_tokens = 1; }],
  ["contract", (error) => { error.provider_contract_failure = true; error.provider_failure_result.provider_contract_failure = true; }],
  ["business", (error) => { error.provider_business_failure = true; error.provider_failure_result.provider_business_failure = true; }],
  ["late", (error) => { error.provider_failure_result.provider_ms = 15_001; }]
]) {
  let calls = 0;
  let currentError;
  let clock = 0;
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 2,
    now: () => clock,
    executeTask: async (payload) => {
      calls += 1;
      currentError = definitive502Failure(payload);
      mutate(currentError);
      if (name === "late") clock = 15_001;
      throw currentError;
    }
  });
  await assert.rejects(dispatcher.enqueue(task(`no-auto-${name}`)), (error) => error === currentError);
  assert.equal(calls, 1, `${name} must not buy a second provider attempt`);
}

// Appended assets join the live queue; duplicate intake returns the exact same
// promise; only the configured number of provider calls can be active.
{
  const releases = new Map();
  let active = 0;
  let maximumActive = 0;
  const started = [];
  const durableQueued = [];
  const durableClaims = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 2,
    providerAdmission: {
      enqueueAttempt: async (metadata) => {
        durableQueued.push(metadata.operationKey);
        return metadata;
      },
      runAttempt: async ({ queuedAttempt, execute }) => {
        const metadata = await queuedAttempt;
        durableClaims.push(metadata.operationKey);
        return execute();
      }
    },
    executeTask: async (payload) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.push(payload.asset_id);
      const pending = gate();
      releases.set(payload.asset_id, pending.release);
      await pending.promise;
      active -= 1;
      return { asset_id: payload.asset_id };
    }
  });

  const first = dispatcher.enqueue(task("append-1"));
  const duplicate = dispatcher.enqueue(task("append-1"));
  assert.equal(duplicate, first);
  const appended = dispatcher.append([task("append-2"), task("append-3"), task("append-4")]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["append-1", "append-2"]);
  assert.equal(durableQueued.length, 4, "all eligible backlog must reach global WFQ at intake");
  assert.equal(durableClaims.length, 2, "only local active slots may seek a physical-attempt lease");
  releases.get("append-1")();
  releases.get("append-2")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["append-1", "append-2", "append-3", "append-4"]);
  releases.get("append-3")();
  releases.get("append-4")();
  await Promise.all([first, ...appended]);
  await dispatcher.whenIdle();
  assert.equal(maximumActive, 2);
  assert.deepEqual(dispatcher.snapshot(), {
    csm_direct_concurrency: 2,
    globally_enforced_admission: false,
    queued: 0,
    active: 0,
    waiting_retries: 0,
    operations: 4
  });
}

// With a durable global authority, the local integer is not a second provider
// cap: every eligible entry seeks a claim, while the authority alone grants at
// most c120 atomically and can therefore see the actual global fair head.
{
  const claims = [];
  const claimGate = gate();
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 2,
    providerAdmission: {
      globallyEnforced: true,
      enqueueAttempt: async (metadata) => metadata,
      runAttempt: async ({ queuedAttempt, execute }) => {
        const metadata = await queuedAttempt;
        claims.push(metadata.operationKey);
        await claimGate.promise;
        return execute();
      }
    },
    executeTask: async ({ asset_id }) => ({ asset_id })
  });
  const promises = dispatcher.append(Array.from({ length: 6 }, (_, index) => task(`global-${index}`)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claims.length, 6);
  assert.equal(dispatcher.snapshot().active, 6);
  claimGate.release();
  await Promise.all(promises);
}

// One intent/asset pair cannot silently split into two execution profiles. The
// logical key stays fixed and the warm payload fence rejects the second digest.
{
  let executeCalls = 0;
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    executeTask: async () => {
      executeCalls += 1;
      return { ok: true };
    }
  });
  await dispatcher.enqueue(task("conflict"));
  assert.throws(
    () => dispatcher.enqueue(task("conflict", {
      prompt_version: "csm-canonical-fields-v2",
      execution_contract_sha256: FUTURE_EXECUTION_SHA256
    })),
    (error) => error.code === "LUNA_DIRECT_OPERATION_PAYLOAD_CONFLICT"
  );
  assert.equal(executeCalls, 1,
    "same-intent profile drift must fail before a second paid execution");
}

// Effort is payload identity, not user-operation identity. A warm dispatcher
// must still refuse to coalesce low and none into the first result before the
// durable authority gets a chance to enforce that payload fence.
{
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    executeTask: async () => ({ ok: true })
  });
  await dispatcher.enqueue(task("effort-conflict"));
  assert.throws(
    () => dispatcher.enqueue(task("effort-conflict", {
      reasoning_effort: "none",
      execution_contract_sha256: FUTURE_EXECUTION_SHA256
    })),
    (error) => error.code === "LUNA_DIRECT_OPERATION_PAYLOAD_CONFLICT"
  );
}

// Non-transient failures do not auto-retry. The writer's manual action invokes
// the same executeTask path with the same operation key rather than a second
// recovery route.
{
  const calls = [];
  const directTaskPath = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) return new Response("invalid", { status: 400 });
    return { title: "manual recovery" };
  };
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    executeTask: directTaskPath,
    maxAttempts: 5
  });
  await assert.rejects(dispatcher.enqueue(task("manual")), /luna_direct_http_400/);
  assert.equal(calls.length, 1);
  const recovered = await dispatcher.manualRetry(task("manual"));
  assert.deepEqual(recovered, { title: "manual recovery" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation_key, calls[1].operation_key);
  assert.equal(calls[1].manual_retry, true);
  assert.equal(calls[1].attempt, 2);
  assert.equal(calls[1].attempt_class, "retry");
  assert.equal(calls[1].provider_transport_retry_receipt, undefined,
    "manual retry keeps its historical tuple and does not forge an automatic-502 receipt");
}

// A manual retry in a fresh serverless process resumes from the durable
// attempt number; it must never forge attempt 1 with class RETRY.
{
  const attempts = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    providerAdmission: {
      enqueueAttempt: async (metadata) => {
        attempts.push({ attempt: metadata.attempt, attemptClass: metadata.attemptClass });
        return metadata;
      },
      runAttempt: async ({ queuedAttempt, execute }) => {
        await queuedAttempt;
        return execute();
      }
    },
    executeTask: async () => ({ title: "durable retry" })
  });
  assert.throws(
    () => dispatcher.manualRetry(task("durable-manual")),
    (error) => error.code === "LUNA_DIRECT_MANUAL_RETRY_INVALID"
  );
  assert.deepEqual(
    await dispatcher.manualRetry(task("durable-manual", { prior_attempts: 1 })),
    { title: "durable retry" }
  );
  assert.deepEqual(attempts, [{ attempt: 2, attemptClass: "retry" }]);
}

// A timeout is ambiguous: without a result lookup, neither auto retry nor a
// later manual click can resubmit it. This is deliberately fail-closed until a
// real server-side idempotency/result lookup exists.
{
  let calls = 0;
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 4,
    executeTask: async () => {
      calls += 1;
      throw Object.assign(new Error("provider timed out"), { code: "ETIMEDOUT" });
    }
  });
  await assert.rejects(
    dispatcher.enqueue(task("ambiguous-closed")),
    (error) => error.code === "LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE"
  );
  assert.equal(calls, 1);
  await assert.rejects(
    dispatcher.manualRetry(task("ambiguous-closed")),
    (error) => error.code === "LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE"
  );
  assert.equal(calls, 1, "manual retry must look up the prior ambiguous operation before resubmitting");
}

// A transient result-lookup transport failure may retry the lookup itself.
// Even a later not_found does not turn an ambiguous 504 into an automatic
// provider retry; that path remains a writer-controlled recovery decision.
{
  let calls = 0;
  let lookups = 0;
  const sleeps = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 2,
    jitterRatio: 0,
    sleep: async (delayMs) => sleeps.push(delayMs),
    lookupOperationResult: async () => {
      lookups += 1;
      if (lookups === 1) throw new Error("temporary lookup transport failure");
      return { status: "not_found" };
    },
    executeTask: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("gateway timeout"), { status: 504 });
      return { title: "lookup recovered" };
    }
  });
  await assert.rejects(dispatcher.enqueue(task("ambiguous-lookup-retry")), /gateway timeout/);
  assert.equal(calls, 1);
  assert.equal(lookups, 2);
  assert.deepEqual(sleeps, [150]);
}

// A definitive not_found lookup proves there is no hidden success, but it does
// not make an ambiguous transport eligible for automatic resubmission. A found
// lookup still returns the durable result without another provider call.
{
  let calls = 0;
  const operationKeys = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 2,
    jitterRatio: 0,
    sleep: async () => {},
    lookupOperationResult: async (payload) => {
      operationKeys.push(payload.operation_key);
      assert.match(payload.payload_hash, /^[0-9a-f]{64}$/);
      return { status: "not_found" };
    },
    executeTask: async (payload) => {
      calls += 1;
      operationKeys.push(payload.operation_key);
      if (calls === 1) throw Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" });
      return { title: "safe retry" };
    }
  });
  await assert.rejects(dispatcher.enqueue(task("ambiguous-not-found")), /headers timeout/);
  assert.equal(calls, 1);
  assert.equal(new Set(operationKeys).size, 1);
}

{
  let calls = 0;
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 2,
    lookupOperationResult: async () => ({ status: "found", result: { title: "already committed" } }),
    executeTask: async () => {
      calls += 1;
      throw Object.assign(new Error("gateway timeout"), { status: 504 });
    }
  });
  assert.deepEqual(await dispatcher.enqueue(task("ambiguous-found")), { title: "already committed" });
  assert.equal(calls, 1);
}

process.stdout.write("luna direct dispatcher: ok\n");
