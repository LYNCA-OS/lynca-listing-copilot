import assert from "node:assert/strict";

import {
  coldTargetedAssistBenchmarkProfile,
  executeTargetedAssistObservationRoute,
  mergeObservationProviderUsage,
  targetedAssistCandidateEnabled
} from "../lib/listing/v4/targeted-assist/targeted-assist-route-executor.mjs";
import { providerAuxRoutes } from "../lib/listing/v4/route-planner/provider-aux-route-shadow.mjs";

const routeDecision = {
  route: providerAuxRoutes.TARGETED_MODEL_ASSIST,
  input_class: "NOVEL_IMAGE",
  trace_completeness: "COMPLETE",
  source_availability: "COMPLETE",
  provider_derived_field_count: 0,
  post_cutoff_evidence_count: 0,
  basis: "TARGETED_VISUAL_ASSIST",
  visual_field_targets: ["year", "manufacturer", "players", "card_name", "set", "card_number"],
  visual_requirement_targets: ["year", "manufacturer", "players", "card_name_or_insert_or_code"],
  publishable_known_fields: { year: "2024", manufacturer: "Panini" },
  knowledge_field_targets: [],
  image_policy: "PRIMARY_PLUS_RELEVANT_CROPS_ONLY"
};
const candidateOptions = {
  recognition_benchmark_profile: coldTargetedAssistBenchmarkProfile,
  trace_level: "evaluation",
  enable_targeted_visual_assist_candidate: true
};
const parsed = {
  recognition_status: "CONFIRMED",
  fields: { year: "2024", manufacturer: "Panini", players: ["A Player"], set: "Insert" },
  field_evidence: {},
  unresolved: []
};
const result = ({ owner, calls = 1, safe = true, outputTokens = 40 }) => ({
  provider: "openai_legacy",
  model_id: "gpt-5-mini",
  parsed,
  usage: {
    provider_calls: calls,
    latency_ms: owner === "targeted" ? 1800 : 4500,
    input_tokens: owner === "targeted" ? 700 : 9000,
    output_tokens: outputTokens,
    total_tokens: (owner === "targeted" ? 700 : 9000) + outputTokens,
    image_count: owner === "targeted" ? 4 : 8
  },
  ...(owner === "targeted"
    ? {
        prompt_version: "targeted-prompt-v1",
        schema_version: "targeted-schema-v1",
        targeted_visual_observation: {
          safety: {
            safe,
            reason: safe ? "TARGETED_OBSERVATION_SUFFICIENT" : "TARGETED_REQUESTED_FIELD_MISSING"
          }
        }
      }
    : {})
});

assert.equal(targetedAssistCandidateEnabled({
  providerOptions: candidateOptions,
  traceLevel: "evaluation",
  routeDecision
}), true);
assert.equal(targetedAssistCandidateEnabled({
  providerOptions: { ...candidateOptions, enable_targeted_visual_assist_candidate: false },
  traceLevel: "evaluation",
  routeDecision
}), false);
assert.equal(targetedAssistCandidateEnabled({
  providerOptions: candidateOptions,
  traceLevel: "evaluation",
  routeDecision: {
    ...routeDecision,
    basis: "TARGETED_VISUAL_AND_KNOWLEDGE",
    knowledge_field_targets: ["product"]
  }
}), true, "mixed routes may use visual observation while derived fields stay downstream-owned");
assert.equal(targetedAssistCandidateEnabled({
  providerOptions: candidateOptions,
  traceLevel: "evaluation",
  routeDecision: {
    ...routeDecision,
    basis: "KNOWLEDGE_ASSIST",
    visual_field_targets: [],
    knowledge_field_targets: ["product"]
  }
}), false, "knowledge-only routes must not masquerade as targeted visual success");

let targetedCalls = 0;
let fullCalls = 0;
const direct = await executeTargetedAssistObservationRoute({
  routeDecision,
  providerOptions: { recognition_benchmark_profile: "cold_algorithm_benchmark" },
  runFullProvider: async () => {
    fullCalls += 1;
    return result({ owner: "full", outputTokens: 120 });
  },
  runTargetedProvider: async () => {
    targetedCalls += 1;
    return result({ owner: "targeted" });
  }
});
assert.equal(fullCalls, 1);
assert.equal(targetedCalls, 0);
assert.equal(direct.execution.enabled, false);
assert.equal(direct.execution.final_observation_owner, "FULL_PROVIDER_OBSERVATION");
assert.deepEqual(direct.execution.provider_call_ledger.map((row) => row.logical_stage), ["FULL_PROVIDER_OBSERVATION"]);

targetedCalls = 0;
fullCalls = 0;
let observedRequiredTargets = null;
let observedKnownFields = null;
const targeted = await executeTargetedAssistObservationRoute({
  routeDecision,
  providerOptions: candidateOptions,
  traceLevel: "evaluation",
  images: [{ signed_url: "https://example.test/card.jpg" }],
  runFullProvider: async () => {
    fullCalls += 1;
    return result({ owner: "full" });
  },
  runTargetedProvider: async ({ requiredTargets, knownFields }) => {
    targetedCalls += 1;
    observedRequiredTargets = requiredTargets;
    observedKnownFields = knownFields;
    return result({ owner: "targeted", safe: true, outputTokens: 60 });
  }
});
assert.equal(targetedCalls, 1);
assert.equal(fullCalls, 0);
assert.equal(targeted.execution.final_observation_owner, "TARGETED_VISUAL_OBSERVATION");
assert.deepEqual(observedRequiredTargets, ["year", "manufacturer", "players", "card_name_or_insert_or_code"]);
assert.deepEqual(observedKnownFields, { year: "2024", manufacturer: "Panini" });
assert.equal(targeted.result.usage.provider_calls, 1);
assert.deepEqual(targeted.execution.provider_call_ledger.map((row) => row.logical_stage), ["TARGETED_VISUAL_OBSERVATION"]);

targetedCalls = 0;
fullCalls = 0;
const fallback = await executeTargetedAssistObservationRoute({
  routeDecision,
  providerOptions: candidateOptions,
  traceLevel: "evaluation",
  images: [{ signed_url: "https://example.test/card.jpg" }],
  runFullProvider: async () => {
    fullCalls += 1;
    return result({ owner: "full", outputTokens: 130 });
  },
  runTargetedProvider: async () => {
    targetedCalls += 1;
    return result({ owner: "targeted", safe: false, outputTokens: 55 });
  }
});
assert.equal(targetedCalls, 1);
assert.equal(fullCalls, 1);
assert.equal(fallback.execution.final_observation_owner, "FULL_PROVIDER_OBSERVATION");
assert.equal(fallback.execution.fallback_reason_code, "TARGETED_REQUESTED_FIELD_MISSING");
assert.equal(fallback.result.usage.provider_calls, 2);
assert.equal(fallback.result.usage.output_tokens, 185);
assert.deepEqual(fallback.execution.provider_call_ledger.map((row) => row.logical_stage), [
  "TARGETED_VISUAL_OBSERVATION",
  "FULL_PROVIDER_OBSERVATION"
]);
assert.equal(fallback.execution.provider_call_ledger[1].fallback, true);

const errorFallback = await executeTargetedAssistObservationRoute({
  routeDecision,
  providerOptions: candidateOptions,
  traceLevel: "evaluation",
  runFullProvider: async () => result({ owner: "full" }),
  runTargetedProvider: async () => {
    const error = new Error("timeout");
    error.code = "PROVIDER_TIMEOUT";
    throw error;
  }
});
assert.equal(errorFallback.result.usage.provider_calls, 2);
assert.equal(errorFallback.execution.fallback_reason_code, "PROVIDER_TIMEOUT");
assert.equal(errorFallback.execution.provider_call_ledger[0].status, "FAILED");
assert.equal(errorFallback.execution.provider_timing_authority, "PROVIDER_CALL_LEDGER");

const leaseAbort = new AbortController();
const leaseLost = Object.assign(new Error("queue lease lost"), {
  code: "QUEUE_LEASE_LOST",
  retryable: true
});
let fallbackAfterAbortCalls = 0;
let abortFailure = null;
try {
  await executeTargetedAssistObservationRoute({
    routeDecision,
    providerOptions: candidateOptions,
    traceLevel: "evaluation",
    signal: leaseAbort.signal,
    runFullProvider: async () => {
      fallbackAfterAbortCalls += 1;
      return result({ owner: "full" });
    },
    runTargetedProvider: async ({ signal }) => {
      assert.equal(signal, leaseAbort.signal, "the Queue lease signal must reach targeted Provider transport");
      leaseAbort.abort(leaseLost);
      const error = new Error("targeted transport aborted");
      error.code = "PROVIDER_TIMEOUT";
      throw error;
    }
  });
} catch (error) {
  abortFailure = error;
}
assert.equal(abortFailure, leaseLost);
assert.equal(fallbackAfterAbortCalls, 0, "a worker that lost its lease must not start full-Provider fallback");
assert.equal(abortFailure.targeted_assist_execution.fallback_reason_code, "PARENT_SIGNAL_ABORTED");
assert.deepEqual(abortFailure.provider_call_ledger.map((row) => row.logical_stage), [
  "TARGETED_VISUAL_OBSERVATION"
]);

let dualFailure = null;
try {
  await executeTargetedAssistObservationRoute({
    routeDecision,
    providerOptions: candidateOptions,
    traceLevel: "evaluation",
    runTargetedProvider: async () => {
      const error = new Error("target timeout");
      error.code = "PROVIDER_TIMEOUT";
      throw error;
    },
    runFullProvider: async () => {
      const error = new Error("fallback upstream failure");
      error.code = "upstream_error";
      throw error;
    }
  });
} catch (error) {
  dualFailure = error;
}
assert.ok(dualFailure, "dual provider failure must remain observable");
assert.deepEqual(dualFailure.provider_call_ledger.map((row) => row.logical_stage), [
  "TARGETED_VISUAL_OBSERVATION",
  "FULL_PROVIDER_OBSERVATION"
]);
assert.deepEqual(dualFailure.provider_call_ledger.map((row) => row.status), ["FAILED", "FAILED"]);
assert.equal(dualFailure.provider_usage.provider_calls, 2);
assert.equal(dualFailure.targeted_assist_execution.fallback_reason_code, "PROVIDER_TIMEOUT");
assert.equal(dualFailure.targeted_assist_execution.final_observation_owner, null);

assert.deepEqual(
  mergeObservationProviderUsage(
    { provider_calls: 1, input_tokens: 10, output_tokens: 2, total_tokens: 12, latency_ms: 5, image_count: 1 },
    { provider_calls: 1, input_tokens: 20, output_tokens: 3, total_tokens: 23, latency_ms: 7, image_count: 2 }
  ),
  {
    provider_calls: 2,
    input_tokens: 30,
    output_tokens: 5,
    total_tokens: 35,
    latency_ms: 12,
    image_count: 3,
    retrieval_calls: 0,
    estimated_cost_usd: 0,
    cost_configured: false,
    prompt_tokens: null,
    completion_tokens: null
  }
);

console.log("targeted assist route executor tests passed");
