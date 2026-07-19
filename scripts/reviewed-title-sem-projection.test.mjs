import assert from "node:assert/strict";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import {
  scoreReviewedTitleSemProjection
} from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";

const orange = scoreReviewedTitleSemProjection({
  referenceTitle: "2024 Topps Chrome Tennis Grigor Dimitrov Orange Refractor Auto 03/25",
  finalTitle: "2024 Topps Chrome Tennis Grigor Dimitrov Certified Auto Issue Orange #/25"
});
assert.equal(orange.accepted, true);
assert.equal(orange.components.find((row) => row.field === "print_finish")?.correct, true);

const green = scoreReviewedTitleSemProjection({
  referenceTitle: "2024 Panini Select WWE Tony D'Angelo 4/5 Green Prizm",
  finalTitle: "2024 Panini Select WWE Tony D'Angelo Ringside Green #/5 #293"
});
assert.equal(green.accepted, true);

const missingRed = scoreReviewedTitleSemProjection({
  referenceTitle: "2025-26 Topps Three Victor Wembanyama Raindrops Signatures Red Auto 5/5",
  finalTitle: "2025-26 Topps 3 Rain Drops Signatures Victor Wembanyama #/5 #RS Auto"
});
assert.equal(missingRed.weighted_accuracy >= 0.87, true);
assert.deepEqual(missingRed.required_acceptance_failures, ["print_finish"]);
assert.equal(missingRed.accepted, false, "a high average cannot hide a missing required base color");

const missingLotQuantity = scoreReviewedTitleSemProjection({
  referenceTitle: "2026 Bowman Chrome Sam Petersen /499 Luis Cova /250 David /125 Refractor lotx3",
  finalTitle: "2026 Bowman Chrome Sam Petersen / Luis Cova / David Davalillo Bowman Briefing"
});
assert.equal(missingLotQuantity.expected_grammar, "LOT");
assert.deepEqual(missingLotQuantity.required_acceptance_failures, ["lot_quantity"]);
assert.equal(missingLotQuantity.accepted, false);

assert.deepEqual(
  parseReviewedTitleFields("2025-26 Topps 3 Rain Drops Signatures Victor Wembanyama #/5 #RS Auto").players,
  ["Victor Wembanyama"]
);
assert.deepEqual(
  parseReviewedTitleFields("2025 Panini Prizm Football Abdul Carter Silver RC (New York Giants)").players,
  ["Abdul Carter"]
);
assert.deepEqual(
  parseReviewedTitleFields("2024 Panini Select WWE Tony D'Angelo Ringside Green #/5 #293").players,
  ["Tony D'Angelo"]
);

console.log("reviewed-title SEM projection tests passed");
