import assert from "node:assert/strict";

import { applyRecognitionBenchmarkProfile, recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import { runSecondLookEvaluationShadow } from "../lib/listing/evaluation/second-look-shadow-evaluation.mjs";

const providerOptions = applyRecognitionBenchmarkProfile({}, {
  profile: recognitionBenchmarkProfileIds.COLD_SECOND_LOOK_SHADOW
});
const images = [
  {
    id: "front-1",
    storageRole: "front_original",
    content_sha256: "a".repeat(64),
    signedUrl: "https://example.test/front.jpg"
  },
  {
    id: "back-1",
    storageRole: "back_original",
    content_sha256: "b".repeat(64),
    signedUrl: "https://example.test/back.jpg"
  },
  {
    id: "code-1",
    storageRole: "card_code_crop",
    derived: true,
    content_sha256: "c".repeat(64),
    signedUrl: "https://example.test/code.jpg"
  }
];
const stageOneResult = {
  resolved: { category: "TCG", players: ["Monkey D. Luffy"], product: "One Piece" },
  evidence: {},
  unresolved: ["tcg_card_number"]
};
const baselineResult = {
  final_title: "One Piece Monkey D. Luffy",
  resolved: stageOneResult.resolved,
  identity_resolution_status: "ABSTAIN",
  resolver_version: "resolver-test-v1",
  renderer_version: "renderer-test-v1"
};

let fetchCount = 0;
let resolverCalls = 0;
const executionOrder = [];
const evaluation = await runSecondLookEvaluationShadow({
  baselineResult,
  stageOneResult,
  images,
  providerOptions,
  traceLevel: "evaluation",
  executorContext: {
    env: { OPENAI_API_KEY: "sk-test-not-real", OPENAI_LISTING_MODEL: "gpt-5-mini" },
    fetchImpl: async (_url, init) => {
      fetchCount += 1;
      executionOrder.push("provider");
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp-second-look",
          model: "gpt-5-mini",
          status: "completed",
          output_text: JSON.stringify({
            r: "CONFIRMED",
            v: { s: [{ f: "tcg_card_number", v: "OP01-120" }], b: [], n: [], l: [] },
            e: [{ f: "tcg_card_number", s: "PRINTED_TEXT", i: "image_1", t: "OP01-120" }],
            u: []
          }),
          usage: { input_tokens: 150, output_tokens: 20, total_tokens: 170 }
        })
      };
    }
  },
  onObservationComplete: async () => {
    executionOrder.push("provider_capacity_released");
  },
  resolveCandidate: async (candidateInput) => {
    resolverCalls += 1;
    executionOrder.push("resolver");
    const field = candidateInput.evidence.tcg_card_number;
    assert.equal(field.status, "REVIEW");
    assert.equal(field.sources[0].source_type, "VISION_MODEL");
    assert.notEqual(field.sources[0].direct_observation, true);
    return {
      ...candidateInput,
      identity_resolution_status: "SUPPORTED",
      resolver_version: "resolver-test-v1",
      renderer_version: "renderer-test-v1",
      final_title: "One Piece Monkey D. Luffy OP01-120"
    };
  }
});

assert.equal(fetchCount, 1);
assert.equal(resolverCalls, 1);
assert.deepEqual(executionOrder, ["provider", "provider_capacity_released", "resolver"]);
assert.equal(evaluation.execution_status, "COMPLETED");
assert.equal(evaluation.provider_call_ledger.length, 1);
assert.equal(evaluation.provider_call_ledger[0].logical_stage, "TARGETED_SECOND_LOOK_CARD_CODE");
assert.equal(evaluation.provider_call_ledger[0].attempt, 1);
assert.equal(evaluation.provider_call_ledger[0].provider_calls, 1);
assert.equal(evaluation.provider_call_ledger[0].call_attempted, true);
assert.equal(evaluation.provider_call_ledger[0].accounting_complete, true);
assert.equal(evaluation.provider_call_ledger[0].timeout_ms, 3_500);
assert.equal(evaluation.retry_attempted, false);
assert.equal(evaluation.full_provider_fallback_attempted, false);
assert.equal(evaluation.production_effect, "NONE");
assert.equal(evaluation.title_effect, "NONE");
assert.equal(evaluation.candidate_authority, "RESOLVER_ONLY");
assert.equal(evaluation.baseline_title, baselineResult.final_title);
assert.equal(evaluation.baseline_unchanged, true);
assert.equal(baselineResult.final_title, "One Piece Monkey D. Luffy");
assert.equal(evaluation.candidate_snapshot.final_title, "One Piece Monkey D. Luffy OP01-120");
assert.equal(evaluation.natural_language_model_response_persisted, false);
assert.doesNotMatch(JSON.stringify(evaluation), /\"(?:raw_text|visible_text)\"\s*:/);

const paidSemanticFailure = await runSecondLookEvaluationShadow({
  baselineResult,
  stageOneResult,
  images,
  providerOptions,
  traceLevel: "evaluation",
  executorContext: {
    env: { OPENAI_API_KEY: "sk-test-not-real", OPENAI_LISTING_MODEL: "gpt-5-mini" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-second-look-invalid-evidence",
        model: "gpt-5-mini",
        status: "completed",
        output_text: JSON.stringify({
          r: "CONFIRMED",
          v: { s: [{ f: "tcg_card_number", v: "OP01-120" }], b: [], n: [], l: [] },
          e: [{ f: "tcg_card_number", s: "PRINTED_TEXT", i: "image_1", t: "NOT THE CODE" }],
          u: []
        }),
        usage: { input_tokens: 151, output_tokens: 21, total_tokens: 172 }
      })
    })
  }
});
assert.equal(paidSemanticFailure.execution_status, "FAILED");
assert.equal(paidSemanticFailure.paid_provider_calls, 1);
assert.equal(paidSemanticFailure.provider_call_ledger.length, 1);
assert.equal(paidSemanticFailure.provider_call_ledger[0].provider_calls, 1);
assert.equal(paidSemanticFailure.provider_call_ledger[0].call_attempted, true);
assert.equal(paidSemanticFailure.provider_call_ledger[0].accounting_complete, true);
assert.equal(paidSemanticFailure.provider_call_ledger[0].input_tokens, 151);

let localBusyProviderCalls = 0;
const localBusy = await runSecondLookEvaluationShadow({
  baselineResult,
  stageOneResult,
  images,
  providerOptions,
  traceLevel: "evaluation",
  executorContext: {
    runProviderStage: async () => {
      throw Object.assign(new Error("local capacity busy"), {
        code: "PROVIDER_LOCAL_CAPACITY_BUSY",
        retryable: false,
        provider_call_attempted: false
      });
    },
    runTargetedProvider: async () => {
      localBusyProviderCalls += 1;
      throw new Error("must not run");
    }
  }
});
assert.equal(localBusyProviderCalls, 0);
assert.equal(localBusy.execution_status, "SKIPPED");
assert.equal(localBusy.paid_provider_calls, 0);
assert.equal(localBusy.provider_call_ledger.length, 1);
assert.equal(localBusy.provider_call_ledger[0].status, "SKIPPED");
assert.equal(localBusy.provider_call_ledger[0].call_attempted, false);
assert.equal(localBusy.provider_call_ledger[0].accounting_complete, true);

let logicalNow = Date.parse("2026-07-30T00:00:00.000Z");
let deadlineProviderCalls = 0;
const deadlineBeforeTransport = await runSecondLookEvaluationShadow({
  baselineResult,
  stageOneResult,
  images,
  providerOptions,
  traceLevel: "evaluation",
  executorContext: {
    now: () => logicalNow,
    runProviderStage: async (work) => {
      logicalNow += 3_300;
      return work();
    },
    runTargetedProvider: async () => {
      deadlineProviderCalls += 1;
      throw new Error("must not run after total deadline is exhausted");
    }
  }
});
assert.equal(deadlineProviderCalls, 0);
assert.equal(deadlineBeforeTransport.execution_status, "SKIPPED");
assert.equal(deadlineBeforeTransport.reason_code, "SECOND_LOOK_TOTAL_DEADLINE_EXCEEDED");
assert.equal(deadlineBeforeTransport.provider_call_ledger[0].provider_calls, 0);
assert.equal(deadlineBeforeTransport.provider_call_ledger[0].latency_ms, 3_300);

let resolverAfterCallbackFailure = 0;
const callbackFailure = await runSecondLookEvaluationShadow({
  baselineResult,
  stageOneResult,
  images,
  providerOptions,
  traceLevel: "evaluation",
  executionOverride: {
    execution_status: "COMPLETED",
    paid_provider_calls: 1,
    provider_call_ledger: evaluation.provider_call_ledger,
    evidence_document: evaluation.evidence_document,
    observed_fields: ["tcg_card_number"],
    natural_language_model_response_persisted: false
  },
  onObservationComplete: async () => {
    throw Object.assign(new Error("capacity handoff failed"), { code: "CAPACITY_HANDOFF_FAILED" });
  },
  resolveCandidate: async () => {
    resolverAfterCallbackFailure += 1;
  }
});
assert.equal(callbackFailure.paid_provider_calls, 1);
assert.equal(callbackFailure.provider_call_ledger.length, 1);
assert.equal(callbackFailure.candidate_status, "OBSERVATION_COMPLETION_FAILED");
assert.equal(callbackFailure.observation_completion_error.code, "CAPACITY_HANDOFF_FAILED");
assert.equal(resolverAfterCallbackFailure, 0);

let disabledCalls = 0;
const disabled = await runSecondLookEvaluationShadow({
  baselineResult,
  stageOneResult,
  images,
  providerOptions: { ...providerOptions, recognition_benchmark_profile: "cold_algorithm_benchmark" },
  traceLevel: "evaluation",
  executorContext: {
    runTargetedProvider: async () => {
      disabledCalls += 1;
      throw new Error("must not run");
    }
  }
});
assert.equal(disabledCalls, 0);
assert.equal(disabled.enabled, false);
assert.equal(disabled.provider_call_ledger.length, 1);
assert.equal(disabled.provider_call_ledger[0].status, "SKIPPED");
assert.equal(disabled.provider_call_ledger[0].provider_calls, 0);

console.log("second look shadow executor tests passed");
