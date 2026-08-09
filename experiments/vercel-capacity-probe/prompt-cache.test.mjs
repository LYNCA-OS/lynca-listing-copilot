import assert from "node:assert/strict";

import { CSM_ACTIVE_MODEL_PROFILE } from "../../lib/listing/thin/csm-model-profile.mjs";
import { CSM_OPENAI_RESPONSES_ADAPTER } from "../../lib/listing/thin/csm-provider-adapter.mjs";
import {
  default as promptCacheHandler,
  normalizedPromptCachePayload,
  runLunaExplicitCacheScreen
} from "./api/prompt-cache.js";
import {
  buildLunaExplicitCacheScreenPlan,
  stripExplicitCacheTransport
} from "./luna-explicit-cache-contract.mjs";
import { assertLunaExplicitCachePreregisteredContract } from "./luna-explicit-cache-prereg.mjs";

const env = {
  VERCEL_ENV: "preview",
  VERCEL_REGION: "sin1",
  VERCEL_DEPLOYMENT_ID: "dpl_test_cache_screen",
  VERCEL_URL: "luna-cache-preview.example.vercel.app",
  VERCEL_GIT_COMMIT_SHA: "1".repeat(40),
  LYNCA_CLOUD_SIM_ENABLED: "true",
  LYNCA_CLOUD_SIM_RUN_TOKEN: "test-run-token",
  OPENAI_API_KEY: "test-openai-key"
};
const runId = "luna-cache-test-20260809";
const plan = buildLunaExplicitCacheScreenPlan(runId);
const wireSteps = plan.steps.map((step) => ({ id: step.id, request: step.request }));

function previewIdentity(report = env) {
  return {
    environment: report.environment || report.VERCEL_ENV,
    region: report.region || report.VERCEL_REGION,
    deployment_id: report.deployment_id || report.VERCEL_DEPLOYMENT_ID,
    deployment_hostname: report.deployment_hostname || report.VERCEL_URL,
    release_git_sha: report.release_git_sha || report.VERCEL_GIT_COMMIT_SHA
  };
}

function singleUseAuthority() {
  let claimed = false;
  return {
    durable: true,
    async claim() {
      if (claimed) return { granted: false };
      claimed = true;
      return { granted: true };
    }
  };
}

assertLunaExplicitCachePreregisteredContract(plan.contract);
assert.equal(plan.contract.model, "gpt-5.6-luna");
assert.equal(plan.contract.reasoning_effort, "low");
assert.equal(plan.contract.image_detail, "high");
assert.equal(plan.contract.max_output_tokens, 8192);
assert.equal(plan.steps[0].receipt.semantic_request_sha256,
  plan.steps[1].receipt.semantic_request_sha256);
assert.equal(plan.steps[0].receipt.transport_request_sha256,
  plan.steps[1].receipt.transport_request_sha256);
assert.notEqual(plan.steps[1].receipt.semantic_request_sha256,
  plan.steps[2].receipt.semantic_request_sha256);
assert.equal(new Set(plan.steps.map((step) => step.receipt.stable_prefix_sha256)).size, 1);
assert.equal(new Set(plan.steps.map((step) => step.receipt.semantic_contract_sha256)).size, 1);
assert.equal(new Set(plan.steps.map((step) => step.receipt.cache_key_sha256)).size, 1);

for (const step of plan.steps) {
  const semantic = stripExplicitCacheTransport(step.request);
  const imageUrl = semantic.input[0].content[1].image_url;
  const production = CSM_OPENAI_RESPONSES_ADAPTER.buildRequest({
    imageUrls: [imageUrl],
    model: CSM_ACTIVE_MODEL_PROFILE.model,
    effort: CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
    imageDetail: CSM_ACTIVE_MODEL_PROFILE.image_detail,
    maxOutputTokens: CSM_ACTIVE_MODEL_PROFILE.max_output_tokens
  });
  assert.equal(JSON.stringify(semantic), JSON.stringify(production),
    "removing only cache transport controls must recover the Production request bytes");
  assert.deepEqual(step.request.prompt_cache_options, { mode: "explicit", ttl: "30m" });
  assert.deepEqual(step.request.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
  assert.equal(step.request.prompt_cache_key.startsWith("lynca:luna-cache-screen:v1:"), true);
  assert.notEqual(step.receipt.semantic_request_sha256, step.receipt.transport_request_sha256);
}

const dryPayload = normalizedPromptCachePayload({
  run_id: runId,
  steps: wireSteps
}, env);
let forbiddenDryCalls = 0;
const dry = await runLunaExplicitCacheScreen(dryPayload, {
  env,
  fetchImpl: async () => {
    forbiddenDryCalls += 1;
    throw new Error("dry_run_must_not_call_provider");
  }
});
assert.equal(forbiddenDryCalls, 0);
assert.equal(dry.state, "PREFLIGHT_READY_NO_PROVIDER_CALL");
assert.equal(dry.execution_authorized, false);
assert.equal(dry.provider_calls, 0);
assert.equal(dry.cache_key_in_semantic_identity, false);
assert.equal(dry.cache_policy_receipt_separate_from_semantic_identity, true);
assert.equal(dry.production_semantic_contract_preregistered, true);
assert.equal(dry.accuracy_claim_allowed, false);
assert.equal(dry.promotion_evidence_allowed, false);

const livePayload = normalizedPromptCachePayload({
  run_id: runId,
  execution_authorized: true,
  preflight_receipt_sha256: dry.preflight_receipt_sha256,
  preview_identity: previewIdentity(dry),
  steps: wireSteps
}, env);

let forbiddenPaidCalls = 0;
const hold = await runLunaExplicitCacheScreen(livePayload, {
  env,
  fetchImpl: async () => {
    forbiddenPaidCalls += 1;
    throw new Error("authority_hold_must_precede_provider");
  }
});
assert.equal(hold.state, "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED");
assert.equal(hold.decision, "HOLD");
assert.equal(hold.provider_calls, 0);
assert.equal(hold.retry_allowed, false);
assert.equal(forbiddenPaidCalls, 0);

function response({ index, cachedTokens, cacheWriteTokens, ok = true } = {}) {
  return new Response(JSON.stringify(ok ? {
    id: `resp-cache-${index}`,
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    incomplete_details: null,
    output: [{ type: "message", content: [{ type: "output_text", text: "synthetic-output-not-evaluated" }] }],
    usage: {
      input_tokens: 5000,
      input_tokens_details: {
        cached_tokens: cachedTokens,
        ...(cacheWriteTokens === undefined ? {} : { cache_write_tokens: cacheWriteTokens })
      },
      output_tokens: 50,
      total_tokens: 5050
    }
  } : {
    error: { type: "invalid_request_error", code: "known_test_failure" }
  }), { status: ok ? 200 : 400 });
}

let clock = 0;
const sent = [];
const pass = await runLunaExplicitCacheScreen(livePayload, {
  env,
  singleUseAuthority: singleUseAuthority(),
  now: () => (clock += 10),
  fetchImpl: async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const index = sent.length;
    return response({
      index,
      cachedTokens: index === 1 ? 0 : 2048,
      cacheWriteTokens: index === 1 ? 2048 : 0
    });
  }
});
assert.equal(sent.length, 3);
assert.equal(pass.ok, true);
assert.equal(pass.state, "PASS_CACHE_TRANSPORT_CANDIDATE");
assert.equal(pass.decision, "PASS_CANDIDATE_NOT_PRODUCTION");
assert.equal(pass.provider_calls, 3);
assert.equal(pass.provider_failures, 0);
assert.equal(pass.request_failures, 0);
assert.equal(pass.cache_write_tokens, 2048);
assert.equal(pass.cached_tokens, 4096);
assert.equal(pass.rows.every((row) => row.gate.passed), true);
assert.equal(pass.rows[0].gate.reason, "cold_write_proven");
assert.equal(pass.rows[1].gate.reason, "same_card_read_proven");
assert.equal(pass.rows[2].gate.reason, "cross_card_read_proven");
assert.equal(JSON.stringify(sent[0]), JSON.stringify(sent[1]));
assert.notEqual(JSON.stringify(sent[1]), JSON.stringify(sent[2]));
assert.equal(sent.every((request) => request.prompt_cache_key === sent[0].prompt_cache_key), true);
assert.equal(JSON.stringify(pass).includes("data:image"), false,
  "reports must not persist the synthetic image payloads");
assert.equal(JSON.stringify(pass).includes("synthetic-output-not-evaluated"), false,
  "cache evidence must not persist or score model output");

async function stoppedWith(usages) {
  let calls = 0;
  const report = await runLunaExplicitCacheScreen(livePayload, {
    env,
    singleUseAuthority: singleUseAuthority(),
    fetchImpl: async () => {
      const current = usages[calls];
      calls += 1;
      return response({ index: calls, ...current });
    }
  });
  return { calls, report };
}

const shortPrefix = await stoppedWith([{ cachedTokens: 0, cacheWriteTokens: 0 }]);
assert.equal(shortPrefix.calls, 1);
assert.equal(shortPrefix.report.state, "STOPPED");
assert.equal(shortPrefix.report.rows[0].gate.reason, "stable_prefix_not_cacheable");

const pollutedCold = await stoppedWith([{ cachedTokens: 2048, cacheWriteTokens: 0 }]);
assert.equal(pollutedCold.calls, 1);
assert.equal(pollutedCold.report.rows[0].gate.reason, "cold_request_was_not_cold");

const missingWrite = await stoppedWith([{ cachedTokens: 0 }]);
assert.equal(missingWrite.calls, 1);
assert.equal(missingWrite.report.rows[0].cache_write_tokens, null);
assert.equal(missingWrite.report.rows[0].gate.reason, "cache_usage_receipt_missing");

const sameCardMiss = await stoppedWith([
  { cachedTokens: 0, cacheWriteTokens: 2048 },
  { cachedTokens: 0, cacheWriteTokens: 2048 }
]);
assert.equal(sameCardMiss.calls, 2);
assert.equal(sameCardMiss.report.rows[1].gate.reason, "warm_request_rewrote_cache");

const crossCardMiss = await stoppedWith([
  { cachedTokens: 0, cacheWriteTokens: 2048 },
  { cachedTokens: 2048, cacheWriteTokens: 0 },
  { cachedTokens: 0, cacheWriteTokens: 0 }
]);
assert.equal(crossCardMiss.calls, 3);
assert.equal(crossCardMiss.report.rows[2].gate.reason, "cross_card_cache_read_not_proven");

const providerFailure = await stoppedWith([{ ok: false }]);
assert.equal(providerFailure.calls, 1);
assert.equal(providerFailure.report.provider_failures, 1);
assert.equal(providerFailure.report.rows[0].gate.reason, "provider_request_failed");

let ambiguousCalls = 0;
const ambiguous = await runLunaExplicitCacheScreen(livePayload, {
  env,
  singleUseAuthority: singleUseAuthority(),
  fetchImpl: async () => {
    ambiguousCalls += 1;
    throw Object.assign(new Error("request_aborted"), { name: "TimeoutError" });
  }
});
assert.equal(ambiguousCalls, 1);
assert.equal(ambiguous.state, "AMBIGUOUS_PROVIDER_OUTCOME");
assert.equal(ambiguous.decision, "HOLD");
assert.equal(ambiguous.provider_calls, 1);
assert.equal(ambiguous.provider_calls_known, 1);
assert.equal(ambiguous.retry, false);
assert.equal(ambiguous.retry_allowed, false);
assert.equal(ambiguous.rows[0].transport_outcome_ambiguous, true);
assert.equal(ambiguous.rows[0].gate.reason, "provider_transport_outcome_ambiguous");

assert.throws(() => normalizedPromptCachePayload({
  run_id: runId,
  execution_authorized: "true",
  steps: wireSteps
}, env), /execution_authorized_must_be_boolean/);
assert.throws(() => normalizedPromptCachePayload({
  run_id: runId,
  execution_authorized: true,
  preview_identity: previewIdentity(dry),
  steps: wireSteps
}, env), /paid_execution_preflight_receipt_mismatch/);
assert.throws(() => normalizedPromptCachePayload({
  run_id: runId,
  preflight_receipt_sha256: dry.preflight_receipt_sha256,
  steps: wireSteps
}, env), /preflight_receipt_not_allowed_without_execution/);
assert.throws(() => normalizedPromptCachePayload({
  run_id: runId,
  steps: wireSteps
}, { ...env, VERCEL_REGION: "syd1" }), /sin1_runtime_required/);

const changedKey = structuredClone(wireSteps);
changedKey[0].request.prompt_cache_key = "different-key";
assert.throws(() => normalizedPromptCachePayload({
  run_id: runId,
  steps: changedKey
}, env), /cache_screen_request_shape_invalid/);

const changedPrompt = structuredClone(wireSteps);
changedPrompt[0].request.input[0].content[0].text += " changed";
changedPrompt[0].request = {
  ...changedPrompt[0].request,
  prompt_cache_key: plan.cache_key
};
assert.throws(() => normalizedPromptCachePayload({
  run_id: runId,
  steps: changedPrompt
}, env), /same_card_requests_not_identical|luna_explicit_cache_contract_not_preregistered/);

function mockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); }
  };
}

async function invokeHandler({ method = "POST", headers = {}, body = {} } = {}) {
  const response = mockResponse();
  await promptCacheHandler({ method, headers, body }, response);
  return response;
}

const originalEnvironment = Object.fromEntries(Object.keys(env).map((key) => (
  [key, process.env[key]]
)));
Object.assign(process.env, env);
const originalFetch = globalThis.fetch;
let handlerProviderCalls = 0;
globalThis.fetch = async () => {
  handlerProviderCalls += 1;
  throw new Error("handler_must_not_reach_provider");
};
try {
  const unauthorized = await invokeHandler({
    body: { run_id: runId, steps: wireSteps }
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error, "cloud_sim_unauthorized");
  assert.equal(unauthorized.body.provider_calls, 0);

  const wrongMethod = await invokeHandler({ method: "PUT" });
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.body.error, "method_not_allowed");

  const receiptMismatch = await invokeHandler({
    headers: { "x-lynca-cloud-sim-token": env.LYNCA_CLOUD_SIM_RUN_TOKEN },
    body: {
      run_id: runId,
      execution_authorized: true,
      preview_identity: previewIdentity(dry),
      preflight_receipt_sha256: "a".repeat(64),
      steps: wireSteps
    }
  });
  assert.equal(receiptMismatch.statusCode, 400);
  assert.equal(receiptMismatch.body.error, "paid_execution_preflight_receipt_mismatch");
  assert.equal(receiptMismatch.body.provider_calls, 0);

  process.env.VERCEL_DEPLOYMENT_ID = "dpl_repointed_cache_screen";
  process.env.VERCEL_GIT_COMMIT_SHA = "2".repeat(40);
  const repointed = await invokeHandler({
    headers: { "x-lynca-cloud-sim-token": env.LYNCA_CLOUD_SIM_RUN_TOKEN },
    body: {
      run_id: runId,
      execution_authorized: true,
      preview_identity: previewIdentity(dry),
      preflight_receipt_sha256: dry.preflight_receipt_sha256,
      steps: wireSteps
    }
  });
  assert.equal(repointed.statusCode, 400);
  assert.equal(repointed.body.error, "paid_execution_preview_identity_mismatch");
  assert.equal(repointed.body.provider_calls, 0);

  Object.assign(process.env, env);
  const paidHold = await invokeHandler({
    headers: { "x-lynca-cloud-sim-token": env.LYNCA_CLOUD_SIM_RUN_TOKEN },
    body: {
      run_id: runId,
      execution_authorized: true,
      preview_identity: previewIdentity(dry),
      preflight_receipt_sha256: dry.preflight_receipt_sha256,
      steps: wireSteps
    }
  });
  assert.equal(paidHold.statusCode, 200);
  assert.equal(paidHold.body.state, "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED");
  assert.equal(paidHold.body.provider_calls, 0);
  assert.equal(paidHold.body.retry_allowed, false);
  assert.equal(handlerProviderCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

process.stdout.write("luna explicit prompt-cache endpoint tests passed\n");
