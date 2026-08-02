import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SWEEP_EXECUTION_MODES,
  buildProviderTextControlRequest,
  chooseConcurrency,
  createDirectProviderRequester,
  createDirectEndpointRequester,
  createPresignedProviderRequester,
  createProviderTextControlRequester,
  createSupabaseSigningRequester,
  estimateCardCost,
  main,
  mapConcurrent,
  runPresignedProviderSweep,
  runConcurrencySweep
} from "./run-csm-direct-concurrency-sweep.mjs";

let active = 0;
let maxActive = 0;
const scheduled = await mapConcurrent(Array.from({ length: 11 }, (_, index) => index), 4, async (item) => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 2));
  active -= 1;
  return item * 2;
});
assert.deepEqual(scheduled, Array.from({ length: 11 }, (_, index) => index * 2));
assert.equal(maxActive, 4, "dependency-injected scheduling must honor the requested width");

assert.equal(estimateCardCost({ inputTokens: 1000, outputTokens: 200 }, {}), null,
  "unconfigured pricing must remain unknown rather than fake zero cost");
assert.equal(estimateCardCost(
  { inputTokens: 1000, outputTokens: 200 },
  { inputUsdPerMillion: 2, outputUsdPerMillion: 10 }
), 0.004);

const syntheticLevels = [
  { concurrency: 2, throughput_cards_per_minute: 20, failure_rate: 0, http_429_rate: 0 },
  { concurrency: 4, throughput_cards_per_minute: 36, failure_rate: 0, http_429_rate: 0 },
  { concurrency: 6, throughput_cards_per_minute: 39, failure_rate: 0, http_429_rate: 0 },
  { concurrency: 10, throughput_cards_per_minute: 40, failure_rate: 0.1, http_429_rate: 0.1 }
];
const choice = chooseConcurrency(syntheticLevels);
assert.equal(choice.selected_concurrency, 6,
  "the minimum no-regression level inside the throughput plateau should win, not max concurrency");
assert.equal(choice.assessed.at(-1).stable, false);

let clock = 0;
const seen = [];
const report = await runConcurrencySweep({
  assets: ["a", "b", "c", "d"],
  levels: [2, 4],
  now: () => clock,
  pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
  requestCard: async (asset, context) => {
    seen.push([asset, context.concurrency]);
    clock += 10;
    if (asset === "d" && context.concurrency === 4) {
      return { ok: false, status: 429, input_tokens: 0, output_tokens: 0, provider_call_count: 0 };
    }
    return {
      ok: true, status: 200, input_tokens: 100, output_tokens: 50,
      provider_call_count: 1, cloud_run_calls: 0, vector_calls: 0
    };
  }
});
assert.equal(seen.length, 8);
assert.deepEqual(report.levels.map((level) => level.concurrency), [2, 4]);
assert.equal(report.levels[1].http_429_count, 1);
assert.equal(report.levels[1].failure_rate, 0.25);
assert.equal(report.levels[0].provider_call_count, 4);
assert.equal(report.levels[0].estimated_cost_usd, 0.0008);
assert.equal(report.schema_version, "csm-direct-concurrency-sweep-v2");
assert.equal(report.study_phase, "SCREEN");
assert.equal(report.production_recommendation, false);
assert.equal(report.execution_mode, SWEEP_EXECUTION_MODES.MOCK);
assert.equal(report.boundary.kind, "MOCK_NO_NETWORK");
assert.equal(report.boundary.endpoint_path, null);
assert.equal(report.recommendation.status, "NOT_A_PRODUCTION_RECOMMENDATION");
assert.equal(report.recommendation.production_concurrency, null);
assert.equal(report.recommendation.screen_candidate_concurrency, report.screening_result.selected_concurrency);
assert.equal(report.cooldown_between_levels_ms, 0);

const endpointModeReport = await runConcurrencySweep({
  assets: ["a"], levels: [2], executionMode: SWEEP_EXECUTION_MODES.ENDPOINT,
  requestCard: async () => ({ ok: true, status: 200, provider_call_count: 1 })
});
assert.equal(endpointModeReport.boundary.endpoint_path, "/api/csm-listing-title");
assert.equal(endpointModeReport.boundary.csm_endpoint_orchestration, true);

const providerModeReport = await runConcurrencySweep({
  assets: ["a"], levels: [2], executionMode: SWEEP_EXECUTION_MODES.PROVIDER_DIRECT,
  requestCard: async () => ({ ok: true, status: 200, provider_call_count: 1 })
});
assert.equal(providerModeReport.execution_mode, "OPENAI_PROVIDER_DIRECT");
assert.equal(providerModeReport.boundary.endpoint_path, null,
  "provider-direct must not claim it traversed /api/csm-listing-title");
assert.equal(providerModeReport.boundary.provider_url, "https://api.openai.com/v1/responses");
assert.equal(providerModeReport.boundary.csm_endpoint_orchestration, false);

const signingModeReport = await runConcurrencySweep({
  assets: ["a"], levels: [2], executionMode: SWEEP_EXECUTION_MODES.SIGNING_ONLY,
  requestCard: async () => ({
    ok: true, status: 200, provider_call_count: 0,
    image_signing_call_count: 1, image_signing_ms: 3,
    cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0
  })
});
assert.equal(signingModeReport.boundary.kind, "SUPABASE_SIGNING_ONLY");
assert.equal(signingModeReport.boundary.provider_url, null);
assert.equal(signingModeReport.boundary.provider_phase, "NOT_CALLED");
assert.equal(signingModeReport.levels[0].provider_call_count, 0);
assert.equal(signingModeReport.levels[0].image_signing_call_count, 1);

const presignedModeReport = await runConcurrencySweep({
  assets: ["a"], levels: [2], executionMode: SWEEP_EXECUTION_MODES.PROVIDER_DIRECT_PRESIGNED,
  requestCard: async () => ({
    ok: true, status: 200, provider_call_count: 1,
    image_signing_call_count: 0, image_signing_ms: 0,
    cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0
  })
});
assert.equal(presignedModeReport.boundary.endpoint_path, null);
assert.equal(presignedModeReport.boundary.signing_phase, "PREFLIGHT_OUTSIDE_TIMED_SWEEP");
assert.equal(presignedModeReport.boundary.provider_phase, "TIMED_SWEEP");
const textControlModeReport = await runConcurrencySweep({
  assets: ["control-1"], levels: [2], executionMode: SWEEP_EXECUTION_MODES.PROVIDER_TEXT_CONTROL,
  requestCard: async () => ({
    ok: true, status: 200, provider_call_count: 1, http_attempt_count: 1,
    image_signing_call_count: 0, image_signing_ms: 0, openai_provider_ms: 2,
    input_tokens: 12, output_tokens: 5,
    cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0
  })
});
assert.equal(textControlModeReport.boundary.kind, "TEXT_ONLY_NO_IMAGE_FETCH");
assert.equal(textControlModeReport.boundary.input_modality, "TEXT_ONLY");
assert.equal(textControlModeReport.boundary.image_fetch_calls_per_card, 0);
assert.equal(textControlModeReport.boundary.card_recognition_quality_evidence, false);
assert.equal(textControlModeReport.evidence_scope, "OPENAI_TEXT_NETWORK_CONTROL_ONLY");
assert.equal(textControlModeReport.card_recognition_quality_evidence, false);
assert.equal(textControlModeReport.production_recommendation, false);
assert.equal(textControlModeReport.recommendation.production_concurrency, null);
assert.equal(textControlModeReport.recommendation.screen_candidate_concurrency, null);
assert.equal(textControlModeReport.recommendation.network_control_candidate_concurrency, 2);
await assert.rejects(
  main(["--signing-only", "--provider-direct-presigned"], {}),
  /choose_one_real_mode/,
  "node-isolation CLI modes must be mutually exclusive"
);
await assert.rejects(
  main(["--provider-direct", "--provider-text-control"], {}),
  /choose_one_real_mode/,
  "text control must be mutually exclusive with every image-bearing real mode"
);
await assert.rejects(
  main(["--provider-text-control", "--mock-cards", "3", "--limit", "2"], {}),
  /provider_direct_credentials_required/,
  "text control may generate control assets without requiring --assets"
);

const builtTextControl = buildProviderTextControlRequest({ model: "gpt-5.6-luna", effort: "none" });
assert.equal(builtTextControl.model, "gpt-5.6-luna");
assert.deepEqual(builtTextControl.reasoning, { effort: "none" });
assert.equal(builtTextControl.text.format.type, "json_schema");
assert.equal(builtTextControl.text.format.schema.properties.control.enum[0], "ok");
assert.equal(builtTextControl.input[0].content.length, 1);
assert.equal(builtTextControl.input[0].content[0].type, "input_text");
assert.doesNotMatch(JSON.stringify(builtTextControl), /input_image|image_url/);

let textControlFetches = 0;
let textControlClock = 0;
const textControlRequester = createProviderTextControlRequester({
  apiKey: "sk-test-1234567890123456",
  model: "gpt-5.6-luna",
  effort: "none",
  now: () => textControlClock,
  fetchImpl: async (url, init) => {
    textControlFetches += 1;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-5.6-luna");
    assert.deepEqual(body.reasoning, { effort: "none" });
    assert.doesNotMatch(init.body, /input_image|image_url|must-not-be-read\.jpg|control-asset/);
    textControlClock += 23;
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999",
        "retry-after": "1"
      }),
      json: async () => ({
        output_text: JSON.stringify({ control: "ok" }),
        usage: { input_tokens: 12, output_tokens: 5 }
      })
    };
  }
});
const textControlResult = await textControlRequester({
  asset_id: "control-asset",
  images: [{ image_url: "https://must-not-be-read.jpg" }]
});
assert.equal(textControlFetches, 1);
assert.equal(textControlResult.ok, true);
assert.equal(textControlResult.provider_call_count, 1);
assert.equal(textControlResult.http_attempt_count, 1);
assert.equal(textControlResult.image_signing_call_count, 0);
assert.equal(textControlResult.openai_provider_ms, 23);
assert.equal(textControlResult.input_tokens, 12);
assert.equal(textControlResult.output_tokens, 5);
assert.equal(textControlResult.rate_limit_headers["x-ratelimit-remaining-requests"], "4999");
assert.equal(textControlResult.retry_after, "1");

const waits = [];
await runConcurrencySweep({
  assets: ["a"], levels: [2, 4, 6], cooldownMs: 61_000,
  wait: async (ms) => { waits.push(ms); },
  requestCard: async () => ({ ok: true, status: 200, provider_call_count: 1 })
});
assert.deepEqual(waits, [61_000, 61_000], "real levels need independent rate-limit windows");

let fetchCalls = 0;
const direct = createDirectEndpointRequester({
  endpoint: "https://example.invalid/api/csm-listing-title",
  authorization: "Bearer test",
  fetchImpl: async (url, init) => {
    fetchCalls += 1;
    assert.equal(new URL(url).pathname, "/api/csm-listing-title");
    assert.equal(init.headers.authorization, "Bearer test");
    assert.deepEqual(JSON.parse(init.body), { asset_id: "asset-1" });
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, cloud_run_calls: 0, vector_calls: 0, input_tokens: 9, output_tokens: 3 })
    };
  }
});
assert.equal((await direct({ asset_id: "asset-1" })).provider_call_count, 1);
assert.equal(fetchCalls, 1);
assert.throws(
  () => createDirectEndpointRequester({ endpoint: "https://example.invalid/api/v4/listing-job-enqueue" }),
  /real_mode_requires_direct_endpoint/,
  "the real benchmark must not be repointed at the queue, Cloud Run, vector, or OCR chain"
);

const waitForAbort = (signal) => new Promise((resolve, reject) => {
  assert.ok(signal instanceof AbortSignal, "every network boundary must receive an AbortSignal");
  if (signal.aborted) {
    reject(signal.reason);
    return;
  }
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

const networkSecret = "sk-network-secret-1234567890";
const makeNetworkFailure = ({
  name = "ConnectTimeoutError",
  code = "UND_ERR_CONNECT_TIMEOUT",
  message = `connect failed https://private.invalid/path?key=${networkSecret} authorization: Bearer ${networkSecret}`
} = {}) => Object.assign(new TypeError("fetch failed"), {
  cause: { name, code, message }
});

const endpointNetworkResult = await createDirectEndpointRequester({
  endpoint: "https://example.invalid/api/csm-listing-title",
  fetchImpl: async () => { throw makeNetworkFailure(); }
})({ asset_id: "network-endpoint" });
assert.equal(endpointNetworkResult.http_attempt_count, 1);
assert.equal(endpointNetworkResult.provider_call_count, null);
assert.equal(endpointNetworkResult.timed_out, false);
assert.equal(endpointNetworkResult.network_error.name, "ConnectTimeoutError");
assert.equal(endpointNetworkResult.network_error.code, "UND_ERR_CONNECT_TIMEOUT");
assert.match(endpointNetworkResult.network_error.message, /connect failed \[redacted-url\].*\[redacted\]/);
assert.doesNotMatch(JSON.stringify(endpointNetworkResult), /private\.invalid|sk-network-secret|Bearer sk-/);

const endpointNetworkSummary = await runConcurrencySweep({
  assets: ["n1", "n2"], levels: [2], executionMode: SWEEP_EXECUTION_MODES.ENDPOINT,
  requestCard: async (_, { index }) => index === 0
    ? endpointNetworkResult
    : {
      ...endpointNetworkResult,
      network_error: {
        name: "SocketError", code: "ECONNRESET",
        message: `reset https://private.invalid/${networkSecret}`
      }
    }
});
assert.equal(endpointNetworkSummary.levels[0].network_errors.count, 2);
assert.deepEqual(endpointNetworkSummary.levels[0].network_errors.by_code, {
  UND_ERR_CONNECT_TIMEOUT: 1,
  ECONNRESET: 1
});
assert.equal(
  Object.values(endpointNetworkSummary.levels[0].network_errors.by_message).reduce((sum, count) => sum + count, 0),
  2,
  "network errors must also be grouped by their redacted cause message"
);
assert.doesNotMatch(JSON.stringify(endpointNetworkSummary), /private\.invalid|sk-network-secret/);

const textControlNetworkResult = await createProviderTextControlRequester({
  apiKey: "sk-test-1234567890123456",
  fetchImpl: async () => { throw makeNetworkFailure({ code: "ECONNRESET", name: "SocketError" }); }
})({ asset_id: "ignored", images: [{ image_url: "https://ignored.invalid" }] });
assert.equal(textControlNetworkResult.http_attempt_count, 1);
assert.equal(textControlNetworkResult.provider_call_count, 1);
assert.equal(textControlNetworkResult.image_signing_call_count, 0);
assert.equal(textControlNetworkResult.network_error.code, "ECONNRESET");
assert.doesNotMatch(JSON.stringify(textControlNetworkResult), /private\.invalid|sk-network-secret|ignored\.invalid/);

const textControlTimeoutResult = await createProviderTextControlRequester({
  apiKey: "sk-test-1234567890123456",
  providerTimeoutMs: 5,
  fetchImpl: async (_, init) => waitForAbort(init.signal)
})({ asset_id: "timeout-control" });
assert.equal(textControlTimeoutResult.timed_out, true);
assert.equal(textControlTimeoutResult.timeout_stage, "openai_provider");
assert.equal(textControlTimeoutResult.provider_call_count, 1);
assert.equal(textControlTimeoutResult.http_attempt_count, 1);

const endpointTimeoutResult = await createDirectEndpointRequester({
  endpoint: "https://example.invalid/api/csm-listing-title",
  timeoutMs: 5,
  fetchImpl: async (_, init) => waitForAbort(init.signal)
})({ asset_id: "timeout-endpoint" });
assert.equal(endpointTimeoutResult.timed_out, true);
assert.equal(endpointTimeoutResult.timeout_stage, "csm_direct_endpoint");
assert.equal(endpointTimeoutResult.timeout_ms, 5);
assert.equal(endpointTimeoutResult.error, "REQUEST_TIMEOUT");

const timeoutSummaryReport = await runConcurrencySweep({
  assets: ["timeout-endpoint"], levels: [1], executionMode: SWEEP_EXECUTION_MODES.ENDPOINT,
  requestCard: async () => endpointTimeoutResult
});
assert.equal(timeoutSummaryReport.levels[0].timeouts.count, 1);
assert.deepEqual(timeoutSummaryReport.levels[0].timeouts.by_stage, { csm_direct_endpoint: 1 });

const endpoint429 = createDirectEndpointRequester({
  endpoint: "https://example.invalid/api/csm-listing-title",
  fetchImpl: async () => ({
    ok: false,
    status: 429,
    headers: new Headers({
      "retry-after": "17",
      "x-ratelimit-limit-requests": "60",
      "x-ratelimit-remaining-requests": "0",
      "x-ratelimit-reset-requests": "17s"
    }),
    json: async () => ({ code: "RATE_LIMITED", provider_calls: 0 })
  })
});
const endpoint429Result = await endpoint429({ asset_id: "rate-limited-endpoint" });
assert.equal(endpoint429Result.status, 429);
assert.equal(endpoint429Result.retry_after, "17");
assert.equal(endpoint429Result.rate_limit_headers["x-ratelimit-remaining-requests"], "0");

const canonicalPayload = {
  year: "2024", language: "", manufacturer: "Panini", product: "Prizm", set: "",
  subjects: ["Test Player"], team: "Lakers", card_name: "", release_variant: "",
  surface_color: "Blue", parallel_family: "Prizm", parallel_exact: "",
  descriptive_rarity: "", card_number: "1", serial: "", attributes: [], grade: "",
  grammar: "standard", lot_count: "", unreadable: [], low_confidence: []
};
let providerFetches = 0;
let providerClock = 0;
const providerDirect = createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  apiKey: "sk-test-1234567890123456",
  now: () => providerClock,
  fetchImpl: async (url) => {
    providerFetches += 1;
    if (String(url).includes("/storage/v1/object/sign/")) {
      providerClock += 7;
      return { ok: true, status: 200, json: async () => ({ signedURL: "/object/sign/cards/a.jpg?token=x" }) };
    }
    assert.equal(url, "https://api.openai.com/v1/responses");
    providerClock += 40;
    return {
      ok: true, status: 200,
      headers: new Headers({
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999",
        "x-ratelimit-reset-requests": "12ms",
        "x-ratelimit-limit-tokens": "2000000",
        "x-ratelimit-remaining-tokens": "1990000",
        "x-ratelimit-reset-tokens": "300ms"
      }),
      json: async () => ({ output_text: JSON.stringify(canonicalPayload), usage: { input_tokens: 100, output_tokens: 40 } })
    };
  }
});
const providerResult = await providerDirect({ images: [{ bucket: "cards", object_path: "a.jpg" }] });
assert.equal(providerResult.ok, true);
assert.equal(providerResult.provider_call_count, 1);
assert.equal(providerResult.cloud_run_calls, 0);
assert.equal(providerResult.vector_calls, 0);
assert.equal(providerResult.ocr_calls, 0);
assert.equal(providerResult.image_signing_ms, 7);
assert.equal(providerResult.openai_provider_ms, 40);
assert.equal(providerResult.composer_ms, 0);
assert.equal(providerResult.rate_limit_headers["x-ratelimit-remaining-requests"], "4999");
assert.equal(providerFetches, 2);

let signingOnlyFetches = 0;
const signingOnlyRequester = createSupabaseSigningRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  fetchImpl: async (url, init) => {
    signingOnlyFetches += 1;
    assert.match(String(url), /\/storage\/v1\/object\/sign\//);
    assert.ok(init.signal instanceof AbortSignal);
    return { ok: true, status: 200, json: async () => ({ signedURL: `/signed-${signingOnlyFetches}` }) };
  }
});
const signingOnlyResult = await signingOnlyRequester({ images: [
  { bucket: "cards", object_path: "front.jpg" },
  { bucket: "cards", object_path: "back.jpg" }
] });
assert.equal(signingOnlyResult.ok, true);
assert.equal(signingOnlyResult.provider_call_count, 0);
assert.equal(signingOnlyResult.image_signing_call_count, 2);
assert.equal(signingOnlyFetches, 2, "signing-only must never reach OpenAI");
assert.equal(signingOnlyResult.signed_image_urls.length, 2);

const signingNetworkResult = await createSupabaseSigningRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  fetchImpl: async () => { throw makeNetworkFailure({ code: "ECONNRESET", name: "SocketError" }); }
})({ images: [{ bucket: "cards", object_path: "network.jpg" }] });
assert.equal(signingNetworkResult.http_attempt_count, 1);
assert.equal(signingNetworkResult.image_signing_call_count, 1);
assert.equal(signingNetworkResult.provider_call_count, 0);
assert.equal(signingNetworkResult.network_error.code, "ECONNRESET");
assert.doesNotMatch(JSON.stringify(signingNetworkResult), /private\.invalid|sk-network-secret|sb_secret_test/);

const presignedNetworkResult = await createPresignedProviderRequester({
  apiKey: "sk-test-1234567890123456",
  fetchImpl: async () => { throw makeNetworkFailure(); }
})({ pre_signed_image_urls: ["https://already-signed.invalid/image"] });
assert.equal(presignedNetworkResult.http_attempt_count, 1);
assert.equal(presignedNetworkResult.provider_call_count, 1,
  "a provider fetch without an HTTP response was still a started paid request");
assert.equal(presignedNetworkResult.image_signing_call_count, 0);
assert.equal(presignedNetworkResult.network_error.code, "UND_ERR_CONNECT_TIMEOUT");
assert.doesNotMatch(JSON.stringify(presignedNetworkResult), /private\.invalid|sk-network-secret/);

let combinedNetworkFetches = 0;
const combinedNetworkResult = await createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  apiKey: "sk-test-1234567890123456",
  fetchImpl: async (url) => {
    combinedNetworkFetches += 1;
    if (String(url).includes("/storage/v1/object/sign/")) {
      return { ok: true, status: 200, json: async () => ({ signedURL: "/signed" }) };
    }
    throw makeNetworkFailure();
  }
})({ images: [{ bucket: "cards", object_path: "network-provider.jpg" }] });
assert.equal(combinedNetworkFetches, 2);
assert.equal(combinedNetworkResult.http_attempt_count, 2,
  "combined mode must count one signing fetch plus one started provider fetch");
assert.equal(combinedNetworkResult.image_signing_call_count, 1);
assert.equal(combinedNetworkResult.provider_call_count, 1);
assert.equal(combinedNetworkResult.network_error.code, "UND_ERR_CONNECT_TIMEOUT");

let preflightSignCalls = 0;
let presignedProviderCalls = 0;
const isolatedFetch = async (url, init) => {
  if (String(url).includes("/storage/v1/object/sign/")) {
    preflightSignCalls += 1;
    const objectPath = decodeURIComponent(String(url).split("/").at(-1));
    return { ok: true, status: 200, json: async () => ({ signedURL: `/signed-${objectPath}` }) };
  }
  assert.equal(url, "https://api.openai.com/v1/responses");
  presignedProviderCalls += 1;
  const imageInputs = JSON.parse(init.body).input[0].content.filter((part) => part.type === "input_image");
  assert.equal(imageInputs.length, 1);
  assert.match(imageInputs[0].image_url, /^https:\/\/example\.supabase\.co\/storage\/v1\/signed-/);
  return {
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ output_text: JSON.stringify(canonicalPayload), usage: {} })
  };
};
const preflightSigner = createSupabaseSigningRequester({
  supabaseUrl: "https://example.supabase.co", serviceKey: "sb_secret_test", fetchImpl: isolatedFetch
});
const presignedRequester = createPresignedProviderRequester({
  apiKey: "sk-test-1234567890123456", fetchImpl: isolatedFetch
});
const isolatedReport = await runPresignedProviderSweep({
  assets: [
    { asset_id: "pre-1", images: [{ bucket: "cards", object_path: "one.jpg" }] },
    { asset_id: "pre-2", images: [{ bucket: "cards", object_path: "two.jpg" }] }
  ],
  levels: [1, 2],
  signAsset: preflightSigner,
  requestCard: presignedRequester,
  preflightConcurrency: 2
});
assert.equal(preflightSignCalls, 2, "each asset must be signed once before all timed levels");
assert.equal(presignedProviderCalls, 4, "two assets across two levels require four provider calls");
assert.equal(isolatedReport.preflight.succeeded_asset_count, 2);
assert.equal(isolatedReport.preflight.failed_asset_count, 0);
assert.equal(isolatedReport.preflight.image_signing_call_count, 2);
assert.equal(isolatedReport.preflight.provider_call_count, 0);
assert.equal(isolatedReport.boundary.signing_phase, "PREFLIGHT_OUTSIDE_TIMED_SWEEP");
assert.deepEqual(isolatedReport.levels.map((level) => level.image_signing_call_count), [0, 0]);
assert.deepEqual(isolatedReport.levels.map((level) => level.provider_call_count), [2, 2]);

let providerCallsAfterFailedPreflight = 0;
const failedPreflightReport = await runPresignedProviderSweep({
  assets: [{ asset_id: "good" }, { asset_id: "bad" }],
  levels: [2, 4],
  signAsset: async (asset) => asset.asset_id === "bad"
    ? { ok: false, status: 503, provider_call_count: 0, error: "signing_unavailable" }
    : { ok: true, status: 200, provider_call_count: 0, image_signing_call_count: 1, signed_image_urls: ["https://signed"] },
  requestCard: async () => {
    providerCallsAfterFailedPreflight += 1;
    return { ok: true, status: 200, provider_call_count: 1 };
  }
});
assert.equal(failedPreflightReport.study_phase, "PREFLIGHT_FAILED");
assert.equal(failedPreflightReport.preflight.failed_asset_count, 1);
assert.deepEqual(failedPreflightReport.levels, []);
assert.equal(providerCallsAfterFailedPreflight, 0, "partial preflight must fail closed before paid provider traffic");

let signingTimeoutFetches = 0;
const signingTimeoutRequester = createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  apiKey: "sk-test-1234567890123456",
  signingTimeoutMs: 5,
  fetchImpl: async (_, init) => {
    signingTimeoutFetches += 1;
    return waitForAbort(init.signal);
  }
});
const signingTimeoutResult = await signingTimeoutRequester({
  images: [{ bucket: "cards", object_path: "slow.jpg" }]
});
assert.equal(signingTimeoutResult.timed_out, true);
assert.equal(signingTimeoutResult.timeout_stage, "supabase_image_signing");
assert.equal(signingTimeoutResult.timeout_ms, 5);
assert.equal(signingTimeoutResult.provider_call_count, 0);
assert.equal(signingTimeoutFetches, 1, "a signing timeout must not continue to OpenAI");

let openAiTimeoutFetches = 0;
const openAiTimeoutRequester = createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  apiKey: "sk-test-1234567890123456",
  providerTimeoutMs: 5,
  fetchImpl: async (url, init) => {
    openAiTimeoutFetches += 1;
    if (String(url).includes("/storage/v1/object/sign/")) {
      assert.ok(init.signal instanceof AbortSignal);
      return { ok: true, status: 200, json: async () => ({ signedURL: "/signed" }) };
    }
    return waitForAbort(init.signal);
  }
});
const openAiTimeoutResult = await openAiTimeoutRequester({
  images: [{ bucket: "cards", object_path: "slow-provider.jpg" }]
});
assert.equal(openAiTimeoutResult.timed_out, true);
assert.equal(openAiTimeoutResult.timeout_stage, "openai_provider");
assert.equal(openAiTimeoutResult.timeout_ms, 5);
assert.equal(openAiTimeoutResult.provider_call_count, 1);
assert.equal(openAiTimeoutFetches, 2);

let invalidKeyFetches = 0;
assert.throws(() => createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "sb_secret_test",
  apiKey: "not-an-openai-key",
  fetchImpl: async () => { invalidKeyFetches += 1; }
}), /openai_api_key_invalid_shape/);
assert.equal(invalidKeyFetches, 0, "an invalid key must fail before image signing or provider traffic");

let activeSigns = 0;
let maxActiveSigns = 0;
let releaseSigns;
const signsReady = new Promise((resolve) => { releaseSigns = resolve; });
const parallelSigner = createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co", serviceKey: "sb_secret_test",
  apiKey: "sk-test-1234567890123456",
  fetchImpl: async (url, init) => {
    if (String(url).includes("/storage/v1/object/sign/")) {
      activeSigns += 1;
      maxActiveSigns = Math.max(maxActiveSigns, activeSigns);
      if (activeSigns === 2) releaseSigns();
      await signsReady;
      activeSigns -= 1;
      const name = String(url).includes("front.jpg") ? "front" : "back";
      return { ok: true, status: 200, json: async () => ({ signedURL: `/signed-${name}` }) };
    }
    const imageInputs = JSON.parse(init.body).input[0].content.filter((part) => part.type === "input_image");
    assert.deepEqual(imageInputs.map((part) => part.image_url), [
      "https://example.supabase.co/storage/v1/signed-front",
      "https://example.supabase.co/storage/v1/signed-back"
    ], "Promise.all must retain front/back input order even if signing completion order differs");
    return {
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ output_text: JSON.stringify(canonicalPayload), usage: {} })
    };
  }
});
await parallelSigner({ images: [
  { bucket: "cards", object_path: "front.jpg" },
  { bucket: "cards", object_path: "back.jpg" }
] });
assert.equal(maxActiveSigns, 2, "front/back signing must overlap instead of serially awaiting each URL");

let failureFetch = 0;
const rateLimitedProvider = createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co", serviceKey: "sb_secret_test", apiKey: "sk-test-1234567890123456",
  fetchImpl: async () => {
    failureFetch += 1;
    if (failureFetch === 1) return { ok: true, status: 200, json: async () => ({ signedURL: "/signed" }) };
    return {
      ok: false, status: 429,
      headers: new Headers({
        "retry-after": "2",
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "0"
      }),
      json: async () => ({ error: { message: "rate limited" } })
    };
  }
});
const rateLimitedResult = await rateLimitedProvider({ images: [{ bucket: "cards", object_path: "a.jpg" }] });
assert.equal(rateLimitedResult.status, 429);
assert.equal(rateLimitedResult.rate_limit_headers["x-ratelimit-limit-requests"], "5000");
assert.equal(rateLimitedResult.rate_limit_headers["x-ratelimit-remaining-requests"], "0");
assert.equal(rateLimitedResult.retry_after, "2");
const rateLimitedSummary = await runConcurrencySweep({
  assets: ["rate-limited"], levels: [1], executionMode: SWEEP_EXECUTION_MODES.PROVIDER_DIRECT,
  requestCard: async () => rateLimitedResult
});
assert.equal(rateLimitedSummary.levels[0].http_429_count, 1);
assert.deepEqual(rateLimitedSummary.levels[0].retry_after_values, ["2"]);
assert.equal(rateLimitedSummary.levels[0].cards[0].rate_limit_headers["x-ratelimit-remaining-requests"], "0");

let authProviderCalls = 0;
const unauthorizedProvider = createDirectProviderRequester({
  supabaseUrl: "https://example.supabase.co", serviceKey: "sb_secret_test",
  apiKey: "sk-test-1234567890123456",
  fetchImpl: async (url) => {
    if (String(url).includes("/storage/v1/object/sign/")) {
      return { ok: true, status: 200, json: async () => ({ signedURL: "/signed" }) };
    }
    authProviderCalls += 1;
    return {
      ok: false, status: 401, headers: new Headers(),
      json: async () => ({ error: { message: "invalid api key" } })
    };
  }
});
const authFailureSweep = await runConcurrencySweep({
  assets: Array.from({ length: 8 }, (_, index) => ({
    asset_id: `auth-${index}`, images: [{ bucket: "cards", object_path: `${index}.jpg` }]
  })),
  levels: [2, 4],
  requestCard: unauthorizedProvider
});
assert.equal(authFailureSweep.terminated_early, true);
assert.equal(authFailureSweep.fail_fast.status, 401);
assert.equal(authFailureSweep.levels.length, 1, "authorization failure must prevent later levels from starting");
assert.ok(authProviderCalls >= 1 && authProviderCalls <= 2,
  "only requests already in flight at the first 401 may reach the provider");
assert.equal(authFailureSweep.levels[0].attempted_count, authProviderCalls);

let summaryClock = 0;
const providerSummary = await runConcurrencySweep({
  assets: ["a", "b"], levels: [2], now: () => summaryClock,
  requestCard: async (_, { index }) => {
    summaryClock += 100;
    return {
      ok: true, status: 200, provider_call_count: 1,
      image_signing_ms: 5 + index, openai_provider_ms: 30 + index * 10, composer_ms: 1 + index,
      cloud_run_calls: 0, vector_calls: 0,
      rate_limit_headers: {
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": String(4999 - index),
        "x-ratelimit-reset-requests": "20ms",
        "x-ratelimit-limit-tokens": "2000000",
        "x-ratelimit-remaining-tokens": String(1990000 - index * 1000),
        "x-ratelimit-reset-tokens": "300ms"
      }
    };
  }
});
const providerLevel = providerSummary.levels[0];
assert.equal(providerLevel.stage_latency.openai_provider.p95_ms, 40);
assert.equal(providerLevel.stage_latency.openai_provider.max_ms, 40);
assert.deepEqual(providerLevel.rate_limits.requests.observed_limits, [5000]);
assert.equal(providerLevel.rate_limits.requests.minimum_remaining, 4998);
assert.equal(providerLevel.rate_limits.tokens.minimum_remaining, 1989000);

const source = await readFile(new URL("./run-csm-direct-concurrency-sweep.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /from\s+["'][^"']*(?:recognition-worker|vector-worker|ocr)[^"']*["']/i);
assert.match(source, /MOCK_NO_NETWORK/);
assert.match(source, /argv\.includes\("--real"\)/);
assert.match(source, /argv\.includes\("--signing-only"\)/);
assert.match(source, /argv\.includes\("--provider-direct-presigned"\)/);
assert.match(source, /argv\.includes\("--provider-text-control"\)/);
assert.match(source, /TEXT_ONLY_NO_IMAGE_FETCH/);
assert.match(source, /argValue\(argv, "--preflight-concurrency"/);
assert.match(source, /argValue\(argv, "--limit"\)/);
assert.match(source, /study_phase: "SCREEN"/);
assert.match(source, /AbortController/);

console.log("CSM direct concurrency sweep tests passed");
