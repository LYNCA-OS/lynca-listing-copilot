#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  minimumZeroFailureSample,
  scoreSemanticPublicationCard,
  summariseSemanticPublicationCohort,
  wilsonInterval,
  zeroFailureUpperBound
} from "../lib/listing/evaluation/semantic-publication-ruler.mjs";

const concepts = [
  { id: "finish:refractor", field: "print_finish", label: "Refractor" },
  {
    id: "finish:gold-refractor",
    field: "print_finish",
    label: "Gold Refractor",
    parents: ["finish:refractor"]
  },
  {
    id: "finish:blue-refractor",
    field: "print_finish",
    label: "Blue Refractor",
    parents: ["finish:refractor"]
  },
  { id: "attribute:autograph", field: "search_optimization", label: "Autograph", aliases: ["Auto"] },
  { id: "subject:ohtani", field: "subject", label: "Shohei Ohtani" },
  { id: "subject:trout", field: "subject", label: "Mike Trout" }
];

const baseAnnotations = [
  {
    field: "print_finish",
    concept_id: "finish:gold-refractor",
    truth_status: "SUPPORTED",
    title_policy: "OPTIONAL",
    recognition_required: true,
    adjudicated: true
  },
  {
    field: "print_finish",
    concept_id: "finish:blue-refractor",
    truth_status: "CONTRADICTED",
    title_policy: "NOT_APPLICABLE",
    adjudicated: true
  },
  {
    field: "search_optimization",
    concept_id: "attribute:autograph",
    truth_status: "SUPPORTED",
    title_policy: "OPTIONAL",
    recognition_required: true,
    adjudicated: true
  }
];

const constraints = { length_ok: true, grammar_ok: true, redundancy_ok: true };
const score = (overrides = {}) => scoreSemanticPublicationCard({
  annotations: baseAnnotations,
  canonical_claims: [],
  title_claims: [],
  concepts,
  annotation_complete: true,
  title_constraints: constraints,
  ...overrides
});

// Repairing a false field must dominate deleting it: both remove the false
// claim, but only the repair recovers the independently supported fact.
const wrongFinish = score({
  canonical_claims: [{ field: "print_finish", value: "Blue Refractor" }],
  title_claims: [{ field: "print_finish", value: "Blue Refractor" }]
});
const deletedFinish = score();
const repairedFinish = score({
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_claims: [{ field: "print_finish", value: "Gold Refractor" }]
});
assert.equal(wrongFinish.recognition.contradicted_count, 1);
assert.equal(wrongFinish.title.publishable, false);
assert.equal(deletedFinish.recognition.fact_recall, 0);
assert.equal(deletedFinish.title.publishable, true, "optional true title facts may be omitted");
assert.equal(repairedFinish.recognition.fact_recall, 0.5);
assert.equal(repairedFinish.title.publishable, true);
assert.ok(repairedFinish.recognition.fact_recall > deletedFinish.recognition.fact_recall);

// Synonyms are concept-equivalent, so Auto satisfies Autograph without title
// duplication or token-level hostility.
const synonym = score({
  canonical_claims: [{ field: "search_optimization", value: "Auto" }],
  title_claims: [{ field: "search_optimization", value: "Auto" }]
});
assert.equal(synonym.recognition.supported_exact_count, 1);

// A parent term is factually supported by a true leaf but does not recover the
// leaf's specificity in canonical recognition.
const generalized = score({
  canonical_claims: [{ field: "print_finish", value: "Refractor" }],
  title_claims: [{ field: "print_finish", value: "Refractor" }]
});
assert.equal(generalized.recognition.supported_generalized_count, 1);
assert.equal(generalized.recognition.fact_recall, 0);
assert.equal(generalized.title.publishable, true);

// If the leaf is independently marked REQUIRED, a generic parent does not
// satisfy it even though the parent remains a true statement.
const requiredGold = scoreSemanticPublicationCard({
  annotations: [{
    field: "print_finish",
    concept_id: "finish:gold-refractor",
    truth_status: "SUPPORTED",
    title_policy: "REQUIRED",
    recognition_required: true,
    adjudicated: true
  }],
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_claims: [{ field: "print_finish", value: "Refractor" }],
  concepts,
  annotation_complete: true,
  title_constraints: constraints
});
assert.equal(requiredGold.title.required_claim_recall, 0);
assert.equal(requiredGold.title.publishable, false);

// Critical errors and unreviewed claims always fail closed.
const criticalFalse = scoreSemanticPublicationCard({
  annotations: [
    {
      field: "subject",
      concept_id: "subject:ohtani",
      truth_status: "SUPPORTED",
      title_policy: "REQUIRED",
      adjudicated: true
    },
    {
      field: "subject",
      concept_id: "subject:trout",
      truth_status: "CONTRADICTED",
      title_policy: "NOT_APPLICABLE",
      adjudicated: true
    }
  ],
  canonical_claims: [{ field: "subject", value: "Mike Trout" }],
  title_claims: [{ field: "subject", value: "Mike Trout" }],
  concepts,
  annotation_complete: true,
  title_constraints: constraints
});
assert.equal(criticalFalse.critical.false_claim_count, 1);
assert.equal(criticalFalse.critical.pass, false);
assert.equal(criticalFalse.title.publishable, false);

const incomplete = score({ annotation_complete: false });
assert.equal(incomplete.eligible, false);
assert.equal(incomplete.title.publishable, null);

// With 105 cards, 101 passes are required for a 95% Wilson lower bound above
// 0.90. Zero critical errors on 105 cards still only bounds the population
// error rate below roughly 2.81% at 95% confidence.
assert.ok(wilsonInterval(100, 105).lower < 0.90);
assert.ok(wilsonInterval(101, 105).lower > 0.90);
assert.ok(Math.abs(zeroFailureUpperBound(105) - 0.0281276240) < 1e-9);
assert.equal(minimumZeroFailureSample(0.01), 299);
assert.equal(minimumZeroFailureSample(0.001), 2995);

const cohort = summariseSemanticPublicationCohort([
  ...Array.from({ length: 101 }, () => repairedFinish),
  ...Array.from({ length: 4 }, () => wrongFinish)
]);
assert.equal(cohort.publishable_cards, 101);
assert.equal(cohort.critical_false_cards, 0, "wrong non-critical finish blocks publishability without becoming a critical error");
assert.equal(cohort.critical_unresolved_cards, 0);
assert.ok(cohort.publishable_card_rate_wilson_95.lower > 0.90);

const criticalCohort = summariseSemanticPublicationCohort([criticalFalse]);
assert.equal(criticalCohort.critical_blocked_cards, 1);
assert.equal(criticalCohort.critical_false_cards, 1);
assert.equal(criticalCohort.critical_required_missed_cards, 1);

process.stdout.write(`${JSON.stringify({
  ok: true,
  repaired_fact_recall: repairedFinish.recognition.fact_recall,
  deleted_fact_recall: deletedFinish.recognition.fact_recall,
  optional_omission_publishable: deletedFinish.title.publishable,
  generalized_title_publishable: generalized.title.publishable,
  required_specificity_publishable: requiredGold.title.publishable,
  critical_false_publishable: criticalFalse.title.publishable,
  paid105_publishable_threshold: "101/105",
  zero_critical_105_upper_95: zeroFailureUpperBound(105)
}, null, 2)}\n`);
