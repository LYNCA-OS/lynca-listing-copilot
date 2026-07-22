import {
  SEM_STANDARD_VERSION,
  semCanonicalEditableFields,
  semGrammarForResolved
} from "../csm/sem-definition.mjs";
import {
  titleDerivedSemSuggestion,
  validateTitleDerivedSem
} from "../csm/title-derived-sem.mjs";
import {
  scoreRequiredSemProjection,
  semScoringWeights
} from "../v4/policy/sem-scoring-policy.mjs";

export const reviewedTitleSemProjectionSchemaVersion = "reviewed-title-sem-projection-v1";
export const reviewedTitleSemAcceptanceThreshold = 0.87;

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every(valuePresent);
  if (value && typeof value === "object") return Object.values(value).some(valuePresent);
  return cleanText(value) !== "";
}

function lotQuantity(title = "") {
  const text = cleanText(title);
  const match = text.match(/\b(?:lot|qty|quantity|bundle)\s*(?:of\s*)?(?:x|\*)?\s*(\d+)\b/i)
    || text.match(/\b(?:lot|bundle)\s*x\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function multiplePerCardRarities(title = "") {
  const matches = [...cleanText(title).matchAll(/(?:^|\s)#?\s*\d*\s*\/\s*\d+\b/g)];
  return matches.length > 1;
}

function confirmedStatusByProvenance(title, sem, assessment, grammar) {
  const statuses = {};
  for (const field of semCanonicalEditableFields) {
    const value = sem[field];
    const provenance = assessment.field_provenance?.[field];
    const values = Array.isArray(provenance?.values) ? provenance.values : [];
    const directlyAnchored = values.length > 0 && values.every((entry) => entry.title_anchored === true);
    statuses[field] = valuePresent(value) && directlyAnchored ? "CONFIRMED" : "UNKNOWN";
  }
  // Standard-card IP/sport is hidden classification data, not a required title
  // token. It is only scored for TCG, where IP is part of the canonical grammar.
  if (grammar !== "TCG") statuses.ip_sport = "UNKNOWN";
  if (lotQuantity(title) && multiplePerCardRarities(title)) {
    statuses.numerical_rarity = "UNKNOWN";
  }
  return statuses;
}

export function semProjectionFromTitle(title = "") {
  const sem = titleDerivedSemSuggestion(title);
  const grammar = lotQuantity(title) ? "LOT" : semGrammarForResolved({
    ip: sem.ip_sport,
    sport: sem.ip_sport,
    category: sem.ip_sport,
    manufacturer: sem.manufacturer,
    product: sem.product,
    set: sem.set
  });
  const assessment = validateTitleDerivedSem(title, sem);
  return {
    sem,
    grammar,
    field_statuses: confirmedStatusByProvenance(title, sem, assessment, grammar),
    parser_assessment: assessment
  };
}

export function scoreReviewedTitleSemProjection({
  referenceTitle = "",
  finalTitle = ""
} = {}) {
  const expected = semProjectionFromTitle(referenceTitle);
  const actual = semProjectionFromTitle(finalTitle);
  const expectedLotQuantity = lotQuantity(referenceTitle);
  const actualLotQuantity = lotQuantity(finalTitle);
  const extraComponents = expectedLotQuantity
    ? [{
      field: "lot_quantity",
      component: "lot_workflow_quantity",
      weight: semScoringWeights.lot_quantity,
      required_for_acceptance: true,
      correct: actualLotQuantity === expectedLotQuantity
    }]
    : [];
  const score = scoreRequiredSemProjection({
    expectedSem: expected.sem,
    actualSem: actual.sem,
    fieldStatuses: expected.field_statuses,
    grammar: expected.grammar,
    extraComponents
  });
  const requiredAcceptanceFailureFields = score.required_acceptance_failures
    .map((failure) => cleanText(failure?.field || failure))
    .filter(Boolean);
  return {
    schema_version: reviewedTitleSemProjectionSchemaVersion,
    sem_standard_version: SEM_STANDARD_VERSION,
    authority: score.authority_source,
    metric: "linear_sem_weighted_projection",
    acceptance_threshold: reviewedTitleSemAcceptanceThreshold,
    accepted: score.weighted_accuracy !== null
      && score.weighted_accuracy >= reviewedTitleSemAcceptanceThreshold
      && requiredAcceptanceFailureFields.length === 0,
    reference_title: cleanText(referenceTitle),
    final_title: cleanText(finalTitle),
    expected_grammar: expected.grammar,
    expected_sem: expected.sem,
    actual_sem: actual.sem,
    expected_field_statuses: expected.field_statuses,
    expected_parser_assessment: expected.parser_assessment,
    actual_parser_assessment: actual.parser_assessment,
    ...score,
    required_acceptance_failures: requiredAcceptanceFailureFields
  };
}

export function attachReviewedTitleSemProjection(rows = []) {
  return rows.map((row) => ({
    ...row,
    sem_projection_scoring: scoreReviewedTitleSemProjection({
      referenceTitle: row.reference_title,
      finalTitle: row.final_title
    })
  }));
}
