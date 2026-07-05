import assert from "node:assert/strict";
import {
  buildInternalCleanlabPayload,
  buildInternalFiftyOnePayload,
  buildInternalLightGbmPayload,
  buildInternalPhoenixPayload,
  buildInternalSplinkPayload,
  handleInternalSidecar
} from "../../lib/data-loop/internal-sidecar-endpoints.mjs";

const event = {
  event_id: "evt-sidecar-internal",
  analysis_run_id: "analysis-internal",
  review_required_fields: ["serial_number"],
  risk_flags: ["FIELD_CONFLICT"],
  catalog_candidates: [{
    candidate_id: "approved-1",
    source_trust: "APPROVED_REFERENCE",
    normalized_score: 0.83,
    supporting_fields: ["year", "product", "subject"],
    conflicting_fields: []
  }, {
    candidate_id: "weak-conflict",
    source_trust: "CANDIDATE",
    normalized_score: 0.91,
    supporting_fields: ["subject"],
    direct_evidence_conflicts: ["year", "collector_number"]
  }]
};

const splink = buildInternalSplinkPayload({ event });
assert.equal(splink.ok, true);
assert.equal(splink.candidate_count, 2);
assert.equal(splink.approved_candidate_count, 1);
assert.equal(splink.direct_conflict_count, 1);
assert.ok(splink.cluster_id.startsWith("internal-cluster-"));
assert.equal(splink.output_contract, "candidate_cluster_shadow_only");

const cleanlab = buildInternalCleanlabPayload({ event });
assert.equal(cleanlab.ok, true);
assert.equal(cleanlab.conflict_count, 2);
assert.equal(cleanlab.review_required_field_count, 1);
assert.ok(cleanlab.label_quality_score < 0.95);

const fiftyone = buildInternalFiftyOnePayload({
  event,
  dataset_name: "workflow-test"
});
assert.equal(fiftyone.synced, true);
assert.equal(fiftyone.dataset_name, "workflow-test");
assert.equal(fiftyone.hard_negative_candidate_count, 1);

const lightgbm = buildInternalLightGbmPayload({ event });
assert.equal(lightgbm.shadow_only, true);
assert.equal(lightgbm.selected_candidate_id, "approved-1");
assert.equal(lightgbm.output_contract, "shadow_candidate_score_only");
assert.ok(lightgbm.scored_candidates[0].score >= lightgbm.scored_candidates[1].score);

const phoenix = buildInternalPhoenixPayload({
  spans: [{
    span_id: "span-1",
    trace_id: "trace-1"
  }]
});
assert.equal(phoenix.accepted, true);
assert.equal(phoenix.span_count, 1);
assert.equal(phoenix.trace_id, "trace-1");

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value) {
      this.body = value;
    },
    json() {
      return JSON.parse(this.body);
    }
  };
}

let res = mockRes();
await handleInternalSidecar({
  method: "POST",
  headers: {},
  body: { event }
}, res, {
  env: {
    DATA_LOOP_INTERNAL_SIDECAR_TOKEN: "secret"
  },
  buildPayload: buildInternalLightGbmPayload
});
assert.equal(res.statusCode, 401);
assert.equal(res.json().error, "unauthorized");

res = mockRes();
await handleInternalSidecar({
  method: "POST",
  headers: {
    authorization: "Bearer secret"
  },
  body: { event }
}, res, {
  env: {
    DATA_LOOP_INTERNAL_SIDECAR_TOKEN: "secret"
  },
  buildPayload: buildInternalLightGbmPayload
});
assert.equal(res.statusCode, 200);
assert.equal(res.json().selected_candidate_id, "approved-1");

res = mockRes();
await handleInternalSidecar({
  method: "POST",
  headers: {
    authorization: "Bearer secret"
  },
  body: { event }
}, res, {
  env: {},
  buildPayload: buildInternalLightGbmPayload
});
assert.equal(res.statusCode, 503);
assert.equal(res.json().error, "internal_sidecar_token_missing");

console.log("internal-sidecar-endpoints tests passed");
