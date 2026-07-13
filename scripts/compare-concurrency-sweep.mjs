import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function ratio(numerator, denominator) {
  const top = numberOrNull(numerator);
  const bottom = numberOrNull(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return Number((top / bottom).toFixed(6));
}

function percentChange(current, previous) {
  const next = numberOrNull(current);
  const base = numberOrNull(previous);
  if (next === null || base === null || base <= 0) return null;
  return Number(((next - base) / base).toFixed(6));
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export function parseReportArgs(argv = []) {
  return argv
    .filter((arg) => arg.startsWith("--report="))
    .map((arg) => arg.slice("--report=".length))
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) throw new Error(`Invalid --report value: ${entry}. Expected concurrency:path.`);
      return {
        concurrency: Number(entry.slice(0, separator)),
        path: entry.slice(separator + 1)
      };
    })
    .filter((entry) => Number.isFinite(entry.concurrency) && entry.concurrency > 0 && entry.path);
}

function nodeMetric(summary = {}, nodeId = "") {
  return (summary.pipeline_node_observability?.node_metrics || [])
    .find((node) => node.node_id === nodeId) || null;
}

const NON_CRITICAL_PATH_NODE_IDS = new Set([
  "job_enqueue",
  "scheduler_queue",
  "worker_execution",
  "writer_ready",
  "production_observability_persistence",
  "client_image_prepare",
  "client_image_upload",
  "client_request_prepare",
  "client_preingestion_build",
  "client_fast_scout_prewarm",
  "client_speculative_recognition"
]);

function bottleneckNode(summary = {}) {
  return (summary.pipeline_node_observability?.node_metrics || [])
    .filter((node) => !NON_CRITICAL_PATH_NODE_IDS.has(node.node_id))
    .filter((node) => numberOrNull(node.duration_p95_ms) !== null)
    .sort((left, right) => numberOrZero(right.duration_p95_ms) - numberOrZero(left.duration_p95_ms))[0] || null;
}

function minimumHeadroomRatio(results = [], remainingKey = "", limitKey = "") {
  const ratios = results.map((row) => {
    const remaining = numberOrNull(row[remainingKey] ?? row.provider_diagnostics?.[remainingKey]);
    const limit = numberOrNull(row[limitKey] ?? row.provider_diagnostics?.[limitKey]);
    if (remaining === null || limit === null || limit <= 0) return null;
    return Math.max(0, remaining / limit);
  }).filter((value) => value !== null);
  return ratios.length ? Number(Math.min(...ratios).toFixed(6)) : null;
}

function keySlotDistribution(results = []) {
  const counts = new Map();
  for (const row of results) {
    const slot = numberOrNull(row.provider_key_slot ?? row.provider_diagnostics?.provider_key_slot);
    if (slot === null) continue;
    const key = String(slot);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => Number(left) - Number(right)));
}

function distributionImbalance(distribution = {}) {
  const counts = Object.values(distribution).map(Number).filter((value) => Number.isFinite(value));
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (counts.length < 2 || total <= 0) return null;
  return Number(((Math.max(...counts) - Math.min(...counts)) / total).toFixed(6));
}

function resultErrorText(results = []) {
  return results.map((row) => [
    row.error,
    row.error_code,
    row.provider_error_type,
    row.provider_response_status,
    row.job_status
  ].map(normalizeText).filter(Boolean).join(" ")).join(" ").toLowerCase();
}

function sampleSignature(report = {}, attemptedCount = 0) {
  return [
    normalizeText(report.dataset_path),
    Number(report.offset || 0),
    Number(report.limit || attemptedCount || 0)
  ].join("|");
}

export function metricRow(report = {}, path = "", concurrencyOverride = null) {
  const summary = report.summary && typeof report.summary === "object" ? report.summary : report;
  const results = Array.isArray(report.results) ? report.results : [];
  const accuracy = summary.final_accuracy_proxy || {};
  const provider = summary.provider_diagnostics || summary.usage_totals || {};
  const nodeSummary = summary.pipeline_node_observability || {};
  const integrity = summary.production_integrity || null;
  const attemptedCount = numberOrZero(summary.attempted_count);
  const okCount = numberOrZero(summary.ok_count ?? summary.provider_success_count);
  const policyPass72 = numberOrZero(accuracy.policy_fair_pass_at_0_72 ?? summary.pass_at_0_72_count);
  const policyPass80 = numberOrZero(accuracy.policy_fair_pass_at_0_80 ?? summary.pass_at_0_80_count);
  const errorText = resultErrorText(results);
  const providerErrorCount = numberOrZero(summary.provider_error_count)
    || results.filter((row) => row.ok !== true && /provider|openai|model/i.test(normalizeText(row.error))).length;
  const technicalFailureCount = numberOrZero(summary.technical_failure_count);
  const retryCardCount = numberOrZero(summary.retry_card_count ?? summary.provider_error_retry_count);
  const retryAttemptCount = numberOrZero(summary.retry_attempt_count);
  const providerRotationCount = numberOrZero(provider.key_rotation_card_count)
    || results.filter((row) => row.provider_key_rotation_attempted === true).length;
  const resumedBatch = Boolean(normalizeText(report.resumed_batch_id));
  const completedPerMinute = resumedBatch
    ? null
    : numberOrNull(summary.completed_cards_per_minute
      ?? summary.evaluated_cards_per_minute
      ?? summary.attempted_cards_per_minute);
  const writerP50 = numberOrNull(summary.writer_ready_p50_ms ?? summary.per_card_latency_ms?.p50);
  const writerP95 = numberOrNull(summary.writer_ready_p95_ms ?? summary.per_card_latency_ms?.p95);
  const postObservationDeadlineNode = nodeMetric(summary, "post_observation_retrieval_deadline");
  const bottleneck = bottleneckNode(summary);
  const slotDistribution = keySlotDistribution(results);
  const row = {
    path,
    schema_version: normalizeText(report.schema_version) || null,
    concurrency: numberOrNull(concurrencyOverride ?? report.concurrency ?? report.configured_concurrency) || 0,
    resumed_batch: resumedBatch,
    throughput_measurement_valid: !resumedBatch,
    sample_signature: sampleSignature(report, attemptedCount),
    dataset_path: normalizeText(report.dataset_path) || null,
    offset: numberOrZero(report.offset),
    limit: numberOrZero(report.limit || attemptedCount),
    attempted_count: attemptedCount,
    ok_count: okCount,
    provider_success_count: numberOrZero(summary.provider_success_count ?? okCount),
    provider_error_count: providerErrorCount,
    technical_failure_count: technicalFailureCount,
    production_integrity_reported: Boolean(integrity),
    duplicate_asset_id_count: numberOrZero(integrity?.duplicate_asset_id_count),
    duplicate_job_id_count: numberOrZero(integrity?.duplicate_job_id_count),
    missing_job_id_count: numberOrZero(integrity?.missing_job_id_count),
    successful_nonterminal_job_count: numberOrZero(integrity?.successful_nonterminal_job_count),
    provider_capacity_release_missing_count: numberOrZero(integrity?.provider_capacity_release_missing_count),
    provider_capacity_refill_missing_count: numberOrZero(integrity?.provider_capacity_refill_missing_count),
    provider_done_handoff_requested: report.provider_done_capacity_handoff_override === true,
    retry_card_count: retryCardCount,
    retry_attempt_count: retryAttemptCount,
    retry_error_code_breakdown: summary.retry_error_code_breakdown || {},
    completion_write_retry_count: numberOrZero(summary.completion_write_retry_count),
    completion_payload_sanitized_nul_count: numberOrZero(summary.completion_payload_sanitized_nul_count),
    provider_key_rotation_card_count: providerRotationCount,
    http_429_count: (errorText.match(/(?:http\s*)?429|rate[_ -]?limit/g) || []).length,
    timeout_error_count: (errorText.match(/time(?:d)?\s*out|timeout/g) || []).length,
    batch_status_transient_error_count: numberOrZero(report.batch_poll_metrics?.transient_error_count),
    batch_status_fatal_error: normalizeText(report.batch_poll_metrics?.fatal_error) || null,
    raw_title_token_recall_avg: numberOrNull(accuracy.raw_token_recall_avg ?? summary.raw_corrected_title_token_recall_avg),
    fair_title_token_recall_avg: numberOrNull(accuracy.fair_token_recall_avg ?? summary.reviewed_title_token_recall_avg ?? summary.corrected_title_token_recall_avg),
    policy_fair_title_token_recall_avg: numberOrNull(accuracy.policy_fair_token_recall_avg),
    pass_at_0_72_count: policyPass72,
    pass_at_0_80_count: policyPass80,
    pass_at_0_72_rate: ratio(policyPass72, attemptedCount),
    pass_at_0_80_rate: ratio(policyPass80, attemptedCount),
    completed_cards_per_minute: completedPerMinute,
    policy_adjusted_cards_per_minute: completedPerMinute === null
      ? null
      : Number((completedPerMinute * (ratio(policyPass72, attemptedCount) ?? 1)).toFixed(6)),
    run_wall_ms: numberOrNull(report.run_wall_ms ?? summary.run_wall_ms),
    writer_ready_p50_ms: writerP50,
    writer_ready_p95_ms: writerP95,
    writer_ready_p99_ms: numberOrNull(summary.writer_ready_p99_ms),
    scheduler_queue_wait_p50_ms: numberOrNull(summary.scheduler_queue_wait_p50_ms ?? summary.worker_queue_wait_p50_ms),
    scheduler_queue_wait_p95_ms: numberOrNull(summary.scheduler_queue_wait_p95_ms ?? summary.worker_queue_wait_p95_ms),
    worker_processing_p50_ms: numberOrNull(summary.worker_processing_p50_ms),
    worker_processing_p95_ms: numberOrNull(summary.worker_processing_p95_ms),
    provider_latency_p50_ms: numberOrNull(provider.provider_latency_p50_ms),
    provider_latency_p95_ms: numberOrNull(provider.provider_latency_p95_ms),
    catalog_retrieval_p50_ms: numberOrNull(nodeMetric(summary, "catalog_retrieval")?.duration_p50_ms),
    catalog_retrieval_p95_ms: numberOrNull(nodeMetric(summary, "catalog_retrieval")?.duration_p95_ms),
    vector_retrieval_p50_ms: numberOrNull(nodeMetric(summary, "vector_retrieval")?.duration_p50_ms),
    vector_retrieval_p95_ms: numberOrNull(nodeMetric(summary, "vector_retrieval")?.duration_p95_ms),
    post_observation_retrieval_deadline_p50_ms: numberOrNull(postObservationDeadlineNode?.duration_p50_ms),
    post_observation_retrieval_deadline_p95_ms: numberOrNull(postObservationDeadlineNode?.duration_p95_ms),
    post_observation_retrieval_deferred_card_count: numberOrZero(postObservationDeadlineNode?.status_breakdown?.PARTIAL),
    post_observation_retrieval_completed_within_budget_count: numberOrZero(postObservationDeadlineNode?.output_count_total),
    ocr_elapsed_since_preingestion_p50_ms: numberOrNull(summary.preingestion_ocr?.elapsed_since_preingestion_p50_ms),
    ocr_elapsed_since_preingestion_p95_ms: numberOrNull(summary.preingestion_ocr?.elapsed_since_preingestion_p95_ms),
    ocr_critical_path_wait_p50_ms: numberOrNull(summary.preingestion_ocr?.critical_path_wait_p50_ms),
    ocr_critical_path_wait_p95_ms: numberOrNull(summary.preingestion_ocr?.critical_path_wait_p95_ms),
    ocr_timeout_count: numberOrZero(summary.preingestion_ocr?.timeout_count),
    ocr_worker_timeout_count: numberOrZero(summary.preingestion_ocr?.worker_timeout_count),
    ocr_stage_capacity_control_observed_count: numberOrZero(summary.preingestion_ocr?.stage_capacity_control_enabled_count),
    ocr_stage_global_capacity: numberOrNull(summary.preingestion_ocr?.stage_global_capacity_latest),
    ocr_stage_capacity_wait_p50_ms: numberOrNull(summary.preingestion_ocr?.stage_capacity_wait_p50_ms),
    ocr_stage_capacity_wait_p95_ms: numberOrNull(summary.preingestion_ocr?.stage_capacity_wait_p95_ms),
    ocr_stage_capacity_deferred_count: numberOrZero(summary.preingestion_ocr?.stage_capacity_deferred_count),
    ocr_peak_local_active_p95: numberOrNull(summary.preingestion_ocr?.peak_local_active_p95),
    catalog_stage_capacity_control_observed_count: numberOrZero(summary.evidence_stage_capacity?.catalog?.controlled_count),
    catalog_stage_capacity_acquired_count: numberOrZero(summary.evidence_stage_capacity?.catalog?.acquired_count),
    catalog_stage_capacity_deferred_count: numberOrZero(summary.evidence_stage_capacity?.catalog?.deferred_count),
    catalog_stage_capacity_release_missing_count: numberOrZero(summary.evidence_stage_capacity?.catalog?.release_missing_count),
    catalog_stage_capacity_wait_p50_ms: numberOrNull(summary.evidence_stage_capacity?.catalog?.wait_p50_ms),
    catalog_stage_capacity_wait_p95_ms: numberOrNull(summary.evidence_stage_capacity?.catalog?.wait_p95_ms),
    vector_stage_capacity_control_observed_count: numberOrZero(summary.evidence_stage_capacity?.vector?.controlled_count),
    vector_stage_capacity_acquired_count: numberOrZero(summary.evidence_stage_capacity?.vector?.acquired_count),
    vector_stage_capacity_deferred_count: numberOrZero(summary.evidence_stage_capacity?.vector?.deferred_count),
    vector_stage_capacity_release_missing_count: numberOrZero(summary.evidence_stage_capacity?.vector?.release_missing_count),
    vector_stage_capacity_wait_p50_ms: numberOrNull(summary.evidence_stage_capacity?.vector?.wait_p50_ms),
    vector_stage_capacity_wait_p95_ms: numberOrNull(summary.evidence_stage_capacity?.vector?.wait_p95_ms),
    input_tokens: numberOrNull(provider.input_tokens_total ?? provider.input_tokens),
    output_tokens: numberOrNull(provider.output_tokens_total ?? provider.output_tokens),
    total_tokens: numberOrNull(provider.total_tokens_total ?? provider.total_tokens),
    key_pool_size: numberOrNull(provider.key_pool_size_latest),
    key_slots_used: Array.isArray(provider.key_slots_used) ? provider.key_slots_used : [],
    latest_remaining_requests: numberOrNull(provider.latest_remaining_requests),
    latest_remaining_tokens: numberOrNull(provider.latest_remaining_tokens),
    request_headroom_min_ratio: minimumHeadroomRatio(
      results,
      "x-ratelimit-remaining-requests",
      "x-ratelimit-limit-requests"
    ),
    token_headroom_min_ratio: minimumHeadroomRatio(
      results,
      "x-ratelimit-remaining-tokens",
      "x-ratelimit-limit-tokens"
    ),
    provider_key_slot_distribution: slotDistribution,
    provider_key_slot_imbalance: distributionImbalance(slotDistribution),
    bottleneck_node_id: bottleneck?.node_id || null,
    bottleneck_node_p95_ms: numberOrNull(bottleneck?.duration_p95_ms),
    node_ledger_present_count: numberOrZero(nodeSummary.ledger_present_count),
    node_ledger_missing_count: numberOrZero(nodeSummary.ledger_missing_count),
    node_error_count: numberOrZero(nodeSummary.error_count),
    node_transport_error_count: numberOrZero(nodeSummary.transport_error_count),
    node_field_quality_error_count: numberOrZero(nodeSummary.field_quality_error_count),
    node_warning_count: numberOrZero(nodeSummary.warning_count),
    node_missing_required_count: numberOrZero(nodeSummary.missing_required_node_count),
    catalog_raw_candidate_count: numberOrZero(summary.l2_catalog_raw_candidate_count),
    catalog_prompt_candidate_count: numberOrZero(summary.l2_catalog_prompt_candidate_count ?? summary.catalog_prompt_candidate_count),
    vector_raw_candidate_count: numberOrZero(summary.l2_vector_raw_candidate_count),
    vector_prompt_candidate_count: numberOrZero(summary.l2_vector_prompt_candidate_count ?? summary.vector_prompt_candidate_count),
    vector_runtime_unavailable_count: numberOrZero(summary.vector_runtime_status_breakdown?.UNAVAILABLE),
    copied_serial_grade_cert_from_reference_count: numberOrZero(summary.copied_serial_grade_cert_from_reference_count),
    base_pollution_count: numberOrZero(summary.base_without_catalog_support_count)
      + numberOrZero(summary.base_in_resolved_fields_count)
      + numberOrZero(summary.base_in_rendered_title_count)
  };
  row.capacity_efficiency_cards_per_minute = row.completed_cards_per_minute === null || row.concurrency <= 0
    ? null
    : Number((row.completed_cards_per_minute / row.concurrency).toFixed(6));
  row.queue_tail_share = row.scheduler_queue_wait_p95_ms === null || row.writer_ready_p95_ms === null || row.writer_ready_p95_ms <= 0
    ? null
    : Number((row.scheduler_queue_wait_p95_ms / row.writer_ready_p95_ms).toFixed(6));
  row.writer_tail_amplification = row.writer_ready_p50_ms === null || row.writer_ready_p95_ms === null || row.writer_ready_p50_ms <= 0
    ? null
    : Number((row.writer_ready_p95_ms / row.writer_ready_p50_ms).toFixed(6));
  row.tokens_per_completed_card = row.total_tokens === null || row.ok_count <= 0
    ? null
    : Number((row.total_tokens / row.ok_count).toFixed(2));
  row.input_tokens_per_completed_card = row.input_tokens === null || row.ok_count <= 0
    ? null
    : Number((row.input_tokens / row.ok_count).toFixed(2));
  row.output_tokens_per_completed_card = row.output_tokens === null || row.ok_count <= 0
    ? null
    : Number((row.output_tokens / row.ok_count).toFixed(2));
  row.bottleneck_share_of_writer_p95 = row.bottleneck_node_p95_ms === null
      || row.writer_ready_p95_ms === null
      || row.writer_ready_p95_ms <= 0
    ? null
    : Number((row.bottleneck_node_p95_ms / row.writer_ready_p95_ms).toFixed(6));
  return row;
}

function samplesArePaired(row = {}, baseline = {}) {
  return Boolean(row.sample_signature && row.sample_signature === baseline.sample_signature);
}

export function evaluateRow(row = {}, baseline = {}, { qualityTolerance = 0.03 } = {}) {
  const rejectionReasons = [];
  const warningReasons = [];
  const paired = samplesArePaired(row, baseline);
  if (row.attempted_count <= 0) rejectionReasons.push("NO_ATTEMPTED_CARDS");
  if (row.throughput_measurement_valid !== true) rejectionReasons.push("RESUMED_BATCH_NOT_CAPACITY_MEASUREMENT");
  if (row.ok_count !== row.attempted_count) rejectionReasons.push("TECHNICAL_SUCCESS_NOT_100_PERCENT");
  if (row.provider_error_count > 0) rejectionReasons.push("PROVIDER_ERROR");
  if (row.technical_failure_count > 0) rejectionReasons.push("TECHNICAL_FAILURE");
  if (row.retry_card_count > 0 || row.retry_attempt_count > 0) rejectionReasons.push("RETRY_REQUIRED");
  if (row.provider_key_rotation_card_count > 0) rejectionReasons.push("KEY_ROTATION_REQUIRED");
  if (row.http_429_count > 0) rejectionReasons.push("RATE_LIMIT_429");
  if (row.timeout_error_count > 0) rejectionReasons.push("PROVIDER_OR_NETWORK_TIMEOUT");
  if (row.batch_status_fatal_error) rejectionReasons.push("STATUS_CONTROL_PLANE_FATAL_ERROR");
  if (row.node_ledger_missing_count > 0 || (row.node_ledger_present_count > 0 && row.node_ledger_present_count !== row.attempted_count)) {
    rejectionReasons.push("NODE_LEDGER_INCOMPLETE");
  }
  if (row.node_transport_error_count > 0) rejectionReasons.push("NODE_RECONCILIATION_ERROR");
  if (row.node_field_quality_error_count > 0) warningReasons.push("FIELD_QUALITY_ANOMALY_RECORDED");
  if (row.node_missing_required_count > 0) rejectionReasons.push("REQUIRED_NODE_MISSING");
  if (row.production_integrity_reported) {
    if (row.duplicate_asset_id_count > 0) rejectionReasons.push("DUPLICATE_ASSET_RESULT");
    if (row.duplicate_job_id_count > 0) rejectionReasons.push("DUPLICATE_QUEUE_JOB");
    if (row.missing_job_id_count > 0) rejectionReasons.push("QUEUE_JOB_ID_MISSING");
    if (row.successful_nonterminal_job_count > 0) rejectionReasons.push("SUCCESSFUL_JOB_NOT_TERMINAL");
    if (row.provider_capacity_release_missing_count > 0) rejectionReasons.push("PROVIDER_CAPACITY_RELEASE_MISSING");
    if (row.provider_capacity_refill_missing_count > 0) rejectionReasons.push("PROVIDER_CAPACITY_REFILL_MISSING");
  }
  if (row.provider_done_handoff_requested && !row.production_integrity_reported) {
    rejectionReasons.push("PRODUCTION_INTEGRITY_TELEMETRY_MISSING");
  }
  if (row.copied_serial_grade_cert_from_reference_count > 0) rejectionReasons.push("COPIED_REFERENCE_INSTANCE_FIELD");
  if (row.base_pollution_count > 0) rejectionReasons.push("BASE_POLLUTION");

  if (paired) {
    if (row.pass_at_0_72_rate !== null && baseline.pass_at_0_72_rate !== null
      && row.pass_at_0_72_rate < baseline.pass_at_0_72_rate - qualityTolerance) {
      rejectionReasons.push("PAIRED_PASS_0_72_REGRESSION");
    }
    if (row.pass_at_0_80_rate !== null && baseline.pass_at_0_80_rate !== null
      && row.pass_at_0_80_rate < baseline.pass_at_0_80_rate - qualityTolerance) {
      rejectionReasons.push("PAIRED_PASS_0_80_REGRESSION");
    }
    if (row.policy_fair_title_token_recall_avg !== null && baseline.policy_fair_title_token_recall_avg !== null
      && row.policy_fair_title_token_recall_avg < baseline.policy_fair_title_token_recall_avg - qualityTolerance) {
      rejectionReasons.push("PAIRED_POLICY_FAIR_REGRESSION");
    }
  } else {
    warningReasons.push("UNPAIRED_SAMPLE_QUALITY_IS_GUARDRAIL_ONLY");
    if (row.policy_fair_title_token_recall_avg !== null && row.policy_fair_title_token_recall_avg < 0.72) {
      warningReasons.push("WEAK_PROXY_QUALITY_BELOW_0_72");
    }
    if (row.pass_at_0_72_rate !== null && row.pass_at_0_72_rate < 0.5) {
      warningReasons.push("WEAK_PROXY_PASS_RATE_BELOW_50_PERCENT");
    }
  }
  if (row.batch_status_transient_error_count > 0) warningReasons.push("RECOVERED_STATUS_CONTROL_PLANE_TRANSIENT");
  if (row.node_warning_count > 0) warningReasons.push("NODE_RECONCILIATION_WARNING");
  if (row.ocr_timeout_count > 0 || row.ocr_worker_timeout_count > 0) rejectionReasons.push("OCR_TIMEOUT_PRESENT");
  if (row.ocr_stage_capacity_deferred_count > 0) warningReasons.push("OCR_STAGE_CAPACITY_DEFERRED_WORK");
  if (row.catalog_stage_capacity_release_missing_count > 0) rejectionReasons.push("CATALOG_STAGE_CAPACITY_RELEASE_MISSING");
  if (row.vector_stage_capacity_release_missing_count > 0) rejectionReasons.push("VECTOR_STAGE_CAPACITY_RELEASE_MISSING");
  if (row.catalog_stage_capacity_deferred_count > 0) warningReasons.push("CATALOG_STAGE_CAPACITY_DEFERRED_WORK");
  if (row.vector_stage_capacity_deferred_count > 0) warningReasons.push("VECTOR_STAGE_CAPACITY_DEFERRED_WORK");
  if (row.vector_runtime_unavailable_count > 0) warningReasons.push("VECTOR_RUNTIME_UNAVAILABLE");
  if (row.request_headroom_min_ratio !== null && row.request_headroom_min_ratio < 0.05) {
    warningReasons.push("REQUEST_RATE_LIMIT_HEADROOM_BELOW_5_PERCENT");
  }
  if (row.token_headroom_min_ratio !== null && row.token_headroom_min_ratio < 0.05) {
    warningReasons.push("TOKEN_RATE_LIMIT_HEADROOM_BELOW_5_PERCENT");
  }
  if (row.request_headroom_min_ratio !== null && row.request_headroom_min_ratio < 0.01) {
    rejectionReasons.push("REQUEST_RATE_LIMIT_HEADROOM_EXHAUSTED");
  }
  if (row.token_headroom_min_ratio !== null && row.token_headroom_min_ratio < 0.01) {
    rejectionReasons.push("TOKEN_RATE_LIMIT_HEADROOM_EXHAUSTED");
  }
  if (row.queue_tail_share !== null && row.queue_tail_share > 0.25) {
    warningReasons.push("QUEUE_EXCEEDS_25_PERCENT_OF_WRITER_P95");
  }
  if (row.provider_key_slot_imbalance !== null && row.provider_key_slot_imbalance > 0.5) {
    warningReasons.push("PROVIDER_KEY_SLOT_IMBALANCE_ABOVE_50_PERCENT");
  }
  return {
    ...row,
    sample_comparison_mode: paired ? "PAIRED" : "UNPAIRED",
    stable: rejectionReasons.length === 0,
    rejection_reasons: rejectionReasons,
    warning_reasons: warningReasons
  };
}

function byConcurrency(left, right) {
  return Number(left.concurrency || 0) - Number(right.concurrency || 0);
}

function byThroughput(left, right) {
  const leftRate = numberOrNull(left.completed_cards_per_minute) ?? -1;
  const rightRate = numberOrNull(right.completed_cards_per_minute) ?? -1;
  if (rightRate !== leftRate) return rightRate - leftRate;
  const leftP95 = numberOrNull(left.writer_ready_p95_ms) ?? Number.POSITIVE_INFINITY;
  const rightP95 = numberOrNull(right.writer_ready_p95_ms) ?? Number.POSITIVE_INFINITY;
  if (leftP95 !== rightP95) return leftP95 - rightP95;
  return byConcurrency(left, right);
}

export function chooseConcurrency(rows = [], {
  minimumMarginalThroughputGain = 0.12,
  maximumMarginalP95Increase = 0.35
} = {}) {
  const stable = rows.filter((row) => row.stable).sort(byConcurrency);
  if (!stable.length) return { recommended: null, rawWinner: null, trace: [] };
  const rawWinner = [...stable].sort(byThroughput)[0] || null;
  let recommended = stable[0];
  const trace = [{
    concurrency: recommended.concurrency,
    decision: "BASELINE_STABLE",
    throughput_gain: null,
    writer_p95_increase: null
  }];
  for (const candidate of stable.slice(1)) {
    const throughputGain = percentChange(candidate.completed_cards_per_minute, recommended.completed_cards_per_minute);
    const p95Increase = percentChange(candidate.writer_ready_p95_ms, recommended.writer_ready_p95_ms);
    const improvesEnough = throughputGain !== null && throughputGain >= minimumMarginalThroughputGain;
    const tailAcceptable = p95Increase === null || p95Increase <= maximumMarginalP95Increase;
    const decision = improvesEnough && tailAcceptable ? "ADVANCE" : "STOP_AT_KNEE";
    trace.push({
      concurrency: candidate.concurrency,
      compared_to: recommended.concurrency,
      throughput_gain: throughputGain,
      writer_p95_increase: p95Increase,
      decision
    });
    if (decision === "ADVANCE") recommended = candidate;
  }
  return { recommended, rawWinner, trace };
}

export async function compareConcurrencySweep({
  reports = [],
  outPath = "",
  qualityTolerance = 0.03,
  minimumMarginalThroughputGain = 0.12,
  maximumMarginalP95Increase = 0.35
} = {}) {
  if (!reports.length) throw new Error("At least one --report=concurrency:path is required.");
  const rows = [];
  for (const report of reports) {
    const data = await readJson(report.path);
    rows.push(metricRow(data, report.path, report.concurrency));
  }
  rows.sort(byConcurrency);
  const baseline = rows.find((row) => row.concurrency === 1) || rows[0];
  const evaluated = rows.map((row) => evaluateRow(row, baseline, { qualityTolerance }));
  const selection = chooseConcurrency(evaluated, {
    minimumMarginalThroughputGain,
    maximumMarginalP95Increase
  });
  const report = {
    schema_version: "v4-concurrency-capacity-sweep-v2",
    generated_at: new Date().toISOString(),
    baseline_concurrency: baseline?.concurrency ?? null,
    recommended_concurrency: selection.recommended?.concurrency ?? null,
    raw_throughput_winner_concurrency: selection.rawWinner?.concurrency ?? null,
    recommendation_confidence: evaluated.every((row) => row.sample_comparison_mode === "PAIRED")
      ? "PAIRED_CONFIRMED"
      : "PROVISIONAL_REQUIRES_TOP_TWO_CONFIRMATION",
    recommendation_reason: selection.recommended
      ? "highest stable concurrency before marginal throughput stops paying for tail latency"
      : "no stable concurrency found",
    guardrails: {
      quality_tolerance: qualityTolerance,
      minimum_marginal_throughput_gain: minimumMarginalThroughputGain,
      maximum_marginal_writer_p95_increase: maximumMarginalP95Increase,
      technical_success_required: 1,
      retries_allowed: 0,
      node_reconciliation_errors_allowed: 0,
      missing_required_nodes_allowed: 0
    },
    selection_trace: selection.trace,
    rows: evaluated
  };
  if (outPath) await writeJson(outPath, report);
  return report;
}

export async function main(argv = process.argv) {
  const reports = parseReportArgs(argv);
  const outPath = argValue(argv, "--out", "");
  const report = await compareConcurrencySweep({
    reports,
    outPath,
    qualityTolerance: numberOrNull(argValue(argv, "--quality-tolerance", "")) ?? 0.03,
    minimumMarginalThroughputGain: numberOrNull(argValue(argv, "--minimum-throughput-gain", "")) ?? 0.12,
    maximumMarginalP95Increase: numberOrNull(argValue(argv, "--maximum-p95-increase", "")) ?? 0.35
  });
  process.stdout.write([
    `concurrency sweep recommendation: ${report.recommended_concurrency ?? "n/a"}`,
    `raw throughput winner: ${report.raw_throughput_winner_concurrency ?? "n/a"}`,
    `confidence: ${report.recommendation_confidence}`,
    ...report.rows.map((row) => [
      `c${row.concurrency}`,
      `stable=${row.stable}`,
      `cards_per_min=${row.completed_cards_per_minute ?? "n/a"}`,
      `policy_adjusted=${row.policy_adjusted_cards_per_minute ?? "n/a"}`,
      `policy_avg=${row.policy_fair_title_token_recall_avg ?? "n/a"}`,
      `pass@0.72=${row.pass_at_0_72_count}/${row.attempted_count}`,
      `writer_p95=${row.writer_ready_p95_ms ?? "n/a"}ms`,
      `queue_p95=${row.scheduler_queue_wait_p95_ms ?? "n/a"}ms`,
      `queue_tail_share=${row.queue_tail_share ?? "n/a"}`,
      `tail_amplification=${row.writer_tail_amplification ?? "n/a"}`,
      `provider_p95=${row.provider_latency_p95_ms ?? "n/a"}ms`,
      `retrieval_deadline_p95=${row.post_observation_retrieval_deadline_p95_ms ?? "n/a"}ms`,
      `retrieval_deferred=${row.post_observation_retrieval_deferred_card_count}/${row.attempted_count}`,
      `bottleneck=${row.bottleneck_node_id ?? "n/a"}:${row.bottleneck_node_p95_ms ?? "n/a"}ms`,
      `request_headroom=${row.request_headroom_min_ratio ?? "n/a"}`,
      `token_headroom=${row.token_headroom_min_ratio ?? "n/a"}`,
      `key_slots=${JSON.stringify(row.provider_key_slot_distribution)}`,
      `tokens_per_card=${row.tokens_per_completed_card ?? "n/a"}`,
      `reasons=${row.rejection_reasons.join("|") || "n/a"}`,
      `warnings=${row.warning_reasons.join("|") || "n/a"}`
    ].join(" "))
  ].join("\n") + "\n");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Concurrency sweep comparison failed: ${error.message}`);
    process.exit(1);
  }
}
