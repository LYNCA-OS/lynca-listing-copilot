// Evaluation-only evidence ruler.
//
// Independent adjudicated typed gold and diagnostic proxies are deliberately
// separated. A reviewed marketplace title can show trend, and a source-backed
// diff can catch regressions, but neither is card truth and neither can prove
// that accuracy reached a production threshold.

import {
  RULER_CLAIM_FIELDS,
  RULER_VERSION
} from "./semantic-publication-contract.mjs";
import {
  inspectApprovalManifest,
  inspectCriticalPolicy
} from "./semantic-publication-material-validator.mjs";
import { summariseSemanticPublicationCohort } from "./semantic-publication-cohort-gate.mjs";

export const TYPED_ACCURACY_EVIDENCE_RULER_VERSION = "typed-accuracy-evidence-ruler-v1";

const EPSILON = 1e-12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const safeRatio = (numerator, denominator) => denominator ? numerator / denominator : null;
const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;
const difference = (left, right) => [...left].filter((value) => !right.has(value));

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(canonicalValue(left ?? null)) === JSON.stringify(canonicalValue(right ?? null));
}

function titleTokens(value) {
  return new Set(clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:\/[a-z0-9]+)*/g) || []);
}

function normalizedNumericClaim(value) {
  const text = clean(value).toLowerCase();
  const fraction = text.match(/^(\d{1,6})\/(\d{1,6})$/);
  if (fraction) return `${Number(fraction[1])}/${Number(fraction[2])}`;
  const decimal = text.match(/^\d+(?:\.\d+)?$/);
  return decimal ? String(Number(text)) : text;
}

function numericClaims(value) {
  const claims = clean(value).toLowerCase().match(
    /(?<![a-z0-9])(?:\d{1,6}\/\d{1,6}|\d+(?:\.\d+)?|(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+)(?![a-z0-9])/g
  ) || [];
  return new Set(claims.map(normalizedNumericClaim));
}

function titleF1(reference, title) {
  const wanted = titleTokens(reference);
  const actual = titleTokens(title);
  const hits = [...wanted].filter((token) => actual.has(token)).length;
  const recall = safeRatio(hits, wanted.size) ?? 0;
  const precision = safeRatio(hits, actual.size) ?? 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
}

function flattenEvidence(value) {
  if (Array.isArray(value)) return value.flatMap(flattenEvidence);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenEvidence);
  return clean(value) ? [clean(value)] : [];
}

function fieldDifferences(left, right) {
  if (!left || typeof left !== "object" || Array.isArray(left)
      || !right || typeof right !== "object" || Array.isArray(right)) return null;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .filter((field) => !sameValue(left[field], right[field]));
}

function dropLedger(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return { dropped_for_budget: [...value], suppressed_by_profile: [],
    truncated: false };
  if (typeof value !== "object") throw new Error("typed_ruler_drop_ledger_invalid");
  const dropped = value.dropped_for_budget ?? value.dropped_brackets ?? value.dropped;
  const suppressed = value.suppressed_by_profile ?? value.suppressed_brackets ?? [];
  if (!Array.isArray(dropped) || !Array.isArray(suppressed)) {
    throw new Error("typed_ruler_drop_ledger_invalid");
  }
  return {
    dropped_for_budget: [...new Set(dropped.map(clean).filter(Boolean))].sort(),
    suppressed_by_profile: [...new Set(suppressed.map(clean).filter(Boolean))].sort(),
    truncated: value.truncated === true
  };
}

function explicitArray(object, key) {
  if (!object || !Object.hasOwn(object, key)) return null;
  if (!Array.isArray(object[key])) throw new Error(`typed_ruler_safety_array_invalid:${key}`);
  return object[key].map(clean).filter(Boolean);
}

function inspectPairedCard(card) {
  const assetId = clean(card?.asset_id);
  if (!assetId) throw new Error("typed_ruler_asset_id_required");
  const baselineTitle = clean(card.baseline_title);
  const renderedCandidateTitle = String(card.candidate_title ?? "");
  const candidateTitle = clean(card.candidate_title);
  if (!baselineTitle || !candidateTitle) throw new Error(`typed_ruler_titles_required:${assetId}`);
  const over80 = renderedCandidateTitle.length > 80;
  if (card.safety && Object.hasOwn(card.safety, "over_80")) {
    if (typeof card.safety.over_80 !== "boolean") {
      throw new Error(`typed_ruler_over_80_invalid:${assetId}`);
    }
    if (card.safety.over_80 !== over80) {
      throw new Error(`typed_ruler_over_80_mismatch:${assetId}`);
    }
  }
  const referenceTitle = clean(card.reference_title);
  const baselineTokens = titleTokens(baselineTitle);
  const candidateTokens = titleTokens(candidateTitle);
  const referenceTokens = titleTokens(referenceTitle);
  const sourceTokens = titleTokens(flattenEvidence(card.source_evidence).join(" "));
  const explicitReferenceLosses = explicitArray(card.safety, "reference_losses");
  const explicitUnbacked = explicitArray(card.safety, "unbacked_new_tokens");
  const explicitNumeric = explicitArray(card.safety, "unsupported_numeric_changes");
  const referenceLosses = explicitReferenceLosses ?? (referenceTitle
    ? difference(baselineTokens, candidateTokens).filter((token) => referenceTokens.has(token))
    : null);
  const unbackedNewTokens = explicitUnbacked ?? (sourceTokens.size
    ? difference(candidateTokens, baselineTokens).filter((token) => !sourceTokens.has(token))
    : null);
  const baselineNumbers = numericClaims(baselineTitle);
  const candidateNumbers = numericClaims(candidateTitle);
  const numericMutations = explicitNumeric ?? [
    ...difference(baselineNumbers, candidateNumbers),
    ...difference(candidateNumbers, baselineNumbers)
  ];
  const changedFields = fieldDifferences(card.baseline_fields, card.candidate_fields);
  const baselineDrop = dropLedger(card.baseline_drop_ledger);
  const candidateDrop = dropLedger(card.candidate_drop_ledger);
  const newDrops = baselineDrop && candidateDrop
    ? candidateDrop.dropped_for_budget.filter((field) =>
      !baselineDrop.dropped_for_budget.includes(field))
    : null;
  const baselineF1 = referenceTitle ? titleF1(referenceTitle, baselineTitle) : null;
  const candidateF1 = referenceTitle ? titleF1(referenceTitle, candidateTitle) : null;
  return {
    asset_id: assetId,
    reference_available: Boolean(referenceTitle),
    baseline_f1: baselineF1,
    candidate_f1: candidateF1,
    delta_f1: baselineF1 === null ? null : candidateF1 - baselineF1,
    critical_error_proxy: typeof card.safety?.critical === "boolean"
      ? card.safety.critical : null,
    reference_loss_tokens: referenceLosses,
    unbacked_new_tokens: unbackedNewTokens,
    numeric_mutations: numericMutations,
    over_80: over80,
    exact_field_fidelity: changedFields === null ? null : changedFields.length === 0,
    changed_fields: changedFields,
    drop_ledger_available: Boolean(candidateDrop),
    candidate_dropped_for_budget: candidateDrop?.dropped_for_budget ?? null,
    new_dropped_for_budget: newDrops,
    truncated: candidateDrop?.truncated ?? null
  };
}

function metric(value, evidenceClass, availability, note) {
  return { value, evidence_class: evidenceClass, availability, note };
}

function receiptError(reason, assetId = "cohort") {
  throw new Error(`typed_ruler_spg_receipt_invalid:${reason}:${assetId}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertReceipt(condition, reason, assetId) {
  if (!condition) receiptError(reason, assetId);
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function ratioMatches(value, numerator, denominator) {
  const expected = safeRatio(numerator, denominator);
  return expected === null ? value === null
    : Number.isFinite(value) && Math.abs(value - expected) <= EPSILON;
}

function validateClaimSurface(surface, label, assetId) {
  assertReceipt(isRecord(surface), `${label}_missing`, assetId);
  const countKeys = [
    "supported_count",
    "supported_exact_count",
    "supported_generalized_count",
    "contradicted_count",
    "unresolved_count",
    "input_claim_count",
    "unique_claim_count"
  ];
  for (const key of countKeys) {
    assertReceipt(nonnegativeInteger(surface[key]), `${label}_${key}`, assetId);
  }
  assertReceipt(Array.isArray(surface.classified), `${label}_classified`, assetId);
  assertReceipt(Array.isArray(surface.duplicate_claim_keys), `${label}_duplicate_claim_keys`, assetId);
  const states = surface.classified.map((entry) => clean(entry?.state));
  assertReceipt(states.every((state) => [
    "SUPPORTED_EXACT",
    "SUPPORTED_GENERALIZED",
    "CONTRADICTED",
    "UNRESOLVED"
  ].includes(state)), `${label}_classified_state`, assetId);
  assertReceipt(surface.classified.every((entry) => isRecord(entry?.prediction)
    && clean(entry.prediction.key)
    && RULER_CLAIM_FIELDS.has(clean(entry.prediction.field))),
  `${label}_classified_prediction`, assetId);
  const supportedExact = states.filter((state) => state === "SUPPORTED_EXACT").length;
  const supportedGeneralized = states.filter((state) => state === "SUPPORTED_GENERALIZED").length;
  const contradicted = states.filter((state) => state === "CONTRADICTED").length;
  const unresolved = states.filter((state) => state === "UNRESOLVED").length;
  assertReceipt(surface.supported_exact_count === supportedExact
    && surface.supported_generalized_count === supportedGeneralized
    && surface.supported_count === supportedExact + supportedGeneralized
    && surface.contradicted_count === contradicted
    && surface.unresolved_count === unresolved
    && surface.unique_claim_count === surface.classified.length
    && surface.input_claim_count >= surface.unique_claim_count,
  `${label}_classified_counts`, assetId);
  assertReceipt(ratioMatches(surface.verified_claim_precision, surface.supported_count,
    surface.supported_count + surface.contradicted_count), `${label}_precision`, assetId);
  assertReceipt(ratioMatches(surface.unresolved_claim_rate, surface.unresolved_count,
    surface.classified.length), `${label}_unresolved_rate`, assetId);
}

function validateRecognition(recognition, assetId) {
  validateClaimSurface(recognition, "recognition", assetId);
  for (const key of [
    "gold_fact_count",
    "satisfied_fact_count",
    "exact_fact_satisfied_count"
  ]) {
    assertReceipt(nonnegativeInteger(recognition[key]), `recognition_${key}`, assetId);
  }
  assertReceipt(recognition.exact_fact_satisfied_count <= recognition.satisfied_fact_count
    && recognition.satisfied_fact_count <= recognition.gold_fact_count,
  "recognition_fact_count_order", assetId);
  assertReceipt(ratioMatches(recognition.fact_recall, recognition.satisfied_fact_count,
    recognition.gold_fact_count), "recognition_fact_recall", assetId);
  assertReceipt(ratioMatches(recognition.exact_fact_recall,
    recognition.exact_fact_satisfied_count, recognition.gold_fact_count),
  "recognition_exact_fact_recall", assetId);
  assertReceipt(isRecord(recognition.field_metrics), "recognition_field_metrics", assetId);
  const totals = {
    supported_count: 0,
    contradicted_count: 0,
    unresolved_count: 0,
    gold_fact_count: 0,
    satisfied_fact_count: 0,
    exact_fact_satisfied_count: 0
  };
  for (const [field, row] of Object.entries(recognition.field_metrics)) {
    assertReceipt(RULER_CLAIM_FIELDS.has(field) && isRecord(row),
      "recognition_field_metric_invalid", assetId);
    for (const key of Object.keys(totals)) {
      assertReceipt(nonnegativeInteger(row[key]), `recognition_field_${key}`, assetId);
      totals[key] += row[key];
    }
    assertReceipt(row.exact_fact_satisfied_count <= row.satisfied_fact_count
      && row.satisfied_fact_count <= row.gold_fact_count,
    "recognition_field_fact_count_order", assetId);
    assertReceipt(ratioMatches(row.verified_claim_precision, row.supported_count,
      row.supported_count + row.contradicted_count),
    "recognition_field_precision", assetId);
    assertReceipt(ratioMatches(row.fact_recall, row.satisfied_fact_count, row.gold_fact_count)
      && ratioMatches(row.exact_fact_recall, row.exact_fact_satisfied_count, row.gold_fact_count),
    "recognition_field_recall", assetId);
  }
  for (const [key, value] of Object.entries(totals)) {
    assertReceipt(recognition[key] === value, `recognition_field_total_${key}`, assetId);
  }
}

function validateTitle(title, assetId) {
  validateClaimSurface(title, "title", assetId);
  for (const key of [
    "required_claim_count",
    "required_claim_satisfied_count",
    "required_claim_missing_count",
    "forbidden_claim_count",
    "rendered_length"
  ]) {
    assertReceipt(nonnegativeInteger(title[key]), `title_${key}`, assetId);
  }
  assertReceipt(title.required_claim_satisfied_count + title.required_claim_missing_count
    === title.required_claim_count, "title_required_claim_counts", assetId);
  assertReceipt(ratioMatches(title.required_claim_recall, title.required_claim_satisfied_count,
    title.required_claim_count), "title_required_claim_recall", assetId);
  assertReceipt(isRecord(title.required_field_metrics), "title_required_field_metrics", assetId);
  const totals = { required_claim_count: 0, required_claim_satisfied_count: 0,
    required_claim_missing_count: 0 };
  for (const [field, row] of Object.entries(title.required_field_metrics)) {
    assertReceipt(RULER_CLAIM_FIELDS.has(field) && isRecord(row),
      "title_required_field_metric_invalid", assetId);
    for (const key of Object.keys(totals)) {
      assertReceipt(nonnegativeInteger(row[key]), `title_required_field_${key}`, assetId);
      totals[key] += row[key];
    }
    assertReceipt(row.required_claim_satisfied_count + row.required_claim_missing_count
      === row.required_claim_count, "title_required_field_counts", assetId);
    assertReceipt(ratioMatches(row.required_claim_recall, row.required_claim_satisfied_count,
      row.required_claim_count), "title_required_field_recall", assetId);
  }
  for (const [key, value] of Object.entries(totals)) {
    assertReceipt(title[key] === value, `title_required_field_total_${key}`, assetId);
  }
  for (const key of [
    "redundancy_ok",
    "trace_complete",
    "canonical_lineage_complete",
    "constraints_known",
    "constraints_pass",
    "length_ok",
    "grammar_ok",
    "publishable"
  ]) {
    assertReceipt(typeof title[key] === "boolean", `title_${key}`, assetId);
  }
  assertReceipt(SHA256_PATTERN.test(clean(title.title_text_sha256)),
    "title_text_sha256", assetId);
  for (const key of [
    "grammar_violation_codes",
    "unclaimed_semantic_fragments",
    "unbacked_canonical_claim_keys",
    "redundant_claim_pairs"
  ]) {
    assertReceipt(Array.isArray(title[key]), `title_${key}`, assetId);
  }
}

function validateSemanticPublicationCardReceipt(card) {
  const assetId = clean(card?.asset_id) || "unknown";
  assertReceipt(card?.schema_version === RULER_VERSION, "schema_version", assetId);
  assertReceipt(clean(card.asset_id) && clean(card.physical_card_id), "card_identity", assetId);
  assertReceipt(card.eligible === true, "eligible", assetId);

  const approval = inspectApprovalManifest(card.approval_manifest);
  assertReceipt(approval.frozen && card.approval_manifest?.frozen === true
    && card.approval_manifest?.sha256_matches === true
    && card.approval_manifest?.expected_sha256_matches === true
    && clean(card.approval_manifest?.expected_sha256) === approval.sha256,
  "approval_manifest", assetId);
  const expectedMaterial = clean(card.approval_manifest?.expected_card_material_sha256);
  const computedMaterial = clean(card.approval_manifest?.computed_card_material_sha256);
  assertReceipt(SHA256_PATTERN.test(expectedMaterial)
    && expectedMaterial === computedMaterial
    && approval.card_material_sha256_by_asset[assetId] === computedMaterial
    && card.approval_manifest?.asset_id === assetId
    && card.approval_manifest?.card_material_matches === true
    && card.approval_manifest?.materials_match === true,
  "card_material", assetId);

  const criticalPolicy = inspectCriticalPolicy(card.critical_policy);
  assertReceipt(criticalPolicy.frozen && card.critical_policy?.frozen === true
    && card.critical_policy?.sha256_matches === true
    && approval.critical_policy_sha256 === criticalPolicy.sha256,
  "critical_policy", assetId);
  const registry = card.concept_registry;
  assertReceipt(isRecord(registry)
    && clean(registry.registry_id)
    && registry.status === "FROZEN_APPROVED"
    && SHA256_PATTERN.test(clean(registry.sha256))
    && registry.sha256 === registry.computed_sha256
    && registry.sha256_matches === true
    && registry.frozen === true
    && approval.concept_registry_sha256 === registry.sha256,
  "concept_registry", assetId);

  validateRecognition(card.recognition, assetId);
  validateTitle(card.title, assetId);
  assertReceipt(isRecord(card.critical), "critical", assetId);
  for (const key of ["false_claim_count", "unresolved_claim_count", "required_missed_count"]) {
    assertReceipt(nonnegativeInteger(card.critical[key]), `critical_${key}`, assetId);
  }
  const criticalPass = card.critical.false_claim_count === 0
    && card.critical.unresolved_claim_count === 0
    && card.critical.required_missed_count === 0;
  assertReceipt(card.critical.pass === criticalPass, "critical_pass", assetId);
  assertReceipt(card.critical.required_missed_count <= card.title.required_claim_missing_count,
    "critical_required_missed_count", assetId);
  if (card.title.publishable) {
    assertReceipt(criticalPass && card.title.required_claim_missing_count === 0
      && card.title.constraints_pass, "publishable_consistency", assetId);
  }
}

export function validateSemanticPublicationCohortReceipt(semanticCards = [], pairedIds = []) {
  assertReceipt(Array.isArray(semanticCards), "cards_not_array");
  if (semanticCards.length === 0) return null;
  for (const card of semanticCards) validateSemanticPublicationCardReceipt(card);
  const assetIds = semanticCards.map((card) => clean(card.asset_id));
  const physicalIds = semanticCards.map((card) => clean(card.physical_card_id));
  assertReceipt(new Set(assetIds).size === assetIds.length, "duplicate_asset_id");
  assertReceipt(new Set(physicalIds).size === physicalIds.length, "duplicate_physical_card_id");
  assertReceipt(assetIds.every((assetId) => pairedIds.includes(assetId)), "cohort_mismatch");
  const expectedPhysicalIds = Object.fromEntries(semanticCards.map((card) => [
    clean(card.asset_id), clean(card.physical_card_id)
  ]));
  const cohort = summariseSemanticPublicationCohort(semanticCards, {
    expected_asset_ids: assetIds,
    expected_physical_card_id_by_asset: expectedPhysicalIds
  });
  assertReceipt(cohort.cohort_eligible === true, "cohort_receipt");
  return cohort;
}

function summarizeGold(semanticCards, pairedIds) {
  const eligible = semanticCards;
  const eligibleById = new Map(eligible.map((card) => [clean(card.asset_id), card]));
  const fullCoverage = pairedIds.length > 0 && pairedIds.every((assetId) => eligibleById.has(assetId));
  const availability = eligible.length === 0 ? "UNAVAILABLE"
    : fullCoverage ? "COMPLETE" : "PARTIAL_SUBSET";
  const supported = eligible.reduce((sum, card) => sum + card.recognition.supported_count, 0);
  const contradicted = eligible.reduce((sum, card) => sum + card.recognition.contradicted_count, 0);
  const unresolved = eligible.reduce((sum, card) => sum + card.recognition.unresolved_count, 0);
  const goldFacts = eligible.reduce((sum, card) => sum + card.recognition.gold_fact_count, 0);
  const exactCountsAvailable = eligible.length > 0 && eligible.every((card) =>
    Number.isInteger(card.recognition.exact_fact_satisfied_count));
  const exactFacts = exactCountsAvailable ? eligible.reduce((sum, card) => sum
    + card.recognition.exact_fact_satisfied_count, 0) : null;
  const required = eligible.reduce((sum, card) => sum + card.title.required_claim_count, 0);
  const requiredMissing = eligible.reduce((sum, card) => sum
    + Number(card.title.required_claim_missing_count
      ?? (card.title.required_claim_count - card.title.required_claim_satisfied_count)), 0);
  const fields = [...new Set(eligible.flatMap((card) =>
    Object.keys(card.recognition.field_metrics || {})))].sort();
  const perField = Object.fromEntries(fields.map((field) => {
    const rows = eligible.map((card) => card.recognition.field_metrics?.[field]).filter(Boolean);
    const fieldSupported = rows.reduce((sum, row) => sum + row.supported_count, 0);
    const fieldContradicted = rows.reduce((sum, row) => sum + row.contradicted_count, 0);
    const fieldGold = rows.reduce((sum, row) => sum + row.gold_fact_count, 0);
    const fieldExactCountsAvailable = rows.every((row) =>
      Number.isInteger(row.exact_fact_satisfied_count));
    const fieldExact = fieldExactCountsAvailable ? rows.reduce((sum, row) => sum
      + row.exact_fact_satisfied_count, 0) : null;
    const titleRows = eligible.map((card) => card.title.required_field_metrics?.[field]).filter(Boolean);
    const fieldRequired = titleRows.reduce((sum, row) => sum + row.required_claim_count, 0);
    const fieldRequiredMissing = titleRows.reduce((sum, row) => sum
      + row.required_claim_missing_count, 0);
    return [field, {
      verified_claim_precision: safeRatio(fieldSupported,
        fieldSupported + fieldContradicted),
      exact_fact_recall: fieldExact === null ? null : safeRatio(fieldExact, fieldGold),
      required_missing_claims: fieldRequiredMissing,
      required_claims: fieldRequired,
      supported_predictions: fieldSupported,
      contradicted_predictions: fieldContradicted,
      gold_facts: fieldGold
    }];
  }));
  const note = fullCoverage
    ? "independent adjudicated SPG gold covers the paired cohort"
    : eligible.length
      ? "descriptive only: independent gold covers only a subset"
      : "no eligible independent adjudicated SPG gold; do not infer zero errors";
  return {
    availability,
    eligible_gold_cards: eligible.length,
    paired_cards: pairedIds.length,
    full_paired_cohort_coverage: fullCoverage,
    critical_factual_error_cards: metric(eligible.length
      ? eligible.filter((card) => card.critical.false_claim_count > 0).length : null,
    "INDEPENDENT_ADJUDICATED_GOLD", availability, note),
    critical_unresolved_cards: metric(eligible.length
      ? eligible.filter((card) => card.critical.unresolved_claim_count > 0).length : null,
    "INDEPENDENT_ADJUDICATED_GOLD", availability, note),
    typed_field_verified_precision: metric(eligible.length
      ? safeRatio(supported, supported + contradicted) : null,
    "INDEPENDENT_ADJUDICATED_GOLD", availability, note),
    typed_field_exact_recall: metric(exactFacts === null ? null : safeRatio(exactFacts, goldFacts),
      "INDEPENDENT_ADJUDICATED_GOLD", exactCountsAvailable ? availability : "UNAVAILABLE",
      exactCountsAvailable ? note : "SPG exact-fact counters are absent; do not infer zero recall"),
    required_missing_claims: metric(eligible.length ? requiredMissing : null,
      "INDEPENDENT_ADJUDICATED_GOLD", availability, note),
    required_claims: eligible.length ? required : null,
    unresolved_prediction_claims: eligible.length ? unresolved : null,
    by_field: perField
  };
}

function summarizeWrongRole(reviews, pairedIds) {
  const byId = new Map();
  for (const review of reviews) {
    const assetId = clean(review?.asset_id);
    if (!assetId || byId.has(assetId)) throw new Error("typed_ruler_wrong_role_review_invalid");
    if (!pairedIds.includes(assetId)) throw new Error("typed_ruler_wrong_role_review_cohort_mismatch");
    if (review.audit_complete !== true || review.adjudicated !== true
        || !Number.isInteger(review.confirmed_wrong_role_count)
        || review.confirmed_wrong_role_count < 0) {
      throw new Error(`typed_ruler_wrong_role_review_incomplete:${assetId || "empty"}`);
    }
    byId.set(assetId, review);
  }
  const fullCoverage = pairedIds.length > 0 && pairedIds.every((assetId) => byId.has(assetId));
  const availability = reviews.length === 0 ? "UNAVAILABLE"
    : fullCoverage ? "COMPLETE" : "PARTIAL_SUBSET";
  return metric(reviews.length
    ? reviews.reduce((sum, review) => sum + review.confirmed_wrong_role_count, 0) : null,
  "INDEPENDENT_ADJUDICATED_GOLD", availability,
  fullCoverage ? "complete independent wrong-role audit"
    : "wrong-role cannot be inferred from token overlap or canonical self-consistency");
}

export function buildTypedAccuracyEvidenceReport({
  cohort_id = "",
  paired_cards = [],
  semantic_publication_cards = [],
  wrong_role_reviews = [],
  source_artifacts = []
} = {}) {
  if (!Array.isArray(paired_cards) || paired_cards.length === 0) {
    throw new Error("typed_ruler_paired_cards_required");
  }
  const cards = paired_cards.map(inspectPairedCard);
  const ids = cards.map((card) => card.asset_id);
  if (new Set(ids).size !== ids.length) throw new Error("typed_ruler_duplicate_asset_id");
  validateSemanticPublicationCohortReceipt(semantic_publication_cards, ids);
  const semanticIds = semantic_publication_cards.map((card) => clean(card?.asset_id));
  if (semanticIds.some((assetId) => !ids.includes(assetId))
      || new Set(semanticIds).size !== semanticIds.length) {
    throw new Error("typed_ruler_semantic_card_cohort_mismatch");
  }
  const gold = summarizeGold(semantic_publication_cards, ids);
  const wrongRole = summarizeWrongRole(wrong_role_reviews, ids);
  const referenceCards = cards.filter((card) => card.reference_available);
  const f1Deltas = referenceCards.map((card) => card.delta_f1);
  const criticalProxy = cards.filter((card) => card.critical_error_proxy !== null);
  const referenceLoss = cards.filter((card) => card.reference_loss_tokens !== null);
  const unbacked = cards.filter((card) => card.unbacked_new_tokens !== null);
  const numeric = cards.filter((card) => card.numeric_mutations !== null);
  const fieldFidelity = cards.filter((card) => card.exact_field_fidelity !== null);
  const drops = cards.filter((card) => card.drop_ledger_available);
  const newDrops = cards.filter((card) => card.new_dropped_for_budget !== null);
  const coverage = (rows) => `${rows.length}/${cards.length}`;
  const proxyMetric = (value, rows, evidenceClass, note) => metric(
    rows.length ? value : null,
    evidenceClass,
    rows.length === cards.length ? "COMPLETE" : rows.length ? "PARTIAL_SUBSET" : "UNAVAILABLE",
    `${note}; coverage ${coverage(rows)}`
  );
  const baselineMacro = mean(referenceCards.map((card) => card.baseline_f1));
  const candidateMacro = mean(referenceCards.map((card) => card.candidate_f1));
  const blockers = ["measurement_report_never_authorizes_production"];
  if (!gold.full_paired_cohort_coverage) blockers.push("independent_typed_gold_incomplete");
  if (wrongRole.availability !== "COMPLETE") blockers.push("independent_wrong_role_audit_incomplete");

  return {
    schema_version: TYPED_ACCURACY_EVIDENCE_RULER_VERSION,
    authority: "evaluation_only",
    decision: "MEASUREMENT_ONLY",
    production_promotion_allowed: false,
    absolute_accuracy_over_90_claim: null,
    promotion_blockers: blockers,
    cohort: {
      cohort_id: clean(cohort_id) || null,
      paired_cards: cards.length,
      unique_asset_ids: true
    },
    evidence_inventory: {
      source_artifacts: source_artifacts.map(clean).filter(Boolean),
      independent_typed_gold_cards: gold.eligible_gold_cards,
      sealed_writer_title_cards: referenceCards.length,
      paired_canonical_field_cards: fieldFidelity.length,
      composer_drop_ledger_cards: drops.length
    },
    independent_gold_metrics: {
      ...gold,
      wrong_role_claims: wrongRole
    },
    diagnostic_proxies: {
      critical_error_proxy_cards: proxyMetric(
        criticalProxy.filter((card) => card.critical_error_proxy).length,
        criticalProxy,
        "SOURCE_OR_CONSISTENCY_PROXY",
        "not a factual-error count without independent image-backed adjudication"
      ),
      reference_loss_cards: proxyMetric(
        referenceLoss.filter((card) => card.reference_loss_tokens.length).length,
        referenceLoss,
        "SINGLE_WRITER_TITLE_PROXY",
        "reference omission guard, not recognition truth"
      ),
      unbacked_new_token_cards: proxyMetric(
        unbacked.filter((card) => card.unbacked_new_tokens.length).length,
        unbacked,
        "SOURCE_BACKING_PROXY",
        "absence from supplied source evidence is not proof that a fact is false"
      ),
      numeric_mutation_cards: proxyMetric(
        numeric.filter((card) => card.numeric_mutations.length).length,
        numeric,
        "PAIRED_NUMERIC_REGRESSION_PROXY",
        "detects changed numeric claims but does not certify the correct value"
      ),
      titles_over_80: metric(cards.filter((card) => card.over_80).length,
        "DETERMINISTIC_CONTRACT", "COMPLETE", "literal rendered title length"),
      composer_drop_ledger: {
        evidence_class: "DETERMINISTIC_TRACE",
        availability: drops.length === cards.length ? "COMPLETE"
          : drops.length ? "PARTIAL_SUBSET" : "UNAVAILABLE",
        coverage: coverage(drops),
        cards_with_budget_drops: drops.length
          ? drops.filter((card) => card.candidate_dropped_for_budget.length).length : null,
        cards_with_new_budget_drops: newDrops.length
          ? newDrops.filter((card) => card.new_dropped_for_budget.length).length : null,
        truncated_cards: drops.length
          ? drops.filter((card) => card.truncated === true).length : null,
        note: "trace explains deterministic composition loss; it is not field truth"
      },
      exact_field_fidelity_cards: proxyMetric(
        fieldFidelity.filter((card) => card.exact_field_fidelity).length,
        fieldFidelity,
        "PAIRED_CANONICAL_CONSISTENCY_PROXY",
        "exact equality catches drift but equal fields can still both be wrong"
      )
    },
    legacy_f1_trend: {
      evidence_class: "SINGLE_WRITER_TITLE_PROXY",
      availability: referenceCards.length === cards.length ? "COMPLETE"
        : referenceCards.length ? "PARTIAL_SUBSET" : "UNAVAILABLE",
      coverage: coverage(referenceCards),
      baseline_macro_f1: baselineMacro,
      candidate_macro_f1: candidateMacro,
      delta_macro_f1: baselineMacro === null ? null : candidateMacro - baselineMacro,
      wins: f1Deltas.filter((value) => value > EPSILON).length,
      losses: f1Deltas.filter((value) => value < -EPSILON).length,
      ties: f1Deltas.filter((value) => Math.abs(value) <= EPSILON).length,
      promotion_authority: false
    },
    cards
  };
}

export function typedAccuracyInputFromResidualV3Analysis(analysis, sourcePath = "") {
  if (analysis?.schema_version !== "model-residual-candidate-v3-35x3-analysis-v1"
      || !Array.isArray(analysis.cards)) {
    throw new Error("typed_ruler_residual_v3_analysis_invalid");
  }
  return {
    cohort_id: analysis.validated_run?.run_fingerprint || "model-residual-v3-paid35",
    source_artifacts: sourcePath ? [sourcePath] : [],
    paired_cards: analysis.cards.map((card) => ({
      asset_id: card.asset_id,
      reference_title: card.reference,
      baseline_title: card.titles?.residual_c_canonical,
      candidate_title: card.titles?.residual_c_resolved,
      safety: {
        critical: card.safety?.critical,
        reference_losses: card.safety?.reference_losses,
        unbacked_new_tokens: card.safety?.unbacked_new_tokens,
        unsupported_numeric_changes: card.safety?.unsupported_numeric_changes,
        over_80: card.safety?.over_80
      }
    })),
    semantic_publication_cards: [],
    wrong_role_reviews: []
  };
}
