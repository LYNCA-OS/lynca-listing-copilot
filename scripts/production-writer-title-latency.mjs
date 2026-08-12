export const WRITER_EDITABLE_TITLE_LATENCY_VERSION = "writer-editable-title-latency-v1";
export const WRITER_EDITABLE_TITLE_LATENCY_SUMMARY_VERSION =
  "writer-editable-title-latency-summary-v1";
export const WRITER_EDITABLE_TITLE_LATENCY_OPTIMIZATION_GATE_VERSION =
  "writer-editable-title-latency-optimization-gate-v1";

export const WRITER_EDITABLE_TITLE_LATENCY_LIMITS = Object.freeze({
  diagnostic_p50_ms: 8_000,
  diagnostic_p95_ms: 12_000,
  normal_single_case_hard_ms: 20_000,
  large_single_case_hard_ms: 30_000,
  optimization_min_fresh_samples_per_cohort: 30,
  optimization_required_non_overlapping_cohorts: 2
});

const LANES = new Set(["NORMAL", "LARGE_STAGED_TRANSPORT"]);
const RECEIPT_KEYS = Object.freeze([
  "schema_version", "case_id", "lane", "sample_id_sha256", "execution_origin",
  "provider_attempt_number", "provider_retry_count",
  "upload_to_recognition_response_ms", "recognition_response_to_editable_title_ms",
  "upload_to_editable_title_ms", "hard_limit_ms", "hard_limit_passed", "classification"
]);
const COHORT_KEYS = Object.freeze(["cohort_id", "receipts"]);

function integer(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(code);
  return value;
}

function requiredText(value, code) {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(code);
  return value;
}

function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function classificationFor(latencyMs, hardLimitPassed) {
  return !hardLimitPassed
    ? "HARD_LIMIT_EXCEEDED"
    : latencyMs > WRITER_EDITABLE_TITLE_LATENCY_LIMITS.diagnostic_p95_ms
      ? "ABOVE_P95_DIAGNOSTIC_TARGET"
      : latencyMs > WRITER_EDITABLE_TITLE_LATENCY_LIMITS.diagnostic_p50_ms
        ? "ABOVE_P50_DIAGNOSTIC_TARGET"
        : "WITHIN_DIAGNOSTIC_TARGET";
}

export function buildWriterEditableTitleLatencyReceipt({
  caseId,
  lane,
  sampleIdSha256,
  uploadStartedAtMs,
  recognitionResponseAtMs,
  titleEditableAtMs,
  executionOrigin,
  providerAttemptNumber,
  providerRetryCount
} = {}) {
  requiredText(caseId, "writer_title_latency_case_id");
  if (!LANES.has(lane)) throw new TypeError("writer_title_latency_lane");
  if (!/^[0-9a-f]{64}$/.test(String(sampleIdSha256 || ""))) {
    throw new TypeError("writer_title_latency_sample_id_sha256");
  }
  const upload = integer(uploadStartedAtMs, "writer_title_latency_upload_start");
  const response = integer(recognitionResponseAtMs, "writer_title_latency_response_time");
  const editable = integer(titleEditableAtMs, "writer_title_latency_editable_time");
  if (response < upload || editable < response) throw new TypeError("writer_title_latency_order");
  if (executionOrigin !== "FRESH_CURRENT") throw new TypeError("writer_title_latency_execution_origin");
  if (providerAttemptNumber !== 1 || providerRetryCount !== 0) {
    throw new TypeError("writer_title_latency_attempt_contract");
  }
  const uploadToRecognitionResponseMs = response - upload;
  const recognitionResponseToEditableTitleMs = editable - response;
  const uploadToEditableTitleMs = editable - upload;
  if (uploadToEditableTitleMs
      !== uploadToRecognitionResponseMs + recognitionResponseToEditableTitleMs) {
    throw new TypeError("writer_title_latency_partition");
  }
  const hardLimitMs = lane === "LARGE_STAGED_TRANSPORT"
    ? WRITER_EDITABLE_TITLE_LATENCY_LIMITS.large_single_case_hard_ms
    : WRITER_EDITABLE_TITLE_LATENCY_LIMITS.normal_single_case_hard_ms;
  const hardLimitPassed = uploadToEditableTitleMs <= hardLimitMs;
  const classification = classificationFor(uploadToEditableTitleMs, hardLimitPassed);

  return Object.freeze({
    schema_version: WRITER_EDITABLE_TITLE_LATENCY_VERSION,
    case_id: caseId,
    lane,
    sample_id_sha256: sampleIdSha256,
    execution_origin: executionOrigin,
    provider_attempt_number: providerAttemptNumber,
    provider_retry_count: providerRetryCount,
    upload_to_recognition_response_ms: uploadToRecognitionResponseMs,
    recognition_response_to_editable_title_ms: recognitionResponseToEditableTitleMs,
    upload_to_editable_title_ms: uploadToEditableTitleMs,
    hard_limit_ms: hardLimitMs,
    hard_limit_passed: hardLimitPassed,
    classification
  });
}

function validReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).sort().join("\0") !== [...RECEIPT_KEYS].sort().join("\0")) {
    return false;
  }
  const expectedHardLimit = receipt.lane === "LARGE_STAGED_TRANSPORT"
    ? WRITER_EDITABLE_TITLE_LATENCY_LIMITS.large_single_case_hard_ms
    : WRITER_EDITABLE_TITLE_LATENCY_LIMITS.normal_single_case_hard_ms;
  const expectedHardLimitPassed = receipt.upload_to_editable_title_ms <= expectedHardLimit;
  return receipt.schema_version === WRITER_EDITABLE_TITLE_LATENCY_VERSION
    && typeof receipt.case_id === "string"
    && Boolean(receipt.case_id)
    && receipt.case_id === receipt.case_id.trim()
    && LANES.has(receipt.lane)
    && /^[0-9a-f]{64}$/.test(String(receipt.sample_id_sha256 || ""))
    && receipt.execution_origin === "FRESH_CURRENT"
    && receipt.provider_attempt_number === 1
    && receipt.provider_retry_count === 0
    && Number.isSafeInteger(receipt.upload_to_recognition_response_ms)
    && receipt.upload_to_recognition_response_ms >= 0
    && Number.isSafeInteger(receipt.recognition_response_to_editable_title_ms)
    && receipt.recognition_response_to_editable_title_ms >= 0
    && Number.isSafeInteger(receipt.upload_to_editable_title_ms)
    && receipt.upload_to_editable_title_ms >= 0
    && receipt.upload_to_editable_title_ms
      === receipt.upload_to_recognition_response_ms
        + receipt.recognition_response_to_editable_title_ms
    && receipt.hard_limit_ms === expectedHardLimit
    && receipt.hard_limit_passed === expectedHardLimitPassed
    && receipt.classification === classificationFor(
      receipt.upload_to_editable_title_ms,
      expectedHardLimitPassed
    );
}

export function summarizeWriterEditableTitleLatency(receipts, { cohortId = "live-smoke" } = {}) {
  if (!Array.isArray(receipts) || !receipts.length || receipts.some((entry) => !validReceipt(entry))) {
    throw new TypeError("writer_title_latency_receipts_invalid");
  }
  requiredText(cohortId, "writer_title_latency_cohort_id");
  const sampleIds = receipts.map((entry) => entry.sample_id_sha256);
  if (new Set(sampleIds).size !== sampleIds.length) {
    throw new TypeError("writer_title_latency_duplicate_sample");
  }
  const values = receipts.map((entry) => entry.upload_to_editable_title_ms);
  const p50Ms = percentile(values, 0.50);
  const p95Ms = percentile(values, 0.95);
  const diagnosticBreach = p50Ms > WRITER_EDITABLE_TITLE_LATENCY_LIMITS.diagnostic_p50_ms
    || p95Ms > WRITER_EDITABLE_TITLE_LATENCY_LIMITS.diagnostic_p95_ms;
  const optimizationSampleEligible = receipts.length
    >= WRITER_EDITABLE_TITLE_LATENCY_LIMITS.optimization_min_fresh_samples_per_cohort;
  return Object.freeze({
    schema_version: WRITER_EDITABLE_TITLE_LATENCY_SUMMARY_VERSION,
    cohort_id: cohortId,
    sample_count: receipts.length,
    fresh_first_attempt_retry_zero_count: receipts.length,
    sample_id_sha256: Object.freeze([...sampleIds].sort()),
    p50_ms: p50Ms,
    p95_ms: p95Ms,
    max_ms: Math.max(...values),
    diagnostic_p50_target_ms: WRITER_EDITABLE_TITLE_LATENCY_LIMITS.diagnostic_p50_ms,
    diagnostic_p95_target_ms: WRITER_EDITABLE_TITLE_LATENCY_LIMITS.diagnostic_p95_ms,
    diagnostic_breach: diagnosticBreach,
    hard_limit_passed: receipts.every((entry) => entry.hard_limit_passed),
    hard_limit_exceeded_case_ids: Object.freeze(receipts
      .filter((entry) => !entry.hard_limit_passed)
      .map((entry) => entry.case_id)),
    diagnostic_only: !optimizationSampleEligible,
    optimization_sample_eligible: optimizationSampleEligible,
    optimization_policy: "QUALITY_PRESERVING_ONLY"
  });
}

export function evaluateWriterEditableTitleLatencyOptimizationGate(cohorts) {
  if (!Array.isArray(cohorts)
      || cohorts.length !== WRITER_EDITABLE_TITLE_LATENCY_LIMITS
        .optimization_required_non_overlapping_cohorts
      || cohorts.some((cohort) => (
        !cohort || typeof cohort !== "object" || Array.isArray(cohort)
        || Object.keys(cohort).sort().join("\0") !== [...COHORT_KEYS].sort().join("\0")
        || typeof cohort.cohort_id !== "string" || !cohort.cohort_id
        || cohort.cohort_id !== cohort.cohort_id.trim()
        || !Array.isArray(cohort.receipts)
      ))) {
    throw new TypeError("writer_title_latency_gate_cohorts_invalid");
  }
  let summaries;
  try {
    summaries = cohorts.map((cohort) => summarizeWriterEditableTitleLatency(
      cohort.receipts,
      { cohortId: cohort.cohort_id }
    ));
  } catch {
    throw new TypeError("writer_title_latency_gate_cohorts_invalid");
  }
  const cohortIds = summaries.map((entry) => entry.cohort_id);
  const cohortIdsDistinct = new Set(cohortIds).size === cohortIds.length;
  const firstIds = new Set(summaries[0].sample_id_sha256);
  const nonOverlapping = summaries[1].sample_id_sha256.every((id) => !firstIds.has(id));
  const eligible = cohortIdsDistinct && nonOverlapping
    && summaries.every((entry) => (
      entry.optimization_sample_eligible === true
      && entry.sample_count
        >= WRITER_EDITABLE_TITLE_LATENCY_LIMITS.optimization_min_fresh_samples_per_cohort
    ));
  const optimizationRequired = eligible
    && summaries.every((entry) => entry.diagnostic_breach === true);
  return Object.freeze({
    schema_version: WRITER_EDITABLE_TITLE_LATENCY_OPTIMIZATION_GATE_VERSION,
    cohort_count: summaries.length,
    cohort_ids_distinct: cohortIdsDistinct,
    cohorts_non_overlapping: nonOverlapping,
    cohort_summaries: Object.freeze(summaries),
    evidence_eligible: eligible,
    optimization_required: optimizationRequired,
    optimization_policy: "QUALITY_PRESERVING_ONLY",
    prohibited_shortcuts: Object.freeze([
      "LOW_TO_NONE_WITHOUT_QUALITY_GATE",
      "LOWER_IMAGE_DETAIL_WITHOUT_QUALITY_GATE",
      "AUTOMATIC_SECOND_PROVIDER_CALL"
    ])
  });
}
