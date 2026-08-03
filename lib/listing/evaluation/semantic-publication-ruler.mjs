// Evaluation-only ruler for separating recognition truth from title choice.
//
// This module deliberately does not parse a free-form title into fields. Both
// arms must supply claims through the same representation, and the gold labels
// must come from an independently reviewed annotation packet. Until that packet
// is complete, publishability is null rather than optimistically inferred.

export const RULER_VERSION = "semantic-publication-ruler-v1";

export const TRUTH_STATUSES = Object.freeze([
  "SUPPORTED",
  "CONTRADICTED",
  "UNKNOWN"
]);

export const TITLE_POLICIES = Object.freeze([
  "REQUIRED",
  "OPTIONAL",
  "FORBIDDEN",
  "NOT_APPLICABLE"
]);

export const DEFAULT_CRITICAL_FIELDS = Object.freeze([
  "year",
  "ip_sport",
  "language",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "numerical_rarity",
  "grading_info",
  "lot_quantity"
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function normalizeClaimValue(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9/&'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claimKey(claim = {}) {
  const field = clean(claim.field);
  const identity = clean(claim.concept_id) || normalizeClaimValue(claim.value);
  return field && identity ? `${field}:${identity}` : "";
}

function conceptIndex(concepts = []) {
  const byId = new Map();
  const aliasToId = new Map();
  for (const concept of concepts) {
    const id = clean(concept.id);
    if (!id) throw new Error("concept_id_required");
    if (byId.has(id)) throw new Error(`duplicate_concept_id:${id}`);
    const aliases = [concept.label, ...(concept.aliases || [])]
      .map(normalizeClaimValue)
      .filter(Boolean);
    byId.set(id, {
      id,
      field: clean(concept.field),
      parents: [...new Set((concept.parents || []).map(clean).filter(Boolean))],
      aliases
    });
    for (const alias of aliases) {
      const key = `${clean(concept.field)}:${alias}`;
      const existing = aliasToId.get(key);
      if (existing && existing !== id) throw new Error(`ambiguous_concept_alias:${key}`);
      aliasToId.set(key, id);
    }
  }
  return { byId, aliasToId };
}

function resolveConceptId(claim, index) {
  const explicit = clean(claim?.concept_id);
  if (explicit) return explicit;
  return index.aliasToId.get(`${clean(claim?.field)}:${normalizeClaimValue(claim?.value)}`) || "";
}

function isDescendant(childId, ancestorId, index) {
  if (!childId || !ancestorId) return false;
  if (childId === ancestorId) return true;
  const pending = [childId];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const concept = index.byId.get(current);
    for (const parent of concept?.parents || []) {
      if (parent === ancestorId) return true;
      pending.push(parent);
    }
  }
  return false;
}

function prepareAnnotation(annotation, index, criticalFields) {
  const truthStatus = clean(annotation.truth_status);
  const titlePolicy = clean(annotation.title_policy);
  if (!TRUTH_STATUSES.includes(truthStatus)) throw new Error(`invalid_truth_status:${truthStatus || "empty"}`);
  if (!TITLE_POLICIES.includes(titlePolicy)) throw new Error(`invalid_title_policy:${titlePolicy || "empty"}`);
  if (truthStatus === "CONTRADICTED" && ["REQUIRED", "OPTIONAL"].includes(titlePolicy)) {
    throw new Error("contradicted_claim_cannot_be_required_or_optional");
  }
  if (truthStatus === "UNKNOWN" && titlePolicy === "REQUIRED") {
    throw new Error("unknown_claim_cannot_be_required");
  }
  const conceptId = resolveConceptId(annotation, index);
  return {
    ...annotation,
    field: clean(annotation.field),
    concept_id: conceptId,
    key: conceptId ? `${clean(annotation.field)}:${conceptId}` : claimKey(annotation),
    truth_status: truthStatus,
    title_policy: titlePolicy,
    critical: annotation.critical === true || criticalFields.has(clean(annotation.field)),
    recognition_required: annotation.recognition_required !== false,
    adjudicated: annotation.adjudicated === true
  };
}

function preparePrediction(prediction, index) {
  const conceptId = resolveConceptId(prediction, index);
  return {
    ...prediction,
    field: clean(prediction.field),
    concept_id: conceptId,
    key: conceptId ? `${clean(prediction.field)}:${conceptId}` : claimKey(prediction)
  };
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
  annotations = [],
  canonical_claims = [],
  title_claims = [],
  concepts = [],
  critical_fields = DEFAULT_CRITICAL_FIELDS,
  annotation_complete = false,
  title_constraints = null
} = {}) {
  const index = conceptIndex(concepts);
  const criticalFields = new Set(critical_fields);
  const gold = annotations.map((annotation) => prepareAnnotation(annotation, index, criticalFields));
  const canonical = canonical_claims.map((claim) => preparePrediction(claim, index));
  const title = title_claims.map((claim) => preparePrediction(claim, index));
  const canonicalSurface = scoreClaimSurface(canonical, gold, index);
  const titleSurface = scoreClaimSurface(title, gold, index);

  const recognizedTruth = gold.filter((annotation) =>
    annotation.adjudicated
    && annotation.truth_status === "SUPPORTED"
    && annotation.recognition_required);
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
      || predictionImpliesAnnotation(prediction, annotation, index)));

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

  const constraintsKnown = title_constraints && [
    "length_ok",
    "grammar_ok",
    "redundancy_ok"
  ].every((name) => typeof title_constraints[name] === "boolean");
  const constraintsPass = constraintsKnown && title_constraints.length_ok
    && title_constraints.grammar_ok
    && title_constraints.redundancy_ok;
  const allLabelsAdjudicated = gold.length > 0 && gold.every((annotation) => annotation.adjudicated);
  const eligible = annotation_complete === true && allLabelsAdjudicated && constraintsKnown;
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
    eligible,
    recognition: {
      ...canonicalSurface,
      fact_recall: safeRatio(recognizedTruthSatisfied.length, recognizedTruth.length),
      exact_fact_recall: safeRatio(recognizedTruthExact.length, recognizedTruth.length),
      gold_fact_count: recognizedTruth.length,
      satisfied_fact_count: recognizedTruthSatisfied.length
    },
    title: {
      ...titleSurface,
      required_claim_recall: safeRatio(requiredSatisfied.length, requiredTitle.length),
      required_claim_count: requiredTitle.length,
      required_claim_satisfied_count: requiredSatisfied.length,
      forbidden_claim_count: forbiddenEmitted.length,
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

function mean(values) {
  const decided = values.filter((value) => Number.isFinite(value));
  return decided.length ? decided.reduce((sum, value) => sum + value, 0) / decided.length : null;
}

export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total <= 0 || successes > total) {
    throw new Error("invalid_binomial_counts");
  }
  const proportion = successes / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (proportion + (z ** 2) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) / total) + (z ** 2) / (4 * total ** 2)) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

export function zeroFailureUpperBound(total, alpha = 0.05) {
  if (!Number.isInteger(total) || total <= 0 || !(alpha > 0 && alpha < 1)) throw new Error("invalid_zero_failure_input");
  return 1 - alpha ** (1 / total);
}

export function minimumZeroFailureSample(targetRate, alpha = 0.05) {
  if (!(targetRate > 0 && targetRate < 1) || !(alpha > 0 && alpha < 1)) throw new Error("invalid_zero_failure_target");
  return Math.ceil(Math.log(alpha) / Math.log(1 - targetRate));
}

export function summariseSemanticPublicationCohort(cards = []) {
  const eligible = cards.filter((card) => card?.eligible);
  const publishable = eligible.filter((card) => card.title.publishable === true).length;
  const criticalPass = eligible.filter((card) => card.critical.pass === true).length;
  return {
    schema_version: RULER_VERSION,
    cards: cards.length,
    eligible_cards: eligible.length,
    ineligible_cards: cards.length - eligible.length,
    publishable_cards: publishable,
    publishable_card_rate: safeRatio(publishable, eligible.length),
    publishable_card_rate_wilson_95: eligible.length ? wilsonInterval(publishable, eligible.length) : null,
    critical_pass_cards: criticalPass,
    critical_error_cards: eligible.length - criticalPass,
    critical_error_card_rate: safeRatio(eligible.length - criticalPass, eligible.length),
    macro_recognition_fact_recall: mean(eligible.map((card) => card.recognition.fact_recall)),
    macro_recognition_exact_fact_recall: mean(eligible.map((card) => card.recognition.exact_fact_recall)),
    macro_recognition_verified_precision: mean(eligible.map((card) => card.recognition.verified_claim_precision)),
    macro_title_required_recall: mean(eligible.map((card) => card.title.required_claim_recall))
  };
}
