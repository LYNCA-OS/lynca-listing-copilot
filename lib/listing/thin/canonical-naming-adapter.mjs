// Production adapter for Canonical Naming Layer v0.1.
//
// The pure selector owns token choice and rendering. This adapter owns the
// compatibility projection expected by CSM persistence and Glass Box readers.
// It never changes canonical facts and never falls back to truncation.

import {
  LYNCA_STANDARD_NAMING_PROFILE_V01,
  composeCanonicalName
} from "./canonical-naming-layer.mjs";
import {
  LYNCA_STANDARD_CHARACTER_BUDGET,
  LYNCA_STANDARD_PROFILE_VERSION,
  THIN_COMPOSER_VERSION
} from "./csm-persistence.mjs";

const FIELD_TO_BRACKET = Object.freeze({
  subjects: "subject",
  components: "search_optimization",
  team: "search_optimization",
  serial: "numerical_rarity",
  grading_info: "grading_info"
});

const asList = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.filter(Boolean))];
const bracketForField = (field) => FIELD_TO_BRACKET[field] || field;

export const CANONICAL_NAMING_RELEASE_CONTRACT = Object.freeze({
  schema_version: "canonical-naming-release.v1",
  composer_version: THIN_COMPOSER_VERSION,
  marketplace_profile_version: LYNCA_STANDARD_PROFILE_VERSION,
  profile_id: LYNCA_STANDARD_NAMING_PROFILE_V01.id,
  profile_version: LYNCA_STANDARD_NAMING_PROFILE_V01.version,
  character_budget: LYNCA_STANDARD_CHARACTER_BUDGET,
  p0_fields: Object.freeze(["card_number", "serial"]),
  mandatory_identity_fields: LYNCA_STANDARD_NAMING_PROFILE_V01.mandatoryIdentityFields,
  over_budget_policy: "FAIL_CLOSED_NO_TRUNCATION"
});

function emptyInputFields(fields) {
  const groups = {
    year: [fields?.year],
    manufacturer: [fields?.manufacturer],
    product: [fields?.product],
    set: [fields?.set],
    subject: asList(fields?.subjects),
    card_name: [fields?.card_name],
    release_variant: [fields?.release_variant],
    print_finish: [fields?.print_finish],
    descriptive_rarity: [fields?.descriptive_rarity],
    search_optimization: [
      ...asList(fields?.components),
      ...asList(fields?.search_optimization),
      fields?.team
    ],
    card_number: [fields?.card_number],
    numerical_rarity: [fields?.serial],
    grading_info: [
      fields?.grade,
      ...(fields?.grading_info && typeof fields.grading_info === "object"
        ? Object.values(fields.grading_info)
        : [fields?.grading_info])
    ]
  };
  return Object.entries(groups)
    .filter(([, values]) => values.map(clean).filter(Boolean).length === 0)
    .map(([bracket]) => bracket);
}

function compatibilityTrace(result) {
  const selectedByBracket = new Map();
  for (const token of result.trace.selected) {
    const bracket = bracketForField(token.field);
    const values = selectedByBracket.get(bracket) || [];
    values.push(token.display_value);
    selectedByBracket.set(bracket, values);
  }
  const brackets = unique(result.trace.selected.map((token) => bracketForField(token.field)));
  const dropped = unique(result.trace.omitted
    .filter((token) => token.reason === "budget_lexicographic_selection"
      || token.reason === "p0_budget_infeasible")
    .map((token) => bracketForField(token.field)));
  const normalizationReasons = unique([
    ...result.trace.omitted
      .filter((token) => token.reason === "source_derived_redundancy"
        || token.reason === "profile_distribution_configuration_omitted")
      .map((token) => `${bracketForField(token.field)}:${token.reason}`),
    ...result.trace.abbreviated
      .map((token) => `${bracketForField(token.field)}:${token.operation}`),
    ...result.trace.transformed
      .filter((token) => token.field && token.operation !== "display_prefix_added")
      .map((token) => `${bracketForField(token.field)}:${token.operation}`)
  ]);
  return {
    brackets,
    bracket_text: brackets.map((bracket) => ({
      bracket,
      text: (selectedByBracket.get(bracket) || []).join(" ")
    })),
    dropped,
    normalization_reasons: normalizationReasons
  };
}

export function composeLyncaStandardName(fields, {
  limit = LYNCA_STANDARD_CHARACTER_BUDGET
} = {}) {
  if (LYNCA_STANDARD_NAMING_PROFILE_V01.characterBudget !== LYNCA_STANDARD_CHARACTER_BUDGET
      || limit !== LYNCA_STANDARD_CHARACTER_BUDGET) {
    throw new TypeError("canonical_naming_character_budget_must_match_profile");
  }
  const result = composeCanonicalName(fields, {
    profile: LYNCA_STANDARD_NAMING_PROFILE_V01,
    limit
  });
  const compatibility = compatibilityTrace(result);
  return {
    title: result.title,
    diagnostic_title: result.diagnosticTitle,
    title_render_source: "canonical_naming_layer_v0.1",
    grammar: "standard",
    marketplace: "ebay",
    composer_version: THIN_COMPOSER_VERSION,
    marketplace_profile_version: LYNCA_STANDARD_PROFILE_VERSION,
    canonical_naming_publishable: result.publishable,
    canonical_naming_failure_code: result.publishable ? null
      : result.failureReason === "mandatory_subject_identity_missing"
        ? "canonical_naming_mandatory_subject_identity_missing"
        : result.failureReason === "mandatory_subject_identity_exceeds_budget"
        ? "canonical_naming_mandatory_subject_identity_exceeds_budget"
        : result.failureReason === "p0_identity_exceeds_budget"
          ? "canonical_naming_p0_identity_exceeds_budget"
          : "canonical_naming_p0_identity_invalid",
    canonical_naming_trace: result.trace,
    brackets: compatibility.brackets,
    bracket_text: compatibility.bracket_text,
    dropped: compatibility.dropped,
    suppressed: [],
    restored: [],
    truncated: false,
    empty_fields: unique(emptyInputFields(fields)),
    input_empty_fields: unique(emptyInputFields(fields)),
    unreadable: [...(fields?.unreadable || [])],
    low_confidence: [...(fields?.low_confidence || [])],
    inferred_parent: null,
    normalization_reasons: compatibility.normalization_reasons,
    character_budget: limit,
    length: result.length
  };
}
