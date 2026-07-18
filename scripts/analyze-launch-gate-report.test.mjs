import assert from "node:assert/strict";
import { analyzeLaunchGateReport } from "./analyze-launch-gate-report.mjs";

const report = {
  schema_version: "launch-gate-evaluation-report-v1",
  profile: "reviewed-10",
  formal_accuracy_gate: { threshold_rate: 0.87, passed: false },
  technical_summary: {
    attempted_count: 2,
    completed_count: 2,
    failed_count: 0,
    run_wall_ms: 30000,
    pipeline_node_observability: {
      ledger_present_count: 2,
      missing_required_node_count: 0,
      unexplained_terminal_drop_count: 1,
      error_count: 1,
      warning_count: 2,
      anomaly_count: 3,
      node_metrics: [
        { node_id: "provider", duration_p50_ms: 1000, duration_p95_ms: 2000, status_breakdown: { COMPLETED: 2 } },
        { node_id: "preingestion_ocr", duration_p50_ms: 100, duration_p95_ms: 300, status_breakdown: { COMPLETED: 1, PARTIAL: 1 } }
      ],
      anomaly_examples: []
    }
  },
  strata: {
    internal_reviewed_gt: {
      formal_accuracy: {
        metric: "reviewed_title_policy_acceptance_at_0.72",
        correct_count: 1,
        measured_count: 2,
        policy_fair_token_recall_avg: 0.75
      }
    }
  },
  results: [
    {
      asset_id: "pass",
      ok: true,
      final_title: "Pass",
      reference_title: "Pass",
      final_scoring: { policy_fair_token_recall: 1, fair_token_recall: 1 },
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      provider_latency_ms: 1000,
      "x-ratelimit-remaining-requests": "99",
      "x-ratelimit-remaining-tokens": "999",
      l2_catalog_raw_candidate_count: 2,
      l2_catalog_approved_candidate_count: 1,
      l2_catalog_prompt_candidate_count: 1,
      l2_catalog_evidence_support_field_count: 2,
      l2_catalog_participation_level: "LEVEL_3_FIELD_APPLICATION",
      l2_vector_raw_candidate_count: 3,
      l2_vector_approved_candidate_count: 3,
      l2_vector_prompt_candidate_count: 0,
      l2_vector_evidence_support_field_count: 0,
      l2_vector_participation_level: "LEVEL_0_SHADOW",
      l2_candidate_debug: {
        catalog_activation_funnel: { applied_field_count: 1, selected_candidate_id: "catalog-1", title_changed: true },
        vector_activation_funnel: { applied_field_count: 0, selected_candidate_id: "", title_changed: false }
      }
    },
    {
      asset_id: "fail",
      ok: true,
      final_title: "Wrong",
      reference_title: "Reviewed",
      final_scoring: { policy_fair_token_recall: 0.5, fair_token_recall: 0.5 },
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      provider_latency_ms: 2000,
      "x-ratelimit-remaining-requests": "98",
      "x-ratelimit-remaining-tokens": "998",
      l2_catalog_raw_candidate_count: 0,
      l2_catalog_approved_candidate_count: 0,
      l2_catalog_prompt_candidate_count: 0,
      l2_catalog_evidence_support_field_count: 0,
      l2_catalog_participation_level: "LEVEL_0_SHADOW",
      l2_vector_raw_candidate_count: 0,
      l2_vector_approved_candidate_count: 0,
      l2_vector_prompt_candidate_count: 0,
      l2_vector_evidence_support_field_count: 0,
      l2_vector_participation_level: "LEVEL_0_SHADOW",
      l2_candidate_debug: {
        catalog_activation_funnel: { applied_field_count: 0, selected_candidate_id: "", title_changed: false },
        vector_activation_funnel: { applied_field_count: 0, selected_candidate_id: "", title_changed: false }
      }
    }
  ]
};

const diagnostic = analyzeLaunchGateReport(report);
assert.equal(diagnostic.accuracy.rate, 0.5);
assert.equal(diagnostic.technical.cards_per_minute, 4);
assert.equal(diagnostic.provider.input_tokens, 10);
assert.equal(diagnostic.provider.output_tokens, 5);
assert.equal(diagnostic.provider.token_observed_count, 1);
assert.equal(diagnostic.provider.token_missing_count, 1);
assert.equal(diagnostic.provider.token_totals_complete, false);
assert.equal(diagnostic.provider.rate_limit_remaining_requests_min, 98);
assert.equal(diagnostic.pipeline.slowest_nodes[0].node_id, "provider");
assert.equal(diagnostic.pipeline.ocr_partial_card_count, 1);
assert.equal(diagnostic.retrieval.catalog.available_card_count, 1);
assert.equal(diagnostic.retrieval.catalog.applied_card_count, 1);
assert.equal(diagnostic.retrieval.vector.available_card_count, 1);
assert.equal(diagnostic.retrieval.vector.title_changed_card_count, 0);
assert.equal(diagnostic.failed_cards.length, 1);
assert.equal(diagnostic.failed_cards[0].asset_id, "fail");
assert.equal(diagnostic.retrieval.candidate_wrong_but_applied.measurable, false);
assert.match(diagnostic.markdown, /Launch Gate Diagnostic/);

const baseline = structuredClone(report);
baseline.data_contract = {
  sample_provenance: {
    runs: [{ evaluated_item_ids_sha256: "same-sealed-sample" }]
  }
};
baseline.strata.internal_reviewed_gt.formal_accuracy.correct_count = 0;
baseline.technical_summary.run_wall_ms = 60000;
const current = structuredClone(report);
current.data_contract = structuredClone(baseline.data_contract);
const compared = analyzeLaunchGateReport(current, { baselineReport: baseline });
assert.equal(compared.comparison.direct_causal_comparison, true);
assert.equal(compared.comparison.delta.accuracy_rate, 0.5);
assert.equal(compared.comparison.delta.cards_per_minute, 2);
assert.equal(compared.comparison.delta.run_wall_ms, -30000);
assert.match(compared.markdown, /Baseline Comparison/);

const differentSample = structuredClone(baseline);
differentSample.data_contract.sample_provenance.runs[0].evaluated_item_ids_sha256 = "different-sample";
assert.equal(
  analyzeLaunchGateReport(current, { baselineReport: differentSample }).comparison.direct_causal_comparison,
  false
);

console.log("launch-gate diagnostic tests passed");
