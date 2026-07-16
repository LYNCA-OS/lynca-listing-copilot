import { goldenSemAccuracySchemaVersion } from "./golden-sem-accuracy.mjs";
import {
  formalLaunchCriticalFieldGroups,
  humanReviewedFieldGroundTruthClass,
  minimumCardExactEvaluatedFields
} from "./release-set-contract.mjs";

export const launchBenchmarkSchemaVersion = "launch-benchmark-v1";
export const launchGateThresholds = Object.freeze({
  minimum_sem_card_exact_accuracy: 0.87,
  excellent_sem_card_exact_accuracy: 0.90,
  minimum_sem_holdout_cards: 45,
  minimum_sem_card_exact_evaluated_fields: minimumCardExactEvaluatedFields,
  minimum_sem_critical_field_evaluated_cards: 5,
  minimum_sem_critical_field_coverage_rate: 0.10,
  throughput_levels: [100, 500, 1000],
  minimum_completed_cards_per_minute: 6,
  minimum_throughput_technical_availability: 0.999,
  minimum_reliability_cards: 1000,
  minimum_reliability_tenants: 3,
  minimum_reliability_technical_availability: 0.999,
  minimum_tenant_isolation_measurement_rate: 1
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

function coverageFromPerField(perField = {}, aliases = []) {
  const totals = aliases
    .map((field) => finiteNumber(perField[field]?.total ?? perField[field]?.evaluated_cards))
    .filter((value) => value !== null);
  return totals.length ? Math.max(...totals) : null;
}

function assessCriticalFieldCoverage(report = {}, evaluatedCards = 0, thresholds = launchGateThresholds) {
  const metric = report.metrics?.critical_field_evaluable_coverage || {};
  const reportedDimensions = metric.dimensions || {};
  const perField = report.metrics?.per_field_exact_accuracy || {};
  const totalCards = finiteNumber(metric.total_cards ?? report.summary?.label_item_count) ?? evaluatedCards;
  const dimensions = {};
  const evidenceShortfalls = [];

  for (const [dimension, aliases] of Object.entries(formalLaunchCriticalFieldGroups)) {
    const reported = [dimension, ...aliases]
      .map((key) => reportedDimensions[key] || metric[key])
      .find((value) => value && typeof value === "object" && !Array.isArray(value))
      || {};
    const evaluated = finiteNumber(
      reported.evaluated_cards
      ?? reported.total
      ?? coverageFromPerField(perField, aliases)
    );
    const denominator = finiteNumber(reported.total_cards ?? totalCards);
    const coverageRate = finiteNumber(reported.rate) ?? ratio(evaluated, denominator);
    const reasonSuffix = dimension.toUpperCase();
    if (evaluated === null || coverageRate === null) {
      evidenceShortfalls.push(`SEM_CRITICAL_${reasonSuffix}_COVERAGE_MISSING`);
    } else if (
      evaluated < thresholds.minimum_sem_critical_field_evaluated_cards
      || coverageRate < thresholds.minimum_sem_critical_field_coverage_rate
    ) {
      evidenceShortfalls.push(`SEM_CRITICAL_${reasonSuffix}_COVERAGE_TOO_LOW`);
    }
    dimensions[dimension] = {
      accepted_field_names: aliases,
      evaluated_cards: evaluated,
      total_cards: denominator,
      rate: coverageRate,
      minimum_evaluated_cards: thresholds.minimum_sem_critical_field_evaluated_cards,
      minimum_coverage_rate: thresholds.minimum_sem_critical_field_coverage_rate
    };
  }

  return {
    pass: evidenceShortfalls.length === 0,
    total_cards: totalCards,
    dimensions,
    evidence_shortfall_reasons: evidenceShortfalls
  };
}

function assessCardExactCoverage(report = {}, evaluatedCards = 0, thresholds = launchGateThresholds) {
  const metric = report.metrics?.card_exact_evaluable_coverage || {};
  const reportedMinimum = finiteNumber(metric.minimum_evaluated_fields_required);
  const reportedSingleFieldPasses = finiteNumber(metric.single_field_card_exact_pass_count);
  const observedSingleFieldPasses = Array.isArray(report.cards)
    ? report.cards.filter((card) => (
      card?.card_exact === true
      && finiteNumber(card?.evaluated_field_count) !== null
      && finiteNumber(card?.evaluated_field_count) < thresholds.minimum_sem_card_exact_evaluated_fields
    )).length
    : null;
  const singleFieldPasses = reportedSingleFieldPasses === null
    ? observedSingleFieldPasses
    : Math.max(reportedSingleFieldPasses, observedSingleFieldPasses ?? 0);
  const eligibleCards = finiteNumber(metric.eligible_card_count);
  const evidenceShortfalls = [];

  if (
    reportedMinimum === null
    || reportedMinimum < thresholds.minimum_sem_card_exact_evaluated_fields
  ) {
    evidenceShortfalls.push("CARD_EXACT_MINIMUM_FIELD_COVERAGE_REQUIRED");
  }
  if (singleFieldPasses === null) {
    evidenceShortfalls.push("SINGLE_FIELD_CARD_EXACT_GUARD_REQUIRED");
  } else if (singleFieldPasses > 0) {
    evidenceShortfalls.push("SINGLE_FIELD_CARD_EXACT_PASS_FORBIDDEN");
  }
  if (eligibleCards === null || eligibleCards !== evaluatedCards) {
    evidenceShortfalls.push("CARD_EXACT_ELIGIBLE_COUNT_MISMATCH");
  }

  return {
    pass: evidenceShortfalls.length === 0,
    minimum_evaluated_fields_required: reportedMinimum,
    eligible_card_count: eligibleCards,
    single_field_card_exact_pass_count: singleFieldPasses,
    evidence_shortfall_reasons: evidenceShortfalls
  };
}

export function assessLaunchAccuracy(report = {}, thresholds = launchGateThresholds) {
  const failures = [];
  const evidenceShortfalls = [];
  const metric = report.metrics?.sem_card_exact_accuracy || {};
  const accuracy = finiteNumber(metric.rate);
  const evaluatedCards = finiteNumber(metric.total ?? report.summary?.evaluated_card_count) ?? 0;
  const holdout = cleanText(report.source?.partition).toLowerCase() === "holdout";
  const strictSchema = report.schema_version === goldenSemAccuracySchemaVersion;
  const explicitHumanTruthPolicy = report.source?.truth_policy_explicit === true
    && report.scope?.truth_policy_explicit === true
    && cleanText(report.source?.field_ground_truth_class).toUpperCase()
      === humanReviewedFieldGroundTruthClass;
  const reviewMetadataValid = report.validation?.formal_launch_ground_truth?.review_metadata?.ok === true;
  const formalLaunchGateEligible = report.formal_launch_gate_eligible === true
    && report.scope?.formal_launch_gate_eligible === true
    && report.scope?.launch_gate_eligible === true
    && report.source?.formal_launch_gate_eligible === true;
  const reviewedOnly = report.scope?.reviewed_ground_truth_only === true
    && report.scope?.writer_title_used_as_field_ground_truth === false;
  const releaseValidated = report.source?.release_set_validation_ok === true;
  const formalEvaluationCompleted = report.status === "COMPLETED";
  const cardExactCoverage = assessCardExactCoverage(report, evaluatedCards, thresholds);
  const criticalFieldCoverage = assessCriticalFieldCoverage(report, evaluatedCards, thresholds);

  if (!strictSchema) evidenceShortfalls.push("GOLDEN_SEM_ACCURACY_REPORT_REQUIRED");
  if (!holdout) evidenceShortfalls.push("CORE_HOLDOUT_ACCURACY_REQUIRED");
  if (!explicitHumanTruthPolicy) {
    evidenceShortfalls.push("EXPLICIT_HUMAN_REVIEWED_FIELD_GROUND_TRUTH_POLICY_REQUIRED");
  }
  if (!reviewedOnly) evidenceShortfalls.push("REVIEWED_FIELD_GROUND_TRUTH_REQUIRED");
  if (!reviewMetadataValid) evidenceShortfalls.push("REVIEWER_REVIEWED_AT_AND_FIELD_EVIDENCE_REQUIRED");
  if (!formalLaunchGateEligible) evidenceShortfalls.push("FORMAL_LAUNCH_GATE_ELIGIBILITY_REQUIRED");
  if (!formalEvaluationCompleted) evidenceShortfalls.push("FORMAL_GOLDEN_SEM_EVALUATION_NOT_COMPLETED");
  if (!releaseValidated) evidenceShortfalls.push("HOLDOUT_LEAKAGE_VALIDATION_REQUIRED");
  if (evaluatedCards < thresholds.minimum_sem_holdout_cards) evidenceShortfalls.push("SEM_HOLDOUT_SAMPLE_TOO_SMALL");
  if (accuracy === null) evidenceShortfalls.push("SEM_CARD_EXACT_ACCURACY_MISSING");
  evidenceShortfalls.push(...cardExactCoverage.evidence_shortfall_reasons);
  evidenceShortfalls.push(...criticalFieldCoverage.evidence_shortfall_reasons);
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
    target: thresholds.minimum_sem_card_exact_accuracy,
    excellent_target: thresholds.excellent_sem_card_exact_accuracy,
    minimum_holdout_cards: thresholds.minimum_sem_holdout_cards,
    formal_launch_gate_eligible: formalLaunchGateEligible,
    card_exact_evaluable_coverage: cardExactCoverage,
    critical_field_evaluable_coverage: criticalFieldCoverage,
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

export function assessLaunchBenchmark({
  accuracyReport = {},
  throughputReports = [],
  reliabilityReport = {},
  thresholds = launchGateThresholds,
  now = () => new Date()
} = {}) {
  const accuracy = assessLaunchAccuracy(accuracyReport, thresholds);
  const throughput = assessLaunchThroughput(throughputReports, thresholds);
  const reliability = assessLaunchReliability(reliabilityReport, thresholds);
  const dimensions = { accuracy, throughput, reliability };
  const failures = Object.entries(dimensions)
    .filter(([, value]) => value.verdict === "FAIL")
    .map(([key]) => key);
  const inconclusive = Object.entries(dimensions)
    .filter(([, value]) => value.verdict === "INCONCLUSIVE")
    .map(([key]) => key);
  const launchVerdict = failures.length ? "FAIL" : inconclusive.length ? "INCONCLUSIVE" : "PASS";
  return {
    schema_version: launchBenchmarkSchemaVersion,
    generated_at: now().toISOString(),
    phase: "LAUNCH_OPTIMIZATION",
    launch_verdict: launchVerdict,
    launch_ready: launchVerdict === "PASS",
    targets: thresholds,
    dimensions,
    failed_dimensions: failures,
    inconclusive_dimensions: inconclusive,
    next_bottleneck: failures[0] || inconclusive[0] || null,
    policy: {
      all_three_dimensions_must_pass: true,
      weak_seller_title_metrics_are_diagnostic_only: true,
      missing_evidence_never_passes: true,
      holdout_cannot_be_used_for_training_or_tuning: true
    }
  };
}
