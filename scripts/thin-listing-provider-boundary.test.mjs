#!/usr/bin/env node

import assert from "node:assert/strict";

import { runCanonicalListingPath } from "../lib/listing/thin/thin-listing-path.mjs";

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    providerClientRequestId: "lynca-client-receipt",
    callProvider: async () => new Response(JSON.stringify({
      id: "resp_provider_receipt",
      output_text: JSON.stringify({ subjects: ["Test Subject"], grammar: "standard" })
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_provider_receipt" }
    })
  });
  assert.equal(result.provider_response_id, "resp_provider_receipt");
  assert.equal(result.provider_request_id, "req_provider_receipt");
  assert.equal(result.provider_client_request_id, "lynca-client-receipt");
}

await assert.rejects(
  runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    providerClientRequestId: "lynca-client-rate-limit",
    callProvider: async () => new Response(
      JSON.stringify({ error: {
        message: "rate limited",
        code: "rate_limit_exceeded",
        type: "requests",
        param: "model"
      } }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "2",
          "x-request-id": "req-provider-rate-limit",
          "x-ratelimit-limit-tokens": "4000000"
        }
      }
    )
  }),
  (error) => error.name === "CanonicalProviderError"
    && error.status === 429
    && error.safe_to_retry === true
    && error.provider_attempt_started === true
    && error.provider_request_id === "req-provider-rate-limit"
    && error.provider_client_request_id === "lynca-client-rate-limit"
    && error.provider_error_code === "rate_limit_exceeded"
    && error.provider_error_type === "requests"
    && error.provider_error_param === "model"
    && error.provider_ms >= 0
    && error.response.headers.get("retry-after") === "2"
);

await assert.rejects(
  runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response("upstream failed", { status: 503 })
  }),
  (error) => error.name === "CanonicalProviderError"
    && error.status === 503
    && error.safe_to_retry === true,
  "a received 5xx is a definitive failed response; only a lost response is ambiguous"
);

await assert.rejects(
  runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response("provider internal error", { status: 500 })
  }),
  (error) => error.name === "CanonicalProviderError"
    && error.status === 500
    && error.safe_to_retry === true
    && error.retryable === true,
  "an explicit provider 500 is safe to retry under the durable idempotency fence"
);

await assert.rejects(
  runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    providerClientRequestId: "lynca-client-invalid-json",
    callProvider: async () => new Response("not-json", {
      status: 200,
      headers: { "x-request-id": "req-provider-invalid-json" }
    })
  }),
  (error) => error.name === "CanonicalProviderError"
    && error.status === 502
    && error.provider_error_code === "invalid_json"
    && error.provider_request_id === "req-provider-invalid-json"
    && error.provider_client_request_id === "lynca-client-invalid-json"
    && error.provider_attempt_started === true
    && error.definitive_response === true
    && error.retryable === false,
  "a complete malformed 200 response must fail closed instead of persisting an empty title"
);

for (const body of [
  { id: "resp-missing-output" },
  { id: "resp-empty-title", output_text: JSON.stringify({ grammar: "standard" }) }
]) {
  await assert.rejects(
    runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    }),
    (error) => error.name === "CanonicalProviderError"
      && error.status === 502
      && error.definitive_response === true
      && error.retryable === false,
    "a 200 response without a usable structured title must not cross the persistence boundary"
  );
}

process.stdout.write("thin listing provider boundary: ok\n");
