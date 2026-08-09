#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  cardMaterialSha256,
  conceptRegistrySha256,
  criticalPolicySha256,
  minimumZeroFailureSample,
  normalizeClaimValue,
  RULER_BUNDLE_SHA256,
  rulerApprovalManifestSha256,
  scoreSemanticPublicationCard,
  summariseSemanticPublicationCohort,
  wilsonInterval,
  zeroFailureUpperBound
} from "../lib/listing/evaluation/semantic-publication-ruler.mjs";

assert.equal(normalizeClaimValue("Pokémon"), "pokemon");
assert.equal(normalizeClaimValue("リザードン"), "リザードン");
assert.equal(normalizeClaimValue("喷火龙"), "喷火龙");
assert.equal(normalizeClaimValue("리자몽"), "리자몽");
assert.equal(normalizeClaimValue("１２３／１５０"), "123/150");

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
    value: "Gold Refractor",
    truth_status: "SUPPORTED",
    title_policy: "OPTIONAL",
    recognition_required: true,
    adjudicated: true
  },
  {
    field: "print_finish",
    concept_id: "finish:blue-refractor",
    value: "Blue Refractor",
    truth_status: "CONTRADICTED",
    title_policy: "NOT_APPLICABLE",
    adjudicated: true
  },
  {
    field: "search_optimization",
    concept_id: "attribute:autograph",
    value: "Autograph",
    truth_status: "SUPPORTED",
    title_policy: "OPTIONAL",
    recognition_required: true,
    adjudicated: true
  }
];

const grammarCheckerId = "synthetic-csm-grammar-checker-v1";
const grammarCheckerSha256 = "a".repeat(64);
const frozenCriticalPolicy = {
  policy_id: "synthetic-test-policy-v1",
  status: "FROZEN_APPROVED",
  fields: ["year", "subject", "numerical_rarity", "grading_info", "lot_quantity"]
};
frozenCriticalPolicy.sha256 = criticalPolicySha256(frozenCriticalPolicy);
const frozenConceptRegistry = {
  registry_id: "synthetic-concept-registry-v1",
  status: "FROZEN_APPROVED",
  concepts
};
frozenConceptRegistry.sha256 = conceptRegistrySha256(frozenConceptRegistry);
const approvalManifestBase = {
  manifest_id: "synthetic-ruler-approval-v1",
  status: "SEALED_APPROVED",
  ruler_version: "semantic-publication-ruler-v1",
  scorer_bundle_sha256: RULER_BUNDLE_SHA256,
  critical_policy_sha256: frozenCriticalPolicy.sha256,
  concept_registry_sha256: frozenConceptRegistry.sha256,
  grammar_checker_id: grammarCheckerId,
  grammar_checker_sha256: grammarCheckerSha256,
  cohort_selection_sha256: "d".repeat(64),
  gold_coverage_report_sha256: "e".repeat(64),
  annotation_packet_sha256: "b".repeat(64),
  arm_outputs_sha256: "c".repeat(64)
};
const approvalForMap = (cardMaterialSha256ByAsset) => {
  const manifest = {
    ...approvalManifestBase,
    card_material_sha256_by_asset: cardMaterialSha256ByAsset
  };
  manifest.sha256 = rulerApprovalManifestSha256(manifest);
  return manifest;
};

const traceTitleClaims = (claims = []) => {
  let title = "";
  const traced = claims.map((claim) => {
    const renderedText = String(claim.rendered_text || claim.value || "");
    if (title) title += " ";
    const start = title.length;
    title += renderedText;
    return {
      ...claim,
      rendered_text: renderedText,
      title_spans: [{ start, end: title.length }],
      source_fields: claim.source_fields || [claim.field],
      transform_codes: claim.transform_codes || ["EXACT_OR_ALIAS"],
      emission_status: "FULL"
    };
  });
  return { title, claims: traced };
};

const constraintsFor = (title) => ({
  grammar_checker_id: grammarCheckerId,
  grammar_checker_sha256: grammarCheckerSha256,
  checked_title_sha256: createHash("sha256").update(title).digest("hex"),
  grammar_violation_codes: []
});

const score = (overrides = {}) => {
  const assetId = overrides.asset_id || "synthetic-asset-1";
  const physicalCardId = overrides.physical_card_id || `physical-${assetId}`;
  const traced = traceTitleClaims(overrides.title_claims || []);
  const title = Object.hasOwn(overrides, "title_text") ? overrides.title_text : traced.title;
  const rawAnnotations = overrides.annotations || baseAnnotations;
  const annotations = overrides.annotation_provenance_defaults === false
    ? rawAnnotations
    : rawAnnotations.map((annotation, index) => ({
      truth_source: annotation.truth_source || "CARD_IMAGE",
      evidence_refs: annotation.evidence_refs || [`asset:${assetId}#claim-${index}`],
      ...annotation
    }));
  const scoreInput = {
    asset_id: assetId,
    physical_card_id: physicalCardId,
    canonical_claims: [],
    annotation_complete: true,
    ...overrides,
    annotations,
    title_claims: Object.hasOwn(overrides, "traced_title_claims")
      ? overrides.traced_title_claims
      : traced.claims,
    title_text: title,
    title_constraints: overrides.title_constraints || constraintsFor(title)
  };
  const materialSha256 = cardMaterialSha256(scoreInput);
  const approvalManifest = overrides.approval_manifest
    || approvalForMap({ [assetId]: materialSha256 });
  return scoreSemanticPublicationCard({
    ...scoreInput,
    concept_registry: overrides.concept_registry || frozenConceptRegistry,
    critical_policy: Object.hasOwn(overrides, "critical_policy")
      ? overrides.critical_policy
      : frozenCriticalPolicy,
    approval_manifest: approvalManifest,
    expected_approval_manifest_sha256: overrides.expected_approval_manifest_sha256
      || approvalManifest.sha256
  });
};

const sealScores = (overridesList) => {
  const drafts = overridesList.map((overrides) => score(overrides));
  const manifest = approvalForMap(Object.fromEntries(drafts.map((draft) => [
    draft.asset_id,
    draft.approval_manifest.computed_card_material_sha256
  ])));
  return overridesList.map((overrides) => score({
    ...overrides,
    approval_manifest: manifest,
    expected_approval_manifest_sha256: manifest.sha256
  }));
};

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
assert.equal(repairedFinish.recognition.exact_fact_satisfied_count, 1);
assert.deepEqual(repairedFinish.recognition.field_metrics.print_finish, {
  supported_count: 1,
  contradicted_count: 0,
  unresolved_count: 0,
  verified_claim_precision: 1,
  gold_fact_count: 1,
  satisfied_fact_count: 1,
  exact_fact_satisfied_count: 1,
  fact_recall: 1,
  exact_fact_recall: 1
});
assert.equal(repairedFinish.title.publishable, true);
assert.ok(repairedFinish.recognition.fact_recall > deletedFinish.recognition.fact_recall);

const staleCardMaterial = score({
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  approval_manifest: deletedFinish.approval_manifest
});
assert.equal(staleCardMaterial.approval_manifest.card_material_matches, false);
assert.equal(staleCardMaterial.eligible, false);

const titleWithoutCanonicalSource = score({
  annotations: [{
    field: "subject",
    concept_id: "subject:ohtani",
    value: "Shohei Ohtani",
    truth_status: "SUPPORTED",
    title_policy: "REQUIRED",
    adjudicated: true
  }],
  title_claims: [{ field: "subject", value: "Shohei Ohtani" }]
});
assert.deepEqual(titleWithoutCanonicalSource.title.unbacked_canonical_claim_keys,
  ["subject:subject:ohtani"]);
assert.equal(titleWithoutCanonicalSource.title.canonical_lineage_complete, false);
assert.equal(titleWithoutCanonicalSource.eligible, false);
assert.equal(titleWithoutCanonicalSource.title.publishable, null);

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
const requiredGold = score({
  annotations: [{
    field: "print_finish",
    concept_id: "finish:gold-refractor",
    value: "Gold Refractor",
    truth_status: "SUPPORTED",
    title_policy: "REQUIRED",
    recognition_required: true,
    adjudicated: true
  }],
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_claims: [{ field: "print_finish", value: "Refractor" }]
});
assert.equal(requiredGold.title.required_claim_recall, 0);
assert.equal(requiredGold.title.required_claim_missing_count, 1);
assert.deepEqual(requiredGold.title.required_field_metrics.print_finish, {
  required_claim_count: 1,
  required_claim_satisfied_count: 0,
  required_claim_missing_count: 1,
  required_claim_recall: 0
});
assert.equal(requiredGold.title.publishable, false);

// Critical errors and unreviewed claims always fail closed.
const criticalFalse = score({
  annotations: [
    {
      field: "subject",
      concept_id: "subject:ohtani",
      value: "Shohei Ohtani",
      truth_status: "SUPPORTED",
      title_policy: "REQUIRED",
      adjudicated: true
    },
    {
      field: "subject",
      concept_id: "subject:trout",
      value: "Mike Trout",
      truth_status: "CONTRADICTED",
      title_policy: "NOT_APPLICABLE",
      adjudicated: true
    }
  ],
  canonical_claims: [{ field: "subject", value: "Mike Trout" }],
  title_claims: [{ field: "subject", value: "Mike Trout" }]
});
assert.equal(criticalFalse.critical.false_claim_count, 1);
assert.equal(criticalFalse.critical.pass, false);
assert.equal(criticalFalse.title.publishable, false);

const incomplete = score({ annotation_complete: false });
assert.equal(incomplete.eligible, false);
assert.equal(incomplete.title.publishable, null);

const unapprovedPolicy = score({ critical_policy: null });
assert.equal(unapprovedPolicy.eligible, false);
assert.equal(unapprovedPolicy.title.publishable, null);

const tamperedPolicy = score({
  critical_policy: { ...frozenCriticalPolicy, fields: [...frozenCriticalPolicy.fields, "card_number"] }
});
assert.equal(tamperedPolicy.critical_policy.sha256_matches, false);
assert.equal(tamperedPolicy.eligible, false);

const blankFieldPolicy = {
  policy_id: "blank-field-policy",
  status: "FROZEN_APPROVED",
  fields: ["   "]
};
blankFieldPolicy.sha256 = criticalPolicySha256(blankFieldPolicy);
const blankPolicyScore = score({ critical_policy: blankFieldPolicy });
assert.equal(blankPolicyScore.critical_policy.frozen, false);
assert.equal(blankPolicyScore.eligible, false);

const unapprovedRegistry = score({ concept_registry: { concepts } });
assert.equal(unapprovedRegistry.eligible, false);
assert.equal(unapprovedRegistry.title.publishable, null);

const tamperedRegistry = score({
  concept_registry: {
    ...frozenConceptRegistry,
    concepts: [...concepts, { id: "finish:unreviewed", field: "print_finish", label: "Unreviewed" }]
  }
});
assert.equal(tamperedRegistry.concept_registry.sha256_matches, false);
assert.equal(tamperedRegistry.eligible, false);

const unexpectedApproval = score({ expected_approval_manifest_sha256: "d".repeat(64) });
assert.equal(unexpectedApproval.approval_manifest.expected_sha256_matches, false);
assert.equal(unexpectedApproval.eligible, false);

const draftApproval = {
  ...approvalManifestBase,
  status: "DRAFT",
  card_material_sha256_by_asset: deletedFinish.approval_manifest.card_material_sha256_by_asset
};
draftApproval.sha256 = rulerApprovalManifestSha256(draftApproval);
const forgedApprovalStatus = score({
  approval_manifest: { ...draftApproval, status: "SEALED_APPROVED" },
  expected_approval_manifest_sha256: draftApproval.sha256
});
assert.equal(forgedApprovalStatus.approval_manifest.sha256_matches, false);
assert.equal(forgedApprovalStatus.eligible, false);

assert.throws(() => score({
  annotation_provenance_defaults: false,
  annotations: [{
    field: "subject",
    value: "Shohei Ohtani",
    truth_status: "SUPPORTED",
    title_policy: "REQUIRED",
    adjudicated: true
  }]
}), /invalid_truth_source:empty/);

const redundantSynonym = score({
  canonical_claims: [{ field: "search_optimization", value: "Autograph" }],
  title_claims: [
    { field: "search_optimization", value: "Auto" },
    { field: "search_optimization", value: "Autograph" }
  ]
});
assert.deepEqual(redundantSynonym.title.duplicate_claim_keys, ["search_optimization:attribute:autograph"]);
assert.equal(redundantSynonym.title.redundancy_ok, false);
assert.equal(redundantSynonym.title.publishable, false);

const redundantHierarchy = score({
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_claims: [
    { field: "print_finish", value: "Gold Refractor" },
    { field: "print_finish", value: "Refractor" }
  ]
});
assert.equal(redundantHierarchy.title.redundant_claim_pairs[0].kind, "ANCESTOR_DESCENDANT");
assert.equal(redundantHierarchy.title.redundancy_ok, false);
assert.equal(redundantHierarchy.title.publishable, false);

assert.throws(() => score({
  canonical_claims: [{ field: "print_finish", concept_id: "finish:not-registered", value: "Unknown" }]
}), /unknown_concept_id/);
assert.throws(() => score({
  canonical_claims: [{ field: "subject", concept_id: "finish:refractor", value: "Refractor" }]
}), /concept_field_mismatch/);
assert.throws(() => score({
  canonical_claims: [{ field: "subject", concept_id: "subject:ohtani", value: "Mike Trout" }]
}), /concept_value_mismatch/);
assert.throws(() => score({
  canonical_claims: [{ field: "Subject", value: "Shohei Ohtani" }]
}), /unknown_csm_claim_field/);

const tracedGold = traceTitleClaims([{ field: "print_finish", value: "Gold Refractor" }]);
assert.throws(() => score({
  traced_title_claims: tracedGold.claims,
  title_text: "Blue Refractor"
}), /title_claim_span_text_mismatch/);

assert.throws(() => score({
  title_claims: [{
    field: "print_finish",
    value: "Gold Refractor",
    source_fields: ["year"]
  }]
}), /title_claim_source_field_mismatch/);

assert.throws(() => score({
  annotations: [
    {
      field: "subject",
      value: "Shohei Ohtani",
      truth_status: "SUPPORTED",
      title_policy: "OPTIONAL",
      adjudicated: true
    },
    {
      field: "card_name",
      value: "Shohei Ohtani",
      truth_status: "SUPPORTED",
      title_policy: "OPTIONAL",
      adjudicated: true
    }
  ],
  canonical_claims: [
    { field: "subject", value: "Shohei Ohtani" },
    { field: "card_name", value: "Shohei Ohtani" }
  ],
  traced_title_claims: [
    {
      field: "subject",
      value: "Shohei Ohtani",
      rendered_text: "Shohei Ohtani",
      title_spans: [{ start: 0, end: 13 }],
      source_fields: ["subject"],
      transform_codes: ["EXACT_OR_ALIAS"],
      emission_status: "FULL"
    },
    {
      field: "card_name",
      value: "Shohei Ohtani",
      rendered_text: "Shohei Ohtani",
      title_spans: [{ start: 0, end: 13 }],
      source_fields: ["card_name"],
      transform_codes: ["EXACT_OR_ALIAS"],
      emission_status: "FULL"
    }
  ],
  title_text: "Shohei Ohtani"
}), /overlapping_title_claim_spans/);

const unclaimedSemanticText = score({
  traced_title_claims: tracedGold.claims,
  title_text: `${tracedGold.title} Mike Trout`
});
assert.equal(unclaimedSemanticText.title.trace_complete, false);
assert.deepEqual(unclaimedSemanticText.title.unclaimed_semantic_fragments.map((entry) => entry.text),
  ["Mike", "Trout"]);
assert.equal(unclaimedSemanticText.eligible, false);

for (const semanticSymbol of ["★", "◆", "#", "/25"]) {
  const symbolLeak = score({
    traced_title_claims: tracedGold.claims,
    title_text: `${tracedGold.title} ${semanticSymbol}`
  });
  assert.equal(symbolLeak.title.trace_complete, false, `${semanticSymbol} must not bypass trace coverage`);
  assert.equal(symbolLeak.eligible, false);
}

const staleGrammarCertificate = score({
  title_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_constraints: constraintsFor("a different title")
});
assert.equal(staleGrammarCertificate.title.constraints_known, false);
assert.equal(staleGrammarCertificate.eligible, false);

const unapprovedGrammarImplementation = score({
  title_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_constraints: {
    ...constraintsFor("Gold Refractor"),
    grammar_checker_sha256: "f".repeat(64)
  }
});
assert.equal(unapprovedGrammarImplementation.approval_manifest.materials_match, false);
assert.equal(unapprovedGrammarImplementation.eligible, false);

const forbiddenAncestor = score({
  annotations: [{
    field: "print_finish",
    concept_id: "finish:gold-refractor",
    value: "Gold Refractor",
    truth_status: "SUPPORTED",
    title_policy: "FORBIDDEN",
    adjudicated: true
  }],
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }],
  title_claims: [{ field: "print_finish", value: "Refractor" }]
});
assert.equal(forbiddenAncestor.title.forbidden_claim_count, 1);
assert.equal(forbiddenAncestor.title.publishable, false);

const lotRender = score({
  annotations: [{
    field: "lot_quantity",
    value: "3",
    truth_status: "SUPPORTED",
    title_policy: "REQUIRED",
    adjudicated: true
  }],
  canonical_claims: [{ field: "lot_quantity", value: "3" }],
  title_claims: [{
    field: "lot_quantity",
    value: "3",
    rendered_text: "3 Card Lot",
    transform_codes: ["LOT_CARD_LOT"]
  }]
});
assert.equal(lotRender.title.required_claim_recall, 1);
assert.equal(lotRender.title.publishable, true);

const repeatedCorrectClaim = score({
  canonical_claims: [
    ...Array.from({ length: 10 }, () => ({ field: "print_finish", value: "Gold Refractor" })),
    { field: "print_finish", value: "Blue Refractor" }
  ]
});
assert.equal(repeatedCorrectClaim.recognition.input_claim_count, 11);
assert.equal(repeatedCorrectClaim.recognition.unique_claim_count, 2);
assert.equal(repeatedCorrectClaim.recognition.verified_claim_precision, 0.5,
  "repeating a true claim must not inflate precision");

assert.throws(() => score({ annotations: [...baseAnnotations, { ...baseAnnotations[0] }] }),
  /duplicate_annotation_key/);
assert.throws(() => score({
  annotations: [{
    field: "print_finish",
    value: "Gold Refractor",
    truth_status: "SUPPORTED",
    title_policy: "NOT_APPLICABLE",
    adjudicated: true
  }]
}), /supported_claim_requires_title_policy/);
assert.throws(() => score({
  annotations: [{
    field: "print_finish",
    value: "Blue Refractor",
    truth_status: "UNKNOWN",
    title_policy: "OPTIONAL",
    adjudicated: true
  }]
}), /unverified_claim_title_policy_must_be_not_applicable/);
assert.throws(() => score({
  annotations: [{
    field: "print_finish",
    value: "Gold Refractor",
    truth_status: "SUPPORTED",
    title_policy: "OPTIONAL",
    recognition_required: false,
    adjudicated: true
  }]
}), /supported_claim_cannot_leave_recognition_denominator/);

const parentAndLeafGold = score({
  annotations: [
    {
      field: "print_finish",
      concept_id: "finish:refractor",
      value: "Refractor",
      truth_status: "SUPPORTED",
      title_policy: "OPTIONAL",
      adjudicated: true
    },
    {
      field: "print_finish",
      concept_id: "finish:gold-refractor",
      value: "Gold Refractor",
      truth_status: "SUPPORTED",
      title_policy: "OPTIONAL",
      adjudicated: true
    }
  ],
  canonical_claims: [{ field: "print_finish", value: "Gold Refractor" }]
});
assert.equal(parentAndLeafGold.recognition.gold_fact_count, 1);
assert.equal(parentAndLeafGold.recognition.exact_fact_recall, 1);

assert.throws(() => score({
  annotations: [
    {
      field: "print_finish",
      concept_id: "finish:refractor",
      value: "Refractor",
      truth_status: "CONTRADICTED",
      title_policy: "NOT_APPLICABLE",
      adjudicated: true
    },
    {
      field: "print_finish",
      concept_id: "finish:gold-refractor",
      value: "Gold Refractor",
      truth_status: "SUPPORTED",
      title_policy: "OPTIONAL",
      adjudicated: true
    }
  ]
}), /inconsistent_hierarchical_truth/);

// With 105 cards, 101 passes are required for a 95% Wilson lower bound above
// 0.90. Zero critical errors on 105 cards still only bounds the population
// error rate below roughly 2.81% at 95% confidence.
assert.ok(wilsonInterval(100, 105).lower < 0.90);
assert.ok(wilsonInterval(101, 105).lower > 0.90);
assert.ok(Math.abs(zeroFailureUpperBound(105) - 0.0281276240) < 1e-9);
assert.equal(minimumZeroFailureSample(0.01), 299);
assert.equal(minimumZeroFailureSample(0.001), 2995);

const cohortOverrides = Array.from({ length: 105 }, (_, index) => ({
  asset_id: `promotion-asset-${index}`,
  physical_card_id: `promotion-physical-${index}`,
  canonical_claims: [{
    field: "print_finish",
    value: index < 101 ? "Gold Refractor" : "Blue Refractor"
  }],
  title_claims: [{
    field: "print_finish",
    value: index < 101 ? "Gold Refractor" : "Blue Refractor"
  }]
}));
const cohortCards = sealScores(cohortOverrides);
const cohortAssetIds = cohortCards.map((card) => card.asset_id);
const cohortPhysicalIds = Object.fromEntries(cohortCards
  .map((card) => [card.asset_id, card.physical_card_id]));
const cohort = summariseSemanticPublicationCohort(cohortCards, {
  expected_asset_ids: cohortAssetIds,
  expected_physical_card_id_by_asset: cohortPhysicalIds
});
assert.equal(cohort.cohort_eligible, true);
assert.equal(cohort.promotion_decision, null);
assert.deepEqual(cohort.promotion_blockers, ["stage_c_paired_driver_gate_not_implemented"]);
assert.equal(cohort.publishable_cards, 101);
assert.equal(cohort.critical_false_cards, 0, "wrong non-critical finish blocks publishability without becoming a critical error");
assert.equal(cohort.critical_unresolved_cards, 0);
assert.ok(cohort.publishable_card_rate_wilson_95.lower > 0.90);

const criticalCohortForPromotion = summariseSemanticPublicationCohort([criticalFalse], {
  expected_asset_ids: [criticalFalse.asset_id],
  expected_physical_card_id_by_asset: { [criticalFalse.asset_id]: criticalFalse.physical_card_id }
});
assert.equal(criticalCohortForPromotion.critical_blocked_cards, 1);
assert.equal(criticalCohortForPromotion.critical_false_cards, 1);
assert.equal(criticalCohortForPromotion.critical_required_missed_cards, 1);

const selectivelyIneligibleCards = sealScores([
  ...cohortOverrides.slice(0, 101),
  ...Array.from({ length: 4 }, (_, index) => ({
    asset_id: `ineligible-asset-${index}`,
    physical_card_id: `ineligible-physical-${index}`,
    annotation_complete: false
  }))
]);
const selectivelyIneligible = summariseSemanticPublicationCohort(selectivelyIneligibleCards, {
  expected_asset_ids: [
    ...cohortAssetIds.slice(0, 101),
    ...Array.from({ length: 4 }, (_, index) => `ineligible-asset-${index}`)
  ],
  expected_physical_card_id_by_asset: {
    ...Object.fromEntries(cohortCards.slice(0, 101).map((card) => [card.asset_id, card.physical_card_id])),
    ...Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
      `ineligible-asset-${index}`,
      `ineligible-physical-${index}`
    ]))
  }
});
assert.equal(selectivelyIneligible.cohort_eligible, false);
assert.equal(selectivelyIneligible.publishable_card_rate, null);
assert.equal(selectivelyIneligible.publishable_card_rate_wilson_95, null);

const duplicatedEasyCard = summariseSemanticPublicationCohort(
  Array.from({ length: 105 }, () => repairedFinish),
  {
    expected_asset_ids: cohortAssetIds,
    expected_physical_card_id_by_asset: cohortPhysicalIds
  }
);
assert.equal(duplicatedEasyCard.asset_ids_unique, false);
assert.equal(duplicatedEasyCard.cohort_eligible, false);
assert.equal(duplicatedEasyCard.publishable_card_rate, null);

const individuallySignedCards = cohortOverrides.map((overrides) => score(overrides));
const individuallySigned = summariseSemanticPublicationCohort(individuallySignedCards, {
  expected_asset_ids: cohortAssetIds,
  expected_physical_card_id_by_asset: cohortPhysicalIds
});
assert.equal(individuallySigned.one_approval_manifest, false);
assert.equal(individuallySigned.cohort_eligible, false);

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
