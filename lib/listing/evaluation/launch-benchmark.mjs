import {
  goldenSemAccuracySchemaVersion,
  goldenSemPredictionRunSchemaVersion,
  predictionContentDigestSchemaVersion
} from "./golden-sem-accuracy.mjs";
import { releaseSetItemDigestSchemaVersion } from "./release-set-contract.mjs";

export const launchBenchmarkSchemaVersion = "launch-benchmark-v4";
export const launchThroughputCheckpointSchemaVersion = "launch-throughput-checkpoint-v1";
export const productionWriterJourneyEvidenceSchemaVersion = "production-writer-journey-evidence-v3";
export const productionLaunchRepository = "LYNCA-OS/lynca-listing-copilot";
export const productionWriterJourneySignerWorkflow = `${productionLaunchRepository}/.github/workflows/production-writer-journey.yml`;
export const productionWriterJourneyWorkflowRef = `${productionWriterJourneySignerWorkflow}@refs/heads/main`;
export const productionLaunchSourceRef = "refs/heads/main";
export const productionLaunchBaseUrl = "https://listing.lyncafei.team";
export const launchGateThresholds = Object.freeze({
  minimum_sem_card_exact_accuracy: 0.87,
  excellent_sem_card_exact_accuracy: 0.90,
  minimum_sem_holdout_cards: 45,
  throughput_levels: [100, 500, 1000],
  minimum_completed_cards_per_minute: 6,
  minimum_throughput_technical_availability: 0.999,
  minimum_reliability_cards: 1000,
  minimum_reliability_tenants: 3,
  minimum_reliability_technical_availability: 0.999,
  minimum_tenant_isolation_measurement_rate: 1,
  maximum_writer_journey_age_ms: 24 * 60 * 60 * 1000
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function ratio(numerator, denominator) {
  const top = finiteNumber(numerator);
  const bottom = finiteNumber(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return Number((top / bottom).toFixed(6));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function verdict({ failures = [], evidenceShortfalls = [] } = {}) {
  if (failures.length) return "FAIL";
  if (evidenceShortfalls.length) return "INCONCLUSIVE";
  return "PASS";
}

function applyAttestedReleaseEvidence(row, releasePacketAssessment, dimension) {
  const evidence = releasePacketAssessment?.dimensions?.[dimension];
  const failures = unique([
    ...(row.failure_reasons || []),
    ...(Array.isArray(evidence?.failure_reasons) ? evidence.failure_reasons : [])
  ]);
  const evidenceShortfalls = unique([
    ...(row.evidence_shortfall_reasons || []),
    ...(Array.isArray(evidence?.evidence_shortfall_reasons)
      ? evidence.evidence_shortfall_reasons
      : ["ATTESTED_RELEASE_PACKET_REQUIRED"])
  ]);
  const status = verdict({ failures, evidenceShortfalls });
  return {
    ...row,
    verdict: status,
    pass: status === "PASS",
    release_evidence_verdict: evidence?.verdict || "INCONCLUSIVE",
    failure_reasons: failures,
    evidence_shortfall_reasons: evidenceShortfalls
  };
}

function reportSummary(report = {}) {
  return report.summary || {};
}

function attemptedCount(report = {}) {
  return finiteNumber(
    report.benchmark_level
    ?? report.attempted_count
    ?? reportSummary(report).attempted_count
    ?? report.stability_envelope?.aggregate?.attempted_count
  );
}

function completedCount(report = {}) {
  return finiteNumber(
    report.completed_count
    ?? reportSummary(report).ok_count
    ?? report.stability_envelope?.aggregate?.completed_count
  );
}

function cardsPerMinute(report = {}) {
  return finiteNumber(report.completed_cards_per_minute ?? reportSummary(report).completed_cards_per_minute);
}

function technicalAvailability(report = {}) {
  const explicit = finiteNumber(
    report.technical_availability
    ?? report.stability_envelope?.aggregate?.technical_availability
  );
  return explicit ?? ratio(completedCount(report), attemptedCount(report));
}

export function assessLaunchAccuracy(report = {}, thresholds = launchGateThresholds, {
  liveReleaseProvenance = null
} = {}) {
  const failures = [];
  const evidenceShortfalls = [];
  const metric = report.metrics?.sem_card_exact_accuracy || {};
  const exactCorrect = Number.isSafeInteger(metric.correct) && metric.correct >= 0 ? metric.correct : null;
  const exactTotal = Number.isSafeInteger(metric.total) && metric.total >= 0 ? metric.total : null;
  const summaryEvaluatedCards = Number.isSafeInteger(report.summary?.evaluated_card_count)
    && report.summary.evaluated_card_count >= 0
    ? report.summary.evaluated_card_count
    : null;
  const accuracy = typeof metric.rate === "number" && Number.isFinite(metric.rate)
    && metric.rate >= 0 && metric.rate <= 1
    ? metric.rate
    : null;
  const expectedAccuracy = exactCorrect !== null && exactTotal !== null
    ? ratio(exactCorrect, exactTotal)
    : null;
  const exactCountsConsistent = exactCorrect !== null
    && exactTotal !== null
    && summaryEvaluatedCards !== null
    && exactCorrect <= exactTotal
    && exactTotal === summaryEvaluatedCards
    && accuracy !== null
    && expectedAccuracy !== null
    && Math.abs(accuracy - expectedAccuracy) <= 0.0000005;
  const evaluatedCards = exactTotal ?? summaryEvaluatedCards ?? 0;
  const criticalOverclaimCount = Number.isSafeInteger(report.metrics?.critical_overclaim_count)
    && report.metrics.critical_overclaim_count >= 0
    ? report.metrics.critical_overclaim_count
    : null;
  const criticalFabricationCount = Number.isSafeInteger(report.metrics?.critical_fabrication_count)
    && report.metrics.critical_fabrication_count >= 0
    ? report.metrics.critical_fabrication_count
    : null;
  const catastrophicTitleCount = Number.isSafeInteger(report.metrics?.catastrophic_title_count)
    && report.metrics.catastrophic_title_count >= 0
    ? report.metrics.catastrophic_title_count
    : null;
  const holdout = cleanText(report.source?.partition).toLowerCase() === "holdout";
  const coreHoldoutReleaseSet = report.source?.dataset_schema_version === "release-set-v1"
    && cleanText(report.source?.set_type).toUpperCase() === "CORE_HOLDOUT";
  const strictSchema = report.schema_version === goldenSemAccuracySchemaVersion;
  const reviewedOnly = report.scope?.reviewed_ground_truth_only === true
    && report.scope?.writer_title_used_as_field_ground_truth === false;
  const explicitFormalTruthPolicy = report.scope?.explicit_evaluation_truth_policy === true
    && report.scope?.formal_golden_sem === true
    && cleanText(report.source?.field_ground_truth_class).toUpperCase()
      === "HUMAN_REVIEWED_FIELD_GROUND_TRUTH";
  const releaseValidated = report.source?.release_set_validation_ok === true;
  const releaseSetDigest = cleanText(report.source?.release_set_item_set_sha256).toLowerCase();
  const predictionDigest = cleanText(report.source?.prediction_content_sha256).toLowerCase();
  const predictionDeploymentSha = cleanText(report.source?.deployment_git_commit_sha).toLowerCase();
  const pipelineFingerprint = cleanText(report.source?.recognition_pipeline_fingerprint).toLowerCase();
  const catalogRevision = cleanText(report.source?.catalog_snapshot_revision);
  const predictionRowCount = Number.isSafeInteger(report.source?.prediction_row_count)
    && report.source.prediction_row_count >= 0
    ? report.source.prediction_row_count
    : null;
  const matchedPredictionCount = Number.isSafeInteger(report.summary?.matched_prediction_count)
    && report.summary.matched_prediction_count >= 0
    ? report.summary.matched_prediction_count
    : null;
  const labelItemCount = Number.isSafeInteger(report.summary?.label_item_count)
    && report.summary.label_item_count >= 0
    ? report.summary.label_item_count
    : null;
  const independentIdentityCount = Number.isSafeInteger(report.summary?.independent_identity_group_count)
    && report.summary.independent_identity_group_count >= 0
    ? report.summary.independent_identity_group_count
    : null;
  const launchFieldCoveredCount = Number.isSafeInteger(report.summary?.launch_field_contract_covered_count)
    && report.summary.launch_field_contract_covered_count >= 0
    ? report.summary.launch_field_contract_covered_count
    : null;
  const criticalIdentityCoveredCount = Number.isSafeInteger(report.summary?.critical_identity_covered_count)
    && report.summary.critical_identity_covered_count >= 0
    ? report.summary.critical_identity_covered_count
    : null;
  const rendererMetric = report.metrics?.renderer_fidelity || {};
  const rendererCorrect = Number.isSafeInteger(rendererMetric.correct) && rendererMetric.correct >= 0
    ? rendererMetric.correct
    : null;
  const rendererTotal = Number.isSafeInteger(rendererMetric.total) && rendererMetric.total >= 0
    ? rendererMetric.total
    : null;
  const rendererRate = typeof rendererMetric.rate === "number" && Number.isFinite(rendererMetric.rate)
    && rendererMetric.rate >= 0 && rendererMetric.rate <= 1
    ? rendererMetric.rate
    : null;
  const titleCriticalMetric = report.metrics?.title_critical_fidelity || {};
  const titleCriticalCorrect = Number.isSafeInteger(titleCriticalMetric.correct) && titleCriticalMetric.correct >= 0
    ? titleCriticalMetric.correct
    : null;
  const titleCriticalTotal = Number.isSafeInteger(titleCriticalMetric.total) && titleCriticalMetric.total >= 0
    ? titleCriticalMetric.total
    : null;
  const titleCriticalRate = typeof titleCriticalMetric.rate === "number" && Number.isFinite(titleCriticalMetric.rate)
    && titleCriticalMetric.rate >= 0 && titleCriticalMetric.rate <= 1
    ? titleCriticalMetric.rate
    : null;

  if (!strictSchema) evidenceShortfalls.push("GOLDEN_SEM_ACCURACY_REPORT_REQUIRED");
  if (report.status !== "COMPLETED") evidenceShortfalls.push("GOLDEN_SEM_ACCURACY_COMPLETED_REQUIRED");
  if (!holdout) evidenceShortfalls.push("CORE_HOLDOUT_ACCURACY_REQUIRED");
  if (!coreHoldoutReleaseSet) evidenceShortfalls.push("CORE_HOLDOUT_RELEASE_SET_V1_REQUIRED");
  if (!reviewedOnly) evidenceShortfalls.push("REVIEWED_FIELD_GROUND_TRUTH_REQUIRED");
  if (!explicitFormalTruthPolicy) evidenceShortfalls.push("EXPLICIT_FORMAL_TRUTH_POLICY_REQUIRED");
  if (report.scope?.launch_gate_eligible !== true) evidenceShortfalls.push("GOLDEN_SEM_LAUNCH_ELIGIBILITY_REQUIRED");
  if (!releaseValidated) evidenceShortfalls.push("HOLDOUT_LEAKAGE_VALIDATION_REQUIRED");
  if (report.source?.release_set_digest_schema_version !== releaseSetItemDigestSchemaVersion) {
    evidenceShortfalls.push("HOLDOUT_CONTENT_DIGEST_V2_REQUIRED");
  }
  if (!/^[0-9a-f]{64}$/.test(releaseSetDigest)) evidenceShortfalls.push("HOLDOUT_CONTENT_DIGEST_REQUIRED");
  if (report.source?.prediction_digest_schema_version !== predictionContentDigestSchemaVersion) {
    evidenceShortfalls.push("PREDICTION_CONTENT_DIGEST_SCHEMA_REQUIRED");
  }
  if (report.source?.predictions_schema_version !== goldenSemPredictionRunSchemaVersion) {
    evidenceShortfalls.push("GOLDEN_SEM_PREDICTION_RUN_V1_REQUIRED");
  }
  if (!/^[0-9a-f]{64}$/.test(predictionDigest)) evidenceShortfalls.push("PREDICTION_CONTENT_DIGEST_REQUIRED");
  if (!/^[0-9a-f]{40}$/.test(predictionDeploymentSha)) evidenceShortfalls.push("PREDICTION_DEPLOYMENT_SHA_REQUIRED");
  if (!/^[0-9a-f]{64}$/.test(pipelineFingerprint)) evidenceShortfalls.push("RECOGNITION_PIPELINE_FINGERPRINT_REQUIRED");
  if (!catalogRevision) evidenceShortfalls.push("CATALOG_SNAPSHOT_REVISION_REQUIRED");
  if (report.scope?.prediction_run_provenance_complete !== true
    || report.source?.prediction_rows_version_bound !== true
    || report.source?.prediction_item_ids_unique !== true
    || report.source?.prediction_exact_item_set_match !== true
    || predictionRowCount === null
    || matchedPredictionCount === null
    || labelItemCount === null
    || predictionRowCount !== matchedPredictionCount
    || matchedPredictionCount !== labelItemCount) {
    evidenceShortfalls.push("PREDICTION_RUN_PROVENANCE_INCOMPLETE");
  }
  if (liveReleaseProvenance !== null) {
    const liveMainSha = cleanText(liveReleaseProvenance?.main_git_sha).toLowerCase();
    const liveDeploymentSha = cleanText(liveReleaseProvenance?.deployment_git_sha).toLowerCase();
    const livePipelineFingerprint = cleanText(liveReleaseProvenance?.recognition_pipeline_fingerprint).toLowerCase();
    const liveCatalogRevision = cleanText(liveReleaseProvenance?.active_catalog_snapshot_revision);
    if (
      liveReleaseProvenance?.verified !== true
      || !/^[0-9a-f]{40}$/.test(liveMainSha)
      || !/^[0-9a-f]{40}$/.test(liveDeploymentSha)
    ) {
      evidenceShortfalls.push("ACCURACY_LIVE_RELEASE_PROVENANCE_REQUIRED");
    } else if (predictionDeploymentSha && (
      predictionDeploymentSha !== liveMainSha
      || predictionDeploymentSha !== liveDeploymentSha
    )) {
      failures.push("ACCURACY_PREDICTION_DEPLOYMENT_SHA_MISMATCH");
    }
    if (!/^[0-9a-f]{64}$/.test(livePipelineFingerprint)) {
      evidenceShortfalls.push("LIVE_RECOGNITION_PIPELINE_FINGERPRINT_REQUIRED");
    } else if (pipelineFingerprint && pipelineFingerprint !== livePipelineFingerprint) {
      failures.push("ACCURACY_RECOGNITION_PIPELINE_FINGERPRINT_MISMATCH");
    }
    if (!liveCatalogRevision) {
      evidenceShortfalls.push("LIVE_CATALOG_SNAPSHOT_REVISION_REQUIRED");
    } else if (catalogRevision && catalogRevision !== liveCatalogRevision) {
      failures.push("ACCURACY_CATALOG_SNAPSHOT_REVISION_MISMATCH");
    }
  }
  if (!exactCountsConsistent) evidenceShortfalls.push("SEM_CARD_EXACT_COUNTS_OR_RATE_INCONSISTENT");
  if (labelItemCount === null || labelItemCount !== evaluatedCards) {
    evidenceShortfalls.push("SEM_HOLDOUT_LABEL_AND_EVALUATED_COUNTS_INCONSISTENT");
  }
  if (independentIdentityCount === null || independentIdentityCount < thresholds.minimum_sem_holdout_cards) {
    evidenceShortfalls.push("SEM_INDEPENDENT_HOLDOUT_SAMPLE_TOO_SMALL");
  }
  if (
    labelItemCount === null
    || launchFieldCoveredCount !== labelItemCount
    || criticalIdentityCoveredCount !== labelItemCount
  ) evidenceShortfalls.push("FORMAL_LAUNCH_FIELD_COVERAGE_INCOMPLETE");
  if (report.scope?.renderer_replay_inputs_complete !== true) {
    evidenceShortfalls.push("RENDERER_REPLAY_INPUTS_REQUIRED");
  }
  const rendererMetricComplete = labelItemCount !== null
    && rendererCorrect !== null
    && rendererTotal === labelItemCount
    && rendererCorrect <= rendererTotal
    && rendererRate !== null
    && Math.abs(rendererRate - ratio(rendererCorrect, rendererTotal)) <= 0.0000005;
  if (!rendererMetricComplete) evidenceShortfalls.push("RENDERER_FIDELITY_METRIC_INCONSISTENT");
  else if (rendererCorrect !== rendererTotal) failures.push("RENDERER_FIDELITY_BELOW_100_PERCENT");
  const titleCriticalMetricComplete = labelItemCount !== null
    && titleCriticalCorrect !== null
    && titleCriticalTotal === labelItemCount
    && titleCriticalCorrect <= titleCriticalTotal
    && titleCriticalRate !== null
    && Math.abs(titleCriticalRate - ratio(titleCriticalCorrect, titleCriticalTotal)) <= 0.0000005;
  if (!titleCriticalMetricComplete) evidenceShortfalls.push("TITLE_CRITICAL_FIDELITY_METRIC_INCONSISTENT");
  else if (titleCriticalCorrect !== titleCriticalTotal) failures.push("TITLE_CRITICAL_FIDELITY_BELOW_100_PERCENT");
  if (accuracy === null) evidenceShortfalls.push("SEM_CARD_EXACT_ACCURACY_MISSING");
  if (criticalOverclaimCount === null) evidenceShortfalls.push("CRITICAL_OVERCLAIM_COUNT_REQUIRED");
  if (criticalFabricationCount === null) evidenceShortfalls.push("CRITICAL_FABRICATION_COUNT_REQUIRED");
  if (catastrophicTitleCount === null) evidenceShortfalls.push("CATASTROPHIC_TITLE_COUNT_REQUIRED");
  if (criticalOverclaimCount > 0) failures.push("CRITICAL_OVERCLAIM_PRESENT");
  if (criticalFabricationCount > 0) failures.push("CRITICAL_FABRICATION_PRESENT");
  if (catastrophicTitleCount > 0) failures.push("CATASTROPHIC_TITLE_PRESENT");
  if (!evidenceShortfalls.length && accuracy < thresholds.minimum_sem_card_exact_accuracy) {
    failures.push("SEM_ACCURACY_BELOW_LAUNCH_TARGET");
  }
  const status = verdict({ failures, evidenceShortfalls });
  return {
    verdict: status,
    pass: status === "PASS",
    metric_id: "sem_card_exact_accuracy",
    value: accuracy,
    evaluated_cards: evaluatedCards,
    independent_identity_groups: independentIdentityCount,
    target: thresholds.minimum_sem_card_exact_accuracy,
    excellent_target: thresholds.excellent_sem_card_exact_accuracy,
    minimum_holdout_cards: thresholds.minimum_sem_holdout_cards,
    critical_overclaim_count: criticalOverclaimCount,
    critical_fabrication_count: criticalFabricationCount,
    catastrophic_title_count: catastrophicTitleCount,
    per_field_exact_accuracy: report.metrics?.per_field_exact_accuracy || {},
    failure_reasons: unique(failures),
    evidence_shortfall_reasons: unique(evidenceShortfalls)
  };
}

function throughputReportForLevel(reports = [], level) {
  return reports.find((report) => Number(report?.benchmark_level) === level)
    || reports.find((report) => attemptedCount(report) === level)
    || null;
}

function assessThroughputLevel(report, level, thresholds) {
  const failures = [];
  const evidenceShortfalls = [];
  if (!report) {
    evidenceShortfalls.push(`THROUGHPUT_${level}_REPORT_MISSING`);
    return {
      benchmark_level: level,
      verdict: "INCONCLUSIVE",
      pass: false,
      failure_reasons: [],
      evidence_shortfall_reasons: evidenceShortfalls
    };
  }
  if (report.schema_version !== launchThroughputCheckpointSchemaVersion) {
    evidenceShortfalls.push(`THROUGHPUT_${level}_CHECKPOINT_V1_REQUIRED`);
  }
  const attempted = attemptedCount(report) ?? 0;
  const completed = completedCount(report) ?? 0;
  const throughput = cardsPerMinute(report);
  const availability = technicalAvailability(report);
  if (attempted < level) evidenceShortfalls.push(`THROUGHPUT_${level}_SAMPLE_TOO_SMALL`);
  if (throughput === null) evidenceShortfalls.push(`THROUGHPUT_${level}_RATE_MISSING`);
  if (availability === null) evidenceShortfalls.push(`THROUGHPUT_${level}_AVAILABILITY_MISSING`);
  if (!evidenceShortfalls.length && throughput < thresholds.minimum_completed_cards_per_minute) {
    failures.push(`THROUGHPUT_${level}_BELOW_TARGET`);
  }
  if (!evidenceShortfalls.length && availability < thresholds.minimum_throughput_technical_availability) {
    failures.push(`THROUGHPUT_${level}_AVAILABILITY_BELOW_TARGET`);
  }
  const status = verdict({ failures, evidenceShortfalls });
  return {
    benchmark_level: level,
    verdict: status,
    pass: status === "PASS",
    attempted_count: attempted,
    completed_count: completed,
    completed_cards_per_minute: throughput,
    technical_availability: availability,
    minimum_completed_cards_per_minute: thresholds.minimum_completed_cards_per_minute,
    minimum_technical_availability: thresholds.minimum_throughput_technical_availability,
    writer_ready_p50_ms: finiteNumber(reportSummary(report).writer_ready_p50_ms),
    writer_ready_p95_ms: finiteNumber(reportSummary(report).writer_ready_p95_ms),
    provider_latency_p95_ms: finiteNumber(reportSummary(report).provider_diagnostics?.provider_latency_p95_ms),
    failure_reasons: unique(failures),
    evidence_shortfall_reasons: unique(evidenceShortfalls)
  };
}

export function assessLaunchThroughput(reports = [], thresholds = launchGateThresholds) {
  const rows = thresholds.throughput_levels.map((level) => assessThroughputLevel(
    throughputReportForLevel(Array.isArray(reports) ? reports : [], level),
    level,
    thresholds
  ));
  const failures = rows.flatMap((row) => row.failure_reasons);
  const evidenceShortfalls = rows.flatMap((row) => row.evidence_shortfall_reasons);
  const status = verdict({ failures, evidenceShortfalls });
  return {
    verdict: status,
    pass: status === "PASS",
    metric_id: "completed_cards_per_minute",
    target: thresholds.minimum_completed_cards_per_minute,
    required_levels: thresholds.throughput_levels,
    levels: rows,
    failure_reasons: unique(failures),
    evidence_shortfall_reasons: unique(evidenceShortfalls)
  };
}

function integrityMetric(report = {}, field) {
  const summary = reportSummary(report);
  const waveValues = Array.isArray(report.wave_reports)
    ? report.wave_reports.map((wave) => finiteNumber(wave.summary?.production_integrity?.[field])).filter((value) => value !== null)
    : [];
  const direct = finiteNumber(summary.production_integrity?.[field]);
  if (direct !== null) return direct;
  if (waveValues.length) return waveValues.reduce((sum, value) => sum + value, 0);
  return finiteNumber(report.stability_envelope?.aggregate?.[field]);
}

export function assessLaunchReliability(report = {}, thresholds = launchGateThresholds) {
  const failures = [];
  const evidenceShortfalls = [];
  const envelope = report.stability_envelope || {};
  const aggregate = envelope.aggregate || {};
  const attempted = attemptedCount(report) ?? 0;
  const completed = completedCount(report) ?? 0;
  const availability = technicalAvailability(report);
  const tenants = finiteNumber(aggregate.tenant_count ?? report.tenant_count ?? reportSummary(report).production_integrity?.tenant_count) ?? 0;
  const residualBacklog = finiteNumber(aggregate.residual_backlog_count);
  const duplicateJobs = integrityMetric(report, "duplicate_job_id_count");
  const duplicateAssets = integrityMetric(report, "duplicate_asset_id_count");
  const missingJobs = integrityMetric(report, "missing_job_id_count");
  const successfulNonterminal = integrityMetric(report, "successful_nonterminal_job_count");
  const tenantIsolationViolations = integrityMetric(report, "tenant_isolation_violation_count");
  const tenantIsolationMeasured = integrityMetric(report, "tenant_isolation_measured_count");
  const tenantIsolationRate = ratio(tenantIsolationMeasured, attempted);
  const evidenceReasons = Array.isArray(envelope.evidence_shortfall_reasons)
    ? envelope.evidence_shortfall_reasons
    : [];
  const runtimeReasons = (Array.isArray(envelope.runtime_rejection_reasons)
    ? envelope.runtime_rejection_reasons
    : []).filter((reason) => reason !== "TECHNICAL_AVAILABILITY_BELOW_TARGET");

  if (report.schema_version !== "v4-multi-tenant-soak-v1") evidenceShortfalls.push("MULTI_TENANT_SOAK_REPORT_REQUIRED");
  if (envelope.schema_version !== "v4-stability-envelope-v1") evidenceShortfalls.push("STABILITY_ENVELOPE_REQUIRED");
  if (attempted < thresholds.minimum_reliability_cards) evidenceShortfalls.push("RELIABILITY_SAMPLE_TOO_SMALL");
  if (tenants < thresholds.minimum_reliability_tenants) evidenceShortfalls.push("MULTI_TENANT_EVIDENCE_MISSING");
  if (availability === null) evidenceShortfalls.push("TECHNICAL_AVAILABILITY_MISSING");
  if (residualBacklog === null) evidenceShortfalls.push("RESIDUAL_BACKLOG_MEASUREMENT_MISSING");
  if (tenantIsolationViolations === null || tenantIsolationMeasured === null) {
    evidenceShortfalls.push("TENANT_ISOLATION_MEASUREMENT_MISSING");
  } else if (tenantIsolationRate < thresholds.minimum_tenant_isolation_measurement_rate) {
    evidenceShortfalls.push("TENANT_ISOLATION_MEASUREMENT_INCOMPLETE");
  }
  evidenceShortfalls.push(...evidenceReasons);

  if (availability !== null && availability < thresholds.minimum_reliability_technical_availability) {
    failures.push("TECHNICAL_AVAILABILITY_BELOW_99_9_PERCENT");
  }
  if (residualBacklog !== null && residualBacklog > 0) failures.push("LOST_OR_NONTERMINAL_JOB_PRESENT");
  if (duplicateJobs !== null && duplicateJobs > 0) failures.push("DUPLICATE_QUEUE_JOB");
  if (duplicateAssets !== null && duplicateAssets > 0) failures.push("DUPLICATE_ASSET_RESULT");
  if (missingJobs !== null && missingJobs > 0) failures.push("QUEUE_JOB_ID_MISSING");
  if (successfulNonterminal !== null && successfulNonterminal > 0) failures.push("SUCCESSFUL_JOB_NOT_TERMINAL");
  if (tenantIsolationViolations !== null && tenantIsolationViolations > 0) failures.push("TENANT_ISOLATION_VIOLATION");
  failures.push(...runtimeReasons);
  const status = verdict({ failures, evidenceShortfalls });
  return {
    verdict: status,
    pass: status === "PASS",
    metric_id: "technical_availability",
    attempted_count: attempted,
    completed_count: completed,
    tenant_count: tenants,
    technical_availability: availability,
    target: thresholds.minimum_reliability_technical_availability,
    minimum_cards: thresholds.minimum_reliability_cards,
    residual_backlog_count: residualBacklog,
    duplicate_job_id_count: duplicateJobs,
    duplicate_asset_id_count: duplicateAssets,
    missing_job_id_count: missingJobs,
    successful_nonterminal_job_count: successfulNonterminal,
    tenant_isolation_measured_count: tenantIsolationMeasured,
    tenant_isolation_measurement_rate: tenantIsolationRate,
    tenant_isolation_violation_count: tenantIsolationViolations,
    recovered_retry_count: finiteNumber(reportSummary(report).retry_card_count),
    permanent_failure_count: Math.max(0, attempted - completed),
    failure_reasons: unique(failures),
    evidence_shortfall_reasons: unique(evidenceShortfalls),
    warning_reasons: unique(envelope.warning_reasons || [])
  };
}

const requiredWriterJourneyStages = Object.freeze([
  "health",
  "real_image_materialization",
  "login",
  "upload",
  "enqueue",
  "status",
  "l2_ready",
  "accept_edit",
  "persistence"
]);

const requiredWriterJourneyIdFields = Object.freeze([
  "request_ids",
  "asset_ids",
  "batch_ids",
  "job_ids",
  "session_ids"
]);

function exactGitSha(value) {
  if (typeof value !== "string" || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const sha = value.toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function validJourneyIdentifier(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const text = value.trim();
  return Boolean(text && text.length <= 256);
}

function exactDeploymentId(value) {
  if (typeof value !== "string" || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return /^dpl_[A-Za-z0-9]+$/.test(value) ? value : null;
}

function exactPrintableString(value, pattern = null) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || !value
    || value.length > 512
    || /[^\x20-\x7e]/.test(value)
  ) return null;
  return !pattern || pattern.test(value) ? value : null;
}

export function assessProductionWriterJourney(report = {}, {
  liveReleaseProvenance = {},
  attestationVerification = {},
  maximumAgeMs = launchGateThresholds.maximum_writer_journey_age_ms
} = {}) {
  const failures = [];
  const evidenceShortfalls = [];
  const expectedSha = exactGitSha(report.expected_git_commit_sha);
  const deployedSha = exactGitSha(report.deployment_git_commit_sha);
  const releaseSha = exactGitSha(liveReleaseProvenance.main_git_sha);
  const liveDeploymentSha = exactGitSha(liveReleaseProvenance.deployment_git_sha);
  const liveRepository = exactPrintableString(liveReleaseProvenance.repository);
  const deploymentId = exactDeploymentId(report.deployment_id);
  const releaseDeploymentId = exactDeploymentId(liveReleaseProvenance.deployment_id);
  const finishedAtMs = typeof report.finished_at === "string" ? Date.parse(report.finished_at) : Number.NaN;
  const liveCheckedAtMs = typeof liveReleaseProvenance.checked_at === "string"
    ? Date.parse(liveReleaseProvenance.checked_at)
    : Number.NaN;
  const repository = exactPrintableString(report.repository);
  const workflowRef = exactPrintableString(report.workflow_ref);
  const runId = exactPrintableString(report.run_id, /^[1-9][0-9]*$/);
  const runAttempt = exactPrintableString(report.run_attempt, /^[1-9][0-9]*$/);
  const event = exactPrintableString(report.event, /^(workflow_run|workflow_dispatch)$/);
  const sourceRef = exactPrintableString(report.source_ref);
  const productionBaseUrl = exactPrintableString(report.production_base_url);
  const attestedSourceDigest = exactGitSha(attestationVerification.source_digest);
  const attestedRepository = exactPrintableString(attestationVerification.repository);
  const attestedSignerWorkflow = exactPrintableString(attestationVerification.signer_workflow);
  const attestedSourceRef = exactPrintableString(attestationVerification.source_ref);
  const verifiedAttestationCount = typeof attestationVerification.verified_attestation_count === "number"
    ? attestationVerification.verified_attestation_count
    : null;
  const stages = report.stages && typeof report.stages === "object" ? report.stages : {};
  const artifactSafety = report.artifact_safety && typeof report.artifact_safety === "object"
    ? report.artifact_safety
    : {};

  if (report.schema_version !== productionWriterJourneyEvidenceSchemaVersion) {
    evidenceShortfalls.push("PRODUCTION_WRITER_JOURNEY_V3_REQUIRED");
  }
  if (liveReleaseProvenance.verified !== true) {
    evidenceShortfalls.push("LIVE_RELEASE_PROVENANCE_REQUIRED");
  }
  if (!liveRepository) evidenceShortfalls.push("LIVE_RELEASE_REPOSITORY_MISSING");
  else if (liveRepository !== productionLaunchRepository) failures.push("LIVE_RELEASE_REPOSITORY_MISMATCH");
  if (
    !releaseSha
    || !liveDeploymentSha
    || !releaseDeploymentId
    || !Number.isFinite(liveCheckedAtMs)
    || new Date(liveCheckedAtMs).toISOString() !== liveReleaseProvenance.checked_at
  ) {
    evidenceShortfalls.push("LIVE_RELEASE_IDENTITY_INCOMPLETE");
  }
  if (releaseSha && liveDeploymentSha && releaseSha !== liveDeploymentSha) {
    failures.push("LIVE_MAIN_AND_PRODUCTION_SHA_MISMATCH");
  }
  if (attestationVerification.verified !== true) {
    evidenceShortfalls.push("WRITER_JOURNEY_ARTIFACT_ATTESTATION_REQUIRED");
  }
  if (
    attestedRepository !== productionLaunchRepository
    || attestedSignerWorkflow !== productionWriterJourneySignerWorkflow
    || attestedSourceRef !== productionLaunchSourceRef
    || !attestedSourceDigest
    || attestationVerification.denied_self_hosted_runners !== true
    || !Number.isInteger(verifiedAttestationCount)
    || verifiedAttestationCount < 1
  ) {
    evidenceShortfalls.push("WRITER_JOURNEY_ATTESTATION_PROVENANCE_INCOMPLETE");
  }
  if (releaseSha && attestedSourceDigest && releaseSha !== attestedSourceDigest) {
    failures.push("WRITER_JOURNEY_ATTESTATION_SOURCE_DIGEST_MISMATCH");
  }
  if (repository !== productionLaunchRepository) {
    evidenceShortfalls.push("WRITER_JOURNEY_REPOSITORY_PROVENANCE_MISSING");
  }
  if (workflowRef !== productionWriterJourneyWorkflowRef) {
    evidenceShortfalls.push("WRITER_JOURNEY_WORKFLOW_REF_PROVENANCE_MISSING");
  }
  if (!runId || !runAttempt || !event) {
    evidenceShortfalls.push("WRITER_JOURNEY_RUN_PROVENANCE_MISSING");
  }
  if (sourceRef !== productionLaunchSourceRef) {
    evidenceShortfalls.push("WRITER_JOURNEY_SOURCE_REF_PROVENANCE_MISSING");
  }
  if (!productionBaseUrl) evidenceShortfalls.push("WRITER_JOURNEY_PRODUCTION_BASE_URL_MISSING");
  else if (productionBaseUrl !== productionLaunchBaseUrl) failures.push("WRITER_JOURNEY_PRODUCTION_BASE_URL_MISMATCH");
  if (typeof liveReleaseProvenance.production_base_url !== "string") {
    evidenceShortfalls.push("LIVE_PRODUCTION_BASE_URL_MISSING");
  } else if (liveReleaseProvenance.production_base_url !== productionLaunchBaseUrl) {
    failures.push("LIVE_PRODUCTION_BASE_URL_MISMATCH");
  }
  if (!deploymentId) evidenceShortfalls.push("PRODUCTION_DEPLOYMENT_ID_REQUIRED");
  if (deploymentId && releaseDeploymentId && deploymentId !== releaseDeploymentId) {
    failures.push("WRITER_JOURNEY_RELEASE_DEPLOYMENT_MISMATCH");
  }
  if (
    !Number.isFinite(finishedAtMs)
    || new Date(finishedAtMs).toISOString() !== report.finished_at
  ) {
    evidenceShortfalls.push("WRITER_JOURNEY_FINISHED_AT_REQUIRED");
  } else if (
    !Number.isFinite(liveCheckedAtMs)
    || finishedAtMs > liveCheckedAtMs + 60_000
    || liveCheckedAtMs - finishedAtMs > maximumAgeMs
  ) {
    failures.push("WRITER_JOURNEY_EVIDENCE_STALE_OR_FUTURE");
  }
  if (!releaseSha) evidenceShortfalls.push("CURRENT_RELEASE_GIT_SHA_REQUIRED");
  if (!expectedSha) evidenceShortfalls.push("WRITER_JOURNEY_EXPECTED_SHA_REQUIRED");
  if (!deployedSha) evidenceShortfalls.push("WRITER_JOURNEY_DEPLOYED_SHA_REQUIRED");
  if (expectedSha && deployedSha && expectedSha !== deployedSha) {
    failures.push("WRITER_JOURNEY_DEPLOYMENT_SHA_MISMATCH");
  }
  if (releaseSha && expectedSha && releaseSha !== expectedSha) {
    failures.push("WRITER_JOURNEY_RELEASE_SHA_MISMATCH");
  }
  if (releaseSha && deployedSha && releaseSha !== deployedSha) {
    failures.push("WRITER_JOURNEY_DEPLOYED_RELEASE_SHA_MISMATCH");
  }
  if (liveDeploymentSha && deployedSha && liveDeploymentSha !== deployedSha) {
    failures.push("WRITER_JOURNEY_LIVE_DEPLOYMENT_SHA_MISMATCH");
  }
  if (report.exact_sha_match === false) failures.push("WRITER_JOURNEY_EXACT_SHA_NOT_PROVEN");
  else if (report.exact_sha_match !== true) evidenceShortfalls.push("WRITER_JOURNEY_EXACT_SHA_PROOF_MISSING");
  if (report.launch_ready_mutated === true) failures.push("WRITER_JOURNEY_MUTATED_LAUNCH_READY");
  else if (report.launch_ready_mutated !== false) evidenceShortfalls.push("WRITER_JOURNEY_LAUNCH_READY_BOUNDARY_MISSING");
  if (
    !Array.isArray(report.required_stage_ids)
    || report.required_stage_ids.length !== requiredWriterJourneyStages.length
    || report.required_stage_ids.some((stage, index) => stage !== requiredWriterJourneyStages[index])
  ) {
    evidenceShortfalls.push("WRITER_JOURNEY_REQUIRED_STAGE_CONTRACT_MISSING");
  }
  if (report.all_required_stages_passed !== true) {
    evidenceShortfalls.push("WRITER_JOURNEY_ALL_REQUIRED_STAGES_PASS_MISSING");
  }
  for (const stage of requiredWriterJourneyStages) {
    if (stages?.[stage]?.passed !== true) evidenceShortfalls.push(`WRITER_JOURNEY_${stage.toUpperCase()}_MISSING`);
  }
  for (const field of requiredWriterJourneyIdFields) {
    if (
      !Array.isArray(report[field])
      || report[field].length === 0
      || report[field].some((value) => !validJourneyIdentifier(value))
    ) {
      evidenceShortfalls.push(`WRITER_JOURNEY_${field.toUpperCase()}_MISSING`);
    }
  }
  if (report.passed === false) failures.push("PRODUCTION_WRITER_JOURNEY_FAILED");
  else if (report.passed !== true) evidenceShortfalls.push("PRODUCTION_WRITER_JOURNEY_PASS_MISSING");
  if (!report.artifact_safety || typeof report.artifact_safety !== "object") {
    evidenceShortfalls.push("WRITER_JOURNEY_ARTIFACT_SAFETY_MISSING");
  } else if (
    artifactSafety.safe_to_upload !== true
    || artifactSafety.har_uploaded !== false
    || artifactSafety.trace_uploaded !== false
    || artifactSafety.sensitive_value_scan_passed !== true
    || artifactSafety.storage_state_persisted !== false
    || artifactSafety.login_screenshot_recorded !== false
    || artifactSafety.screenshot_sensitive_controls_masked !== true
  ) {
    failures.push("WRITER_JOURNEY_ARTIFACT_SAFETY_NOT_PROVEN");
  }

  const status = verdict({ failures, evidenceShortfalls });
  return {
    verdict: status,
    pass: status === "PASS",
    metric_id: "production_writer_journey",
    deployment_id: deploymentId,
    current_release_deployment_id: releaseDeploymentId,
    finished_at: Number.isFinite(finishedAtMs) ? new Date(finishedAtMs).toISOString() : null,
    maximum_age_ms: maximumAgeMs,
    current_release_git_sha: releaseSha,
    current_deployment_git_sha: liveDeploymentSha,
    expected_git_commit_sha: expectedSha,
    deployment_git_commit_sha: deployedSha,
    exact_sha_match: report.exact_sha_match === true,
    provenance: {
      repository,
      workflow_ref: workflowRef,
      run_id: runId,
      run_attempt: runAttempt,
      event,
      source_ref: sourceRef,
      production_base_url: productionBaseUrl,
      live_checked_at: Number.isFinite(liveCheckedAtMs) ? new Date(liveCheckedAtMs).toISOString() : null,
      artifact_attestation_verified: attestationVerification.verified === true,
      verified_attestation_count: Number.isInteger(verifiedAttestationCount) ? verifiedAttestationCount : 0,
      attested_source_digest: attestedSourceDigest
    },
    artifact_safety: {
      safe_to_upload: artifactSafety.safe_to_upload === true,
      har_uploaded: artifactSafety.har_uploaded === true,
      trace_uploaded: artifactSafety.trace_uploaded === true,
      sensitive_value_scan_passed: artifactSafety.sensitive_value_scan_passed === true,
      storage_state_persisted: artifactSafety.storage_state_persisted === true,
      login_screenshot_recorded: artifactSafety.login_screenshot_recorded === true,
      screenshot_sensitive_controls_masked: artifactSafety.screenshot_sensitive_controls_masked === true
    },
    required_stages: requiredWriterJourneyStages,
    failure_reasons: unique(failures),
    evidence_shortfall_reasons: unique(evidenceShortfalls)
  };
}

export function assessLaunchBenchmark({
  accuracyReport = {},
  throughputReports = [],
  reliabilityReport = {},
  writerJourneyReport = {},
  liveReleaseProvenance = {},
  writerJourneyAttestation = {},
  releasePacketAssessment = {},
  thresholds = launchGateThresholds,
  now = () => new Date()
} = {}) {
  const accuracy = applyAttestedReleaseEvidence(
    assessLaunchAccuracy(accuracyReport, thresholds, { liveReleaseProvenance }),
    releasePacketAssessment,
    "accuracy"
  );
  const throughput = applyAttestedReleaseEvidence(
    assessLaunchThroughput(throughputReports, thresholds),
    releasePacketAssessment,
    "throughput"
  );
  const reliability = applyAttestedReleaseEvidence(
    assessLaunchReliability(reliabilityReport, thresholds),
    releasePacketAssessment,
    "reliability"
  );
  const generatedAt = now();
  const writerJourney = applyAttestedReleaseEvidence(
    assessProductionWriterJourney(writerJourneyReport, {
      liveReleaseProvenance,
      attestationVerification: writerJourneyAttestation,
      maximumAgeMs: thresholds.maximum_writer_journey_age_ms
    }),
    releasePacketAssessment,
    "writer_journey"
  );
  const dimensions = { accuracy, throughput, reliability, writer_journey: writerJourney };
  const failures = Object.entries(dimensions)
    .filter(([, value]) => value.verdict === "FAIL")
    .map(([key]) => key);
  const inconclusive = Object.entries(dimensions)
    .filter(([, value]) => value.verdict === "INCONCLUSIVE")
    .map(([key]) => key);
  const launchVerdict = failures.length ? "FAIL" : inconclusive.length ? "INCONCLUSIVE" : "PASS";
  return {
    schema_version: launchBenchmarkSchemaVersion,
    generated_at: generatedAt.toISOString(),
    phase: "LAUNCH_OPTIMIZATION",
    launch_verdict: launchVerdict,
    launch_ready: launchVerdict === "PASS",
    targets: thresholds,
    release_evidence: releasePacketAssessment,
    dimensions,
    failed_dimensions: failures,
    inconclusive_dimensions: inconclusive,
    next_bottleneck: failures[0] || inconclusive[0] || null,
    policy: {
      all_release_dimensions_must_pass: true,
      production_writer_journey_required: true,
      production_writer_journey_exact_sha_required: true,
      production_writer_journey_artifact_attestation_required: true,
      live_release_provenance_required: true,
      weak_seller_title_metrics_are_diagnostic_only: true,
      missing_evidence_never_passes: true,
      holdout_cannot_be_used_for_training_or_tuning: true
    }
  };
}
