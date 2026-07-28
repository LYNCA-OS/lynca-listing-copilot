import assert from "node:assert/strict";
import { verifyExactReplayBenchmarkReports } from "./verify-exact-replay-benchmark-pair.mjs";

function row({ replay = false } = {}) {
  return {
    asset_id: "asset-1",
    final_title: "2025 Topps Chrome Cooper Flagg #1",
    resolved: { year: "2025", players: ["Cooper Flagg"], card_number: "1" },
    field_states: [{ field: "year", status: "RESOLVED" }],
    identity_resolution_status: "CONFIRMED",
    ambiguity_status: "CONFIRMED",
    provider_calls: replay ? 0 : 1,
    provider_call_skipped: replay,
    identity_cache_hit: replay,
    cached_result_version_match: replay ? true : null,
    identity_cache_write_saved: replay ? false : true,
    identity_cache_key: "a".repeat(64),
    identity_cache_image_generation_hash: "b".repeat(64),
    identity_cache_version_fingerprint: "c".repeat(64),
    resolver_replay_snapshot: {
      snapshot_version: "identity-cache-resolver-snapshot-v1",
      identity_resolution_status: "CONFIRMED",
      ambiguity_status: "CONFIRMED",
      identity_resolution: null,
      resolved: { year: "2025", players: ["Cooper Flagg"], card_number: "1" },
      field_states: [{ field: "year", status: "RESOLVED" }],
      unresolved: null,
      conflict_map: null,
      confidence_report: null,
      assisted_draft_status: null,
      writer_review_required: null,
      writer_review_reason: null
    }
  };
}

function report(phase, rows) {
  return {
    summary: {
      recognition_benchmark_profile: "exact_replay_benchmark",
      recognition_benchmark_phase: phase
    },
    results: rows
  };
}

assert.deepEqual(
  verifyExactReplayBenchmarkReports(report("cold", [row()]), report("replay", [row({ replay: true })])),
  { ok: true, profile: "exact_replay_benchmark", pair_count: 1 }
);

assert.throws(
  () => verifyExactReplayBenchmarkReports(
    report("cold", [row()]),
    report("replay", [{ ...row({ replay: true }), identity_cache_key: "d".repeat(64) }])
  ),
  /pair_missing/
);

assert.throws(
  () => verifyExactReplayBenchmarkReports(
    report("cold", [row()]),
    report("replay", [{ ...row({ replay: true }), provider_calls: null }])
  ),
  /expected_0_received_null/
);

console.log("exact replay report pair tests passed");
