const frozen = "FROZEN";
const pendingSweep = "PENDING_SWEEP";

export const listingConcurrencyContractVersion = "listing-concurrency-contract-v1";

export const listingConcurrencyContract = Object.freeze({
  upload_validation: Object.freeze({
    concurrency: 4,
    status: frozen,
    scope: "browser_tab",
    execution_model: "fused_into_image_preprocess",
    evidence: "validation is CPU-light and runs inside the measured four-slot image preparation pool",
    retest_when: "validation becomes a network stage or image preprocessing implementation changes"
  }),
  image_preprocess: Object.freeze({
    concurrency: 4,
    status: frozen,
    scope: "browser_tab",
    evidence: "historical_browser_image_preprocess_sweep",
    retest_when: "browser preprocessing implementation or image-size policy changes"
  }),
  storage_upload: Object.freeze({
    concurrency: 3,
    status: frozen,
    scope: "browser_tab",
    evidence: "historical_storage_upload_sweep",
    retest_when: "storage provider, upload protocol, or image-count policy changes"
  }),
  background_preparation: Object.freeze({
    concurrency: 4,
    status: frozen,
    scope: "browser_tab",
    evidence: "bounded preparation pool aligned with measured browser preprocessing capacity",
    retest_when: "pre-ingestion dependency graph or browser preprocessing capacity changes"
  }),
  signed_url_preparation: Object.freeze({
    concurrency: 4,
    status: frozen,
    scope: "per_card",
    execution_model: "bounded_inside_background_preparation",
    evidence: "same measured four-slot preparation pool; current cards normally require only two source URLs",
    retest_when: "storage provider, signed URL RPC, or per-card image policy changes"
  }),
  queue_submission: Object.freeze({
    concurrency: 2,
    status: frozen,
    scope: "browser_tab",
    evidence: "production queue capacity sweep; concurrency above two increased tail failures",
    retest_when: "queue persistence or wakeup architecture changes"
  }),
  gpt_provider: Object.freeze({
    concurrency: 2,
    status: frozen,
    scope: "global",
    evidence: "paired GPT-5-mini sweep; concurrency three reduced throughput and stability",
    retest_when: "model, provider account, key capacity, transport, or provider lease architecture changes"
  }),
  paddle_ocr: Object.freeze({
    concurrency: 8,
    status: frozen,
    scope: "global",
    per_asset_concurrency: 1,
    per_asset_batch_size: 3,
    anchor_lane_limit: 8,
    detail_lane_limit: 2,
    evidence: "Cloud Run sweep; eight was the highest zero-timeout point and ten timed out",
    retest_when: "OCR model, worker CPU/memory, Cloud Run limits, or crop workload changes"
  }),
  catalog_retrieval: Object.freeze({
    concurrency: 1,
    status: frozen,
    scope: "global_cards",
    evidence: "2026-07-16 production catalog-only sweep; one card lane cleared 12/min with the lowest p95, while higher lanes increased tail contention",
    retest_when: "catalog RPC/index/database tier or capacity-control architecture changes"
  }),
  catalog_internal_queries: Object.freeze({
    concurrency: 4,
    status: frozen,
    scope: "per_card",
    evidence: "2026-07-16 production catalog-only query sweep; four lanes had the best stable throughput and p95 knee",
    retest_when: "query planner, catalog RPC, or index changes"
  }),
  vector_query: Object.freeze({
    concurrency: 3,
    status: frozen,
    scope: "global_cards",
    evidence: "2026-07-16 cold-cache production sweep; three completed 8/8 at 25/min and four failed 7/12",
    retest_when: "embedding model, worker shape, index, cache, or database tier changes"
  }),
  vector_index: Object.freeze({
    concurrency: 2,
    status: frozen,
    scope: "batch_local",
    evidence: "resumable seed indexing production run",
    retest_when: "embedding model, worker shape, or indexing writer changes"
  })
});

export function contractedConcurrency(stage, requested, {
  fallback = 1,
  limitKey = "concurrency"
} = {}) {
  const config = listingConcurrencyContract[stage];
  const parsed = Number.parseInt(String(requested ?? ""), 10);
  const normalized = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : Number(config?.[limitKey] || fallback || 1);
  if (!config || config.status !== frozen) return Math.max(1, normalized);
  // A circuit breaker may lower a frozen capacity, but an environment edit may
  // not raise it above the measured knee without reopening the sweep.
  return Math.max(1, Math.min(normalized, Number(config[limitKey] || fallback || 1)));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function evaluateConcurrencyArm(row = {}, {
  minAccuracy = 0.87,
  requireAccuracy = false
} = {}) {
  const taskCount = Math.max(0, Math.trunc(numberOrNull(row.task_count) || 0));
  const successCount = Math.max(0, Math.trunc(numberOrNull(row.success_count) || 0));
  const timeoutCount = Math.max(0, Math.trunc(numberOrNull(row.timeout_count) || 0));
  const consistency = numberOrNull(row.result_consistency_rate);
  const accuracy = numberOrNull(row.accuracy);
  const rejectionReasons = [];

  if (taskCount <= 0) rejectionReasons.push("NO_TASKS");
  if (successCount !== taskCount) rejectionReasons.push("INCOMPLETE_TASKS");
  if (timeoutCount > 0) rejectionReasons.push("TIMEOUTS_PRESENT");
  if (consistency !== null && consistency < 1) rejectionReasons.push("RESULT_INCONSISTENCY");
  if (requireAccuracy && accuracy === null) rejectionReasons.push("ACCURACY_MISSING");
  if (accuracy !== null && accuracy < minAccuracy) rejectionReasons.push("ACCURACY_REGRESSION");
  if ((numberOrNull(row.lost_job_count) || 0) > 0) rejectionReasons.push("LOST_JOBS");
  if ((numberOrNull(row.duplicate_job_count) || 0) > 0) rejectionReasons.push("DUPLICATE_JOBS");
  if ((numberOrNull(row.capacity_release_missing_count) || 0) > 0) rejectionReasons.push("CAPACITY_RELEASE_MISSING");

  return {
    ...row,
    concurrency: Math.max(1, Math.trunc(numberOrNull(row.concurrency) || 1)),
    throughput_per_second: numberOrNull(row.throughput_per_second) || 0,
    p95_ms: numberOrNull(row.p95_ms),
    stable: rejectionReasons.length === 0,
    rejection_reasons: rejectionReasons
  };
}

export function selectConcurrencyKnee(rows = [], {
  minAccuracy = 0.87,
  requireAccuracy = false,
  throughputFloorRatio = 0.97,
  minimumRequiredThroughputPerSecond = 0
} = {}) {
  const evaluated = (Array.isArray(rows) ? rows : []).map((row) => evaluateConcurrencyArm(row, {
    minAccuracy,
    requireAccuracy
  }));
  const stable = evaluated.filter((row) => row.stable && row.throughput_per_second > 0);
  if (!stable.length) {
    return {
      recommended_concurrency: null,
      reason: "NO_STABLE_ARM",
      max_stable_throughput_per_second: null,
      rows: evaluated
    };
  }

  const requiredThroughput = Math.max(0, Number(minimumRequiredThroughputPerSecond) || 0);
  if (requiredThroughput > 0) {
    const demandSafe = stable
      .filter((row) => row.throughput_per_second >= requiredThroughput)
      .sort((left, right) => {
        const leftP95 = left.p95_ms ?? Infinity;
        const rightP95 = right.p95_ms ?? Infinity;
        return leftP95 - rightP95
          || left.concurrency - right.concurrency
          || right.throughput_per_second - left.throughput_per_second;
      });
    if (demandSafe.length) {
      const recommended = demandSafe[0];
      return {
        recommended_concurrency: recommended.concurrency,
        reason: "LOWEST_P95_ARM_MEETING_REQUIRED_THROUGHPUT",
        minimum_required_throughput_per_second: requiredThroughput,
        recommended_throughput_per_second: recommended.throughput_per_second,
        recommended_p95_ms: recommended.p95_ms,
        rows: evaluated
      };
    }
  }

  const maxThroughput = Math.max(...stable.map((row) => row.throughput_per_second));
  const floor = maxThroughput * Math.max(0.5, Math.min(1, Number(throughputFloorRatio) || 0.97));
  const nearPeak = stable
    .filter((row) => row.throughput_per_second >= floor)
    .sort((left, right) => left.concurrency - right.concurrency || (left.p95_ms ?? Infinity) - (right.p95_ms ?? Infinity));
  const recommended = nearPeak[0] || stable.sort((left, right) => right.throughput_per_second - left.throughput_per_second)[0];

  return {
    recommended_concurrency: recommended.concurrency,
    reason: "SMALLEST_STABLE_ARM_WITHIN_THROUGHPUT_FLOOR",
    minimum_required_throughput_per_second: requiredThroughput || null,
    throughput_floor_ratio: throughputFloorRatio,
    max_stable_throughput_per_second: maxThroughput,
    recommended_throughput_per_second: recommended.throughput_per_second,
    recommended_p95_ms: recommended.p95_ms,
    rows: evaluated
  };
}

export function concurrencyContractSnapshot() {
  return {
    schema_version: listingConcurrencyContractVersion,
    stages: Object.fromEntries(Object.entries(listingConcurrencyContract).map(([stage, config]) => [stage, { ...config }]))
  };
}

export const concurrencyContractStatuses = Object.freeze({
  FROZEN: frozen,
  PENDING_SWEEP: pendingSweep
});
