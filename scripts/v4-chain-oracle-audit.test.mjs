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

const plannedButResolverBlocked = evaluateV4ChainOracleAudit({
  dataset,
  trace: {
    ...trace,
    cards: [{
      ...trace.cards[0],
      application_decisions: [
        { field: "year", value: "2024", old_value: null, decision: "APPLY", applied_to_final: false },
        { field: "subject", value: ["Test Player"], old_value: ["Test Player"], decision: "SUPPORT", supported_final: true },
        { field: "print_finish", value: "Gold", old_value: null, decision: "BLOCK", applied_to_final: false }
      ]
    }]
  }
});
assert.equal(plannedButResolverBlocked.metrics.safe_application_recall.denominator, 2);
assert.equal(plannedButResolverBlocked.metrics.safe_application_recall.numerator, 0);
assert.equal(plannedButResolverBlocked.metrics.safe_application_precision.denominator, 0);
assert.equal(plannedButResolverBlocked.cards[0].fields.subject.application_opportunity, false);
assert.equal(plannedButResolverBlocked.cards[0].fields.year.application_planned, true);

const semAliasApplication = evaluateV4ChainOracleAudit({
  dataset,
  trace: {
    ...trace,
    cards: [{
      ...trace.cards[0],
      application_decisions: [
        { field: "parallel_exact", value: "Gold", old_value: null, applied_to_final: true }
      ]
    }]
  }
});
assert.equal(semAliasApplication.metrics.per_field.print_finish.safe_application_recall.numerator, 1);
assert.equal(semAliasApplication.metrics.per_field.print_finish.safe_application_precision.numerator, 1);

const denominatorAlreadyPresent = evaluateV4ChainOracleAudit({
  dataset: {
    ...dataset,
    items: [{
      ...dataset.items[0],
      reviewed_ground_truth: {
        field_statuses: { numerical_rarity: "CONFIRMED" },
        fields: { numerical_rarity: "11/25" }
      }
    }]
  },
  trace: {
    cards: [{
      query_card_id: "card-1",
      retrieval_candidates: [{
        candidate_id: "right",
        identity_id: "identity-1",
        rank: 1,
        fields: { numerical_rarity: "#/25" }
      }],
      selected_candidate_id: "right",
      application_decisions: [{
        candidate_id: "right",
        field: "numerical_rarity",
        value: "#/25",
        old_value: "25",
        decision: "BLOCK",
        applied_to_final: false
      }],
      resolver_fields: { numerical_rarity: "25" },
      renderer_fields: { numerical_rarity: "#/25" }
    }]
  }
});
assert.equal(denominatorAlreadyPresent.metrics.safe_application_recall.denominator, 0);

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

const sealedSelfContamination = evaluateV4ChainOracleAudit({
  dataset: {
    ...dataset,
    items: [{
      ...dataset.items[0],
      card_identity_id: null,
      retrieval_ground_truth: {
        accepted_candidate_ids: ["independent-identity"],
        sealed_source_candidate_ids: ["self-identity"]
      }
    }]
  },
  trace: {
    cards: [{
      ...trace.cards[0],
      retrieval_candidates: [
        { candidate_id: "self", identity_id: "self-identity", rank: 1, fields: { year: "2024" } },
        { candidate_id: "independent", identity_id: "independent-identity", rank: 2, fields: { year: "2024" } }
      ],
      selected_candidate_id: "self"
    }]
  }
});
assert.equal(sealedSelfContamination.status, "CONTAMINATED");
assert.equal(sealedSelfContamination.truth_policy.trace_formal_oracle_eligible, false);
assert.equal(sealedSelfContamination.data_quality.sealed_source_candidate_retrieved_card_count, 1);
assert.equal(sealedSelfContamination.data_quality.sealed_source_candidate_selected_card_count, 1);
assert.equal(sealedSelfContamination.metrics.selection_accuracy_given_retrieved_at_20.denominator, 1);
assert.equal(sealedSelfContamination.metrics.selection_accuracy_given_retrieved_at_20.numerator, 0);
assert.equal(sealedSelfContamination.metrics.safe_application_precision.denominator, 0);
assert.equal(sealedSelfContamination.cards[0].sealed_source_candidate_selected, true);

const semanticIndependentTruth = evaluateV4ChainOracleAudit({
  dataset: {
    ...dataset,
    items: [{
      ...dataset.items[0],
      card_identity_id: null,
      retrieval_ground_truth: {
        accepted_candidate_ids: [],
        accepted_identity_ids: ["card_identity:sealed-truth"],
        identity_fields: {
          year: "2024",
          product: "Topps Chrome",
          subject: ["Test Player"],
          card_number: "17",
          serial_denominator: "50"
        },
        retrieval_evaluable: true
      }
    }]
  },
  trace: {
    cards: [{
      ...trace.cards[0],
      retrieval_candidates: [{
        candidate_id: "semantic-match",
        rank: 1,
        fields: {
          year: "2024",
          product: "Topps Chrome",
          players: ["Test Player"],
          card_number: "17",
          numerical_rarity: "16/50"
        }
      }],
      selected_candidate_id: "semantic-match"
    }]
  }
});
assert.equal(semanticIndependentTruth.metrics.retrieval_recall_at_1.rate, 1);
assert.equal(semanticIndependentTruth.metrics.selection_accuracy_given_retrieved_at_20.rate, 1);

const missingTrace = evaluateV4ChainOracleAudit({ dataset, trace: { cards: [] } });
assert.equal(missingTrace.metrics.evidence_oracle_recall.rate, null);
assert.equal(missingTrace.metrics.retrieval_recall_at_20.rate, null);
assert.equal(missingTrace.data_quality.stage_trace_card_count.evidence, 0);

console.log("v4 chain oracle audit tests passed");
