#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildStrategyReplayPacket,
  evaluateStrategyTraceReplay,
  replayCurrentProductionStrategy,
  strategyReplayOutcomeModes
} from "../lib/listing/v4/policy/strategy-trace-replay.mjs";
import {
  planProviderTerminalPath,
  providerTerminalPathActions
} from "../lib/listing/v4/policy/provider-terminal-path-policy.mjs";

const invariantSnapshot = {
  schema_version: "v4-hard-invariant-snapshot-v1",
  complete: true,
  feasible: true,
  failed_invariants: [],
  unknown_invariants: [],
  checks: []
};

function result({
  assetId,
  finalTitle,
  referenceTitle,
  postObservationPromptCandidateCount = 0
}) {
  return {
    asset_id: assetId,
    sealed_label_key: `sealed:${assetId}`,
    final_title: finalTitle,
    reference_title: referenceTitle,
    resolved_fields: {},
    field_states: {},
    route: "COLD_START_SAFE_DRAFT",
    title_stage: "V4_QUEUE_L2",
    v4_pipeline_contract: {
      strategy_profile: { profile_id: "v4-production-strategy" },
      shadow_recognition_policy: {
        state: { invariants: invariantSnapshot }
      }
    },
    l2_candidate_debug: {
      selected_candidate_id: postObservationPromptCandidateCount ? "catalog:test" : "",
      applied_field_count: 0,
      applied_fields: [],
      blocked_fields: [],
      candidate_observation_snapshot: { year: "2025" },
      candidate_application_trace: [],
      catalog_activation_funnel: {
        query_attempted: true,
        pre_observation_query_attempted: true,
        post_observation_query_attempted: true,
        provider_prompt_candidate_count: 0,
        prompt_candidate_count: postObservationPromptCandidateCount
      },
      vector_activation_funnel: {
        query_attempted: true,
        pre_observation_query_attempted: false,
        post_observation_query_attempted: true,
        provider_prompt_candidate_count: 0,
        prompt_candidate_count: 0
      }
    }
  };
}

const report = {
  results: [
    result({
      assetId: "asset-pass",
      finalTitle: "2025 Topps Chrome Flavio Cobolli Gold Auto RC #/50",
      referenceTitle: "2025 Topps Chrome Flavio Cobolli Gold Auto RC #/50",
      postObservationPromptCandidateCount: 3
    }),
    result({
      assetId: "asset-issue",
      finalTitle: "2024 Bowman Chrome Baseball Card",
      referenceTitle: "2024 Bowman Chrome Paul Skenes 1st Bowman Auto"
    })
  ]
};

assert.equal(planProviderTerminalPath({
  assistShadowOnly: true,
  forceRetrievalApplicationResolution: false
}).action, providerTerminalPathActions.RETURN_ASSIST_SHADOW);
assert.equal(planProviderTerminalPath({
  assistShadowOnly: true,
  forceRetrievalApplicationResolution: true
}).action, providerTerminalPathActions.CONTINUE_RESOLUTION);
assert.equal(planProviderTerminalPath({
  assistShadowOnly: false,
  forceRetrievalApplicationResolution: false
}).action, providerTerminalPathActions.CONTINUE_RESOLUTION);

const packet = buildStrategyReplayPacket(report, { source: "synthetic" });
assert.equal(packet.card_count, 2);
assert.equal(packet.label_isolation.strategy_receives_decision_input_only, true);
assert.equal(packet.cases[0].decision_input.provider_terminal.initial_prompt_candidate_count, 0);
assert.equal(packet.cases[0].decision_input.provider_terminal.post_observation_prompt_candidate_count, 3);
assert.equal(packet.cases[0].decision_input.provider_terminal.assist_shadow_only, true);

let labelLeakObserved = false;
const currentGate = await evaluateStrategyTraceReplay({
  packet,
  replayStrategyDecision(input) {
    labelLeakObserved ||= Object.hasOwn(input, "sealed_evaluation")
      || Object.hasOwn(input, "reference_title");
    return replayCurrentProductionStrategy(input);
  }
});
assert.equal(labelLeakObserved, false, "strategy must not receive sealed evaluation labels");
assert.equal(currentGate.promotion_eligible, true);
assert.equal(currentGate.replay.unrecorded_external_effect_count, 0);
assert.equal(currentGate.replay.regressed_count, 0);
assert.equal(currentGate.gate_mode, "regression");
assert.equal(currentGate.token_launch_gate_pass, null);

const belowLaunchGate = await evaluateStrategyTraceReplay({
  packet,
  replayStrategyDecision: replayCurrentProductionStrategy,
  passThreshold: 0.87,
  gateMode: "launch"
});
assert.equal(belowLaunchGate.promotion_eligible, false);
assert.equal(belowLaunchGate.regression_safe, true);
assert.equal(belowLaunchGate.token_launch_gate_pass, false);
assert.ok(belowLaunchGate.blockers.includes("AVERAGE_BELOW_LAUNCH_THRESHOLD"));

const mixedReport = structuredClone(report);
mixedReport.results[0].reference_title_is_reviewed_ground_truth = true;
mixedReport.results[0].reference_title_type = "REVIEWED_INTERNAL_TITLE";
mixedReport.results[1].reference_title_is_reviewed_ground_truth = false;
mixedReport.results[1].reference_title_type = "MARKETPLACE_WEAK_LABEL";
const reviewedOnlyPacket = buildStrategyReplayPacket(mixedReport, { scope: "internal-reviewed" });
assert.equal(reviewedOnlyPacket.card_count, 1);
assert.equal(reviewedOnlyPacket.scope, "internal-reviewed");

const previousBugGate = await evaluateStrategyTraceReplay({
  packet,
  replayStrategyDecision(input) {
    const postCandidateOpenedGenericCompletion = input.provider_terminal.assist_shadow_only
      && input.provider_terminal.post_observation_prompt_candidate_count > 0;
    return {
      strategy_id: "post-observation-candidate-opens-generic-completion",
      terminal_control_decision: {
        action: postCandidateOpenedGenericCompletion
          ? providerTerminalPathActions.CONTINUE_RESOLUTION
          : providerTerminalPathActions.RETURN_ASSIST_SHADOW
      },
      outcome: { mode: strategyReplayOutcomeModes.REUSE_BASELINE_OUTPUT },
      effects: postCandidateOpenedGenericCompletion
        ? [{ kind: "EXTERNAL_CALL", effect_id: "generic-evidence-completion", recorded_outcome: null }]
        : []
    };
  }
});
assert.equal(previousBugGate.promotion_eligible, false);
assert.ok(previousBugGate.blockers.includes("UNRECORDED_EXTERNAL_EFFECT"));
assert.equal(previousBugGate.replay.unrecorded_external_effect_count, 1);

const regressionGate = await evaluateStrategyTraceReplay({
  packet,
  replayStrategyDecision(input) {
    return {
      strategy_id: "deterministic-regression",
      outcome: {
        mode: strategyReplayOutcomeModes.DETERMINISTIC_OUTPUT,
        final_title: input.asset_id === "asset-pass"
          ? "2025 Topps Auto Card Gold #/50 RC"
          : input.baseline_output.final_title
      },
      effects: []
    };
  }
});
assert.equal(regressionGate.promotion_eligible, false);
assert.ok(regressionGate.blockers.includes("BASELINE_PASS_REGRESSION"));
assert.ok(regressionGate.blockers.includes("PASS_COUNT_REGRESSION"));

const repairedGate = await evaluateStrategyTraceReplay({
  packet,
  requiredPassCaseIds: ["asset-issue"],
  replayStrategyDecision(input) {
    return {
      strategy_id: "deterministic-issue-repair",
      outcome: {
        mode: strategyReplayOutcomeModes.DETERMINISTIC_OUTPUT,
        final_title: input.asset_id === "asset-issue"
          ? "2024 Bowman Chrome Paul Skenes 1st Bowman Auto"
          : input.baseline_output.final_title
      },
      effects: []
    };
  }
});
assert.equal(repairedGate.promotion_eligible, true);
assert.equal(repairedGate.replay.improved_count, 1);
assert.equal(repairedGate.replay.pass_count, 2);

const unrepairedGate = await evaluateStrategyTraceReplay({
  packet,
  requiredPassCaseIds: ["asset-issue"],
  replayStrategyDecision: replayCurrentProductionStrategy
});
assert.equal(unrepairedGate.promotion_eligible, false);
assert.ok(unrepairedGate.blockers.includes("REQUIRED_CASE_NOT_REPAIRED:asset-issue"));

const counterfactualReport = structuredClone(report);
counterfactualReport.results[0].final_title = "2025 Topps Auto Card Gold #/50 RC";
counterfactualReport.results[0].strategy_replay_trace = {
  schema_version: "provider-terminal-strategy-replay-trace-v1",
  policy_decision: { action: providerTerminalPathActions.CONTINUE_RESOLUTION },
  observed_terminal_path: "evidence_completion",
  deterministic_counterfactuals: {
    [providerTerminalPathActions.RETURN_ASSIST_SHADOW]: {
      final_title: "2025 Topps Chrome Flavio Cobolli Gold Auto RC #/50",
      resolved_fields: {}
    }
  }
};
const counterfactualPacket = buildStrategyReplayPacket(counterfactualReport);
const counterfactualGate = await evaluateStrategyTraceReplay({
  packet: counterfactualPacket,
  requiredPassCaseIds: ["asset-pass"],
  replayStrategyDecision: replayCurrentProductionStrategy
});
assert.equal(counterfactualGate.promotion_eligible, true);
assert.equal(counterfactualGate.replay.improved_count, 1);
assert.equal(counterfactualGate.rows[0].replay_title, "2025 Topps Chrome Flavio Cobolli Gold Auto RC #/50");
assert.equal(counterfactualGate.rows[0].unrecorded_external_effect_count, 0);

console.log("strategy trace replay tests passed");
