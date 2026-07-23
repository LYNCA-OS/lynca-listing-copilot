import assert from "node:assert/strict";
import { buildFactEngineAddressabilityAudit } from "../lib/listing/evaluation/fact-engine-addressability.mjs";

const item = {
  id: "card-1",
  reviewed_ground_truth: {
    fields: { year: "2024-25", product: "Panini Prizm", subject: ["Jane Doe"] },
    field_statuses: { year: "CONFIRMED", product: "CONFIRMED", subject: "CONFIRMED" }
  },
  retrieval_ground_truth: { accepted_candidate_ids: ["catalog-1"] }
};
const report = buildFactEngineAddressabilityAudit({
  dataset: { items: [item] },
  evidenceTaxonomy: { failures: [{ query_card_id: "card-1", field: "year", category: "NORMALIZATION_DROPPED", confidence: "HIGH" }] },
  retrievalDiagnostic: {
    retrieval: { hybrid: { 5: { numerator: 0 } } },
    selection: { opportunities: [], rate: 0.5 },
    safe_application: { opportunities: [], rate: 0.5 }
  },
  smoke: { results: [{ source_feedback_id: "card-1", l2_candidate_debug: { candidate_observation_snapshot: {
    year: "2024",
    product: "Prizm",
    players: ["Jane Doe"]
  } } }] },
  catalog: { cards: [{ id: "catalog-1", source: { source_type: "PANINI_OFFICIAL_CHECKLIST" } }] },
  generatedAt: "2026-07-23T00:00:00.000Z"
});
assert.equal(report.summary.by_category.TEMPORAL_NORMALIZATION, 2);
assert.deepEqual(report.summary.strict_fact_addressable_rate, { numerator: 2, denominator: 2, rate: 1 });
assert.equal(report.theoretical_ceiling.expected_additional_selected_cards_strict, 0.5);
assert.equal(report.theoretical_ceiling.expected_additional_selected_cards_source_backed_strict, 0.5);
assert.deepEqual(report.summary.retrieval_source_backed_strict_addressable_rate, { numerator: 1, denominator: 1, rate: 1 });
assert.equal(report.policy.holdout_rule_tuning_forbidden, true);
console.log("fact engine addressability tests passed");
