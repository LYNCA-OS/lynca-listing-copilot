#!/usr/bin/env node

import assert from "node:assert/strict";

import { auditGoldCoverage } from "../lib/listing/evaluation/gold-coverage-audit.mjs";
import {
  conceptRegistrySha256,
  criticalPolicySha256
} from "../lib/listing/evaluation/semantic-publication-ruler.mjs";

const conceptRegistry = {
  registry_id: "synthetic-coverage-concepts-v1",
  status: "FROZEN_APPROVED",
  concepts: [
    { id: "subject:ohtani", field: "subject", label: "Shohei Ohtani" },
    { id: "attribute:autograph", field: "search_optimization", label: "Autograph", aliases: ["Auto"] }
  ]
};
conceptRegistry.sha256 = conceptRegistrySha256(conceptRegistry);

const criticalPolicy = {
  policy_id: "synthetic-coverage-critical-policy-v1",
  status: "FROZEN_APPROVED",
  fields: ["subject"]
};
criticalPolicy.sha256 = criticalPolicySha256(criticalPolicy);

const card = (index, goldCount) => {
  const claims = Array.from({ length: 10 }, (_, claimIndex) => ({
    field: claimIndex === 0 ? "subject" : "print_finish",
    value: `card ${index} claim ${claimIndex}`,
    adjudicated: true,
    truth_status: "SUPPORTED",
    truth_source: "CARD_IMAGE",
    evidence_refs: [`asset:card-${index}#claim-${claimIndex}`]
  }));
  const identity = {
    asset_id: `card-${index}`,
    physical_card_id: `physical-card-${index}`,
    grammar: ["STANDARD", "TCG", "LOT"][index % 3]
  };
  return {
    transcript: { ...identity, claims },
    gold: { ...identity, annotations: claims.slice(0, goldCount) }
  };
};

const auditCards = (cards, overrides = {}) => {
  const transcriptions = overrides.unrestricted_transcription_cards
    || cards.map((entry) => entry.transcript);
  return auditGoldCoverage({
    constructed_gold_cards: overrides.constructed_gold_cards || cards.map((entry) => entry.gold),
    unrestricted_transcription_cards: transcriptions,
    critical_policy: Object.hasOwn(overrides, "critical_policy")
      ? overrides.critical_policy
      : criticalPolicy,
    expected_critical_policy_sha256: criticalPolicy.sha256,
    concept_registry: conceptRegistry,
    expected_concept_registry_sha256: conceptRegistry.sha256,
    expected_asset_ids: transcriptions.map((entry) => entry.asset_id),
    ...overrides
  });
};

// A shallow scan that misses one fact per card must fail. This is the failure
// mode the audit exists to expose: both arms can share the same omission while
// an internally consistent gold set still looks healthy.
const shallowCards = Array.from({ length: 20 }, (_, index) => card(index, 9));
const shallow = auditCards(shallowCards);
assert.equal(shallow.exact_claim_coverage, 0.9);
assert.equal(shallow.macro_card_exact_coverage, 0.9);
assert.equal(shallow.gate_pass, false);
assert.deepEqual(shallow.missing_by_field, { print_finish: 20 });
assert.deepEqual(shallow.missing_by_grammar, { LOT: 6, STANDARD: 7, TCG: 7 });

const completeCards = Array.from({ length: 20 }, (_, index) => card(index, 10));
const complete = auditCards(completeCards);
assert.equal(complete.exact_claim_coverage, 1);
assert.equal(complete.lowest_card_exact_coverage, 1);
assert.equal(complete.critical_exact_claim_coverage, 1);
assert.equal(complete.gate_pass, true);

const missingCriticalCards = Array.from({ length: 20 }, (_, index) => {
  const entry = card(index, 10);
  entry.gold.annotations = entry.gold.annotations.slice(1);
  return entry;
});
const missingCritical = auditCards(missingCriticalCards);
assert.equal(missingCritical.critical_exact_claim_coverage, 0);
assert.equal(missingCritical.gate_pass, false);

// Do not let a very weak card hide behind many easy cards. The sample unit is
// the card, not an IID bag of claims.
const concentratedMissCards = Array.from({ length: 20 }, (_, index) => card(index, index === 0 ? 5 : 10));
const concentratedMiss = auditCards(concentratedMissCards);
assert.equal(concentratedMiss.exact_claim_coverage, 0.975);
assert.equal(concentratedMiss.lowest_card_exact_coverage, 0.5);
assert.equal(concentratedMiss.gate_pass, false);

const unapprovedPolicy = auditCards(completeCards, {
  critical_policy: { ...criticalPolicy, status: "PROPOSED" }
});
assert.equal(unapprovedPolicy.exact_claim_coverage, 1);
assert.equal(unapprovedPolicy.gate_pass, false);

const untypedGoldCards = completeCards.map((entry, index) => ({
  ...entry.gold,
  annotations: entry.gold.annotations.map((claim) => index === 0 ? { ...claim, truth_status: undefined } : claim)
}));
const untypedGold = auditCards(completeCards, {
  constructed_gold_cards: untypedGoldCards,
});
assert.ok(untypedGold.exact_claim_coverage < 1);
assert.equal(untypedGold.gate_pass, false);

const aliasCards = Array.from({ length: 20 }, (_, index) => {
  const identity = {
    asset_id: `alias-card-${index}`,
    physical_card_id: `alias-physical-${index}`,
    grammar: "STANDARD"
  };
  const subject = {
    field: "subject",
    value: `Alias Subject ${index}`,
    truth_status: "SUPPORTED",
    adjudicated: true,
    truth_source: "CARD_IMAGE",
    evidence_refs: [`asset:alias-card-${index}#subject`]
  };
  return {
    transcript: {
      ...identity,
      claims: [subject, { field: "search_optimization", value: "Auto" }]
    },
    gold: {
      ...identity,
      annotations: [subject, {
        field: "search_optimization",
        value: "Autograph",
        truth_status: "SUPPORTED",
        adjudicated: true,
        truth_source: "CARD_IMAGE",
        evidence_refs: [`asset:alias-card-${index}#autograph`]
      }]
    }
  };
});
const aliasCoverage = auditCards(aliasCards);
assert.equal(aliasCoverage.exact_claim_coverage, 1);
assert.equal(aliasCoverage.gate_pass, true);

const forgedConceptValue = completeCards.map((entry, index) => index === 0
  ? {
    ...entry.transcript,
    claims: [{ field: "subject", concept_id: "subject:ohtani", value: "Mike Trout" }]
  }
  : entry.transcript);
assert.throws(() => auditCards(completeCards, {
  unrestricted_transcription_cards: forgedConceptValue,
  expected_asset_ids: forgedConceptValue.map((entry) => entry.asset_id)
}), /concept_value_mismatch:subject:ohtani/);

const duplicateGold = completeCards.map((entry, index) => index === 0
  ? { ...entry.gold, annotations: [...entry.gold.annotations, entry.gold.annotations[0]] }
  : entry.gold);
assert.throws(() => auditCards(completeCards, { constructed_gold_cards: duplicateGold }),
  /duplicate_coverage_claim_key:gold:card-0/);

const missingGrammarCards = completeCards.map((entry, index) => index === 0
  ? { ...entry.transcript, grammar: "" }
  : entry.transcript);
const missingGrammar = auditCards(completeCards, {
  unrestricted_transcription_cards: missingGrammarCards,
  expected_asset_ids: missingGrammarCards.map((entry) => entry.asset_id)
});
assert.equal(missingGrammar.grammars_valid, false);
assert.equal(missingGrammar.gate_pass, false);

const mostlyEmptyTranscriptions = completeCards.map((entry, index) => index === 0
  ? entry.transcript
  : { ...entry.transcript, claims: [] });
const mostlyEmpty = auditCards(completeCards, {
  unrestricted_transcription_cards: mostlyEmptyTranscriptions,
  expected_asset_ids: mostlyEmptyTranscriptions.map((entry) => entry.asset_id)
});
assert.equal(mostlyEmpty.audit_cards, 20);
assert.equal(mostlyEmpty.all_transcriptions_nonempty, false);
assert.equal(mostlyEmpty.gate_pass, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  shallow_coverage: shallow.exact_claim_coverage,
  shallow_gate: shallow.gate_pass,
  complete_coverage: complete.exact_claim_coverage,
  complete_gate: complete.gate_pass,
  missing_critical_gate: missingCritical.gate_pass,
  concentrated_miss_gate: concentratedMiss.gate_pass
}, null, 2)}\n`);
