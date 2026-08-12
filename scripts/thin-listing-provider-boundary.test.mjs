#!/usr/bin/env node

import assert from "node:assert/strict";

import { runCanonicalListingPath } from "../lib/listing/thin/thin-listing-path.mjs";

function audited(fields) {
  const sourceFields = [
    "year", "language", "manufacturer", "product", "set", "subjects", "team",
    "card_name", "release_variant", "surface_color", "parallel_family",
    "parallel_exact", "descriptive_rarity", "card_number", "serial", "attributes",
    "grading_info", "grammar", "lot_count", "special_stamp", "description"
  ];
  const hasValue = (value) => Array.isArray(value) ? value.length > 0
    : value && typeof value === "object" ? Object.values(value).some(Boolean)
      : Boolean(String(value ?? "").trim());
  return {
    ...fields,
    field_sources: sourceFields.filter((field) => hasValue(fields[field])).map((field) => ({
      field, source_ids: ["original_image_1"]
    })),
    set_card_name_relations: {
      set: fields.set ? "CURRENT_CARD_MEMBER_OF_SET" : "",
      card_name: fields.card_name ? "CURRENT_CARD_NAMED_BY_DESIGN" : ""
    }
  };
}

const successBody = (fields, extra = {}) => ({
  model: "gpt-5.6-luna",
  reasoning: { effort: "low" },
  status: "completed",
  output_text: JSON.stringify(audited(fields)),
  ...extra
});

{
  let providerCalls = 0;
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    provider: "future-provider",
    model: "future-model",
    callProvider: async () => { providerCalls += 1; }
  }), /unsupported_csm_provider:future-provider/);
  assert.equal(providerCalls, 0,
    "an unregistered provider must fail before the paid transport boundary");
}

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    maxOutputTokens: 7_777,
    providerClientRequestId: "lynca-client-receipt",
    callProvider: async (request) => {
      assert.equal(request.max_output_tokens, 7_777,
        "the execution profile's output cap must reach the actual provider request");
      return new Response(JSON.stringify({
        id: "resp_provider_receipt",
        ...successBody({ subjects: ["Test Subject"], grammar: "standard" }),
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 40 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 12 },
          total_tokens: 999
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req_provider_receipt" }
      });
    }
  });
  assert.equal(result.provider_response_id, "resp_provider_receipt");
  assert.equal(result.provider_request_id, "req_provider_receipt");
  assert.equal(result.provider_client_request_id, "lynca-client-receipt");
  assert.equal(result.requested_effort, "low");
  assert.equal(result.served_effort, "low");
  assert.equal(result.served_effort_attested, true);
  assert.equal(result.requested_model, "gpt-5.6-luna");
  assert.equal(result.served_model, "gpt-5.6-luna");
  assert.equal(result.served_model_attested, true);
  assert.equal(result.provider_response_status, "completed");
  assert.equal(result.provider_response_status_attested, true);
  assert.equal(result.provider_response_incomplete, false);
  assert.equal(result.cached_input_tokens, 40);
  assert.equal(result.reasoning_tokens, 12);
  assert.equal(result.total_tokens, 999,
    "provider total is evidence and must not be replaced by input plus output");
}

for (const body of [
  {
    id: "resp-incomplete",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" }
  },
  { id: "resp-failed", status: "failed" }
]) {
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify({
      ...body,
      output_text: JSON.stringify(audited({ subjects: ["Must Not Persist"], grammar: "standard" }))
    }), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.status === 502
    && error.provider_error_code === "provider_response_incomplete"
    && error.definitive_response === true
    && error.retryable === false,
  "an explicit incomplete/failed provider response is definitive and may not persist partial JSON");
}

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    effort: "low",
    callProvider: async () => new Response(JSON.stringify({
      id: "resp_provider_effort_receipt",
      ...successBody({ subjects: ["Test Subject"], grammar: "standard" })
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.served_effort, "low");
  assert.equal(result.served_effort_attested, true);
  assert.equal(result.total_tokens, null,
    "missing usage must remain UNKNOWN rather than becoming a synthetic zero");
}

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    callProvider: async () => new Response(JSON.stringify({
      ...successBody({ subjects: ["Test Subject"], grammar: "standard" }),
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: Number.MAX_SAFE_INTEGER + 1,
        input_tokens_details: { cached_tokens: "4" },
        output_tokens_details: { reasoning_tokens: 1.5 }
      }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.total_tokens, null);
  assert.equal(result.cached_input_tokens, null);
  assert.equal(result.reasoning_tokens, null,
    "unsafe, string, and fractional usage values are not exact receipts");
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

// COS-49 terminal Lot integration: the paid boundary returns the deterministic
// terminal state so orchestration can persist it before the HTTP route refuses
// a usable-200. Throwing here would make the review receipt unreachable.
for (const [lotCount, failureCode] of [
  ["", "LOT_QUANTITY_UNRESOLVED"],
  ["2-3", "LOT_QUANTITY_UNRESOLVED"],
  ["1/2", "LOT_QUANTITY_UNRESOLVED"],
  ["1", "LOT_SINGLE_CARD"]
]) {
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/lot.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(audited({
        manufacturer: "Topps", product: "Chrome", subjects: ["A", "B"],
        grammar: "lot", lot_count: lotCount
      })),
      model: "gpt-5.6-luna", reasoning: { effort: "low" }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.lot_publishable, false);
  assert.equal(result.lot_publication_failure_code, failureCode);
  assert.ok(!/^Lot\*(?:23|12)\b/.test(result.title),
    "ambiguous quantity text must never be digit-concatenated");
}

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/lot.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(audited({
        manufacturer: "Topps", product: "Chrome", subjects: ["A", "B"],
        set: "Update; Sapphire", grammar: "lot", lot_count: "2"
      })),
      model: "gpt-5.6-luna", reasoning: { effort: "low" }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.lot_publishable, true);
  assert.equal(result.lot_publication_failure_code, null);
  assert.deepEqual(result.lot_unshared_attributes, ["set"]);
}

function webIdentityBody(url) {
  const payload = audited({
    subjects: ["Governed Web Subject"], grammar: "standard"
  });
  payload.field_sources = payload.field_sources.map((row) => (
    row.field === "subjects" ? { ...row, source_ids: [url] } : row
  ));
  return {
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output: [
      { type: "web_search_call", action: {
        query: "Governed Web Subject checklist", sources: [{ url }]
      } },
      { type: "message", content: [{
        type: "output_text", text: JSON.stringify(payload),
        annotations: [{ type: "url_citation", url }]
      }] }
    ]
  };
}

for (const url of [
  "https://attacker-controlled-example.org/fabricated",
  "https://www.ebay.com/itm/123456789",
  "https://evil.paniniamerica.net.attacker.com/fabricated"
]) {
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(url)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_identity_authority_required:subjects",
  "unknown, marketplace, and suffix-confusion URLs cannot author canonical identity");
}

{
  const officialUrl = "https://www.paniniamerica.net/checklists/contenders";
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(officialUrl)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.equal(result.title, "Governed Web Subject");
  assert.equal(result.founder_beta_web_receipt.web_search_used, true);
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence, [{
    field: "subjects", support_urls: [officialUrl], conflict_urls: [], unresolved_urls: []
  }]);
}

process.stdout.write("thin listing provider boundary: ok\n");
