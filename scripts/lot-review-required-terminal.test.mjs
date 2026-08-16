import assert from "node:assert/strict";

import { buildCsmDirectFailureResponse } from "../api/csm-listing-title.js";
import { buildCsmIngestFailureResponse } from "../api/csm-listing-title-ingest.js";

// A review-required LOT terminal (LOT_QUANTITY_UNRESOLVED, LOT_SINGLE_CARD) is
// a durable decision, not a transport failure: the recognition row is already
// persisted and the writer reopens the card by its recognition session.
//
// Production run 31952902974 terminated that card through the ingest route as
// a bare 409 -- no recognition_session_id, no review_required, no trace_status
// -- so there was nothing for the writer to reopen and the release gate read a
// persisted decision as a lost one. The direct route already carried the full
// receipt. Both routes publish the same three fields.
const reviewRequiredTerminal = () => Object.assign(
  new Error("LOT_QUANTITY_UNRESOLVED"), {
    code: "LOT_QUANTITY_UNRESOLVED",
    statusCode: 409,
    retryable: false,
    provider_attempt_started: false,
    recognition_session_id: `csm_${"b".repeat(32)}`,
    review_required: true,
    trace_status: "PERSISTED_REVIEW_REQUIRED"
  }
);

for (const [route, build] of [
  ["CSM_THIN_DIRECT", buildCsmDirectFailureResponse],
  ["CSM_THIN_DIRECT_INGEST", buildCsmIngestFailureResponse]
]) {
  const response = build(reviewRequiredTerminal());
  assert.equal(response.status, 409, `${route} review-required status`);
  assert.equal(response.body.route, route);
  assert.equal(response.body.code, "LOT_QUANTITY_UNRESOLVED", `${route} code`);
  assert.equal(response.body.retryable, false, `${route} is not retryable`);
  assert.equal(response.body.review_required, true, `${route} review_required`);
  assert.equal(response.body.trace_status, "PERSISTED_REVIEW_REQUIRED",
    `${route} trace_status`);
  assert.equal(response.body.recognition_session_id, `csm_${"b".repeat(32)}`,
    `${route} must carry the recognition session the writer reopens`);
}

// The receipt is bound to the review-required terminal. An ordinary transport
// failure that happens to carry a session id must not publish one: a writer
// offered a reopen handle for a lost request would be reopening nothing.
const transportFailure = buildCsmIngestFailureResponse(
  Object.assign(new Error("response_lost"), {
    statusCode: 503,
    recognition_session_id: `csm_${"c".repeat(32)}`
  })
);
assert.equal(transportFailure.body.review_required, undefined);
assert.equal(transportFailure.body.trace_status, undefined);
assert.equal(transportFailure.body.recognition_session_id, undefined,
  "only a review-required terminal publishes a session id from the ingest route");

console.log("LOT review-required terminal contract tests passed");
