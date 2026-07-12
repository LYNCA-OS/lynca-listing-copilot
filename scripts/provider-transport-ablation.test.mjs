import assert from "node:assert/strict";
import { compareProviderTransportReports } from "./compare-provider-transport-ablation.mjs";

function report({ compact = false } = {}) {
  return {
    identity_cache_disabled: true,
    summary: {
      provider_diagnostics: {
        response_profile_breakdown: { [compact ? "compact_sparse_v1" : "standard"]: 1 },
        prompt_mode_breakdown: { [compact ? "v4_compact_l2" : "standard"]: 1 }
      },
      pipeline_node_observability: { error_count: 0 }
    },
    results: [{
      asset_id: "card-1",
      ok: true,
      l2_ready: true,
      final_title: compact ? "2024 Topps Chrome Shohei Ohtani Gold" : "2024 Topps Chrome Shohei Ohtani Gold Refractor",
      resolved_fields: compact ? { year: "2024", players: ["Shohei Ohtani"], surface_color: "Gold" } : { year: "2024", players: ["Shohei Ohtani"], parallel: "Gold Refractor" },
      time_to_writer_ready_ms: compact ? 12000 : 24000,
      provider_latency_ms: compact ? 9000 : 19000,
      input_tokens: compact ? 7000 : 9000,
      output_tokens: compact ? 500 : 1200,
      total_tokens: compact ? 7500 : 10200,
      identity_cache_hit: false,
      identity_cache_read_bypassed: true,
      final_scoring: { policy_fair_token_recall: compact ? 0.8 : 0.7 }
    }]
  };
}

const comparison = compareProviderTransportReports(report(), report({ compact: true }));
assert.equal(comparison.paired_count, 1);
assert.equal(comparison.complete_pair_count, 1);
assert.equal(comparison.recovery_count, 1);
assert.equal(comparison.regression_count, 0);
assert.equal(comparison.deltas.writer_ready_p50_fraction, -0.5);
assert.equal(comparison.baseline.identity_cache_bypassed_count, 1);
assert.equal(comparison.compact.identity_cache_bypassed_count, 1);
assert.deepEqual(comparison.pairs[0].changed_fields, ["surface_color", "parallel"]);
assert.equal(comparison.pairs[0].weak_proxy_outcome, "RECOVERY");

console.log("provider transport ablation tests passed");
