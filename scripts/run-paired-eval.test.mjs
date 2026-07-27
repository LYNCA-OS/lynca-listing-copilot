import assert from "node:assert/strict";

import { preflightArm, scoreFromReportData, smokeArgsForArm } from "./run-paired-eval.mjs";
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
  fetchImpl: async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 })
});
assert.equal(passingPreflight.status, 404);
assert.equal(passingPreflight.cookie, "listing_session=test");

await assert.rejects(
  () => preflightArm({
    baseUrl: "https://candidate.example",
    loginImpl: async () => "listing_session=test",
    fetchImpl: async () => new Response(JSON.stringify({ code: "AUTH_UNAVAILABLE" }), { status: 503 })
  }),
  /paired preflight failed HTTP 503/
);

console.log("paired eval round validity tests passed");
