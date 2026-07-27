import assert from "node:assert/strict";

import {
  assertComparableExecutionControls,
  preflightArm,
  scoreFromReportData,
  smokeArgsForArm
} from "./run-paired-eval.mjs";
import { enforceEvaluationPreparationFailure } from "./v4-ebay-smoke.mjs";

function row(overrides = {}) {
  return {
    asset_id: "asset-1",
    job_id: "job-1",
    ok: true,
    l2_ready: true,
    writer_ready: true,
    error: null,
    identity_cache_hit: false,
    provider_call_skipped: false,
    provider_calls: 1,
    final_scoring: { policy_fair_token_recall: 0.8 },
    ...overrides
  };
}

assert.equal(scoreFromReportData({ results: [row()] }, { expectedCount: 1 }), 0.8);

assert.throws(
  () => scoreFromReportData({ results: [row({
    ok: false,
    l2_ready: false,
    writer_ready: false,
    error: "batch_poll_timeout"
  })] }, { expectedCount: 1 }),
  /not complete cold results/
);
assert.equal(enforceEvaluationPreparationFailure({ error: null }, true).error, null);
assert.throws(
  () => enforceEvaluationPreparationFailure({ error: "queue_enqueue_failed:503" }, true),
  /evaluation_preparation_failed/
);
assert.equal(
  enforceEvaluationPreparationFailure({ error: "queue_enqueue_failed:503" }, false).error,
  "queue_enqueue_failed:503"
);

assert.deepEqual(smokeArgsForArm([], "baseline"), []);
assert.deepEqual(smokeArgsForArm([
  "--baseline-catalog-assist", "false",
  "--baseline-catalog-cache", "omit",
  "--candidate-vector-retrieval-mode", "shadow"
], "baseline"), [
  "--catalog-assist", "false",
  "--catalog-cache", "omit"
]);
assert.deepEqual(smokeArgsForArm([
  "--candidate-vector-retrieval", "true",
  "--candidate-vector-retrieval-mode", "shadow"
], "candidate"), [
  "--vector-retrieval", "true",
  "--vector-retrieval-mode", "shadow"
]);
assert.throws(
  () => smokeArgsForArm(["--candidate-catalog-cache", "maybe"], "candidate"),
  /must be one of/
);

assert.throws(
  () => scoreFromReportData({ results: [row({ provider_calls: 0, provider_call_skipped: true })] }, { expectedCount: 1 }),
  /not complete cold results/
);

assert.throws(
  () => scoreFromReportData({ results: [] }, { expectedCount: 1 }),
  /expected 1 rows, received 0/
);

const passingPreflight = await preflightArm({
  baseUrl: "https://candidate.example",
  loginImpl: async ({ env }) => {
    assert.equal(env.VERCEL_AUTOMATION_BYPASS_SECRET, "test-bypass");
    return "listing_session=test";
  },
  env: { VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass" },
  fetchImpl: async (url) => String(url).includes("listing-provider-status")
    ? new Response(JSON.stringify({
      deployment: { deployment_id: "dpl_test" },
      execution_control: {
        distributed_provider_capacity_enabled: true,
        late_provider_lease_binding_enabled: false,
        provider_key_pool_size: 1,
        per_key_stable_concurrency: 2,
        global_provider_concurrency: 2,
        queue_submission_concurrency: 2,
        stage_capacity: { catalog: { global_capacity: 1 } }
      }
    }), { status: 200 })
    : new Response(JSON.stringify({ message: "not found" }), { status: 404 })
});
assert.equal(passingPreflight.status, 404);
assert.equal(passingPreflight.cookie, "listing_session=test");
assert.equal(passingPreflight.executionControl.late_provider_lease_binding_enabled, false);

assert.deepEqual(
  assertComparableExecutionControls(passingPreflight.executionControl, passingPreflight.executionControl),
  passingPreflight.executionControl
);
assert.throws(
  () => assertComparableExecutionControls(
    passingPreflight.executionControl,
    { ...passingPreflight.executionControl, late_provider_lease_binding_enabled: true }
  ),
  /execution controls differ; refusing paid run/
);

await assert.rejects(
  () => preflightArm({
    baseUrl: "https://candidate.example",
    loginImpl: async () => "listing_session=test",
    fetchImpl: async () => new Response(JSON.stringify({ code: "AUTH_UNAVAILABLE" }), { status: 503 })
  }),
  /paired preflight failed HTTP 503/
);

await assert.rejects(
  () => preflightArm({
    baseUrl: "https://candidate.example",
    loginImpl: async () => "listing_session=test",
    fetchImpl: async (url) => String(url).includes("listing-provider-status")
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ message: "not found" }), { status: 404 })
  }),
  /administrator-visible control snapshot/
);

console.log("paired eval round validity tests passed");
