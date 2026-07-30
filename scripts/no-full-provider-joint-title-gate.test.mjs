import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateNoFullProviderJointTitleGate,
  noFullProviderJointTitleGate,
  noFullProviderJointTitleGateContractVersion,
  scoreNoFullProviderJointTitleCard
} from "../lib/listing/evaluation/no-full-provider-joint-title-gate.mjs";

function passingCard(id, split = "development", overrides = {}) {
  return {
    item_id: id,
    split,
    job_status: "L2_READY",
    identity_resolution_status: "CONFIRMED",
    final_title: "2025 Panini Phoenix Jaxson Dart Rookie Card #24",
    policy_fair_token_recall: 0.9,
    title_critical_guard: {
      complete: true,
      catastrophic: false,
      critical_fabrication: false
    },
    writer_visible_ms: 2500,
    timed_out: false,
    full_provider_calls: 0,
    google_vision_annotate_requests: 1,
    benchmark_controls: {
      disable_identity_result_cache_read: true,
      disable_identity_result_cache_write: true,
      disable_approved_identity_memory: true,
      disable_writer_final_replay: true,
      disable_identity_inflight_replay: true
    },
    identity_cache_hit: false,
    approved_identity_memory_hit: false,
    writer_final_replay_hit: false,
    identity_inflight_replay_hit: false,
    ...overrides
  };
}

function exactFrozenCohort({
  developmentSuccesses = 173,
  validationSuccesses = 37,
  recall = 0.9
} = {}) {
  const rows = [];
  for (let index = 0; index < 173; index += 1) {
    rows.push(passingCard(`dev-${index}`, "development", {
      policy_fair_token_recall: recall,
      title_critical_guard: {
        complete: true,
        catastrophic: index >= developmentSuccesses,
        critical_fabrication: false
      }
    }));
  }
  for (let index = 0; index < 37; index += 1) {
    rows.push(passingCard(`val-${index}`, "validation", {
      policy_fair_token_recall: recall,
      title_critical_guard: {
        complete: true,
        catastrophic: index >= validationSuccesses,
        critical_fabrication: false
      }
    }));
  }
  return rows;
}

test("contract freezes the direct joint thresholds and exact public split denominators", () => {
  assert.equal(noFullProviderJointTitleGateContractVersion, "no-full-provider-joint-title-gate-v1");
  assert.equal(noFullProviderJointTitleGate.maximum_title_characters, 80);
  assert.equal(noFullProviderJointTitleGate.minimum_card_policy_fair_token_recall, 0.72);
  assert.equal(noFullProviderJointTitleGate.minimum_split_policy_fair_token_recall_average, 0.85);
  assert.equal(noFullProviderJointTitleGate.maximum_writer_visible_ms, 3000);
  assert.deepEqual(noFullProviderJointTitleGate.splits, {
    development: { expected_denominator: 173, required_joint_success_count: 148 },
    validation: { expected_denominator: 37, required_joint_success_count: 32 }
  });
});

test("a boundary-valid cold no-full-provider title is a joint success", () => {
  const row = scoreNoFullProviderJointTitleCard(passingCard("boundary", "development", {
    final_title: "界".repeat(80),
    policy_fair_token_recall: 0.72,
    writer_visible_ms: 3000
  }));
  assert.equal(row.title_character_count, 80);
  assert.equal(row.title_correct, true);
  assert.equal(row.writer_deadline_met, true);
  assert.equal(row.execution_compliant, true);
  assert.equal(row.joint_success, true);
  assert.deepEqual(row.failure_reasons, []);
});

test("missing, overlong, low-recall, catastrophic, fabricated and abstained titles fail closed", () => {
  const cases = [
    ["missing-title", { final_title: "" }, "FINAL_TITLE_MISSING"],
    ["non-string-title", { final_title: ["not", "a", "title"] }, "FINAL_TITLE_NOT_A_STRING"],
    ["overlong", { final_title: "x".repeat(81) }, "FINAL_TITLE_OVER_80_CHARACTERS"],
    ["missing-recall", { policy_fair_token_recall: null }, "POLICY_FAIR_TOKEN_RECALL_MISSING_OR_INVALID"],
    ["low-recall", { policy_fair_token_recall: 0.719 }, "POLICY_FAIR_TOKEN_RECALL_BELOW_0_72"],
    ["catastrophic", {
      title_critical_guard: { complete: true, catastrophic: true, critical_fabrication: false }
    }, "TITLE_CRITICAL_CATASTROPHE_PRESENT_OR_UNKNOWN"],
    ["fabricated", {
      title_critical_guard: { complete: true, catastrophic: false, critical_fabrication: true }
    }, "TITLE_CRITICAL_FABRICATION_PRESENT_OR_UNKNOWN"],
    ["guard-missing", { title_critical_guard: null }, "TITLE_CRITICAL_GUARD_MISSING"],
    ["abstain", { identity_resolution_status: "ABSTAIN" }, "ABSTAIN"]
  ];
  for (const [id, overrides, reason] of cases) {
    const row = scoreNoFullProviderJointTitleCard(passingCard(id, "development", overrides));
    assert.equal(row.joint_success, false, id);
    assert.ok(row.failure_reasons.includes(reason), `${id}:${row.failure_reasons.join(",")}`);
  }
});

test("missing, late and timed-out writer visibility all remain failed rows", () => {
  const missing = scoreNoFullProviderJointTitleCard(passingCard("missing", "development", {
    writer_visible_ms: null
  }));
  const late = scoreNoFullProviderJointTitleCard(passingCard("late", "development", {
    writer_visible_ms: 3000.01
  }));
  const timedOut = scoreNoFullProviderJointTitleCard(passingCard("timeout", "development", {
    timed_out: true
  }));
  assert.equal(missing.joint_success, false);
  assert.equal(missing.writer_visible_ms, null);
  assert.ok(missing.failure_reasons.includes("WRITER_VISIBLE_TIMING_MISSING_OR_INVALID"));
  assert.equal(late.joint_success, false);
  assert.ok(late.failure_reasons.includes("WRITER_VISIBLE_DEADLINE_EXCEEDED"));
  assert.equal(timedOut.joint_success, false);
  assert.ok(timedOut.failure_reasons.includes("RECOGNITION_TIMED_OUT"));
});

test("provider, OCR and cache-memory execution controls cannot be bypassed", () => {
  const fullProvider = scoreNoFullProviderJointTitleCard(passingCard("provider", "development", {
    full_provider_calls: 1
  }));
  const missingProviderCount = scoreNoFullProviderJointTitleCard(passingCard("provider-missing", "development", {
    full_provider_calls: null
  }));
  const booleanProviderCount = scoreNoFullProviderJointTitleCard(passingCard("provider-boolean", "development", {
    full_provider_calls: false
  }));
  const wrongAnnotateCount = scoreNoFullProviderJointTitleCard(passingCard("annotate", "development", {
    google_vision_annotate_requests: 0
  }));
  const cacheEnabled = scoreNoFullProviderJointTitleCard(passingCard("cache", "development", {
    benchmark_controls: {
      ...passingCard("seed").benchmark_controls,
      disable_identity_result_cache_read: false
    }
  }));
  const memoryHitUnknown = scoreNoFullProviderJointTitleCard(passingCard("memory", "development", {
    approved_identity_memory_hit: undefined
  }));
  assert.equal(fullProvider.joint_success, false);
  assert.ok(fullProvider.failure_reasons.includes("FULL_PROVIDER_CALL_FORBIDDEN"));
  assert.equal(missingProviderCount.joint_success, false);
  assert.ok(missingProviderCount.failure_reasons.includes("FULL_PROVIDER_CALL_COUNT_MISSING"));
  assert.equal(booleanProviderCount.joint_success, false);
  assert.ok(booleanProviderCount.failure_reasons.includes("FULL_PROVIDER_CALL_COUNT_MISSING"));
  assert.equal(wrongAnnotateCount.joint_success, false);
  assert.ok(wrongAnnotateCount.failure_reasons.includes("GOOGLE_ANNOTATE_COUNT_EXPECTED_1"));
  assert.equal(cacheEnabled.joint_success, false);
  assert.ok(cacheEnabled.failure_reasons.includes(
    "BENCHMARK_CONTROL_NOT_DISABLED:disable_identity_result_cache_read"
  ));
  assert.equal(memoryHitUnknown.joint_success, false);
  assert.ok(memoryHitUnknown.failure_reasons.includes(
    "CACHE_OR_MEMORY_HIT_NOT_FALSE:approved_identity_memory_hit"
  ));
});

test("the exact 148/173 and 32/37 joint-success boundary passes when mean recall is at least 0.85", () => {
  const report = evaluateNoFullProviderJointTitleGate(exactFrozenCohort({
    developmentSuccesses: 148,
    validationSuccesses: 32,
    recall: 0.85
  }));
  assert.equal(report.status, "GO");
  assert.equal(report.denominator, 210);
  assert.equal(report.joint_success_count, 180);
  assert.equal(report.splits.development.joint_success_count, 148);
  assert.equal(report.splits.development.joint_success_count_pass, true);
  assert.equal(report.splits.validation.joint_success_count, 32);
  assert.equal(report.splits.validation.joint_success_count_pass, true);
  assert.equal(report.splits.development.policy_fair_token_recall_average_pass, true);
  assert.equal(report.splits.validation.policy_fair_token_recall_average_pass, true);
  assert.deepEqual(report.blockers, []);
});

test("one fewer development joint success fails even when validation and mean recall pass", () => {
  const report = evaluateNoFullProviderJointTitleGate(exactFrozenCohort({
    developmentSuccesses: 147,
    validationSuccesses: 32,
    recall: 0.9
  }));
  assert.equal(report.status, "NO_GO");
  assert.equal(report.splits.development.joint_success_count_pass, false);
  assert.ok(report.blockers.includes("DEVELOPMENT_JOINT_SUCCESS_BELOW_REQUIRED_COUNT"));
});

test("the split recall average is a separate gate and missing recall contributes zero", () => {
  const cohort = exactFrozenCohort();
  for (const row of cohort) row.policy_fair_token_recall = 0.72;
  cohort[0].policy_fair_token_recall = null;
  const report = evaluateNoFullProviderJointTitleGate(cohort);
  assert.equal(report.status, "NO_GO");
  assert.equal(report.splits.development.policy_fair_token_recall_average_pass, false);
  assert.ok(report.splits.development.policy_fair_token_recall_average < 0.72);
  assert.ok(report.blockers.includes(
    "DEVELOPMENT_POLICY_FAIR_TOKEN_RECALL_AVERAGE_BELOW_0_85"
  ));
});

test("a cardinality mismatch cannot pass on a smaller favorable sample", () => {
  const report = evaluateNoFullProviderJointTitleGate(exactFrozenCohort().slice(0, -1));
  assert.equal(report.status, "NO_GO");
  assert.equal(report.splits.validation.denominator, 36);
  assert.equal(report.splits.validation.cardinality_pass, false);
  assert.ok(report.blockers.includes("VALIDATION_CARDINALITY_MISMATCH"));
});

test("holdout, unknown splits and duplicate rows are rejected rather than excluded", () => {
  assert.throws(
    () => evaluateNoFullProviderJointTitleGate([passingCard("sealed", "holdout")]),
    /HOLDOUT_FORBIDDEN/
  );
  assert.throws(
    () => evaluateNoFullProviderJointTitleGate([passingCard("bad", "test")]),
    /INVALID_SPLIT:test/
  );
  assert.throws(
    () => evaluateNoFullProviderJointTitleGate([
      passingCard("duplicate", "development"),
      passingCard("duplicate", "validation")
    ]),
    /DUPLICATE_ITEM_ID:duplicate/
  );
});
