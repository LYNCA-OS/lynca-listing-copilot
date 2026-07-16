import assert from "node:assert/strict";
import {
  assessLaunchAccuracy,
  assessLaunchBenchmark,
  assessLaunchReliability,
  assessLaunchThroughput
} from "../lib/listing/evaluation/launch-benchmark.mjs";
import {
  assertCheckpointWaveAlignment,
  assertLaunchDatasetCapacity,
  deriveLaunchThroughputCheckpoint,
  inventoryCheckpointLevels
} from "./run-launch-throughput-benchmark.mjs";

function accuracyReport(rate = 0.888889) {
  return {
    schema_version: "golden-sem-accuracy-report-v1",
    source: {
      partition: "holdout",
      release_set_validation_ok: true
    },
    scope: {
      reviewed_ground_truth_only: true,
      writer_title_used_as_field_ground_truth: false
    },
    summary: { evaluated_card_count: 45 },
    metrics: {
      sem_card_exact_accuracy: { correct: 40, total: 45, rate },
      per_field_exact_accuracy: {
        year: { correct: 44, total: 45, accuracy: 0.977778 }
      }
    }
  };
}

function throughputReport(level, cardsPerMinute = 6.2, availability = 1) {
  const completed = Math.floor(level * availability);
  return {
    schema_version: "v4-multi-tenant-soak-v1",
    benchmark_level: level,
    summary: {
      attempted_count: level,
      ok_count: completed,
      completed_cards_per_minute: cardsPerMinute,
      writer_ready_p50_ms: 18_000,
      writer_ready_p95_ms: 45_000,
      provider_diagnostics: { provider_latency_p95_ms: 22_000 }
    },
    stability_envelope: {
      aggregate: { technical_availability: availability }
    }
  };
}

function reliabilityReport({
  attempted = 1000,
  completed = 999,
  tenantIsolationMeasured = 1000,
  tenantIsolationViolations = 0,
  duplicateJobs = 0
} = {}) {
  return {
    schema_version: "v4-multi-tenant-soak-v1",
    tenant_count: 5,
    summary: {
      attempted_count: attempted,
      ok_count: completed,
      retry_card_count: 3,
      production_integrity: {
        tenant_count: 5,
        duplicate_job_id_count: duplicateJobs,
        duplicate_asset_id_count: 0,
        missing_job_id_count: 0,
        successful_nonterminal_job_count: 0,
        tenant_isolation_measured_count: tenantIsolationMeasured,
        tenant_isolation_violation_count: tenantIsolationViolations
      }
    },
    stability_envelope: {
      schema_version: "v4-stability-envelope-v1",
      verdict: "PASS",
      aggregate: {
        attempted_count: attempted,
        completed_count: completed,
        tenant_count: 5,
        technical_availability: completed / attempted,
        residual_backlog_count: 0
      },
      evidence_shortfall_reasons: [],
      runtime_rejection_reasons: [],
      warning_reasons: ["RECOVERED_RETRY_OBSERVED"]
    }
  };
}

assert.throws(
  () => assertLaunchDatasetCapacity({ items: Array.from({ length: 100 }, (_, index) => ({ asset_id: `card-${index}` })) }),
  /requires 1000 real items/
);
assert.throws(
  () => assertLaunchDatasetCapacity({ items: Array.from({ length: 1000 }, () => ({ asset_id: "duplicate" })) }),
  /uniquely identified/
);
assert.equal(
  assertLaunchDatasetCapacity({ items: Array.from({ length: 1000 }, (_, index) => ({ asset_id: `card-${index}` })) }).uniquely_identified_item_count,
  1000
);
assert.equal(assertCheckpointWaveAlignment([100, 500, 1000], 50), 50);
assert.throws(() => assertCheckpointWaveAlignment([100, 550], 100), /must align/);
assert.equal(assertCheckpointWaveAlignment([100, 255], 25, { allowFinalPartial: true }), 25);
assert.deepEqual(inventoryCheckpointLevels(255), [100, 255]);
assert.deepEqual(inventoryCheckpointLevels(1_250), [100, 500, 1000, 1250]);
assert.equal(assertLaunchDatasetCapacity(
  { items: Array.from({ length: 255 }, (_, index) => ({ asset_id: `inventory-${index}` })) },
  [100, 255],
  { requireAllItems: true }
).inventory_coverage_rate, 1);
assert.throws(() => assertLaunchDatasetCapacity(
  { items: Array.from({ length: 255 }, (_, index) => ({ asset_id: `inventory-${index}` })) },
  [100],
  { requireAllItems: true }
), /complete dataset size 255/);

const checkpoint = deriveLaunchThroughputCheckpoint({
  soak_run_id: "soak-1",
  evaluation_sample_policy: { mode: "FRESH_GENERALIZATION" },
  wave_reports: [{ wave_id: "wave-2", cumulative_attempted_count: 100, soak_elapsed_ms: 100_000 }],
  results: Array.from({ length: 1000 }, (_, index) => ({
    asset_id: `card-${index}`,
    ok: true,
    writer_ready: true,
    l2_ready: true,
    job_status: "L2_READY"
  }))
}, 100);
assert.equal(checkpoint.benchmark_level, 100);
assert.equal(checkpoint.summary.attempted_count, 100);
assert.equal(checkpoint.summary.ok_count, 100);
assert.equal(checkpoint.summary.completed_cards_per_minute, 60);

const accurate = assessLaunchAccuracy(accuracyReport());
assert.equal(accurate.verdict, "PASS");

const weakTitleOnly = assessLaunchAccuracy({
  schema_version: "cloud-listing-api-eval-v1",
  policy_fair_pass_at_0_72_rate: 0.95
});
assert.equal(weakTitleOnly.verdict, "INCONCLUSIVE");
assert.ok(weakTitleOnly.evidence_shortfall_reasons.includes("GOLDEN_SEM_ACCURACY_REPORT_REQUIRED"));

const inaccurate = assessLaunchAccuracy(accuracyReport(0.86));
assert.equal(inaccurate.verdict, "FAIL");
assert.ok(inaccurate.failure_reasons.includes("SEM_ACCURACY_BELOW_LAUNCH_TARGET"));

const throughput = assessLaunchThroughput([
  throughputReport(100),
  throughputReport(500),
  throughputReport(1000)
]);
assert.equal(throughput.verdict, "PASS");

const slow = assessLaunchThroughput([
  throughputReport(100),
  throughputReport(500, 5.9),
  throughputReport(1000)
]);
assert.equal(slow.verdict, "FAIL");
assert.ok(slow.failure_reasons.includes("THROUGHPUT_500_BELOW_TARGET"));

const incompleteThroughput = assessLaunchThroughput([throughputReport(100)]);
assert.equal(incompleteThroughput.verdict, "INCONCLUSIVE");

const reliable = assessLaunchReliability(reliabilityReport());
assert.equal(reliable.verdict, "PASS");
assert.equal(reliable.technical_availability, 0.999);

const tooSmall = assessLaunchReliability(reliabilityReport({ attempted: 999, completed: 999, tenantIsolationMeasured: 999 }));
assert.equal(tooSmall.verdict, "INCONCLUSIVE");
assert.ok(tooSmall.evidence_shortfall_reasons.includes("RELIABILITY_SAMPLE_TOO_SMALL"));

const tenantMeasurementMissing = assessLaunchReliability(reliabilityReport({ tenantIsolationMeasured: 999 }));
assert.equal(tenantMeasurementMissing.verdict, "INCONCLUSIVE");
assert.ok(tenantMeasurementMissing.evidence_shortfall_reasons.includes("TENANT_ISOLATION_MEASUREMENT_INCOMPLETE"));

const duplicate = assessLaunchReliability(reliabilityReport({ duplicateJobs: 1 }));
assert.equal(duplicate.verdict, "FAIL");
assert.ok(duplicate.failure_reasons.includes("DUPLICATE_QUEUE_JOB"));

const benchmark = assessLaunchBenchmark({
  accuracyReport: accuracyReport(),
  throughputReports: [throughputReport(100), throughputReport(500), throughputReport(1000)],
  reliabilityReport: reliabilityReport(),
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
assert.equal(benchmark.launch_verdict, "PASS");
assert.equal(benchmark.launch_ready, true);
assert.equal(benchmark.next_bottleneck, null);

const notMeasured = assessLaunchBenchmark();
assert.equal(notMeasured.launch_verdict, "INCONCLUSIVE");
assert.deepEqual(notMeasured.inconclusive_dimensions, ["accuracy", "throughput", "reliability"]);

console.log("launch benchmark tests passed");
