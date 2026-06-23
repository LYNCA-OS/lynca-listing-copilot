import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";

const dataset = JSON.parse(await readFile("data/golden-dataset.json", "utf8"));
const report = evaluateGoldenDataset(dataset);

assert.equal(report.ok, true);
assert.equal(report.dataset.total_assets, 7);
assert.equal(report.dataset.evaluated_assets, 7);
assert.equal(report.dataset.split_counts.development, 7);
assert.equal(report.dataset.split_counts.held_out_commercial, 0);
assert.equal(report.dataset.commercial_claim_allowed, false);
assert.equal(report.dataset.legacy_metric_scope, "all_configured_splits");
assert.equal(report.dataset.commercial_metric_scope, "held_out_commercial");
assert.equal(report.all_configured_splits_evidence.total_assets, 7);
assert.equal(report.all_configured_splits_evidence.commercial_metrics.ai_overall_exact_resolution_rate, 2 / 7);
assert.equal(report.held_out_commercial_evidence.metric_scope, "held_out_commercial");
assert.equal(report.held_out_commercial_evidence.total_assets, 0);
assert.equal(report.held_out_commercial_evidence.commercial_metrics.ai_overall_exact_resolution_rate, null);
assert.equal(report.commercial_acceptance_gate.metric_scope, "held_out_commercial");
assert.equal(report.commercial_acceptance_gate.passed, false);
assert.equal(report.commercial_acceptance_gate.minimum_held_out_assets, 100);
assert.ok(report.commercial_acceptance_gate.reasons.some((reason) => /held_out_commercial split is empty/i.test(reason)));

assert.equal(report.counts.exact_assets, 2);
assert.equal(report.counts.ai_complete_assets, 4);
assert.equal(report.counts.ai_complete_exact_assets, 2);
assert.equal(report.counts.false_ai_complete_assets, 2);
assert.equal(report.counts.human_critical_resolution_assets, 2);
assert.equal(report.counts.accepted_critical_error_assets, 1);
assert.equal(report.counts.final_approved_publish_assets, 5);
assert.equal(report.counts.final_approved_publish_exact_assets, 3);
assert.equal(report.counts.final_approved_publish_error_assets, 2);
assert.equal(report.counts.technical_failure_assets, 1);
assert.equal(report.counts.routing_correct_assets, 5);
assert.equal(report.counts.non_standard_assets, 1);
assert.equal(report.counts.non_standard_correct_assets, 1);

assert.equal(report.commercial_metrics.ai_overall_exact_resolution_rate, 2 / 7);
assert.equal(report.commercial_metrics.card_level_exact_accuracy, 2 / 7);
assert.equal(report.commercial_metrics.field_level_accuracy, 36 / 50);
assert.equal(report.commercial_metrics.human_authored_critical_resolution_rate, 2 / 7);
assert.equal(report.commercial_metrics.accepted_critical_error_rate, 1 / 7);
assert.equal(report.commercial_metrics.ai_complete_result_precision, 2 / 4);
assert.equal(report.commercial_metrics.final_approved_publish_accuracy, 3 / 5);
assert.equal(report.commercial_metrics.technical_failure_rate, 1 / 7);
assert.equal(report.commercial_metrics.routing_accuracy, 5 / 7);
assert.equal(report.commercial_metrics.non_standard_recall, 1);

assert.equal(report.commercial_metrics.retrieval_recovery_rate.attempted_assets, 1);
assert.equal(report.commercial_metrics.retrieval_recovery_rate.rate, 1);
assert.equal(report.commercial_metrics.focused_reread_recovery_rate.attempted_assets, 1);
assert.equal(report.commercial_metrics.focused_reread_recovery_rate.rate, 1);
assert.equal(report.commercial_metrics.targeted_rescan_recovery_rate.attempted_assets, 1);
assert.equal(report.commercial_metrics.targeted_rescan_recovery_rate.rate, 1);
assert.equal(report.commercial_metrics.glare_recovery_rate.attempted_assets, 1);
assert.equal(report.commercial_metrics.glare_recovery_rate.rate, 1);

assert.equal(report.final_approved_publish.approved_assets, 5);
assert.equal(report.final_approved_publish.final_exact_assets, 3);
assert.equal(report.final_approved_publish.error_assets, 2);
assert.deepEqual(report.final_approved_publish.sample_error_asset_ids, ["dev-exact-focused-serial-001", "dev-false-ai-complete-005"]);

assert.equal(report.glare_impact.glare_assets, 1);
assert.equal(report.glare_impact.exact_rate, 1);
assert.equal(report.glare_impact.non_glare_exact_rate, 1 / 6);
assert.equal(report.glare_impact.exact_rate_delta_vs_non_glare, 0.8333333333333334);
assert.equal(report.glare_impact.human_critical_resolution_rate, 0);
assert.equal(report.glare_impact.accepted_critical_error_rate, 0);
assert.equal(report.glare_impact.technical_failure_rate, 0);
assert.equal(report.glare_impact.final_approved_publish_accuracy, 1);
assert.deepEqual(report.glare_impact.sample_asset_ids, ["dev-glare-targeted-rescan-003"]);

assert.equal(report.retrieval_provider_gains.brave.used_assets, 1);
assert.equal(report.retrieval_provider_gains.brave.recovered_assets, 1);
assert.equal(report.retrieval_provider_gains.brave.recovery_rate, 1);
assert.deepEqual(report.retrieval_provider_gains.brave.sample_asset_ids, ["dev-exact-retrieval-002"]);
assert.equal(report.retrieval_provider_gains.ebay_browse.used_assets, 1);
assert.equal(report.retrieval_provider_gains.ebay_browse.recovered_assets, 0);
assert.equal(report.retrieval_provider_gains.ebay_browse.reference_helped_assets, 1);
assert.equal(report.retrieval_provider_gains.ebay_browse.reference_helped_rate, 1);
assert.equal(report.retrieval_provider_gains.openai_web_search.used_assets, 1);
assert.equal(report.retrieval_provider_gains.openai_web_search.recovered_assets, 0);
assert.equal(report.retrieval_provider_gains.openai_web_search.exact_when_used_rate, 0);

assert.equal(report.breakdowns.provider.agnes.total_assets, 6);
assert.equal(report.breakdowns.provider.agnes.exact_assets, 2);
assert.equal(report.breakdowns.provider.agnes.rate, 1 / 3);
assert.equal(report.breakdowns.provider.openai_legacy.total_assets, 1);
assert.equal(report.breakdowns.category.sports_card.total_assets, 6);
assert.equal(report.breakdowns.category.sports_card.rate, 1 / 3);
assert.equal(report.breakdowns.difficulty.serial.total_assets, 3);
assert.equal(report.breakdowns.difficulty.serial.exact_assets, 1);
assert.equal(report.breakdowns.difficulty.front_only.rate, 0);

assert.equal(report.vision_provider_comparison.providers.agnes.ai_complete_precision, 2 / 3);
assert.equal(report.vision_provider_comparison.providers.agnes.technical_failure_rate, 1 / 6);
assert.equal(report.vision_provider_comparison.providers.openai_legacy.ai_complete_precision, 0);
assert.equal(report.vision_provider_comparison.providers.openai_legacy.accepted_critical_error_rate, 1);
assert.equal(report.vision_provider_comparison.agnes_vs_openai_legacy.exact_rate_delta, 1 / 3);
assert.equal(report.vision_provider_comparison.agnes_vs_openai_legacy.ai_complete_precision_delta, 2 / 3);
assert.equal(report.vision_provider_comparison.agnes_vs_openai_legacy.accepted_critical_error_rate_delta, -1);

assert.equal(report.confidence_intervals.method, "wilson_score");
assert.equal(report.confidence_intervals.confidence_level, 0.95);
assert.equal(report.confidence_intervals.ai_overall_exact_resolution_rate.successes, 2);
assert.equal(report.confidence_intervals.ai_overall_exact_resolution_rate.total, 7);
assert.equal(report.confidence_intervals.ai_overall_exact_resolution_rate.lower, 0.082217);
assert.equal(report.confidence_intervals.ai_overall_exact_resolution_rate.upper, 0.641071);
assert.equal(report.confidence_intervals.ai_complete_result_precision.successes, 2);
assert.equal(report.confidence_intervals.ai_complete_result_precision.total, 4);
assert.equal(report.confidence_intervals.ai_complete_result_precision.lower, 0.150036);
assert.equal(report.confidence_intervals.ai_complete_result_precision.upper, 0.849964);
assert.equal(report.confidence_intervals.final_approved_publish_accuracy.successes, 3);
assert.equal(report.confidence_intervals.final_approved_publish_accuracy.total, 5);
assert.equal(report.confidence_intervals.final_approved_publish_accuracy.lower, 0.23072);
assert.equal(report.confidence_intervals.final_approved_publish_accuracy.upper, 0.882382);
assert.equal(report.confidence_intervals.recovery.targeted_rescan_recovery_rate.successes, 1);
assert.equal(report.confidence_intervals.recovery.targeted_rescan_recovery_rate.total, 1);
assert.equal(report.confidence_intervals.recovery.targeted_rescan_recovery_rate.lower, 0.206543);
assert.equal(report.confidence_intervals.recovery.targeted_rescan_recovery_rate.upper, 1);

assert.equal(report.failure_analysis.root_causes.critical_field_mismatch.assets, 5);
assert.equal(report.failure_analysis.root_causes.human_critical_resolution.assets, 2);
assert.equal(report.failure_analysis.root_causes.route_mismatch.assets, 2);
assert.equal(report.failure_analysis.root_causes.false_ai_complete.assets, 2);
assert.deepEqual(report.failure_analysis.root_causes.false_ai_complete.sample_asset_ids, ["dev-exact-focused-serial-001", "dev-false-ai-complete-005"]);
assert.equal(report.failure_analysis.field_error_distribution.final_title_required_fields.incorrect, 5);
assert.equal(report.failure_analysis.field_error_distribution.final_title_unsubstantiated_fields.incorrect, 2);
assert.equal(report.failure_analysis.field_error_distribution.product.incorrect, 2);
assert.equal(report.failure_analysis.field_error_distribution.product.missing_prediction, 2);
assert.equal(report.failure_analysis.field_error_distribution.serial_number.incorrect, 1);
assert.equal(report.failure_analysis.field_error_distribution.serial_number.missing_prediction, 0);
assert.equal(report.failure_analysis.field_error_distribution.parallel.error_rate, 1);

assert.equal(report.correction_rate_per_field.serial_number.corrections, 1);
assert.equal(report.correction_rate_per_field.serial_number.critical_field_denominator, 3);
assert.equal(report.operational_metrics.average_provider_calls, 9 / 7);
assert.equal(report.operational_metrics.average_retrieval_rounds, 6 / 7);
assert.equal(report.operational_metrics.cost_per_asset, 0.010286);
assert.ok(report.warnings.some((warning) => /Held-out commercial split is empty/i.test(warning)));
assert.ok(report.warnings.some((warning) => /Commercial acceptance gate failed/i.test(warning)));

const cli = spawnSync(process.execPath, ["scripts/eval-golden.mjs"], {
  encoding: "utf8"
});
assert.equal(cli.status, 0);
assert.match(cli.stdout, /legacy_metric_scope: all_configured_splits/);
assert.match(cli.stdout, /commercial_metric_scope: held_out_commercial/);
assert.match(cli.stdout, /held_out_commercial_assets: 0/);
assert.match(cli.stdout, /commercial_acceptance_gate: scope:held_out_commercial eligible:false passed:false minimum_held_out_assets:100/);
assert.match(cli.stdout, /commercial_acceptance_reasons: held_out_commercial split is empty/);
assert.match(cli.stdout, /held_out_ai_overall_exact_resolution_rate: n\/a/);
assert.match(cli.stdout, /provider_breakdown: .*agnes=2\/6\(0\.3333333333333333\).*openai_legacy=0\/1\(0\)/);
assert.match(cli.stdout, /category_breakdown: .*sports_card=2\/6\(0\.3333333333333333\).*non_standard_collectible=0\/1\(0\)/);
assert.match(cli.stdout, /difficulty_breakdown: .*front_back=2\/4\(0\.5\).*serial=1\/3\(0\.3333333333333333\)/);
assert.match(cli.stdout, /confidence_interval_method: wilson_score/);
assert.match(cli.stdout, /ai_overall_exact_resolution_rate_ci95: 0\.082217\.\.0\.641071/);
assert.match(cli.stdout, /ai_complete_result_precision_ci95: 0\.150036\.\.0\.849964/);
assert.match(cli.stdout, /accepted_critical_error_rate_ci95: 0\.025679\.\.0\.513135/);
assert.match(cli.stdout, /final_approved_publish_accuracy: 0\.6/);
assert.match(cli.stdout, /final_approved_publish_accuracy_ci95: 0\.23072\.\.0\.882382/);
assert.match(cli.stdout, /failure_root_causes: critical_field_mismatch=5\/7\(0\.7142857142857143\).*human_critical_resolution=2\/7\(0\.2857142857142857\).*route_mismatch=2\/7\(0\.2857142857142857\)/);
assert.match(cli.stdout, /field_error_distribution: final_title_required_fields=5\/7\(0\.7142857142857143\).*final_title_unsubstantiated_fields=2\/7\(0\.2857142857142857\).*product=2\/7\(0\.2857142857142857\).*serial_number=1\/3\(0\.3333333333333333\).*parallel=1\/1\(1\)/);
assert.match(cli.stdout, /glare_impact: glare_assets:1\/7\(0\.14285714285714285\) exact:1\/1\(1\) non_glare_exact:0\.16666666666666666 delta:0\.8333333333333334.*final_approved:1\/1\(1\)/);
assert.match(cli.stdout, /retrieval_provider_gains: brave=used:1\/7\(0\.14285714285714285\) recovered:1\/1\(1\).*ebay_browse=used:1\/7\(0\.14285714285714285\) recovered:0\/1\(0\) reference:1\/1\(1\).*openai_web_search=used:1\/7\(0\.14285714285714285\) recovered:0\/1\(0\)/);
assert.match(cli.stdout, /vision_provider_comparison: agnes=exact:2\/6\(0\.3333333333333333\).*ai_complete_precision:2\/3\(0\.6666666666666666\).*technical_failure:1\/6\(0\.16666666666666666\).*openai_legacy=exact:0\/1\(0\).*ai_complete_precision:0\/1\(0\).*accepted_critical_error:1\/1\(1\)/);
assert.match(cli.stdout, /agnes_vs_openai_legacy: exact_rate_delta=0\.3333333333333333, ai_complete_precision_delta=0\.6666666666666666, technical_failure_rate_delta=0\.16666666666666666, accepted_critical_error_rate_delta=-1/);

const traceOnlyReport = evaluateGoldenDataset({
  schema_version: "golden-dataset-v1",
  splits: {
    development: [
      {
        asset_id: "trace-only-brave-activity",
        images: ["fixtures/trace-only-brave-activity/front.jpg"],
        category: "sports_card",
        difficulty_tags: ["front_only"],
        capture_tags: ["front_only"],
        ground_truth_route: "WRITER_REVIEW_REQUIRED",
        ground_truth_fields: {
          year: "2024"
        },
        critical_fields: ["year"],
        prediction: {
          route: "WRITER_REVIEW_REQUIRED",
          provider: "agnes",
          resolved_fields: {
            year: "2024"
          },
          retrieval: {
            trace: [
              {
                provider_id: "brave",
                status: "ok"
              }
            ]
          }
        }
      }
    ],
    calibration: [],
    held_out_commercial: []
  }
});
assert.equal(traceOnlyReport.retrieval_provider_gains.brave.used_assets, 1);
assert.equal(traceOnlyReport.retrieval_provider_gains.brave.recovered_assets, 0);
assert.equal(traceOnlyReport.retrieval_provider_gains.brave.reference_helped_assets, 0);

const heldOutScopedReport = evaluateGoldenDataset({
  schema_version: "golden-dataset-v1",
  commercial_acceptance: {
    minimum_held_out_assets: 1,
    required_strata: []
  },
  splits: {
    development: [
      {
        asset_id: "dev-failing-not-commercial-001",
        images: ["fixtures/dev-failing-not-commercial-001/front.jpg"],
        category: "sports_card",
        difficulty_tags: ["front_only"],
        capture_tags: ["front_only"],
        ground_truth_route: "AI_COMPLETE_REVIEW",
        ground_truth_fields: {
          year: "2024",
          player: "Cooper Flagg"
        },
        critical_fields: ["year", "player"],
        prediction: {
          route: "AI_COMPLETE_REVIEW",
          provider: "agnes",
          resolved_fields: {
            year: "2023",
            player: "Cooper Flagg"
          }
        }
      }
    ],
    calibration: [],
    held_out_commercial: [
      {
        asset_id: "held-out-commercial-pass-001",
        images: ["fixtures/held-out-commercial-pass-001/front.jpg"],
        category: "sports_card",
        difficulty_tags: ["front_back"],
        capture_tags: ["front_back"],
        ground_truth_route: "AI_COMPLETE_REVIEW",
        ground_truth_fields: {
          year: "2024",
          player: "Cooper Flagg"
        },
        critical_fields: ["year", "player"],
        prediction: {
          route: "AI_COMPLETE_REVIEW",
          provider: "agnes",
          resolved_fields: {
            year: "2024",
            player: "Cooper Flagg"
          },
          review_outcome: "ACCEPTED_UNCHANGED",
          usage: {
            provider_calls: 1,
            retrieval_rounds: 0
          }
        }
      }
    ]
  }
});
assert.equal(heldOutScopedReport.all_configured_splits_evidence.commercial_metrics.ai_overall_exact_resolution_rate, 1 / 2);
assert.equal(heldOutScopedReport.held_out_commercial_evidence.commercial_metrics.ai_overall_exact_resolution_rate, 1);
assert.equal(heldOutScopedReport.held_out_commercial_evidence.commercial_metrics.ai_complete_result_precision, 1);
assert.equal(heldOutScopedReport.held_out_commercial_evidence.commercial_metrics.accepted_critical_error_rate, 0);
assert.equal(heldOutScopedReport.commercial_acceptance_gate.passed, true);
assert.equal(heldOutScopedReport.dataset.commercial_claim_allowed, true);

console.log("evaluation metrics tests passed");
