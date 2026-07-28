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
assert.match(audit.trace_limitations[0], /Provider stage trace/);
console.log("SEM stage loss audit tests passed");

{
  const postResolverSnapshotMustNotCount = analyzeSemStageLoss({
    results: [{
      job_id: "job-post-resolver-contamination",
      reference_title: "2024 Topps Chrome Test Player",
      final_title: "",
      resolved_fields: {},
      l2_candidate_debug: {
        candidate_observation_snapshot: {
          year: "2024",
          manufacturer: "Topps",
          product: "Topps Chrome",
          players: ["Test Player"]
        }
      }
    }]
  });
  assert.equal(
    postResolverSnapshotMustNotCount.classification_counts.RESOLVER_DROPPED || 0,
    0,
    "post-resolver candidate snapshots must not inflate Evidence Oracle"
  );
  assert.ok((postResolverSnapshotMustNotCount.classification_counts.TRACE_MISSING || 0) > 0);
  assert.ok(postResolverSnapshotMustNotCount.rows.every((row) => row.observation_value === null));
}

{
  const legacyTraceStillUsesPersistedNormalization = analyzeSemStageLoss({
    results: [{
      job_id: "job-legacy-trace",
      reference_title: "2024 Topps Chrome Test Player",
      final_title: "",
      resolved_fields: {},
      evaluation_decision_trace_packet: {
        trace_level: "evaluation",
        provider_observation_fields: { product: "Prizm" },
        normalization: { output: { product: "Prizm" } },
        retrieval: { top_k: [] },
        field_lineage: []
      },
      l2_candidate_debug: {
        candidate_observation_snapshot: { product: "Topps Chrome" }
      }
    }]
  });
  const product = legacyTraceStillUsesPersistedNormalization.rows.find((row) => row.field === "product");
  assert.equal(product.observation_value, "Prizm");
  assert.equal(product.classification, "EVIDENCE_OR_RETRIEVAL_MISSING");
}

{
  const legitimateEmptyRetrieval = analyzeSemStageLoss({
    results: [{
      job_id: "job-ran-empty",
      reference_title: "2024 Topps Chrome Test Player",
      final_title: "",
      resolved_fields: {},
      evaluation_decision_trace_packet: {
        trace_level: "evaluation",
        stage_execution: {
          provider_observation: { status: "RAN" },
          normalization: { status: "RAN" },
          retrieval: { status: "RAN_EMPTY", reason_code: "RETRIEVAL_EXECUTED_NO_CANDIDATES" }
        },
        provider_observation_fields: { product: "Prizm" },
        normalization: { output: { product: "Prizm" } },
        retrieval: { queries: ["Prizm"], top_k: [], execution_status: "RAN_EMPTY" },
        field_lineage: []
      }
    }]
  });
  const product = legitimateEmptyRetrieval.rows.find((row) => row.field === "product");
  assert.equal(product.classification, "EVIDENCE_OR_RETRIEVAL_MISSING");
  assert.notEqual(product.classification, "TRACE_MISSING", "a persisted empty retrieval is execution evidence, not missing trace");
}

// Classification totals name the leaking stage but not the field to go and fix.
// The per-field rollup is what located the real bottleneck on the 2026-07-25
// cold-20 (one field, search_optimization, held 8 of 32 losses), so it ships
// with the audit instead of being re-derived by hand each time.
{
  const audit = analyzeSemStageLoss({
    results: [
      { asset_id: "a1", reviewed_title: "2025 Topps Chrome Somebody Gold Refractor 5/10 RC Dodgers", final_title: "2025 Topps Chrome Somebody" },
      { asset_id: "a2", reviewed_title: "2025 Panini Prizm Someone Silver 3/5 RC Lakers", final_title: "2025 Panini Prizm Someone" }
    ]
  });
  assert.ok(Array.isArray(audit.field_loss_summary), "field_loss_summary must be present");
  const totals = audit.field_loss_summary.reduce((sum, entry) => sum + entry.total, 0);
  assert.equal(totals, audit.missing_field_count, "rollup must account for every missing field");
  const sorted = audit.field_loss_summary.every((entry, index, list) => (
    index === 0 || list[index - 1].total >= entry.total
  ));
  assert.ok(sorted, "rollup must be ordered by loss count so the bottleneck is first");
  if (audit.field_loss_summary.length) {
    assert.deepEqual(audit.top_lossy_field, audit.field_loss_summary[0]);
  }
}

console.log("sem stage loss field rollup tests passed");
