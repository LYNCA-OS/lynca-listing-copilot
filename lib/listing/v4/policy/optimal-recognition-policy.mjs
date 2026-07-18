import {
  hardInvariantStatuses,
  normalizeHardInvariantSnapshot
} from "./hard-invariant-spec.mjs";

export const recognitionPolicyActions = Object.freeze({
  REJECT_INVALID_INPUT: "REJECT_INVALID_INPUT",
  RUN_CHEAP_EVIDENCE: "RUN_CHEAP_EVIDENCE",
  RUN_EXACT_CATALOG_LOOKUP: "RUN_EXACT_CATALOG_LOOKUP",
  RUN_GPT_OBSERVATION: "RUN_GPT_OBSERVATION",
  RUN_VECTOR_RETRIEVAL: "RUN_VECTOR_RETRIEVAL",
  RUN_FOCUSED_VERIFIER: "RUN_FOCUSED_VERIFIER",
  RUN_EXTERNAL_RETRIEVAL: "RUN_EXTERNAL_RETRIEVAL",
  STOP_AND_RENDER: "STOP_AND_RENDER",
  ROUTE_TO_WRITER_REVIEW: "ROUTE_TO_WRITER_REVIEW"
});

export const v4LaunchPolicyConstraints = Object.freeze({
  policy_id: "V4_LAUNCH_POLICY_SHADOW_V1",
  policy_version: "2026-07-18.1",
  minimum_sem_accuracy: 0.87,
  target_sem_accuracy: 0.9,
  minimum_cards_per_minute: 6,
  maximum_terminal_technical_failure_rate: 0.0001,
  maximum_stop_risk: 0.1,
  maximum_critical_field_risk: 0.05,
  maximum_direct_conflicts_for_stop: 0,
  shadow_only: true
});

export const defaultCriticalSemFields = Object.freeze([
  "subject",
  "subjects",
  "year",
  "product",
  "set",
  "card_number",
  "collector_number",
  "parallel",
  "parallel_exact",
  "numerical_rarity",
  "grade",
  "grading_info"
]);

export const nonTerminalRecognitionActions = Object.freeze([
  recognitionPolicyActions.RUN_CHEAP_EVIDENCE,
  recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP,
  recognitionPolicyActions.RUN_GPT_OBSERVATION,
  recognitionPolicyActions.RUN_VECTOR_RETRIEVAL,
  recognitionPolicyActions.RUN_FOCUSED_VERIFIER,
  recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL
]);

export const recognitionPolicyActionList = Object.freeze([
  ...nonTerminalRecognitionActions,
  recognitionPolicyActions.STOP_AND_RENDER,
  recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW,
  recognitionPolicyActions.REJECT_INVALID_INPUT
]);

const terminalActions = new Set([
  recognitionPolicyActions.REJECT_INVALID_INPUT,
  recognitionPolicyActions.STOP_AND_RENDER,
  recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW
]);

const defaultActionModels = Object.freeze({
  [recognitionPolicyActions.RUN_CHEAP_EVIDENCE]: Object.freeze({
    latency_ms: 900,
    cost_units: 0.05,
    capacity_ms: 500,
    technical_failure_rate: 0.002,
    outcomes: Object.freeze([
      Object.freeze({ probability: 0.86, risk_multiplier: 0.72, critical_risk_multiplier: 0.76 }),
      Object.freeze({ probability: 0.14, risk_multiplier: 1, critical_risk_multiplier: 1 })
    ])
  }),
  [recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP]: Object.freeze({
    latency_ms: 650,
    cost_units: 0.02,
    capacity_ms: 250,
    technical_failure_rate: 0.001,
    outcomes: Object.freeze([
      Object.freeze({ probability: 0.62, risk_multiplier: 0.48, critical_risk_multiplier: 0.5 }),
      Object.freeze({ probability: 0.38, risk_multiplier: 0.96, critical_risk_multiplier: 0.98 })
    ])
  }),
  [recognitionPolicyActions.RUN_GPT_OBSERVATION]: Object.freeze({
    latency_ms: 22_000,
    cost_units: 1,
    capacity_ms: 22_000,
    technical_failure_rate: 0.01,
    outcomes: Object.freeze([
      Object.freeze({ probability: 0.9, risk_multiplier: 0.3, critical_risk_multiplier: 0.34 }),
      Object.freeze({ probability: 0.1, risk_multiplier: 0.92, critical_risk_multiplier: 0.96 })
    ])
  }),
  [recognitionPolicyActions.RUN_VECTOR_RETRIEVAL]: Object.freeze({
    latency_ms: 3_000,
    cost_units: 0.08,
    capacity_ms: 1_500,
    technical_failure_rate: 0.005,
    outcomes: Object.freeze([
      Object.freeze({ probability: 0.42, risk_multiplier: 0.7, critical_risk_multiplier: 0.78 }),
      Object.freeze({ probability: 0.58, risk_multiplier: 0.99, critical_risk_multiplier: 1 })
    ])
  }),
  [recognitionPolicyActions.RUN_FOCUSED_VERIFIER]: Object.freeze({
    latency_ms: 6_000,
    cost_units: 0.3,
    capacity_ms: 3_500,
    technical_failure_rate: 0.008,
    outcomes: Object.freeze([
      Object.freeze({ probability: 0.7, risk_multiplier: 0.62, critical_risk_multiplier: 0.42 }),
      Object.freeze({ probability: 0.3, risk_multiplier: 0.98, critical_risk_multiplier: 0.99 })
    ])
  }),
  [recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL]: Object.freeze({
    latency_ms: 5_000,
    cost_units: 0.12,
    capacity_ms: 1_500,
    technical_failure_rate: 0.02,
    outcomes: Object.freeze([
      Object.freeze({ probability: 0.35, risk_multiplier: 0.76, critical_risk_multiplier: 0.82 }),
      Object.freeze({ probability: 0.65, risk_multiplier: 1, critical_risk_multiplier: 1 })
    ])
  })
});

export const defaultRecognitionTransitionModel = Object.freeze({
  schema_version: "v4-recognition-transition-model-v1",
  model_id: "conservative-prior-only",
  fitted_from_replay: false,
  action_models: defaultActionModels
});

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function probability(value, fallback = 0) {
  return Math.max(0, Math.min(1, finiteNumber(value, fallback)));
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedFieldRisk(value) {
  if (typeof value === "number") return probability(value, 1);
  const object = plainObject(value);
  if (Number.isFinite(Number(object.risk))) return probability(object.risk, 1);
  if (Number.isFinite(Number(object.confidence))) return 1 - probability(object.confidence, 0);
  if (Number.isFinite(Number(object.resolution_confidence))) {
    return 1 - probability(object.resolution_confidence, 0);
  }
  return object.resolved_value === null || object.resolved_value === undefined || object.resolved_value === ""
    ? 1
    : 0.5;
}

function normalizedCompletedActions(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((action) => String(action || "").trim().toUpperCase())
    .filter((action) => nonTerminalRecognitionActions.includes(action)))];
}

function normalizeEvidenceState(value = {}) {
  const source = plainObject(value);
  const fieldStates = plainObject(source.field_states || source.fieldStates);
  const fieldRisk = Object.fromEntries(Object.entries(fieldStates)
    .map(([field, state]) => [field, normalizedFieldRisk(state)]));
  const directConflictCount = Math.max(0, Math.round(finiteNumber(
    source.direct_conflict_count
    ?? source.directConflictCount
    ?? source.conflict_count
    ?? source.conflictCount,
    0
  )));
  const criticalFields = Array.isArray(source.critical_fields)
    ? source.critical_fields.map(String)
    : defaultCriticalSemFields;
  const observedRisks = Object.values(fieldRisk);
  const criticalRisks = criticalFields
    .filter((field) => field in fieldRisk)
    .map((field) => fieldRisk[field]);
  return {
    field_risk: fieldRisk,
    global_risk: probability(
      source.global_risk,
      observedRisks.length ? Math.max(...observedRisks) : 1
    ),
    critical_field_risk: probability(
      source.critical_field_risk,
      criticalRisks.length ? Math.max(...criticalRisks) : observedRisks.length ? Math.max(...observedRisks) : 1
    ),
    direct_conflict_count: directConflictCount,
    unresolved_critical_field_count: Math.max(0, Math.round(finiteNumber(
      source.unresolved_critical_field_count ?? source.unresolvedCriticalFieldCount,
      criticalRisks.filter((risk) => risk > v4LaunchPolicyConstraints.maximum_critical_field_risk).length
    ))),
    cheap_evidence_ready: source.cheap_evidence_ready === true,
    exact_anchor_count: Math.max(0, Math.round(finiteNumber(source.exact_anchor_count, 0))),
    ocr_anchor_count: Math.max(0, Math.round(finiteNumber(source.ocr_anchor_count, 0))),
    catalog: {
      attempted: source.catalog?.attempted === true,
      candidate_count: Math.max(0, Math.round(finiteNumber(source.catalog?.candidate_count, 0))),
      unique_exact_match: source.catalog?.unique_exact_match === true,
      top_margin: probability(source.catalog?.top_margin, 0),
      direct_conflict_count: Math.max(0, Math.round(finiteNumber(source.catalog?.direct_conflict_count, 0)))
    },
    vector: {
      attempted: source.vector?.attempted === true,
      candidate_count: Math.max(0, Math.round(finiteNumber(source.vector?.candidate_count, 0))),
      top_margin: probability(source.vector?.top_margin, 0)
    },
    gpt: { attempted: source.gpt?.attempted === true },
    focused_verifier: { attempted: source.focused_verifier?.attempted === true },
    external_retrieval: { attempted: source.external_retrieval?.attempted === true }
  };
}

export function normalizeRecognitionPolicyState(input = {}) {
  const source = plainObject(input);
  return {
    schema_version: "v4-recognition-policy-state-v1",
    state_id: String(source.state_id || source.stateId || "").trim() || null,
    task_type: String(source.task_type || source.taskType || "SINGLE_CARD").trim().toUpperCase(),
    invariants: source.invariants?.schema_version === "v4-hard-invariant-snapshot-v1"
      ? source.invariants
      : normalizeHardInvariantSnapshot(source.invariants || {}),
    evidence: normalizeEvidenceState(source.evidence || {}),
    completed_actions: normalizedCompletedActions(source.completed_actions || source.completedActions),
    elapsed_ms: Math.max(0, finiteNumber(source.elapsed_ms ?? source.elapsedMs, 0)),
    remaining_latency_budget_ms: Math.max(0, finiteNumber(
      source.remaining_latency_budget_ms ?? source.remainingLatencyBudgetMs,
      60_000
    ))
  };
}

function actionAttempted(state, action) {
  if (state.completed_actions.includes(action)) return true;
  const evidence = state.evidence;
  if (action === recognitionPolicyActions.RUN_CHEAP_EVIDENCE) return evidence.cheap_evidence_ready;
  if (action === recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP) return evidence.catalog.attempted;
  if (action === recognitionPolicyActions.RUN_GPT_OBSERVATION) return evidence.gpt.attempted;
  if (action === recognitionPolicyActions.RUN_VECTOR_RETRIEVAL) return evidence.vector.attempted;
  if (action === recognitionPolicyActions.RUN_FOCUSED_VERIFIER) return evidence.focused_verifier.attempted;
  if (action === recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL) return evidence.external_retrieval.attempted;
  return false;
}

export function recognitionStopRisk(stateInput = {}, constraints = v4LaunchPolicyConstraints) {
  const state = stateInput?.schema_version === "v4-recognition-policy-state-v1"
    ? stateInput
    : normalizeRecognitionPolicyState(stateInput);
  const conflictRisk = Math.min(1, state.evidence.direct_conflict_count * 0.25);
  return {
    global_risk: Math.max(state.evidence.global_risk, conflictRisk),
    critical_field_risk: Math.max(state.evidence.critical_field_risk, conflictRisk),
    direct_conflict_count: state.evidence.direct_conflict_count,
    safe_to_stop: state.invariants.feasible
      && state.task_type === "SINGLE_CARD"
      && state.evidence.global_risk <= constraints.maximum_stop_risk
      && state.evidence.critical_field_risk <= constraints.maximum_critical_field_risk
      && state.evidence.direct_conflict_count <= constraints.maximum_direct_conflicts_for_stop
  };
}

export function feasibleRecognitionActions(stateInput = {}, constraints = v4LaunchPolicyConstraints) {
  const state = stateInput?.schema_version === "v4-recognition-policy-state-v1"
    ? stateInput
    : normalizeRecognitionPolicyState(stateInput);
  if (!state.invariants.feasible) return [recognitionPolicyActions.REJECT_INVALID_INPUT];
  if (state.task_type !== "SINGLE_CARD") return [recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW];

  const actions = [];
  const evidence = state.evidence;
  if (!actionAttempted(state, recognitionPolicyActions.RUN_CHEAP_EVIDENCE)) {
    actions.push(recognitionPolicyActions.RUN_CHEAP_EVIDENCE);
  }
  if (!actionAttempted(state, recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP)
    && (evidence.exact_anchor_count > 0 || evidence.ocr_anchor_count > 0 || evidence.gpt.attempted)) {
    actions.push(recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP);
  }
  if (!actionAttempted(state, recognitionPolicyActions.RUN_GPT_OBSERVATION)) {
    actions.push(recognitionPolicyActions.RUN_GPT_OBSERVATION);
  }
  const identityAmbiguous = evidence.catalog.candidate_count > 1
    || (evidence.catalog.attempted && evidence.catalog.top_margin < 0.12)
    || evidence.catalog.attempted && evidence.catalog.candidate_count === 0;
  if (!actionAttempted(state, recognitionPolicyActions.RUN_VECTOR_RETRIEVAL)
    && !evidence.catalog.unique_exact_match
    && identityAmbiguous) {
    actions.push(recognitionPolicyActions.RUN_VECTOR_RETRIEVAL);
  }
  if (!actionAttempted(state, recognitionPolicyActions.RUN_FOCUSED_VERIFIER)
    && (evidence.direct_conflict_count > 0 || evidence.unresolved_critical_field_count > 0)
    && (evidence.gpt.attempted || evidence.catalog.attempted)) {
    actions.push(recognitionPolicyActions.RUN_FOCUSED_VERIFIER);
  }
  if (!actionAttempted(state, recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL)
    && evidence.gpt.attempted
    && evidence.catalog.attempted
    && evidence.catalog.candidate_count === 0) {
    actions.push(recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL);
  }
  if (recognitionStopRisk(state, constraints).safe_to_stop) {
    actions.push(recognitionPolicyActions.STOP_AND_RENDER);
  }
  actions.push(recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW);
  return [...new Set(actions)];
}

function withActionAttempted(state, action) {
  const next = structuredClone(state);
  next.completed_actions = [...new Set([...next.completed_actions, action])];
  if (action === recognitionPolicyActions.RUN_CHEAP_EVIDENCE) next.evidence.cheap_evidence_ready = true;
  if (action === recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP) next.evidence.catalog.attempted = true;
  if (action === recognitionPolicyActions.RUN_GPT_OBSERVATION) next.evidence.gpt.attempted = true;
  if (action === recognitionPolicyActions.RUN_VECTOR_RETRIEVAL) next.evidence.vector.attempted = true;
  if (action === recognitionPolicyActions.RUN_FOCUSED_VERIFIER) next.evidence.focused_verifier.attempted = true;
  if (action === recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL) next.evidence.external_retrieval.attempted = true;
  return next;
}

function applyOutcome(state, action, outcome = {}, actionModel = {}) {
  const next = withActionAttempted(state, action);
  next.evidence.global_risk = probability(
    next.evidence.global_risk * finiteNumber(outcome.risk_multiplier, 1),
    next.evidence.global_risk
  );
  next.evidence.critical_field_risk = probability(
    next.evidence.critical_field_risk * finiteNumber(outcome.critical_risk_multiplier, 1),
    next.evidence.critical_field_risk
  );
  next.elapsed_ms += Math.max(0, finiteNumber(actionModel.latency_ms, 0));
  next.remaining_latency_budget_ms = Math.max(
    0,
    next.remaining_latency_budget_ms - Math.max(0, finiteNumber(actionModel.latency_ms, 0))
  );
  const patch = plainObject(outcome.state_patch);
  if (Number.isFinite(Number(patch.exact_anchor_count))) {
    next.evidence.exact_anchor_count = Math.max(0, Math.round(Number(patch.exact_anchor_count)));
  }
  if (Number.isFinite(Number(patch.ocr_anchor_count))) {
    next.evidence.ocr_anchor_count = Math.max(0, Math.round(Number(patch.ocr_anchor_count)));
  }
  if (patch.catalog && typeof patch.catalog === "object") {
    next.evidence.catalog = { ...next.evidence.catalog, ...patch.catalog };
  }
  if (Number.isFinite(Number(patch.direct_conflict_count))) {
    next.evidence.direct_conflict_count = Math.max(0, Math.round(Number(patch.direct_conflict_count)));
  }
  if (Number.isFinite(Number(patch.unresolved_critical_field_count))) {
    next.evidence.unresolved_critical_field_count = Math.max(
      0,
      Math.round(Number(patch.unresolved_critical_field_count))
    );
  }
  return next;
}

function normalizedTransitionModel(model = {}) {
  const source = plainObject(model);
  return {
    ...defaultRecognitionTransitionModel,
    ...source,
    action_models: {
      ...defaultRecognitionTransitionModel.action_models,
      ...plainObject(source.action_models)
    }
  };
}

function actionExecutionCost(actionModel = {}, weights = {}) {
  return Math.max(0, finiteNumber(actionModel.latency_ms, 0)) * finiteNumber(weights.latency_per_ms, 0.001)
    + Math.max(0, finiteNumber(actionModel.cost_units, 0)) * finiteNumber(weights.cost_unit, 5)
    + Math.max(0, finiteNumber(actionModel.capacity_ms, 0)) * finiteNumber(weights.capacity_per_ms, 0.0002)
    + probability(actionModel.technical_failure_rate, 0) * finiteNumber(weights.technical_failure, 1_000);
}

function terminalValue(action, state, constraints, weights) {
  if (action === recognitionPolicyActions.REJECT_INVALID_INPUT) {
    return { objective_loss: 0, terminal: true, reason: "hard_invariant_gate" };
  }
  if (action === recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW) {
    return {
      objective_loss: finiteNumber(weights.writer_review, 100),
      terminal: true,
      reason: "risk_above_safe_stop_or_no_positive_voi"
    };
  }
  const risk = recognitionStopRisk(state, constraints);
  if (!risk.safe_to_stop) return { objective_loss: Number.POSITIVE_INFINITY, terminal: true, reason: "unsafe_stop" };
  return {
    objective_loss: risk.global_risk * finiteNumber(weights.sem_error, 1_000)
      + risk.critical_field_risk * finiteNumber(weights.critical_error, 2_000),
    terminal: true,
    reason: "calibrated_risk_below_stop_threshold"
  };
}

function stateMemoKey(state, depth) {
  return JSON.stringify({
    depth,
    task_type: state.task_type,
    feasible: state.invariants.feasible,
    global_risk: Math.round(state.evidence.global_risk * 1_000) / 1_000,
    critical_risk: Math.round(state.evidence.critical_field_risk * 1_000) / 1_000,
    conflicts: state.evidence.direct_conflict_count,
    unresolved: state.evidence.unresolved_critical_field_count,
    exact_anchor_count: state.evidence.exact_anchor_count,
    ocr_anchor_count: state.evidence.ocr_anchor_count,
    catalog: state.evidence.catalog,
    completed: [...state.completed_actions].sort()
  });
}

export function solveOptimalRecognitionPolicy({
  state: stateInput = {},
  transitionModel = defaultRecognitionTransitionModel,
  constraints = v4LaunchPolicyConstraints,
  horizon = 4,
  weights = {}
} = {}) {
  const initialState = stateInput?.schema_version === "v4-recognition-policy-state-v1"
    ? structuredClone(stateInput)
    : normalizeRecognitionPolicyState(stateInput);
  const model = normalizedTransitionModel(transitionModel);
  const objectiveWeights = {
    sem_error: 1_000,
    critical_error: 2_000,
    technical_failure: 1_000,
    writer_review: 100,
    latency_per_ms: 0.001,
    capacity_per_ms: 0.0002,
    cost_unit: 5,
    ...plainObject(weights)
  };
  const memo = new Map();

  function solve(state, depth) {
    const key = stateMemoKey(state, depth);
    if (memo.has(key)) return memo.get(key);
    const feasible = feasibleRecognitionActions(state, constraints);
    const terminal = feasible.filter((action) => terminalActions.has(action));
    const candidates = [];
    for (const action of terminal) {
      candidates.push({ action, ...terminalValue(action, state, constraints, objectiveWeights) });
    }
    if (depth > 0) {
      for (const action of feasible.filter((value) => !terminalActions.has(value))) {
        const actionModel = model.action_models[action] || {};
        const outcomes = Array.isArray(actionModel.outcomes) && actionModel.outcomes.length
          ? actionModel.outcomes
          : [{ probability: 1, risk_multiplier: 1, critical_risk_multiplier: 1 }];
        const probabilitySum = outcomes.reduce((sum, outcome) => sum + probability(outcome.probability, 0), 0) || 1;
        let continuationLoss = 0;
        const branches = [];
        for (const outcome of outcomes) {
          const branchProbability = probability(outcome.probability, 0) / probabilitySum;
          const nextState = applyOutcome(state, action, outcome, actionModel);
          const next = solve(nextState, depth - 1);
          continuationLoss += branchProbability * next.objective_loss;
          branches.push({ probability: branchProbability, next_action: next.action, objective_loss: next.objective_loss });
        }
        const executionCost = actionExecutionCost(actionModel, objectiveWeights);
        candidates.push({
          action,
          terminal: false,
          objective_loss: executionCost + continuationLoss,
          execution_cost: executionCost,
          branches
        });
      }
    }
    if (!candidates.length) {
      candidates.push({
        action: recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW,
        ...terminalValue(recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW, state, constraints, objectiveWeights)
      });
    }
    candidates.sort((left, right) => left.objective_loss - right.objective_loss
      || String(left.action).localeCompare(String(right.action)));
    const best = {
      ...candidates[0],
      alternatives: candidates.slice(1).map(({ action, objective_loss, execution_cost = null }) => ({
        action,
        objective_loss,
        execution_cost
      }))
    };
    memo.set(key, best);
    return best;
  }

  const decision = solve(initialState, Math.max(0, Math.min(8, Math.round(finiteNumber(horizon, 4)))));
  const stopRisk = recognitionStopRisk(initialState, constraints);
  return {
    schema_version: "v4-optimal-recognition-decision-v1",
    policy_id: constraints.policy_id,
    policy_version: constraints.policy_version,
    shadow_only: constraints.shadow_only !== false,
    transition_model_id: model.model_id,
    transition_model_fitted_from_replay: model.fitted_from_replay === true,
    state_id: initialState.state_id,
    next_action: decision.action,
    expected_objective_loss: decision.objective_loss,
    current_stop_risk: stopRisk,
    feasible_actions: feasibleRecognitionActions(initialState, constraints),
    alternatives: decision.alternatives || [],
    reason_trace: [
      initialState.invariants.feasible ? "HARD_INVARIANTS_PASS" : "HARD_INVARIANTS_FAIL_OR_UNKNOWN",
      `GLOBAL_RISK_${stopRisk.global_risk.toFixed(4)}`,
      `CRITICAL_RISK_${stopRisk.critical_field_risk.toFixed(4)}`,
      `DIRECT_CONFLICTS_${stopRisk.direct_conflict_count}`,
      `SELECTED_${decision.action}`
    ]
  };
}

export function allHardInvariantsPassSnapshot() {
  return normalizeHardInvariantSnapshot({
    checks: Object.fromEntries([
      "DURABLE_ASSET_ID",
      "TENANT_ASSET_OWNERSHIP",
      "IMMUTABLE_IMAGE_GENERATION",
      "VERIFIED_CANONICAL_IMAGE_SET",
      "CANONICAL_STORAGE_SCOPE",
      "SINGLE_EXECUTION_IDENTITY"
    ].map((invariantId) => [invariantId, hardInvariantStatuses.PASS]))
  });
}
