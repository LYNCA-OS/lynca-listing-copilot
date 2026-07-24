import assert from "node:assert/strict";
import { buildRetrievalSelectionDiagnostic } from "../lib/listing/evaluation/retrieval-selection-diagnostic.mjs";

const report = buildRetrievalSelectionDiagnostic({
  dataset: { items: [{ id: "one", category: "baseball", retrieval_ground_truth: { retrieval_evaluable: true, accepted_identity_ids: ["truth"] }, reviewed_ground_truth: { field_statuses: {} } }] },
  audit: { cards: [{ query_card_id: "one", correct_candidate_id: "candidate", selected_candidate_correct: true, fields: { print_finish: { downstream_trace_eligible: true, application_opportunity: true, application_correct: false } } }] },
  trace: { cards: [{ query_card_id: "one", selected_candidate_id: "candidate", retrieval_candidates: [{ candidate_id: "candidate", identity_id: "truth", rank: 1, source: "catalog" }], application_decisions: [{ candidate_id: "candidate", field: "surface_color", source_field: "surface_color", reason: "field_not_in_safe_application_plan", decision: "BLOCK" }] }] },
  smoke: { results: [{ source_feedback_id: "one", ok: true, l2_candidate_debug: { selected_candidate_id: "candidate", candidate_application_trace: [{ candidate_id: "candidate", candidate_identity_id: "truth", source_type: "OFFICIAL_CHECKLIST", retrieval_rank: 1 }] } }] },
  generatedAt: "2026-07-23T00:00:00.000Z"
});
assert.deepEqual(report.retrieval.official_catalog[1], { numerator: 1, denominator: 1, rate: 1 });
assert.equal(report.retrieval.hybrid[5].rate, 1);
assert.equal(report.selection.rate, 1);
assert.deepEqual(report.safe_application.reason_counts, { field_not_in_safe_application_plan: 1 });
assert.equal(report.policy.holdout_is_read_only, true);
console.log("retrieval selection diagnostic tests passed");
