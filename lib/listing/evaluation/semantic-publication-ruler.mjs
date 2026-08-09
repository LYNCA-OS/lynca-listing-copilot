// Evaluation-only ruler for separating recognition truth from title choice.
//
// This module deliberately does not parse a free-form title into fields. Both
// arms must supply claims through the same representation, and the gold labels
// must come from an independently reviewed annotation packet. Until that packet
// is complete, publishability is null rather than optimistically inferred.

import {
  clean,
  normalizeClaimValue,
  prepareClaimEvidence,
  RULER_VERSION,
  TITLE_POLICIES,
  TRUTH_STATUSES
} from "./semantic-publication-contract.mjs";
import {
  createConceptIndex,
  isDescendant,
  prepareClaimIdentity
} from "./semantic-publication-concepts.mjs";
import {
  cardMaterialSha256,
  inspectApprovalManifest,
  inspectConceptRegistry,
  inspectCriticalPolicy,
  inspectTitleConstraints,
  unclaimedSemanticFragments,
  validateTitlePredictionTrace
} from "./semantic-publication-material-validator.mjs";

export {
  normalizeClaimValue,
  PROPOSED_CRITICAL_FIELDS,
  RULER_VERSION,
  TITLE_POLICIES,
  TRUTH_SOURCES,
  TRUTH_STATUSES
} from "./semantic-publication-contract.mjs";
export {
  cardMaterialSha256,
  conceptRegistrySha256,
  criticalPolicySha256,
  inspectCriticalPolicy,
  RULER_BUNDLE_SHA256,
  rulerApprovalManifestSha256
} from "./semantic-publication-material-validator.mjs";
export {
  minimumZeroFailureSample,
  summariseSemanticPublicationCohort,
  wilsonInterval,
  zeroFailureUpperBound
} from "./semantic-publication-cohort-gate.mjs";

function prepareAnnotation(annotation, index, criticalFields) {
  const truthStatus = clean(annotation.truth_status);
  const titlePolicy = clean(annotation.title_policy);
  if (!TRUTH_STATUSES.includes(truthStatus)) throw new Error(`invalid_truth_status:${truthStatus || "empty"}`);
  if (!TITLE_POLICIES.includes(titlePolicy)) throw new Error(`invalid_title_policy:${titlePolicy || "empty"}`);
  if (truthStatus === "SUPPORTED" && titlePolicy === "NOT_APPLICABLE") {
    throw new Error("supported_claim_requires_title_policy");
  }
  if (truthStatus !== "SUPPORTED" && titlePolicy !== "NOT_APPLICABLE") {
    throw new Error("unverified_claim_title_policy_must_be_not_applicable");
  }
  if (truthStatus === "SUPPORTED" && annotation.recognition_required === false) {
    throw new Error("supported_claim_cannot_leave_recognition_denominator");
  }
  const identity = prepareClaimIdentity(annotation, index, {
    identity_error: "annotation_field_and_identity_required"
  });
  const evidence = prepareClaimEvidence(annotation);
  return {
    ...identity,
    ...evidence,
    truth_status: truthStatus,
    title_policy: titlePolicy,
    critical: annotation.critical === true || criticalFields.has(identity.field),
    recognition_required: truthStatus === "SUPPORTED",
    adjudicated: annotation.adjudicated === true
  };
}

function preparePrediction(prediction, index) {
  return prepareClaimIdentity(prediction, index, {
    identity_error: "prediction_field_and_identity_required"
  });
}

function sameField(left, right) {
  return left.field && left.field === right.field;
}

function exactMatch(prediction, annotation) {
  return sameField(prediction, annotation) && prediction.key && prediction.key === annotation.key;
}

function predictionImpliesAnnotation(prediction, annotation, index) {
  return sameField(prediction, annotation)
    && prediction.concept_id
    && annotation.concept_id
    && isDescendant(prediction.concept_id, annotation.concept_id, index);
}

function annotationImpliesPrediction(annotation, prediction, index) {
  return sameField(prediction, annotation)
    && prediction.concept_id
    && annotation.concept_id
    && isDescendant(annotation.concept_id, prediction.concept_id, index);
}

function canonicalSupportsTitleClaim(canonicalClaim, titleClaim, index) {
  return exactMatch(canonicalClaim, titleClaim)
    || predictionImpliesAnnotation(canonicalClaim, titleClaim, index);
}

function classifyPrediction(prediction, annotations, index) {
  const exact = annotations.find((annotation) => exactMatch(prediction, annotation));
  if (exact) {
    if (exact.truth_status === "SUPPORTED") return { state: "SUPPORTED_EXACT", annotation: exact };
    if (exact.truth_status === "CONTRADICTED") return { state: "CONTRADICTED", annotation: exact };
    return { state: "UNRESOLVED", annotation: exact };
  }

  const contradictedAncestor = annotations.find((annotation) =>
    annotation.truth_status === "CONTRADICTED"
    && predictionImpliesAnnotation(prediction, annotation, index));
  if (contradictedAncestor) return { state: "CONTRADICTED", annotation: contradictedAncestor };

  const supportedLeaf = annotations.find((annotation) =>
    annotation.truth_status === "SUPPORTED"
    && annotationImpliesPrediction(annotation, prediction, index));
  if (supportedLeaf) return { state: "SUPPORTED_GENERALIZED", annotation: supportedLeaf };

  const unknownAncestor = annotations.find((annotation) =>
    annotation.truth_status === "UNKNOWN"
    && predictionImpliesAnnotation(prediction, annotation, index));
  return { state: "UNRESOLVED", annotation: unknownAncestor || null };
}

function predictionSatisfies(annotation, predictions, index) {
  return predictions.some((prediction) => exactMatch(prediction, annotation)
    || predictionImpliesAnnotation(prediction, annotation, index));
}

function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function uniqueClassified(entries = []) {
  return [...new Map(entries.map((entry) => [
    `${entry.prediction.key}:${entry.state}`,
    entry
  ])).values()];
}

function uniquePredictions(predictions = []) {
  return [...new Map(predictions.map((prediction) => [prediction.key, prediction])).values()];
}

function duplicateKeys(predictions = []) {
  const counts = new Map();
  for (const prediction of predictions) counts.set(prediction.key, (counts.get(prediction.key) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function assertDisjointTitleSpans(titleClaims = []) {
  const spans = titleClaims.flatMap((claim) => claim.title_spans
    .map((span) => ({ ...span, key: claim.key })))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) {
      throw new Error(`overlapping_title_claim_spans:${spans[index - 1].key}:${spans[index].key}`);
    }
  }
}

function assertConsistentAnnotations(annotations = [], index) {
  const seen = new Set();
  for (const annotation of annotations) {
    if (seen.has(annotation.key)) throw new Error(`duplicate_annotation_key:${annotation.key}`);
    seen.add(annotation.key);
  }
  for (const supported of annotations.filter((annotation) => annotation.truth_status === "SUPPORTED")) {
    if (!supported.concept_id) continue;
    const contradictoryAncestor = annotations.find((annotation) =>
      annotation.field === supported.field
      && annotation.concept_id
      && annotation.concept_id !== supported.concept_id
      && ["CONTRADICTED", "UNKNOWN"].includes(annotation.truth_status)
      && isDescendant(supported.concept_id, annotation.concept_id, index));
    if (contradictoryAncestor) {
      throw new Error(`inconsistent_hierarchical_truth:${supported.key}:${contradictoryAncestor.key}`);
    }
  }
}

function scoreClaimSurface(predictions, annotations, index) {
  const classified = predictions.map((prediction) => ({
    prediction,
    ...classifyPrediction(prediction, annotations, index)
  }));
  const supported = classified.filter((entry) => entry.state.startsWith("SUPPORTED"));
  const contradicted = classified.filter((entry) => entry.state === "CONTRADICTED");
  const unresolved = classified.filter((entry) => entry.state === "UNRESOLVED");
  return {
    classified,
    supported_count: supported.length,
    supported_exact_count: supported.filter((entry) => entry.state === "SUPPORTED_EXACT").length,
    supported_generalized_count: supported.filter((entry) => entry.state === "SUPPORTED_GENERALIZED").length,
    contradicted_count: contradicted.length,
    unresolved_count: unresolved.length,
    verified_claim_precision: safeRatio(supported.length, supported.length + contradicted.length),
    unresolved_claim_rate: safeRatio(unresolved.length, classified.length)
  };
}

export function scoreSemanticPublicationCard({
  asset_id = "",
  physical_card_id = "",
  annotations = [],
  canonical_claims = [],
  title_claims = [],
  title_text = "",
  concept_registry = null,
  critical_policy = null,
  approval_manifest = null,
  expected_approval_manifest_sha256 = null,
  annotation_complete = false,
  title_constraints = null
} = {}) {
  const titleText = String(title_text ?? "");
  const assetId = clean(asset_id);
  const physicalCardId = clean(physical_card_id);
  const conceptRegistry = inspectConceptRegistry(concept_registry);
  const index = createConceptIndex(conceptRegistry.concepts);
  const criticalPolicy = inspectCriticalPolicy(critical_policy);
  const approvalManifest = inspectApprovalManifest(approval_manifest);
  const approvalManifestExpected = /^[a-f0-9]{64}$/i.test(clean(expected_approval_manifest_sha256))
    && clean(expected_approval_manifest_sha256) === approvalManifest.sha256;
  const constraintInspection = inspectTitleConstraints(titleText, title_constraints);
  const computedCardMaterialSha256 = cardMaterialSha256({
    asset_id: assetId,
    physical_card_id: physicalCardId,
    annotations,
    canonical_claims,
    title_claims,
    title_text: titleText,
    annotation_complete,
    title_constraints
  });
  const expectedCardMaterialSha256 = clean(approvalManifest.card_material_sha256_by_asset[assetId]);
  const cardMaterialMatches = Boolean(assetId)
    && Boolean(physicalCardId)
    && expectedCardMaterialSha256 === computedCardMaterialSha256;
  const criticalFields = new Set(criticalPolicy.fields);
  const gold = annotations.map((annotation) => prepareAnnotation(annotation, index, criticalFields));
  assertConsistentAnnotations(gold, index);
  const canonicalInput = canonical_claims.map((claim) => preparePrediction(claim, index));
  const titleInput = title_claims.map((claim) => validateTitlePredictionTrace(
    claim,
    preparePrediction(claim, index),
    index,
    titleText
  ));
  assertDisjointTitleSpans(titleInput);
  const canonical = uniquePredictions(canonicalInput);
  const title = uniquePredictions(titleInput);
  const unbackedTitleClaimKeys = title
    .filter((titleClaim) => !canonical.some((canonicalClaim) =>
      canonicalSupportsTitleClaim(canonicalClaim, titleClaim, index)))
    .map((claim) => claim.key);
  const unclaimedTitleFragments = unclaimedSemanticFragments(titleText, titleInput);
  const canonicalSurface = scoreClaimSurface(canonical, gold, index);
  const titleSurface = scoreClaimSurface(title, gold, index);
  canonicalSurface.input_claim_count = canonicalInput.length;
  canonicalSurface.unique_claim_count = canonical.length;
  canonicalSurface.duplicate_claim_keys = duplicateKeys(canonicalInput);
  titleSurface.input_claim_count = titleInput.length;
  titleSurface.unique_claim_count = title.length;

  const recognizedSupported = gold.filter((annotation) =>
    annotation.adjudicated
    && annotation.truth_status === "SUPPORTED");
  const recognizedTruth = recognizedSupported.filter((annotation) => !recognizedSupported.some((candidate) =>
    candidate !== annotation
    && candidate.field === annotation.field
    && candidate.concept_id
    && annotation.concept_id
    && isDescendant(candidate.concept_id, annotation.concept_id, index)));
  const recognizedTruthSatisfied = recognizedTruth.filter((annotation) =>
    predictionSatisfies(annotation, canonical, index));
  const recognizedTruthExact = recognizedTruth.filter((annotation) =>
    canonical.some((prediction) => exactMatch(prediction, annotation)));

  const requiredTitle = gold.filter((annotation) =>
    annotation.adjudicated
    && annotation.truth_status === "SUPPORTED"
    && annotation.title_policy === "REQUIRED");
  const requiredSatisfied = requiredTitle.filter((annotation) =>
    predictionSatisfies(annotation, title, index));
  const forbidden = gold.filter((annotation) => annotation.title_policy === "FORBIDDEN");
  const forbiddenEmitted = forbidden.filter((annotation) =>
    title.some((prediction) => exactMatch(prediction, annotation)
      || predictionImpliesAnnotation(prediction, annotation, index)
      || annotationImpliesPrediction(annotation, prediction, index)));
  const duplicateTitleClaimKeys = duplicateKeys(titleInput);
  const redundantClaimPairs = [];
  for (let leftIndex = 0; leftIndex < titleInput.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < titleInput.length; rightIndex += 1) {
      const left = titleInput[leftIndex];
      const right = titleInput[rightIndex];
      if (!sameField(left, right)) continue;
      if (left.key === right.key) {
        redundantClaimPairs.push({ left: left.key, right: right.key, kind: "EQUIVALENT" });
      } else if (left.concept_id && right.concept_id
        && (isDescendant(left.concept_id, right.concept_id, index)
          || isDescendant(right.concept_id, left.concept_id, index))) {
        redundantClaimPairs.push({ left: left.key, right: right.key, kind: "ANCESTOR_DESCENDANT" });
      }
    }
  }
  const redundancyOk = redundantClaimPairs.length === 0;

  const criticalFalse = uniqueClassified([
    ...canonicalSurface.classified,
    ...titleSurface.classified
  ]).filter((entry) => entry.state === "CONTRADICTED" && entry.annotation?.critical);
  const criticalUnresolved = uniqueClassified([
    ...canonicalSurface.classified,
    ...titleSurface.classified
  ]).filter((entry) => entry.state === "UNRESOLVED"
    && (entry.annotation?.critical || criticalFields.has(entry.prediction.field)));
  const criticalRequiredMissed = requiredTitle.filter((annotation) =>
    annotation.critical && !predictionSatisfies(annotation, title, index));

  const recognitionFieldMetrics = Object.fromEntries([...new Set([
    ...gold.map((annotation) => annotation.field),
    ...canonical.map((prediction) => prediction.field)
  ])].sort().map((field) => {
    const classified = canonicalSurface.classified.filter(
      (entry) => entry.prediction.field === field
    );
    const fieldTruth = recognizedTruth.filter((annotation) => annotation.field === field);
    const exactFactCount = fieldTruth.filter((annotation) =>
      canonical.some((prediction) => exactMatch(prediction, annotation))).length;
    const satisfiedFactCount = fieldTruth.filter((annotation) =>
      predictionSatisfies(annotation, canonical, index)).length;
    const supportedCount = classified.filter((entry) => entry.state.startsWith("SUPPORTED")).length;
    const contradictedCount = classified.filter((entry) => entry.state === "CONTRADICTED").length;
    const unresolvedCount = classified.filter((entry) => entry.state === "UNRESOLVED").length;
    return [field, {
      supported_count: supportedCount,
      contradicted_count: contradictedCount,
      unresolved_count: unresolvedCount,
      verified_claim_precision: safeRatio(supportedCount, supportedCount + contradictedCount),
      gold_fact_count: fieldTruth.length,
      satisfied_fact_count: satisfiedFactCount,
      exact_fact_satisfied_count: exactFactCount,
      fact_recall: safeRatio(satisfiedFactCount, fieldTruth.length),
      exact_fact_recall: safeRatio(exactFactCount, fieldTruth.length)
    }];
  }));
  const requiredTitleFieldMetrics = Object.fromEntries([...new Set(requiredTitle
    .map((annotation) => annotation.field))].sort().map((field) => {
    const required = requiredTitle.filter((annotation) => annotation.field === field);
    const satisfied = required.filter((annotation) =>
      predictionSatisfies(annotation, title, index));
    return [field, {
      required_claim_count: required.length,
      required_claim_satisfied_count: satisfied.length,
      required_claim_missing_count: required.length - satisfied.length,
      required_claim_recall: safeRatio(satisfied.length, required.length)
    }];
  }));

  const materialsMatch = approvalManifest.critical_policy_sha256 === criticalPolicy.sha256
    && approvalManifest.concept_registry_sha256 === conceptRegistry.sha256
    && approvalManifest.grammar_checker_id === constraintInspection.grammar_checker_id
    && approvalManifest.grammar_checker_sha256 === constraintInspection.grammar_checker_sha256
    && cardMaterialMatches;
  const constraintsKnown = constraintInspection.certificate_known;
  const constraintsPass = constraintsKnown && constraintInspection.length_ok
    && constraintInspection.grammar_ok
    && redundancyOk;
  const allLabelsAdjudicated = gold.length > 0 && gold.every((annotation) => annotation.adjudicated);
  const eligible = annotation_complete === true
    && allLabelsAdjudicated
    && constraintsKnown
    && conceptRegistry.frozen
    && criticalPolicy.frozen
    && approvalManifest.frozen
    && approvalManifestExpected
    && unclaimedTitleFragments.length === 0
    && unbackedTitleClaimKeys.length === 0
    && materialsMatch;
  const publishable = eligible
    ? canonicalSurface.contradicted_count === 0
      && canonicalSurface.unresolved_count === 0
      && titleSurface.contradicted_count === 0
      && titleSurface.unresolved_count === 0
      && forbiddenEmitted.length === 0
      && requiredSatisfied.length === requiredTitle.length
      && criticalFalse.length === 0
      && criticalUnresolved.length === 0
      && criticalRequiredMissed.length === 0
      && constraintsPass
    : null;

  return {
    schema_version: RULER_VERSION,
    asset_id: assetId || null,
    physical_card_id: physicalCardId || null,
    eligible,
    approval_manifest: {
      ...approvalManifest,
      expected_sha256: clean(expected_approval_manifest_sha256) || null,
      expected_sha256_matches: approvalManifestExpected,
      asset_id: assetId || null,
      expected_card_material_sha256: expectedCardMaterialSha256 || null,
      computed_card_material_sha256: computedCardMaterialSha256,
      card_material_matches: cardMaterialMatches,
      materials_match: materialsMatch
    },
    concept_registry: {
      registry_id: conceptRegistry.registry_id,
      status: conceptRegistry.status,
      sha256: conceptRegistry.sha256,
      computed_sha256: conceptRegistry.computed_sha256,
      sha256_matches: conceptRegistry.sha256_matches,
      frozen: conceptRegistry.frozen
    },
    critical_policy: criticalPolicy,
    recognition: {
      ...canonicalSurface,
      fact_recall: safeRatio(recognizedTruthSatisfied.length, recognizedTruth.length),
      exact_fact_recall: safeRatio(recognizedTruthExact.length, recognizedTruth.length),
      gold_fact_count: recognizedTruth.length,
      satisfied_fact_count: recognizedTruthSatisfied.length,
      exact_fact_satisfied_count: recognizedTruthExact.length,
      field_metrics: recognitionFieldMetrics
    },
    title: {
      ...titleSurface,
      required_claim_recall: safeRatio(requiredSatisfied.length, requiredTitle.length),
      required_claim_count: requiredTitle.length,
      required_claim_satisfied_count: requiredSatisfied.length,
      required_claim_missing_count: requiredTitle.length - requiredSatisfied.length,
      required_field_metrics: requiredTitleFieldMetrics,
      forbidden_claim_count: forbiddenEmitted.length,
      duplicate_claim_keys: duplicateTitleClaimKeys,
      redundant_claim_pairs: redundantClaimPairs,
      redundancy_ok: redundancyOk,
      title_text_sha256: constraintInspection.computed_title_sha256,
      rendered_length: constraintInspection.rendered_length,
      length_ok: constraintInspection.length_ok,
      grammar_ok: constraintInspection.grammar_ok,
      grammar_violation_codes: constraintInspection.grammar_violation_codes,
      unclaimed_semantic_fragments: unclaimedTitleFragments,
      trace_complete: unclaimedTitleFragments.length === 0,
      unbacked_canonical_claim_keys: unbackedTitleClaimKeys,
      canonical_lineage_complete: unbackedTitleClaimKeys.length === 0,
      constraints_known: Boolean(constraintsKnown),
      constraints_pass: Boolean(constraintsPass),
      publishable
    },
    critical: {
      false_claim_count: criticalFalse.length,
      unresolved_claim_count: criticalUnresolved.length,
      required_missed_count: criticalRequiredMissed.length,
      pass: eligible
        ? criticalFalse.length === 0
          && criticalUnresolved.length === 0
          && criticalRequiredMissed.length === 0
        : null
    }
  };
}
