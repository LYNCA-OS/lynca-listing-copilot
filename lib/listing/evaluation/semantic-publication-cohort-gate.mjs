import { clean, RULER_VERSION } from "./semantic-publication-contract.mjs";

const safeRatio = (numerator, denominator) => denominator ? numerator / denominator : null;
const mean = (values) => {
  const decided = values.filter((value) => Number.isFinite(value));
  return decided.length ? decided.reduce((sum, value) => sum + value, 0) / decided.length : null;
};

export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(total)
    || successes < 0 || total <= 0 || successes > total) {
    throw new Error("invalid_binomial_counts");
  }
  const proportion = successes / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (proportion + (z ** 2) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) / total)
    + (z ** 2) / (4 * total ** 2)) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

export function zeroFailureUpperBound(total, alpha = 0.05) {
  if (!Number.isInteger(total) || total <= 0 || !(alpha > 0 && alpha < 1)) {
    throw new Error("invalid_zero_failure_input");
  }
  return 1 - alpha ** (1 / total);
}

export function minimumZeroFailureSample(targetRate, alpha = 0.05) {
  if (!(targetRate > 0 && targetRate < 1) || !(alpha > 0 && alpha < 1)) {
    throw new Error("invalid_zero_failure_target");
  }
  return Math.ceil(Math.log(alpha) / Math.log(1 - targetRate));
}

export function summariseSemanticPublicationCohort(cards = [], {
  expected_asset_ids = [],
  expected_physical_card_id_by_asset = {}
} = {}) {
  const eligible = cards.filter((card) => card?.eligible);
  const publishable = eligible.filter((card) => card.title.publishable === true).length;
  const criticalPass = eligible.filter((card) => card.critical.pass === true).length;
  const criticalFalse = eligible.filter((card) => card.critical.false_claim_count > 0).length;
  const criticalUnresolved = eligible.filter((card) => card.critical.unresolved_claim_count > 0).length;
  const criticalRequiredMissed = eligible.filter((card) => card.critical.required_missed_count > 0).length;
  const expectedAssetIds = expected_asset_ids.map(clean).filter(Boolean);
  if (new Set(expectedAssetIds).size !== expectedAssetIds.length) throw new Error("duplicate_expected_asset_id");
  const observedAssetIds = cards.map((card) => clean(card?.asset_id)).filter(Boolean);
  const observedPhysicalCardIds = cards.map((card) => clean(card?.physical_card_id)).filter(Boolean);
  const expectedPhysicalIds = expectedAssetIds.map((assetId) => clean(expected_physical_card_id_by_asset[assetId]));
  const assetIdsUnique = observedAssetIds.length === cards.length
    && new Set(observedAssetIds).size === cards.length;
  const physicalCardIdsUnique = observedPhysicalCardIds.length === cards.length
    && new Set(observedPhysicalCardIds).size === cards.length;
  const expectedAssetsMatch = expectedAssetIds.length > 0
    && expectedAssetIds.length === cards.length
    && expectedAssetIds.every((assetId) => observedAssetIds.includes(assetId));
  const expectedPhysicalCardsMatch = expectedPhysicalIds.every(Boolean)
    && new Set(expectedPhysicalIds).size === expectedAssetIds.length
    && cards.every((card) => clean(expected_physical_card_id_by_asset[clean(card?.asset_id)])
      === clean(card?.physical_card_id));
  const approvalManifestShas = cards.map((card) => clean(card?.approval_manifest?.sha256)).filter(Boolean);
  const oneApprovalManifest = approvalManifestShas.length === cards.length
    && new Set(approvalManifestShas).size === 1
    && cards.every((card) => card?.approval_manifest?.expected_sha256_matches === true);
  const manifestAssetIds = oneApprovalManifest
    ? Object.keys(cards[0].approval_manifest.card_material_sha256_by_asset || {})
    : [];
  const manifestCohortMatches = oneApprovalManifest
    && manifestAssetIds.length === expectedAssetIds.length
    && manifestAssetIds.every((assetId) => expectedAssetIds.includes(assetId));
  const cohortEligible = expectedAssetsMatch
    && expectedPhysicalCardsMatch
    && assetIdsUnique
    && physicalCardIdsUnique
    && manifestCohortMatches
    && eligible.length === cards.length;
  return {
    schema_version: RULER_VERSION,
    cards: cards.length,
    eligible_cards: eligible.length,
    ineligible_cards: cards.length - eligible.length,
    expected_cards: expectedAssetIds.length || null,
    expected_assets_match: expectedAssetsMatch,
    expected_physical_cards_match: expectedPhysicalCardsMatch,
    asset_ids_unique: assetIdsUnique,
    physical_card_ids_unique: physicalCardIdsUnique,
    approval_manifest_sha256: oneApprovalManifest ? approvalManifestShas[0] : null,
    one_approval_manifest: oneApprovalManifest,
    manifest_cohort_matches: manifestCohortMatches,
    cohort_eligible: cohortEligible,
    promotion_decision: null,
    promotion_blockers: cohortEligible
      ? ["stage_c_paired_driver_gate_not_implemented"]
      : ["cohort_materials_ineligible"],
    publishable_cards: publishable,
    publishable_card_rate: cohortEligible ? publishable / expectedAssetIds.length : null,
    publishable_card_rate_wilson_95: cohortEligible
      ? wilsonInterval(publishable, expectedAssetIds.length)
      : null,
    publishable_card_rate_among_eligible: safeRatio(publishable, eligible.length),
    critical_pass_cards: criticalPass,
    critical_blocked_cards: eligible.length - criticalPass,
    critical_false_cards: criticalFalse,
    critical_unresolved_cards: criticalUnresolved,
    critical_required_missed_cards: criticalRequiredMissed,
    critical_false_card_rate: safeRatio(criticalFalse, eligible.length),
    macro_recognition_fact_recall: mean(eligible.map((card) => card.recognition.fact_recall)),
    macro_recognition_exact_fact_recall: mean(eligible.map((card) => card.recognition.exact_fact_recall)),
    macro_recognition_verified_precision: mean(eligible.map((card) => card.recognition.verified_claim_precision)),
    macro_title_required_recall: mean(eligible.map((card) => card.title.required_claim_recall))
  };
}
