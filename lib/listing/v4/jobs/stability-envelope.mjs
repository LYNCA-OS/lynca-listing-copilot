function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function ratio(numerator, denominator) {
  const top = finiteNumber(numerator);
  const bottom = finiteNumber(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return Number((top / bottom).toFixed(6));
}

function average(values = []) {
  const usable = values.map(finiteNumber).filter((value) => value !== null);
  if (!usable.length) return null;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(3));
}

function quantile(values = [], percentile = 0.5) {
  const usable = values.map(finiteNumber).filter((value) => value !== null).sort((a, b) => a - b);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  const position = Math.max(0, Math.min(1, percentile)) * (usable.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return usable[lower];
  const weight = position - lower;
  return Number((usable[lower] + (usable[upper] - usable[lower]) * weight).toFixed(3));
}

function coefficientOfVariation(values = []) {
  const usable = values.map(finiteNumber).filter((value) => value !== null);
  if (usable.length < 2) return null;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  if (mean <= 0) return null;
  const variance = usable.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / usable.length;
  return Number((Math.sqrt(variance) / mean).toFixed(6));
}

function jainFairness(values = []) {
  const usable = values.map(finiteNumber).filter((value) => value !== null && value >= 0);
  if (!usable.length) return null;
  const sum = usable.reduce((total, value) => total + value, 0);
  const squares = usable.reduce((total, value) => total + value ** 2, 0);
  if (squares === 0) return 1;
  return Number(((sum ** 2) / (usable.length * squares)).toFixed(6));
}

function terminalJobStatus(value) {
  return new Set(["L2_READY", "FAILED", "CANCELLED"]).has(cleanText(value).toUpperCase());
}

function tenantIdForRow(row = {}, waveIndex = 0) {
  return cleanText(row.tenant_id || row.tenantId || row.batch_id) || `wave-${waveIndex + 1}-unknown-tenant`;
}

function resultCompleted(row = {}) {
  return row.ok === true && row.writer_ready === true;
}

function resultTerminal(row = {}) {
  return terminalJobStatus(row.job_status) || resultCompleted(row);
}

function leaseRecoveryObserved(row = {}) {
  return (Array.isArray(row.retry_error_codes) ? row.retry_error_codes : [])
    .some((code) => /LEASE|RECLAIM|STALE_WORKER/i.test(String(code || "")));
}

function waveMetrics(report = {}, waveIndex = 0) {
  const results = Array.isArray(report.results) ? report.results : [];
  const summary = report.summary || {};
  const completed = results.filter(resultCompleted);
  const terminal = results.filter(resultTerminal);
  const queueWaitValues = results.map((row) => row.scheduler_queue_wait_ms ?? row.worker_queue_wait_ms);
  const writerReadyValues = completed.map((row) => row.time_to_writer_ready_ms);
  const activeRecognitionValues = completed.map((row) => row.writer_visible_recognition_ms);
  const measuredActiveRecognitionValues = activeRecognitionValues
    .map(finiteNumber)
    .filter((value) => value !== null);
  const attemptedCount = results.length || Number(summary.attempted_count || 0);
  const completedCount = completed.length || Number(summary.ok_count || 0);
  const runWallMs = finiteNumber(report.run_wall_ms ?? summary.run_wall_ms);
  const throughput = finiteNumber(summary.completed_cards_per_minute)
    ?? (runWallMs && completedCount > 0 ? Number((completedCount * 60000 / runWallMs).toFixed(3)) : null);
  const productionIntegrity = summary.production_integrity || {};
  const nodeLedger = summary.pipeline_node_observability || {};
  const evidenceCapacity = summary.evidence_stage_capacity || {};
  const positionFairness = summary.batch_position_fairness || {};
  const frontHalf = positionFairness.front_half || {};
  const backHalf = positionFairness.back_half || {};
  const positionDelta = positionFairness.back_minus_front || {};
  const sampleMode = cleanText(report.evaluation_sample_policy?.mode).toUpperCase();
  return {
    wave_id: cleanText(report.wave_id) || `wave-${waveIndex + 1}`,
    sample_mode: sampleMode || "UNSPECIFIED",
    fresh_sample: ["FRESH_GENERALIZATION", "CONCURRENCY_FRESH"].includes(sampleMode),
    attempted_count: attemptedCount,
    completed_count: completedCount,
    terminal_count: terminal.length,
    residual_backlog_count: Math.max(0, attemptedCount - terminal.length),
    technical_availability: ratio(completedCount, attemptedCount),
    run_wall_ms: runWallMs,
    completed_cards_per_minute: throughput,
    writer_ready_p50_ms: finiteNumber(summary.writer_ready_p50_ms) ?? quantile(writerReadyValues, 0.5),
    writer_ready_p95_ms: finiteNumber(summary.writer_ready_p95_ms) ?? quantile(writerReadyValues, 0.95),
    writer_ready_p99_ms: finiteNumber(summary.writer_ready_p99_ms) ?? quantile(writerReadyValues, 0.99),
    writer_visible_recognition_p50_ms: finiteNumber(summary.writer_visible_recognition_p50_ms)
      ?? quantile(activeRecognitionValues, 0.5),
    writer_visible_recognition_p95_ms: finiteNumber(summary.writer_visible_recognition_p95_ms)
      ?? quantile(activeRecognitionValues, 0.95),
    writer_visible_recognition_p99_ms: finiteNumber(summary.writer_visible_recognition_p99_ms)
      ?? quantile(activeRecognitionValues, 0.99),
    active_recognition_measured_count: measuredActiveRecognitionValues.length,
    active_recognition_measurement_rate: ratio(measuredActiveRecognitionValues.length, completedCount),
    recognition_start_source_breakdown: summary.recognition_start_source_breakdown || {},
    scheduler_queue_wait_p95_ms: finiteNumber(summary.scheduler_queue_wait_p95_ms) ?? quantile(queueWaitValues, 0.95),
    scheduler_queue_wait_max_ms: quantile(queueWaitValues, 1),
    retry_card_count: Number(summary.retry_card_count || results.filter((row) => Number(row.attempt_count || 0) > 1).length),
    lease_recovery_count: results.filter(leaseRecoveryObserved).length,
    duplicate_asset_id_count: Number(productionIntegrity.duplicate_asset_id_count || 0),
    duplicate_job_id_count: Number(productionIntegrity.duplicate_job_id_count || 0),
    missing_job_id_count: Number(productionIntegrity.missing_job_id_count || 0),
    successful_nonterminal_job_count: Number(productionIntegrity.successful_nonterminal_job_count || 0),
    provider_capacity_release_missing_count: Number(productionIntegrity.provider_capacity_release_missing_count || 0),
    provider_capacity_refill_missing_count: Number(productionIntegrity.provider_capacity_refill_missing_count || 0),
    catalog_stage_capacity_release_missing_count: Number(evidenceCapacity.catalog?.release_missing_count || 0),
    vector_stage_capacity_release_missing_count: Number(evidenceCapacity.vector?.release_missing_count || 0),
    ocr_timeout_count: Number(summary.preingestion_ocr?.timeout_count || 0),
    ocr_worker_timeout_count: Number(summary.preingestion_ocr?.worker_timeout_count || 0),
    front_half_card_count: Number(frontHalf.attempted_count || 0),
    back_half_card_count: Number(backHalf.attempted_count || 0),
    back_minus_front_technical_success_rate: finiteNumber(positionDelta.technical_success_rate),
    front_half_ocr_attempted_count: Number(frontHalf.ocr_attempted_count || 0),
    back_half_ocr_attempted_count: Number(backHalf.ocr_attempted_count || 0),
    back_minus_front_ocr_terminal_rate: finiteNumber(positionDelta.ocr_terminal_rate),
    front_half_grade_ocr_card_count: Number(frontHalf.grade_ocr_card_count || 0),
    back_half_grade_ocr_card_count: Number(backHalf.grade_ocr_card_count || 0),
    back_minus_front_grade_ocr_succeeded_rate: finiteNumber(positionDelta.grade_ocr_succeeded_rate),
    front_half_grade_reference_expected_count: Number(frontHalf.grade_reference_expected_count || 0),
    back_half_grade_reference_expected_count: Number(backHalf.grade_reference_expected_count || 0),
    back_minus_front_grade_reference_preservation_rate: finiteNumber(positionDelta.grade_reference_preservation_rate),
    grade_reference_omission_count: Number(summary.preingestion_ocr?.grade_reference_omission_count || 0),
    node_ledger_missing_count: Number(nodeLedger.ledger_missing_count || 0),
    node_transport_error_count: Number(nodeLedger.transport_error_count || 0),
    batch_status_transient_error_count: Number(report.batch_poll_metrics?.transient_error_count || 0),
    batch_status_fatal_error: Boolean(report.batch_poll_metrics?.fatal_error),
    tenant_ids: [...new Set(results.map((row) => tenantIdForRow(row, waveIndex)))],
    asset_ids: results.map((row) => cleanText(row.asset_id)).filter(Boolean)
  };
}

function tenantMetrics(reports = []) {
  const tenants = new Map();
  reports.forEach((report, waveIndex) => {
    for (const row of Array.isArray(report.results) ? report.results : []) {
      const tenantId = tenantIdForRow(row, waveIndex);
      const current = tenants.get(tenantId) || {
        tenant_id: tenantId,
        assigned_count: 0,
        completed_count: 0,
        queue_wait_values: [],
        writer_ready_values: [],
        active_recognition_values: [],
        wave_ids: new Set()
      };
      current.assigned_count += 1;
      if (resultCompleted(row)) current.completed_count += 1;
      const queueWait = finiteNumber(row.scheduler_queue_wait_ms ?? row.worker_queue_wait_ms);
      const writerReady = finiteNumber(row.time_to_writer_ready_ms);
      const activeRecognition = finiteNumber(row.writer_visible_recognition_ms);
      if (queueWait !== null) current.queue_wait_values.push(queueWait);
      if (writerReady !== null) current.writer_ready_values.push(writerReady);
      if (activeRecognition !== null) current.active_recognition_values.push(activeRecognition);
      current.wave_ids.add(cleanText(report.wave_id) || `wave-${waveIndex + 1}`);
      tenants.set(tenantId, current);
    }
  });
  return [...tenants.values()].map((tenant) => ({
    tenant_id: tenant.tenant_id,
    assigned_count: tenant.assigned_count,
    completed_count: tenant.completed_count,
    completion_rate: ratio(tenant.completed_count, tenant.assigned_count),
    queue_wait_p50_ms: quantile(tenant.queue_wait_values, 0.5),
    queue_wait_p95_ms: quantile(tenant.queue_wait_values, 0.95),
    queue_wait_max_ms: quantile(tenant.queue_wait_values, 1),
    writer_ready_p95_ms: quantile(tenant.writer_ready_values, 0.95),
    writer_visible_recognition_p95_ms: quantile(tenant.active_recognition_values, 0.95),
    active_recognition_measured_count: tenant.active_recognition_values.length,
    active_recognition_measurement_rate: ratio(tenant.active_recognition_values.length, tenant.completed_count),
    wave_count: tenant.wave_ids.size
  })).sort((left, right) => left.tenant_id.localeCompare(right.tenant_id));
}

function sumField(rows = [], field) {
  return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

export function analyzeV4StabilityEnvelope(reports = [], {
  minimumWaves = 3,
  minimumCards = 50,
  minimumTenants = 3,
  minimumTechnicalAvailability = 1,
  maximumWriterP95Ms = 120_000,
  maximumQueueWaitMs = 180_000,
  maximumTenantQueueP95SpreadMs = 60_000,
  minimumTenantCompletionFairness = 0.95,
  maximumRecoveredRetryRate = 0.05,
  maximumLeaseRecoveryRate = 0.02,
  maximumThroughputCv = 0.25,
  maximumWriterP95Cv = 0.35,
  maximumLastWaveP95Regression = 0.5,
  minimumPositionCohortCards = 3,
  maximumBackHalfOcrTerminalDrop = 0.15,
  maximumBackHalfGradeOcrDrop = 0.15,
  maximumBackHalfGradePreservationDrop = 0.2,
  minimumActiveRecognitionMeasurementRate = 1,
  requireFreshSamples = true
} = {}) {
  const usableReports = (Array.isArray(reports) ? reports : []).filter(Boolean);
  const waves = usableReports.map(waveMetrics);
  const tenants = tenantMetrics(usableReports);
  const assetIds = waves.flatMap((wave) => wave.asset_ids);
  const uniqueAssetIds = new Set(assetIds);
  const attemptedCount = sumField(waves, "attempted_count");
  const completedCount = sumField(waves, "completed_count");
  const technicalAvailability = ratio(completedCount, attemptedCount);
  const tenantCompletionFairness = jainFairness(tenants.map((tenant) => tenant.completion_rate));
  const tenantQueueP95Values = tenants.map((tenant) => tenant.queue_wait_p95_ms).filter((value) => value !== null);
  const retryCardCount = sumField(waves, "retry_card_count");
  const leaseRecoveryCount = sumField(waves, "lease_recovery_count");
  const recoveredRetryRate = ratio(retryCardCount, attemptedCount);
  const leaseRecoveryRate = ratio(leaseRecoveryCount, attemptedCount);
  const throughputCv = coefficientOfVariation(waves.map((wave) => wave.completed_cards_per_minute));
  const writerP95Cv = coefficientOfVariation(waves.map((wave) => wave.writer_ready_p95_ms));
  const firstWriterP95 = waves[0]?.writer_ready_p95_ms ?? null;
  const lastWriterP95 = waves.at(-1)?.writer_ready_p95_ms ?? null;
  const lastWaveP95Regression = firstWriterP95 && lastWriterP95
    ? Number(((lastWriterP95 - firstWriterP95) / firstWriterP95).toFixed(6))
    : null;
  const writerP95 = quantile(usableReports.flatMap((report) => (
    Array.isArray(report.results)
      ? report.results.filter(resultCompleted).map((row) => row.time_to_writer_ready_ms)
      : []
  )), 0.95) ?? quantile(waves.map((wave) => wave.writer_ready_p95_ms), 0.95);
  const activeRecognitionValues = usableReports.flatMap((report) => (
    Array.isArray(report.results)
      ? report.results.filter(resultCompleted).map((row) => row.writer_visible_recognition_ms)
      : []
  ));
  const activeRecognitionP50 = quantile(activeRecognitionValues, 0.5)
    ?? quantile(waves.map((wave) => wave.writer_visible_recognition_p50_ms), 0.5);
  const activeRecognitionP95 = quantile(activeRecognitionValues, 0.95)
    ?? quantile(waves.map((wave) => wave.writer_visible_recognition_p95_ms), 0.95);
  const activeRecognitionP99 = quantile(activeRecognitionValues, 0.99)
    ?? quantile(waves.map((wave) => wave.writer_visible_recognition_p99_ms), 0.99);
  const activeRecognitionMeasuredCount = activeRecognitionValues
    .map(finiteNumber)
    .filter((value) => value !== null).length;
  const queueWaitMax = quantile(waves.map((wave) => wave.scheduler_queue_wait_max_ms), 1);
  const evidenceShortfallReasons = [];
  const runtimeRejectionReasons = [];
  const warningReasons = [];

  if (waves.length < minimumWaves) evidenceShortfallReasons.push("STABILITY_WAVE_COUNT_TOO_SMALL");
  if (attemptedCount < minimumCards) evidenceShortfallReasons.push("STABILITY_SAMPLE_TOO_SMALL");
  if (tenants.length < minimumTenants) evidenceShortfallReasons.push("MULTI_TENANT_EVIDENCE_MISSING");
  if (requireFreshSamples && waves.some((wave) => !wave.fresh_sample)) evidenceShortfallReasons.push("FRESH_SAMPLE_POLICY_NOT_PROVEN");
  if (assetIds.length !== uniqueAssetIds.size) evidenceShortfallReasons.push("CROSS_WAVE_SAMPLE_REUSE");
  if (technicalAvailability === null || technicalAvailability < minimumTechnicalAvailability) runtimeRejectionReasons.push("TECHNICAL_AVAILABILITY_BELOW_TARGET");
  if (sumField(waves, "residual_backlog_count") > 0) runtimeRejectionReasons.push("QUEUE_DID_NOT_DRAIN");
  if (queueWaitMax !== null && queueWaitMax > maximumQueueWaitMs) runtimeRejectionReasons.push("QUEUE_STARVATION_DETECTED");
  if (writerP95 === null || writerP95 > maximumWriterP95Ms) runtimeRejectionReasons.push("WRITER_P95_ABOVE_BUDGET");
  if (tenantCompletionFairness === null || tenantCompletionFairness < minimumTenantCompletionFairness) runtimeRejectionReasons.push("TENANT_COMPLETION_FAIRNESS_BELOW_TARGET");
  if (recoveredRetryRate !== null && recoveredRetryRate > maximumRecoveredRetryRate) runtimeRejectionReasons.push("RECOVERED_RETRY_RATE_ABOVE_TARGET");
  if (leaseRecoveryRate !== null && leaseRecoveryRate > maximumLeaseRecoveryRate) runtimeRejectionReasons.push("LEASE_RECOVERY_RATE_ABOVE_TARGET");
  if (throughputCv !== null && throughputCv > maximumThroughputCv) runtimeRejectionReasons.push("THROUGHPUT_UNSTABLE_ACROSS_WAVES");
  if (writerP95Cv !== null && writerP95Cv > maximumWriterP95Cv) runtimeRejectionReasons.push("WRITER_TAIL_UNSTABLE_ACROSS_WAVES");
  if (lastWaveP95Regression !== null && lastWaveP95Regression > maximumLastWaveP95Regression) runtimeRejectionReasons.push("TAIL_LATENCY_DEGRADES_OVER_TIME");
  const activeRecognitionMeasurementRate = ratio(activeRecognitionMeasuredCount, completedCount);
  if (activeRecognitionMeasurementRate === null
    || activeRecognitionMeasurementRate < minimumActiveRecognitionMeasurementRate) {
    runtimeRejectionReasons.push("ACTIVE_RECOGNITION_TIMING_INCOMPLETE");
  }

  for (const wave of waves) {
    if (wave.front_half_card_count >= minimumPositionCohortCards
      && wave.back_half_card_count >= minimumPositionCohortCards
      && wave.back_minus_front_technical_success_rate !== null
      && wave.back_minus_front_technical_success_rate < 0) {
      runtimeRejectionReasons.push("BACK_HALF_TECHNICAL_SUCCESS_REGRESSION");
    }
    if (wave.front_half_ocr_attempted_count >= minimumPositionCohortCards
      && wave.back_half_ocr_attempted_count >= minimumPositionCohortCards
      && wave.back_minus_front_ocr_terminal_rate !== null
      && wave.back_minus_front_ocr_terminal_rate < -maximumBackHalfOcrTerminalDrop) {
      runtimeRejectionReasons.push("BACK_HALF_OCR_TERMINAL_REGRESSION");
    }
    if (wave.front_half_grade_ocr_card_count >= minimumPositionCohortCards
      && wave.back_half_grade_ocr_card_count >= minimumPositionCohortCards
      && wave.back_minus_front_grade_ocr_succeeded_rate !== null
      && wave.back_minus_front_grade_ocr_succeeded_rate < -maximumBackHalfGradeOcrDrop) {
      runtimeRejectionReasons.push("BACK_HALF_GRADE_OCR_REGRESSION");
    }
    if (wave.front_half_grade_reference_expected_count >= minimumPositionCohortCards
      && wave.back_half_grade_reference_expected_count >= minimumPositionCohortCards
      && wave.back_minus_front_grade_reference_preservation_rate !== null
      && wave.back_minus_front_grade_reference_preservation_rate < -maximumBackHalfGradePreservationDrop) {
      runtimeRejectionReasons.push("BACK_HALF_GRADE_PRESERVATION_REGRESSION");
    }
  }

  const strictZeroFields = [
    ["duplicate_asset_id_count", "DUPLICATE_ASSET_RESULT"],
    ["duplicate_job_id_count", "DUPLICATE_QUEUE_JOB"],
    ["missing_job_id_count", "QUEUE_JOB_ID_MISSING"],
    ["successful_nonterminal_job_count", "SUCCESSFUL_JOB_NOT_TERMINAL"],
    ["provider_capacity_release_missing_count", "PROVIDER_CAPACITY_RELEASE_MISSING"],
    ["provider_capacity_refill_missing_count", "PROVIDER_CAPACITY_REFILL_MISSING"],
    ["catalog_stage_capacity_release_missing_count", "CATALOG_STAGE_CAPACITY_RELEASE_MISSING"],
    ["vector_stage_capacity_release_missing_count", "VECTOR_STAGE_CAPACITY_RELEASE_MISSING"],
    ["ocr_worker_timeout_count", "OCR_WORKER_TIMEOUT_PRESENT"],
    ["node_ledger_missing_count", "NODE_LEDGER_INCOMPLETE"],
    ["node_transport_error_count", "NODE_RECONCILIATION_ERROR"]
  ];
  for (const [field, reason] of strictZeroFields) {
    if (sumField(waves, field) > 0) runtimeRejectionReasons.push(reason);
  }
  if (waves.some((wave) => wave.batch_status_fatal_error)) runtimeRejectionReasons.push("STATUS_CONTROL_PLANE_FATAL_ERROR");
  if (sumField(waves, "batch_status_transient_error_count") > 0) warningReasons.push("RECOVERED_STATUS_CONTROL_PLANE_TRANSIENT");
  if (sumField(waves, "ocr_timeout_count") > 0) warningReasons.push("OCR_RENDEZVOUS_BUDGET_EXPIRED");
  const tenantQueueSpreadMs = tenantQueueP95Values.length
    ? Math.max(...tenantQueueP95Values) - Math.min(...tenantQueueP95Values)
    : null;
  if (tenantQueueSpreadMs !== null && tenantQueueSpreadMs > maximumTenantQueueP95SpreadMs) runtimeRejectionReasons.push("TENANT_QUEUE_WAIT_SPREAD_ABOVE_TARGET");
  if (retryCardCount > 0) warningReasons.push("RECOVERED_RETRY_OBSERVED");
  if (leaseRecoveryCount > 0) warningReasons.push("LEASE_RECOVERY_OBSERVED");
  if (sumField(waves, "grade_reference_omission_count") > 0) warningReasons.push("GRADE_REFERENCE_OMISSION_OBSERVED");
  const uniqueEvidenceShortfalls = [...new Set(evidenceShortfallReasons)];
  const uniqueRuntimeRejections = [...new Set(runtimeRejectionReasons)];
  const verdict = uniqueRuntimeRejections.length
    ? "FAIL"
    : uniqueEvidenceShortfalls.length
      ? "INCONCLUSIVE"
      : "PASS";
  const rejectionReasons = [...uniqueRuntimeRejections, ...uniqueEvidenceShortfalls];

  return {
    schema_version: "v4-stability-envelope-v1",
    generated_at: new Date().toISOString(),
    pass: verdict === "PASS",
    verdict,
    targets: {
      minimum_waves: minimumWaves,
      minimum_cards: minimumCards,
      minimum_tenants: minimumTenants,
      minimum_technical_availability: minimumTechnicalAvailability,
      maximum_writer_p95_ms: maximumWriterP95Ms,
      maximum_queue_wait_ms: maximumQueueWaitMs,
      maximum_tenant_queue_p95_spread_ms: maximumTenantQueueP95SpreadMs,
      minimum_tenant_completion_fairness: minimumTenantCompletionFairness,
      maximum_recovered_retry_rate: maximumRecoveredRetryRate,
      maximum_lease_recovery_rate: maximumLeaseRecoveryRate,
      maximum_throughput_cv: maximumThroughputCv,
      maximum_writer_p95_cv: maximumWriterP95Cv,
      maximum_last_wave_p95_regression: maximumLastWaveP95Regression,
      minimum_position_cohort_cards: minimumPositionCohortCards,
      maximum_back_half_ocr_terminal_drop: maximumBackHalfOcrTerminalDrop,
      maximum_back_half_grade_ocr_drop: maximumBackHalfGradeOcrDrop,
      maximum_back_half_grade_preservation_drop: maximumBackHalfGradePreservationDrop,
      minimum_active_recognition_measurement_rate: minimumActiveRecognitionMeasurementRate,
      fresh_samples_required: requireFreshSamples
    },
    aggregate: {
      wave_count: waves.length,
      attempted_count: attemptedCount,
      completed_count: completedCount,
      terminal_count: sumField(waves, "terminal_count"),
      residual_backlog_count: sumField(waves, "residual_backlog_count"),
      technical_availability: technicalAvailability,
      unique_asset_count: uniqueAssetIds.size,
      duplicate_asset_count: assetIds.length - uniqueAssetIds.size,
      tenant_count: tenants.length,
      tenant_completion_fairness: tenantCompletionFairness,
      tenant_queue_p95_spread_ms: tenantQueueSpreadMs,
      writer_ready_p95_ms: writerP95,
      writer_visible_recognition_p50_ms: activeRecognitionP50,
      writer_visible_recognition_p95_ms: activeRecognitionP95,
      writer_visible_recognition_p99_ms: activeRecognitionP99,
      active_recognition_measured_count: activeRecognitionMeasuredCount,
      active_recognition_measurement_rate: activeRecognitionMeasurementRate,
      scheduler_queue_wait_max_ms: queueWaitMax,
      throughput_cv: throughputCv,
      writer_p95_cv: writerP95Cv,
      first_wave_writer_p95_ms: firstWriterP95,
      last_wave_writer_p95_ms: lastWriterP95,
      last_wave_p95_regression: lastWaveP95Regression,
      retry_card_count: retryCardCount,
      recovered_retry_rate: recoveredRetryRate,
      lease_recovery_count: leaseRecoveryCount,
      lease_recovery_rate: leaseRecoveryRate,
      capacity_release_leak_count: sumField(waves, "provider_capacity_release_missing_count")
        + sumField(waves, "catalog_stage_capacity_release_missing_count")
        + sumField(waves, "vector_stage_capacity_release_missing_count"),
      node_ledger_missing_count: sumField(waves, "node_ledger_missing_count"),
      node_transport_error_count: sumField(waves, "node_transport_error_count"),
      grade_reference_omission_count: sumField(waves, "grade_reference_omission_count")
    },
    waves: waves.map(({ asset_ids: ignored, ...wave }) => wave),
    tenants,
    rejection_reasons: rejectionReasons,
    runtime_rejection_reasons: uniqueRuntimeRejections,
    evidence_shortfall_reasons: uniqueEvidenceShortfalls,
    warning_reasons: [...new Set(warningReasons)]
  };
}
