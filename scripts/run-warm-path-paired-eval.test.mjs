import assert from "node:assert/strict";

import { validateWarmPairReports } from "./run-warm-path-paired-eval.mjs";

function row(overrides = {}) {
  return {
    ok: true,
    l2_ready: true,
    writer_ready: true,
    error: null,
    asset_id: "asset-1",
    identity_cache_image_generation_hash: "hash-1",
    identity_cache_version_fingerprint: "pipeline-v1",
    final_title: "2025 Topps Chrome Cooper Flagg RC",
    resolved_fields: { year: "2025", players: ["Cooper Flagg"] },
    field_states: { year: "RESOLVED" },
    provider_calls: 1,
    identity_cache_hit: false,
    provider_call_skipped: false,
    cached_result_version_match: null,
    writer_visible_recognition_ms: 20_000,
    time_to_writer_ready_ms: 21_000,
    final_scoring: { policy_fair_token_recall: 0.9 },
    ...overrides
  };
}

const cold = row();
const replay = row({
  provider_calls: 0,
  identity_cache_hit: true,
  provider_call_skipped: true,
  cached_result_version_match: true,
  writer_visible_recognition_ms: 100,
  time_to_writer_ready_ms: 150
});
const metrics = validateWarmPairReports({ results: [cold] }, { results: [replay] }, { expectedCount: 1 });
assert.equal(metrics.identity_cache_hit_rate, 1);
assert.equal(metrics.cold_provider_calls, 1);
assert.equal(metrics.replay_provider_calls, 0);
assert.equal(metrics.accuracy_delta, 0);
assert.equal(metrics.replay_writer_ready_p95_ms, 150);

const stableSourceMetrics = validateWarmPairReports(
  { results: [row({ identity_cache_image_generation_hash: null, source_asset_id: "reviewed-card-1", asset_id: "cold-upload" })] },
  { results: [row({ ...replay, identity_cache_image_generation_hash: null, source_asset_id: "reviewed-card-1", asset_id: "replay-upload" })] },
  { expectedCount: 1 }
);
assert.equal(stableSourceMetrics.sample_count, 1);

assert.throws(
  () => validateWarmPairReports(
    { results: [cold] },
    { results: [row({ ...replay, identity_cache_hit: false })] },
    { expectedCount: 1 }
  ),
  /identity_cache_hit_expected_true/
);
assert.throws(
  () => validateWarmPairReports(
    { results: [cold] },
    { results: [row({ ...replay, cached_result_version_match: false })] },
    { expectedCount: 1 }
  ),
  /cached_result_version_match_expected_true/
);
assert.throws(
  () => validateWarmPairReports(
    { results: [cold] },
    { results: [row({ ...replay, final_title: "different" })] },
    { expectedCount: 1 }
  ),
  /title_mismatch/
);
assert.throws(
  () => validateWarmPairReports({ results: [] }, { results: [] }, { expectedCount: 1 }),
  /warm_pair_count_mismatch/
);

console.log("warm path paired eval contract tests passed");
