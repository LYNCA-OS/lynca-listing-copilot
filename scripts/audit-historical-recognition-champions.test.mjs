#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  auditHistoricalRecognitionRuns,
  normalizeHistoricalRecognitionRun,
  renderHistoricalChampionReport
} from "./audit-historical-recognition-champions.mjs";

function report({ n = 10, ok = 10, accuracy, pass = 0, p50, p95, speculative = false, preingestion = false }) {
  return {
    generated_at: "2026-07-18T00:00:00.000Z",
    limit: n,
    speculative_mode: speculative,
    preingestion_enabled: preingestion,
    summary: {
      attempted_count: n,
      ok_count: ok,
      writer_ready_p50_ms: p50,
      writer_ready_p95_ms: p95,
      final_accuracy_proxy: {
        policy_fair_token_recall_avg: accuracy,
        policy_fair_pass_at_0_72: pass
      }
    }
  };
}

const rows = [
  normalizeHistoricalRecognitionRun({
    path: "/tmp/accuracy.json",
    report: report({ accuracy: 0.91, pass: 9, p50: 31_000, p95: 40_000, speculative: true, preingestion: true })
  }),
  normalizeHistoricalRecognitionRun({
    path: "/tmp/speed-stability.json",
    report: report({ accuracy: 0.85, pass: 8, p50: 20_000, p95: 25_000, preingestion: true })
  }),
  normalizeHistoricalRecognitionRun({
    path: "/tmp/small-high-score.json",
    report: report({ n: 3, ok: 3, accuracy: 0.99, pass: 3, p50: 1_000, p95: 1_500 })
  }),
  normalizeHistoricalRecognitionRun({
    path: "/tmp/unstable.json",
    report: report({ ok: 9, accuracy: 0.95, pass: 9, p50: 15_000, p95: 90_000 })
  })
];

const audit = auditHistoricalRecognitionRuns(rows);
assert.equal(audit.eligible_run_count, 3);
assert.equal(audit.excluded_small_run_count, 1);
assert.equal(audit.canonical_champions_are_external_user_locked_contract, true);
assert.equal(audit.proxy_leaders.accuracy.run_id, "accuracy.json");
assert.equal(audit.proxy_leaders.speed.run_id, "speed-stability.json");
assert.equal(audit.proxy_leaders.stability.run_id, "speed-stability.json");
assert.equal(audit.proxy_leaders.accuracy.commercial_accuracy_claim_eligible, false);
assert.match(renderHistoricalChampionReport(audit), /not the user-locked historical champions/);

console.log("Historical recognition champion audit tests passed");
