const DEFAULT_SCORE_PATH = ["final_scoring", "policy_fair_token_recall"];

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function atPath(value, path) {
  return path.reduce((cursor, key) => cursor?.[key], value);
}

function quantile(values, percentile) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function isSuccessful(row = {}) {
  return row.ok === true && row.job_status === "L2_READY" && row.l2_ready !== false;
}

function patchCount(row = {}) {
  return finite(row.pre_l2_anchor_patch_count) ?? 0;
}

function pairKey(row = {}) {
  return String(row.source_feedback_id || row.source_asset_id || "").trim();
}

function round(value, digits = 6) {
  return value === null ? null : Number(value.toFixed(digits));
}

export function auditOcrPatchUtility({
  controlReport,
  candidateReport,
  scorePath = DEFAULT_SCORE_PATH,
  speedGateCardsPerMinute = 6,
  accuracyGate = 0.85,
  stabilityGate = 1,
  epsilon = 1e-9
} = {}) {
  const controlRows = Array.isArray(controlReport?.results) ? controlReport.results : [];
  const candidateRows = Array.isArray(candidateReport?.results) ? candidateReport.results : [];
  const controlByKey = new Map(controlRows.map((row) => [pairKey(row), row]).filter(([key]) => key));
  const candidateByKey = new Map(candidateRows.map((row) => [pairKey(row), row]).filter(([key]) => key));
  const sharedKeys = [...controlByKey.keys()].filter((key) => candidateByKey.has(key)).sort();

  const pairs = sharedKeys.map((key) => {
    const control = controlByKey.get(key);
    const candidate = candidateByKey.get(key);
    const controlSuccess = isSuccessful(control);
    const candidateSuccess = isSuccessful(candidate);
    const controlScore = controlSuccess ? finite(atPath(control, scorePath)) : null;
    const candidateScore = candidateSuccess ? finite(atPath(candidate, scorePath)) : null;
    const scoreDelta = controlScore !== null && candidateScore !== null ? candidateScore - controlScore : null;
    const controlPatches = patchCount(control);
    const candidatePatches = patchCount(candidate);
    const patchDelta = candidatePatches - controlPatches;
    const classification = !candidateSuccess
      ? "TECHNICAL_REGRESSION"
      : !controlSuccess
        ? "TECHNICAL_RECOVERY"
        : scoreDelta === null
          ? "UNSCORED"
          : scoreDelta > epsilon
            ? "SCORE_IMPROVED"
            : scoreDelta < -epsilon
              ? "SCORE_REGRESSED"
              : "SCORE_UNCHANGED";

    return {
      pair_key: key,
      control_success: controlSuccess,
      candidate_success: candidateSuccess,
      control_patch_count: controlPatches,
      candidate_patch_count: candidatePatches,
      patch_delta: patchDelta,
      control_score: controlScore,
      candidate_score: candidateScore,
      score_delta: round(scoreDelta),
      classification,
      control_writer_visible_ms: finite(control.writer_visible_recognition_ms),
      candidate_writer_visible_ms: finite(candidate.writer_visible_recognition_ms),
      control_scheduler_queue_ms: finite(control.scheduler_queue_wait_ms),
      candidate_scheduler_queue_ms: finite(candidate.scheduler_queue_wait_ms),
      control_title: control.final_title || "",
      candidate_title: candidate.final_title || ""
    };
  });

  const jointlySuccessful = pairs.filter((pair) => pair.control_success && pair.candidate_success);
  const patchExposed = jointlySuccessful.filter((pair) => pair.patch_delta > 0);
  const scoreDeltas = jointlySuccessful.map((pair) => pair.score_delta);
  const visibleDeltas = jointlySuccessful
    .map((pair) => pair.control_writer_visible_ms !== null && pair.candidate_writer_visible_ms !== null
      ? pair.candidate_writer_visible_ms - pair.control_writer_visible_ms
      : null)
    .filter((value) => value !== null);
  const queueDeltas = jointlySuccessful
    .map((pair) => pair.control_scheduler_queue_ms !== null && pair.candidate_scheduler_queue_ms !== null
      ? pair.candidate_scheduler_queue_ms - pair.control_scheduler_queue_ms
      : null)
    .filter((value) => value !== null);

  const candidateAttempted = candidateRows.length;
  const candidateSucceeded = candidateRows.filter(isSuccessful).length;
  const candidateScores = candidateRows.filter(isSuccessful).map((row) => atPath(row, scorePath));
  const speed = finite(candidateReport?.summary?.completed_cards_per_minute_service_window);
  const accuracy = average(candidateScores);
  const stability = candidateAttempted ? candidateSucceeded / candidateAttempted : null;
  const gate = {
    speed: { value: speed, threshold: speedGateCardsPerMinute, passed: speed !== null && speed >= speedGateCardsPerMinute },
    accuracy: { value: round(accuracy), threshold: accuracyGate, passed: accuracy !== null && accuracy >= accuracyGate },
    stability: { value: round(stability), threshold: stabilityGate, passed: stability !== null && stability >= stabilityGate }
  };

  return {
    schema_version: "ocr-patch-utility-audit-v1",
    causal_boundary: "Paired score movement is associated with the candidate run, not proven to be caused by OCR patches because provider output is stochastic.",
    pair_coverage: {
      control_count: controlRows.length,
      candidate_count: candidateRows.length,
      shared_count: sharedKeys.length,
      jointly_successful_count: jointlySuccessful.length
    },
    patch_exposure: {
      pair_count: patchExposed.length,
      candidate_patch_count: patchExposed.reduce((sum, pair) => sum + pair.candidate_patch_count, 0),
      improved_count: patchExposed.filter((pair) => pair.classification === "SCORE_IMPROVED").length,
      regressed_count: patchExposed.filter((pair) => pair.classification === "SCORE_REGRESSED").length,
      unchanged_count: patchExposed.filter((pair) => pair.classification === "SCORE_UNCHANGED").length,
      mean_score_delta: round(average(patchExposed.map((pair) => pair.score_delta)))
    },
    paired_outcomes: {
      improved_count: jointlySuccessful.filter((pair) => pair.classification === "SCORE_IMPROVED").length,
      regressed_count: jointlySuccessful.filter((pair) => pair.classification === "SCORE_REGRESSED").length,
      unchanged_count: jointlySuccessful.filter((pair) => pair.classification === "SCORE_UNCHANGED").length,
      technical_recovery_count: pairs.filter((pair) => pair.classification === "TECHNICAL_RECOVERY").length,
      technical_regression_count: pairs.filter((pair) => pair.classification === "TECHNICAL_REGRESSION").length,
      mean_score_delta: round(average(scoreDeltas)),
      writer_visible_delta_p50_ms: quantile(visibleDeltas, 0.5),
      writer_visible_delta_p95_ms: quantile(visibleDeltas, 0.95),
      scheduler_queue_delta_p50_ms: quantile(queueDeltas, 0.5),
      scheduler_queue_delta_p95_ms: quantile(queueDeltas, 0.95)
    },
    candidate_gate: {
      ...gate,
      passed: gate.speed.passed && gate.accuracy.passed && gate.stability.passed,
      expansion_allowed: gate.speed.passed && gate.accuracy.passed && gate.stability.passed
    },
    recommendation: gate.speed.passed && gate.accuracy.passed && gate.stability.passed
      ? "EXPAND_SAMPLE"
      : "DO_NOT_EXPAND",
    pairs
  };
}
