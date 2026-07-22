import assert from "node:assert/strict";
import { evaluateV4ChainOracleAudit } from "../lib/listing/evaluation/v4-chain-oracle-audit.mjs";

const dataset = {
  schema_version: "golden-sem-partition-v1",
  evaluation_truth_policy: { field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH" },
  items: [{
    item_id: "card-1",
    card_identity_id: "identity-1",
    reviewed_ground_truth: {
      field_statuses: { year: "CONFIRMED", subject: "CONFIRMED", print_finish: "CONFIRMED" },
      fields: { year: "2024", subject: ["Test Player"], print_finish: "Gold" }
    }
  }]
};

const trace = {
  schema_version: "v4-chain-oracle-trace-v1",
  cards: [{
    query_card_id: "card-1",
    evidence_observations: [
      { source: "GPT_5_MINI", fields: { year: "2024", players: ["Test Player"] } },
      { source: "GOOGLE_VISION", fields: {}, raw_text: "CARD FINISH GOLD" }
    ],
    retrieval_candidates: [
      { candidate_id: "wrong", identity_id: "identity-x", rank: 1, fields: { year: "2024" } },
      { candidate_id: "right", identity_id: "identity-1", rank: 2, fields: { year: "2024", players: ["Test Player"], parallel: "Gold" } }
    ],
    selected_candidate_id: "right",
    application_decisions: [
      { field: "year", value: "2024", applied: true },
      { field: "subject", value: ["Test Player"], applied: true },
      { field: "print_finish", value: "Silver", applied: true }
    ],
    resolver_fields: { year: "2024", players: ["Test Player"], parallel: "Gold" },
    renderer_fields: { year: "2024" }
  }]
};

const report = evaluateV4ChainOracleAudit({ dataset, trace, now: () => new Date("2026-07-22T00:00:00Z") });
assert.equal(report.status, "COMPLETED");
assert.equal(report.metrics.evidence_oracle_recall.rate, 1);
assert.equal(report.metrics.retrieval_recall_at_1.rate, 0);
assert.equal(report.metrics.retrieval_recall_at_5.rate, 1);
assert.equal(report.metrics.selection_accuracy_given_retrieved_at_20.rate, 1);
assert.equal(report.metrics.safe_application_recall.rate, 0.666667);
assert.equal(report.metrics.safe_application_precision.rate, 0.666667);
assert.equal(report.metrics.resolver_fidelity.rate, 1);
assert.equal(report.metrics.renderer_fidelity.rate, 0.5);

const proxy = evaluateV4ChainOracleAudit({
  dataset: { ...dataset, evaluation_truth_policy: { field_ground_truth_class: "REVIEWED_TITLE_DERIVED_SEM_PROXY" } },
  trace
});
assert.equal(proxy.status, "PROXY_ONLY");
assert.equal(proxy.truth_policy.formal_oracle_eligible, false);

const trustedPromotion = evaluateV4ChainOracleAudit({
  dataset: { ...dataset, evaluation_truth_policy: { field_ground_truth_class: "TRUSTED_CATALOG_PROMOTED_FIELD_GROUND_TRUTH" } },
  trace
});
assert.equal(trustedPromotion.status, "COMPLETED");
assert.equal(trustedPromotion.truth_policy.formal_oracle_eligible, true);

const missingTrace = evaluateV4ChainOracleAudit({ dataset, trace: { cards: [] } });
assert.equal(missingTrace.metrics.evidence_oracle_recall.rate, null);
assert.equal(missingTrace.metrics.retrieval_recall_at_20.rate, null);
assert.equal(missingTrace.data_quality.stage_trace_card_count.evidence, 0);

console.log("v4 chain oracle audit tests passed");
