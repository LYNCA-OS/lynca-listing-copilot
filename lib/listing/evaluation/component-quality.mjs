export const failureRootCauseCodes = Object.freeze({
  CAPTURE_FAILURE: "CAPTURE_FAILURE",
  PERCEPTION_FAILURE: "PERCEPTION_FAILURE",
  KNOWLEDGE_GAP: "KNOWLEDGE_GAP",
  CANDIDATE_MISS: "CANDIDATE_MISS",
  SOLVER_ERROR: "SOLVER_ERROR",
  GATE_FALSE_REJECT: "GATE_FALSE_REJECT",
  GATE_FALSE_ACCEPT: "GATE_FALSE_ACCEPT",
  RENDERER_ERROR: "RENDERER_ERROR",
  PROVIDER_FAILURE: "PROVIDER_FAILURE"
});

export const accuracyFactorIds = Object.freeze([
  "evidence_recall",
  "candidate_recall",
  "solver_accuracy",
  "decision_quality",
  "renderer_fidelity"
]);

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isIdentityAbstain(item = {}) {
  return item.identity_resolution_status === "ABSTAIN"
    || item.prediction?.identity_resolution_status === "ABSTAIN";
}

function isAccepted(item = {}) {
  return item.status === "evaluated" && !isIdentityAbstain(item);
}

function isAllInSuccess(item = {}) {
  return isAccepted(item) && item.corrected_title_comparison?.critical_title_error !== true;
}

function hasCriticalTitleError(item = {}) {
  return item.corrected_title_comparison?.critical_title_error === true;
}

function candidateRecallValue(item = {}) {
  const metrics = item.identity_resolution_summary?.candidate_identity_report?.metrics
    || item.candidate_identity_report?.metrics
    || {};
  const value = metrics.candidate_recall_at_k;
  return typeof value === "boolean" ? value : null;
}

function candidateSelectedKnown(item = {}) {
  return Boolean(
    item.identity_resolution_summary?.candidate_identity_report?.selected_candidate_id
    || item.candidate_identity_report?.selected_candidate_id
  );
}

function abstainReasonCodes(item = {}) {
  return [
    ...(Array.isArray(item.abstain_reason_codes) ? item.abstain_reason_codes : []),
    ...(Array.isArray(item.identity_resolution_summary?.abstain_reason_codes) ? item.identity_resolution_summary.abstain_reason_codes : [])
  ];
}

function traceText(item = {}) {
  return JSON.stringify([
    item.route,
    item.error_code,
    item.error,
    item.recognition_preflight_error,
    item.identity_resolution_summary?.conflict_map,
    item.completion_trace,
    abstainReasonCodes(item)
  ]).toLowerCase();
}

export function rootCauseCodesForResult(item = {}) {
  if (isAllInSuccess(item)) return [];

  const causes = [];
  const text = traceText(item);

  if (item.status === "invalid_candidate") causes.push(failureRootCauseCodes.CAPTURE_FAILURE);
  if (item.status === "provider_error") causes.push(failureRootCauseCodes.PROVIDER_FAILURE);

  if (/low_image_quality|missing_back_image|rescan|glare|occluded|blur|image/.test(text)
    && item.status !== "provider_error") {
    causes.push(failureRootCauseCodes.CAPTURE_FAILURE);
  }

  const recall = candidateRecallValue(item);
  if (recall === false) causes.push(failureRootCauseCodes.CANDIDATE_MISS);
  if (recall === true && hasCriticalTitleError(item)) causes.push(failureRootCauseCodes.SOLVER_ERROR);
  if (!candidateSelectedKnown(item) && /no_catalog_candidate|catalog|checklist|registry|knowledge/.test(text)) {
    causes.push(failureRootCauseCodes.KNOWLEDGE_GAP);
  }

  if (isIdentityAbstain(item)) {
    if (item.corrected_title_comparison && !hasCriticalTitleError(item)) {
      causes.push(failureRootCauseCodes.GATE_FALSE_REJECT);
    } else if (/no_catalog_candidate|knowledge|catalog/.test(text)) {
      causes.push(failureRootCauseCodes.KNOWLEDGE_GAP);
    }
  }

  if (isAccepted(item) && hasCriticalTitleError(item)) {
    causes.push(failureRootCauseCodes.GATE_FALSE_ACCEPT);
  }

  const comparison = item.corrected_title_comparison || {};
  if (comparison.wrong_year || comparison.wrong_serial || comparison.wrong_grade || comparison.unexpected_color) {
    causes.push(failureRootCauseCodes.PERCEPTION_FAILURE);
  }

  if (item.status === "evaluated"
    && !hasCriticalTitleError(item)
    && comparison.corrected_title_exact === false
    && Number(comparison.token_recall || 0) < 0.72) {
    causes.push(failureRootCauseCodes.RENDERER_ERROR);
  }

  if (!causes.length && item.status !== "evaluated") causes.push(failureRootCauseCodes.PROVIDER_FAILURE);
  if (!causes.length) causes.push(failureRootCauseCodes.SOLVER_ERROR);

  return unique(causes);
}

export function annotateEvaluationRootCauses(results = []) {
  return results.map((item) => ({
    ...item,
    root_cause_codes: rootCauseCodesForResult(item)
  }));
}

function countsByCause(results = []) {
  const counts = Object.fromEntries(Object.values(failureRootCauseCodes).map((code) => [code, 0]));
  results.forEach((item) => {
    (item.root_cause_codes || rootCauseCodesForResult(item)).forEach((code) => {
      counts[code] = (counts[code] || 0) + 1;
    });
  });
  return counts;
}

export function rootCauseSummary(results = []) {
  const failed = results.filter((item) => !isAllInSuccess(item));
  const counts = countsByCause(failed);
  return {
    taxonomy: Object.values(failureRootCauseCodes),
    failed_count: failed.length,
    counts,
    rates: Object.fromEntries(Object.entries(counts).map(([code, count]) => [code, rate(count, failed.length)]))
  };
}

export function componentQualityReport(results = [], {
  fieldGroundTruthAvailable = false
} = {}) {
  const attempted = results.length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const accepted = results.filter(isAccepted).length;
  const successes = results.filter(isAllInSuccess).length;
  const criticalErrors = results.filter((item) => item.status === "evaluated" && hasCriticalTitleError(item)).length;
  const gateFalseAccept = results.filter((item) => isAccepted(item) && hasCriticalTitleError(item)).length;
  const gateFalseReject = results.filter((item) => {
    return isIdentityAbstain(item)
      && item.corrected_title_comparison
      && !hasCriticalTitleError(item);
  }).length;
  const comparisons = results.map((item) => item.corrected_title_comparison).filter(Boolean);
  const candidateRecallValues = results.map(candidateRecallValue).filter((value) => value !== null);
  const candidateRecallHits = candidateRecallValues.filter(Boolean).length;
  const candidateRecallDenominator = candidateRecallValues.length;
  const solverEligible = results.filter((item) => candidateRecallValue(item) === true);
  const rendererRows = results.filter((item) => {
    return item.status === "evaluated"
      && /renderer/i.test(String(item.prediction?.title_render_source || ""));
  });

  const requiresReviewedGroundTruth = !fieldGroundTruthAvailable;

  return {
    model: "accuracy_factor_chain_v1",
    formula: "overall_accuracy ~= evidence_recall * candidate_recall * solver_accuracy * gate_quality * renderer_fidelity",
    reviewed_ground_truth_available: fieldGroundTruthAvailable,
    corrected_title_is_proxy_only: true,
    factors: {
      evidence_recall: {
        value: fieldGroundTruthAvailable ? average(comparisons.map((item) => item.token_recall)) : null,
        proxy_value: average(comparisons.map((item) => item.token_recall)),
        proxy_source: "corrected_title_token_recall",
        requires_reviewed_ground_truth: requiresReviewedGroundTruth
      },
      candidate_recall: {
        value: fieldGroundTruthAvailable ? rate(candidateRecallHits, candidateRecallDenominator) : null,
        proxy_value: rate(candidateRecallHits, candidateRecallDenominator),
        observed_denominator: candidateRecallDenominator,
        requires_reviewed_ground_truth: requiresReviewedGroundTruth
      },
      solver_accuracy: {
        value: fieldGroundTruthAvailable ? rate(solverEligible.filter(isAllInSuccess).length, solverEligible.length) : null,
        proxy_value: rate(solverEligible.filter(isAllInSuccess).length, solverEligible.length),
        observed_denominator: solverEligible.length,
        requires_reviewed_ground_truth: requiresReviewedGroundTruth
      },
      decision_quality: {
        value: fieldGroundTruthAvailable ? rate(successes, attempted) : null,
        proxy_value: rate(successes, attempted),
        gate_false_reject_count: gateFalseReject,
        gate_false_accept_count: gateFalseAccept,
        dangerous_error_rate: rate(gateFalseAccept, accepted),
        coverage_rate: rate(accepted, attempted),
        abstain_rate: rate(results.filter(isIdentityAbstain).length, attempted),
        requires_reviewed_ground_truth: requiresReviewedGroundTruth
      },
      renderer_fidelity: {
        value: fieldGroundTruthAvailable ? average(comparisons.map((item) => item.token_precision)) : null,
        proxy_value: average(comparisons.map((item) => item.token_precision)),
        rendered_rows: rendererRows.length,
        requires_reviewed_ground_truth: requiresReviewedGroundTruth
      }
    },
    counts: {
      attempted,
      evaluated,
      accepted,
      all_in_success: successes,
      critical_error: criticalErrors
    }
  };
}
