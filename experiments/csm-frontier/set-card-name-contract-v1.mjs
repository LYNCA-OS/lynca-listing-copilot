export const SET_CARD_NAME_RELATION_CONTRACT_VERSION = "set-card-name-relations-v1";
export const SET_CARD_NAME_CONFUSION_EVAL_VERSION = "set-card-name-confusion-v1";

export const CURRENT_CARD_CONCEPT = "collectible.current_card";
export const CURRENT_CARD_VALUE = "CURRENT_CARD";
export const SET_MEMBERSHIP_PREDICATE = "CURRENT_CARD_MEMBER_OF_SET";
export const CARD_NAME_PREDICATE = "CURRENT_CARD_NAMED_BY_DESIGN";

export const SET_CARD_NAME_DEFINITIONS = Object.freeze({
  set: "A collection or checklist container that the current card is a member of.",
  card_name: "A printed name for this card or design, distinct from its subject and container."
});

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const comparable = (value) => clean(value).toLocaleLowerCase("en-US")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(code);
  }
}

function supportedFactForPath(state, path) {
  const rows = state.facts.filter((fact) => (
    fact.status === "SUPPORTED" && fact.canonical_path === path
  ));
  if (rows.length > 1) throw new TypeError(`set_card_name_multiple_projected_facts:${path}`);
  return rows[0] || null;
}

function requiredRelationship(state, { predicate, currentCardFact, targetFact, field }) {
  if (!targetFact) return null;
  const matches = state.relationships.filter((row) => (
    row.predicate === predicate
    && row.subject_fact_id === currentCardFact.fact_id
    && row.object_fact_id === targetFact.fact_id
  ));
  if (matches.length !== 1) {
    throw new TypeError(`set_card_name_relation_required:${field}`);
  }
  if (!matches[0].source_ids.some((sourceId) => targetFact.source_ids.includes(sourceId))) {
    throw new TypeError(`set_card_name_relation_source_mismatch:${field}`);
  }
  return matches[0];
}

/**
 * Make the Set/Card Name distinction executable. A field value alone is not
 * enough: Set needs a membership edge and Card Name needs a naming edge.
 */
export function validateSetCardNameRelationsV1(state, {
  currentCardSourceIds = []
} = {}) {
  if (!state || !Array.isArray(state.facts) || !Array.isArray(state.relationships)) {
    throw new TypeError("set_card_name_state_invalid");
  }
  const currentCards = state.facts.filter((fact) => (
    fact.status === "SUPPORTED"
    && fact.concept === CURRENT_CARD_CONCEPT
    && fact.canonical_path === ""
    && fact.value === CURRENT_CARD_VALUE
  ));
  if (currentCards.length !== 1) throw new TypeError("set_card_name_current_card_fact_required");
  const currentCardFact = currentCards[0];
  if (currentCardSourceIds.length && !currentCardFact.source_ids.some((sourceId) => (
    currentCardSourceIds.includes(sourceId)
  ))) {
    throw new TypeError("set_card_name_current_card_source_required");
  }

  const setFact = supportedFactForPath(state, "set");
  const cardNameFact = supportedFactForPath(state, "card_name");
  if (setFact && cardNameFact
      && comparable(setFact.value) === comparable(cardNameFact.value)) {
    throw new TypeError("set_card_name_duplicate_role_value");
  }

  const setRelationship = requiredRelationship(state, {
    predicate: SET_MEMBERSHIP_PREDICATE,
    currentCardFact,
    targetFact: setFact,
    field: "set"
  });
  const cardNameRelationship = requiredRelationship(state, {
    predicate: CARD_NAME_PREDICATE,
    currentCardFact,
    targetFact: cardNameFact,
    field: "card_name"
  });
  for (const [field, fact, forbiddenPredicate] of [
    ["set", setFact, CARD_NAME_PREDICATE],
    ["card_name", cardNameFact, SET_MEMBERSHIP_PREDICATE]
  ]) {
    if (fact && state.relationships.some((row) => (
      row.predicate === forbiddenPredicate && row.object_fact_id === fact.fact_id
    ))) {
      throw new TypeError(`set_card_name_wrong_relation:${field}`);
    }
  }

  return Object.freeze({
    schema_version: SET_CARD_NAME_RELATION_CONTRACT_VERSION,
    current_card_fact_id: currentCardFact.fact_id,
    set: setFact ? Object.freeze({
      fact_id: setFact.fact_id,
      relationship_id: setRelationship.relationship_id,
      value: setFact.value
    }) : null,
    card_name: cardNameFact ? Object.freeze({
      fact_id: cardNameFact.fact_id,
      relationship_id: cardNameRelationship.relationship_id,
      value: cardNameFact.value
    }) : null
  });
}

function fieldPair(value, code) {
  exactKeys(value, ["set", "card_name"], code);
  if (typeof value.set !== "string" || typeof value.card_name !== "string") {
    throw new TypeError(code);
  }
  return { set: clean(value.set), card_name: clean(value.card_name) };
}

/** Score field roles only. Titles are not accepted as input. */
export function evaluateSetCardNameConfusionV1(cases) {
  if (!Array.isArray(cases) || !cases.length) {
    throw new TypeError("set_card_name_confusion_cases_required");
  }
  const counts = {
    exact_role_match: 0,
    set_to_card_name: 0,
    card_name_to_set: 0,
    duplicate_role: 0,
    omitted_set: 0,
    omitted_card_name: 0,
    unexpected_set: 0,
    unexpected_card_name: 0
  };
  const rows = cases.map((entry, index) => {
    exactKeys(entry, ["case_id", "expected", "actual"],
      `set_card_name_confusion_case_shape:${index}`);
    const caseId = clean(entry.case_id);
    if (!caseId) throw new TypeError(`set_card_name_confusion_case_id:${index}`);
    const expected = fieldPair(entry.expected, `set_card_name_confusion_expected:${index}`);
    const actual = fieldPair(entry.actual, `set_card_name_confusion_actual:${index}`);
    const expectedSet = comparable(expected.set);
    const expectedCardName = comparable(expected.card_name);
    const actualSet = comparable(actual.set);
    const actualCardName = comparable(actual.card_name);
    const flags = [];

    if (actualSet === expectedSet && actualCardName === expectedCardName) {
      counts.exact_role_match += 1;
    }
    if (expectedSet && actualSet !== expectedSet) {
      if (actualCardName === expectedSet) {
        counts.set_to_card_name += 1;
        flags.push("SET_TO_CARD_NAME");
      } else {
        counts.omitted_set += 1;
        flags.push("OMITTED_SET");
      }
    }
    if (expectedCardName && actualCardName !== expectedCardName) {
      if (actualSet === expectedCardName) {
        counts.card_name_to_set += 1;
        flags.push("CARD_NAME_TO_SET");
      } else {
        counts.omitted_card_name += 1;
        flags.push("OMITTED_CARD_NAME");
      }
    }
    if (actualSet && actualSet === actualCardName) {
      counts.duplicate_role += 1;
      flags.push("DUPLICATE_ROLE");
    }
    if (!expectedSet && actualSet && actualSet !== expectedCardName) {
      counts.unexpected_set += 1;
      flags.push("UNEXPECTED_SET");
    }
    if (!expectedCardName && actualCardName && actualCardName !== expectedSet) {
      counts.unexpected_card_name += 1;
      flags.push("UNEXPECTED_CARD_NAME");
    }
    return Object.freeze({ case_id: caseId, flags: Object.freeze(flags) });
  });

  return Object.freeze({
    schema_version: SET_CARD_NAME_CONFUSION_EVAL_VERSION,
    case_count: rows.length,
    title_strings_read: false,
    ...counts,
    confusion_error_count: counts.set_to_card_name
      + counts.card_name_to_set + counts.duplicate_role,
    cases: Object.freeze(rows)
  });
}
