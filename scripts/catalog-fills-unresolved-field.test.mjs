import assert from "node:assert/strict";
import {
  buildRetrievalApplicationLayer,
  retrievalApplicationDecisions
} from "../lib/listing/candidates/retrieval-application-layer.mjs";

// Requiring the resolver to already hold a value made the catalog a rubber
// stamp: valuePresent(false) is false, so a writer-reviewed row that knows
// rc=true could never reach a card whose resolver said rc=false. These lock the
// three edges of letting it fill instead.

const SELECTED = "catalog_row_1";

function control({
  field = "rc",
  candidateValue = true,
  lane = "catalog",
  sourceType = "INTERNAL_CORRECTED_TITLE",
  sourceTrust = "APPROVED_REFERENCE",
  candidateId = SELECTED,
  resolverValue = false
} = {}) {
  return {
    selected_candidate_decision: { selected_candidate_id: SELECTED },
    candidate_field_inventory: [{
      candidate_id: candidateId,
      candidate_lane: lane,
      field_name: field,
      field: field,
      candidate_value: candidateValue,
      resolver_field: field,
      resolver_value: resolverValue,
      permission: "can_apply",
      source_type: sourceType,
      source_trust: sourceTrust
    }],
    candidate_application_trace: [{
      candidate_id: candidateId,
      candidate_lane: lane,
      decision_eligible: true,
      direct_conflicts: [],
      blocked_fields: []
    }]
  };
}

function decide(options, resolved = {}) {
  const layer = buildRetrievalApplicationLayer({
    result: { resolved_fields: resolved },
    candidateControl: control(options)
  });
  return (layer.decisions || [])[0] || {};
}

// 1. A selected, writer-reviewed catalog row fills a field recognition left
//    false. This is the Travis Hunter case: the row's canonical_title matched
//    the reviewed title word for word and still applied nothing.
const filled = decide({});
assert.equal(filled.decision, retrievalApplicationDecisions.APPLY, "catalog must fill an unresolved field");
assert.equal(filled.reason, "catalog_fills_unresolved_field");

// 2. A visual-vector neighbour must stay confirmation-only. Sampling their
//    values against reviewed titles showed 16% agreement, so letting them fill
//    would inject far more error than it removes.
const vector = decide({ lane: "vector", sourceType: "VISUAL_VECTOR", sourceTrust: "APPROVED_REFERENCE" });
assert.notEqual(vector.decision, retrievalApplicationDecisions.APPLY, "vector neighbours must not fill");

// 3. Filling a hole is not the same as overwriting. When recognition already
//    read a value off the card, the catalog must not replace it.
const occupied = decide({ field: "product", candidateValue: "Panini Prizm", resolverValue: "" }, { product: "Panini Donruss" });
assert.notEqual(occupied.decision, retrievalApplicationDecisions.APPLY, "catalog must not overwrite a resolved value");

// 4. Only the selected candidate fills; other retrieved rows do not.
const unselected = decide({ candidateId: "catalog_row_9" });
assert.notEqual(unselected.decision, retrievalApplicationDecisions.APPLY, "only the selected candidate may fill");

// 5. A marketplace-derived row is not authoritative enough to fill.
const marketplace = decide({ sourceType: "MARKETPLACE_REFERENCE", sourceTrust: "MARKETPLACE" });
assert.notEqual(marketplace.decision, retrievalApplicationDecisions.APPLY, "marketplace rows must not fill");

console.log("catalog fills unresolved field tests passed");
