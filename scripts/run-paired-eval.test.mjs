import assert from "node:assert/strict";

import { buildSmokeArgs, scoreFromReportData } from "./run-paired-eval.mjs";

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

const commonArgs = {
  baseUrl: "https://listing.lyncafei.team",
  dataset: "data.json",
  sealedLabels: "labels.jsonl",
  outPath: "out.json",
  model: "gpt-5-mini",
  limit: 20,
  l2WaitMs: 18000
};
assert.equal(buildSmokeArgs(commonArgs).includes("--read-only-provider-contract"), false);
assert.equal(buildSmokeArgs({
  ...commonArgs,
  readOnlyProviderContract: true
}).includes("--read-only-provider-contract"), true);
assert.equal(buildSmokeArgs(commonArgs).includes("--disable-identity-cache"), false);
assert.ok(buildSmokeArgs(commonArgs).includes("cold_algorithm_benchmark"));
assert.equal(buildSmokeArgs({
  ...commonArgs,
  worldKnowledgeProposals: true
}).includes("--world-knowledge-proposals"), true);

assert.throws(
  () => scoreFromReportData({ results: [row({ provider_calls: 0, provider_call_skipped: true })] }, { expectedCount: 1 }),
  /not complete cold results/
);

assert.throws(
  () => scoreFromReportData({ results: [] }, { expectedCount: 1 }),
  /expected 1 rows, received 0/
);

console.log("paired eval round validity tests passed");
