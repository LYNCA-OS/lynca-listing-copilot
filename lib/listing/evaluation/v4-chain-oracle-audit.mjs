import {
  canonicalSemPrediction,
  normalizeGoldenSemValue
} from "./golden-sem-accuracy.mjs";
import { goldenSemLaunchFields } from "./golden-sem-release.mjs";

export const v4ChainOracleTraceSchemaVersion = "v4-chain-oracle-trace-v1";
export const v4ChainOracleReportSchemaVersion = "v4-chain-oracle-audit-v1";

const excludedStatuses = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
  const value = item.reviewed_ground_truth?.fields?.[field];
  const marker = cleanText(value).toUpperCase();
  return excludedStatuses.has(marker) ? marker : "CONFIRMED";
}

function truthFields(item = {}) {
  return Object.fromEntries(goldenSemLaunchFields.flatMap((field) => {
    if (excludedStatuses.has(truthStatus(item, field))) return [];
    const value = item.reviewed_ground_truth?.fields?.[field];
    return [[field, value]];
  }));
}

function exact(field, expected, actual) {
  return normalizeGoldenSemValue(field, expected) === normalizeGoldenSemValue(field, actual);
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
  return rows(decisions).map((decision) => ({
    candidate_id: cleanText(decision.candidate_id),
    field: cleanText(decision.field),
    value: decision.value ?? decision.candidate_value ?? decision.applied_value,
    applied: decision.applied === true || decision.applied_to_final === true || cleanText(decision.decision).toUpperCase() === "APPLY",
    reason: cleanText(decision.reason || decision.decision_reason) || null
  })).filter((decision) => goldenSemLaunchFields.includes(decision.field));
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

function candidateIsCorrect(candidate, truthIds) {
  return Boolean(candidate && truthIds.some((id) => candidate.identity_id === id || candidate.candidate_id === id));
}

function hasAnyOwn(object, keys) {
  return keys.some((key) => Object.hasOwn(object, key));
}

export function evaluateV4ChainOracleAudit({ dataset = {}, trace = {}, now = () => new Date() } = {}) {
  const traceById = new Map(rows(trace).map((row) => [rowId(row), row]));
  const evidenceOracle = metricRecord();
  const retrieval = Object.fromEntries([1, 5, 20].map((k) => [k, metricRecord()]));
  const selection = metricRecord();
  const applicationRecall = metricRecord();
  const applicationPrecision = metricRecord();
  const resolverFidelity = metricRecord();
  const rendererFidelity = metricRecord();
  const perField = Object.fromEntries(goldenSemLaunchFields.map((field) => [field, {
    evidence_oracle: metricRecord(),
    safe_application_recall: metricRecord(),
    safe_application_precision: metricRecord(),
    resolver_fidelity: metricRecord(),
    renderer_fidelity: metricRecord()
  }]));
  const cards = [];
  let matchedTraceCount = 0;
  let retrievalIdentityEligibleCount = 0;
  let reviewedTruthFieldCount = 0;
  const stageCoverage = Object.fromEntries([
    "evidence", "retrieval", "selection", "application", "resolver", "renderer"
  ].map((stage) => [stage, 0]));

  for (const item of rows(dataset)) {
    const id = rowId(item);
    const cardTrace = traceById.get(id) || {};
    if (traceById.has(id)) matchedTraceCount += 1;
    const truth = truthFields(item);
    reviewedTruthFieldCount += Object.keys(truth).length;
    const truthIds = truthRetrievalIds(item);
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
    const correctCandidate = truthIds.length
      ? candidates.find((candidate) => candidateIsCorrect(candidate, truthIds)) || null
      : null;
    const applications = applicationDecisions(cardTrace);
    const resolver = normalizedFieldMap(cardTrace.resolver_fields || cardTrace.resolver?.fields || cardTrace.resolved_fields);
    const renderer = normalizedFieldMap(cardTrace.renderer_fields || cardTrace.renderer?.sem_fields || cardTrace.rendered_sem_fields);
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

      const selectedDecision = applications.find((decision) => (
        decision.field === field
        && (!decision.candidate_id || decision.candidate_id === selectedCandidateId)
      ));
      const selectedHasCorrectValue = Boolean(
        (selectedCandidate && exact(field, expected, selectedCandidate.fields[field]))
        || (selectedDecision && exact(field, expected, selectedDecision.value))
      );
      const applied = applications.find((decision) => decision.field === field && decision.applied) || null;
      const applicationCorrect = Boolean(applied && exact(field, expected, applied.value));
      if (applicationInstrumented && selectedHasCorrectValue) {
        applicationRecall.denominator += 1;
        perField[field].safe_application_recall.denominator += 1;
        if (applicationCorrect) {
          applicationRecall.numerator += 1;
          perField[field].safe_application_recall.numerator += 1;
        }
      }
      if (applicationInstrumented && applied) {
        applicationPrecision.denominator += 1;
        perField[field].safe_application_precision.denominator += 1;
        if (applicationCorrect) {
          applicationPrecision.numerator += 1;
          perField[field].safe_application_precision.numerator += 1;
        }
      }

      const resolverCorrect = applicationCorrect && exact(field, expected, resolver[field]);
      if (resolverInstrumented && applicationCorrect) {
        resolverFidelity.denominator += 1;
        perField[field].resolver_fidelity.denominator += 1;
        if (resolverCorrect) {
          resolverFidelity.numerator += 1;
          perField[field].resolver_fidelity.numerator += 1;
        }
      }
      const rendererCorrect = resolverCorrect && exact(field, expected, renderer[field]);
      if (rendererInstrumented && resolverCorrect) {
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
        application_attempted: Boolean(applied),
        application_correct: applicationCorrect,
        resolver_preserved: resolverCorrect,
        renderer_expressed: rendererCorrect
      };
    }

    if (truthIds.length && retrievalInstrumented) {
      retrievalIdentityEligibleCount += 1;
      for (const k of [1, 5, 20]) {
        retrieval[k].denominator += 1;
        if (correctCandidate && correctCandidate.rank <= k) retrieval[k].numerator += 1;
      }
      if (selectionInstrumented && correctCandidate && correctCandidate.rank <= 20) {
        selection.denominator += 1;
        if (selectedCandidate && candidateIsCorrect(selectedCandidate, truthIds)) selection.numerator += 1;
      }
    }

    cards.push({
      query_card_id: id,
      trace_present: tracePresent,
      reviewed_field_count: Object.keys(truth).length,
      truth_retrieval_ids: truthIds,
      correct_candidate_rank: correctCandidate?.rank ?? null,
      selected_candidate_correct: truthIds.length && selectedCandidate ? candidateIsCorrect(selectedCandidate, truthIds) : null,
      fields: fieldRows
    });
  }

  for (const field of goldenSemLaunchFields) {
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
    status: formalTruth ? "COMPLETED" : "PROXY_ONLY",
    truth_policy: {
      field_ground_truth_class: datasetTruthClass,
      writer_title_parser_output_is_denominator_eligible: false,
      formal_oracle_eligible: formalTruth
    },
    data_quality: {
      dataset_card_count: rows(dataset).length,
      trace_card_count: rows(trace).length,
      matched_trace_count: matchedTraceCount,
      missing_trace_count: rows(dataset).length - matchedTraceCount,
      reviewed_field_count: reviewedTruthFieldCount,
      evidence_evaluable_field_count: evidenceOracle.denominator,
      retrieval_identity_eligible_card_count: retrievalIdentityEligibleCount,
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
