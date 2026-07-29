import assert from "node:assert/strict";

import { runBoundedOpenAiAssist } from "../lib/listing/providers/openai-bounded-assist.mjs";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"]
};
const env = {
  OPENAI_API_KEY: "sk-test-not-real",
  OPENAI_LISTING_MODEL: "gpt-5-mini"
};

let request = null;
let calls = 0;
const success = await runBoundedOpenAiAssist({
  prompt: "Return the bounded result.",
  schema,
  schemaName: "bounded_test",
  images: [{ signed_url: "https://example.test/card.jpg" }],
  maxOutputTokens: 128,
  timeoutMs: 500,
  env,
  requestContext: { provider_call_purpose: "targeted_visual", asset_id: "asset-1" },
  fetchImpl: async (_url, init) => {
    calls += 1;
    request = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_test",
        model: "gpt-5-mini",
        status: "completed",
        output_text: JSON.stringify({ ok: true }),
        usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 }
      })
    };
  }
});

assert.equal(calls, 1);
assert.equal(request.store, false);
assert.equal(request.max_output_tokens, 128);
assert.equal(request.text.format.strict, true);
assert.deepEqual(request.text.format.schema, schema);
assert.equal(request.input[0].content[1].type, "input_image");
assert.equal(request.input[0].content[1].detail, "auto");
assert.deepEqual(success.parsed, { ok: true });
assert.equal(success.usage.provider_calls, 1);
assert.equal(success.usage.output_tokens, 4);
assert.equal(success.transient_retry_attempted, false);
assert.equal(success.request_context.asset_id, "asset-1");
assert.match(success.response_hash, /^[a-f0-9]{64}$/);
assert.equal("content" in success, false);

let textOnlyBody = null;
await runBoundedOpenAiAssist({
  prompt: "Text-only bounded assist.",
  schema,
  schemaName: "text_only_test",
  allowTextOnly: true,
  images: [],
  env,
  fetchImpl: async (_url, init) => {
    textOnlyBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: "{\"ok\":true}", usage: {} })
    };
  }
});
assert.equal(textOnlyBody.input[0].content.length, 1);

let failedCalls = 0;
await assert.rejects(
  () => runBoundedOpenAiAssist({
    prompt: "Do not retry.",
    schema,
    images: [{ signed_url: "https://example.test/card.jpg" }],
    env,
    fetchImpl: async () => {
      failedCalls += 1;
      return {
        ok: false,
        status: 503,
        text: async () => "temporary outage"
      };
    }
  }),
  (error) => error?.code === "upstream_error" && error?.provider_call_attempted === true
);
assert.equal(failedCalls, 1);

await assert.rejects(
  () => runBoundedOpenAiAssist({ prompt: "Visual", schema, images: [], env, fetchImpl: async () => null }),
  (error) => error?.code === "provider_input_unsupported" && error?.provider_call_attempted !== true
);

console.log("openai bounded assist tests passed");
