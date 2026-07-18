import {
  defaultRecognitionTransitionModel,
  nonTerminalRecognitionActions,
  recognitionPolicyActions
} from "./optimal-recognition-policy.mjs";

export const fullInformationReplaySchemaVersion = "v4-full-information-replay-v1";

export const reviewedFieldTruthSources = Object.freeze(new Set([
  "REVIEWED_FIELD_GT",
  "WRITER_REVIEWED_FIELDS",
  "GOLDEN_SEM",
  "DEVELOPMENT_FIXTURE_FIELDS"
]));

const excludedTruthValues = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "N/A", "NULL"]);

const canonicalFieldAliases = Object.freeze({
  player: "subject",
  players: "subject",
  subjects: "subject",
  character: "subject",
  characters: "subject",
  brand: "manufacturer",
  product_or_set: "product_or_set",
  card_grade: "grade",
  parallel_exact: "parallel",
  variant_or_parallel: "parallel",
  serial_denominator: "numerical_rarity",
  print_run: "numerical_rarity"
});

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalFieldName(field) {
  const normalized = cleanText(field).toLowerCase().replace(/[\s-]+/g, "_");
  return canonicalFieldAliases[normalized] || normalized;
}

function normalizeScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") return value;
  const text = cleanText(value);
  if (excludedTruthValues.has(text.toUpperCase())) return null;
  return text || null;
}

function normalizedSubjectSet(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap((entry) => cleanText(entry).split(/\s*(?:,|&|\band\b|\/\s+)\s*/i))
    .map((entry) => entry.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean))].sort();
}

function normalizedComparisonValue(field, value) {
  if (field === "subject") return normalizedSubjectSet(value);
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizedComparisonValue(field, entry))
      .filter((entry) => entry !== null)
      .map((entry) => JSON.stringify(entry)))].sort().map((entry) => JSON.parse(entry));
  }
  if (typeof value === "boolean" || typeof value === "number") return value;
  const scalar = normalizeScalar(value);
  if (scalar === null) return null;
  if (field === "numerical_rarity") {
    const match = scalar.match(/(?:^|\s)(?:#\s*)?(\d+)\s*\/\s*(\d+)(?:\s|$)/);
    if (match) return `${Number(match[1])}/${Number(match[2])}`;
    const denominator = scalar.match(/(?:^|\s)(?:#\s*)?\/\s*(\d+)(?:\s|$)/);
    if (denominator) return `#/${Number(denominator[1])}`;
  }
  return scalar.toLowerCase()
    .normalize("NFKC")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9/#+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactFieldMatch(field, truthValue, predictedValue) {
  const truth = normalizedComparisonValue(field, truthValue);
  const prediction = normalizedComparisonValue(field, predictedValue);
  if (truth === null || prediction === null) return null;
  return JSON.stringify(truth) === JSON.stringify(prediction);
}

export function normalizeSemFields(input = {}) {
  const source = plainObject(input);
  const output = {};
  for (const [rawField, rawValue] of Object.entries(source)) {
    const field = canonicalFieldName(rawField);
    const value = rawValue?.value !== undefined && rawValue && typeof rawValue === "object"
      ? rawValue.value
      : rawValue;
    const normalized = field === "subject"
      ? normalizedSubjectSet(value)
      : normalizeScalar(value);
    if (normalized === null || (Array.isArray(normalized) && normalized.length === 0)) continue;
    if (field === "subject" && output.subject) {
      output.subject = [...new Set([...output.subject, ...normalized])].sort();
    } else {
      output[field] = normalized;
    }
  }
  return output;
}

function normalizedTruth(input = {}, fallbackProvenance = "UNREVIEWED") {
  const source = plainObject(input);
  const provenance = cleanText(
    source.provenance
    || source.source_type
    || source.truth_source
    || fallbackProvenance
  ).toUpperCase() || "UNREVIEWED";
  const wrappedFields = source.fields
    || source.golden_sem
    || source.ground_truth_fields
    || source.reviewed_fields;
  const metadataKeys = new Set([
    "provenance",
    "source_type",
    "truth_source",
    "critical_fields",
    "commercial_claim_eligible"
  ]);
  const fields = normalizeSemFields(wrappedFields || Object.fromEntries(
    Object.entries(source).filter(([key]) => !metadataKeys.has(key))
  ));
  const criticalFields = [...new Set((Array.isArray(source.critical_fields)
    ? source.critical_fields
    : Object.keys(fields))
    .map(canonicalFieldName)
    .filter((field) => field in fields))];
  const fieldReviewed = reviewedFieldTruthSources.has(provenance);
  return {
    provenance,
    fields,
    critical_fields: criticalFields,
    field_reviewed: fieldReviewed,
    oracle_evaluable: fieldReviewed && Object.keys(fields).length > 0,
    commercial_claim_eligible: fieldReviewed && provenance !== "DEVELOPMENT_FIXTURE_FIELDS"
  };
}

function predictionValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) return value.value;
  return value;
}

function normalizeActionStatus(value, technicalSuccess) {
  const status = cleanText(value).toUpperCase();
  if (["SUCCESS", "FAILED", "SKIPPED", "NOT_RUN", "TIMEOUT"].includes(status)) return status;
  if (technicalSuccess === true) return "SUCCESS";
  if (technicalSuccess === false) return "FAILED";
  return "UNKNOWN";
}

export function normalizeReplayActionObservation(input = {}, index = 0) {
  const source = plainObject(input);
  const action = cleanText(source.action || source.action_type).toUpperCase();
  const technicalSuccess = source.technical_success === true
    ? true
    : source.technical_success === false
      ? false
      : null;
  const fieldSource = source.field_predictions
    || source.fields
    || source.resolved_fields
    || source.output?.fields
    || {};
  const fieldPredictions = normalizeSemFields(Object.fromEntries(
    Object.entries(plainObject(fieldSource)).map(([field, value]) => [field, predictionValue(value)])
  ));
  const latencyValue = source.latency_ms ?? source.duration_ms;
  const capacityValue = source.capacity_ms;
  const costValue = source.cost_units ?? source.estimated_cost_units;
  return {
    observation_id: cleanText(source.observation_id || source.id) || `${action || "UNKNOWN_ACTION"}:${index + 1}`,
    action,
    variant: cleanText(source.variant || source.profile || source.mode) || null,
    status: normalizeActionStatus(source.status, technicalSuccess),
    technical_success: technicalSuccess,
    latency_ms: Math.max(0, finiteNumber(latencyValue, 0)),
    latency_observed: finiteNumber(latencyValue, null) !== null,
    capacity_ms: Math.max(0, finiteNumber(capacityValue, latencyValue ?? 0)),
    capacity_observed: finiteNumber(capacityValue, null) !== null || finiteNumber(latencyValue, null) !== null,
    cost_units: Math.max(0, finiteNumber(costValue, 0)),
    cost_observed: finiteNumber(costValue, null) !== null,
    field_predictions: fieldPredictions,
    state_before: plainObject(source.state_before || source.policy_state_before),
    state_after: plainObject(source.state_after || source.policy_state_after),
    invariant_violations: [...new Set((Array.isArray(source.invariant_violations)
      ? source.invariant_violations
      : []).map(cleanText).filter(Boolean))],
    metadata: plainObject(source.metadata)
  };
}

function normalizePolicyStateSnapshot(input = {}, index = 0) {
  const source = plainObject(input);
  return {
    snapshot_id: cleanText(source.snapshot_id || source.id) || `POLICY_STATE:${index + 1}`,
    observation_point: cleanText(source.observation_point || source.point).toUpperCase() || "UNSPECIFIED",
    state: plainObject(source.state || source.policy_state),
    observed_next_action: cleanText(source.observed_next_action || source.next_action).toUpperCase() || null,
    source: cleanText(source.source) || null
  };
}

export function normalizeFullInformationReplayCard(input = {}, index = 0) {
  const source = plainObject(input);
  const expectedActions = [...new Set((Array.isArray(source.expected_actions)
    ? source.expected_actions
    : nonTerminalRecognitionActions).map((action) => cleanText(action).toUpperCase()).filter(Boolean))];
  const observations = (Array.isArray(source.action_observations)
    ? source.action_observations
    : Array.isArray(source.actions)
      ? source.actions
      : []).map(normalizeReplayActionObservation).filter((observation) => observation.action);
  const policyStateSnapshots = (Array.isArray(source.policy_state_snapshots)
    ? source.policy_state_snapshots
    : []).map(normalizePolicyStateSnapshot).filter((snapshot) => Object.keys(snapshot.state).length > 0);
  const observedActions = new Set(observations
    .filter((observation) => !["SKIPPED", "NOT_RUN"].includes(observation.status))
    .map((observation) => observation.action));
  const truth = normalizedTruth(
    source.truth || source.ground_truth || source.golden_sem || {},
    source.truth_provenance
  );
  return {
    query_card_id: cleanText(source.query_card_id || source.asset_id || source.card_id) || `replay-card-${index + 1}`,
    cohort: cleanText(source.cohort || source.split || source.category) || "UNSPECIFIED",
    truth,
    expected_actions: expectedActions,
    observed_actions: [...observedActions].sort(),
    full_information_complete: expectedActions.length > 0 && expectedActions.every((action) => observedActions.has(action)),
    action_observations: observations,
    policy_state_snapshots: policyStateSnapshots,
    current_path: (Array.isArray(source.current_path) ? source.current_path : [])
      .map((action) => cleanText(action).toUpperCase()).filter(Boolean),
    current_final_fields: normalizeSemFields(source.current_final_fields || source.final_fields || {}),
    proxy_labels: plainObject(source.proxy_labels),
    source_refs: Array.isArray(source.source_refs) ? source.source_refs.map(cleanText).filter(Boolean) : []
  };
}

export function buildFullInformationReplay({ cards = [], sourceRefs = [], metadata = {} } = {}) {
  const normalizedCards = (Array.isArray(cards) ? cards : []).map(normalizeFullInformationReplayCard);
  return {
    schema_version: fullInformationReplaySchemaVersion,
    generated_at: new Date().toISOString(),
    policy_scope: "SHADOW_ONLY",
    expected_action_vocabulary: [...nonTerminalRecognitionActions],
    source_refs: (Array.isArray(sourceRefs) ? sourceRefs : []).map(cleanText).filter(Boolean),
    metadata: plainObject(metadata),
    cards: normalizedCards,
    data_quality: {
      card_count: normalizedCards.length,
      field_reviewed_card_count: normalizedCards.filter((card) => card.truth.field_reviewed).length,
      oracle_evaluable_card_count: normalizedCards.filter((card) => card.truth.oracle_evaluable).length,
      full_information_complete_card_count: normalizedCards.filter((card) => card.full_information_complete).length,
      policy_state_snapshot_count: normalizedCards.reduce((sum, card) => sum + card.policy_state_snapshots.length, 0),
      commercial_claim_eligible_card_count: normalizedCards.filter((card) => card.truth.commercial_claim_eligible).length
    }
  };
}

function evaluateObservationFields(observation, truth) {
  const correctFields = [];
  const incorrectFields = [];
  const missingFields = [];
  for (const [field, truthValue] of Object.entries(truth.fields)) {
    if (!(field in observation.field_predictions)) {
      missingFields.push(field);
      continue;
    }
    const matches = exactFieldMatch(field, truthValue, observation.field_predictions[field]);
    if (matches === true) correctFields.push(field);
    else if (matches === false) incorrectFields.push(field);
    else missingFields.push(field);
  }
  return { correct_fields: correctFields, incorrect_fields: incorrectFields, missing_fields: missingFields };
}

function combinations(values) {
  if (values.length > 16) return [];
  const output = [];
  const count = 2 ** values.length;
  for (let mask = 1; mask < count; mask += 1) {
    const subset = [];
    for (let index = 0; index < values.length; index += 1) {
      if (mask & (1 << index)) subset.push(values[index]);
    }
    output.push(subset);
  }
  return output;
}

function subsetCost(subset) {
  return {
    latency_ms: subset.reduce((sum, observation) => sum + observation.latency_ms, 0),
    capacity_ms: subset.reduce((sum, observation) => sum + observation.capacity_ms, 0),
    cost_units: subset.reduce((sum, observation) => sum + observation.cost_units, 0)
  };
}

function actionPolicyKey(observation) {
  return observation.variant ? `${observation.action}::${observation.variant}` : observation.action;
}

function minimumCoveringSubsets(observations, requiredFields, fieldEvaluations) {
  const eligible = observations.filter((observation) => observation.technical_success !== false
    && observation.invariant_violations.length === 0);
  const exactSubsets = combinations(eligible).filter((subset) => {
    const covered = new Set(subset.flatMap((observation) => fieldEvaluations.get(observation.observation_id)?.correct_fields || []));
    return requiredFields.every((field) => covered.has(field));
  });
  const pick = (metric) => exactSubsets
    .map((subset) => ({
      observation_ids: subset.map((observation) => observation.observation_id),
      actions: [...new Set(subset.map((observation) => observation.action))],
      ...subsetCost(subset)
    }))
    .sort((left, right) => left[metric] - right[metric]
      || left.observation_ids.length - right.observation_ids.length)[0] || null;
  return {
    subset_count: exactSubsets.length,
    minimum_latency: pick("latency_ms"),
    minimum_capacity: pick("capacity_ms"),
    minimum_cost: pick("cost_units")
  };
}

export function evaluateFullInformationReplayCard(cardInput = {}) {
  const card = cardInput?.truth?.fields
    ? cardInput
    : normalizeFullInformationReplayCard(cardInput);
  const requiredFields = Object.keys(card.truth.fields);
  const criticalFields = card.truth.critical_fields;
  const fieldEvaluations = new Map();
  const observationEvaluations = card.action_observations.map((observation) => {
    const evaluation = evaluateObservationFields(observation, card.truth);
    fieldEvaluations.set(observation.observation_id, evaluation);
    return { ...observation, field_evaluation: evaluation };
  });
  const correctSourcesByField = Object.fromEntries(requiredFields.map((field) => [field, []]));
  const wrongSourcesByField = Object.fromEntries(requiredFields.map((field) => [field, []]));
  for (const observation of observationEvaluations) {
    for (const field of observation.field_evaluation.correct_fields) correctSourcesByField[field].push(observation.observation_id);
    for (const field of observation.field_evaluation.incorrect_fields) wrongSourcesByField[field].push(observation.observation_id);
  }
  const uncoveredFields = requiredFields.filter((field) => correctSourcesByField[field].length === 0);
  const uncoveredCriticalFields = criticalFields.filter((field) => correctSourcesByField[field]?.length === 0);
  const chainOracleExact = card.truth.oracle_evaluable && uncoveredFields.length === 0;
  const minimumActions = chainOracleExact
    ? minimumCoveringSubsets(card.action_observations, requiredFields, fieldEvaluations)
    : { subset_count: 0, minimum_latency: null, minimum_capacity: null, minimum_cost: null };
  return {
    query_card_id: card.query_card_id,
    cohort: card.cohort,
    oracle_evaluable: card.truth.oracle_evaluable,
    commercial_claim_eligible: card.truth.commercial_claim_eligible,
    full_information_complete: card.full_information_complete,
    required_fields: requiredFields,
    critical_fields: criticalFields,
    chain_oracle_exact: chainOracleExact,
    chain_oracle_critical_exact: card.truth.oracle_evaluable && uncoveredCriticalFields.length === 0,
    uncovered_fields: uncoveredFields,
    uncovered_critical_fields: uncoveredCriticalFields,
    correct_sources_by_field: correctSourcesByField,
    wrong_sources_by_field: wrongSourcesByField,
    minimum_actions: minimumActions,
    action_observations: observationEvaluations
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function actionSubsetMetrics(evaluations, actionSubset) {
  const actionSet = new Set(actionSubset);
  const eligible = evaluations.filter((evaluation) => evaluation.oracle_evaluable && evaluation.full_information_complete);
  let exact = 0;
  let criticalExact = 0;
  let technicalSuccess = 0;
  const latencies = [];
  const capacities = [];
  let costTotal = 0;
  for (const evaluation of eligible) {
    const selectedObservations = evaluation.action_observations.filter((observation) => actionSet.has(actionPolicyKey(observation)));
    const requiredActionsSucceeded = actionSubset.every((actionKey) => selectedObservations.some((observation) => {
      return actionPolicyKey(observation) === actionKey
        && observation.technical_success !== false
        && !["FAILED", "TIMEOUT", "SKIPPED", "NOT_RUN"].includes(observation.status)
        && observation.invariant_violations.length === 0;
    }));
    if (requiredActionsSucceeded) technicalSuccess += 1;
    const observations = selectedObservations.filter((observation) => observation.technical_success !== false
      && !["FAILED", "TIMEOUT", "SKIPPED", "NOT_RUN"].includes(observation.status)
      && observation.invariant_violations.length === 0);
    const covered = new Set(observations.flatMap((observation) => observation.field_evaluation.correct_fields));
    if (evaluation.required_fields.every((field) => covered.has(field))) exact += 1;
    if (evaluation.critical_fields.every((field) => covered.has(field))) criticalExact += 1;
    const cost = subsetCost(observations);
    latencies.push(cost.latency_ms);
    capacities.push(cost.capacity_ms);
    costTotal += cost.cost_units;
  }
  return {
    actions: [...actionSubset],
    evaluated_card_count: eligible.length,
    sem_accuracy: eligible.length ? exact / eligible.length : null,
    critical_field_accuracy: eligible.length ? criticalExact / eligible.length : null,
    technical_success_rate: eligible.length ? technicalSuccess / eligible.length : null,
    technical_failure_rate: eligible.length ? 1 - technicalSuccess / eligible.length : null,
    median_sequential_latency_ms: median(latencies),
    median_capacity_ms: median(capacities),
    mean_cost_units: eligible.length ? costTotal / eligible.length : null,
    cards_per_minute_per_capacity_slot: median(capacities) > 0 ? 60_000 / median(capacities) : null
  };
}

function dominates(left, right) {
  if (left.sem_accuracy === null || right.sem_accuracy === null) return false;
  const noWorse = left.sem_accuracy >= right.sem_accuracy
    && left.critical_field_accuracy >= right.critical_field_accuracy
    && left.technical_success_rate >= right.technical_success_rate
    && left.median_sequential_latency_ms <= right.median_sequential_latency_ms
    && left.median_capacity_ms <= right.median_capacity_ms
    && left.mean_cost_units <= right.mean_cost_units;
  const strictlyBetter = left.sem_accuracy > right.sem_accuracy
    || left.critical_field_accuracy > right.critical_field_accuracy
    || left.technical_success_rate > right.technical_success_rate
    || left.median_sequential_latency_ms < right.median_sequential_latency_ms
    || left.median_capacity_ms < right.median_capacity_ms
    || left.mean_cost_units < right.mean_cost_units;
  return noWorse && strictlyBetter;
}

export function evaluateFullInformationReplay(replayInput = {}) {
  const replay = replayInput?.schema_version === fullInformationReplaySchemaVersion
    ? replayInput
    : buildFullInformationReplay(replayInput);
  const perCard = replay.cards.map(evaluateFullInformationReplayCard);
  const oracleEvaluable = perCard.filter((card) => card.oracle_evaluable);
  const fullInformation = oracleEvaluable.filter((card) => card.full_information_complete);
  const actionVocabulary = [...new Set(fullInformation.flatMap((card) => card.action_observations.map(actionPolicyKey)))];
  const staticPolicies = combinations(actionVocabulary)
    .map((actions) => actionSubsetMetrics(perCard, actions));
  const paretoFrontier = staticPolicies.filter((policy) => !staticPolicies.some((other) => other !== policy && dominates(other, policy)))
    .sort((left, right) => (left.sem_accuracy ?? -1) - (right.sem_accuracy ?? -1)
      || left.median_sequential_latency_ms - right.median_sequential_latency_ms);
  const targets = [0.85, 0.87, 0.9, 0.95].map((target) => ({
    target,
    minimum_latency_policy: staticPolicies
      .filter((policy) => policy.sem_accuracy !== null && policy.sem_accuracy >= target)
      .sort((left, right) => left.median_sequential_latency_ms - right.median_sequential_latency_ms
        || left.mean_cost_units - right.mean_cost_units)[0] || null
  }));
  return {
    schema_version: "v4-full-information-replay-evaluation-v1",
    generated_at: new Date().toISOString(),
    source_schema_version: replay.schema_version,
    data_quality: {
      ...replay.data_quality,
      full_information_oracle_evaluable_count: fullInformation.length,
      oracle_claim_blocked: fullInformation.length === 0,
      oracle_claim_blocked_reason: fullInformation.length === 0
        ? "NO_FIELD_REVIEWED_FULL_INFORMATION_CARDS"
        : null
    },
    chain_oracle: {
      evaluated_card_count: fullInformation.length,
      sem_exact_count: fullInformation.filter((card) => card.chain_oracle_exact).length,
      sem_accuracy_upper_bound: fullInformation.length
        ? fullInformation.filter((card) => card.chain_oracle_exact).length / fullInformation.length
        : null,
      critical_exact_count: fullInformation.filter((card) => card.chain_oracle_critical_exact).length,
      critical_accuracy_upper_bound: fullInformation.length
        ? fullInformation.filter((card) => card.chain_oracle_critical_exact).length / fullInformation.length
        : null
    },
    static_action_policy_count: staticPolicies.length,
    pareto_frontier: paretoFrontier,
    launch_policy_candidates: selectFeasibleLaunchPolicies({ pareto_frontier: paretoFrontier }),
    target_frontier: targets,
    per_card: perCard
  };
}

export function selectFeasibleLaunchPolicies(evaluation, {
  minimumSemAccuracy = 0.87,
  minimumCriticalAccuracy = 0.95,
  minimumCardsPerMinute = 6,
  maximumTechnicalFailureRate = 0.001,
  effectiveCapacitySlots = 2
} = {}) {
  const rows = Array.isArray(evaluation?.pareto_frontier) ? evaluation.pareto_frontier : [];
  return rows.map((policy) => {
    const estimatedCardsPerMinute = policy.cards_per_minute_per_capacity_slot === null
      ? null
      : policy.cards_per_minute_per_capacity_slot * effectiveCapacitySlots;
    const blockers = [
      ...(policy.sem_accuracy >= minimumSemAccuracy ? [] : ["SEM_ACCURACY_BELOW_GATE"]),
      ...(policy.critical_field_accuracy >= minimumCriticalAccuracy ? [] : ["CRITICAL_ACCURACY_BELOW_GATE"]),
      ...(estimatedCardsPerMinute !== null && estimatedCardsPerMinute >= minimumCardsPerMinute
        ? []
        : ["THROUGHPUT_BELOW_GATE"]),
      ...(policy.technical_failure_rate <= maximumTechnicalFailureRate ? [] : ["TECHNICAL_FAILURE_ABOVE_GATE"])
    ];
    return {
      ...policy,
      effective_capacity_slots: effectiveCapacitySlots,
      estimated_cards_per_minute: estimatedCardsPerMinute,
      launch_feasible: blockers.length === 0,
      launch_blockers: blockers
    };
  }).sort((left, right) => Number(right.launch_feasible) - Number(left.launch_feasible)
    || (right.sem_accuracy ?? -1) - (left.sem_accuracy ?? -1)
    || (right.estimated_cards_per_minute ?? -1) - (left.estimated_cards_per_minute ?? -1));
}

function riskValue(state, key) {
  const value = finiteNumber(state?.evidence?.[key] ?? state?.[key], null);
  return value === null ? null : Math.max(0, Math.min(1, value));
}

export function fitRecognitionTransitionModelFromReplay(replayInput = {}, { minimumRiskPairs = 5 } = {}) {
  const replay = replayInput?.schema_version === fullInformationReplaySchemaVersion
    ? replayInput
    : buildFullInformationReplay(replayInput);
  const actionModels = {};
  const fitQuality = {};
  for (const action of nonTerminalRecognitionActions) {
    const observations = replay.cards.flatMap((card) => card.action_observations.filter((row) => row.action === action));
    const successes = observations.filter((row) => row.technical_success !== false && row.status === "SUCCESS");
    const riskPairs = successes.map((row) => ({
      before: riskValue(row.state_before, "global_risk"),
      after: riskValue(row.state_after, "global_risk"),
      criticalBefore: riskValue(row.state_before, "critical_field_risk"),
      criticalAfter: riskValue(row.state_after, "critical_field_risk")
    })).filter((pair) => pair.before !== null && pair.after !== null && pair.before > 0);
    const reductions = riskPairs.filter((pair) => pair.after < pair.before);
    const prior = defaultRecognitionTransitionModel.action_models[action];
    const canFitOutcomes = riskPairs.length >= minimumRiskPairs;
    actionModels[action] = {
      ...prior,
      latency_ms: median(successes.filter((row) => row.latency_observed).map((row) => row.latency_ms)) ?? prior.latency_ms,
      capacity_ms: median(successes.filter((row) => row.capacity_observed).map((row) => row.capacity_ms)) ?? prior.capacity_ms,
      cost_units: median(successes.filter((row) => row.cost_observed).map((row) => row.cost_units)) ?? prior.cost_units,
      technical_failure_rate: observations.length
        ? observations.filter((row) => row.technical_success === false || ["FAILED", "TIMEOUT"].includes(row.status)).length / observations.length
        : prior.technical_failure_rate,
      outcomes: canFitOutcomes
        ? [
          {
            probability: reductions.length / riskPairs.length,
            risk_multiplier: median(reductions.map((pair) => pair.after / pair.before)) ?? 1,
            critical_risk_multiplier: median(reductions
              .filter((pair) => pair.criticalBefore > 0 && pair.criticalAfter !== null)
              .map((pair) => pair.criticalAfter / pair.criticalBefore)) ?? 1
          },
          {
            probability: 1 - reductions.length / riskPairs.length,
            risk_multiplier: 1,
            critical_risk_multiplier: 1
          }
        ]
        : prior.outcomes
    };
    fitQuality[action] = {
      observation_count: observations.length,
      successful_observation_count: successes.length,
      latency_observation_count: successes.filter((row) => row.latency_observed).length,
      capacity_observation_count: successes.filter((row) => row.capacity_observed).length,
      cost_observation_count: successes.filter((row) => row.cost_observed).length,
      risk_pair_count: riskPairs.length,
      outcomes_fitted: canFitOutcomes
    };
  }
  return {
    schema_version: "v4-recognition-transition-model-v1",
    model_id: `replay-fit-${new Date().toISOString()}`,
    fitted_from_replay: Object.values(fitQuality).some((entry) => entry.outcomes_fitted),
    source_card_count: replay.cards.length,
    fit_quality: fitQuality,
    action_models: actionModels
  };
}

export function emptyFullInformationCard(queryCardId, fields = {}) {
  return normalizeFullInformationReplayCard({
    query_card_id: queryCardId,
    truth: { provenance: "REVIEWED_FIELD_GT", fields },
    expected_actions: nonTerminalRecognitionActions,
    action_observations: []
  });
}

export const terminalRecognitionActions = Object.freeze([
  recognitionPolicyActions.STOP_AND_RENDER,
  recognitionPolicyActions.ROUTE_TO_WRITER_REVIEW,
  recognitionPolicyActions.REJECT_INVALID_INPUT
]);
