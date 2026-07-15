import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldenSemAccuracy } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { goldenSemLaunchFields } from "../lib/listing/evaluation/golden-sem-release.mjs";

export const retrievalAblationCriticalFields = Object.freeze([
  "subject",
  "product",
  "set",
  "card_number",
  "print_finish",
  "numerical_rarity",
  "grading_info"
]);

const criticalFieldDisplayNames = Object.freeze({
  subject: "subject",
  product: "product",
  set: "set",
  card_number: "card_number",
  print_finish: "parallel",
  numerical_rarity: "numerical_rarity",
  grading_info: "grade"
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rowsFromReport(report = {}) {
  for (const key of ["results", "items", "records", "cards"]) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function rowId(row = {}) {
  return cleanText(
    row.item_id
    || row.query_card_id
    || row.card_id
    || row.asset_id
    || row.source_feedback_id
    || row.candidate_id
  ).toLowerCase();
}

function rowMap(report = {}) {
  return new Map(rowsFromReport(report).map((row) => [rowId(row), row]).filter(([id]) => Boolean(id)));
}

function finalTitle(row = {}) {
  return cleanText(row.final_title || row.title || row.l2_status?.title || row.l2_status?.final_title);
}

function retrievalApplication(row = {}) {
  return row.retrieval_application
    || row.l2_candidate_debug?.retrieval_application
    || row.candidate_control_plane_trace?.retrieval_application
    || row.l2_status?.candidate_control_plane_trace?.retrieval_application
    || null;
}

function rate(correct, total) {
  return total > 0 ? Number((correct / total).toFixed(6)) : null;
}

function criticalAccuracy(accuracyReport = {}, fields = retrievalAblationCriticalFields) {
  const perField = accuracyReport.metrics?.per_field_exact_accuracy || {};
  const totals = fields.reduce((summary, field) => {
    summary.correct += Number(perField[field]?.correct || 0);
    summary.total += Number(perField[field]?.total || 0);
    return summary;
  }, { correct: 0, total: 0 });
  return {
    ...totals,
    rate: rate(totals.correct, totals.total),
    fields: Object.fromEntries(fields.map((field) => [criticalFieldDisplayNames[field] || field, {
      sem_field: field,
      ...(perField[field] || {
        correct: 0,
        total: 0,
        accuracy: null
      })
    }]))
  };
}

function cardExactMap(accuracyReport = {}) {
  return new Map((accuracyReport.cards || []).map((card) => [cleanText(card.item_id).toLowerCase(), card.card_exact]));
}

function accuracyCardMap(accuracyReport = {}) {
  return new Map((accuracyReport.cards || []).map((card) => [cleanText(card.item_id).toLowerCase(), card]));
}

function applicationDecisions(application = {}) {
  return Array.isArray(application?.decisions) ? application.decisions : [];
}

function semFieldForDecision(row = {}) {
  const field = cleanText(row.resolver_field || row.field).toLowerCase();
  if (["player", "players", "character", "subject", "subjects"].includes(field)) return "subject";
  if (["collector_number", "checklist_code", "tcg_card_number", "card_number"].includes(field)) return "card_number";
  if (["parallel", "parallel_exact", "surface_color", "product_finish", "print_finish"].includes(field)) return "print_finish";
  if (["grade", "grade_company", "card_grade", "auto_grade", "grade_type", "grading_info"].includes(field)) return "grading_info";
  if (["serial_number", "print_run_number", "numerical_rarity"].includes(field)) return "numerical_rarity";
  return goldenSemLaunchFields.includes(field) ? field : null;
}

function sourceLane(row = {}) {
  const lane = cleanText(row.candidate_lane).toLowerCase();
  if (lane) return lane;
  return /vector/i.test(cleanText(row.source || row.source_type)) ? "vector" : "catalog";
}

function fieldDelta(offCard = {}, onCard = {}, application = {}) {
  const improvedFields = [];
  const regressedFields = [];
  const changedFields = [];
  const fieldComparisons = {};
  for (const field of goldenSemLaunchFields) {
    const offField = offCard.fields?.[field] || {};
    const onField = onCard.fields?.[field] || {};
    if (offField.excluded_from_denominator || onField.excluded_from_denominator) continue;
    const offCorrect = offField.is_correct === true;
    const onCorrect = onField.is_correct === true;
    const predictionChanged = offField.normalized_prediction !== onField.normalized_prediction;
    if (predictionChanged) changedFields.push(field);
    if (!offCorrect && onCorrect) improvedFields.push(field);
    if (offCorrect && !onCorrect) regressedFields.push(field);
    fieldComparisons[field] = {
      ground_truth: onField.ground_truth,
      retrieval_off_prediction: offField.prediction,
      retrieval_on_prediction: onField.prediction,
      retrieval_off_correct: offField.is_correct ?? null,
      retrieval_on_correct: onField.is_correct ?? null,
      prediction_changed: predictionChanged
    };
  }
  const relevantDecisions = applicationDecisions(application).filter((row) => {
    const semField = semFieldForDecision(row);
    return Boolean(semField && changedFields.includes(semField));
  });
  const sources = [...new Set(relevantDecisions.map(sourceLane).filter(Boolean))];
  const candidateIds = [...new Set(relevantDecisions.map((row) => cleanText(row.candidate_id)).filter(Boolean))];
  const outcome = improvedFields.length && regressedFields.length
    ? "MIXED"
    : improvedFields.length
      ? "IMPROVED"
      : regressedFields.length
        ? "REGRESSED"
        : "NO_CHANGE";
  return {
    outcome,
    improved_fields: improvedFields,
    regressed_fields: regressedFields,
    changed_fields: changedFields,
    source: sources,
    candidate_ids: candidateIds,
    field_comparisons: fieldComparisons
  };
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rawRetrievedCandidateCount(row = {}) {
  const catalog = numeric(row.catalog_activation_funnel?.raw_candidate_count, numeric(row.catalog_candidate_count));
  const vector = numeric(row.vector_activation_funnel?.raw_candidate_count, numeric(row.vector_raw_candidate_count));
  return catalog + vector;
}

function decisionEligibleCandidateCount(row = {}, application = {}) {
  if (numeric(row.decision_eligible_candidate_count) > 0) return numeric(row.decision_eligible_candidate_count);
  const ids = new Set(applicationDecisions(application)
    .filter((decision) => decision.reason !== "candidate_not_decision_eligible" && decision.reason !== "retrieval_application_disabled")
    .map((decision) => cleanText(decision.candidate_id))
    .filter(Boolean));
  return ids.size;
}

function applicationFunnel(perCard = []) {
  const totals = perCard.reduce((summary, row) => {
    const application = row.retrieval_application || {};
    const decisions = applicationDecisions(application);
    const retrieved = row.retrieved_candidate_count;
    const eligible = row.eligible_candidate_count;
    const fieldRows = numeric(application.field_evidence_count, decisions.length);
    const resolverEvidence = numeric(
      application.identity_evidence_count,
      decisions.filter((decision) => ["APPLY", "SUPPORT"].includes(decision.decision)).length
    );
    const applyDecisions = decisions.filter((decision) => decision.decision === "APPLY").length;
    const supportDecisions = decisions.filter((decision) => decision.decision === "SUPPORT").length;
    const actualApplied = numeric(application.actual_application_count, row.candidate_application_count);
    summary.retrieved_candidate_count += retrieved;
    summary.eligible_candidate_count += eligible;
    summary.field_decision_row_count += fieldRows;
    summary.resolver_evidence_row_count += resolverEvidence;
    summary.apply_decision_count += applyDecisions;
    summary.support_decision_count += supportDecisions;
    summary.actual_applied_field_count += actualApplied;
    if (retrieved > 0) summary.cards_with_retrieval += 1;
    if (eligible > 0) summary.cards_with_eligible_candidates += 1;
    if (fieldRows > 0) summary.cards_with_field_decisions += 1;
    if (resolverEvidence > 0) summary.cards_with_resolver_evidence += 1;
    if (applyDecisions > 0) summary.cards_with_apply_decision += 1;
    if (actualApplied > 0) summary.cards_with_resolved_change += 1;
    if (row.title_changed) summary.cards_with_title_change += 1;
    for (const decision of decisions.filter((item) => item.applied_to_final === true)) {
      const lane = sourceLane(decision);
      summary.applied_fields_by_source[lane] = numeric(summary.applied_fields_by_source[lane]) + 1;
    }
    return summary;
  }, {
    card_count: perCard.length,
    retrieved_candidate_count: 0,
    eligible_candidate_count: 0,
    field_decision_row_count: 0,
    resolver_evidence_row_count: 0,
    apply_decision_count: 0,
    support_decision_count: 0,
    actual_applied_field_count: 0,
    cards_with_retrieval: 0,
    cards_with_eligible_candidates: 0,
    cards_with_field_decisions: 0,
    cards_with_resolver_evidence: 0,
    cards_with_apply_decision: 0,
    cards_with_resolved_change: 0,
    cards_with_title_change: 0,
    applied_fields_by_source: {}
  });
  return {
    ...totals,
    retrieval_card_rate: rate(totals.cards_with_retrieval, totals.card_count),
    eligible_from_retrieved_rate: rate(totals.eligible_candidate_count, totals.retrieved_candidate_count),
    resolver_evidence_from_eligible_rate: rate(totals.resolver_evidence_row_count, totals.field_decision_row_count),
    candidate_application_rate: rate(totals.cards_with_resolved_change, totals.cards_with_eligible_candidates),
    apply_realization_rate: rate(totals.actual_applied_field_count, totals.apply_decision_count),
    resolved_change_card_rate: rate(totals.cards_with_resolved_change, totals.card_count),
    title_change_card_rate: rate(totals.cards_with_title_change, totals.card_count)
  };
}

function modelIds(report = {}) {
  return [...new Set([
    cleanText(report.cloud_preflight?.default_model),
    ...rowsFromReport(report).map((row) => cleanText(row.model_id))
  ].filter(Boolean))].sort();
}

function deploymentSha(report = {}) {
  return cleanText(
    report.cloud_preflight?.deployment?.git_commit_sha
    || report.cloud_preflight?.git_commit_sha
    || report.deployment?.git_commit_sha
  );
}

function runtimeIsolation(offReport = {}, onReport = {}) {
  const offRows = rowsFromReport(offReport);
  const onRows = rowsFromReport(onReport);
  const technicalFailureIds = (rows = []) => rows
    .filter((row) => row.technical_failure === true)
    .map(rowId)
    .filter(Boolean);
  const offRetrievalLeakRows = offRows.filter((row) => {
    const providers = Array.isArray(row.retrieval_providers_used) ? row.retrieval_providers_used : [];
    return rawRetrievedCandidateCount(row) > 0
      || numeric(row.catalog_prompt_candidate_count) > 0
      || numeric(row.vector_prompt_candidate_count) > 0
      || providers.length > 0
      || row.catalog_prompt_assist_used === true
      || row.vector_prompt_assist_used === true
      || row.retrieval_application?.enabled === true;
  });
  const offExternalRows = offRows.filter((row) => row.external_retrieval_used === true);
  const onExternalRows = onRows.filter((row) => row.external_retrieval_used === true);
  const offTechnicalFailureIds = technicalFailureIds(offRows);
  const onTechnicalFailureIds = technicalFailureIds(onRows);
  return {
    valid: offRetrievalLeakRows.length === 0
      && offExternalRows.length === 0
      && onExternalRows.length === 0
      && offTechnicalFailureIds.length === 0
      && onTechnicalFailureIds.length === 0,
    retrieval_off_leak_count: offRetrievalLeakRows.length,
    retrieval_off_leak_item_ids: offRetrievalLeakRows.map(rowId).filter(Boolean),
    retrieval_off_external_retrieval_count: offExternalRows.length,
    retrieval_on_external_retrieval_count: onExternalRows.length,
    retrieval_off_technical_failure_count: offTechnicalFailureIds.length,
    retrieval_on_technical_failure_count: onTechnicalFailureIds.length,
    retrieval_off_technical_failure_item_ids: offTechnicalFailureIds,
    retrieval_on_technical_failure_item_ids: onTechnicalFailureIds
  };
}

function experimentValidity(offReport = {}, onReport = {}) {
  const off = offReport.experiment_contract || {};
  const on = onReport.experiment_contract || {};
  const offModels = modelIds(offReport);
  const onModels = modelIds(onReport);
  const offSha = deploymentSha(offReport);
  const onSha = deploymentSha(onReport);
  const runtime = runtimeIsolation(offReport, onReport);
  return {
    contract_present: off.contract_id === "retrieval-application-ablation-v1"
      && on.contract_id === "retrieval-application-ablation-v1",
    arm_assignment_valid: off.arm === "OFF" && on.arm === "ON",
    shared_pipeline_valid: off.provider_id === on.provider_id
      && off.single_model_fast === false
      && on.single_model_fast === false
      && off.evidence_completion_enabled === true
      && on.evidence_completion_enabled === true
      && off.external_retrieval_enabled === false
      && on.external_retrieval_enabled === false
      && off.identity_result_cache_disabled === true
      && on.identity_result_cache_disabled === true
      && off.approved_identity_memory_disabled === true
      && on.approved_identity_memory_disabled === true
      && off.corrected_title_hint_sent_to_cloud === false
      && on.corrected_title_hint_sent_to_cloud === false,
    retrieval_axis_valid: off.catalog_enabled === false
      && off.vector_enabled === false
      && off.retrieval_application_enabled === false
      && on.catalog_enabled === true
      && on.vector_enabled === true
      && on.retrieval_application_enabled === true,
    same_base_url: cleanText(offReport.base_url) === cleanText(onReport.base_url),
    same_model_ids: offModels.length > 0 && JSON.stringify(offModels) === JSON.stringify(onModels),
    retrieval_off_model_ids: offModels,
    retrieval_on_model_ids: onModels,
    same_deployment_sha: offSha && onSha ? offSha === onSha : null,
    retrieval_off_deployment_sha: offSha || null,
    retrieval_on_deployment_sha: onSha || null,
    runtime_isolation: runtime
  };
}

function accuracyEvidence(dataset = {}, offAccuracy = {}, onAccuracy = {}) {
  const truthClass = cleanText(
    dataset.evaluation_truth_policy?.field_ground_truth_class
    || offAccuracy.source?.field_ground_truth_class
    || onAccuracy.source?.field_ground_truth_class
    || "HUMAN_REVIEWED_FIELD_GROUND_TRUTH"
  ).toUpperCase();
  const formal = truthClass === "HUMAN_REVIEWED_FIELD_GROUND_TRUTH";
  return {
    field_ground_truth_class: truthClass,
    formal_sem_accuracy_measured: formal,
    formal_launch_gate_eligible: formal
      && offAccuracy.scope?.launch_gate_eligible !== false
      && onAccuracy.scope?.launch_gate_eligible !== false,
    metric_label: formal ? "SEM_ACCURACY" : "TITLE_DERIVED_SEM_PROXY_ACCURACY",
    limitations: Array.isArray(dataset.evaluation_truth_policy?.limitations)
      ? dataset.evaluation_truth_policy.limitations
      : []
  };
}

function roundedDelta(onValue, offValue) {
  if (!Number.isFinite(Number(onValue)) || !Number.isFinite(Number(offValue))) return null;
  return Number((Number(onValue) - Number(offValue)).toFixed(6));
}

function operationalMetrics(report = {}) {
  return {
    provider_success_count: numeric(report.provider_success_count),
    provider_success_rate: report.provider_success_rate ?? null,
    technical_failure_count: numeric(report.technical_failure_count),
    provider_error_count: numeric(report.provider_error_count),
    provider_error_recovered_count: numeric(report.provider_error_recovered_count),
    evaluated_cards_per_minute: report.evaluated_cards_per_minute ?? null,
    per_card_latency_ms: report.per_card_latency_ms || null,
    usage_totals: report.usage_totals || {}
  };
}

export function evaluateRetrievalApplicationAblation({
  dataset = {},
  retrievalDisabledReport = {},
  retrievalEnabledReport = {}
} = {}) {
  const offAccuracy = evaluateGoldenSemAccuracy({ dataset, predictions: retrievalDisabledReport });
  const onAccuracy = evaluateGoldenSemAccuracy({ dataset, predictions: retrievalEnabledReport });
  const offCritical = criticalAccuracy(offAccuracy);
  const onCritical = criticalAccuracy(onAccuracy);
  const offRows = rowMap(retrievalDisabledReport);
  const onRows = rowMap(retrievalEnabledReport);
  const datasetIds = (Array.isArray(dataset.items) ? dataset.items : [])
    .map((item) => rowId(item))
    .filter(Boolean);
  const pairedIds = datasetIds.filter((id) => offRows.has(id) && onRows.has(id));
  const offExact = cardExactMap(offAccuracy);
  const onExact = cardExactMap(onAccuracy);
  const offCards = accuracyCardMap(offAccuracy);
  const onCards = accuracyCardMap(onAccuracy);
  const perCard = pairedIds.map((id) => {
    const off = offRows.get(id);
    const on = onRows.get(id);
    const application = retrievalApplication(on);
    const appliedFields = Array.isArray(application?.actual_applied_fields)
      ? application.actual_applied_fields
      : [];
    const offCardExact = offExact.get(id) ?? null;
    const onCardExact = onExact.get(id) ?? null;
    const retrievalDelta = fieldDelta(offCards.get(id), onCards.get(id), application);
    return {
      item_id: id,
      retrieval_disabled_title: finalTitle(off),
      retrieval_enabled_title: finalTitle(on),
      title_changed: finalTitle(off) !== finalTitle(on),
      candidate_application_count: Number(application?.actual_application_count || appliedFields.length || 0),
      applied_fields: appliedFields,
      field_decision_counts: application?.decision_counts || {},
      retrieved_candidate_count: rawRetrievedCandidateCount(on),
      eligible_candidate_count: decisionEligibleCandidateCount(on, application),
      retrieval_application: application,
      retrieval_delta: retrievalDelta,
      sem_card_exact_off: offCardExact,
      sem_card_exact_on: onCardExact,
      outcome: offCardExact === false && onCardExact === true
        ? "RECOVERY"
        : offCardExact === true && onCardExact === false
          ? "REGRESSION"
          : "NO_CHANGE"
    };
  });
  const candidateApplicationCount = perCard.reduce((sum, row) => sum + row.candidate_application_count, 0);
  const titleChangeCount = perCard.filter((row) => row.title_changed).length;
  const recoveryCount = perCard.filter((row) => row.outcome === "RECOVERY").length;
  const regressionCount = perCard.filter((row) => row.outcome === "REGRESSION").length;
  const offSemField = offAccuracy.metrics?.sem_field_exact_accuracy || {};
  const onSemField = onAccuracy.metrics?.sem_field_exact_accuracy || {};
  const offSemCard = offAccuracy.metrics?.sem_card_exact_accuracy || {};
  const onSemCard = onAccuracy.metrics?.sem_card_exact_accuracy || {};
  const funnel = applicationFunnel(perCard);
  const experiment = experimentValidity(retrievalDisabledReport, retrievalEnabledReport);
  const evidence = accuracyEvidence(dataset, offAccuracy, onAccuracy);
  const pairedComplete = pairedIds.length > 0 && pairedIds.length === datasetIds.length;
  const causalValid = pairedComplete
    && experiment.contract_present
    && experiment.arm_assignment_valid
    && experiment.shared_pipeline_valid
    && experiment.retrieval_axis_valid
    && experiment.same_base_url
    && experiment.same_model_ids
    && experiment.same_deployment_sha !== false
    && experiment.runtime_isolation.valid;

  return {
    schema_version: "retrieval-application-ablation-v1",
    generated_at: new Date().toISOString(),
    accuracy_evidence: evidence,
    cohort: {
      dataset_item_count: datasetIds.length,
      retrieval_disabled_result_count: offRows.size,
      retrieval_enabled_result_count: onRows.size,
      paired_card_count: pairedIds.length,
      same_card_cohort_complete: pairedIds.length === datasetIds.length,
      missing_from_disabled: datasetIds.filter((id) => !offRows.has(id)),
      missing_from_enabled: datasetIds.filter((id) => !onRows.has(id))
    },
    metrics: {
      retrieval_disabled: {
        sem_card_exact_accuracy: offSemCard,
        sem_field_accuracy: offSemField,
        critical_field_accuracy: offCritical,
        per_field_exact_accuracy: offAccuracy.metrics?.per_field_exact_accuracy || {},
        operations: operationalMetrics(retrievalDisabledReport)
      },
      retrieval_enabled: {
        sem_card_exact_accuracy: onSemCard,
        sem_field_accuracy: onSemField,
        critical_field_accuracy: onCritical,
        per_field_exact_accuracy: onAccuracy.metrics?.per_field_exact_accuracy || {},
        operations: operationalMetrics(retrievalEnabledReport),
        candidate_application_count: candidateApplicationCount,
        title_change_count: titleChangeCount,
        application_funnel: funnel
      },
      delta: {
        sem_card_exact_accuracy: roundedDelta(onSemCard.rate, offSemCard.rate),
        sem_field_accuracy: roundedDelta(onSemField.rate, offSemField.rate),
        critical_field_accuracy: roundedDelta(onCritical.rate, offCritical.rate),
        retrieval_recovery_count: recoveryCount,
        retrieval_regression_count: regressionCount,
        net_benefit: recoveryCount - regressionCount
      }
    },
    per_card: perCard,
    validity: {
      causal_comparison_valid: causalValid,
      experiment,
      requirements: [
        "same card cohort",
        "same deployment and model",
        "same prompt core",
        "only retrieval enablement differs",
        evidence.formal_sem_accuracy_measured
          ? "field-level reviewed ground truth"
          : "reviewed-title-derived SEM proxy isolated from recognition"
      ]
    }
  };
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    options[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dataset || !args.off || !args.on) {
    throw new Error("Usage: node scripts/evaluate-retrieval-application-ablation.mjs --dataset <golden-sem.json> --off <retrieval-off.json> --on <retrieval-on.json> [--out <report.json>]");
  }
  const report = evaluateRetrievalApplicationAblation({
    dataset: await readJson(args.dataset),
    retrievalDisabledReport: await readJson(args.off),
    retrievalEnabledReport: await readJson(args.on)
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(path.resolve(args.out), output);
  }
  process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
