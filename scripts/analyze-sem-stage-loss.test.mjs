#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeSemStageLoss } from "./analyze-sem-stage-loss.mjs";

const audit = analyzeSemStageLoss({
  results: [{
    job_id: "job-1",
    reference_title: "2024 Topps Chrome Test Player Gold 2/3",
    final_title: "2024 Topps Chrome Test Player",
    resolved_fields: { year: "2024", manufacturer: "Topps", product: "Topps Chrome", players: ["Test Player"], parallel: "Gold", serial_number: "2/3" },
    l2_candidate_debug: {
      candidate_observation_snapshot: { year: "2024", manufacturer: "Topps", product: "Topps Chrome", players: ["Test Player"], parallel: "Gold", serial_number: "2/3" },
      selected_candidate_id: "candidate-1",
      retrieval_application: { decisions: [] }
    }
  }]
});

assert.equal(audit.result_count, 1);
assert.ok(audit.confirmed_field_count >= 6);
assert.equal(audit.classification_counts.RENDERER_DROPPED, 2);
assert.match(audit.trace_limitations[0], /Raw Provider observation/);
console.log("SEM stage loss audit tests passed");
