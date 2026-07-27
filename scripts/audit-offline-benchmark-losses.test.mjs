import assert from "node:assert/strict";

import { auditRows } from "./audit-offline-benchmark-losses.mjs";

const rows = [
  {
    asset_id: "a",
    reviewed_title: "2024 Topps Chrome Player Gold Refractor 7/50",
    final_title: "2024 Topps Player",
    resolved_fields: { product: "Chrome", print_run_denominator: "50" },
    candidate_observation_snapshot: { surface: "Gold Refractor" }
  },
  {
    asset_id: "b",
    reviewed_title: "2024 Topps Chrome Other Gold Refractor 2/25",
    final_title: "2024 Topps Chrome Other #/25",
    resolved_fields: { product: "Chrome", print_run_denominator: "25" }
  },
  {
    asset_id: "c",
    reviewed_title: "2024 Topps Chrome Third Gold Refractor",
    final_title: "2024 Topps Chrome Third",
    candidate_observation_snapshot: { surface: "Gold Refractor" }
  }
];

const audit = auditRows(rows);
assert.equal(audit.serial.missing_total, 2);
assert.equal(audit.serial.denominator_preserved_numerator_missing, 1);
assert.equal(audit.serial.denominator_missing, 1);
assert.equal(audit.serial.denominator_missing_by_disposition.RESOLVER_HELD_NOT_RENDERED, 1);
assert.equal(audit.structural.missing_total, 7);
assert.equal(audit.structural.missing_by_disposition.RESOLVER_HELD_NOT_RENDERED, 1);
assert.equal(audit.structural.missing_by_disposition.EVIDENCE_HELD_NOT_RESOLVED, 4);
assert.equal(audit.structural.missing_by_disposition.NEVER_HELD, 2);

const canonicalLedgerAudit = auditRows([{
  asset_id: "ledger-a",
  reviewed_title: "2024 Topps Player 7/50",
  final_title: "2024 Topps Player",
  // Conflicting legacy diagnostics must not override the canonical ledger.
  resolved_fields: { numerical_rarity: "50" },
  evaluation_decision_trace_packet: {
    field_lineage_ledger: {
      schema_version: "field-lineage-ledger-v1",
      fields: [{
        field: "numerical_rarity",
        raw_provider: { values: ["50"] },
        normalized: { values: ["50"] },
        retrieval_supported: { decisions: [] },
        resolver_result: { values: [] },
        renderer_module: { values: [] },
        final_title_span: { matched_values: [] }
      }]
    }
  }
}]);
assert.equal(canonicalLedgerAudit.serial.denominator_missing_by_disposition.EVIDENCE_HELD_NOT_RESOLVED, 1);
assert.equal(canonicalLedgerAudit.serial.denominator_missing_by_disposition.RESOLVER_HELD_NOT_RENDERED || 0, 0);

console.log("offline benchmark loss audit tests passed");
