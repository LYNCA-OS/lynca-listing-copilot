import assert from "node:assert/strict";

import { summarizeCohort } from "./summarize-world-knowledge-paired-eval.mjs";

const row = (recall, team, world = null) => ({
  ok: true,
  writer_ready: true,
  l2_ready: true,
  provider_latency_ms: 10,
  time_to_writer_ready_ms: 20,
  output_tokens: 100,
  final_scoring: { policy_fair_token_recall: recall },
  l2_status: { resolved_fields: { team, product: "Product" } },
  evaluation_decision_trace_packet: world ? { world_knowledge_shadow_assist: world } : {}
});

const summary = summarizeCohort(
  { results: [row(0.8, null)] },
  { results: [row(0.9, "Team", {
    requested: true,
    execution_status: "NOT_RUN",
    paid_provider_calls: 0
  })] }
);
assert.ok(Math.abs(summary.delta.policy_fair_token_recall - 0.1) < 1e-9);
assert.equal(summary.delta.team_present, 1);
assert.equal(summary.candidate.shadow_assist_requested, 1);
assert.equal(summary.candidate.shadow_assist_not_run, 1);
assert.equal(summary.candidate.shadow_paid_provider_calls, 0);
assert.equal(summary.candidate.provider_output_tokens_mean, 100);

console.log("world knowledge paired summary tests passed");
