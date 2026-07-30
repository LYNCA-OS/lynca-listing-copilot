import assert from "node:assert/strict";

import { secondLookPlanInputHash } from "../lib/listing/catalog/second-look-planner.mjs";
import {
  evaluationDecisionTraceSchemaVersion,
  evaluationReplaySnapshotSchemaVersion
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import { assertSecondLookOfflineReplayGate } from "../lib/listing/evaluation/second-look-offline-replay-gate.mjs";
import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";

const sha = "a".repeat(40);
const plan = {
  input_hash: "",
  replay_input: {
    grammar: "TCG",
    code_field_states: { tcg_card_number: "UNKNOWN" },
    image_manifest: [{
      identity_sha256: "b".repeat(64),
      identity_source: "CONTENT_SHA256",
      role: "card_code_crop"
    }],
    identity_critical_reason: null
  }
};
plan.input_hash = secondLookPlanInputHash(plan);

const tracePacket = {
  schema_version: evaluationDecisionTraceSchemaVersion,
  deployment_git_sha: sha,
  benchmark_profile: recognitionBenchmarkProfileIds.COLD_SECOND_LOOK_SHADOW,
  replay_snapshot: {
    schema_version: evaluationReplaySnapshotSchemaVersion,
    status: "COMPLETE",
    missing_components: [],
    versions: { recognition_pipeline_fingerprint: "c".repeat(64) }
  }
};
const baseline = {
  final_title: "One Piece Monkey D. Luffy",
  resolved: { category: "TCG", players: ["Monkey D. Luffy"] },
  identity_resolution_status: "ABSTAIN",
  publication_gate: { status: "REVIEW" }
};
const evidenceDocument = {
  evidence: {
    tcg_card_number: {
      value: "OP01-120",
      status: "REVIEW",
      sources: [{ source_type: "VISION_MODEL", direct_observation: false }]
    }
  },
  resolved: { tcg_card_number: "OP01-120" },
  unresolved: []
};
const shadowEvaluation = {
  plan,
  baseline_unchanged: true,
  baseline_title: baseline.final_title,
  retry_attempted: false,
  full_provider_fallback_attempted: false,
  production_effect: "NONE",
  title_effect: "NONE",
  resolver_effect: "PROPOSAL_ONLY",
  candidate_authority: "RESOLVER_ONLY",
  natural_language_model_response_persisted: false,
  paid_provider_calls: 1,
  provider_call_ledger: [{
    logical_stage: "TARGETED_SECOND_LOOK_CARD_CODE",
    attempt: 1,
    started_at: "2026-07-30T00:00:00.000Z",
    completed_at: "2026-07-30T00:00:01.000Z",
    latency_ms: 1_000,
    timeout_ms: 3_500,
    provider_calls: 1,
    status: "COMPLETED",
    fallback: false,
    call_attempted: true,
    accounting_complete: true
  }],
  evidence_document: evidenceDocument,
  candidate_snapshot: { final_title: "One Piece Monkey D. Luffy OP01-120" }
};

const passed = assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation,
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
});
assert.equal(passed.pass, true);
assert.equal(passed.runtime_provider_calls, 0);
assert.equal(passed.baseline_title_byte_identical, true);

assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: { ...baseline, final_title: "mutated" },
  shadowEvaluation,
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
}), /baseline_title_mismatch/);

assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation,
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 1
}), /paid_call_forbidden/);

const leakedPlan = structuredClone(plan);
leakedPlan.replay_input.golden_title = "forbidden";
leakedPlan.input_hash = secondLookPlanInputHash(leakedPlan);
assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation: { ...shadowEvaluation, plan: leakedPlan },
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
}), /truth_leak/);

assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation: { ...shadowEvaluation, provider_call_ledger: [] },
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
}), /call_ledger_expected_one_row/);

assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation: {
    ...shadowEvaluation,
    provider_call_ledger: [{
      ...shadowEvaluation.provider_call_ledger[0],
      accounting_complete: false
    }]
  },
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
}), /call_ledger_incomplete/);

const unprovenIdentityPlan = structuredClone(plan);
delete unprovenIdentityPlan.replay_input.image_manifest[0].identity_source;
unprovenIdentityPlan.input_hash = secondLookPlanInputHash(unprovenIdentityPlan);
assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation: { ...shadowEvaluation, plan: unprovenIdentityPlan },
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
}), /immutable_image_manifest_required/);

assert.throws(() => assertSecondLookOfflineReplayGate({
  tracePacket,
  baselineResult: baseline,
  replayedBaselineResult: structuredClone(baseline),
  shadowEvaluation: {
    ...shadowEvaluation,
    evidence_document: {
      ...evidenceDocument,
      evidence: {
        ...evidenceDocument.evidence,
        tcg_card_number: {
          ...evidenceDocument.evidence.tcg_card_number,
          raw_text: "model prose must not persist"
        }
      }
    }
  },
  expectedDeploymentGitSha: sha,
  runtimeProviderCalls: 0
}), /model_natural_language_persistence_forbidden/);

console.log("second look offline replay gate tests passed");
