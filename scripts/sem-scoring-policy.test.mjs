import assert from "node:assert/strict";
import {
  numericalRarityComponents,
  scoreRequiredSemProjection,
  semScoringWeights
} from "../lib/listing/v4/policy/sem-scoring-policy.mjs";

assert.deepEqual(numericalRarityComponents("31/50"), { denominator: "50", numerator: "31" });
assert.deepEqual(numericalRarityComponents("#/50"), { denominator: "50", numerator: null });

const denominatorCorrectNumeratorMissing = scoreRequiredSemProjection({
  expectedSem: { numerical_rarity: "31/50" },
  actualSem: { numerical_rarity: "#/50" },
  fieldStatuses: { numerical_rarity: "CONFIRMED" }
});
assert.equal(denominatorCorrectNumeratorMissing.total_weight, 4);
assert.equal(denominatorCorrectNumeratorMissing.correct_weight, 4);
assert.equal(denominatorCorrectNumeratorMissing.weighted_accuracy, 1);
assert.equal(denominatorCorrectNumeratorMissing.components.some((row) => row.component === "serial_numerator"), false);

const semDoesNotRequireNumerator = scoreRequiredSemProjection({
  expectedSem: { numerical_rarity: "#/50" },
  actualSem: { numerical_rarity: "31/50" },
  fieldStatuses: { numerical_rarity: "CONFIRMED" }
});
assert.equal(semDoesNotRequireNumerator.weighted_accuracy, 1);
assert.equal(semDoesNotRequireNumerator.components.some((row) => row.component === "serial_numerator"), false);

const optionalAnswerFieldExcluded = scoreRequiredSemProjection({
  expectedSem: { numerical_rarity: "31/50", special_stamp: ["RC"] },
  actualSem: { numerical_rarity: "#/50", special_stamp: [] },
  fieldStatuses: { numerical_rarity: "CONFIRMED", special_stamp: "NOT_APPLICABLE" }
});
assert.equal(optionalAnswerFieldExcluded.weighted_accuracy, 1);
assert.equal(optionalAnswerFieldExcluded.runtime_chain_effect, "NONE");

const standardCardNumber = scoreRequiredSemProjection({
  expectedSem: { card_number: "SWS-LBJ" },
  actualSem: { card_number: "" },
  fieldStatuses: { card_number: "CONFIRMED" },
  grammar: "STANDARD"
});
const tcgCardNumber = scoreRequiredSemProjection({
  expectedSem: { card_number: "OP01-120" },
  actualSem: { card_number: "" },
  fieldStatuses: { card_number: "CONFIRMED" },
  grammar: "TCG"
});
assert.equal(standardCardNumber.total_weight, 1);
assert.equal(tcgCardNumber.total_weight, 4);
assert.equal(semScoringWeights.numerical_rarity, 4);

console.log("SEM scoring policy tests passed");

// Contract: extraComponents participate in weighting, and any incorrect
// required_for_acceptance component must surface in
// required_acceptance_failures (hard acceptance, independent of score).
{
  const scored = scoreRequiredSemProjection({
    expectedSem: { year: "2024", player: "Test Player" },
    actualSem: { year: "2024", player: "Test Player" },
    fieldStatuses: { year: "CONFIRMED", player: "CONFIRMED" },
    extraComponents: [{
      field: "lot_quantity",
      component: "lot_workflow_quantity",
      weight: 2,
      required_for_acceptance: true,
      correct: false
    }]
  });
  assert.ok(Array.isArray(scored.required_acceptance_failures), "required_acceptance_failures must always be an array");
  assert.equal(scored.required_acceptance_failures.length, 1);
  assert.equal(scored.required_acceptance_failures[0].field, "lot_quantity");
  assert.ok(scored.components.some((c) => c.component === "lot_workflow_quantity"));
  assert.ok(scored.weighted_accuracy < 1, "incorrect extra component must lower the weighted score");
}
{
  const scored = scoreRequiredSemProjection({
    expectedSem: { year: "2024" },
    actualSem: { year: "2024" },
    fieldStatuses: { year: "CONFIRMED" }
  });
  assert.deepEqual(scored.required_acceptance_failures, [], "no extras means no acceptance failures");
}
console.log("sem scoring extra-component contract tests passed");
