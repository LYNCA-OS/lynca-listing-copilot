// Versioned production adapter for the Canonical Naming Layer.
//
// The pure selector owns token choice and rendering. This adapter owns the
// compatibility projection expected by CSM persistence and Glass Box readers.
// It never changes canonical facts and never falls back to truncation.

import {
  LYNCA_STANDARD_NAMING_PROFILE_V01,
  LYNCA_STANDARD_NAMING_PROFILE_V02,
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

function releaseContract(profile, marketplaceProfileVersion) {
  return Object.freeze({
    schema_version: "canonical-naming-release.v1",
    composer_version: THIN_COMPOSER_VERSION,
    marketplace_profile_version: marketplaceProfileVersion,
    profile_id: profile.id,
    profile_version: profile.version,
    character_budget: LYNCA_STANDARD_CHARACTER_BUDGET,
    p0_fields: Object.freeze(["card_number", "serial"]),
    mandatory_identity_fields: profile.mandatoryIdentityFields,
    over_budget_policy: "FAIL_CLOSED_NO_TRUNCATION"
  });
}

export const LYNCA_STANDARD_PROFILE_VERSION_V1 = "lynca-standard-name-v0.1";
export const LYNCA_STANDARD_PROFILE_VERSION_V2 = "lynca-standard-name-v0.2";

if (LYNCA_STANDARD_PROFILE_VERSION !== LYNCA_STANDARD_PROFILE_VERSION_V1) {
  throw new TypeError("canonical_naming_active_profile_version_mismatch");
}

export const CANONICAL_NAMING_RELEASE_CONTRACT_V1 = releaseContract(
  LYNCA_STANDARD_NAMING_PROFILE_V01,
  LYNCA_STANDARD_PROFILE_VERSION_V1
);
export const CANONICAL_NAMING_RELEASE_CONTRACT_V2 = releaseContract(
  LYNCA_STANDARD_NAMING_PROFILE_V02,
  LYNCA_STANDARD_PROFILE_VERSION_V2
);

// Until the atomic projection activation switches, this alias remains the
// historical v0.1 writer contract. Bridge code may use V2 explicitly as a
// dormant forward-reader target without changing fresh writes.
export const CANONICAL_NAMING_RELEASE_CONTRACT = CANONICAL_NAMING_RELEASE_CONTRACT_V1;

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
        || token.reason === "profile_display_ownership"
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

export function composeLyncaStandardNameForProfile(fields, {
  marketplaceProfileVersion,
  limit = LYNCA_STANDARD_CHARACTER_BUDGET
} = {}) {
  const profile = marketplaceProfileVersion === LYNCA_STANDARD_PROFILE_VERSION_V1
    ? LYNCA_STANDARD_NAMING_PROFILE_V01
    : marketplaceProfileVersion === LYNCA_STANDARD_PROFILE_VERSION_V2
      ? LYNCA_STANDARD_NAMING_PROFILE_V02
      : null;
  if (!profile) throw new TypeError("canonical_naming_profile_version_unsupported");
  if (profile.characterBudget !== LYNCA_STANDARD_CHARACTER_BUDGET
      || limit !== LYNCA_STANDARD_CHARACTER_BUDGET) {
    throw new TypeError("canonical_naming_character_budget_must_match_profile");
  }
  const result = composeCanonicalName(fields, {
    profile,
    limit
  });
  const compatibility = compatibilityTrace(result);
  return {
    title: result.title,
    diagnostic_title: result.diagnosticTitle,
    title_render_source: `canonical_naming_layer_v${profile.version}`,
    grammar: "standard",
    marketplace: "ebay",
    composer_version: THIN_COMPOSER_VERSION,
    marketplace_profile_version: marketplaceProfileVersion,
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

export function composeLyncaStandardName(fields, options = {}) {
  return composeLyncaStandardNameForProfile(fields, {
    ...options,
    marketplaceProfileVersion:
      CANONICAL_NAMING_RELEASE_CONTRACT.marketplace_profile_version
  });
}
