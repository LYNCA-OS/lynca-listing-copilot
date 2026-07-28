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
assert.deepEqual(projected.field_evidence.map((item) => item.field), ["year"]);

const report = {
  results: [{
    asset_id: "asset-1",
    reference_title: "2025 Panini Phoenix Fade To Black Victor Wembanyama",
    evaluation_decision_trace_packet: { replay_snapshot: snapshot }
  }]
};
const replay = await replayProviderOutputContract(report, { model });
assert.equal(replay.replayable_count, 1);
assert.equal(replay.forward_value_count, 1);
assert.ok(replay.rows[0].forward_value_fields.includes("product"));
assert.equal(replay.rows[0].forward_unknown_fields.includes("team"), true);

const incomplete = await replayProviderOutputContract({
  results: [{ asset_id: "asset-2", evaluation_decision_trace_packet: { replay_snapshot: { status: "PARTIAL" } } }]
}, { model });
assert.equal(incomplete.gate_passed, false);
assert.equal(incomplete.incomplete_snapshot_count, 1);

console.log("provider output contract replay tests passed");
