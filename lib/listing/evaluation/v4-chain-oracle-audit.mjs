import {
  canonicalSemPrediction,
  normalizeGoldenSemValue
} from "./golden-sem-accuracy.mjs";

export const v4ChainOracleTraceSchemaVersion = "v4-chain-oracle-trace-v1";
export const v4ChainOracleReportSchemaVersion = "v4-chain-oracle-audit-v1";
export const v4ChainOracleFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "print_finish",
  "numerical_rarity",
  "grading_info"
]);

const excludedStatuses = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value).some(hasValue);
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["cards", "results", "items", "records"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function rowId(row = {}) {
  return cleanText(row.query_card_id || row.item_id || row.asset_id || row.card_id || row.source_feedback_id).toLowerCase();
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function truthStatus(item = {}, field) {
  const explicit = cleanText(item.reviewed_ground_truth?.field_statuses?.[field]).toUpperCase();
  if (explicit) return explicit;
  const record = item.reviewed_ground_truth?.fields?.[field];
  const recordStatus = cleanText(plainObject(record).reviewed_status).toUpperCase();
  if (recordStatus) return recordStatus;
  const value = plainObject(record).reviewed_value ?? record;
  const marker = cleanText(value).toUpperCase();
  return excludedStatuses.has(marker) ? marker : "CONFIRMED";
}

function truthFields(item = {}) {
  return Object.fromEntries(v4ChainOracleFields.flatMap((field) => {
    if (excludedStatuses.has(truthStatus(item, field))) return [];
    const record = item.reviewed_ground_truth?.fields?.[field];
    const value = plainObject(record).reviewed_value ?? record;
    return [[field, value]];
  }));
}

function exact(field, expected, actual) {
  if (field !== "subject" && Array.isArray(actual)) {
    return actual.some((value) => exact(field, expected, value));
  }
  if (field !== "subject" && Array.isArray(expected)) {
    return expected.some((value) => exact(field, value, actual));
  }
  return normalizeGoldenSemValue(field, expected) === normalizeGoldenSemValue(field, actual);
}

function applicationValueExact(field, expected, actual) {
  if (Array.isArray(actual)) return actual.some((value) => applicationValueExact(field, expected, value));
  if (Array.isArray(expected)) return expected.some((value) => applicationValueExact(field, value, actual));
  if (field !== "numerical_rarity") return exact(field, expected, actual);
  const denominator = (value) => {
    const normalized = cleanText(normalizeGoldenSemValue(field, value));
    const match = normalized.match(/(?:^|\/)(\d{1,5})$/);
    return match?.[1] || "";
  };
  const left = denominator(expected);
  const right = denominator(actual);
  return Boolean(left && right && left === right);
}

function normalizedFieldMap(input = {}) {
  return canonicalSemPrediction({ resolved_fields: plainObject(input) });
}

function evidenceObservations(trace = {}) {
  const evidence = trace.evidence_observations || trace.evidence || trace.sensor_evidence || [];
  return rows(evidence).map((entry, index) => ({
    evidence_id: cleanText(entry.evidence_id || entry.id) || `evidence-${index + 1}`,
    source: cleanText(entry.source || entry.sensor || entry.action) || "UNKNOWN",
    fields: normalizedFieldMap(entry.fields || entry.field_predictions || entry.resolved_fields),
    raw_text: cleanText(entry.raw_text || entry.observed_text || entry.text)
  }));
}

function rawEvidenceContains(field, expected, rawText) {
  const expectedText = cleanText(normalizeGoldenSemValue(field, expected)).toLowerCase();
  const observedText = cleanText(rawText).toLowerCase();
  if (!expectedText || !observedText) return false;
  const canonical = (value) => value.replace(/[^a-z0-9]+/g, " ").trim();
  const needle = canonical(expectedText);
  const haystack = ` ${canonical(observedText)} `;
  return needle.length >= 2 && haystack.includes(` ${needle} `);
}

function retrievalCandidates(trace = {}) {
  const candidates = trace.retrieval_candidates || trace.retrieval?.candidates || [];
  return rows(candidates).map((candidate, index) => ({
    candidate_id: cleanText(candidate.candidate_id || candidate.id) || `candidate-${index + 1}`,
    identity_id: cleanText(candidate.identity_id || candidate.card_identity_id) || null,
    rank: Number.isFinite(Number(candidate.rank)) ? Number(candidate.rank) : index + 1,
    source: cleanText(candidate.source || candidate.provider) || null,
    fields: normalizedFieldMap(candidate.fields || candidate.resolved_fields)
  })).sort((left, right) => left.rank - right.rank);
}

function applicationDecisions(trace = {}) {
  const decisions = trace.application_decisions || trace.candidate_application?.decisions || [];
  return rows(decisions).map((decision) => {
    const sourceField = cleanText(decision.source_field || decision.field);
    const resolverField = cleanText(decision.field);
    const sourceValue = decision.value ?? decision.candidate_value ?? decision.applied_value;
    const normalizedValue = normalizedFieldMap({ [sourceField]: sourceValue });
    const impactedFields = v4ChainOracleFields.filter((field) => (
      field === sourceField || field === resolverField || hasValue(normalizedValue[field])
    ));
    return {
      candidate_id: cleanText(decision.candidate_id),
      resolver_field: resolverField,
      source_field: sourceField,
      value: sourceValue,
      old_value: decision.old_value,
      old_value_instrumented: Object.hasOwn(decision, "old_value"),
      impacted_fields: impactedFields,
      planned: cleanText(decision.decision).toUpperCase() === "APPLY",
      applied: decision.applied === true || decision.applied_to_final === true,
      supported: decision.supported_final === true,
      reason: cleanText(decision.reason || decision.decision_reason) || null
    };
  }).filter((decision) => decision.impacted_fields.length);
}

function applicationFieldMap(decisions = [], valueKey = "value", fieldMode = "source") {
  return normalizedFieldMap(Object.fromEntries(decisions.flatMap((decision) => {
    const value = decision[valueKey];
    return value === null || value === undefined || value === ""
      ? []
      : [[fieldMode === "resolver" ? decision.resolver_field : decision.source_field, value]];
  })));
}

function metricRecord() {
  return { numerator: 0, denominator: 0, rate: null };
}

function finalizeMetric(metric) {
  return { ...metric, rate: rate(metric.numerator, metric.denominator) };
}

function truthRetrievalIds(item = {}) {
  const retrievalTruth = plainObject(item.retrieval_ground_truth);
  return [...new Set([
    ...(Array.isArray(retrievalTruth.accepted_identity_ids) ? retrievalTruth.accepted_identity_ids : []),
    ...(Array.isArray(retrievalTruth.accepted_candidate_ids) ? retrievalTruth.accepted_candidate_ids : []),
    item.card_identity_id
  ].map(cleanText).filter(Boolean))];
}

function sealedSourceRetrievalIds(item = {}) {
  const retrievalTruth = plainObject(item.retrieval_ground_truth);
  return [...new Set((Array.isArray(retrievalTruth.sealed_source_candidate_ids)
    ? retrievalTruth.sealed_source_candidate_ids
    : []).map(cleanText).filter(Boolean))];
}

function candidateIsCorrect(candidate, truthIds) {
  return Boolean(candidate && truthIds.some((id) => candidate.identity_id === id || candidate.candidate_id === id));
}

function identityFields(item = {}) {
  return plainObject(item.retrieval_ground_truth?.identity_fields);
}

function candidateMatchesIdentity(candidate, expected = {}) {
  if (!candidate) return false;
  const fields = candidate.fields || {};
  const comparisons = Object.entries(expected).flatMap(([field, value]) => {
    if (!hasValue(value)) return [];
    if (field === "serial_denominator") {
      return [[field, applicationValueExact("numerical_rarity", `/${value}`, fields.numerical_rarity)]];
    }
    return [[field, hasValue(fields[field]) && exact(field, value, fields[field])]];
  });
  return comparisons.length > 0 && comparisons.every(([, matches]) => matches);
}

function candidateMatchesTruth(candidate, truthIds, expectedIdentity) {
  return candidateIsCorrect(candidate, truthIds) || candidateMatchesIdentity(candidate, expectedIdentity);
}

function hasAnyOwn(object, keys) {
  return keys.some((key) => Object.hasOwn(object, key));
}

export function evaluateV4ChainOracleAudit({
  dataset = {},
  trace = {},
  independentIdentityOnly = false,
  now = () => new Date()
} = {}) {
  const allDatasetRows = rows(dataset);
  const evaluationRows = independentIdentityOnly
    ? allDatasetRows.filter((item) => item.retrieval_ground_truth?.retrieval_evaluable === true)
    : allDatasetRows;
  const traceById = new Map(rows(trace).map((row) => [rowId(row), row]));
  const evidenceOracle = metricRecord();
  const retrieval = Object.fromEntries([1, 5, 20].map((k) => [k, metricRecord()]));
  const selection = metricRecord();
  const applicationRecall = metricRecord();
  const applicationPrecision = metricRecord();
  const resolverFidelity = metricRecord();
  const rendererFidelity = metricRecord();
  const perField = Object.fromEntries(v4ChainOracleFields.map((field) => [field, {
    evidence_oracle: metricRecord(),
    safe_application_recall: metricRecord(),
    safe_application_precision: metricRecord(),
    resolver_fidelity: metricRecord(),
    renderer_fidelity: metricRecord()
  }]));
  const cards = [];
  let matchedTraceCount = 0;
  let retrievalIdentityEligibleCount = 0;
  let sealedSourceCandidateRetrievedCount = 0;
  let sealedSourceCandidateSelectedCount = 0;
  let reviewedTruthFieldCount = 0;
  const stageCoverage = Object.fromEntries([
    "evidence", "retrieval", "selection", "application", "resolver", "renderer"
  ].map((stage) => [stage, 0]));

  for (const item of evaluationRows) {
    const id = rowId(item);
    const cardTrace = traceById.get(id) || {};
    if (traceById.has(id)) matchedTraceCount += 1;
    const truth = truthFields(item);
    reviewedTruthFieldCount += Object.keys(truth).length;
    const truthIds = truthRetrievalIds(item);
    const expectedIdentity = identityFields(item);
    const sealedSourceIds = sealedSourceRetrievalIds(item);
    const tracePresent = traceById.has(id);
    const evidenceInstrumented = tracePresent && hasAnyOwn(cardTrace, ["evidence_observations", "evidence", "sensor_evidence"]);
    const retrievalInstrumented = tracePresent && (Object.hasOwn(cardTrace, "retrieval_candidates") || Object.hasOwn(plainObject(cardTrace.retrieval), "candidates"));
    const selectionInstrumented = tracePresent && (Object.hasOwn(cardTrace, "selected_candidate_id") || Object.hasOwn(plainObject(cardTrace.selection), "selected_candidate_id"));
    const applicationInstrumented = tracePresent && (Object.hasOwn(cardTrace, "application_decisions") || Object.hasOwn(plainObject(cardTrace.candidate_application), "decisions"));
    const resolverInstrumented = tracePresent && (Object.hasOwn(cardTrace, "resolver_fields") || Object.hasOwn(plainObject(cardTrace.resolver), "fields") || Object.hasOwn(cardTrace, "resolved_fields"));
    const rendererInstrumented = tracePresent && (Object.hasOwn(cardTrace, "renderer_fields") || Object.hasOwn(plainObject(cardTrace.renderer), "sem_fields") || Object.hasOwn(cardTrace, "rendered_sem_fields"));
    for (const [stage, instrumented] of Object.entries({
      evidence: evidenceInstrumented,
      retrieval: retrievalInstrumented,
      selection: selectionInstrumented,
      application: applicationInstrumented,
      resolver: resolverInstrumented,
      renderer: rendererInstrumented
    })) if (instrumented) stageCoverage[stage] += 1;
    const evidence = evidenceObservations(cardTrace);
    const candidates = retrievalCandidates(cardTrace);
    const selectedCandidateId = cleanText(cardTrace.selected_candidate_id || cardTrace.selection?.selected_candidate_id);
    const selectedCandidate = candidates.find((candidate) => candidate.candidate_id === selectedCandidateId) || null;
    const sealedSourceCandidates = candidates.filter((candidate) => candidateIsCorrect(candidate, sealedSourceIds));
    const selectedCandidateIsSealedSource = candidateIsCorrect(selectedCandidate, sealedSourceIds);
    if (sealedSourceCandidates.length) sealedSourceCandidateRetrievedCount += 1;
    if (selectedCandidateIsSealedSource) sealedSourceCandidateSelectedCount += 1;
    const downstreamTraceEligible = !selectedCandidateIsSealedSource;
    const retrievalCandidatesEligible = candidates.filter((candidate) => !candidateIsCorrect(candidate, sealedSourceIds));
    const retrievalEvaluable = item.retrieval_ground_truth?.retrieval_evaluable !== false
      && (truthIds.length > 0 || Object.keys(expectedIdentity).length > 0);
    const correctCandidate = retrievalEvaluable
      ? retrievalCandidatesEligible.find((candidate) => candidateMatchesTruth(candidate, truthIds, expectedIdentity)) || null
      : null;
    const applications = applicationDecisions(cardTrace);
    const resolver = normalizedFieldMap(cardTrace.resolver_fields || cardTrace.resolver?.fields || cardTrace.resolved_fields);
    const renderer = normalizedFieldMap(cardTrace.renderer_fields || cardTrace.renderer?.sem_fields || cardTrace.rendered_sem_fields);
    const selectedCandidateIds = new Set([
      selectedCandidateId,
      ...(Array.isArray(cardTrace.selected_candidate_group_ids) ? cardTrace.selected_candidate_group_ids : [])
    ].map(cleanText).filter(Boolean));
    const selectedCandidates = candidates.filter((candidate) => selectedCandidateIds.has(candidate.candidate_id));
    const fieldRows = {};

    for (const [field, expected] of Object.entries(truth)) {
      const evidenceSources = evidence.filter((entry) => (
        exact(field, expected, entry.fields[field])
        || rawEvidenceContains(field, expected, entry.raw_text)
      )).map((entry) => entry.source);
      const seen = evidenceSources.length > 0;
      if (evidenceInstrumented) {
        evidenceOracle.denominator += 1;
        perField[field].evidence_oracle.denominator += 1;
        if (seen) {
          evidenceOracle.numerator += 1;
          perField[field].evidence_oracle.numerator += 1;
        }
      }

      const selectedDecisions = applications.filter((decision) => (
        !decision.candidate_id || selectedCandidateIds.has(decision.candidate_id)
      ));
      const fieldDecisions = selectedDecisions.filter((decision) => decision.impacted_fields.includes(field));
      const selectedOldFields = applicationFieldMap(selectedDecisions, "old_value", "resolver");
      const selectedHasCorrectValue = selectedCandidates.some((candidate) => exact(field, expected, candidate.fields[field]));
      const appliedDecisions = fieldDecisions.filter((decision) => decision.applied);
      const applied = appliedDecisions.length > 0;
      const directApplied = appliedDecisions.find((decision) => decision.source_field === field);
      const appliedFields = applicationFieldMap(appliedDecisions);
      const applicationCorrect = Boolean(applied && (
        directApplied
          ? exact(field, expected, directApplied.value)
          : exact(field, expected, appliedFields[field]) || selectedHasCorrectValue
      ));
      // Application Recall measures real fill/repair opportunities, not fields
      // the observation already got right and retrieval merely confirmed. New
      // traces carry old_value explicitly; legacy hand-authored traces retain
      // the previous denominator semantics for backward compatibility.
      const applicationOpportunity = selectedHasCorrectValue && Boolean(
        !fieldDecisions.some((decision) => decision.old_value_instrumented)
        || !applicationValueExact(field, expected, selectedOldFields[field])
      );
      if (applicationInstrumented && downstreamTraceEligible && applicationOpportunity) {
        applicationRecall.denominator += 1;
        perField[field].safe_application_recall.denominator += 1;
        if (applicationCorrect) {
          applicationRecall.numerator += 1;
          perField[field].safe_application_recall.numerator += 1;
        }
      }
      if (applicationInstrumented && downstreamTraceEligible && applied) {
        applicationPrecision.denominator += 1;
        perField[field].safe_application_precision.denominator += 1;
        if (applicationCorrect) {
          applicationPrecision.numerator += 1;
          perField[field].safe_application_precision.numerator += 1;
        }
      }

      const resolverCorrect = applicationCorrect && exact(field, expected, resolver[field]);
      if (resolverInstrumented && downstreamTraceEligible && applicationCorrect) {
        resolverFidelity.denominator += 1;
        perField[field].resolver_fidelity.denominator += 1;
        if (resolverCorrect) {
          resolverFidelity.numerator += 1;
          perField[field].resolver_fidelity.numerator += 1;
        }
      }
      const rendererCorrect = resolverCorrect && exact(field, expected, renderer[field]);
      if (rendererInstrumented && downstreamTraceEligible && resolverCorrect) {
        rendererFidelity.denominator += 1;
        perField[field].renderer_fidelity.denominator += 1;
        if (rendererCorrect) {
          rendererFidelity.numerator += 1;
          perField[field].renderer_fidelity.numerator += 1;
        }
      }
      fieldRows[field] = {
        truth: expected,
        evidence_seen: seen,
        evidence_sources: evidenceSources,
        selected_candidate_has_correct_value: selectedHasCorrectValue,
        selected_candidate_is_sealed_source: selectedCandidateIsSealedSource,
        downstream_trace_eligible: downstreamTraceEligible,
        application_opportunity: applicationOpportunity,
        application_planned: fieldDecisions.some((decision) => decision.planned),
        application_attempted: applied,
        application_correct: applicationCorrect,
        resolver_preserved: resolverCorrect,
        renderer_expressed: rendererCorrect
      };
    }

    if (retrievalEvaluable && retrievalInstrumented) {
      retrievalIdentityEligibleCount += 1;
      for (const k of [1, 5, 20]) {
        retrieval[k].denominator += 1;
        if (correctCandidate && correctCandidate.rank <= k) retrieval[k].numerator += 1;
      }
      if (selectionInstrumented && downstreamTraceEligible && correctCandidate && correctCandidate.rank <= 20) {
        selection.denominator += 1;
        if (selectedCandidate && candidateMatchesTruth(selectedCandidate, truthIds, expectedIdentity)) selection.numerator += 1;
      }
    }

    cards.push({
      query_card_id: id,
      trace_present: tracePresent,
      reviewed_field_count: Object.keys(truth).length,
      truth_retrieval_ids: truthIds,
      truth_identity_fields: expectedIdentity,
      correct_candidate_rank: correctCandidate?.rank ?? null,
      correct_candidate_id: correctCandidate?.candidate_id ?? null,
      correct_candidate_source: correctCandidate?.source ?? null,
      selected_candidate_id: selectedCandidateId || null,
      selected_candidate_correct: !downstreamTraceEligible
        ? null
        : (retrievalEvaluable
          ? Boolean(selectedCandidate && candidateMatchesTruth(selectedCandidate, truthIds, expectedIdentity))
          : null),
      sealed_source_candidate_retrieved: sealedSourceCandidates.length > 0,
      sealed_source_candidate_selected: selectedCandidateIsSealedSource,
      fields: fieldRows
    });
  }

  for (const field of v4ChainOracleFields) {
    for (const key of Object.keys(perField[field])) perField[field][key] = finalizeMetric(perField[field][key]);
  }
  const datasetTruthClass = cleanText(
    dataset.evaluation_truth_policy?.field_ground_truth_class
    || dataset.truth_policy?.field_ground_truth_class
    || "HUMAN_REVIEWED_FIELD_GROUND_TRUTH"
  ).toUpperCase();
  const formalTruth = [
    "HUMAN_REVIEWED_FIELD_GROUND_TRUTH",
    "TRUSTED_CATALOG_PROMOTED_FIELD_GROUND_TRUTH"
  ].includes(datasetTruthClass);
  return {
    schema_version: v4ChainOracleReportSchemaVersion,
    generated_at: now().toISOString(),
    status: !formalTruth
      ? "PROXY_ONLY"
      : (sealedSourceCandidateSelectedCount > 0 ? "CONTAMINATED" : "COMPLETED"),
    truth_policy: {
      field_ground_truth_class: datasetTruthClass,
      writer_title_parser_output_is_denominator_eligible: false,
      formal_oracle_eligible: formalTruth,
      trace_formal_oracle_eligible: formalTruth && sealedSourceCandidateSelectedCount === 0
    },
    data_quality: {
      source_dataset_card_count: allDatasetRows.length,
      excluded_non_independent_identity_card_count: allDatasetRows.length - evaluationRows.length,
      dataset_card_count: evaluationRows.length,
      trace_card_count: rows(trace).length,
      matched_trace_count: matchedTraceCount,
      missing_trace_count: evaluationRows.length - matchedTraceCount,
      reviewed_field_count: reviewedTruthFieldCount,
      evidence_evaluable_field_count: evidenceOracle.denominator,
      retrieval_identity_eligible_card_count: retrievalIdentityEligibleCount,
      sealed_source_candidate_retrieved_card_count: sealedSourceCandidateRetrievedCount,
      sealed_source_candidate_selected_card_count: sealedSourceCandidateSelectedCount,
      downstream_uncontaminated_card_count: evaluationRows.length - sealedSourceCandidateSelectedCount,
      stage_trace_card_count: stageCoverage
    },
    metrics: {
      evidence_oracle_recall: finalizeMetric(evidenceOracle),
      retrieval_recall_at_1: finalizeMetric(retrieval[1]),
      retrieval_recall_at_5: finalizeMetric(retrieval[5]),
      retrieval_recall_at_20: finalizeMetric(retrieval[20]),
      selection_accuracy_given_retrieved_at_20: finalizeMetric(selection),
      safe_application_recall: finalizeMetric(applicationRecall),
      safe_application_precision: finalizeMetric(applicationPrecision),
      resolver_fidelity: finalizeMetric(resolverFidelity),
      renderer_fidelity: finalizeMetric(rendererFidelity),
      per_field: perField
    },
    cards
  };
}
