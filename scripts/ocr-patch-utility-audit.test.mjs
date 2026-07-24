import assert from "node:assert/strict";
import { auditOcrPatchUtility } from "../lib/listing/evaluation/ocr-patch-utility-audit.mjs";

const row = (id, score, overrides = {}) => ({
  source_feedback_id: id,
  ok: true,
  job_status: "L2_READY",
  l2_ready: true,
  final_scoring: { policy_fair_token_recall: score },
  pre_l2_anchor_patch_count: 0,
  writer_visible_recognition_ms: 1000,
  scheduler_queue_wait_ms: 100,
  ...overrides
});

const audit = auditOcrPatchUtility({
  controlReport: {
    results: [row("a", 0.7), row("b", 0.8), row("c", 0.9)],
    summary: { completed_cards_per_minute_service_window: 6.5 }
  },
  candidateReport: {
    results: [
      row("a", 0.9, { pre_l2_anchor_patch_count: 2, writer_visible_recognition_ms: 1500 }),
      row("b", 0.7, { pre_l2_anchor_patch_count: 1, scheduler_queue_wait_ms: 500 }),
      row("c", null, { ok: false, job_status: "RUNNING", l2_ready: false })
    ],
    summary: { completed_cards_per_minute_service_window: 5.5 }
  }
});

assert.equal(audit.pair_coverage.shared_count, 3);
assert.equal(audit.patch_exposure.pair_count, 2);
assert.equal(audit.patch_exposure.improved_count, 1);
assert.equal(audit.patch_exposure.regressed_count, 1);
assert.equal(audit.paired_outcomes.technical_regression_count, 1);
assert.equal(audit.candidate_gate.speed.passed, false);
assert.equal(audit.candidate_gate.stability.passed, false);
assert.equal(audit.candidate_gate.expansion_allowed, false);
assert.equal(audit.recommendation, "DO_NOT_EXPAND");

console.log("ocr patch utility audit tests passed");
