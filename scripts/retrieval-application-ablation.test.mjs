import assert from "node:assert/strict";
import { evaluateRetrievalApplicationAblation } from "./evaluate-retrieval-application-ablation.mjs";

const confirmedStatuses = {
  year: "CONFIRMED",
  ip_sport: "UNKNOWN",
  language: "UNKNOWN",
  manufacturer: "UNKNOWN",
  product: "CONFIRMED",
  set: "UNKNOWN",
  subject: "CONFIRMED",
  card_name: "CONFIRMED",
  card_number: "UNKNOWN",
  descriptive_rarity: "UNKNOWN",
  numerical_rarity: "UNKNOWN",
  release_variant: "UNKNOWN",
  print_finish: "UNKNOWN",
  special_stamp: "UNKNOWN",
  grading_info: "UNKNOWN"
};

const dataset = {
  schema_version: "golden-sem-partition-v1",
  dataset_id: "retrieval-ablation-fixture",
  partition: "development",
  items: [
    {
      item_id: "card-1",
      reviewed_ground_truth: {
        field_statuses: confirmedStatuses,
        fields: {
          year: "2024",
          product: "Topps Chrome",
          subject: ["Test Player"],
          card_name: "Autograph"
        }
      }
    },
    {
      item_id: "card-2",
      reviewed_ground_truth: {
        field_statuses: confirmedStatuses,
        fields: {
          year: "2023",
          product: "Panini Prizm",
          subject: ["Second Player"],
          card_name: "Base"
        }
      }
    }
  ]
};

const off = {
  base_url: "https://listing.example",
  provider_success_count: 2,
  provider_success_rate: 1,
  technical_failure_count: 0,
  provider_error_count: 0,
  evaluated_cards_per_minute: 4,
  per_card_latency_ms: { p50: 15000, p95: 18000 },
  usage_totals: { input_tokens: 1000, output_tokens: 500 },
  experiment_contract: {
    contract_id: "retrieval-application-ablation-v1",
    arm: "OFF",
    provider_id: "openai_legacy",
    single_model_fast: false,
    evidence_completion_enabled: true,
    catalog_enabled: false,
    vector_enabled: false,
    retrieval_application_enabled: false,
    external_retrieval_enabled: false,
    identity_result_cache_disabled: true,
    approved_identity_memory_disabled: true,
    corrected_title_hint_sent_to_cloud: false
  },
  results: [
    {
      item_id: "card-1",
      model_id: "gpt-5-mini",
      final_title: "2024 Test Player",
      resolved_fields: {
        year: "2024",
        product: "Topps",
        players: ["Test Player"],
        card_name: "Autograph"
      }
    },
    {
      item_id: "card-2",
      model_id: "gpt-5-mini",
      final_title: "2023 Panini Prizm Second Player Base",
      resolved_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      }
    }
  ]
};

const on = {
  base_url: "https://listing.example",
  provider_success_count: 2,
  provider_success_rate: 1,
  technical_failure_count: 0,
  provider_error_count: 0,
  evaluated_cards_per_minute: 3.5,
  per_card_latency_ms: { p50: 17000, p95: 21000 },
  usage_totals: { input_tokens: 1100, output_tokens: 520 },
  experiment_contract: {
    contract_id: "retrieval-application-ablation-v1",
    arm: "ON",
    provider_id: "openai_legacy",
    single_model_fast: false,
    evidence_completion_enabled: true,
    catalog_enabled: true,
    vector_enabled: true,
    retrieval_application_enabled: true,
    external_retrieval_enabled: false,
    identity_result_cache_disabled: true,
    approved_identity_memory_disabled: true,
    corrected_title_hint_sent_to_cloud: false
  },
  results: [
    {
      item_id: "card-1",
      model_id: "gpt-5-mini",
      catalog_candidate_count: 2,
      vector_raw_candidate_count: 3,
      decision_eligible_candidate_count: 1,
      final_title: "2024 Topps Chrome Test Player Autograph",
      resolved_fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        card_name: "Autograph"
      },
      retrieval_application: {
        candidate_count: 5,
        field_evidence_count: 3,
        identity_evidence_count: 3,
        actual_application_count: 1,
        actual_applied_fields: ["product"],
        decision_counts: { APPLY: 1, SUPPORT: 2, BLOCK: 0, REJECT: 0 },
        decisions: [{
          candidate_id: "catalog-1",
          candidate_lane: "catalog",
          resolver_field: "product",
          decision: "APPLY",
          applied_to_final: true
        }, {
          candidate_id: "catalog-1",
          candidate_lane: "catalog",
          resolver_field: "year",
          decision: "SUPPORT",
          supported_final: true
        }, {
          candidate_id: "catalog-1",
          candidate_lane: "catalog",
          resolver_field: "players",
          decision: "SUPPORT",
          supported_final: true
        }]
      }
    },
    {
      item_id: "card-2",
      model_id: "gpt-5-mini",
      catalog_candidate_count: 1,
      vector_raw_candidate_count: 1,
      decision_eligible_candidate_count: 1,
      final_title: "2023 Panini Prizm Second Player Base",
      resolved_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      },
      retrieval_application: {
        candidate_count: 2,
        field_evidence_count: 3,
        identity_evidence_count: 3,
        actual_application_count: 0,
        actual_applied_fields: [],
        decision_counts: { APPLY: 0, SUPPORT: 3, BLOCK: 0, REJECT: 0 },
        decisions: [{
          candidate_id: "catalog-2",
          candidate_lane: "catalog",
          resolver_field: "product",
          decision: "SUPPORT",
          supported_final: true
        }, {
          candidate_id: "catalog-2",
          candidate_lane: "catalog",
          resolver_field: "year",
          decision: "SUPPORT",
          supported_final: true
        }, {
          candidate_id: "catalog-2",
          candidate_lane: "catalog",
          resolver_field: "players",
          decision: "SUPPORT",
          supported_final: true
        }]
      }
    }
  ]
};

const report = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: on
});

assert.equal(report.cohort.same_card_cohort_complete, true);
assert.equal(report.metrics.retrieval_enabled.candidate_application_count, 1);
assert.equal(report.metrics.retrieval_enabled.title_change_count, 1);
assert.ok(report.metrics.delta.sem_field_accuracy > 0);
assert.ok(report.metrics.delta.critical_field_accuracy > 0);
assert.equal(report.metrics.delta.retrieval_recovery_count, 1);
assert.equal(report.metrics.delta.retrieval_regression_count, 0);
assert.equal(report.metrics.delta.net_benefit, 1);
assert.equal(report.per_card.find((row) => row.item_id === "card-1")?.outcome, "RECOVERY");
assert.deepEqual(report.per_card.find((row) => row.item_id === "card-1")?.retrieval_delta.improved_fields, ["product"]);
assert.deepEqual(report.per_card.find((row) => row.item_id === "card-1")?.retrieval_delta.source, ["catalog"]);
assert.equal(report.metrics.retrieval_enabled.application_funnel.retrieved_candidate_count, 7);
assert.equal(report.metrics.retrieval_enabled.application_funnel.eligible_candidate_count, 2);
assert.equal(report.metrics.retrieval_enabled.application_funnel.apply_decision_count, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.actual_applied_field_count, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_resolved_change, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.cards_with_title_change, 1);
assert.equal(report.metrics.retrieval_enabled.application_funnel.candidate_application_rate, 0.5);
assert.equal(report.metrics.retrieval_disabled.operations.per_card_latency_ms.p50, 15000);
assert.equal(report.metrics.retrieval_enabled.operations.usage_totals.output_tokens, 520);
assert.equal(report.validity.experiment.runtime_isolation.valid, true);
assert.equal(report.validity.causal_comparison_valid, true);

const leakedOff = structuredClone(off);
leakedOff.results[0].catalog_candidate_count = 1;
leakedOff.results[0].retrieval_providers_used = ["postgres_hybrid"];
const leakedReport = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: leakedOff,
  retrievalEnabledReport: on
});
assert.equal(leakedReport.validity.experiment.runtime_isolation.valid, false);
assert.equal(leakedReport.validity.experiment.runtime_isolation.retrieval_off_leak_count, 1);
assert.equal(leakedReport.validity.causal_comparison_valid, false);

console.log("retrieval application ablation tests passed");
