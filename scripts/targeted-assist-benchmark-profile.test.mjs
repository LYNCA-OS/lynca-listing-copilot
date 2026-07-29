import assert from "node:assert/strict";

import {
  applyRecognitionBenchmarkProfile,
  assertColdAlgorithmBenchmarkResult,
  assertColdTargetedAssistBenchmarkResult,
  recognitionBenchmarkProfileIds
} from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";

const options = applyRecognitionBenchmarkProfile({ enable_catalog_assist: true }, {
  profile: recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST
});
assert.equal(options.disable_identity_result_cache_read, true);
assert.equal(options.disable_identity_result_cache_write, true);
assert.equal(options.disable_approved_identity_memory, true);
assert.equal(options.disable_writer_final_replay, true);
assert.equal(options.disable_identity_inflight_replay, true);
assert.equal(options.disable_recognition_worker_fast_final, true);
assert.equal(options.trace_level, "evaluation");
assert.equal(options.enable_targeted_visual_assist_candidate, true);
assert.equal(options.enable_world_knowledge_assist_candidate, false);
assert.equal(options.targeted_assist_variant, "VISUAL_ONLY");

const at = (offset) => new Date(Date.parse("2026-07-29T00:00:00.000Z") + offset).toISOString();
function row({ sequence = "targeted", calls = null } = {}) {
  const ledgers = {
    targeted: [{
      logical_stage: "TARGETED_VISUAL_OBSERVATION",
      attempt: 1,
      started_at: at(0),
      completed_at: at(1_800),
      latency_ms: 1_800,
      provider_calls: 1,
      status: "COMPLETED",
      prompt_revision: "targeted-visual-read-only-v2",
      schema_revision: "targeted-visual-sparse-v2"
    }],
    fallback: [
      {
        logical_stage: "TARGETED_VISUAL_OBSERVATION",
        attempt: 1,
        started_at: at(0),
        completed_at: at(1_800),
        latency_ms: 1_800,
        provider_calls: 1,
        status: "COMPLETED",
        prompt_revision: "targeted-visual-read-only-v2",
        schema_revision: "targeted-visual-sparse-v2"
      },
      {
        logical_stage: "FULL_PROVIDER_OBSERVATION",
        attempt: 1,
        started_at: at(1_800),
        completed_at: at(6_300),
        latency_ms: 4_500,
        provider_calls: 1,
        status: "COMPLETED"
      }
    ],
    full: [{
      logical_stage: "FULL_PROVIDER_OBSERVATION",
      attempt: 1,
      started_at: at(0),
      completed_at: at(4_500),
      latency_ms: 4_500,
      provider_calls: 1,
      status: "COMPLETED"
    }]
  };
  const ledger = ledgers[sequence];
  const finalOwner = sequence === "targeted" ? "TARGETED_VISUAL_OBSERVATION" : "FULL_PROVIDER_OBSERVATION";
  return {
    recognition_benchmark_profile: recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST,
    attempt_count: 1,
    retry_attempt_history: [],
    retry_error_codes: [],
    identity_cache: { cache_hit: false, provider_call_skipped: false },
    usage: { provider_calls: calls ?? ledger.reduce((sum, item) => sum + item.provider_calls, 0) },
    provider_call_ledger: ledger,
    targeted_assist_execution: {
      final_observation_owner: finalOwner,
      fallback_reason_code: sequence === "fallback" ? "TARGETED_REQUESTED_FIELD_MISSING" : null,
      provider_call_ledger: ledger
    }
  };
}

assert.equal(assertColdTargetedAssistBenchmarkResult(row({ sequence: "targeted" })), true);
assert.equal(assertColdTargetedAssistBenchmarkResult(row({ sequence: "fallback" })), true);
assert.equal(assertColdTargetedAssistBenchmarkResult(row({ sequence: "full" })), true);
const flatHostedRow = row({ sequence: "targeted" });
delete flatHostedRow.usage;
delete flatHostedRow.identity_cache;
flatHostedRow.provider_calls = 1;
flatHostedRow.identity_cache_hit = false;
flatHostedRow.provider_call_skipped = false;
assert.equal(
  assertColdTargetedAssistBenchmarkResult(flatHostedRow),
  true,
  "hosted smoke rows expose flat benchmark counters"
);

assert.throws(
  () => assertColdTargetedAssistBenchmarkResult(row({ sequence: "fallback", calls: 1 })),
  /call_ledger_mismatch/
);
const noFallbackReason = row({ sequence: "fallback" });
noFallbackReason.targeted_assist_execution.fallback_reason_code = null;
assert.throws(() => assertColdTargetedAssistBenchmarkResult(noFallbackReason), /fallback_reason_missing/);
const retry = row({ sequence: "targeted" });
retry.provider_call_ledger[0].attempt = 2;
assert.throws(() => assertColdTargetedAssistBenchmarkResult(retry), /retry_forbidden/);
const wholeJobRetry = row({ sequence: "targeted" });
wholeJobRetry.attempt_count = 2;
wholeJobRetry.retry_attempt_history = [{ code: "PROVIDER_TIMEOUT" }];
wholeJobRetry.retry_error_codes = ["PROVIDER_TIMEOUT"];
assert.throws(() => assertColdTargetedAssistBenchmarkResult(wholeJobRetry), /job_attempt_count_expected_1/);
const hiddenWholeJobRetry = row({ sequence: "targeted" });
hiddenWholeJobRetry.retry_attempt_history = [{ code: "QUEUE_LEASE_LOST" }];
hiddenWholeJobRetry.retry_error_codes = ["QUEUE_LEASE_LOST"];
assert.throws(() => assertColdTargetedAssistBenchmarkResult(hiddenWholeJobRetry), /whole_job_retry_forbidden/);
for (const retryFlag of [
  "provider_transient_retry_attempted",
  "provider_output_cap_downgrade_attempted",
  "provider_truncation_retry_attempted",
  "provider_key_rotation_attempted",
  "gpt5_empty_result_retry_attempted"
]) {
  const hiddenRetry = row({ sequence: "targeted" });
  hiddenRetry[retryFlag] = true;
  assert.throws(
    () => assertColdTargetedAssistBenchmarkResult(hiddenRetry),
    /implicit_provider_retry_forbidden/,
    `${retryFlag} must invalidate a one-attempt benchmark row`
  );
}

assert.throws(
  () => assertColdAlgorithmBenchmarkResult(row({ sequence: "fallback" })),
  /cold_algorithm_provider_calls_expected_1_received_2/
);

console.log("targeted assist benchmark profile tests passed");
