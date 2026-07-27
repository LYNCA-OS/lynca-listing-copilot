import assert from "node:assert/strict";

import { scoreFromReportData } from "./run-paired-eval.mjs";

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

assert.throws(
  () => scoreFromReportData({ results: [row({ provider_calls: 0, provider_call_skipped: true })] }, { expectedCount: 1 }),
  /not complete cold results/
);

assert.throws(
  () => scoreFromReportData({ results: [] }, { expectedCount: 1 }),
  /expected 1 rows, received 0/
);

console.log("paired eval round validity tests passed");
