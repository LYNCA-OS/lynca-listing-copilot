import { safeSurfaceColor } from "../../parallel-policy.mjs";

export const semScoringPolicyVersion = "linear-cos-10-23-v25-commercial-priority-projection-v1";

export const semScoringWeights = Object.freeze({
  default_required_field: 3,
  numerical_rarity: 4,
  standard_card_number: 1,
  tcg_card_number: 4,
  lot_quantity: 4
});

const excludedStatuses = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"]);

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
  if (["megachrome", "mojo", "mojorefractor"].includes(compact)) return "bowmanmegamojofinish";
  return compact;
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
  return {
    denominator: null,
    numerator: null
  };
}

export function semFieldEquivalent(field, expected, actual) {
  if (field === "numerical_rarity") {
    const left = numericalRarityComponents(expected);
    const right = numericalRarityComponents(actual);
    return Boolean(left.denominator && left.denominator === right.denominator);
  }
  if (field === "subject") {
    const left = subjectTokenMultiset(expected);
    const right = subjectTokenMultiset(actual);
    return Boolean(left && left === right);
  }
  if (field === "search_optimization") return expectedSubset(expected, actual);
  if (field === "print_finish") {
    const expectedColor = safeSurfaceColor(expected);
    const actualColor = safeSurfaceColor(actual);
    if (expectedColor) return compactComparable(expectedColor) === compactComparable(actualColor);
    return canonicalPrintFinish(expected) === canonicalPrintFinish(actual);
  }
  if (field === "card_name") return compactComparable(expected) === compactComparable(actual);
  return normalizeComparable(expected) === normalizeComparable(actual);
}

function fieldWeight(field, grammar, weights) {
  if (field === "numerical_rarity") return Number(weights.numerical_rarity);
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
  // Callers may inject scoring components that live outside the canonical SEM
  // field set (e.g. lot workflow quantity). A component marked
  // required_for_acceptance participates in hard acceptance: any incorrect
  // required component lands in required_acceptance_failures regardless of
  // the weighted score.
  extraComponents = []
} = {}) {
  const components = [];
  for (const field of requiredFieldNames(expectedSem, fieldStatuses, requiredFields)) {
    const status = cleanText(fieldStatuses?.[field]).toUpperCase();
    if (excludedStatuses.has(status)) continue;
    if (field === "numerical_rarity") {
      const expected = numericalRarityComponents(expectedSem[field]);
      const actual = numericalRarityComponents(actualSem[field]);
      if (expected.denominator) {
        components.push({
          field,
          component: "production_quantity_denominator",
          weight: fieldWeight(field, grammar, weights),
          correct: expected.denominator === actual.denominator
        });
      }
      if (expected.denominator || expected.numerator) continue;
    }
    components.push({
      field,
      component: "required_field",
      weight: fieldWeight(field, grammar, weights),
      required_for_acceptance: field === "print_finish" && Boolean(safeSurfaceColor(expectedSem[field])),
      correct: semFieldEquivalent(field, expectedSem[field], actualSem[field])
    });
  }
  for (const extra of Array.isArray(extraComponents) ? extraComponents : []) {
    if (!extra || typeof extra !== "object") continue;
    components.push({
      field: cleanText(extra.field) || "extra",
      component: cleanText(extra.component) || "extra_component",
      weight: Number.isFinite(Number(extra.weight)) ? Number(extra.weight) : 0,
      required_for_acceptance: extra.required_for_acceptance === true,
      correct: extra.correct === true
    });
  }
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const correctWeight = components.reduce((sum, component) => (
    sum + (component.correct ? component.weight : 0)
  ), 0);
  const requiredAcceptanceFailures = components
    .filter((component) => component.required_for_acceptance === true && component.correct !== true)
    .map((component) => ({ field: component.field, component: component.component }));
  return {
    policy_version: semScoringPolicyVersion,
    canonical_sem_version: "linear-cos-10-23-v25",
    authority_source: "LINEAR_CSM_AND_SUPABASE_SEM_DEFINITION",
    evaluation_scope: "OFFLINE_STRATEGY_ONLY",
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
    required_acceptance_failures: requiredAcceptanceFailures,
    components
  };
}
