import assert from "node:assert/strict";
import {
  scoreRequiredSemProjection,
  semFieldEquivalent,
  semScoringWeights
} from "../lib/listing/v4/policy/sem-scoring-policy.mjs";

assert.equal(
  semFieldEquivalent("numerical_rarity", "5/50", "#/50"),
  true,
  "Numerical Rarity compares production quantity, not the current-copy numerator"
);
assert.equal(semFieldEquivalent("numerical_rarity", "5/50", "#/99"), false);

assert.equal(semFieldEquivalent("product", "Topps Three", "Topps 3 Basketball"), true);
assert.equal(semFieldEquivalent("card_name", "Raindrops Signatures", "Rain Drops Signatures"), true);

assert.equal(
  semFieldEquivalent(
    "subject",
    ["Harry Ford Drew Gilbert Samuel Basallo"],
    ["Samuel Basallo", "Harry Ford", "Drew Gilbert"]
  ),
  true,
  "multi-subject identity must not depend on title grouping or order"
);
assert.equal(
  semFieldEquivalent(
    "subject",
    ["Hank Aaron Ken Griffey Jr. Mike Trout"],
    ["Aaron", "Griffey Jr.", "Trout"]
  ),
  false,
  "surname-only output must not receive full-subject credit"
);

assert.equal(
  semFieldEquivalent("print_finish", "Orange Refractor", "Orange"),
  true,
  "safe color dimensionality reduction must ignore an unproven optical family"
);
assert.equal(semFieldEquivalent("print_finish", "Green Prizm", "Green"), true);
assert.equal(semFieldEquivalent("print_finish", "Gold Shimmer", "Silver"), false);
assert.equal(semFieldEquivalent("print_finish", "Red Wave", ""), false);

const standardNumber = scoreRequiredSemProjection({
  expectedSem: { card_number: "42" },
  actualSem: { card_number: "" },
  requiredFields: ["card_number"],
  grammar: "STANDARD"
});
const tcgNumber = scoreRequiredSemProjection({
  expectedSem: { card_number: "139/205" },
  actualSem: { card_number: "" },
  requiredFields: ["card_number"],
  grammar: "TCG"
});
assert.equal(standardNumber.total_weight, semScoringWeights.standard_card_number);
assert.equal(tcgNumber.total_weight, semScoringWeights.tcg_card_number);

const missingBaseColor = scoreRequiredSemProjection({
  expectedSem: { year: "2025", product: "Topps Chrome", print_finish: "Red Refractor" },
  actualSem: { year: "2025", product: "Topps Chrome", print_finish: "" },
  requiredFields: ["year", "product", "print_finish"]
});
assert.deepEqual(missingBaseColor.required_acceptance_failures, ["print_finish"]);

console.log("SEM scoring policy tests passed");
