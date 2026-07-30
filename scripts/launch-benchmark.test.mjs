import assert from "node:assert/strict";
import {
  assessLaunchAccuracy,
  assessLaunchBenchmark,
  assessLaunchReliability,
  assessLaunchThroughput,
  assessProductionWriterJourney,
  launchThroughputCheckpointSchemaVersion
} from "../lib/listing/evaluation/launch-benchmark.mjs";
import {
  assertCheckpointWaveAlignment,
  assertLaunchDatasetCapacity,
  deriveLaunchThroughputCheckpoint,
  inventoryCheckpointLevels
} from "./run-launch-throughput-benchmark.mjs";

function accuracyReport({ correct = 40, total = 45, rate = Number((correct / total).toFixed(6)) } = {}) {
  return {
    schema_version: "golden-sem-accuracy-report-v1",
    status: "COMPLETED",
    source: {
      partition: "holdout",
      dataset_schema_version: "release-set-v1",
      set_type: "CORE_HOLDOUT",
      field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH",
      predictions_schema_version: "golden-sem-prediction-run-v1",
      release_set_validation_ok: true,
      release_set_digest_schema_version: "release-set-content-digest-v2",
      release_set_item_set_sha256: "1".repeat(64),
      prediction_digest_schema_version: "canonical-json-sha256-v1",
      prediction_content_sha256: "2".repeat(64),
      deployment_git_commit_sha: "a".repeat(40),
      recognition_pipeline_fingerprint: "3".repeat(64),
      catalog_snapshot_revision: "catalog-snapshot-1",
      prediction_row_count: total,
      prediction_rows_version_bound: true,
      prediction_item_ids_unique: true,
      prediction_exact_item_set_match: true
    },
    scope: {
      reviewed_ground_truth_only: true,
      formal_golden_sem: true,
      explicit_evaluation_truth_policy: true,
      launch_gate_eligible: true,
      writer_title_used_as_field_ground_truth: false,
      prediction_run_provenance_complete: true,
      renderer_replay_inputs_complete: true
    },
    summary: {
      label_item_count: total,
      evaluated_card_count: total,
      matched_prediction_count: total,
      independent_identity_group_count: total,
      launch_field_contract_covered_count: total,
      critical_identity_covered_count: total
    },
    metrics: {
      sem_card_exact_accuracy: { correct, total, rate },
      critical_overclaim_count: 0,
      critical_fabrication_count: 0,
      catastrophic_title_count: 0,
      renderer_fidelity: { correct: total, total, rate: 1 },
      title_critical_fidelity: { correct: total, total, rate: 1 },
      per_field_exact_accuracy: {
        year: { correct: 44, total: 45, accuracy: 0.977778 }
      }
    }
  };
}

function throughputReport(level, cardsPerMinute = 6.2, availability = 1) {
  const completed = Math.floor(level * availability);
  return {
    schema_version: launchThroughputCheckpointSchemaVersion,
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

function writerJourneyReport(overrides = {}) {
  return {
    schema_version: "production-writer-journey-evidence-v3",
    passed: true,
    launch_ready_mutated: false,
    repository: "LYNCA-OS/lynca-listing-copilot",
    workflow_ref: "LYNCA-OS/lynca-listing-copilot/.github/workflows/production-writer-journey.yml@refs/heads/main",
    run_id: "123456789",
    run_attempt: "1",
    event: "workflow_run",
    source_ref: "refs/heads/main",
    production_base_url: "https://listing.lyncafei.team",
    deployment_id: "dpl_ExactMain123",
    finished_at: "2026-07-14T00:00:00.000Z",
    expected_git_commit_sha: "a".repeat(40),
    deployment_git_commit_sha: "a".repeat(40),
    exact_sha_match: true,
    required_stage_ids: [
      "health",
      "real_image_materialization",
      "login",
      "upload",
      "enqueue",
      "status",
      "l2_ready",
      "accept_edit",
      "persistence"
    ],
    all_required_stages_passed: true,
    artifact_safety: {
      safe_to_upload: true,
      har_uploaded: false,
      trace_uploaded: false,
      sensitive_value_scan_passed: true,
      storage_state_persisted: false,
      login_screenshot_recorded: false,
      screenshot_sensitive_controls_masked: true
    },
    request_ids: ["request_1"],
    asset_ids: ["asset_1"],
    batch_ids: ["batch_1"],
    job_ids: ["job_1"],
    session_ids: ["session_1"],
    stages: Object.fromEntries([
      "health",
      "real_image_materialization",
      "login",
      "upload",
      "enqueue",
      "status",
      "l2_ready",
      "accept_edit",
      "persistence"
    ].map((stage) => [stage, { passed: true }])),
    ...overrides
  };
}

function liveReleaseProvenance(overrides = {}) {
  return {
    verified: true,
    repository: "LYNCA-OS/lynca-listing-copilot",
    main_git_sha: "a".repeat(40),
    deployment_git_sha: "a".repeat(40),
    deployment_id: "dpl_ExactMain123",
    recognition_pipeline_fingerprint: "3".repeat(64),
    active_catalog_snapshot_revision: "catalog-snapshot-1",
    production_base_url: "https://listing.lyncafei.team",
    checked_at: "2026-07-14T00:01:00.000Z",
    ...overrides
  };
}

function writerJourneyAttestation(overrides = {}) {
  return {
    verified: true,
    repository: "LYNCA-OS/lynca-listing-copilot",
    signer_workflow: "LYNCA-OS/lynca-listing-copilot/.github/workflows/production-writer-journey.yml",
    source_ref: "refs/heads/main",
    source_digest: "a".repeat(40),
    denied_self_hosted_runners: true,
    verified_attestation_count: 1,
    ...overrides
  };
}

function releasePacketAssessment() {
  const pass = {
    verdict: "PASS",
    pass: true,
    failure_reasons: [],
    evidence_shortfall_reasons: []
  };
  return {
    verdict: "PASS",
    pass: true,
    dimensions: {
      accuracy: pass,
      throughput: pass,
      reliability: pass,
      writer_journey: pass
    },
    failure_reasons: [],
    evidence_shortfall_reasons: []
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
assert.equal(checkpoint.schema_version, launchThroughputCheckpointSchemaVersion);
assert.equal(checkpoint.benchmark_level, 100);
assert.equal(checkpoint.summary.attempted_count, 100);
assert.equal(checkpoint.summary.ok_count, 100);
assert.equal(checkpoint.summary.completed_cards_per_minute, 60);

const accurate = assessLaunchAccuracy(accuracyReport());
assert.equal(accurate.verdict, "PASS");

const missingLiveRuntimeIdentity = assessLaunchAccuracy(accuracyReport(), undefined, {
  liveReleaseProvenance: liveReleaseProvenance({
    recognition_pipeline_fingerprint: null,
    active_catalog_snapshot_revision: null
  })
});
assert.equal(missingLiveRuntimeIdentity.verdict, "INCONCLUSIVE");
assert.ok(missingLiveRuntimeIdentity.evidence_shortfall_reasons.includes(
  "LIVE_RECOGNITION_PIPELINE_FINGERPRINT_REQUIRED"
));
const mismatchedLivePipeline = assessLaunchAccuracy(accuracyReport(), undefined, {
  liveReleaseProvenance: liveReleaseProvenance({ recognition_pipeline_fingerprint: "4".repeat(64) })
});
assert.equal(mismatchedLivePipeline.verdict, "FAIL");
assert.ok(mismatchedLivePipeline.failure_reasons.includes(
  "ACCURACY_RECOGNITION_PIPELINE_FINGERPRINT_MISMATCH"
));
const mismatchedLiveCatalog = assessLaunchAccuracy(accuracyReport(), undefined, {
  liveReleaseProvenance: liveReleaseProvenance({ active_catalog_snapshot_revision: "catalog-snapshot-2" })
});
assert.equal(mismatchedLiveCatalog.verdict, "FAIL");
assert.ok(mismatchedLiveCatalog.failure_reasons.includes(
  "ACCURACY_CATALOG_SNAPSHOT_REVISION_MISMATCH"
));

const weakTitleOnly = assessLaunchAccuracy({
  schema_version: "cloud-listing-api-eval-v1",
  policy_fair_pass_at_0_72_rate: 0.95
});
assert.equal(weakTitleOnly.verdict, "INCONCLUSIVE");
assert.ok(weakTitleOnly.evidence_shortfall_reasons.includes("GOLDEN_SEM_ACCURACY_REPORT_REQUIRED"));

const oldPredictionSchema = accuracyReport();
oldPredictionSchema.source.predictions_schema_version = "prediction-report-v1";
assert.equal(assessLaunchAccuracy(oldPredictionSchema).verdict, "INCONCLUSIVE");
assert.ok(assessLaunchAccuracy(oldPredictionSchema).evidence_shortfall_reasons.includes(
  "GOLDEN_SEM_PREDICTION_RUN_V1_REQUIRED"
));

const inaccurate = assessLaunchAccuracy(accuracyReport({ correct: 39 }));
assert.equal(inaccurate.verdict, "FAIL");
assert.ok(inaccurate.failure_reasons.includes("SEM_ACCURACY_BELOW_LAUNCH_TARGET"));

const incompleteAccuracy = accuracyReport();
incompleteAccuracy.status = "INCONCLUSIVE";
assert.equal(assessLaunchAccuracy(incompleteAccuracy).verdict, "INCONCLUSIVE");
assert.ok(assessLaunchAccuracy(incompleteAccuracy).evidence_shortfall_reasons.includes(
  "GOLDEN_SEM_ACCURACY_COMPLETED_REQUIRED"
));

const ineligibleAccuracy = accuracyReport();
ineligibleAccuracy.scope.launch_gate_eligible = false;
assert.equal(assessLaunchAccuracy(ineligibleAccuracy).verdict, "INCONCLUSIVE");
assert.ok(assessLaunchAccuracy(ineligibleAccuracy).evidence_shortfall_reasons.includes(
  "GOLDEN_SEM_LAUNCH_ELIGIBILITY_REQUIRED"
));

for (const mutate of [
  (report) => { report.metrics.sem_card_exact_accuracy.correct = 39; },
  (report) => { report.metrics.sem_card_exact_accuracy.rate = 0.9; },
  (report) => { report.summary.evaluated_card_count = 44; }
]) {
  const inconsistentAccuracy = accuracyReport();
  mutate(inconsistentAccuracy);
  const assessment = assessLaunchAccuracy(inconsistentAccuracy);
  assert.equal(assessment.verdict, "INCONCLUSIVE");
  assert.ok(assessment.evidence_shortfall_reasons.includes("SEM_CARD_EXACT_COUNTS_OR_RATE_INCONSISTENT"));
}

for (const [metric, reason] of [
  ["critical_overclaim_count", "CRITICAL_OVERCLAIM_PRESENT"],
  ["critical_fabrication_count", "CRITICAL_FABRICATION_PRESENT"],
  ["catastrophic_title_count", "CATASTROPHIC_TITLE_PRESENT"]
]) {
  const unsafeAccuracy = accuracyReport();
  unsafeAccuracy.metrics[metric] = 1;
  const assessment = assessLaunchAccuracy(unsafeAccuracy);
  assert.equal(assessment.verdict, "FAIL");
  assert.ok(assessment.failure_reasons.includes(reason));
}

for (const metric of [
  "critical_overclaim_count",
  "critical_fabrication_count",
  "catastrophic_title_count"
]) {
  const missingSafetyCount = accuracyReport();
  delete missingSafetyCount.metrics[metric];
  assert.equal(assessLaunchAccuracy(missingSafetyCount).verdict, "INCONCLUSIVE");
}

for (const [field, reason] of [
  ["release_set_item_set_sha256", "HOLDOUT_CONTENT_DIGEST_REQUIRED"],
  ["prediction_content_sha256", "PREDICTION_CONTENT_DIGEST_REQUIRED"],
  ["deployment_git_commit_sha", "PREDICTION_DEPLOYMENT_SHA_REQUIRED"],
  ["recognition_pipeline_fingerprint", "RECOGNITION_PIPELINE_FINGERPRINT_REQUIRED"],
  ["catalog_snapshot_revision", "CATALOG_SNAPSHOT_REVISION_REQUIRED"]
]) {
  const missingProvenance = accuracyReport();
  delete missingProvenance.source[field];
  const assessment = assessLaunchAccuracy(missingProvenance);
  assert.equal(assessment.verdict, "INCONCLUSIVE");
  assert.ok(assessment.evidence_shortfall_reasons.includes(reason));
}
const missingPredictionDigestSchema = accuracyReport();
delete missingPredictionDigestSchema.source.prediction_digest_schema_version;
assert.equal(assessLaunchAccuracy(missingPredictionDigestSchema).verdict, "INCONCLUSIVE");
assert.ok(assessLaunchAccuracy(missingPredictionDigestSchema).evidence_shortfall_reasons.includes(
  "PREDICTION_CONTENT_DIGEST_SCHEMA_REQUIRED"
));

const missingTruthPolicy = accuracyReport();
delete missingTruthPolicy.scope.explicit_evaluation_truth_policy;
assert.equal(assessLaunchAccuracy(missingTruthPolicy).verdict, "INCONCLUSIVE");
assert.ok(assessLaunchAccuracy(missingTruthPolicy).evidence_shortfall_reasons.includes(
  "EXPLICIT_FORMAL_TRUTH_POLICY_REQUIRED"
));

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

for (const invalidSchema of [undefined, "v4-multi-tenant-soak-v1", "launch-throughput-checkpoint-v2"]) {
  const invalidReport = throughputReport(100);
  if (invalidSchema === undefined) delete invalidReport.schema_version;
  else invalidReport.schema_version = invalidSchema;
  const invalidThroughput = assessLaunchThroughput([
    invalidReport,
    throughputReport(500),
    throughputReport(1000)
  ]);
  assert.equal(invalidThroughput.verdict, "INCONCLUSIVE");
  assert.ok(invalidThroughput.evidence_shortfall_reasons.includes("THROUGHPUT_100_CHECKPOINT_V1_REQUIRED"));
}

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

const journeyAssessmentOptions = {
  liveReleaseProvenance: liveReleaseProvenance(),
  attestationVerification: writerJourneyAttestation()
};
const journey = assessProductionWriterJourney(writerJourneyReport(), journeyAssessmentOptions);
assert.equal(journey.verdict, "PASS");
assert.equal(assessProductionWriterJourney({}).verdict, "INCONCLUSIVE");
const completeJourney = writerJourneyReport();
const missingAcceptEditJourney = assessProductionWriterJourney(writerJourneyReport({
  required_stage_ids: completeJourney.required_stage_ids.filter((stage) => stage !== "accept_edit"),
  stages: Object.fromEntries(
    Object.entries(completeJourney.stages).filter(([stage]) => stage !== "accept_edit")
  )
}), journeyAssessmentOptions);
assert.notEqual(missingAcceptEditJourney.verdict, "PASS");
assert.ok(missingAcceptEditJourney.evidence_shortfall_reasons.includes("WRITER_JOURNEY_REQUIRED_STAGE_CONTRACT_MISSING"));
assert.ok(missingAcceptEditJourney.evidence_shortfall_reasons.includes("WRITER_JOURNEY_ACCEPT_EDIT_MISSING"));
const wrongDeploymentJourney = assessProductionWriterJourney(writerJourneyReport({
  deployment_git_commit_sha: "b".repeat(40),
  exact_sha_match: false
}), journeyAssessmentOptions);
assert.equal(wrongDeploymentJourney.verdict, "FAIL");
assert.ok(wrongDeploymentJourney.failure_reasons.includes("WRITER_JOURNEY_DEPLOYMENT_SHA_MISMATCH"));
assert.ok(wrongDeploymentJourney.failure_reasons.includes("WRITER_JOURNEY_EXACT_SHA_NOT_PROVEN"));
const historicalJourney = assessProductionWriterJourney(writerJourneyReport({
  expected_git_commit_sha: "d".repeat(40),
  deployment_git_commit_sha: "d".repeat(40)
}), journeyAssessmentOptions);
assert.equal(historicalJourney.verdict, "FAIL", "an internally consistent historical Journey must not attest the current release");
assert.ok(historicalJourney.failure_reasons.includes("WRITER_JOURNEY_RELEASE_SHA_MISMATCH"));
const unsafeJourney = assessProductionWriterJourney(writerJourneyReport({
  artifact_safety: {
    ...writerJourneyReport().artifact_safety,
    storage_state_persisted: true,
    login_screenshot_recorded: true,
    screenshot_sensitive_controls_masked: false
  }
}), journeyAssessmentOptions);
assert.equal(unsafeJourney.verdict, "FAIL");
assert.ok(unsafeJourney.failure_reasons.includes("WRITER_JOURNEY_ARTIFACT_SAFETY_NOT_PROVEN"));
const nullIdsJourney = assessProductionWriterJourney(writerJourneyReport({
  request_ids: [null],
  asset_ids: [null],
  batch_ids: [null],
  job_ids: [null],
  session_ids: [null]
}), journeyAssessmentOptions);
assert.equal(nullIdsJourney.verdict, "INCONCLUSIVE");
for (const invalidId of [1, {}, "x\nsmuggled", "x\tsmuggled"]) {
  const invalidIdsJourney = assessProductionWriterJourney(writerJourneyReport({
    request_ids: [invalidId],
    asset_ids: [invalidId],
    batch_ids: [invalidId],
    job_ids: [invalidId],
    session_ids: [invalidId]
  }), journeyAssessmentOptions);
  assert.equal(invalidIdsJourney.verdict, "INCONCLUSIVE");
}
const oldDeploymentJourney = assessProductionWriterJourney(writerJourneyReport({
  deployment_id: "dpl_Historical123"
}), journeyAssessmentOptions);
assert.equal(oldDeploymentJourney.verdict, "FAIL");
assert.ok(oldDeploymentJourney.failure_reasons.includes("WRITER_JOURNEY_RELEASE_DEPLOYMENT_MISMATCH"));
const staleJourney = assessProductionWriterJourney(writerJourneyReport({
  finished_at: "2026-07-12T00:00:00.000Z"
}), journeyAssessmentOptions);
assert.equal(staleJourney.verdict, "FAIL");
assert.ok(staleJourney.failure_reasons.includes("WRITER_JOURNEY_EVIDENCE_STALE_OR_FUTURE"));
const unattestedJourney = assessProductionWriterJourney(writerJourneyReport(), {
  ...journeyAssessmentOptions,
  attestationVerification: {}
});
assert.equal(unattestedJourney.verdict, "INCONCLUSIVE");
assert.ok(unattestedJourney.evidence_shortfall_reasons.includes("WRITER_JOURNEY_ARTIFACT_ATTESTATION_REQUIRED"));
const noLiveProvenanceJourney = assessProductionWriterJourney(writerJourneyReport(), {
  attestationVerification: writerJourneyAttestation()
});
assert.notEqual(noLiveProvenanceJourney.verdict, "PASS");
assert.ok(noLiveProvenanceJourney.evidence_shortfall_reasons.includes("LIVE_RELEASE_PROVENANCE_REQUIRED"));
for (const [field, invalidValue] of [
  ["expected_git_commit_sha", { toString: () => "a".repeat(40) }],
  ["deployment_git_commit_sha", 1],
  ["deployment_id", { toString: () => "dpl_ExactMain123" }]
]) {
  const strictTypeJourney = assessProductionWriterJourney(writerJourneyReport({ [field]: invalidValue }), journeyAssessmentOptions);
  assert.notEqual(strictTypeJourney.verdict, "PASS", `${field} must remain a strict string`);
}
const wrongAttestationDigest = assessProductionWriterJourney(writerJourneyReport(), {
  ...journeyAssessmentOptions,
  attestationVerification: writerJourneyAttestation({ source_digest: "b".repeat(40) })
});
assert.equal(wrongAttestationDigest.verdict, "FAIL");
assert.ok(wrongAttestationDigest.failure_reasons.includes("WRITER_JOURNEY_ATTESTATION_SOURCE_DIGEST_MISMATCH"));
const untypedAttestationCount = assessProductionWriterJourney(writerJourneyReport(), {
  ...journeyAssessmentOptions,
  attestationVerification: writerJourneyAttestation({ verified_attestation_count: "1" })
});
assert.notEqual(untypedAttestationCount.verdict, "PASS");
const liveMainDrift = assessProductionWriterJourney(writerJourneyReport(), {
  ...journeyAssessmentOptions,
  liveReleaseProvenance: liveReleaseProvenance({ deployment_git_sha: "b".repeat(40) })
});
assert.equal(liveMainDrift.verdict, "FAIL");
assert.ok(liveMainDrift.failure_reasons.includes("LIVE_MAIN_AND_PRODUCTION_SHA_MISMATCH"));

const benchmark = assessLaunchBenchmark({
  accuracyReport: accuracyReport(),
  throughputReports: [throughputReport(100), throughputReport(500), throughputReport(1000)],
  reliabilityReport: reliabilityReport(),
  writerJourneyReport: writerJourneyReport(),
  liveReleaseProvenance: liveReleaseProvenance({ checked_at: "2026-07-14T00:00:00.000Z" }),
  writerJourneyAttestation: writerJourneyAttestation(),
  releasePacketAssessment: releasePacketAssessment(),
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
assert.equal(benchmark.launch_verdict, "PASS");
assert.equal(benchmark.launch_ready, true);
assert.equal(benchmark.next_bottleneck, null);

const wrongAccuracyDeployment = accuracyReport();
wrongAccuracyDeployment.source.deployment_git_commit_sha = "b".repeat(40);
const accuracyDeploymentDrift = assessLaunchBenchmark({
  accuracyReport: wrongAccuracyDeployment,
  throughputReports: [throughputReport(100), throughputReport(500), throughputReport(1000)],
  reliabilityReport: reliabilityReport(),
  writerJourneyReport: writerJourneyReport(),
  liveReleaseProvenance: liveReleaseProvenance({ checked_at: "2026-07-14T00:00:00.000Z" }),
  writerJourneyAttestation: writerJourneyAttestation(),
  releasePacketAssessment: releasePacketAssessment(),
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
assert.equal(accuracyDeploymentDrift.dimensions.accuracy.verdict, "FAIL");
assert.ok(accuracyDeploymentDrift.dimensions.accuracy.failure_reasons.includes(
  "ACCURACY_PREDICTION_DEPLOYMENT_SHA_MISMATCH"
));

const forgedSelfReportedBenchmark = assessLaunchBenchmark({
  accuracyReport: accuracyReport({ correct: 45 }),
  throughputReports: [throughputReport(100, 999), throughputReport(500, 999), throughputReport(1000, 999)],
  reliabilityReport: reliabilityReport({ attempted: 1000, completed: 1000 }),
  writerJourneyReport: writerJourneyReport(),
  liveReleaseProvenance: liveReleaseProvenance({ checked_at: "2026-07-14T00:00:00.000Z" }),
  writerJourneyAttestation: writerJourneyAttestation(),
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
assert.equal(forgedSelfReportedBenchmark.launch_verdict, "INCONCLUSIVE");
assert.equal(forgedSelfReportedBenchmark.launch_ready, false);
for (const dimension of ["accuracy", "throughput", "reliability", "writer_journey"]) {
  assert.ok(forgedSelfReportedBenchmark.dimensions[dimension].evidence_shortfall_reasons.includes("ATTESTED_RELEASE_PACKET_REQUIRED"));
}

const notMeasured = assessLaunchBenchmark();
assert.equal(notMeasured.launch_verdict, "INCONCLUSIVE");
assert.deepEqual(notMeasured.inconclusive_dimensions, ["accuracy", "throughput", "reliability", "writer_journey"]);

console.log("launch benchmark tests passed");
