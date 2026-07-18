#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fullInformationReplaySchemaVersion } from "../lib/listing/v4/policy/full-information-replay.mjs";
import {
  normalizeRecognitionPolicyState,
  solveOptimalRecognitionPolicy
} from "../lib/listing/v4/policy/optimal-recognition-policy.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasPolicyState(value) {
  const source = plainObject(value);
  return Object.keys(source).length > 0 && (source.evidence || source.invariants || source.schema_version);
}

export function evaluateShadowPolicy({ replay, transitionModel }) {
  if (replay?.schema_version !== fullInformationReplaySchemaVersion) {
    throw new Error(`Expected ${fullInformationReplaySchemaVersion}`);
  }
  const decisions = [];
  const skipped = [];
  for (const card of replay.cards || []) {
    const snapshots = [
      ...(card.policy_state_snapshots || []).map((snapshot) => ({
        snapshot_id: snapshot.snapshot_id,
        observation_point: snapshot.observation_point,
        state: snapshot.state,
        observed_action: snapshot.observed_next_action || null,
        source: snapshot.source || null
      })),
      ...(card.action_observations || []).map((observation) => ({
        snapshot_id: observation.observation_id,
        observation_point: "BEFORE_ACTION",
        state: observation.state_before,
        observed_action: observation.action,
        source: "action_observation"
      }))
    ];
    for (const snapshot of snapshots) {
      if (!hasPolicyState(snapshot.state)) {
        skipped.push({
          query_card_id: card.query_card_id,
          snapshot_id: snapshot.snapshot_id,
          reason: "POLICY_STATE_BEFORE_MISSING"
        });
        continue;
      }
      const state = normalizeRecognitionPolicyState(snapshot.state);
      if (!state.invariants.complete) {
        skipped.push({
          query_card_id: card.query_card_id,
          snapshot_id: snapshot.snapshot_id,
          reason: "HARD_INVARIANT_SNAPSHOT_INCOMPLETE"
        });
        continue;
      }
      const decision = solveOptimalRecognitionPolicy({ state, transitionModel });
      decisions.push({
        query_card_id: card.query_card_id,
        snapshot_id: snapshot.snapshot_id,
        observation_point: snapshot.observation_point,
        source: snapshot.source,
        observed_action: snapshot.observed_action,
        shadow_next_action: decision.next_action,
        agrees_with_observed_action: snapshot.observed_action
          ? decision.next_action === snapshot.observed_action
          : null,
        expected_objective_loss: decision.expected_objective_loss,
        reason_trace: decision.reason_trace,
        alternatives: decision.alternatives
      });
    }
  }
  return {
    schema_version: "v4-optimal-recognition-shadow-evaluation-v1",
    generated_at: new Date().toISOString(),
    shadow_only: true,
    transition_model_id: transitionModel.model_id,
    state_snapshot_count: decisions.length,
    skipped_snapshot_count: skipped.length,
    observed_action_agreement_rate: decisions.some((row) => row.observed_action)
      ? decisions.filter((row) => row.observed_action && row.agrees_with_observed_action).length
        / decisions.filter((row) => row.observed_action).length
      : null,
    promotion_eligible: false,
    promotion_blockers: [
      ...(decisions.length ? [] : ["NO_COMPLETE_POLICY_STATE_SNAPSHOTS"]),
      ...(transitionModel.fitted_from_replay ? [] : ["TRANSITION_OUTCOMES_NOT_FITTED_FROM_REPLAY"]),
      "SHADOW_RECOVERY_REGRESSION_NOT_YET_PROVEN"
    ],
    decisions,
    skipped
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const replayPath = resolve(argValue(argv, "--replay", "data/eval/optimal-policy/full-information-replay.json"));
  const transitionPath = resolve(argValue(argv, "--transition", "data/eval/optimal-policy/transition-model.json"));
  const outputPath = resolve(argValue(argv, "--out", "data/eval/optimal-policy/shadow-policy-evaluation.json"));
  const [replay, transitionModel] = await Promise.all([
    readFile(replayPath, "utf8").then(JSON.parse),
    readFile(transitionPath, "utf8").then(JSON.parse)
  ]);
  const evaluation = evaluateShadowPolicy({ replay, transitionModel });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    state_snapshot_count: evaluation.state_snapshot_count,
    skipped_snapshot_count: evaluation.skipped_snapshot_count,
    promotion_eligible: evaluation.promotion_eligible,
    promotion_blockers: evaluation.promotion_blockers,
    output: outputPath
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
