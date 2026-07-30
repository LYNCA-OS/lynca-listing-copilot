export const noFullProviderJointTitleGateContractVersion =
  "no-full-provider-joint-title-gate-v1";

export const noFullProviderJointTitleGate = Object.freeze({
  route: "NO_FULL_PROVIDER",
  maximum_title_characters: 80,
  minimum_card_policy_fair_token_recall: 0.72,
  minimum_split_policy_fair_token_recall_average: 0.85,
  maximum_writer_visible_ms: 3000,
  splits: Object.freeze({
    development: Object.freeze({
      expected_denominator: 173,
      required_joint_success_count: 148
    }),
    validation: Object.freeze({
      expected_denominator: 37,
      required_joint_success_count: 32
    })
  })
});

const allowedSplits = new Set(Object.keys(noFullProviderJointTitleGate.splits));
const floatingPointTolerance = 1e-12;

const requiredDisabledControls = Object.freeze([
  "disable_identity_result_cache_read",
  "disable_identity_result_cache_write",
  "disable_approved_identity_memory",
  "disable_writer_final_replay",
  "disable_identity_inflight_replay"
]);

const requiredMissObservations = Object.freeze([
  "identity_cache_hit",
  "approved_identity_memory_hit",
  "writer_final_replay_hit",
  "identity_inflight_replay_hit"
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean" || typeof value === "object") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function codePointLength(value) {
  return [...String(value ?? "")].length;
}

function addReason(reasons, condition, reason) {
  if (!condition) reasons.push(reason);
  return condition;
}

function benchmarkControls(sample) {
  const controls = sample?.benchmark_controls;
  return controls && typeof controls === "object" ? controls : {};
}

function cacheMemoryChecks(sample) {
  const controls = benchmarkControls(sample);
  const disabled = Object.fromEntries(requiredDisabledControls.map((key) => (
    [key, controls[key] === true]
  )));
  const misses = Object.fromEntries(requiredMissObservations.map((key) => (
    [key, sample?.[key] === false]
  )));
  return {
    disabled,
    misses,
    pass: Object.values(disabled).every(Boolean) && Object.values(misses).every(Boolean)
  };
}

function scoreTitleCriticalGuard(sample) {
  const guard = sample?.title_critical_guard;
  const objectPresent = guard != null && typeof guard === "object";
  return {
    object_present: objectPresent,
    complete: objectPresent && guard.complete === true,
    catastrophic_false: objectPresent && guard.catastrophic === false,
    critical_fabrication_false: objectPresent && guard.critical_fabrication === false
  };
}

/**
 * Scores one already-frozen prediction. This function does not read reference
 * data, run recognition, mutate state, or remove failed rows from a denominator.
 */
export function scoreNoFullProviderJointTitleCard(sample = {}, {
  gate = noFullProviderJointTitleGate
} = {}) {
  const reasons = [];
  const itemId = cleanText(sample.item_id || sample.id);
  const split = cleanText(sample.split).toLowerCase();
  const finalTitleTypeValid = typeof sample.final_title === "string";
  const finalTitle = String(sample.final_title ?? "");
  const titlePresent = finalTitleTypeValid && cleanText(finalTitle) !== "";
  const titleCharacterCount = codePointLength(finalTitle);
  const titleWithinLimit = titlePresent
    && titleCharacterCount <= gate.maximum_title_characters;
  const recall = finiteNumber(sample.policy_fair_token_recall);
  const recallObserved = recall !== null && recall >= 0 && recall <= 1;
  const recallPass = recallObserved
    && recall >= gate.minimum_card_policy_fair_token_recall;
  const criticalGuard = scoreTitleCriticalGuard(sample);
  const terminalL2 = cleanText(sample.job_status).toUpperCase() === "L2_READY";
  const identityStatus = cleanText(sample.identity_resolution_status).toUpperCase();
  const nonAbstain = identityStatus === "CONFIRMED" || identityStatus === "RESOLVED";
  const timedOut = sample.timed_out === true;

  const writerVisibleMs = finiteNumber(sample.writer_visible_ms);
  const writerTimingObserved = writerVisibleMs !== null && writerVisibleMs >= 0;
  const writerDeadlineMet = writerTimingObserved
    && writerVisibleMs <= gate.maximum_writer_visible_ms
    && !timedOut;

  const fullProviderCalls = finiteNumber(sample.full_provider_calls);
  const fullProviderDisabled = fullProviderCalls === 0;
  const googleAnnotateRequests = finiteNumber(sample.google_vision_annotate_requests);
  const googleAnnotateOnce = googleAnnotateRequests === 1;
  const cacheMemory = cacheMemoryChecks(sample);

  addReason(reasons, itemId !== "", "ITEM_ID_MISSING");
  addReason(reasons, allowedSplits.has(split), split === "holdout" ? "HOLDOUT_FORBIDDEN" : "INVALID_SPLIT");
  addReason(reasons, terminalL2, "L2_READY_MISSING");
  addReason(reasons, nonAbstain, identityStatus === "ABSTAIN" ? "ABSTAIN" : "IDENTITY_RESOLUTION_STATUS_MISSING_OR_INVALID");
  addReason(reasons, finalTitleTypeValid, "FINAL_TITLE_NOT_A_STRING");
  addReason(reasons, titlePresent, "FINAL_TITLE_MISSING");
  addReason(reasons, titleWithinLimit, titlePresent ? "FINAL_TITLE_OVER_80_CHARACTERS" : "FINAL_TITLE_LENGTH_UNAVAILABLE");
  addReason(reasons, recallObserved, "POLICY_FAIR_TOKEN_RECALL_MISSING_OR_INVALID");
  addReason(reasons, recallPass, recallObserved ? "POLICY_FAIR_TOKEN_RECALL_BELOW_0_72" : "POLICY_FAIR_TOKEN_RECALL_GATE_UNAVAILABLE");
  addReason(reasons, criticalGuard.object_present, "TITLE_CRITICAL_GUARD_MISSING");
  addReason(reasons, criticalGuard.complete, "TITLE_CRITICAL_GUARD_INCOMPLETE");
  addReason(reasons, criticalGuard.catastrophic_false, "TITLE_CRITICAL_CATASTROPHE_PRESENT_OR_UNKNOWN");
  addReason(reasons, criticalGuard.critical_fabrication_false, "TITLE_CRITICAL_FABRICATION_PRESENT_OR_UNKNOWN");
  addReason(reasons, writerTimingObserved, "WRITER_VISIBLE_TIMING_MISSING_OR_INVALID");
  addReason(reasons, !timedOut, "RECOGNITION_TIMED_OUT");
  addReason(reasons, writerDeadlineMet, writerTimingObserved ? "WRITER_VISIBLE_DEADLINE_EXCEEDED" : "WRITER_VISIBLE_DEADLINE_UNAVAILABLE");
  addReason(reasons, fullProviderDisabled, fullProviderCalls === null ? "FULL_PROVIDER_CALL_COUNT_MISSING" : "FULL_PROVIDER_CALL_FORBIDDEN");
  addReason(reasons, googleAnnotateOnce, googleAnnotateRequests === null ? "GOOGLE_ANNOTATE_COUNT_MISSING" : "GOOGLE_ANNOTATE_COUNT_EXPECTED_1");
  for (const [key, pass] of Object.entries(cacheMemory.disabled)) {
    addReason(reasons, pass, `BENCHMARK_CONTROL_NOT_DISABLED:${key}`);
  }
  for (const [key, pass] of Object.entries(cacheMemory.misses)) {
    addReason(reasons, pass, `CACHE_OR_MEMORY_HIT_NOT_FALSE:${key}`);
  }

  const titleCorrect = terminalL2
    && nonAbstain
    && titleWithinLimit
    && recallPass
    && criticalGuard.complete
    && criticalGuard.catastrophic_false
    && criticalGuard.critical_fabrication_false;
  const executionCompliant = fullProviderDisabled
    && googleAnnotateOnce
    && cacheMemory.pass;
  const jointSuccess = allowedSplits.has(split)
    && itemId !== ""
    && titleCorrect
    && writerDeadlineMet
    && executionCompliant;

  return {
    schema_version: noFullProviderJointTitleGateContractVersion,
    item_id: itemId,
    split,
    final_title: finalTitle,
    title_character_count: titleCharacterCount,
    policy_fair_token_recall: recallObserved ? recall : null,
    writer_visible_ms: writerTimingObserved ? writerVisibleMs : null,
    title_correct: titleCorrect,
    writer_deadline_met: writerDeadlineMet,
    execution_compliant: executionCompliant,
    joint_success: jointSuccess,
    checks: {
      terminal_l2: terminalL2,
      non_abstain: nonAbstain,
      final_title_type_valid: finalTitleTypeValid,
      title_present: titlePresent,
      title_within_limit: titleWithinLimit,
      policy_fair_token_recall_observed: recallObserved,
      policy_fair_token_recall_pass: recallPass,
      title_critical_guard: criticalGuard,
      writer_timing_observed: writerTimingObserved,
      writer_deadline_met: writerDeadlineMet,
      full_provider_disabled: fullProviderDisabled,
      google_annotate_once: googleAnnotateOnce,
      cache_memory: cacheMemory
    },
    failure_reasons: [...new Set(reasons)]
  };
}

function splitSummary(rows, split, gate) {
  const expected = gate.splits[split];
  const subset = rows.filter((row) => row.split === split);
  const jointSuccessCount = subset.filter((row) => row.joint_success).length;
  // Missing/invalid recall is zero, rather than silently disappearing from the
  // average and making a broken prediction packet look stronger.
  const recallAverage = average(subset.map((row) => (
    row.policy_fair_token_recall === null ? 0 : row.policy_fair_token_recall
  )));
  const cardinalityPass = subset.length === expected.expected_denominator;
  const jointCountPass = jointSuccessCount >= expected.required_joint_success_count;
  const recallAveragePass = recallAverage !== null
    && recallAverage + floatingPointTolerance
      >= gate.minimum_split_policy_fair_token_recall_average;
  return {
    split,
    denominator: subset.length,
    expected_denominator: expected.expected_denominator,
    required_joint_success_count: expected.required_joint_success_count,
    joint_success_count: jointSuccessCount,
    joint_success_rate: rate(jointSuccessCount, subset.length),
    policy_fair_token_recall_average: recallAverage,
    cardinality_pass: cardinalityPass,
    joint_success_count_pass: jointCountPass,
    policy_fair_token_recall_average_pass: recallAveragePass,
    pass: cardinalityPass && jointCountPass && recallAveragePass
  };
}

/**
 * Evaluates the two frozen public tuning splits. Passing holdout or an unknown
 * split is a contract error, not an excluded row. Duplicate IDs are rejected so
 * a caller cannot inflate the numerator by replaying a successful card.
 */
export function evaluateNoFullProviderJointTitleGate(samples = [], {
  gate = noFullProviderJointTitleGate
} = {}) {
  if (!Array.isArray(samples)) throw new TypeError("samples must be an array");
  const sourceSplits = samples.map((sample) => cleanText(sample?.split).toLowerCase());
  if (sourceSplits.includes("holdout")) throw new Error("HOLDOUT_FORBIDDEN");
  const invalidSplit = sourceSplits.find((split) => !allowedSplits.has(split));
  if (invalidSplit !== undefined) throw new Error(`INVALID_SPLIT:${invalidSplit || "missing"}`);

  const itemIds = samples.map((sample) => cleanText(sample?.item_id || sample?.id));
  if (itemIds.some((itemId) => itemId === "")) throw new Error("ITEM_ID_MISSING");
  const seen = new Set();
  for (const itemId of itemIds) {
    if (seen.has(itemId)) throw new Error(`DUPLICATE_ITEM_ID:${itemId}`);
    seen.add(itemId);
  }

  const rows = samples.map((sample) => scoreNoFullProviderJointTitleCard(sample, { gate }));
  const splits = Object.fromEntries(Object.keys(gate.splits).map((split) => (
    [split, splitSummary(rows, split, gate)]
  )));
  const blockers = [];
  for (const [split, summary] of Object.entries(splits)) {
    if (!summary.cardinality_pass) blockers.push(`${split.toUpperCase()}_CARDINALITY_MISMATCH`);
    if (!summary.joint_success_count_pass) blockers.push(`${split.toUpperCase()}_JOINT_SUCCESS_BELOW_REQUIRED_COUNT`);
    if (!summary.policy_fair_token_recall_average_pass) {
      blockers.push(`${split.toUpperCase()}_POLICY_FAIR_TOKEN_RECALL_AVERAGE_BELOW_0_85`);
    }
  }

  return {
    schema_version: noFullProviderJointTitleGateContractVersion,
    route: gate.route,
    status: Object.values(splits).every((summary) => summary.pass) ? "GO" : "NO_GO",
    gate,
    denominator: rows.length,
    joint_success_count: rows.filter((row) => row.joint_success).length,
    joint_success_rate: rate(rows.filter((row) => row.joint_success).length, rows.length),
    splits,
    blockers,
    rows
  };
}

export const __noFullProviderJointTitleGateTestHooks = Object.freeze({
  allowedSplits,
  cacheMemoryChecks,
  codePointLength,
  finiteNumber,
  floatingPointTolerance,
  requiredDisabledControls,
  requiredMissObservations,
  scoreTitleCriticalGuard,
  splitSummary
});
