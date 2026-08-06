import assert from "node:assert/strict";
import handler, {
  runHostedCanonicalVisionControl,
  runHostedTextControl,
  runHostedVisionUrlControl,
  TEXT_CONTROL_MAX_BATCH_SIZE,
  VISION_URL_MAX_BATCH_SIZE
} from "./api/control.js";

const apiKey = "sk-test-control-000000000000";
const rateLimitHeaders = new Headers({
  "x-ratelimit-limit-requests": "5000",
  "x-ratelimit-remaining-requests": "4999",
  "x-ratelimit-limit-tokens": "4000000",
  "x-ratelimit-remaining-tokens": "3999999"
});
const monotonicNow = () => {
  let clock = 0;
  return () => ++clock;
};
const successResponse = () => ({
  ok: true,
  status: 200,
  headers: rateLimitHeaders,
  json: async () => ({ model: "gpt-5.6-luna", usage: { input_tokens: 42, output_tokens: 15 } })
});

let active = 0;
let maxActive = 0;
const textRequestBodies = [];
const textReport = await runHostedTextControl({
  apiKey,
  tasks: 12,
  concurrency: 7,
  now: monotonicNow(),
  fetchImpl: async (_url, init) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    textRequestBodies.push(JSON.parse(init.body));
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return successResponse();
  }
});

assert.equal(maxActive, 7);
assert.equal(textReport.succeeded_count, 12);
assert.equal(textReport.failed_count, 0);
assert.equal(textReport.input_tokens, 504);
assert.equal(textReport.cached_input_tokens, 0);
assert.equal(textReport.uncached_input_tokens, 504);
assert.equal(textReport.output_tokens, 180);
assert.equal(textReport.image_input, false);
assert.equal(textReport.production_recommendation, false);
assert.equal(textRequestBodies.some((body) => JSON.stringify(body).includes("input_image")), false);
assert.equal(textRequestBodies.every((body) => body.model === "gpt-5.6-luna"), true);

let textCapCalls = 0;
active = 0;
maxActive = 0;
const textCapReport = await runHostedTextControl({
  apiKey,
  tasks: TEXT_CONTROL_MAX_BATCH_SIZE + 1,
  concurrency: TEXT_CONTROL_MAX_BATCH_SIZE + 1,
  now: monotonicNow(),
  fetchImpl: async () => {
    textCapCalls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return successResponse();
  }
});
assert.equal(textCapCalls, TEXT_CONTROL_MAX_BATCH_SIZE);
assert.equal(textCapReport.tasks, TEXT_CONTROL_MAX_BATCH_SIZE);
assert.equal(textCapReport.concurrency, TEXT_CONTROL_MAX_BATCH_SIZE);
assert.equal(maxActive, TEXT_CONTROL_MAX_BATCH_SIZE);

const visionAssets = Array.from({ length: 12 }, (_, index) => ({
  asset_id: `asset-${index + 1}`,
  image_urls: [
    `https://images.example.test/${index + 1}-front.jpg?sig=front-${index + 1}`,
    ...(index % 2 === 0 ? [`https://images.example.test/${index + 1}-back.jpg?sig=back-${index + 1}`] : [])
  ]
}));
const visionRequestBodies = [];
active = 0;
maxActive = 0;
const visionReport = await runHostedVisionUrlControl({
  apiKey,
  assets: visionAssets,
  concurrency: 7,
  now: monotonicNow(),
  fetchImpl: async (_url, init) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    visionRequestBodies.push(JSON.parse(init.body));
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return successResponse();
  }
});

assert.equal(maxActive, 7);
assert.equal(visionReport.evidence_scope, "VERCEL_TO_OPENAI_VISION_URL_CONTROL");
assert.equal(visionReport.image_input, true);
assert.equal(visionReport.production_recommendation, false);
assert.equal(visionReport.model, "gpt-5.6-luna");
assert.equal(visionReport.effort, "none");
assert.equal(visionReport.tasks, 12);
assert.deepEqual(visionReport.rows.map((row) => row.asset_id), visionAssets.map((asset) => asset.asset_id));
assert.equal(Object.hasOwn(visionReport, "accuracy"), false);
assert.equal(visionRequestBodies.length, 12);
assert.equal(visionRequestBodies.every((body) => body.model === "gpt-5.6-luna"), true);
assert.equal(visionRequestBodies.every((body) => body.reasoning?.effort === "none"), true);
assert.equal(visionRequestBodies.every((body) => body.text?.format?.strict === true), true);
assert.equal(visionRequestBodies.every((body) => body.text?.format?.schema?.properties?.control?.enum?.[0] === "ok"), true);
assert.equal(visionRequestBodies.every((body) => {
  const images = body.input?.[0]?.content?.filter((part) => part.type === "input_image") || [];
  return images.length >= 1 && images.length <= 2 && images.every((image) => image.detail === "high");
}), true);
const serializedVisionReport = JSON.stringify(visionReport);
assert.equal(visionAssets.some((asset) => asset.image_urls.some((url) => serializedVisionReport.includes(url))), false);

const canonicalTemplate = {
  model: "gpt-5.6-luna",
  max_output_tokens: 4096,
  reasoning: { effort: "none" },
  text: {
    format: {
      type: "json_schema",
      name: "canonical_card_fields",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["year"],
        properties: { year: { type: "string" } }
      }
    }
  },
  input: [{
    role: "user",
    content: [{ type: "input_text", text: "Read every canonical field printed on this card." }]
  }]
};
const canonicalBodies = [];
const canonicalReport = await runHostedCanonicalVisionControl({
  apiKey,
  assets: visionAssets.slice(0, 3),
  requestTemplate: canonicalTemplate,
  concurrency: 3,
  now: monotonicNow(),
  fetchImpl: async (_url, init) => {
    canonicalBodies.push(JSON.parse(init.body));
    return successResponse();
  }
});
assert.equal(canonicalReport.succeeded_count, 3);
assert.equal(canonicalReport.request_kind, "canonical_card_fields");
assert.match(canonicalReport.request_template_sha256, /^[0-9a-f]{64}$/);
assert.equal(canonicalReport.evidence_scope, "VERCEL_TO_OPENAI_CANONICAL_VISION_CAPACITY");
assert.equal(canonicalBodies.every((body) => body.input[0].content[0].type === "input_text"), true);
assert.equal(canonicalBodies.every((body) => body.input[0].content.filter((part) => part.type === "input_image").length >= 1), true);
assert.equal(canonicalBodies.every((body) => body.text.format.name === "canonical_card_fields"), true);
assert.equal(visionAssets.some((asset) => asset.image_urls.some((url) => JSON.stringify(canonicalReport).includes(url))), false);

await assert.rejects(
  () => runHostedCanonicalVisionControl({
    apiKey,
    assets: visionAssets.slice(0, 1),
    requestTemplate: { ...canonicalTemplate, model: "other-model" }
  }),
  /canonical_request_template_model_invalid/
);
await assert.rejects(
  () => runHostedCanonicalVisionControl({
    apiKey,
    assets: visionAssets.slice(0, 1),
    requestTemplate: {
      ...canonicalTemplate,
      input: [{ role: "user", content: [
        canonicalTemplate.input[0].content[0],
        { type: "input_image", image_url: "https://unexpected.test/image.jpg" }
      ] }]
    }
  }),
  /canonical_request_template_prompt_invalid/
);

const maximumVisionAssets = Array.from({ length: VISION_URL_MAX_BATCH_SIZE }, (_, index) => ({
  asset_id: `boundary-${index + 1}`,
  image_urls: [`https://images.example.test/boundary-${index + 1}.jpg`]
}));
let visionCapCalls = 0;
active = 0;
maxActive = 0;
const visionCapReport = await runHostedVisionUrlControl({
  apiKey,
  assets: maximumVisionAssets,
  concurrency: VISION_URL_MAX_BATCH_SIZE + 1,
  now: monotonicNow(),
  fetchImpl: async () => {
    visionCapCalls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return successResponse();
  }
});
assert.equal(visionCapCalls, VISION_URL_MAX_BATCH_SIZE);
assert.equal(visionCapReport.tasks, VISION_URL_MAX_BATCH_SIZE);
assert.equal(visionCapReport.concurrency, VISION_URL_MAX_BATCH_SIZE);
assert.equal(maxActive, VISION_URL_MAX_BATCH_SIZE);

await assert.rejects(
  () => runHostedVisionUrlControl({ apiKey, assets: [...maximumVisionAssets, maximumVisionAssets[0]] }),
  /vision_assets_limit_exceeded/
);
await assert.rejects(
  () => runHostedVisionUrlControl({ apiKey, assets: [{ asset_id: "no-image", image_urls: [] }] }),
  /vision_image_urls_required/
);
await assert.rejects(
  () => runHostedVisionUrlControl({ apiKey, assets: [{ asset_id: "missing-images" }] }),
  /vision_image_urls_required/
);
await assert.rejects(
  () => runHostedVisionUrlControl({
    apiKey,
    assets: [{ asset_id: "insecure-image", image_urls: ["http://a.test/1"] }]
  }),
  /vision_image_url_invalid/
);
await assert.rejects(
  () => runHostedVisionUrlControl({
    apiKey,
    assets: [{ asset_id: "too-many-images", image_urls: ["https://a.test/1", "https://a.test/2", "https://a.test/3"] }]
  }),
  /vision_image_urls_limit_exceeded/
);
await assert.rejects(
  () => runHostedVisionUrlControl({ apiKey, assets: [{ asset_id: "", image_urls: ["https://a.test/1"] }] }),
  /vision_asset_id_required/
);

const privateProviderUrl = "https://private.example.test/card.jpg?secret=provider-secret";
const privateNetworkUrl = "https://private.example.test/card.jpg?secret=network-secret";
let failedCalls = 0;
const failedReport = await runHostedVisionUrlControl({
  apiKey,
  concurrency: 2,
  assets: [
    { asset_id: "provider-failure", image_urls: [privateProviderUrl] },
    { asset_id: "network-failure", image_urls: [privateNetworkUrl] }
  ],
  now: monotonicNow(),
  fetchImpl: async () => {
    failedCalls += 1;
    if (failedCalls === 1) {
      return {
        ok: false,
        status: 400,
        headers: rateLimitHeaders,
        json: async () => ({ error: { message: `Unable to fetch ${privateProviderUrl}` } })
      };
    }
    const error = new TypeError(`request to ${privateNetworkUrl} failed`);
    error.cause = { name: "Error", code: "ECONNRESET", message: `socket closed for ${privateNetworkUrl}` };
    throw error;
  }
});
assert.equal(failedCalls, 2);
assert.equal(failedReport.failed_count, 2);
assert.equal(failedReport.network_errors.count, 1);
assert.equal(failedReport.network_errors.by_code.ECONNRESET, 1);
assert.match(failedReport.rows[0].error, /\[redacted-url\]/);
assert.match(failedReport.rows[1].network_error.message, /\[redacted-url\]/);
assert.equal(JSON.stringify(failedReport).includes(privateProviderUrl), false);
assert.equal(JSON.stringify(failedReport).includes(privateNetworkUrl), false);
assert.equal(JSON.stringify(failedReport).includes("provider-secret"), false);
assert.equal(JSON.stringify(failedReport).includes("network-secret"), false);

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

const previousApiKey = process.env.OPENAI_API_KEY;
const previousFetch = globalThis.fetch;
try {
  process.env.OPENAI_API_KEY = apiKey;
  let handlerRequest = null;
  globalThis.fetch = async (_url, init) => {
    handlerRequest = JSON.parse(init.body);
    return successResponse();
  };
  const visionResponse = mockResponse();
  await handler({
    method: "POST",
    body: {
      mode: "vision_url",
      concurrency: 1,
      model: "must-not-override-vision-model",
      effort: "high",
      assets: [{ asset_id: "handler-asset", image_urls: ["https://images.example.test/handler.jpg"] }]
    }
  }, visionResponse);
  assert.equal(visionResponse.statusCode, 200);
  assert.equal(visionResponse.body.evidence_scope, "VERCEL_TO_OPENAI_VISION_URL_CONTROL");
  assert.equal(handlerRequest.model, "gpt-5.6-luna");
  assert.equal(handlerRequest.reasoning.effort, "none");
  assert.equal(handlerRequest.input[0].content[1].type, "input_image");
  assert.equal(handlerRequest.input[0].content[1].detail, "high");

  const noImageResponse = mockResponse();
  await handler({
    method: "POST",
    body: { mode: "vision_url", assets: [{ asset_id: "handler-no-image", image_urls: [] }] }
  }, noImageResponse);
  assert.equal(noImageResponse.statusCode, 400);
  assert.equal(noImageResponse.body.error, "vision_image_urls_required_at_1");

  const textResponse = mockResponse();
  await handler({ method: "POST", body: { tasks: 1, concurrency: 1 } }, textResponse);
  assert.equal(textResponse.statusCode, 200);
  assert.equal(textResponse.body.evidence_scope, "VERCEL_TO_OPENAI_TEXT_CONTROL_ONLY");
  assert.equal(JSON.stringify(handlerRequest).includes("input_image"), false);
} finally {
  globalThis.fetch = previousFetch;
  if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousApiKey;
}

console.log("Vercel capacity probe tests passed");
