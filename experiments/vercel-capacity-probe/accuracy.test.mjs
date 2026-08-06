import assert from "node:assert/strict";

import {
  normalizedPayload,
  payloadIdentity,
  requestForAsset,
  runAccuracyArm
} from "./api/accuracy.js";
import { requestIdentity } from "./request-contract.mjs";

const baseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["year"],
  properties: { year: { type: ["string", "null"] } }
};
const residualProperty = {
  type: "array",
  maxItems: 4,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["text", "target", "anchor"],
    properties: {
      text: { type: "string" },
      target: { type: "string" },
      anchor: { type: "string" }
    }
  }
};

function template({ residual = false } = {}) {
  const schema = structuredClone(baseSchema);
  if (residual) {
    schema.required.push("residual_evidence");
    schema.properties.residual_evidence = residualProperty;
  }
  return {
    model: "gpt-5.6-luna",
    max_output_tokens: 4096,
    reasoning: { effort: "none" },
    input: [{ role: "user", content: [{ type: "input_text", text: residual ? "prompt residual" : "prompt" }] }],
    text: {
      format: {
        type: "json_schema",
        name: residual ? "canonical_card_fields_residual_v1" : "canonical_card_fields",
        strict: true,
        schema
      }
    }
  };
}

const asset = {
  asset_id: "asset-1",
  image_set_sha256: "a".repeat(64),
  image_urls: [
    "https://irpgnhkslrsiucybkufc.supabase.co/storage/v1/object/sign/listing-card-images/front.jpg?token=one",
    "https://irpgnhkslrsiucybkufc.supabase.co/storage/v1/object/sign/listing-card-images/back.jpg?token=two"
  ]
};

function frozenContract(value) {
  const identity = requestIdentity(requestForAsset(value, [
    "https://contract.invalid/front",
    "https://contract.invalid/back"
  ]));
  return {
    normalized_request_sha256: identity.normalized_request_sha256,
    normalized_request_bytes: identity.normalized_request_bytes,
    contract_wire_sha256: identity.wire_sha256,
    contract_wire_bytes: identity.wire_bytes
  };
}

const canonicalTemplate = template();
const residualTemplate = template({ residual: true });
const frozenContracts = {
  canonical_high: frozenContract(canonicalTemplate),
  canonical_residual_v1_high: frozenContract(residualTemplate)
};
const env = {
  VERCEL_ENV: "preview",
  VERCEL_REGION: "sin1",
  LYNCA_CLOUD_SIM_ENABLED: "true",
  LYNCA_CLOUD_SIM_RUN_TOKEN: "test-run-token",
  LYNCA_CLOUD_SIM_STORAGE_HOST: "irpgnhkslrsiucybkufc.supabase.co",
  OPENAI_API_KEY: "test-openai-key"
};

const canonical = normalizedPayload({
  run_id: "canonical-run-001",
  arm_id: "canonical_high",
  request_template: canonicalTemplate,
  assets: [asset],
  dry_run: true
}, env, { frozenContracts });
const residual = normalizedPayload({
  run_id: "residual-run-001",
  arm_id: "canonical_residual_v1_high",
  request_template: residualTemplate,
  assets: [asset],
  dry_run: true
}, env, { frozenContracts });

assert.notEqual(payloadIdentity(canonical).request_template_sha256, payloadIdentity(residual).request_template_sha256);
assert.notEqual(
  payloadIdentity(canonical).sample_normalized_request_sha256,
  payloadIdentity(residual).sample_normalized_request_sha256
);
assert.notEqual(
  payloadIdentity(canonical).contract_normalized_request_sha256,
  payloadIdentity(residual).contract_normalized_request_sha256
);
assert.equal((await runAccuracyArm(canonical, { env })).provider_calls, 0);

const request = requestForAsset(template(), asset.image_urls);
assert.equal(request.input[0].content[1].detail, "high");
assert.equal(request.input[0].content[1].image_url, asset.image_urls[0]);

assert.throws(() => normalizedPayload({
  run_id: "wrong-region-run",
  arm_id: "canonical_high",
  request_template: template(),
  assets: [asset]
}, { ...env, VERCEL_REGION: "syd1" }, { frozenContracts }), /sin1_runtime_required/);

assert.throws(() => normalizedPayload({
  run_id: "wrong-host-run",
  arm_id: "canonical_high",
  request_template: template(),
  assets: [{
    ...asset,
    image_urls: [
      "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/sign/a/front?token=x",
      "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/sign/a/back?token=y"
    ]
  }]
}, env, { frozenContracts }), /image_url_not_allowed/);

assert.throws(() => normalizedPayload({
  run_id: "self-consistent-sydney-run",
  arm_id: "canonical_high",
  request_template: canonicalTemplate,
  assets: [{
    ...asset,
    image_urls: [
      "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/sign/a/front?token=x"
    ]
  }]
}, {
  ...env,
  LYNCA_CLOUD_SIM_STORAGE_HOST: "osrrujmpxxiefppjfgpd.supabase.co"
}, { frozenContracts }), /allowed_storage_host_invalid/);

assert.throws(() => normalizedPayload({
  run_id: "wrong-arm-template",
  arm_id: "canonical_residual_v1_high",
  request_template: template(),
  assets: [asset]
}, env, { frozenContracts }), /request_template_schema_invalid|request_template_residual_contract_invalid/);

assert.throws(() => normalizedPayload({
  run_id: "extra-tools-run",
  arm_id: "canonical_high",
  request_template: { ...canonicalTemplate, tools: [{ type: "web_search" }] },
  assets: [asset]
}, env, { frozenContracts }), /request_template_not_frozen/);

assert.throws(() => normalizedPayload({
  run_id: "batch-not-allowed",
  arm_id: "canonical_high",
  request_template: canonicalTemplate,
  assets: [asset, { ...asset, asset_id: "asset-2" }]
}, env, { frozenContracts }), /assets_batch_size_invalid/);

let fetchCalls = 0;
let clock = 0;
const live = normalizedPayload({
  run_id: "canonical-live-001",
  arm_id: "canonical_high",
  request_template: canonicalTemplate,
  assets: [asset],
  concurrency: 1
}, env, { frozenContracts });
const liveReport = await runAccuracyArm(live, {
  env,
  now: () => (clock += 10),
  fetchImpl: async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      id: `resp_${fetchCalls}`,
      model: "gpt-5.6-luna",
      status: "completed",
      incomplete_details: null,
      output: [{ type: "message", content: [{ type: "output_text", text: "{\"year\":\"2024\"}" }] }],
      usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 4000 }, output_tokens: 100 }
    }), {
      status: 200,
      headers: {
        "x-ratelimit-limit-requests": "5000",
        "x-ratelimit-remaining-requests": "4999",
        "x-ratelimit-limit-tokens": "4000000",
        "x-ratelimit-remaining-tokens": "3990000"
      }
    });
  }
});
assert.equal(fetchCalls, 1, "the cloud endpoint must make exactly one call and no retries");
assert.equal(liveReport.provider_calls, 1);
assert.equal(liveReport.provider_retries, 0);
assert.equal(liveReport.succeeded_count, 1);
assert.equal(liveReport.input_tokens, 5000);
assert.equal(liveReport.cached_input_tokens, 4000);
assert.match(liveReport.rows[0].provider_response_raw, /2024/);
assert.equal(liveReport.rows[0].served_model, "gpt-5.6-luna");
assert.match(liveReport.rows[0].provider_response_sha256, /^[0-9a-f]{64}$/);

const oneImagePayload = normalizedPayload({
  run_id: "canonical-one-image",
  arm_id: "canonical_high",
  request_template: canonicalTemplate,
  assets: [{ ...asset, image_urls: [asset.image_urls[0]] }]
}, env, { frozenContracts });
const incomplete = await runAccuracyArm(oneImagePayload, {
  env,
  fetchImpl: async () => new Response(JSON.stringify({
    id: "resp_incomplete",
    model: "gpt-5.6-luna",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [{ type: "message", content: [{ type: "output_text", text: "{\"year\":\"2024\"}" }] }],
    usage: { input_tokens: 5000, output_tokens: 1 }
  }), { status: 200 })
});
assert.equal(incomplete.ok, false);
assert.equal(incomplete.succeeded_count, 0);
assert.equal(incomplete.rows[0].provider_status, "incomplete");
assert.deepEqual(incomplete.rows[0].incomplete_details, { reason: "max_output_tokens" });

process.stdout.write("cloud accuracy endpoint tests passed\n");
