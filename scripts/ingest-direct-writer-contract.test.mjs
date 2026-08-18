import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildCsmDirectFailureResponse } from "../api/csm-listing-title.js";
import { buildCsmIngestFailureResponse } from "../api/csm-listing-title-ingest.js";

// Writer-facing receipt contract for the two recognition routes.
//
// PR #303: the LOT review-required receipt existed on direct and was dropped
// on ingest, so production read a persisted decision as missing.
// PR #309: ingest failures lacked error_type / provider_failure_receipt that
// direct already published.
//
// This file is the lock: every durable terminal, attribution field, and
// receipt the writer is allowed to depend on must be present on both routes.
// A field that appears on only one route fails the test. Route-specific
// transport extras (staged resume, ingest timing, upload recovery) are not
// writer-facing and are excluded from the snapshot.
//
// Lives outside the activation-core freeze (same pattern as
// scripts/lot-review-required-terminal.test.mjs). Adding coverage here must
// not force a remint of scripts/csm-direct-api.test.mjs.

const WRITER_FACING_ALWAYS = Object.freeze([
  "ok",
  "route",
  "code",
  "error_type",
  "retryable",
  "message"
]);

const WRITER_FACING_REVIEW_REQUIRED = Object.freeze([
  "recognition_session_id",
  "review_required",
  "trace_status"
]);

const WRITER_FACING_PROVIDER_ATTEMPT = Object.freeze([
  "error_type",
  "provider_failure_receipt",
  "latency_stages_ms"
]);

const WRITER_FACING_SUCCESS_SOURCE_MARKERS = Object.freeze([
  "recognition_session_id: result.csm_rows.resolution.recognition_session_id",
  "trace_status: \"PERSISTED\""
]);

const ROUTE_SPECIFIC_KEYS = Object.freeze({
  CSM_THIN_DIRECT: Object.freeze([]),
  CSM_THIN_DIRECT_INGEST: Object.freeze([
    "recovery_action",
    "staged_resume_receipt",
    "provider_attempt_started",
    "upload_recovered",
    "verifications",
    "ingest_timing"
  ])
});

const BUILDERS = Object.freeze([
  ["CSM_THIN_DIRECT", buildCsmDirectFailureResponse],
  ["CSM_THIN_DIRECT_INGEST", buildCsmIngestFailureResponse]
]);

function presentKeys(body = {}) {
  // null is not a writer-facing receipt. Direct currently publishes
  // recognition_session_id: null on ordinary failures; ingest omits the key.
  // The writer cannot reopen from null, so both readings are "absent".
  return Object.keys(body).filter((key) => body[key] !== undefined && body[key] !== null).sort();
}

function writerFacingKeys(body = {}, route) {
  const excluded = new Set(["route", ...(ROUTE_SPECIFIC_KEYS[route] || [])]);
  return presentKeys(body).filter((key) => !excluded.has(key));
}

function assertRequiredKeys(body, keys, label) {
  for (const key of keys) {
    assert.notEqual(body[key], undefined, `${label} must publish ${key}`);
  }
}

function assertWriterFacingParity(ingestBody, directBody, label) {
  const ingestKeys = writerFacingKeys(ingestBody, "CSM_THIN_DIRECT_INGEST");
  const directKeys = writerFacingKeys(directBody, "CSM_THIN_DIRECT");
  const onlyIngest = ingestKeys.filter((key) => !directKeys.includes(key));
  const onlyDirect = directKeys.filter((key) => !ingestKeys.includes(key));
  assert.deepEqual(
    { only_ingest: onlyIngest, only_direct: onlyDirect },
    { only_ingest: [], only_direct: [] },
    `${label}: writer-facing field present on only one route`
  );
}

function reviewRequiredTerminal() {
  return Object.assign(new Error("LOT_QUANTITY_UNRESOLVED"), {
    code: "LOT_QUANTITY_UNRESOLVED",
    statusCode: 409,
    retryable: false,
    provider_attempt_started: false,
    recognition_session_id: `csm_${"b".repeat(32)}`,
    review_required: true,
    trace_status: "PERSISTED_REVIEW_REQUIRED"
  });
}

function lotSingleCardTerminal() {
  return Object.assign(new Error("LOT_SINGLE_CARD"), {
    code: "LOT_SINGLE_CARD",
    statusCode: 409,
    retryable: false,
    provider_attempt_started: false,
    recognition_session_id: `csm_${"d".repeat(32)}`,
    review_required: true,
    trace_status: "PERSISTED_REVIEW_REQUIRED"
  });
}

function providerAttemptFailure() {
  return Object.assign(new Error("provider_definitive"), {
    statusCode: 502,
    provider_attempt_started: true,
    provider_request_id: "req_abc123",
    provider_error_code: "server_error",
    provider_error_type: "api_error",
    provider_ms: 4200,
    latency_stages_ms: { provider_ms: 4200, prologue_ms: 12 }
  });
}

function preProviderFailure() {
  return Object.assign(new Error("readiness"), {
    statusCode: 503,
    provider_attempt_started: false
  });
}

const TERMINALS = Object.freeze([
  {
    name: "review-required LOT_QUANTITY_UNRESOLVED",
    error: reviewRequiredTerminal,
    required: [...WRITER_FACING_ALWAYS, ...WRITER_FACING_REVIEW_REQUIRED]
  },
  {
    name: "review-required LOT_SINGLE_CARD",
    error: lotSingleCardTerminal,
    required: [...WRITER_FACING_ALWAYS, ...WRITER_FACING_REVIEW_REQUIRED]
  },
  {
    name: "provider-attempt failure",
    error: providerAttemptFailure,
    required: [...WRITER_FACING_ALWAYS, ...WRITER_FACING_PROVIDER_ATTEMPT]
  },
  {
    name: "pre-provider failure",
    error: preProviderFailure,
    required: [...WRITER_FACING_ALWAYS]
  }
]);

for (const terminal of TERMINALS) {
  const bodies = {};
  for (const [route, build] of BUILDERS) {
    const response = build(terminal.error());
    assert.equal(response.body.ok, false, `${terminal.name} ${route} is a failure`);
    assert.equal(response.body.route, route, `${terminal.name} ${route} route`);
    assertRequiredKeys(response.body, terminal.required, `${terminal.name} ${route}`);
    bodies[route] = response.body;
  }
  assertWriterFacingParity(
    bodies.CSM_THIN_DIRECT_INGEST,
    bodies.CSM_THIN_DIRECT,
    terminal.name
  );
}

const reviewRequiredBodies = Object.fromEntries(
  BUILDERS.map(([route, build]) => [route, build(reviewRequiredTerminal()).body])
);
assert.equal(
  reviewRequiredBodies.CSM_THIN_DIRECT.error_type,
  reviewRequiredBodies.CSM_THIN_DIRECT_INGEST.error_type
);
assert.equal(reviewRequiredBodies.CSM_THIN_DIRECT.error_type, "CSM_REVIEW_REQUIRED");
assert.equal(
  reviewRequiredBodies.CSM_THIN_DIRECT.recognition_session_id,
  reviewRequiredBodies.CSM_THIN_DIRECT_INGEST.recognition_session_id
);

const providerBodies = Object.fromEntries(
  BUILDERS.map(([route, build]) => [route, build(providerAttemptFailure()).body])
);
assert.equal(providerBodies.CSM_THIN_DIRECT.error_type, "CSM_PROVIDER_ATTEMPT_FAILED");
assert.equal(providerBodies.CSM_THIN_DIRECT_INGEST.error_type, "CSM_PROVIDER_ATTEMPT_FAILED");
assert.equal(
  providerBodies.CSM_THIN_DIRECT.provider_failure_receipt.schema_version,
  providerBodies.CSM_THIN_DIRECT_INGEST.provider_failure_receipt.schema_version
);
assert.equal(
  providerBodies.CSM_THIN_DIRECT.provider_failure_receipt.schema_version,
  "csm-provider-failure-receipt-v1"
);

// A transport failure that happens to carry a session id is not a reopen
// receipt. The writer-facing snapshot for this terminal excludes session id,
// review_required, and trace_status on both routes.
const transportFailure = Object.assign(new Error("response_lost"), {
  statusCode: 503,
  recognition_session_id: `csm_${"c".repeat(32)}`
});
const ingestTransport = buildCsmIngestFailureResponse(transportFailure);
assert.equal(ingestTransport.body.review_required, undefined);
assert.equal(ingestTransport.body.trace_status, undefined);
assert.equal(ingestTransport.body.recognition_session_id, undefined);
assertRequiredKeys(ingestTransport.body, WRITER_FACING_ALWAYS, "ingest transport failure");
assertRequiredKeys(
  buildCsmDirectFailureResponse(transportFailure).body,
  WRITER_FACING_ALWAYS,
  "direct transport failure"
);

const [directSource, ingestSource] = await Promise.all([
  readFile(new URL("../api/csm-listing-title.js", import.meta.url), "utf8"),
  readFile(new URL("../api/csm-listing-title-ingest.js", import.meta.url), "utf8")
]);
for (const marker of WRITER_FACING_SUCCESS_SOURCE_MARKERS) {
  assert.match(
    directSource,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `direct success envelope must keep writer-facing ${marker}`
  );
  assert.match(
    ingestSource,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `ingest success envelope must keep writer-facing ${marker}`
  );
}

console.log("ingest/direct writer-facing receipt contract tests passed");
