import {
  SEM_STANDARD_VERSION,
  semDefinition
} from "../../csm/sem-definition.mjs";
import { safeSurfaceColor } from "../../parallel-policy.mjs";

export const semScoringPolicyVersion = `${SEM_STANDARD_VERSION}-commercial-priority-projection-v1`;

// Linear defines the ordering and relative commercial priority. These integer
// weights are the smallest projection that preserves those decisions: ordinary
// required SEM fields are material, Numerical Rarity is high priority, and a
// non-TCG Card Number is intentionally low priority.
export const semScoringWeights = Object.freeze({
  default_required_field: 3,
  numerical_rarity: 4,
  standard_card_number: 1,
  tcg_card_number: 4,
  lot_quantity: 4
});

const excludedStatuses = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"]);
const genericProductQualifiers = new Set([
  "baseball", "basketball", "football", "hockey", "soccer", "tennis", "wrestling"
]);

function cleanText(value = "") {
  return String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
}

function normalizedWords(value = "") {
  return cleanText(value).toLowerCase()
    .replace(/\b(?:one)\b/g, "1")
    .replace(/\b(?:two)\b/g, "2")
    .replace(/\b(?:three)\b/g, "3")
    .replace(/\b(?:four)\b/g, "4")
    .replace(/\b(?:five)\b/g, "5")
    .replace(/\bautographs?\b/g, "auto")
    .replace(/[^a-z0-9/#+&.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeComparable).filter(Boolean))].sort().join("|");
  }
  if (value && typeof value === "object") {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${normalizeComparable(child)}`).join("|");
  }
  return normalizedWords(value);
}

function compactComparable(value) {
  return normalizeComparable(value).replace(/[^a-z0-9]/g, "");
}

function canonicalPrintFinish(value = "") {
  const compact = compactComparable(value);
  // Topps uses Mega Chrome for the release pattern; marketplace/checklist
  // directories commonly use Mojo Refractor for the same Bowman Mega finish.
  // This is lexical equivalence for SEM scoring, not permission to infer the
  // finish from image appearance.
  if (["megachrome", "mojo", "mojorefractor"].includes(compact)) return "bowmanmegamojofinish";
  return compact;
}

function normalizeProduct(value = "") {
  const words = normalizedWords(value).split(" ").filter(Boolean);
  while (genericProductQualifiers.has(words.at(-1))) words.pop();
  return words.join(" ");
}

function productEquivalent(expected, actual) {
  const left = normalizeProduct(expected);
  const right = normalizeProduct(actual);
  if (left === right) return true;
  for (const manufacturer of ["panini", "topps", "upper deck", "leaf"]) {
    const leftWithout = left === manufacturer ? left : left.replace(new RegExp(`^${manufacturer}\\s+`), "");
    const rightWithout = right === manufacturer ? right : right.replace(new RegExp(`^${manufacturer}\\s+`), "");
    if (leftWithout && leftWithout === rightWithout) return true;
  }
  return false;
}

function expectedSubset(expected, actual) {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const actualValues = new Set((Array.isArray(actual) ? actual : [actual]).map(compactComparable).filter(Boolean));
  return expectedValues.map(compactComparable).filter(Boolean).every((value) => actualValues.has(value));
}

function subjectTokenMultiset(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => normalizedWords(entry).split(" "))
    .map((word) => word.replace(/[^a-z0-9'.-]/g, ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

export function numericalRarityComponents(value = "") {
  const text = cleanText(value).replace(/\s+/g, "");
  const full = text.match(/^#?(\d+)\/(\d+)$/);
  if (full) {
    return {
      denominator: String(Number(full[2])),
      numerator: String(Number(full[1]))
    };
  }
  const denominatorOnly = text.match(/^#?\/(\d+)$/);
  if (denominatorOnly) {
    return {
      denominator: String(Number(denominatorOnly[1])),
      numerator: null
    };
  }
  return { denominator: null, numerator: null };
}

export function semFieldEquivalent(field, expected, actual) {
  if (field === "numerical_rarity") {
    const left = numericalRarityComponents(expected);
    const right = numericalRarityComponents(actual);
    return Boolean(left.denominator && left.denominator === right.denominator);
  }
  if (["product", "set"].includes(field)) return productEquivalent(expected, actual);
  if (field === "subject") {
    // A title parser may preserve an unpunctuated multi-subject catalog title
    // as one phrase while the generated title uses separators. SEM identity is
    // invariant to grouping and order, but remains exact: surname-only output
    // cannot equal a set of full names.
    const left = subjectTokenMultiset(expected);
    const right = subjectTokenMultiset(actual);
    return Boolean(left && left === right);
  }
  if (field === "search_optimization") return expectedSubset(expected, actual);
  if (field === "print_finish") {
    const expectedColor = safeSurfaceColor(expected);
    const actualColor = safeSurfaceColor(actual);
    // Recognition is intentionally color-first. Exact optical families such as
    // Refractor, Wave, Shimmer, Prizm, or Sparkle are safe refinements and do
    // not reduce strategy accuracy when the required base color is correct.
    if (expectedColor) return compactComparable(expectedColor) === compactComparable(actualColor);
    return canonicalPrintFinish(expected) === canonicalPrintFinish(actual);
  }
  if (field === "card_name") {
    return compactComparable(expected) === compactComparable(actual);
  }
  return normalizeComparable(expected) === normalizeComparable(actual);
}

function fieldWeight(field, grammar, weights) {
  if (field === "numerical_rarity") return Number(weights.numerical_rarity);
  if (field === "lot_quantity") return Number(weights.lot_quantity);
  if (field === "card_number") {
    return cleanText(grammar).toUpperCase() === "TCG"
      ? Number(weights.tcg_card_number)
      : Number(weights.standard_card_number);
  }
  return Number(weights.default_required_field);
}

function requiredFieldNames(expectedSem = {}, fieldStatuses = {}, requiredFields = []) {
  if (Array.isArray(requiredFields) && requiredFields.length) return [...new Set(requiredFields)];
  const statusEntries = Object.entries(fieldStatuses || {});
  if (statusEntries.length) {
    return statusEntries
      .filter(([, status]) => !excludedStatuses.has(cleanText(status).toUpperCase()))
      .map(([field]) => field);
  }
  return Object.keys(expectedSem || {});
}

export function scoreRequiredSemProjection({
  expectedSem = {},
  actualSem = {},
  fieldStatuses = {},
  requiredFields = [],
  grammar = "STANDARD",
  weights = semScoringWeights,
  extraComponents = []
} = {}) {
  const components = [];
  for (const field of requiredFieldNames(expectedSem, fieldStatuses, requiredFields)) {
    const status = cleanText(fieldStatuses?.[field]).toUpperCase();
    const hasExplicitStatus = Object.hasOwn(fieldStatuses || {}, field);
    if (hasExplicitStatus && excludedStatuses.has(status)) continue;
    const component = field === "numerical_rarity"
      ? "production_quantity_denominator"
      : "required_field";
    const requiredForAcceptance = field === "print_finish"
      && Boolean(safeSurfaceColor(expectedSem[field]));
    components.push({
      field,
      component,
      weight: fieldWeight(field, grammar, weights),
      required_for_acceptance: requiredForAcceptance,
      correct: semFieldEquivalent(field, expectedSem[field], actualSem[field])
    });
  }
  for (const component of extraComponents) {
    components.push({
      field: cleanText(component.field),
      component: cleanText(component.component) || "required_field",
      weight: Number(component.weight || fieldWeight(component.field, grammar, weights)),
      required_for_acceptance: component.required_for_acceptance === true,
      correct: component.correct === true
    });
  }
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const correctWeight = components.reduce((sum, component) => sum + (component.correct ? component.weight : 0), 0);
  return {
    policy_version: semScoringPolicyVersion,
    canonical_sem_version: SEM_STANDARD_VERSION,
    authority_source: {
      primary: semDefinition.source,
      database_registry: "public.sem_definitions/lynca_sem_canonical_v1"
    },
    evaluation_scope: "REVIEWED_TITLE_SEM_PROJECTION",
    runtime_chain_effect: "NONE",
    grammar: cleanText(grammar).toUpperCase() || "STANDARD",
    noncanonical_evidence_fields_excluded: [
      "serial_number",
      "serial_denominator",
      "print_run_number",
      "print_run_numerator",
      "print_run_denominator",
      "numbered_to"
    ],
    weights: { ...weights },
    correct_weight: Number(correctWeight.toFixed(6)),
    total_weight: Number(totalWeight.toFixed(6)),
    weighted_accuracy: totalWeight > 0 ? Number((correctWeight / totalWeight).toFixed(6)) : null,
    required_acceptance_failures: components
      .filter((component) => component.required_for_acceptance && !component.correct)
      .map((component) => component.field),
    components
  };
}
