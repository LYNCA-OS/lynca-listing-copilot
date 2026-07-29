import assert from "node:assert/strict";

import { scoreTitleCriticalGuard } from "../lib/listing/evaluation/title-critical-guard.mjs";
import { scoreTitles } from "./v4-ebay-smoke.mjs";

const reference = "2023 Panini Phoenix Bijan Robinson RC #12";

const exact = scoreTitleCriticalGuard({
  referenceTitle: reference,
  finalTitle: reference,
  reviewedTitleGroundTruth: true
});
assert.equal(exact.complete, true);
assert.equal(exact.catastrophic, false);
assert.equal(exact.critical_fabrication, false);

const fabricated = scoreTitles(reference, `${reference} Imaginary Superfractor`, {
  reviewedTitleGroundTruth: true
});
assert.equal(fabricated.policy_fair_token_recall, 1, "token recall alone must demonstrate the false-pass case");
assert.equal(fabricated.critical_title_guard.complete, true);
assert.equal(fabricated.critical_title_guard.catastrophic, true);
assert.equal(fabricated.critical_title_guard.critical_fabrication, true);
assert.ok(fabricated.critical_title_guard.mismatches.some((item) => item.field === "subject"));

const productReference = "2023 Panini Bijan Robinson RC #12";
const fabricatedProduct = scoreTitles(productReference, `${productReference} Prizm`, {
  reviewedTitleGroundTruth: true
});
assert.equal(fabricatedProduct.policy_fair_token_recall, 1);
assert.equal(fabricatedProduct.critical_title_guard.critical_fabrication, true);
assert.ok(fabricatedProduct.critical_title_guard.mismatches.some((item) => item.field === "product"));

const missingSubject = scoreTitleCriticalGuard({
  referenceTitle: reference,
  finalTitle: "2023 Panini Phoenix RC #12",
  reviewedTitleGroundTruth: true
});
assert.equal(missingSubject.catastrophic, true);
assert.ok(missingSubject.mismatches.some((item) => item.field === "subject"));

const untrusted = scoreTitleCriticalGuard({
  referenceTitle: reference,
  finalTitle: `${reference} Imaginary Superfractor`,
  reviewedTitleGroundTruth: false
});
assert.equal(untrusted.complete, false);
assert.equal(untrusted.catastrophic, false, "weak labels cannot authorize a disaster verdict");

const parserMissedSubjectReference = "2023 Panini Phoenix Fade To Black Nikola Jokic #20";
const parserMissedSubject = scoreTitleCriticalGuard({
  referenceTitle: parserMissedSubjectReference,
  finalTitle: "2023 Panini Phoenix Fade To Black Wrong Person #20",
  reviewedTitleGroundTruth: true,
  identityGroundTruth: {
    season_year: "2023",
    product: "Panini Phoenix (23-24)",
    player: "Nikola Jokic",
    card_number: "20"
  }
});
assert.equal(parserMissedSubject.complete, true);
assert.equal(parserMissedSubject.identity_ground_truth_used, true);
assert.equal(parserMissedSubject.catastrophic, true);
assert.ok(parserMissedSubject.mismatches.some((item) => item.field === "subject"));

const noSubjectTruth = scoreTitleCriticalGuard({
  referenceTitle: parserMissedSubjectReference,
  finalTitle: parserMissedSubjectReference,
  reviewedTitleGroundTruth: true
});
assert.equal(noSubjectTruth.critical_coverage_complete, false);
assert.equal(noSubjectTruth.complete, false, "parser gaps without independent identity truth must fail closed");

console.log("title critical guard tests passed");
