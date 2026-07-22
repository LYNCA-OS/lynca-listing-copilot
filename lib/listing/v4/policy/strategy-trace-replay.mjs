import crypto from "node:crypto";
import { policyFairTokenRecall } from "../../../../scripts/evaluate-cloud-listing-api.mjs";
import { providerTerminalPathActions } from "./provider-terminal-path-policy.mjs";
import { v4ProductionStrategy } from "./production-strategy.mjs";

export const strategyReplayOutcomeModes = Object.freeze({
  REUSE_BASELINE_OUTPUT: "REUSE_BASELINE_OUTPUT",
  DETERMINISTIC_OUTPUT: "DETERMINISTIC_OUTPUT",
  RECORDED_COUNTERFACTUAL: "RECORDED_COUNTERFACTUAL"
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

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value) {
  return value === null ? null : Number(Number(value).toFixed(6));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableObject(value))).digest("hex");
}

function candidateFunnel(row = {}, lane = "catalog") {
  return row.l2_candidate_debug?.[`${lane}_activation_funnel`] || {};
}

function promptCandidateCounts(row = {}) {
  const funnels = [candidateFunnel(row, "catalog"), candidateFunnel(row, "vector")];
  let initial = 0;
  let postObservation = 0;
  for (const funnel of funnels) {
    const providerPrompt = finiteNumber(funnel.provider_prompt_candidate_count, 0);
    const allPrompt = finiteNumber(funnel.prompt_candidate_count, 0);
    initial += providerPrompt;
    if (funnel.post_observation_query_attempted === true) {
      postObservation += Math.max(0, allPrompt - providerPrompt);
    }
  }
  return { initial, postObservation };
}

function assistEnabled(row = {}) {
  const funnels = [candidateFunnel(row, "catalog"), candidateFunnel(row, "vector")];
  return funnels.some((funnel) => funnel.query_attempted === true
    || funnel.pre_observation_query_attempted === true
    || funnel.post_observation_query_attempted === true);
}

function hardInvariantSnapshot(row = {}) {
  return row.v4_pipeline_contract?.shadow_recognition_policy?.state?.invariants || null;
}

function hardInvariantsPass(snapshot) {
  return Boolean(snapshot
    && snapshot.complete === true
    && snapshot.feasible === true
    && Array.isArray(snapshot.failed_invariants)
    && snapshot.failed_invariants.length === 0
    && Array.isArray(snapshot.unknown_invariants)
    && snapshot.unknown_invariants.length === 0);
}

function referenceTitle(row = {}) {
  return cleanText(row.reference_title || row.reviewed_title || row.corrected_title_reference || "");
}

function caseId(row = {}, index = 0) {
  return cleanText(
    row.sealed_label_key
    || row.asset_id
    || row.item_id
    || row.card_id
    || row.source_feedback_id
    || `row-${index + 1}`
  );
}

function decisionInputFromRow(row = {}, index = 0) {
  const counts = promptCandidateCounts(row);
  const recordedTrace = row.strategy_replay_trace || null;
  const recordedInput = recordedTrace?.decision_input || {};
  const enabled = typeof recordedInput.assist_enabled === "boolean"
    ? recordedInput.assist_enabled
    : assistEnabled(row);
  const initialPromptCandidateCount = typeof recordedInput.initial_prompt_candidate_present === "boolean"
    ? Number(recordedInput.initial_prompt_candidate_present)
    : counts.initial;
  const forceResolution = typeof recordedInput.force_retrieval_application_resolution === "boolean"
    ? recordedInput.force_retrieval_application_resolution
    : row.retrieval_ablation_execution?.force_retrieval_application_resolution === true;
  const assistShadowOnly = typeof recordedInput.assist_shadow_only === "boolean"
    ? recordedInput.assist_shadow_only
    : enabled && initialPromptCandidateCount === 0;
  const invariants = hardInvariantSnapshot(row);
  return {
    schema_version: "strategy-replay-decision-input-v1",
    case_id: caseId(row, index),
    asset_id: cleanText(row.asset_id),
    strategy_profile: row.v4_pipeline_contract?.strategy_profile || null,
    hard_invariants: invariants,
    hard_invariants_pass: hardInvariantsPass(invariants),
    provider_terminal: {
      assist_enabled: enabled,
      initial_prompt_candidate_count: initialPromptCandidateCount,
      post_observation_prompt_candidate_count: counts.postObservation,
      assist_shadow_only: assistShadowOnly,
      force_retrieval_application_resolution: forceResolution,
      recorded_control_boundary: cleanText(recordedTrace?.policy_decision?.action) || (
        assistShadowOnly && !forceResolution
          ? providerTerminalPathActions.RETURN_ASSIST_SHADOW
          : providerTerminalPathActions.CONTINUE_RESOLUTION
      )
    },
    candidate_control: {
      selected_candidate_id: cleanText(row.l2_candidate_debug?.selected_candidate_id),
      applied_field_count: finiteNumber(row.l2_candidate_debug?.applied_field_count, 0),
      applied_fields: row.l2_candidate_debug?.applied_fields || [],
      blocked_fields: row.l2_candidate_debug?.blocked_fields || [],
      candidate_observation_snapshot: row.l2_candidate_debug?.candidate_observation_snapshot || null,
      candidate_application_trace: row.l2_candidate_debug?.candidate_application_trace || [],
      catalog_activation_funnel: candidateFunnel(row, "catalog"),
      vector_activation_funnel: candidateFunnel(row, "vector")
    },
    baseline_output: {
      final_title: cleanText(row.final_title || row.title),
      resolved_fields: row.resolved_fields || {},
      field_states: row.field_states || {},
      route: cleanText(row.route),
      title_stage: cleanText(row.title_stage)
    },
    recorded_strategy_trace: recordedTrace
  };
}

function rowIsReviewedInternal(row = {}) {
  return row.reference_title_is_reviewed_ground_truth === true
    || cleanText(row.reference_title_type).toUpperCase() === "REVIEWED_INTERNAL_TITLE";
}

export function buildStrategyReplayPacket(report = {}, { source = "", scope = "all" } = {}) {
  const allRows = rowsFromReport(report);
  const rows = scope === "internal-reviewed" ? allRows.filter(rowIsReviewedInternal) : allRows;
  if (!["all", "internal-reviewed"].includes(scope)) throw new Error(`unsupported replay scope: ${scope}`);
  const cases = rows.map((row, index) => {
    const decisionInput = decisionInputFromRow(row, index);
    return {
      decision_input: decisionInput,
      sealed_evaluation: {
        reference_title: referenceTitle(row),
        baseline_policy_fair_recall: finiteNumber(row.final_scoring?.policy_fair_token_recall)
      }
    };
  });
  const fingerprintRows = cases.map((entry) => entry.decision_input.case_id);
  return {
    schema_version: "strategy-trace-replay-packet-v1",
    source,
    scope,
    card_count: cases.length,
    sample_fingerprint_sha256: sha256(fingerprintRows),
    label_isolation: {
      strategy_receives_decision_input_only: true,
      sealed_evaluation_unavailable_until_outcome_frozen: true
    },
    cases
  };
}

export function replayCurrentProductionStrategy(decisionInput = {}) {
  const terminal = decisionInput.provider_terminal || {};
  const plan = v4ProductionStrategy.provider_terminal.plan_after_provider({
    assistShadowOnly: terminal.assist_shadow_only === true,
    forceRetrievalApplicationResolution: terminal.force_retrieval_application_resolution === true,
    initialPromptCandidateCount: terminal.initial_prompt_candidate_count,
    postObservationPromptCandidateCount: terminal.post_observation_prompt_candidate_count,
    candidateControl: decisionInput.candidate_control
  });
  const recordedTrace = decisionInput.recorded_strategy_trace || {};
  const recordedPolicyAction = cleanText(recordedTrace.policy_decision?.action)
    || terminal.recorded_control_boundary;
  const departedRecordedBoundary = plan.action !== recordedPolicyAction;
  const counterfactual = recordedTrace.deterministic_counterfactuals?.[plan.action] || null;
  const replayableCounterfactual = departedRecordedBoundary
    && counterfactual
    && cleanText(counterfactual.final_title);
  return {
    schema_version: "strategy-replay-decision-v1",
    strategy_id: "current-production-strategy",
    terminal_control_decision: plan,
    outcome: {
      mode: replayableCounterfactual
        ? strategyReplayOutcomeModes.RECORDED_COUNTERFACTUAL
        : strategyReplayOutcomeModes.REUSE_BASELINE_OUTPUT,
      final_title: replayableCounterfactual ? cleanText(counterfactual.final_title) : "",
      resolved_fields: replayableCounterfactual ? counterfactual.resolved_fields || null : null
    },
    effects: departedRecordedBoundary && !replayableCounterfactual
      ? [{
        kind: "EXTERNAL_CALL",
        effect_id: "unrecorded-post-policy-resolution-path",
        recorded_outcome: null
      }]
      : []
  };
}

function normalizedStrategyResult(value = {}) {
  const outcome = value.outcome && typeof value.outcome === "object" ? value.outcome : {};
  return {
    schema_version: cleanText(value.schema_version) || "strategy-replay-decision-v1",
    strategy_id: cleanText(value.strategy_id) || "anonymous-strategy",
    terminal_control_decision: value.terminal_control_decision || null,
    outcome: {
      mode: cleanText(outcome.mode) || strategyReplayOutcomeModes.REUSE_BASELINE_OUTPUT,
      final_title: cleanText(outcome.final_title),
      resolved_fields: outcome.resolved_fields && typeof outcome.resolved_fields === "object"
        ? outcome.resolved_fields
        : null
    },
    effects: Array.isArray(value.effects) ? value.effects : []
  };
}

function replayOutputForDecision(decisionInput, strategyResult) {
  const baseline = decisionInput.baseline_output || {};
  if (strategyResult.outcome.mode === strategyReplayOutcomeModes.REUSE_BASELINE_OUTPUT) {
    return baseline;
  }
  if (![strategyReplayOutcomeModes.DETERMINISTIC_OUTPUT, strategyReplayOutcomeModes.RECORDED_COUNTERFACTUAL]
    .includes(strategyResult.outcome.mode)) {
    throw new Error(`unsupported outcome mode: ${strategyResult.outcome.mode}`);
  }
  if (!strategyResult.outcome.final_title) {
    throw new Error(`${strategyResult.outcome.mode} requires outcome.final_title`);
  }
  return {
    ...baseline,
    final_title: strategyResult.outcome.final_title,
    resolved_fields: strategyResult.outcome.resolved_fields || baseline.resolved_fields
  };
}

function unreplayedExternalEffects(strategyResult) {
  return strategyResult.effects.filter((effect) => effect?.kind === "EXTERNAL_CALL"
    && !(effect.recorded_outcome && typeof effect.recorded_outcome === "object"));
}

function average(values) {
  const clean = values.filter((value) => value !== null);
  return clean.length ? round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null;
}

function idMatches(row, requestedId) {
  const target = cleanText(requestedId).toLowerCase();
  return [row.case_id, row.asset_id].some((value) => cleanText(value).toLowerCase() === target);
}

export async function evaluateStrategyTraceReplay({
  packet,
  replayStrategyDecision = replayCurrentProductionStrategy,
  passThreshold = 0.72,
  requiredPassCaseIds = [],
  gateMode = "regression"
} = {}) {
  if (!packet || !Array.isArray(packet.cases)) throw new Error("strategy replay packet is required");
  if (!["regression", "launch"].includes(gateMode)) throw new Error(`unsupported strategy replay gate mode: ${gateMode}`);
  const frozenOutcomes = [];
  for (const replayCase of packet.cases) {
    const input = deepFreeze(structuredClone(replayCase.decision_input));
    try {
      const decision = normalizedStrategyResult(await replayStrategyDecision(input));
      const output = replayOutputForDecision(input, decision);
      frozenOutcomes.push({ input, decision, output, error: null });
    } catch (error) {
      frozenOutcomes.push({
        input,
        decision: null,
        output: input.baseline_output,
        error: cleanText(error?.message || error)
      });
    }
  }

  // Labels are deliberately opened only after every strategy outcome is frozen.
  const rows = frozenOutcomes.map((frozen, index) => {
    const sealed = packet.cases[index].sealed_evaluation || {};
    const reference = cleanText(sealed.reference_title);
    const baselineTitle = cleanText(frozen.input.baseline_output?.final_title);
    const replayTitle = cleanText(frozen.output?.final_title);
    const baselineScore = reference
      ? policyFairTokenRecall(reference, baselineTitle)
      : finiteNumber(sealed.baseline_policy_fair_recall);
    const replayScore = reference ? policyFairTokenRecall(reference, replayTitle) : null;
    const externalEffects = frozen.decision ? unreplayedExternalEffects(frozen.decision) : [];
    const blockers = [];
    if (!frozen.input.hard_invariants_pass) blockers.push("HARD_INVARIANTS_NOT_PROVEN");
    if (!reference) blockers.push("SEALED_REFERENCE_TITLE_MISSING");
    if (frozen.error) blockers.push("STRATEGY_REPLAY_ERROR");
    if (externalEffects.length) blockers.push("UNRECORDED_EXTERNAL_EFFECT");
    if (baselineScore !== null && baselineScore >= passThreshold && replayScore !== null && replayScore < passThreshold) {
      blockers.push("BASELINE_PASS_REGRESSION");
    }
    return {
      case_id: frozen.input.case_id,
      asset_id: frozen.input.asset_id,
      baseline_title: baselineTitle,
      replay_title: replayTitle,
      baseline_policy_fair_recall: round(baselineScore),
      replay_policy_fair_recall: round(replayScore),
      delta: baselineScore === null || replayScore === null ? null : round(replayScore - baselineScore),
      baseline_pass: baselineScore !== null && baselineScore >= passThreshold,
      replay_pass: replayScore !== null && replayScore >= passThreshold,
      terminal_control_decision: frozen.decision?.terminal_control_decision || null,
      strategy_id: frozen.decision?.strategy_id || null,
      unrecorded_external_effect_count: externalEffects.length,
      error: frozen.error,
      blockers
    };
  });

  const baselineScores = rows.map((row) => row.baseline_policy_fair_recall);
  const replayScores = rows.map((row) => row.replay_policy_fair_recall);
  const baselinePassCount = rows.filter((row) => row.baseline_pass).length;
  const replayPassCount = rows.filter((row) => row.replay_pass).length;
  const aggregateBlockers = new Set(rows.flatMap((row) => row.blockers));
  const baselineAverage = average(baselineScores);
  const replayAverage = average(replayScores);
  if (rows.length !== packet.card_count) aggregateBlockers.add("SAMPLE_CARD_COUNT_MISMATCH");
  if (replayPassCount < baselinePassCount) aggregateBlockers.add("PASS_COUNT_REGRESSION");
  if (baselineAverage !== null && replayAverage !== null && replayAverage + 1e-9 < baselineAverage) {
    aggregateBlockers.add("AVERAGE_SCORE_REGRESSION");
  }
  if (gateMode === "launch" && (replayAverage === null || replayAverage + 1e-9 < passThreshold)) {
    aggregateBlockers.add("AVERAGE_BELOW_LAUNCH_THRESHOLD");
  }
  for (const requestedId of requiredPassCaseIds) {
    const matched = rows.find((row) => idMatches(row, requestedId));
    if (!matched) aggregateBlockers.add(`REQUIRED_CASE_NOT_FOUND:${requestedId}`);
    else if (!matched.replay_pass) aggregateBlockers.add(`REQUIRED_CASE_NOT_REPAIRED:${requestedId}`);
  }

  return {
    schema_version: "strategy-trace-replay-gate-v2",
    generated_at: new Date().toISOString(),
    gate_mode: gateMode,
    promotion_eligible: aggregateBlockers.size === 0,
    regression_safe: ![...aggregateBlockers].some((blocker) => [
      "BASELINE_PASS_REGRESSION",
      "PASS_COUNT_REGRESSION",
      "AVERAGE_SCORE_REGRESSION"
    ].includes(blocker)),
    token_launch_gate_pass: gateMode === "launch" ? aggregateBlockers.size === 0 : null,
    sample: {
      card_count: rows.length,
      expected_card_count: packet.card_count,
      scope: packet.scope || "all",
      fingerprint_sha256: packet.sample_fingerprint_sha256
    },
    label_isolation: packet.label_isolation,
    threshold: passThreshold,
    required_pass_case_ids: requiredPassCaseIds,
    baseline: {
      policy_fair_average: baselineAverage,
      pass_count: baselinePassCount
    },
    replay: {
      policy_fair_average: replayAverage,
      pass_count: replayPassCount,
      improved_count: rows.filter((row) => Number(row.delta) > 0).length,
      regressed_count: rows.filter((row) => Number(row.delta) < 0).length,
      unrecorded_external_effect_count: rows.reduce((sum, row) => sum + row.unrecorded_external_effect_count, 0)
    },
    blockers: [...aggregateBlockers].sort(),
    rows
  };
}
