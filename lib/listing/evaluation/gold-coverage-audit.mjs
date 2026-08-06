import { createConceptIndex, prepareClaimIdentity } from "./semantic-publication-concepts.mjs";
import { prepareClaimEvidence } from "./semantic-publication-contract.mjs";
import { inspectConceptRegistry, inspectCriticalPolicy } from "./semantic-publication-material-validator.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// Evaluation fail-closed allowlist only. It cannot become production authority;
// replace it when CSM/SEM exports a formal grammar enum.
const COVERAGE_GRAMMARS = new Set(["STANDARD", "TCG", "LOT"]);

function supportedClaims(card = {}, { requireAdjudicated = false } = {}) {
  return (card.claims || card.annotations || []).filter((claim) =>
    (!requireAdjudicated || claim.adjudicated === true)
    && (requireAdjudicated
      ? claim.truth_status === "SUPPORTED"
      : (!claim.truth_status || claim.truth_status === "SUPPORTED")));
}

function uniqueClaims(claims, index, label, { requireEvidence = false } = {}) {
  const prepared = [];
  const seen = new Set();
  for (const claim of claims) {
    const identity = prepareClaimIdentity(claim, index, {
      identity_error: "coverage_claim_field_and_identity_required"
    });
    if (requireEvidence) prepareClaimEvidence(claim);
    if (seen.has(identity.key)) throw new Error(`duplicate_coverage_claim_key:${label}:${identity.key}`);
    seen.add(identity.key);
    prepared.push({ key: identity.key, claim: identity });
  }
  return prepared;
}

export function auditGoldCoverage({
  constructed_gold_cards = [],
  unrestricted_transcription_cards = [],
  critical_policy = null,
  expected_critical_policy_sha256 = null,
  concept_registry = null,
  expected_concept_registry_sha256 = null,
  expected_asset_ids = [],
  minimum_cards = 20,
  minimum_exact_coverage = 0.95,
  minimum_per_card_coverage = 0.80
} = {}) {
  const criticalPolicy = inspectCriticalPolicy(critical_policy);
  const conceptRegistry = inspectConceptRegistry(concept_registry);
  const conceptIndex = createConceptIndex(conceptRegistry.concepts);
  const expectedCriticalPolicyMatches = /^[a-f0-9]{64}$/i.test(clean(expected_critical_policy_sha256))
    && clean(expected_critical_policy_sha256) === criticalPolicy.sha256;
  const expectedConceptRegistryMatches = /^[a-f0-9]{64}$/i.test(clean(expected_concept_registry_sha256))
    && clean(expected_concept_registry_sha256) === conceptRegistry.sha256;
  const normalizedExpectedAssetIds = expected_asset_ids.map(clean).filter(Boolean);
  if (new Set(normalizedExpectedAssetIds).size !== normalizedExpectedAssetIds.length) {
    throw new Error("duplicate_expected_coverage_asset_id");
  }
  const constructed = new Map();
  for (const card of constructed_gold_cards) {
    const assetId = clean(card.asset_id);
    if (!assetId) throw new Error("constructed_gold_asset_id_required");
    if (constructed.has(assetId)) throw new Error(`duplicate_constructed_gold_asset_id:${assetId}`);
    constructed.set(assetId, card);
  }
  const critical = new Set(criticalPolicy.fields);
  const cards = [];
  const auditedAssetIds = new Set();
  const auditedPhysicalCardIds = new Set();
  const missingByField = {};
  const missingByGrammar = {};

  for (const transcriptCard of unrestricted_transcription_cards) {
    const assetId = clean(transcriptCard.asset_id);
    if (!assetId) throw new Error("coverage_asset_id_required");
    if (auditedAssetIds.has(assetId)) throw new Error(`duplicate_transcription_asset_id:${assetId}`);
    auditedAssetIds.add(assetId);
    const goldCard = constructed.get(assetId);
    if (!goldCard) throw new Error(`constructed_gold_card_missing:${assetId}`);
    const physicalCardId = clean(transcriptCard.physical_card_id);
    const goldPhysicalCardId = clean(goldCard.physical_card_id);
    const physicalCardMatches = Boolean(physicalCardId) && physicalCardId === goldPhysicalCardId;
    const physicalCardUnique = Boolean(physicalCardId) && !auditedPhysicalCardIds.has(physicalCardId);
    if (physicalCardId) auditedPhysicalCardIds.add(physicalCardId);
    const grammar = clean(transcriptCard.grammar);
    const grammarMatches = COVERAGE_GRAMMARS.has(grammar) && grammar === clean(goldCard.grammar);
    const transcript = uniqueClaims(supportedClaims(transcriptCard), conceptIndex, `transcript:${assetId}`);
    const goldKeys = new Set(uniqueClaims(
      supportedClaims(goldCard, { requireAdjudicated: true }),
      conceptIndex,
      `gold:${assetId}`,
      { requireEvidence: true }
    )
      .map((entry) => entry.key));
    const missing = transcript.filter((entry) => !goldKeys.has(entry.key));
    const criticalTranscript = transcript.filter((entry) => critical.has(clean(entry.claim.field)));
    const criticalMissing = criticalTranscript.filter((entry) => !goldKeys.has(entry.key));
    for (const entry of missing) {
      const field = clean(entry.claim.field);
      missingByField[field] = (missingByField[field] || 0) + 1;
      const grammarKey = grammar || "MISSING";
      missingByGrammar[grammarKey] = (missingByGrammar[grammarKey] || 0) + 1;
    }
    cards.push({
      asset_id: assetId,
      physical_card_id: physicalCardId || null,
      physical_card_matches: physicalCardMatches,
      physical_card_unique: physicalCardUnique,
      grammar: grammar || null,
      grammar_matches: grammarMatches,
      transcript_claims: transcript.length,
      captured_claims: transcript.length - missing.length,
      exact_coverage: transcript.length ? (transcript.length - missing.length) / transcript.length : null,
      critical_claims: criticalTranscript.length,
      critical_captured_claims: criticalTranscript.length - criticalMissing.length,
      missing_claim_keys: missing.map((entry) => entry.key),
      missing_critical_claim_keys: criticalMissing.map((entry) => entry.key)
    });
  }

  const transcriptClaims = cards.reduce((sum, card) => sum + card.transcript_claims, 0);
  const capturedClaims = cards.reduce((sum, card) => sum + card.captured_claims, 0);
  const criticalClaims = cards.reduce((sum, card) => sum + card.critical_claims, 0);
  const criticalCaptured = cards.reduce((sum, card) => sum + card.critical_captured_claims, 0);
  const exactCoverage = transcriptClaims ? capturedClaims / transcriptClaims : null;
  const decidedCardCoverage = cards.map((card) => card.exact_coverage).filter(Number.isFinite);
  const macroCardCoverage = decidedCardCoverage.length
    ? decidedCardCoverage.reduce((sum, value) => sum + value, 0) / decidedCardCoverage.length
    : null;
  const lowestCardCoverage = decidedCardCoverage.length ? Math.min(...decidedCardCoverage) : null;
  const criticalCoverage = criticalClaims ? criticalCaptured / criticalClaims : null;
  const allTranscriptionsNonempty = cards.length > 0 && decidedCardCoverage.length === cards.length;
  const physicalCardsValid = cards.length > 0
    && cards.every((card) => card.physical_card_matches && card.physical_card_unique);
  const grammarsValid = cards.length > 0 && cards.every((card) => card.grammar_matches);
  const expectedAssetsMatch = normalizedExpectedAssetIds.length >= minimum_cards
    && normalizedExpectedAssetIds.length === cards.length
    && normalizedExpectedAssetIds.every((assetId) => auditedAssetIds.has(assetId));
  const gatePass = cards.length >= minimum_cards
    && allTranscriptionsNonempty
    && expectedAssetsMatch
    && exactCoverage >= minimum_exact_coverage
    && macroCardCoverage >= minimum_exact_coverage
    && lowestCardCoverage >= minimum_per_card_coverage
    && criticalClaims > 0
    && criticalCoverage === 1
    && criticalPolicy.frozen
    && expectedCriticalPolicyMatches
    && conceptRegistry.frozen
    && expectedConceptRegistryMatches
    && physicalCardsValid
    && grammarsValid;

  return {
    schema_version: "gold-coverage-audit-v1",
    critical_policy: criticalPolicy,
    expected_critical_policy_sha256: clean(expected_critical_policy_sha256) || null,
    expected_critical_policy_sha256_matches: expectedCriticalPolicyMatches,
    concept_registry: conceptRegistry,
    expected_concept_registry_sha256: clean(expected_concept_registry_sha256) || null,
    expected_concept_registry_sha256_matches: expectedConceptRegistryMatches,
    expected_asset_ids: normalizedExpectedAssetIds,
    expected_assets_match: expectedAssetsMatch,
    all_transcriptions_nonempty: allTranscriptionsNonempty,
    physical_cards_valid: physicalCardsValid,
    grammars_valid: grammarsValid,
    empty_transcription_asset_ids: cards.filter((card) => card.transcript_claims === 0)
      .map((card) => card.asset_id),
    audit_cards: cards.length,
    transcript_claims: transcriptClaims,
    captured_claims: capturedClaims,
    exact_claim_coverage: exactCoverage,
    macro_card_exact_coverage: macroCardCoverage,
    lowest_card_exact_coverage: lowestCardCoverage,
    critical_claims: criticalClaims,
    critical_captured_claims: criticalCaptured,
    critical_exact_claim_coverage: criticalCoverage,
    missing_by_field: missingByField,
    missing_by_grammar: missingByGrammar,
    thresholds: {
      minimum_cards,
      minimum_exact_coverage,
      minimum_per_card_coverage,
      critical_exact_coverage: 1
    },
    gate_pass: gatePass,
    cards
  };
}
