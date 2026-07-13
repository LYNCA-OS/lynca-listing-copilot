#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  chooseConcurrency,
  compareConcurrencySweep,
  evaluateRow,
  metricRow,
  numberOrNull
} from "./compare-concurrency-sweep.mjs";
import { assessConcurrencySweepLevel } from "./assert-concurrency-sweep-level.mjs";

assert.equal(numberOrNull(null), null);
assert.equal(numberOrNull(undefined), null);
assert.equal(numberOrNull(""), null);
assert.equal(numberOrNull(0), 0);
assert.equal(numberOrNull("12"), 12);

function reportFor({
  concurrency,
  cardsPerMinute,
  writerP95,
  policyAverage = 0.86,
  pass72 = 4,
  retries = 0,
  technicalFailures = 0,
  datasetPath = `/tmp/fresh-c${concurrency}.json`,
  sampleHash = "paired-fresh-sample"
}) {
  const attempted = 4;
  return {
    schema_version: "v4-ebay-smoke-v1",
    dataset_path: datasetPath,
    offset: 0,
    limit: attempted,
    concurrency,
    evaluation_sample_policy: {
      mode: "CONCURRENCY_FRESH",
      evaluated_item_ids_sha256: sampleHash
    },
    run_wall_ms: Math.round(attempted * 60000 / cardsPerMinute),
    batch_poll_metrics: {
      transient_error_count: 0,
      fatal_error: null
    },
    summary: {
      attempted_count: attempted,
      ok_count: attempted - technicalFailures,
      technical_failure_count: technicalFailures,
      retry_card_count: retries,
      retry_attempt_count: retries,
      retry_error_code_breakdown: retries ? { QUEUE_COMPLETION_WRITE_FAILED: retries } : {},
      completion_write_retry_count: retries,
      completion_payload_sanitized_nul_count: 0,
      completed_cards_per_minute: cardsPerMinute,
      writer_ready_p50_ms: writerP95 - 5000,
      writer_ready_p95_ms: writerP95,
      writer_ready_p99_ms: writerP95 + 1000,
      scheduler_queue_wait_p50_ms: 500,
      scheduler_queue_wait_p95_ms: 1000 * concurrency,
      worker_processing_p50_ms: 30000,
      worker_processing_p95_ms: 34000,
      final_accuracy_proxy: {
        raw_token_recall_avg: policyAverage - 0.08,
        fair_token_recall_avg: policyAverage - 0.02,
        policy_fair_token_recall_avg: policyAverage,
        policy_fair_pass_at_0_72: pass72,
        policy_fair_pass_at_0_80: Math.max(0, pass72 - 1)
      },
      provider_diagnostics: {
        input_tokens_total: 10000 * attempted,
        output_tokens_total: 1000 * attempted,
        total_tokens_total: 11000 * attempted,
        provider_latency_p50_ms: 17000,
        provider_latency_p95_ms: 20000,
        key_pool_size_latest: 2,
        key_slots_used: concurrency > 1 ? [1, 2] : [1],
        key_rotation_card_count: 0,
        latest_remaining_requests: "4990",
        latest_remaining_tokens: "1900000"
      },
      preingestion_ocr: {
        timeout_count: 0,
        elapsed_since_preingestion_p50_ms: 8000,
        elapsed_since_preingestion_p95_ms: 15000,
        critical_path_wait_p50_ms: 0,
        critical_path_wait_p95_ms: 750
      },
      batch_position_fairness: {
        front_half: {
          attempted_count: 2,
          technical_success_rate: 1,
          ocr_attempted_count: 2,
          ocr_terminal_rate: 1,
          grade_ocr_card_count: 2,
          grade_ocr_succeeded_rate: 1,
          grade_reference_expected_count: 2,
          grade_reference_preservation_rate: 1
        },
        back_half: {
          attempted_count: 2,
          technical_success_rate: 1,
          ocr_attempted_count: 2,
          ocr_terminal_rate: 1,
          grade_ocr_card_count: 2,
          grade_ocr_succeeded_rate: 1,
          grade_reference_expected_count: 2,
          grade_reference_preservation_rate: 1
        },
        back_minus_front: {
          technical_success_rate: 0,
          ocr_terminal_rate: 0,
          grade_ocr_succeeded_rate: 0,
          grade_reference_preservation_rate: 0
        }
      },
      pipeline_node_observability: {
        ledger_present_count: attempted,
        ledger_missing_count: 0,
        error_count: 0,
        warning_count: 0,
        missing_required_node_count: 0,
        node_metrics: [
          { node_id: "catalog_retrieval", duration_p50_ms: 600, duration_p95_ms: 1100 },
          { node_id: "vector_retrieval", duration_p50_ms: 5000, duration_p95_ms: 7000 },
          {
            node_id: "post_observation_retrieval_deadline",
            duration_p50_ms: 1800,
            duration_p95_ms: 1802,
            output_count_total: 1,
            status_breakdown: { COMPLETED: 1, PARTIAL: 3 }
          }
        ]
      }
    },
    results: Array.from({ length: attempted }, (_, index) => ({
      asset_id: `asset-c${concurrency}-${index}`,
      ok: index >= technicalFailures,
      attempt_count: index < retries ? 2 : 1,
      error: index < technicalFailures ? "provider timeout" : null
    }))
  };
}

const baselineRow = metricRow(reportFor({ concurrency: 1, cardsPerMinute: 1, writerP95: 38000 }));
assert.equal(baselineRow.completed_cards_per_minute, 1);
assert.equal(baselineRow.provider_latency_p95_ms, 20000);
assert.equal(baselineRow.catalog_retrieval_p95_ms, 1100);
assert.equal(baselineRow.post_observation_retrieval_deadline_p95_ms, 1802);
assert.equal(baselineRow.post_observation_retrieval_deferred_card_count, 3);
assert.equal(baselineRow.post_observation_retrieval_completed_within_budget_count, 1);
assert.equal(baselineRow.ocr_elapsed_since_preingestion_p95_ms, 15000);
assert.equal(baselineRow.ocr_critical_path_wait_p95_ms, 750);
assert.equal(baselineRow.front_half_ocr_terminal_rate, 1);
assert.equal(baselineRow.back_half_ocr_terminal_rate, 1);
assert.equal(baselineRow.back_minus_front_ocr_terminal_rate, 0);
assert.equal(baselineRow.node_ledger_present_count, 4);
assert.equal(baselineRow.node_transport_error_count, 0);
assert.equal(baselineRow.node_field_quality_error_count, 0);
assert.equal(baselineRow.latest_remaining_requests, 4990);
assert.equal(baselineRow.queue_tail_share, Number((1000 / 38000).toFixed(6)));
assert.equal(baselineRow.tokens_per_completed_card, 11000);
assert.equal(baselineRow.input_tokens_per_completed_card, 10000);
assert.equal(baselineRow.output_tokens_per_completed_card, 1000);
assert.equal(baselineRow.bottleneck_node_id, "vector_retrieval");
assert.equal(baselineRow.bottleneck_node_p95_ms, 7000);
assert.deepEqual(baselineRow.provider_key_slot_distribution, {});
assert.deepEqual(baselineRow.retry_error_code_breakdown, {});
assert.equal(baselineRow.completion_write_retry_count, 0);

const telemetryInput = reportFor({ concurrency: 3, cardsPerMinute: 2.5, writerP95: 45000 });
telemetryInput.summary.pipeline_node_observability.node_metrics.push(
  { node_id: "provider", duration_p50_ms: 18000, duration_p95_ms: 28000 }
);
telemetryInput.results = [
  {
    ok: true,
    provider_key_slot: 1,
    "x-ratelimit-limit-requests": "5000",
    "x-ratelimit-remaining-requests": "4990",
    "x-ratelimit-limit-tokens": "2000000",
    "x-ratelimit-remaining-tokens": "1500000"
  },
  {
    ok: true,
    provider_key_slot: 2,
    "x-ratelimit-limit-requests": "5000",
    "x-ratelimit-remaining-requests": "4980",
    "x-ratelimit-limit-tokens": "2000000",
    "x-ratelimit-remaining-tokens": "1000000"
  }
];
const telemetryRow = metricRow(telemetryInput);
assert.equal(telemetryRow.bottleneck_node_id, "provider");
assert.equal(telemetryRow.bottleneck_node_p95_ms, 28000);
assert.equal(telemetryRow.request_headroom_min_ratio, 0.996);
assert.equal(telemetryRow.token_headroom_min_ratio, 0.5);
assert.deepEqual(telemetryRow.provider_key_slot_distribution, { 1: 1, 2: 1 });
assert.equal(telemetryRow.provider_key_slot_imbalance, 0);

const stableBaseline = evaluateRow(baselineRow, baselineRow);
assert.equal(stableBaseline.stable, true);
assert.equal(stableBaseline.sample_comparison_mode, "PAIRED");
const fieldQualityWarning = evaluateRow({
  ...baselineRow,
  node_error_count: 1,
  node_field_quality_error_count: 1
}, baselineRow);
assert.equal(fieldQualityWarning.stable, true);
assert.ok(fieldQualityWarning.warning_reasons.includes("FIELD_QUALITY_ANOMALY_RECORDED"));
assert.ok(!fieldQualityWarning.rejection_reasons.includes("NODE_RECONCILIATION_ERROR"));
const transportFailure = evaluateRow({
  ...baselineRow,
  node_error_count: 1,
  node_transport_error_count: 1
}, baselineRow);
assert.equal(transportFailure.stable, false);
assert.ok(transportFailure.rejection_reasons.includes("NODE_RECONCILIATION_ERROR"));
const boundedOcrRendezvous = evaluateRow({
  ...baselineRow,
  ocr_timeout_count: 3,
  ocr_worker_timeout_count: 0
}, baselineRow);
assert.equal(boundedOcrRendezvous.stable, true);
assert.ok(boundedOcrRendezvous.warning_reasons.includes("OCR_RENDEZVOUS_BUDGET_EXPIRED"));
const ocrWorkerTimeout = evaluateRow({
  ...baselineRow,
  ocr_timeout_count: 0,
  ocr_worker_timeout_count: 1
}, baselineRow);
assert.equal(ocrWorkerTimeout.stable, false);
assert.ok(ocrWorkerTimeout.rejection_reasons.includes("OCR_WORKER_TIMEOUT_PRESENT"));
const backHalfOcrRegression = evaluateRow({
  ...baselineRow,
  back_minus_front_ocr_terminal_rate: -0.5,
  back_minus_front_grade_ocr_succeeded_rate: -0.5,
  back_minus_front_grade_reference_preservation_rate: -0.5,
  grade_reference_omission_count: 2
}, baselineRow);
assert.equal(backHalfOcrRegression.stable, false);
assert.ok(backHalfOcrRegression.rejection_reasons.includes("BACK_HALF_OCR_TERMINAL_REGRESSION"));
assert.ok(backHalfOcrRegression.rejection_reasons.includes("BACK_HALF_GRADE_OCR_REGRESSION"));
assert.ok(backHalfOcrRegression.rejection_reasons.includes("BACK_HALF_GRADE_PRESERVATION_REGRESSION"));
assert.ok(backHalfOcrRegression.warning_reasons.includes("GRADE_REFERENCE_OMISSION_OBSERVED"));
assert.equal(assessConcurrencySweepLevel(
  reportFor({ concurrency: 1, cardsPerMinute: 1, writerP95: 38000 }),
  1
).stop, false);
const failedLevel = assessConcurrencySweepLevel(
  reportFor({ concurrency: 1, cardsPerMinute: 1, writerP95: 38000, technicalFailures: 1 }),
  1
);
assert.equal(failedLevel.stop, true);
assert.ok(failedLevel.stop_reasons.includes("TECHNICAL_SUCCESS_NOT_100_PERCENT"));

const exhaustedHeadroom = evaluateRow({
  ...baselineRow,
  request_headroom_min_ratio: 0.005
}, baselineRow);
assert.equal(exhaustedHeadroom.stable, false);
assert.ok(exhaustedHeadroom.rejection_reasons.includes("REQUEST_RATE_LIMIT_HEADROOM_EXHAUSTED"));

const resumedRow = metricRow({
  ...reportFor({ concurrency: 2, cardsPerMinute: 99, writerP95: 39000 }),
  resumed_batch_id: "existing-paid-batch"
});
assert.equal(resumedRow.completed_cards_per_minute, null);
assert.equal(resumedRow.throughput_measurement_valid, false);
assert.ok(evaluateRow(resumedRow, baselineRow).rejection_reasons.includes("RESUMED_BATCH_NOT_CAPACITY_MEASUREMENT"));

const pairedRegression = metricRow(reportFor({
  concurrency: 2,
  cardsPerMinute: 1.9,
  writerP95: 41000,
  policyAverage: 0.75,
  pass72: 2,
  datasetPath: baselineRow.dataset_path
}));
const pairedEvaluation = evaluateRow(pairedRegression, baselineRow);
assert.equal(pairedEvaluation.stable, false);
assert.ok(pairedEvaluation.rejection_reasons.includes("PAIRED_PASS_0_72_REGRESSION"));

const unpairedConcurrency = metricRow(reportFor({
  concurrency: 2,
  cardsPerMinute: 1.9,
  writerP95: 40000,
  sampleHash: "different-fresh-sample"
}));
const unpairedConcurrencyEvaluation = evaluateRow(unpairedConcurrency, baselineRow);
assert.equal(unpairedConcurrencyEvaluation.stable, false);
assert.ok(unpairedConcurrencyEvaluation.rejection_reasons.includes("UNPAIRED_CONCURRENCY_SAMPLE"));

const directory = await mkdtemp(join(tmpdir(), "lynca-concurrency-sweep-"));
const inputs = [
  reportFor({ concurrency: 1, cardsPerMinute: 1, writerP95: 38000 }),
  reportFor({ concurrency: 2, cardsPerMinute: 1.9, writerP95: 40000 }),
  reportFor({ concurrency: 3, cardsPerMinute: 2.65, writerP95: 44000 }),
  reportFor({ concurrency: 4, cardsPerMinute: 2.75, writerP95: 70000, retries: 1 })
];
const reports = [];
for (const [index, input] of inputs.entries()) {
  const path = join(directory, `c${index + 1}.json`);
  await writeFile(path, `${JSON.stringify(input, null, 2)}\n`);
  reports.push({ concurrency: index + 1, path });
}
const comparison = await compareConcurrencySweep({ reports });
assert.equal(comparison.recommended_concurrency, 3);
assert.equal(comparison.raw_throughput_winner_concurrency, 3);
assert.equal(comparison.recommendation_confidence, "PAIRED_CONFIRMED");
assert.equal(comparison.rows.find((row) => row.concurrency === 4).stable, false);
assert.ok(comparison.rows.find((row) => row.concurrency === 4).rejection_reasons.includes("RETRY_REQUIRED"));
assert.equal(comparison.rows.find((row) => row.concurrency === 1).sample_comparison_mode, "PAIRED");
assert.ok(comparison.rows.every((row) => row.sample_comparison_mode === "PAIRED"));

const knee = chooseConcurrency([
  { ...stableBaseline, concurrency: 1, completed_cards_per_minute: 1, writer_ready_p95_ms: 38000 },
  { ...stableBaseline, concurrency: 2, completed_cards_per_minute: 1.9, writer_ready_p95_ms: 40000 },
  { ...stableBaseline, concurrency: 3, completed_cards_per_minute: 2.65, writer_ready_p95_ms: 44000 },
  { ...stableBaseline, concurrency: 4, completed_cards_per_minute: 2.8, writer_ready_p95_ms: 70000 }
]);
assert.equal(knee.recommended.concurrency, 3);
assert.equal(knee.rawWinner.concurrency, 4);
assert.equal(knee.trace.at(-1).decision, "STOP_AT_KNEE");

const workflowSource = readFileSync(new URL("../.github/workflows/concurrency-capacity-sweep.yml", import.meta.url), "utf8");
assert.match(workflowSource, /levels:\s*\n\s*description:/);
assert.match(workflowSource, /SWEEP_LEVELS:/);
assert.match(workflowSource, /--exclude-sealed-products/);
assert.match(workflowSource, /REPORT_ARGS/);
assert.match(workflowSource, /Stopping sweep after unstable/);
assert.match(workflowSource, /EXECUTED_SWEEP_LEVELS/);
assert.match(workflowSource, /assert-concurrency-sweep-level\.mjs/);
assert.match(workflowSource, /provider_key_pool_available:[^\n]*>= 1/);
assert.doesNotMatch(workflowSource, /key_pool_two_or_more/);
assert.doesNotMatch(workflowSource, /LEVEL="\$LEVEL" node - <<'NODE'/);
assert.match(workflowSource, /same_sample_required:true/);
assert.match(workflowSource, /PAIRED_DATASET_PATH/);
assert.match(workflowSource, /PAIRED_LABELS_PATH/);
assert.match(workflowSource, /selected_item_ids_sha256:evaluatedItemIdsHash/);
assert.match(workflowSource, /--dataset "\$PAIRED_DATASET_PATH"/);
assert.match(workflowSource, /--sealed-labels "\$PAIRED_LABELS_PATH"/);
assert.match(workflowSource, /--preingestion-source "\$RUN_ID-c\$\{LEVEL\}"/);
assert.doesNotMatch(workflowSource, /balanced disjoint concurrency strata/i);

console.log("concurrency sweep tests passed");
