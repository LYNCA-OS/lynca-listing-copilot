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

export const primaryRootCauseCodes = Object.freeze({
  SUCCESS: "SUCCESS",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
  PERCEPTION_FAILURE: "PERCEPTION_FAILURE",
  CANDIDATE_MISS: "CANDIDATE_MISS",
  SOLVER_ERROR: "SOLVER_ERROR",
  GATE_FALSE_REJECT: "GATE_FALSE_REJECT",
  GATE_FALSE_ACCEPT: "GATE_FALSE_ACCEPT",
  RENDERER_ERROR: "RENDERER_ERROR",
  CAPTURE_FAILURE: "CAPTURE_FAILURE"
});

export const gateFalseRejectSubtypes = Object.freeze({
  GATE_CONSERVATIVE_RECOVERABLE: "GATE_CONSERVATIVE_RECOVERABLE",
  GATE_INFO_INSUFFICIENT: "GATE_INFO_INSUFFICIENT"
});

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

function gateHasWorkflowSignal(gate = {}) {
  return Boolean(gate.status || gate.workflow_route || typeof gate.writer_review_ready === "boolean");
}

function gateAcceptsForWriter(item = {}) {
  if (item.status !== "evaluated") return false;
  const gate = publicationGate(item);
  if (!gateHasWorkflowSignal(gate)) return !isIdentityAbstain(item);
  const route = gate.workflow_route || gate.status;
  return gate.writer_review_ready === true
    || gate.writer_quick_approval_ready === true
    || [
      "LOW_TOUCH_REVIEW",
      "STANDARD_REVIEW",
      "DEEP_REVIEW",
      "WRITER_QUICK_APPROVAL_READY",
      "WRITER_REVIEW_READY"
    ].includes(route);
}

function gateRejectsForWriter(item = {}) {
  if (item.status !== "evaluated") return false;
  const gate = publicationGate(item);
  if (!gateHasWorkflowSignal(gate)) return isIdentityAbstain(item);
  return !gateAcceptsForWriter(item);
}

function isAccepted(item = {}) {
  return gateAcceptsForWriter(item);
}

function isAllInSuccess(item = {}) {
  return isAccepted(item) && item.corrected_title_comparison?.critical_title_error !== true;
}

function hasCriticalTitleError(item = {}) {
  return item.corrected_title_comparison?.critical_title_error === true;
}

function publicationGate(item = {}) {
  return item.publication_gate || item.output?.publication_gate || item.prediction?.publication_gate || {};
}

function fieldLevelPublication(item = {}) {
  return publicationGate(item).field_level_publication || item.field_level_publication || {};
}

function writerReviewItems(item = {}) {
  return Array.isArray(publicationGate(item).writer_review_items)
    ? publicationGate(item).writer_review_items
    : [];
}

function writerRequiredFields(item = {}) {
  return Array.isArray(publicationGate(item).writer_required_fields)
    ? publicationGate(item).writer_required_fields
    : [];
}

function hasExplicitRendererFieldError(item = {}) {
  const diagnostics = item.renderer_diagnostics || item.prediction?.renderer_diagnostics || {};
  const omitted = diagnostics.required_field_omissions || diagnostics.field_omissions || [];
  return item.renderer_field_error === true
    || item.prediction?.renderer_field_error === true
    || item.renderer_required_field_omission === true
    || item.prediction?.renderer_required_field_omission === true
    || (Array.isArray(omitted) && omitted.length > 0);
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

function hasAbstainReason(item = {}, code) {
  return abstainReasonCodes(item).includes(code);
}

function focusedRereadAttempted(item = {}) {
  const trace = Array.isArray(item.completion_trace) ? item.completion_trace : [];
  return trace.some((entry) => /^CROP_AND_READ/.test(String(entry?.action || "")));
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

  if (gateRejectsForWriter(item)) {
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

  if (item.status === "evaluated" && hasExplicitRendererFieldError(item)) {
    causes.push(failureRootCauseCodes.RENDERER_ERROR);
  }

  if (!causes.length && item.status !== "evaluated") causes.push(failureRootCauseCodes.PROVIDER_FAILURE);
  if (!causes.length) causes.push(failureRootCauseCodes.SOLVER_ERROR);

  return unique(causes);
}

export function annotateEvaluationRootCauses(results = []) {
  return results.map((item) => ({
    ...item,
    primary_root_cause_code: primaryRootCauseCodeForResult(item),
    secondary_root_cause_codes: secondaryRootCauseCodesForResult(item),
    root_cause_codes: rootCauseCodesForResult(item),
    gate_false_reject_subtype: gateFalseRejectSubtypeForResult(item)
  }));
}

export function primaryRootCauseCodeForResult(item = {}) {
  if (isAllInSuccess(item)) return primaryRootCauseCodes.SUCCESS;
  if (item.status === "provider_error") return primaryRootCauseCodes.PROVIDER_FAILURE;
  if (item.status === "invalid_candidate") return primaryRootCauseCodes.CAPTURE_FAILURE;
  if (isAccepted(item) && hasCriticalTitleError(item)) return primaryRootCauseCodes.GATE_FALSE_ACCEPT;

  const recall = candidateRecallValue(item);
  if (recall === false) return primaryRootCauseCodes.CANDIDATE_MISS;
  if (recall === true && hasCriticalTitleError(item)) return primaryRootCauseCodes.SOLVER_ERROR;

  if (gateRejectsForWriter(item) && item.corrected_title_comparison && !hasCriticalTitleError(item)) {
    return primaryRootCauseCodes.GATE_FALSE_REJECT;
  }

  const comparison = item.corrected_title_comparison || {};
  if (comparison.wrong_year || comparison.wrong_serial || comparison.wrong_grade || comparison.unexpected_color) {
    return primaryRootCauseCodes.PERCEPTION_FAILURE;
  }

  if (item.status === "evaluated" && hasExplicitRendererFieldError(item)) {
    return primaryRootCauseCodes.RENDERER_ERROR;
  }

  return primaryRootCauseCodes.SOLVER_ERROR;
}

export function secondaryRootCauseCodesForResult(item = {}) {
  return rootCauseCodesForResult(item).filter((code) => code !== primaryRootCauseCodeForResult(item));
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

function countsByPrimaryCause(results = []) {
  const counts = Object.fromEntries(Object.values(primaryRootCauseCodes).map((code) => [code, 0]));
  results.forEach((item) => {
    const code = item.primary_root_cause_code || primaryRootCauseCodeForResult(item);
    counts[code] = (counts[code] || 0) + 1;
  });
  return counts;
}

function candidateIdentityReport(item = {}) {
  return item.identity_resolution_summary?.candidate_identity_report
    || item.candidate_identity_report
    || {};
}

function selectedCandidateKnown(item = {}) {
  return Boolean(candidateIdentityReport(item).selected_candidate_id);
}

function proxyCorrect(item = {}) {
  return item.corrected_title_comparison && !hasCriticalTitleError(item);
}

export function gateFalseRejectSubtypeForResult(item = {}) {
  if (!gateRejectsForWriter(item) || !proxyCorrect(item)) return null;

  const gate = publicationGate(item);
  const fieldPublication = fieldLevelPublication(item);
  const reviewItems = writerReviewItems(item);
  const reviewText = JSON.stringify([
    reviewItems,
    gate.blocked_reasons,
    abstainReasonCodes(item),
    item.route,
    item.prediction?.unresolved
  ]).toLowerCase();
  const requiredFields = new Set(writerRequiredFields(item));
  const coreMissing = reviewItems.some((reviewItem) => {
    return ["year", "product", "players", "character"].includes(reviewItem.field)
      && /missing_evidence|missing evidence|no_information|unreadable|manual_required/.test(String(reviewItem.resolution_reason || "").toLowerCase());
  });
  const noUsableDraft = gate.writer_review_ready !== true
    || fieldPublication.writer_can_start === false
    || Number(fieldPublication.usable_field_count || 0) === 0;
  const missingSubjectOrProduct = ["product", "players", "character"].some((field) => requiredFields.has(field))
    && /missing_evidence|missing evidence|no_information|unreadable/.test(reviewText);

  if (noUsableDraft || coreMissing || missingSubjectOrProduct) {
    return gateFalseRejectSubtypes.GATE_INFO_INSUFFICIENT;
  }
  return gateFalseRejectSubtypes.GATE_CONSERVATIVE_RECOVERABLE;
}

function rootCauseCrossTabs(results = []) {
  const gateRejectSubtypes = Object.fromEntries(Object.values(gateFalseRejectSubtypes).map((code) => [code, 0]));
  results.forEach((item) => {
    const subtype = item.gate_false_reject_subtype || gateFalseRejectSubtypeForResult(item);
    if (subtype) gateRejectSubtypes[subtype] = (gateRejectSubtypes[subtype] || 0) + 1;
  });

  return {
    no_catalog_candidate_proxy_correct_abstain: results.filter((item) => {
      return gateRejectsForWriter(item)
        && hasAbstainReason(item, "NO_CATALOG_CANDIDATE")
        && proxyCorrect(item);
    }).length,
    candidate_present_proxy_correct_abstain: results.filter((item) => {
      return gateRejectsForWriter(item)
        && selectedCandidateKnown(item)
        && proxyCorrect(item);
    }).length,
    accepted_critical_error: results.filter((item) => isAccepted(item) && hasCriticalTitleError(item)).length,
    resolved_identity_proxy_correct_rendered_title_incorrect: results.filter((item) => {
      const comparison = item.corrected_title_comparison || {};
      return item.status === "evaluated"
        && gateAcceptsForWriter(item)
        && !hasCriticalTitleError(item)
        && comparison.corrected_title_exact === false
        && /renderer/i.test(String(item.prediction?.title_render_source || ""));
    }).length,
    perception_error_focused_reread_attempted: results.filter((item) => {
      const comparison = item.corrected_title_comparison || {};
      return focusedRereadAttempted(item)
        && (comparison.wrong_year || comparison.wrong_serial || comparison.wrong_grade || comparison.unexpected_color);
    }).length,
    gate_false_reject_recoverable: gateRejectSubtypes.GATE_CONSERVATIVE_RECOVERABLE,
    gate_false_reject_info_insufficient: gateRejectSubtypes.GATE_INFO_INSUFFICIENT
  };
}

export function gateConfusionMatrix(results = []) {
  const matrix = {
    true_accept: 0,
    false_accept: 0,
    true_reject: 0,
    false_reject: 0,
    unlabeled_accept: 0,
    unlabeled_reject: 0
  };
  results.forEach((item) => {
    if (item.status !== "evaluated") return;
    const hasProxyLabel = Boolean(item.corrected_title_comparison);
    const accepted = gateAcceptsForWriter(item);
    const criticalError = hasCriticalTitleError(item);
    if (!hasProxyLabel) {
      if (accepted) matrix.unlabeled_accept += 1;
      else matrix.unlabeled_reject += 1;
      return;
    }
    if (accepted && !criticalError) matrix.true_accept += 1;
    else if (accepted && criticalError) matrix.false_accept += 1;
    else if (!accepted && criticalError) matrix.true_reject += 1;
    else matrix.false_reject += 1;
  });
  const labeled = matrix.true_accept + matrix.false_accept + matrix.true_reject + matrix.false_reject;
  return {
    ...matrix,
    accepted_precision: rate(matrix.true_accept, matrix.true_accept + matrix.false_accept),
    correct_accept_recall: rate(matrix.true_accept, matrix.true_accept + matrix.false_reject),
    critical_error_rejection_rate: rate(matrix.true_reject, matrix.true_reject + matrix.false_accept),
    labeled_count: labeled
  };
}

export function rootCauseSummary(results = []) {
  const failed = results.filter((item) => !isAllInSuccess(item));
  const counts = countsByCause(failed);
  const primaryCounts = countsByPrimaryCause(results);
  return {
    taxonomy: Object.values(failureRootCauseCodes),
    primary_taxonomy: Object.values(primaryRootCauseCodes),
    failed_count: failed.length,
    primary_counts: primaryCounts,
    primary_rates: Object.fromEntries(Object.entries(primaryCounts).map(([code, count]) => [code, rate(count, results.length)])),
    counts,
    rates: Object.fromEntries(Object.entries(counts).map(([code, count]) => [code, rate(count, failed.length)])),
    counting_semantics: {
      primary_counts: "mutually_exclusive_one_bucket_per_card",
      counts: "multi_label_secondary_compatible_counts_do_not_sum"
    },
    gate_false_reject_subtypes: Object.fromEntries(Object.values(gateFalseRejectSubtypes).map((code) => [
      code,
      results.filter((item) => {
        const subtype = item.gate_false_reject_subtype || gateFalseRejectSubtypeForResult(item);
        return subtype === code;
      }).length
    ])),
    gate_confusion_matrix: gateConfusionMatrix(results),
    cross_tabs: rootCauseCrossTabs(results)
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
    return gateRejectsForWriter(item)
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
    corrected_title_token_similarity_is_renderer_diagnostic_only: true,
    gate_confusion_matrix: gateConfusionMatrix(results),
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
        manual_required_rate: rate(results.filter(gateRejectsForWriter).length, attempted),
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
