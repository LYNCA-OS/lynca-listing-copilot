import assert from "node:assert/strict";

import {
  projectReadOnlyProviderSnapshot,
  replayProviderOutputContract
} from "./replay-provider-output-contract.mjs";

const model = {
  schema_version: "constraint-model-test-v1",
  source_card_count: 1,
  player_teams: {},
  player_team_years: {},
  set_product_years: {
    "fade to black": ["2025|Panini Phoenix"]
  }
};

const snapshot = {
  status: "COMPLETE",
  provider_fields: {
    year: "2025",
    product: "Panini Phoenix",
    set: "Fade To Black",
    players: ["Victor Wembanyama"],
    team: "San Antonio Spurs"
  },
  observed_fields: {
    year: "2025",
    set: "Fade To Black",
    players: ["Victor Wembanyama"],
    ssp: false,
    grade_type: "UNKNOWN"
  },
  normalized_evidence: {
    card_grade: {
      value: "10",
      sources: [{ source_type: "OCR_ONLY", observed_text: "10" }]
    },
    print_run_number: {
      value: "03/25",
      normalized_value: "03/25",
      sources: [{ source_type: "OCR_ONLY", observed_text: "03/25" }]
    }
  },
  provider_field_evidence: [
    { field: "year", value: "2025", source_type: "CARD_BACK_PRINTED_TEXT", visible_text: "2025" },
    { field: "product", value: "Panini Phoenix", source_type: "VISION_ONLY", visible_text: "" }
  ],
  final_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama"
};

const projected = projectReadOnlyProviderSnapshot(snapshot);
assert.equal(projected.fields.product, undefined);
assert.equal(projected.fields.team, undefined);
assert.equal(projected.fields.set, "Fade To Black");
assert.equal(projected.fields.card_grade, "10");
assert.equal(projected.fields.print_run_number, "03/25");
assert.equal(projected.fields.ssp, undefined);
assert.equal(projected.fields.grade_type, undefined);
assert.equal(projected.normalized_evidence.card_grade.value, "10");
assert.deepEqual(projected.field_evidence.map((item) => item.field), ["year"]);

const invalidPrintRun = projectReadOnlyProviderSnapshot({
  normalized_evidence: {
    print_run_number: { value: "GJ1", normalized_value: "GJ1" },
    print_run_denominator: { value: "1", normalized_value: "1" }
  }
});
assert.equal(invalidPrintRun.fields.print_run_number, undefined);
assert.equal(invalidPrintRun.fields.print_run_denominator, undefined);

const report = {
  results: [{
    asset_id: "asset-1",
    reference_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama",
    l2_candidate_debug: {
      retrieval_application: {
        enabled: true,
        selected_candidate_id: "official-1",
        decisions: [{
          candidate_id: "official-1",
          candidate_identity_id: "identity-1",
          candidate_lane: "catalog",
          resolver_field: "surface_color",
          resolver_value: "Gold",
          confidence: 0.72,
          source: "OFFICIAL_CHECKLIST",
          source_trust: "OFFICIAL_FACT",
          permission: "can_apply",
          decision: "APPLY",
          reason: "selected_candidate_safe_field_application"
        }]
      }
    },
    evaluation_decision_trace_packet: {
      replay_snapshot: snapshot,
      retrieval: {
        top_k: [{
          candidate_id: "official-1",
          source: "OFFICIAL_CHECKLIST",
          source_trust: "OFFICIAL_FACT",
          selected: true,
          field_actions: [{
            field: "product",
            value: "Panini Phoenix",
            action: "APPLY",
            reason: "SELECTED_CANDIDATE_SAFE_FIELD_APPLICATION"
          }]
        }]
      }
    }
  }]
};
const replay = await replayProviderOutputContract(report, { model });
assert.equal(replay.replayable_count, 1);
assert.equal(replay.forward_value_count, 1);
assert.ok(replay.rows[0].forward_value_fields.includes("product"));
assert.equal(replay.rows[0].forward_unknown_fields.includes("team"), true);
assert.equal(replay.rows[0].replay_snapshot_terminal_title_match, true);

const incomplete = await replayProviderOutputContract({
  results: [{ asset_id: "asset-2", evaluation_decision_trace_packet: { replay_snapshot: { status: "PARTIAL" } } }]
}, { model });
assert.equal(incomplete.gate_passed, false);
assert.equal(incomplete.incomplete_snapshot_count, 1);

const repairable = await replayProviderOutputContract({
  results: [{
    asset_id: "asset-3",
    reference_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama",
    evaluation_decision_trace_packet: {
      replay_snapshot: {
        ...snapshot,
        status: "PARTIAL",
        missing_components: ["resolver_version"]
      }
    }
  }]
}, { model });
assert.equal(repairable.replayable_count, 1);
assert.equal(repairable.rows[0].replay_snapshot_status, "REPAIRED");
assert.equal(repairable.rows[0].replay_snapshot_repaired_components[0].component, "resolver_version");

console.log("provider output contract replay tests passed");
