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
