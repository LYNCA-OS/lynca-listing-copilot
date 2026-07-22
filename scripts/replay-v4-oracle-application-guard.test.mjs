import assert from "node:assert/strict";
import { replayApplicationGuard } from "./replay-v4-oracle-application-guard.mjs";

const replay = replayApplicationGuard({ cards: [{
  query_card_id: "card-1",
  application_decisions: [{
    field: "year",
    source_field: "year",
    old_value: "2024-25",
    value: "2025",
    applied: true,
    applied_to_final: true,
    application_plan_reason: "trusted_reviewed_identity_year_fill"
  }, {
    field: "product",
    source_field: "product",
    old_value: null,
    value: "Test Product",
    applied: true,
    application_plan_reason: "trusted_product_hierarchy_fill"
  }]
}] });

assert.equal(replay.counterfactual_policy.blocked_year_replacement_count, 1);
assert.equal(replay.cards[0].application_decisions[0].applied, false);
assert.equal(replay.cards[0].application_decisions[0].decision, "BLOCK");
assert.equal(replay.cards[0].application_decisions[1].applied, true);

console.log("V4 oracle application guard replay tests passed");
