#!/usr/bin/env node

import assert from "node:assert/strict";

import { CANONICAL_FIELD_SOURCE_FIELDS } from "../lib/listing/thin/canonical-fields.mjs";
import { validateFounderBetaWebReceipt } from "../lib/listing/thin/csm-forward-reader-bridge.mjs";
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
    && error.provider_attempt_started === true
    && error.returned_http_response === true
    && error.response_body_complete === true
    && error.definitive_response === true
    && error.provider_business_failure === true
    && error.safe_to_retry === false
    && error.retryable === false
    && error.provider_request_id === "req-provider-rate-limit"
    && error.provider_client_request_id === "lynca-client-rate-limit"
    && error.provider_error_code === "rate_limit_exceeded"
    && error.provider_error_type === "requests"
    && error.provider_error_param === "model"
    && error.provider_ms >= 0
    && error.response.headers.get("retry-after") === "2",
  "a definitive 429 is a business/rate-limit failure and never buys an automatic provider retry"
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
  "an explicit provider 500 is classified as definitive, while dispatcher policy still forbids auto-retry"
);

await assert.rejects(
  runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    providerClientRequestId: "lynca-client-definitive-502",
    callProvider: async () => new Response(JSON.stringify({
      error: { message: "bad gateway", code: "server_error", type: "server_error" }
    }), {
      status: 502,
      headers: { "content-type": "application/json", "x-request-id": "req-definitive-502" }
    })
  }),
  (error) => error.name === "CanonicalProviderError"
    && error.status === 502
    && error.ambiguous !== true
    && error.returned_http_response === true
    && error.response_body_complete === true
    && error.provider_output_present === false
    && error.provider_contract_failure === false
    && error.definitive_response === true
    && error.safe_to_retry === true
    && error.provider_client_request_id === "lynca-client-definitive-502"
    && error.provider_request_id === "req-definitive-502",
  "a fully consumed empty-output 502 exposes the narrow transport-retry provenance"
);

await assert.rejects(
  runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    providerClientRequestId: "lynca-client-partial-502",
    callProvider: async () => ({
      ok: false,
      status: 502,
      headers: new Headers({ "x-request-id": "req-partial-502" }),
      json: async () => { throw new TypeError("terminated"); }
    })
  }),
  (error) => error.name === "CanonicalProviderError"
    && error.status === 502
    && error.ambiguous === true
    && error.response_body_complete === false
    && error.provider_contract_failure === true
    && error.definitive_response === false
    && error.retryable === false,
  "a 502 whose response body stream terminates is ambiguous and cannot auto-retry"
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

function webIdentityBody(url, fields = {
  subjects: ["Governed Web Subject"], grammar: "standard"
}, sourceIdsByField = { subjects: [url] }) {
  const payload = audited(fields);
  payload.field_sources = payload.field_sources.map((row) => ({
    ...row,
    source_ids: sourceIdsByField[row.field] || row.source_ids
  }));
  const urls = [...new Set(Object.values(sourceIdsByField).flat()
    .filter((sourceId) => sourceId.startsWith("https://")))];
  return {
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: {
        type: "search", query: "Governed identity checklist", sources: urls.map((sourceUrl) => ({
          url: sourceUrl
        }))
      } },
      { type: "message", content: [{
        type: "output_text", text: JSON.stringify(payload),
        annotations: urls.map((sourceUrl) => ({ type: "url_citation", url: sourceUrl }))
      }] }
    ]
  };
}

const completedBody = (payload) => ({
  model: "gpt-5.6-luna",
  reasoning: { effort: "low" },
  status: "completed",
  output_text: JSON.stringify(payload)
});

const withoutFieldSource = (payload, ...fields) => ({
  ...payload,
  field_sources: payload.field_sources.filter((row) => !fields.includes(row.field))
});

const withFieldSourceRows = (payload, field, sourceRows) => ({
  ...payload,
  field_sources: [
    ...payload.field_sources.filter((row) => row.field !== field),
    ...sourceRows.map((source_ids) => ({ field, source_ids }))
  ]
});

// Grammar classifies the resolved structure; it is not a source fact. Missing
// grammar evidence must not block either Standard or the downstream SEM repair.
for (const [fields, expectedGrammar] of [[{
  manufacturer: "Topps", product: "Chrome", subjects: ["Player"], grammar: "standard"
}, "standard"], [{
  manufacturer: "Pokémon", product: "Mega Brave", subjects: ["Charizard"],
  grammar: "standard"
}, "tcg"]]) {
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(
      withoutFieldSource(audited(fields), "grammar")
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.grammar, expectedGrammar);
  if (expectedGrammar === "tcg") {
    assert.equal(result.fields.ip, "Pokemon");
    assert.ok(result.field_defects.includes("grammar_standard_but_csm_says_tcg"));
  }
}

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(audited({
      manufacturer: "Topps", subjects: ["Image Trace"], grammar: "standard"
    }))), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.grammar, "standard",
    "an optional image-only grammar trace remains valid");
}

function webGrammarBody(url, sourceIds) {
  const payload = audited({ subjects: ["Grammar Authority"], grammar: "standard" });
  payload.field_sources = payload.field_sources.map((row) => (
    row.field === "grammar" ? { ...row, source_ids: sourceIds } : row
  ));
  return {
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: {
        type: "search", query: "card grammar", sources: [{ url }]
      } },
      { type: "message", content: [{
        type: "output_text", text: JSON.stringify(payload),
        annotations: [{ type: "url_citation", url }]
      }] }
    ]
  };
}

{
  const url = "https://attacker-controlled-example.org/grammar";
  for (const sourceIds of [[url], ["original_image_1", url]]) {
    await assert.rejects(runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(
        webGrammarBody(url, sourceIds)
      ), { status: 200, headers: { "content-type": "application/json" } })
    }), (error) => error.name === "CanonicalProviderError"
      && error.provider_error_code === "founder_beta_web_authority_forbidden:grammar",
    "Web-only and mixed Web/image evidence cannot author grammar");
  }
}

{
  const url = "https://attacker-controlled-example.org/duplicate-grammar";
  const body = webGrammarBody(url, ["original_image_1"]);
  const payload = JSON.parse(body.output[1].content[0].text);
  payload.field_sources.push({ field: "grammar", source_ids: [url] });
  body.output[1].content[0].text = JSON.stringify(payload);
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_web_authority_forbidden:grammar",
  "splitting image and Web claims across grammar rows must not bypass the Web-authority gate");
}

{
  const payload = withoutFieldSource(audited({
    subjects: ["Still Source Bound"], grammar: "standard"
  }), "grammar", "subjects");
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "canonical_naming_mandatory_subject_identity_missing",
  "a subject without a source row must be withheld and leave a single card non-publishable");
}

// Missing rows are omissions, not affirmative bad authority claims. Withhold
// every affected value before parsing and preserve the existing unreadable
// state so the durable CSM row can distinguish it from a genuinely absent fact.
for (const { field, value, expected } of [
  { field: "product", value: "Unsupported Product", expected: (result) => (
    result.fields.product === "" && !result.title.includes("Unsupported Product")
  ) },
  { field: "parallel_family", value: "Refractor", expected: (result) => (
    result.fields.parallel_family === "" && result.fields.print_finish === ""
      && !result.title.includes("Refractor")
  ) },
  { field: "attributes", value: ["Auto"], expected: (result) => (
    result.fields.attributes.length === 0 && result.fields.components.length === 0
      && !result.title.includes("Auto")
  ) },
  { field: "grading_info", value: {
    company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
  }, expected: (result) => result.fields.grading_info === null && !result.title.includes("PSA") }
]) {
  const payload = withoutFieldSource(audited({
    manufacturer: "Topps", subjects: ["Grounded Subject"], grammar: "standard",
    [field]: value, low_confidence: [field]
  }), field);
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.ok(expected(result), `${field} without a source row must not leak into canonical output`);
  assert.ok(result.fields.unreadable.includes(field));
  assert.ok(!result.fields.low_confidence.includes(field),
    "withheld source omissions are unreadable, not simultaneously low confidence");
}

// Empty and partitioned rows carry no authority of their own. Empty unions use
// the omission path; duplicate rows are an ordered set union whose every source
// must still pass the normal authority checks.
{
  const payload = withFieldSourceRows(audited({
    manufacturer: "Topps", product: "Unsupported Product",
    subjects: ["Grounded Subject"], grammar: "standard"
  }), "product", [[]]);
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.equal(result.fields.product, "");
  assert.ok(result.fields.unreadable.includes("product"));
  assert.ok(!result.title.includes("Unsupported Product"));
}

{
  const payload = withFieldSourceRows(audited({
    subjects: ["Still Unsupported"], grammar: "standard"
  }), "subjects", [["", "   "]]);
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "canonical_naming_mandatory_subject_identity_missing",
  "a normalized-empty source group must behave like an omitted mandatory-subject row");
}

{
  const payload = audited({ subjects: ["Grounded Subject"], grammar: "standard" });
  payload.field_sources.push({ field: "product", source_ids: [] });
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.equal(result.fields.product, "");
  assert.ok(!result.fields.unreadable.includes("product"),
    "an empty placeholder for an empty field is just an omitted ledger row");
}

{
  const payload = audited({ subjects: ["Partitioned Images"], grammar: "standard" });
  payload.field_sources.push({ field: "subjects", source_ids: ["original_image_2"] });
  const result = await runCanonicalListingPath({
    imageUrls: [
      "https://example.invalid/front.jpg", "https://example.invalid/back.jpg"
    ],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.deepEqual(result.fields.subjects, ["Partitioned Images"]);
}

for (const [field, value] of [
  ["card_number", "105"],
  ["parallel_exact", "Unsafe Gold"]
]) {
  const unsafeUrl = "https://user:secret@www.paniniamerica.net/checklists/unsafe";
  for (const sourceRows of [
    [["original_image_1"], [unsafeUrl]],
    [[unsafeUrl], ["original_image_1"]]
  ]) {
    const payload = withFieldSourceRows(audited({
      subjects: ["Grounded Subject"], grammar: "standard", [field]: value
    }), field, sourceRows);
    await assert.rejects(runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
        status: 200, headers: { "content-type": "application/json" }
      })
    }), (error) => error.name === "CanonicalProviderError"
      && error.provider_error_code === "founder_beta_web_url_unsafe",
    `${field} duplicate-row order must not hide an unsafe source behind image authority`);
  }
}

{
  const unreturnedUrl = "https://www.paniniamerica.net/checklists/unreturned-physical";
  for (const sourceRows of [
    [["original_image_1"], [unreturnedUrl]],
    [[unreturnedUrl], ["original_image_1"]]
  ]) {
    const payload = withFieldSourceRows(audited({
      card_number: "105", subjects: ["Grounded Subject"], grammar: "standard"
    }), "card_number", sourceRows);
    await assert.rejects(runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
        status: 200, headers: { "content-type": "application/json" }
      })
    }), (error) => error.name === "CanonicalProviderError"
      && error.provider_error_code === "founder_beta_field_source_not_returned",
    "duplicate-row order must retain the unreturned-reference hard gate");
  }
}

{
  const returnedUrl = "https://www.paniniamerica.net/checklists/web-only-physical";
  const body = webIdentityBody(returnedUrl, {
    card_number: "105", subjects: ["Grounded Subject"], grammar: "standard"
  }, { card_number: [returnedUrl] });
  const payload = JSON.parse(body.output[1].content[0].text);
  payload.field_sources.push({ field: "card_number", source_ids: [returnedUrl] });
  body.output[1].content[0].text = JSON.stringify(payload);
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_current_copy_source_required:card_number",
  "duplicate Web rows must not replace current-copy authority");
}

for (const invalidRow of [
  { field: "product", source_ids: "original_image_1" },
  { field: "not_a_canonical_field", source_ids: [] }
]) {
  const payload = audited({
    product: "Grounded Product", subjects: ["Grounded Subject"], grammar: "standard"
  });
  payload.field_sources.push(invalidRow);
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_field_sources_invalid",
  "malformed ledger rows must remain a hard provider-contract failure");
}

{
  const payload = withoutFieldSource(audited({
    subjects: ["Card A", "Card B"], grammar: "lot", lot_count: "2"
  }), "lot_count");
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/lot.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.equal(result.fields.lot_count, "");
  assert.equal(result.lot_publishable, false);
  assert.equal(result.lot_publication_failure_code, "LOT_QUANTITY_UNRESOLVED");
  assert.ok(!result.fields.unreadable.includes("lot_count"),
    "lot_count uses the durable lot terminal instead of an unsupported unreadable name");
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
    && error.provider_error_code === "canonical_naming_mandatory_subject_identity_missing",
  "withholding an ungoverned Web-only subject must leave the single card non-publishable");
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

  const boundedBody = webIdentityBody(officialUrl);
  boundedBody.output.splice(1, 0, {
    type: "web_search_call",
    status: "completed",
    action: {
      type: "open_page",
      url: "https://www.paniniamerica.net/checklists/opened-page?step=2#identity"
    }
  });
  const bounded = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(boundedBody), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.equal(bounded.founder_beta_web_receipt.provider_request_count, 1);
  assert.equal(bounded.founder_beta_web_receipt.web_search_call_count, 2);
  assert.deepEqual(bounded.founder_beta_web_receipt.queries,
    ["Governed identity checklist"]);
  assert.deepEqual(bounded.founder_beta_web_receipt.urls, [officialUrl],
    "a distinct open-page URL joins returned authority without widening used evidence");

  for (const actionType of ["open_page", "find_in_page"]) {
    const unsafeSecondActionBody = structuredClone(boundedBody);
    unsafeSecondActionBody.output[1].action = {
      type: actionType,
      url: "http://www.paniniamerica.net/checklists/contenders",
      ...(actionType === "find_in_page" ? { pattern: "subject" } : {})
    };
    await assert.rejects(runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(unsafeSecondActionBody), {
        status: 200, headers: { "content-type": "application/json" }
      })
    }), (error) => error.name === "CanonicalProviderError"
      && error.provider_error_code === "founder_beta_web_url_unsafe",
    `one unsafe later ${actionType} must reject the full trace after safe admitted search evidence`);
  }

  for (const actionType of ["open_page", "find_in_page"]) {
    const actionOnlyBody = webIdentityBody(officialUrl);
    actionOnlyBody.output[0].action = {
      type: actionType,
      url: `${officialUrl}?lookup=1#fragment`,
      ...(actionType === "find_in_page" ? { pattern: "subject" } : {})
    };
    actionOnlyBody.output[1].content[0].annotations = [];
    const actionOnly = await runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(actionOnlyBody), {
        status: 200, headers: { "content-type": "application/json" }
      })
    });
    assert.deepEqual(actionOnly.founder_beta_web_receipt.queries, []);
    assert.deepEqual(actionOnly.founder_beta_web_receipt.urls, [officialUrl]);
  }

  const querylessSearchBody = webIdentityBody(officialUrl);
  delete querylessSearchBody.output[0].action.query;
  const querylessSearch = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(querylessSearchBody), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.deepEqual(querylessSearch.founder_beta_web_receipt.queries, []);
  assert.equal(querylessSearch.founder_beta_web_receipt.field_evidence.length, 1,
    "a queryless search remains valid when its returned evidence is durable");

  const emptyTracePayload = audited({
    subjects: ["Image Grounded"], grammar: "standard"
  });
  const emptyTraceBody = {
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output: [{
      type: "web_search_call", status: "completed",
      action: { type: "search", sources: [] }
    }, {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(emptyTracePayload) }]
    }]
  };
  const emptyTrace = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(emptyTraceBody), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.deepEqual({
    schema_version: emptyTrace.founder_beta_web_receipt.schema_version,
    outcome: emptyTrace.founder_beta_web_receipt.outcome,
    web_search_used: emptyTrace.founder_beta_web_receipt.web_search_used,
    web_search_call_count: emptyTrace.founder_beta_web_receipt.web_search_call_count,
    queries: emptyTrace.founder_beta_web_receipt.queries,
    urls: emptyTrace.founder_beta_web_receipt.urls,
    field_evidence: emptyTrace.founder_beta_web_receipt.field_evidence
  }, {
    schema_version: "founder-beta-web-receipt-v2",
    outcome: "USED_WITHOUT_FIELD_EVIDENCE",
    web_search_used: true,
    web_search_call_count: 1,
    queries: [],
    urls: [],
    field_evidence: []
  }, "a completed queryless action remains a real trace without field evidence");

  const unsafeUnusedActionBody = structuredClone(emptyTraceBody);
  unsafeUnusedActionBody.output[0].action = {
    type: "open_page", url: "http://www.paniniamerica.net/checklists/unsafe"
  };
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(unsafeUnusedActionBody), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_web_url_unsafe",
  "an unused action URL must still cross trace URL sanitization");

  for (const [mutate, expectedCode] of [
    [(body) => { delete body.output[0].status; }, "founder_beta_web_call_incomplete"],
    [(body) => { body.output[0].status = "in_progress"; },
      "founder_beta_web_call_incomplete"],
    [(body) => { body.output[0].action.type = "click"; },
      "founder_beta_web_action_unsupported"]
  ]) {
    const invalidBody = webIdentityBody(officialUrl);
    mutate(invalidBody);
    await assert.rejects(runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(invalidBody), {
        status: 200, headers: { "content-type": "application/json" }
      })
    }), (error) => error.name === "CanonicalProviderError"
      && error.provider_error_code === expectedCode);
  }

  const threeCallsBody = webIdentityBody(officialUrl);
  threeCallsBody.output.unshift(structuredClone(threeCallsBody.output[0]));
  threeCallsBody.output.unshift(structuredClone(threeCallsBody.output[0]));
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(threeCallsBody), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_web_call_budget_exceeded");
}

const ungovernedUrl = "https://www.ebay.com/itm/ungoverned-identity";
const officialUrl = "https://www.paniniamerica.net/checklists/governed";
const identityCases = [
  ["year", "2099"],
  ["manufacturer", "Marketplace Maker"],
  ["product", "Marketplace Product"],
  ["set", "Marketplace Set"],
  ["card_name", "Marketplace Card Name"]
];

for (const [field, value] of identityCases) {
  const fields = {
    subjects: ["Grounded Subject"], grammar: "standard", [field]: value
  };
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(
      ungovernedUrl, fields, { [field]: [ungovernedUrl] }
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.fields[field], "", `${field} must be withheld from canonical fields`);
  assert.ok(!result.title.includes(value), `${field} must not leak into the title`);
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === field
  ), {
    field, support_urls: [], conflict_urls: [], unresolved_urls: [ungovernedUrl]
  });
  if (["set", "card_name"].includes(field)) {
    assert.equal(result.set_card_name_relation_receipt[field], null,
      `withheld ${field} must not leave a stale relation receipt`);
  }
}

for (const [field, scalar] of [...identityCases, ["subjects", "Official Subject"]]) {
  const value = field === "subjects" ? [scalar] : scalar;
  const fields = {
    subjects: field === "subjects" ? value : ["Grounded Subject"],
    grammar: "standard",
    ...(field === "subjects" ? {} : { [field]: value })
  };
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(
      officialUrl, fields, { [field]: [officialUrl] }
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(result.fields[field], value, `official ${field} authority must remain admitted`);
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === field
  ), {
    field, support_urls: [officialUrl], conflict_urls: [], unresolved_urls: []
  });
}

for (const sourceIds of [
  ["original_image_1", ungovernedUrl],
  [officialUrl, ungovernedUrl]
]) {
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(
      ungovernedUrl,
      { product: "Admitted Product", subjects: ["Grounded Subject"], grammar: "standard" },
      { product: sourceIds }
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.fields.product, "Admitted Product");
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === "product"
  ), {
    field: "product",
    support_urls: sourceIds.includes(officialUrl) ? [officialUrl] : [],
    conflict_urls: [],
    unresolved_urls: [ungovernedUrl]
  });
}

{
  const fields = {
    product: "Unsafe Product", set: "Unsafe Set", card_name: "Unsafe Card Name",
    subjects: ["Grounded Subject"], grammar: "standard"
  };
  const sourceIdsByField = Object.fromEntries(
    ["product", "set", "card_name"].map((field) => [field, [ungovernedUrl]])
  );
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(
      ungovernedUrl, fields, sourceIdsByField
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.title, "Grounded Subject",
    "multiple ungoverned identity fields must be withheld atomically from the title");
  assert.deepEqual(
    result.founder_beta_web_receipt.field_evidence.map((row) => row.field),
    ["card_name", "product", "set"]
  );
  assert.deepEqual(result.founder_beta_web_receipt.urls, [ungovernedUrl],
    "one URL shared by multiple evidence rows must persist once");
  assert.equal(result.set_card_name_relation_receipt.set, null);
  assert.equal(result.set_card_name_relation_receipt.card_name, null);
}

for (const [field, value] of [
  ["card_number", "999"],
  ["serial", "1/1"],
  ["parallel_exact", "Unsafe Gold"],
  ["grading_info", { company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY" }],
  ["lot_count", "2"]
]) {
  const fields = {
    subjects: ["Grounded Subject"],
    grammar: field === "lot_count" ? "lot" : "standard",
    [field]: value
  };
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webIdentityBody(
      ungovernedUrl, fields, { [field]: [ungovernedUrl] }
    )), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === `founder_beta_current_copy_source_required:${field}`,
  `${field} must remain a hard current-copy authority boundary`);
}

function webFieldReferenceBody({
  field = "product",
  fields,
  sourceIds,
  returnedUrls = []
}) {
  const payload = audited(fields);
  payload.field_sources = payload.field_sources.map((row) => (
    row.field === field ? { ...row, source_ids: sourceIds } : row
  ));
  return {
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: {
        type: "search", query: "field source reference",
        sources: returnedUrls.map((url) => ({ url }))
      } },
      { type: "message", content: [{
        type: "output_text", text: JSON.stringify(payload),
        annotations: returnedUrls.map((url) => ({ type: "url_citation", url }))
      }] }
    ]
  };
}

const unreturnedReference = "https://www.pokemon.com/checklists/not-returned";
const returnedOfficialReference = "https://www.paniniamerica.net/checklists/returned";
const returnedUnknownReference = "https://www.ebay.com/itm/returned-reference";

const sourceFieldSweepValues = Object.freeze({
  year: "2024",
  language: "English",
  manufacturer: "Topps",
  product: "Chrome",
  set: "Update",
  subjects: ["Sweep Subject"],
  team: "Dodgers",
  card_name: "Future Stars",
  release_variant: "Rookie Debut",
  surface_color: "Gold",
  parallel_family: "Refractor",
  parallel_exact: "Gold Refractor",
  descriptive_rarity: "SSP",
  card_number: "105",
  serial: "12/99",
  attributes: ["RC"],
  grading_info: {
    company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
  },
  grammar: "standard",
  lot_count: "2",
  special_stamp: "Promo",
  description: "Case Hit"
});
const sweepIdentityFields = new Set([
  "year", "manufacturer", "product", "set", "subjects", "card_name"
]);
const sweepFields = (field) => ({
  subjects: field === "subjects" ? sourceFieldSweepValues.subjects : ["Sweep Subject"],
  grammar: field === "lot_count" ? "lot" : "standard",
  [field]: sourceFieldSweepValues[field]
});
const sweepValue = (result, field) => field === "grammar"
  ? result.grammar : result.fields[field];

// Bounded producer -> v2-reader self-consistency oracle across the complete
// source-field vocabulary. Web may support identity, but it is trace-only for
// current-copy fields; grammar keeps its stronger no-Web structural boundary.
for (const field of CANONICAL_FIELD_SOURCE_FIELDS) {
  const fields = sweepFields(field);
  const imageOnly = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(audited(fields))), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  assert.equal(imageOnly.founder_beta_web_receipt.outcome, "NOT_USED");
  assert.doesNotThrow(() => validateFounderBetaWebReceipt(
    imageOnly.founder_beta_web_receipt
  ));

  for (const [url, governed] of [
    [returnedOfficialReference, true], [returnedUnknownReference, false]
  ]) {
    const execution = runCanonicalListingPath({
      imageUrls: ["https://example.invalid/card.jpg"],
      model: "gpt-5.6-luna",
      callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
        field, fields, sourceIds: ["original_image_1", url], returnedUrls: [url]
      })), { status: 200, headers: { "content-type": "application/json" } })
    });
    if (field === "grammar") {
      await assert.rejects(execution, (error) => error.name === "CanonicalProviderError"
        && error.provider_error_code === "founder_beta_web_authority_forbidden:grammar");
      continue;
    }
    const result = await execution;
    assert.deepEqual(sweepValue(result, field), sweepValue(imageOnly, field),
      `${field} canonical value must remain the image-only value`);
    assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
      (row) => row.field === field
    ), sweepIdentityFields.has(field) ? {
      field,
      support_urls: governed ? [url] : [],
      conflict_urls: [],
      unresolved_urls: governed ? [] : [url]
    } : {
      field, support_urls: [], conflict_urls: [], unresolved_urls: [url]
    });
    assert.doesNotThrow(() => validateFounderBetaWebReceipt(
      result.founder_beta_web_receipt
    ), `${field} producer receipt must remain readable by the same v2 validator`);
  }
}

const currentCopySweepFields = CANONICAL_FIELD_SOURCE_FIELDS.filter(
  (field) => !sweepIdentityFields.has(field)
);
for (const field of currentCopySweepFields) {
  const fields = sweepFields(field);
  const expectedAuthorityCode = field === "grammar"
    ? "founder_beta_web_authority_forbidden:grammar"
    : `founder_beta_current_copy_source_required:${field}`;
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      field, fields, sourceIds: [returnedOfficialReference],
      returnedUrls: [returnedOfficialReference]
    })), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === expectedAuthorityCode,
  `${field} must reject Web-only current-copy authority`);

  const unsafeReference = "http://www.paniniamerica.net/checklists/unsafe-current-copy";
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      field, fields, sourceIds: ["original_image_1", unsafeReference],
      returnedUrls: [unsafeReference]
    })), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_web_url_unsafe",
  `${field} must reject an unsafe Web trace before authority admission`);

  const expectedUnreturnedCode = field === "grammar"
    ? "founder_beta_web_authority_forbidden:grammar"
    : "founder_beta_field_source_not_returned";
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      field, fields, sourceIds: ["original_image_1", unreturnedReference]
    })), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === expectedUnreturnedCode,
  `${field} must reject an unreturned current-copy reference`);
}

for (const [sourceId, returnedUrls] of [
  [unreturnedReference, [returnedOfficialReference]]
]) {
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      fields: {
        product: "Unreturned Product", subjects: ["Grounded Subject"], grammar: "standard"
      },
      sourceIds: [sourceId],
      returnedUrls
    })), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.fields.product, "");
  assert.ok(!result.title.includes("Unreturned Product"));
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === "product"
  ), { field: "product", support_urls: [], conflict_urls: [], unresolved_urls: [] });
  assert.ok(!JSON.stringify(result.founder_beta_web_receipt).includes(sourceId),
    "an unreturned reference must never be fabricated into the durable URL receipt");
}

const noFieldEvidenceWithUnreturned = await runCanonicalListingPath({
  imageUrls: ["https://example.invalid/card.jpg"],
  model: "gpt-5.6-luna",
  callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
    fields: {
      product: "Admitted Product", subjects: ["Grounded Subject"], grammar: "standard"
    },
    sourceIds: ["original_image_1", unreturnedReference],
    returnedUrls: []
  })), { status: 200, headers: { "content-type": "application/json" } })
});
assert.equal(noFieldEvidenceWithUnreturned.fields.product, "Admitted Product");
assert.equal(noFieldEvidenceWithUnreturned.founder_beta_web_receipt.outcome,
  "USED_WITHOUT_FIELD_EVIDENCE");
assert.deepEqual(noFieldEvidenceWithUnreturned.founder_beta_web_receipt.field_evidence, []);
assert.ok(!JSON.stringify(noFieldEvidenceWithUnreturned.founder_beta_web_receipt)
  .includes(unreturnedReference),
"the frozen image-admitted boundary must not fabricate an unreturned source into receipt evidence");

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      fields: {
        product: "Admitted Product", subjects: ["Grounded Subject"], grammar: "standard"
      },
      sourceIds: [returnedOfficialReference, unreturnedReference],
      returnedUrls: [returnedOfficialReference]
    })), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.fields.product, "Admitted Product");
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === "product"
  ), {
    field: "product", support_urls: [returnedOfficialReference],
    conflict_urls: [], unresolved_urls: []
  }, "used field evidence preserves the frozen admitted-plus-unreturned behavior");
  assert.ok(!JSON.stringify(result.founder_beta_web_receipt).includes(unreturnedReference));
}

{
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      fields: {
        product: "Unsupported Product", subjects: ["Grounded Subject"], grammar: "standard"
      },
      sourceIds: [returnedUnknownReference, unreturnedReference],
      returnedUrls: [returnedUnknownReference]
    })), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.fields.product, "");
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === "product"
  ), {
    field: "product", support_urls: [], conflict_urls: [],
    unresolved_urls: [returnedUnknownReference]
  });
  assert.ok(!JSON.stringify(result.founder_beta_web_receipt).includes(unreturnedReference));
}

{
  const payload = audited({
    product: "No-call Reference", subjects: ["Grounded Subject"], grammar: "standard"
  });
  payload.field_sources = payload.field_sources.map((row) => (
    row.field === "product" ? { ...row, source_ids: [unreturnedReference] } : row
  ));
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(completedBody(payload)), {
      status: 200, headers: { "content-type": "application/json" }
    })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_field_source_not_returned",
  "a non-image source claim without a real Web call must still fail closed");
}

for (const [field, fields, expectedCode] of [
  ["card_number", {
    card_number: "105", subjects: ["Grounded Subject"], grammar: "standard"
  }, "founder_beta_field_source_not_returned"],
  ["grammar", {
    subjects: ["Grounded Subject"], grammar: "standard"
  }, "founder_beta_web_authority_forbidden:grammar"]
]) {
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
      field,
      fields,
      sourceIds: ["original_image_1", unreturnedReference]
    })), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === expectedCode,
  `${field} must preserve its hard authority boundary for an unreturned reference`);
}

await assert.rejects(runCanonicalListingPath({
  imageUrls: ["https://example.invalid/card.jpg"],
  model: "gpt-5.6-luna",
  callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
    fields: {
      product: "Unsafe Reference", subjects: ["Grounded Subject"], grammar: "standard"
    },
    sourceIds: ["https://user:secret@www.pokemon.com/checklists/unsafe"]
  })), { status: 200, headers: { "content-type": "application/json" } })
}), (error) => error.name === "CanonicalProviderError"
  && error.provider_error_code === "founder_beta_web_url_unsafe",
"URL-shaped unreturned references must still cross the HTTPS safety boundary");

await assert.rejects(runCanonicalListingPath({
  imageUrls: ["https://example.invalid/card.jpg"],
  model: "gpt-5.6-luna",
  callProvider: async () => new Response(JSON.stringify(webFieldReferenceBody({
    fields: {
      product: "Opaque Reference", subjects: ["Grounded Subject"], grammar: "standard"
    },
    sourceIds: ["provider-internal-source-reference"]
  })), { status: 200, headers: { "content-type": "application/json" } })
}), (error) => error.name === "CanonicalProviderError"
  && error.provider_error_code === "founder_beta_web_url_invalid",
"an opaque identity reference must remain a malformed provider source");

function repeatedWebSourcesBody(urls, {
  sourceCopies = 1,
  annotationCopies = 1,
  fieldSources = [urls[0]]
} = {}) {
  const payload = audited({
    product: "Web Source Budget", subjects: ["Grounded Subject"], grammar: "standard"
  });
  payload.field_sources = payload.field_sources.map((row) => (
    row.field === "product" ? { ...row, source_ids: fieldSources } : row
  ));
  return {
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: {
        type: "search", query: "web source budget",
        sources: Array.from({ length: sourceCopies }, () => urls)
          .flat().map((url) => ({ url }))
      } },
      { type: "message", content: [{
        type: "output_text", text: JSON.stringify(payload),
        annotations: Array.from({ length: annotationCopies }, () => urls)
          .flat().map((url) => ({ type: "url_citation", url }))
      }] }
    ]
  };
}

for (const count of [21, 40]) {
  const urls = Array.from({ length: count }, (_, index) => (
    `https://www.paniniamerica.net/checklists/source-${String(index).padStart(2, "0")}`
  )).reverse();
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(repeatedWebSourcesBody(urls, {
      sourceCopies: 2,
      annotationCopies: 2,
      fieldSources: [urls[0]]
    })), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(result.founder_beta_web_receipt.urls, [urls[0]],
    `${count} safe returned candidates must not persist when only one is used by evidence`);
}

{
  const returnedCandidates = Array.from({ length: 25 }, (_, index) => (
    `https://www.paniniamerica.net/checklists/unreferenced-${String(index).padStart(2, "0")}`
  ));
  const unreturned = "https://www.pokemon.com/checklists/not-in-trace";
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(repeatedWebSourcesBody(
      returnedCandidates, { fieldSources: [unreturned] }
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.fields.product, "");
  assert.deepEqual(result.founder_beta_web_receipt.urls, [],
    "neither unreferenced search candidates nor an unreturned source may be fabricated into receipt URLs");
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence, [{
    field: "product", support_urls: [], conflict_urls: [], unresolved_urls: []
  }], "an unreturned-only identity remains a durable empty withheld marker");
}

for (const count of [20, 21]) {
  const urls = Array.from({ length: count + 5 }, (_, index) => (
    `https://www.paniniamerica.net/checklists/evidence-${String(index).padStart(2, "0")}`
  ));
  const execution = runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(repeatedWebSourcesBody(urls, {
      fieldSources: urls.slice(0, count)
    })), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  if (count === 20) {
    const result = await execution;
    assert.deepEqual(result.founder_beta_web_receipt.urls, urls.slice(0, count),
      "20 actually used evidence URLs must remain accepted and sorted");
  } else {
    await assert.rejects(execution, (error) => error.name === "CanonicalProviderError"
      && error.provider_error_code === "founder_beta_web_source_budget_exceeded",
    "21 actually used evidence URLs must exceed the source budget");
  }
}

const safeReturnedUrl = "https://www.paniniamerica.net/checklists/safe-returned";
for (const unsafeUrl of [
  "http://www.paniniamerica.net/checklists/unsafe",
  "https://user:secret@www.paniniamerica.net/checklists/unsafe",
  "https://www.paniniamerica.net:444/checklists/unsafe",
  "not-a-url",
  `https://www.paniniamerica.net/${"x".repeat(2_100)}`
]) {
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(repeatedWebSourcesBody(
      [safeReturnedUrl, unsafeUrl], {
        sourceCopies: 11, annotationCopies: 11, fieldSources: [safeReturnedUrl]
      }
    )), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && ["founder_beta_web_url_unsafe", "founder_beta_web_url_invalid"].includes(
      error.provider_error_code
    ),
  "repeating an unsafe URL must never make it budget-safe");
}

{
  const payload = audited({
    product: "Image Product", subjects: ["Image Subject"], grammar: "standard"
  });
  await assert.rejects(runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify({
      model: "gpt-5.6-luna", reasoning: { effort: "low" }, status: "completed",
      output: [{ type: "message", content: [{
        type: "output_text", text: JSON.stringify(payload),
        annotations: [{ type: "url_citation", url: safeReturnedUrl }]
      }] }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  }), (error) => error.name === "CanonicalProviderError"
    && error.provider_error_code === "founder_beta_web_sources_without_call",
  "an annotation-only returned URL without a real Web call must still fail closed");
}

{
  const variants = [
    "https://www.paniniamerica.net/checklists/same-path?utm_source=search",
    "https://www.paniniamerica.net/checklists/same-path#result"
  ];
  const result = await runCanonicalListingPath({
    imageUrls: ["https://example.invalid/card.jpg"],
    model: "gpt-5.6-luna",
    callProvider: async () => new Response(JSON.stringify(repeatedWebSourcesBody(
      variants, { sourceCopies: 11, annotationCopies: 11, fieldSources: [variants[0]] }
    )), { status: 200, headers: { "content-type": "application/json" } })
  });
  const sanitized = "https://www.paniniamerica.net/checklists/same-path";
  assert.deepEqual(result.founder_beta_web_receipt.urls, [sanitized],
    "query and fragment variants must dedupe by sanitized origin plus pathname");
  assert.deepEqual(result.founder_beta_web_receipt.field_evidence.find(
    (row) => row.field === "product"
  )?.support_urls, [sanitized],
  "field_sources membership must bind a raw URL variant to its sanitized receipt identity");
}

process.stdout.write("thin listing provider boundary: ok\n");
