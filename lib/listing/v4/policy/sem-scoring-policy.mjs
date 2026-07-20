export const semScoringPolicyVersion = "linear-cos-10-23-v25-commercial-priority-projection-v1";

export const semScoringWeights = Object.freeze({
  default_required_field: 3,
  numerical_rarity: 4,
  standard_card_number: 1,
  tcg_card_number: 4
});

const excludedStatuses = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"]);

function cleanText(value = "") {
  return String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeComparable).filter(Boolean))].sort().join("|");
  }
  if (value && typeof value === "object") {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${normalizeComparable(child)}`).join("|");
  }
  return cleanText(value).toLowerCase()
    .replace(/\bautograph\b/g, "auto")
    .replace(/[^a-z0-9/#+&.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  weights = semScoringWeights
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
      correct: normalizeComparable(expectedSem[field]) === normalizeComparable(actualSem[field])
    });
  }
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const correctWeight = components.reduce((sum, component) => (
    sum + (component.correct ? component.weight : 0)
  ), 0);
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
    components
  };
}
