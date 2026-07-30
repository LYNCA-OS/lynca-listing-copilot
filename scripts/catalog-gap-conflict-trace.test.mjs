import assert from "node:assert/strict";

import { catalogGapCandidateSnapshot } from "../api/v4/listing-copilot-title.js";

const snapshot = catalogGapCandidateSnapshot({
  selected_candidate_decision: {
    rejected_candidate_reasons: [{
      candidate_id: "catalog-1",
      reasons: ["direct_conflict:year", "marketplace_not_truth"]
    }, {
      candidate_id: "vector-1",
      reasons: ["anchor_contradiction:collector_number"]
    }]
  },
  candidate_application_trace_rows: [{
    candidate_lane: "catalog",
    candidate_id: "catalog-1",
    direct_conflicts: ["year"],
    blocked_fields: ["year", "product"],
    reason_per_field: { product: "support_only_requires_current_image_or_catalog_selection" }
  }, {
    candidate_lane: "vector",
    candidate_id: "vector-1",
    anchor_agreement: { contradicted: ["collector_number"] },
    blocked_fields: ["collector_number"]
  }],
  catalog_activation_funnel: {
    conflict_blocked_count: 2,
    blocked_fields: ["year", "product", "year"],
    blocked_reasons: ["DIRECT_CONFLICT", "ANCHOR_MISMATCH"]
  },
  vector_activation_funnel: {
    conflict_blocked_count: 1,
    blocked_fields: ["collector_number"],
    blocked_reasons: ["CURRENT_IMAGE_CONFLICT"]
  }
});

assert.deepEqual(snapshot.conflict_details.catalog.blocked_fields, ["year", "product"]);
assert.deepEqual(snapshot.conflict_details.catalog.blocked_reasons, ["DIRECT_CONFLICT", "ANCHOR_MISMATCH"]);
assert.deepEqual(snapshot.conflict_details.vector.blocked_fields, ["collector_number"]);
assert.deepEqual(snapshot.conflict_details.vector.blocked_reasons, ["CURRENT_IMAGE_CONFLICT"]);
assert.deepEqual(snapshot.conflict_rows, [{
  lane: "catalog",
  candidate_id: "catalog-1",
  field: "year",
  reason: "DIRECT_CONFLICT"
}, {
  lane: "catalog",
  candidate_id: "catalog-1",
  field: "product",
  reason: "support_only_requires_current_image_or_catalog_selection"
}, {
  lane: "catalog",
  candidate_id: "catalog-1",
  field: null,
  reason: "MARKETPLACE_NOT_TRUTH"
}, {
  lane: "vector",
  candidate_id: "vector-1",
  field: "collector_number",
  reason: "ANCHOR_CONTRADICTION"
}]);

console.log("catalog gap conflict trace tests passed");
