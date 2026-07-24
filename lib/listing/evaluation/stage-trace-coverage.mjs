export const stageTraceContractVersion = "stage-trace-contract-v1";
export const requiredTraceStages = Object.freeze([
  "observation",
  "evidence",
  "retrieval",
  "selection",
  "application",
  "resolver",
  "renderer"
]);

const terminalStatuses = new Set(["COMPLETED", "SKIPPED", "FAILED"]);

function clean(value) {
  return String(value ?? "").trim();
}

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["results", "items", "cards", "records"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function rowId(row = {}) {
  return clean(row.query_card_id || row.item_id || row.source_feedback_id || row.asset_id || row.card_id).toLowerCase();
}

function stageRows(trace = {}) {
  const stages = Array.isArray(trace.stage_trace) ? trace.stage_trace : [];
  return new Map(stages.map((stage) => [clean(stage.stage).toLowerCase(), stage]));
}

function validateStage(stageName, stage = null) {
  const errors = [];
  if (!stage) return { valid: false, errors: ["STAGE_TRACE_MISSING"] };
  const status = clean(stage.status).toUpperCase();
  if (!terminalStatuses.has(status)) errors.push("TERMINAL_STATUS_MISSING");
  if (!clean(stage.input_version)) errors.push("INPUT_VERSION_MISSING");
  if (typeof stage.output_produced !== "boolean") errors.push("OUTPUT_PRODUCED_MISSING");
  if (typeof stage.output_persisted !== "boolean") errors.push("OUTPUT_PERSISTED_MISSING");
  if (["SKIPPED", "FAILED"].includes(status) && !clean(stage.reason_code)) errors.push("REASON_CODE_MISSING");
  if (stage.output_produced === false && !clean(stage.reason_code)) errors.push("NO_OUTPUT_REASON_MISSING");
  if (stage.output_produced === true && stage.output_persisted !== true) errors.push("OUTPUT_NOT_PERSISTED");
  if (stage.dropped_fields?.length && stage.dropped_fields.some((field) => !clean(field.reason_code))) {
    errors.push("FIELD_DROP_REASON_MISSING");
  }
  if (stageName === "renderer" && !clean(stage.final_decision_owner)) errors.push("FINAL_DECISION_OWNER_MISSING");
  return { valid: errors.length === 0, errors };
}

function legacyStageSignals(trace = {}) {
  const retrieval = trace.retrieval && typeof trace.retrieval === "object" ? trace.retrieval : {};
  const selection = trace.selection && typeof trace.selection === "object" ? trace.selection : {};
  const application = trace.candidate_application && typeof trace.candidate_application === "object"
    ? trace.candidate_application
    : {};
  const resolver = trace.resolver && typeof trace.resolver === "object" ? trace.resolver : {};
  const renderer = trace.renderer && typeof trace.renderer === "object" ? trace.renderer : {};
  return {
    observation: Object.hasOwn(trace, "recognition_ok") || Object.hasOwn(trace, "recognition_error"),
    evidence: ["evidence_observations", "evidence", "sensor_evidence"].some((key) => Object.hasOwn(trace, key)),
    retrieval: Object.hasOwn(trace, "retrieval_candidates") || Object.hasOwn(retrieval, "candidates"),
    selection: Object.hasOwn(trace, "selected_candidate_id") || Object.hasOwn(selection, "selected_candidate_id"),
    application: Object.hasOwn(trace, "application_decisions") || Object.hasOwn(application, "decisions"),
    resolver: Object.hasOwn(trace, "resolver_fields") || Object.hasOwn(trace, "resolved_fields") || Object.hasOwn(resolver, "fields"),
    renderer: Object.hasOwn(trace, "renderer_fields") || Object.hasOwn(trace, "rendered_sem_fields") || Object.hasOwn(renderer, "sem_fields")
  };
}

export function auditStageTraceCoverage({
  dataset = {},
  trace = {},
  minimumCoverage = 0.99,
  independentIdentityOnly = false
} = {}) {
  const traceById = new Map(rows(trace).map((row) => [rowId(row), row]));
  const datasetRows = rows(dataset);
  const scopedRows = independentIdentityOnly
    ? datasetRows.filter((item) => item.retrieval_ground_truth?.retrieval_evaluable === true)
    : datasetRows;
  const cards = scopedRows.map((item) => {
    const id = rowId(item);
    const cardTrace = traceById.get(id);
    const stages = stageRows(cardTrace);
    const legacySignals = legacyStageSignals(cardTrace);
    const stageAudit = Object.fromEntries(requiredTraceStages.map((stage) => [stage, validateStage(stage, stages.get(stage))]));
    const validStageCount = Object.values(stageAudit).filter((entry) => entry.valid).length;
    return {
      query_card_id: id,
      trace_present: Boolean(cardTrace),
      valid_stage_count: validStageCount,
      required_stage_count: requiredTraceStages.length,
      complete: validStageCount === requiredTraceStages.length,
      legacy_stage_signals: legacySignals,
      source_contract_violations: (cardTrace?.instrumentation?.pipeline_contract_violations || []).map((violation) => ({
        ...violation,
        query_card_id: id
      })),
      stages: stageAudit
    };
  });
  const totalStageSlots = cards.length * requiredTraceStages.length;
  const validStageSlots = cards.reduce((sum, card) => sum + card.valid_stage_count, 0);
  const coverage = totalStageSlots ? validStageSlots / totalStageSlots : 0;
  const legacySignalSlots = cards.reduce((sum, card) => (
    sum + Object.values(card.legacy_stage_signals).filter(Boolean).length
  ), 0);
  const reasonCounts = {};
  const sourceContractViolations = cards.flatMap((card) => card.source_contract_violations);
  for (const card of cards) for (const stage of Object.values(card.stages)) for (const error of stage.errors) {
    reasonCounts[error] = (reasonCounts[error] || 0) + 1;
  }
  return {
    schema_version: "stage-trace-coverage-audit-v1",
    contract_version: stageTraceContractVersion,
    gate: {
      minimum_coverage: minimumCoverage,
      evaluation_scope: independentIdentityOnly ? "INDEPENDENT_IDENTITY_ONLY" : "ALL_DATASET_ROWS",
      excluded_non_evaluable_count: datasetRows.length - scopedRows.length,
      coverage: Number(coverage.toFixed(6)),
      card_count: cards.length,
      complete_card_count: cards.filter((card) => card.complete).length,
      valid_stage_slots: validStageSlots,
      total_stage_slots: totalStageSlots,
      legacy_signal_stage_slots: legacySignalSlots,
      legacy_signal_coverage: totalStageSlots ? Number((legacySignalSlots / totalStageSlots).toFixed(6)) : 0,
      unknown_reason_count: reasonCounts.UNKNOWN || 0,
      source_contract_violation_count: sourceContractViolations.length,
      passed: coverage >= minimumCoverage && cards.every((card) => card.complete) && !reasonCounts.UNKNOWN,
      experiment_eligible: coverage >= minimumCoverage
        && cards.every((card) => card.complete)
        && !reasonCounts.UNKNOWN
        && sourceContractViolations.length === 0
    },
    source_contract_violations: sourceContractViolations,
    failures_by_reason: reasonCounts,
    cards
  };
}
