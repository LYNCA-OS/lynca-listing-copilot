// Canonical Naming Layer v0.1.
//
// This module is deliberately pure: it selects a marketplace projection from
// already-supported semantic state, then renders that selection. It does not
// recognize, resolve, retrieve, persist, or repair semantic truth.

const freeze = (value) => Object.freeze(value);

export const LYNCA_STANDARD_NAMING_PROFILE_V01 = freeze({
  id: "lynca-standard-name",
  version: "0.1",
  characterBudget: 80,

  // Display order is not a proxy for importance. In particular, the two P0
  // numeric anchors render near the end while surviving every budget drop.
  renderOrder: freeze([
    "year",
    "manufacturer",
    "product",
    "set",
    "subjects",
    "card_name",
    "release_variant",
    "print_finish",
    "descriptive_rarity",
    "components",
    "search_optimization",
    "team",
    "card_number",
    "serial",
    "grading_info"
  ]),

  // Selection is lexicographic P0 -> P4. Rank is trace-friendly metadata, not
  // a rendering position or a greedy drop order. P0 is never droppable.
  mandatoryIdentityFields: freeze(["subjects"]),
  selectionPriority: freeze({
    card_number: freeze({ tier: "P0", rank: 0, droppable: false }),
    serial: freeze({ tier: "P0", rank: 0, droppable: false }),
    // Product identity and the complete subject name outrank slab metadata.
    // This keeps a constrained title useful as a card identity instead of
    // preserving a grade while reducing `Kobe Bryant` to `Bryant` or dropping
    // the release year.
    manufacturer: freeze({ tier: "P2", rank: 2, droppable: true }),
    product: freeze({ tier: "P1", rank: 1, droppable: true }),
    set: freeze({ tier: "P1", rank: 1, droppable: true }),
    subjects: freeze({ tier: "P1", rank: 1, droppable: true }),
    card_name: freeze({ tier: "P1", rank: 1, droppable: true }),
    release_variant: freeze({ tier: "P1", rank: 1, droppable: true }),
    print_finish: freeze({ tier: "P1", rank: 1, droppable: true }),
    descriptive_rarity: freeze({ tier: "P1", rank: 1, droppable: true }),
    grading_info: freeze({ tier: "P3", rank: 3, droppable: true }),
    components: freeze({ tier: "P2", rank: 2, droppable: true }),
    year: freeze({ tier: "P2", rank: 2, droppable: true }),
    search_optimization: freeze({ tier: "P3", rank: 3, droppable: true }),
    team: freeze({ tier: "P3", rank: 3, droppable: true })
  }),
  variantPriority: freeze({
    subject_first_names: "P1",
    full_season_suffix: "P2"
  }),

  // Search-year aliases belong to the projection profile, never CSM truth.
  // An alias is admitted only when it is shorter and source-derived.
  yearAliases: freeze([
    freeze({ id: "season_start_year", pattern: /^(\d{4})-\d{2}$/, replacement: "$1" })
  ]),
  // These are profile-owned display aliases, not edits to canonical state.
  // Each rule is whole-word, deterministic, and leaves an explicit trace.
  displayAliases: freeze([
    freeze({
      id: "autograph_to_auto",
      fields: freeze([
        "product", "set", "card_name", "release_variant", "components",
        "search_optimization"
      ]),
      pattern: /(?:^|[-\s]+)Autograph\b/,
      replacement: " Auto"
    })
  ]),
  // v0.1 removes only an unambiguous configuration-only Set remainder. Terms
  // such as Choice, Fast Break, or Sapphire can identify a commercial release
  // and therefore require a later evidence-bearing policy rather than a guess.
  redundantConfigurationTerms: freeze(["FOTL"]),
  // Cross-semantic lexical overlap is not proof of redundancy (`SP Authentic`
  // product versus `SP` rarity, or `Gold Standard` versus Gold finish). The
  // few safe exceptions are explicit profile facts rather than fuzzy matches.
  safeCrossSemanticRedundancy: freeze([
    freeze({
      field: "print_finish",
      ownerFields: freeze(["product", "set"]),
      canonicalValues: freeze(["Prizm"]),
      ownerPhrases: freeze(["Prizm", "Panini Prizm", "Chrome Prizm"])
    }),
    freeze({
      field: "release_variant",
      ownerFields: freeze(["set"]),
      canonicalValues: freeze(["Variation", "Image Variation"])
    }),
    freeze({
      field: "print_finish",
      ownerFields: freeze(["card_name"]),
      canonicalValues: freeze(["Gold"]),
      ownerPhrases: freeze(["Gold Refractor"])
    })
  ]),
  // A generic two-word name does not prove which token is the family name
  // (`Yao Ming` is the minimal counterexample). Subject shortening therefore
  // requires a future evidence-bearing alias profile; v0.1 keeps names whole.
  abbreviateSubjectFirstNames: false
});

// v0.2 is append-only. Historical v0.1 rows must always replay with the
// literal profile above. The only new display fact is deliberately narrow:
// for the exact Topps/Bowman Chrome product relationship, the product owns the
// visible brand phrase. Canonical manufacturer truth remains `Topps` in CSM;
// this rule changes only marketplace projection and never generalizes to an
// arbitrary Chrome/Bowman/product string.
export const LYNCA_STANDARD_NAMING_PROFILE_V02 = freeze({
  ...LYNCA_STANDARD_NAMING_PROFILE_V01,
  version: "0.2",
  safeDisplayOwnership: freeze([
    freeze({
      id: "topps_bowman_chrome_product_owns_manufacturer_display",
      field: "manufacturer",
      canonicalValues: freeze(["Topps"]),
      ownerFields: freeze(["product"]),
      ownerValues: freeze(["Bowman Chrome"])
    })
  ])
});

// Dormant replay profile only. The active writer selector remains v0.2.
export const LYNCA_STANDARD_NAMING_PROFILE_V03 = freeze({
  ...LYNCA_STANDARD_NAMING_PROFILE_V02,
  version: "0.3",
  renderOrder: freeze([
    "year", "manufacturer", "product", "set", "card_name", "subjects",
    "release_variant", "print_finish", "descriptive_rarity", "components",
    "search_optimization", "team", "card_number", "serial", "grading_info"
  ])
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const asList = (value) => (Array.isArray(value) ? value : [value])
  .map(clean)
  .filter(Boolean);

function validateProfile(profile) {
  if (!profile || !Array.isArray(profile.renderOrder) || !profile.selectionPriority) {
    throw new TypeError("canonical_naming_profile_invalid");
  }
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("canonical_naming_limit_must_be_positive_integer");
  }
}

function normalizeCardNumber(value, trace) {
  const source = clean(value);
  if (!source) return "";

  const canonical = source.replace(/^(?:#+|N[oO]\.\s*)\s*/, "").trim();
  if (!canonical || canonical.includes("#")) {
    trace.rejected.push({
      field: "card_number",
      operation: "canonicalize_card_number",
      before: source,
      reason: "card_number_cannot_contain_hash"
    });
    return "";
  }
  if (canonical !== source) {
    trace.transformed.push({
      field: "card_number",
      operation: "canonical_prefix_removed",
      before: source,
      after: canonical
    });
  }
  trace.transformed.push({
    field: "card_number",
    operation: "display_prefix_added",
    before: canonical,
    after: `#${canonical}`
  });
  return canonical;
}

function displayGradingInfo(fields, trace) {
  const direct = clean(fields?.grade);
  if (direct) return { value: direct, sourceField: "grade" };

  const info = fields?.grading_info;
  if (!info) return { value: "", sourceField: "grading_info" };
  if (typeof info === "string") return { value: clean(info), sourceField: "grading_info" };
  if (typeof info !== "object" || Array.isArray(info)) {
    trace.rejected.push({
      field: "grading_info",
      operation: "render_grading_info",
      reason: "grading_info_invalid"
    });
    return { value: "", sourceField: "grading_info" };
  }

  const company = clean(info.company);
  const cardGrade = clean(info.card_grade);
  const autoGrade = clean(info.auto_grade);
  const gradeType = clean(info.grade_type);
  let value = "";
  if (gradeType === "AUTO_ONLY") {
    value = [company, "Auto", autoGrade || cardGrade].filter(Boolean).join(" ");
  } else if (gradeType === "AUTHENTIC_WITH_AUTO") {
    value = `${[company, "Authentic"].filter(Boolean).join(" ")}${autoGrade ? `/${autoGrade}` : ""}`;
  } else if (cardGrade && autoGrade) {
    value = `${[company, cardGrade].filter(Boolean).join(" ")}/${autoGrade}`;
  } else {
    value = [company, cardGrade || autoGrade].filter(Boolean).join(" ");
  }
  value = clean(value);
  if (value) {
    trace.transformed.push({
      field: "grading_info",
      operation: "structured_grade_display",
      before: { company, card_grade: cardGrade, auto_grade: autoGrade, grade_type: gradeType },
      after: value
    });
  }
  return { value, sourceField: "grading_info" };
}

function traceToken(token, profile) {
  return {
    key: token.key,
    field: token.field,
    source_field: token.sourceField,
    source_index: token.sourceIndex,
    canonical_value: token.canonicalValue,
    display_value: token.displayValue,
    priority: token.priority.tier,
    render_position: profile.renderOrder.indexOf(token.field)
  };
}

function buildTokens(fields, profile, trace) {
  const tokens = [];
  let ordinal = 0;
  const add = (
    field,
    canonicalValue,
    displayValue = canonicalValue,
    sourceIndex = 0,
    sourceField = field
  ) => {
    const canonical = clean(canonicalValue);
    const display = clean(displayValue);
    const priority = profile.selectionPriority[field];
    if (!canonical || !display || !priority) return;
    tokens.push({
      key: `${field}:${sourceIndex}`,
      field,
      sourceField,
      sourceIndex,
      canonicalValue: canonical,
      displayValue: display,
      priority,
      ordinal: ordinal++
    });
  };

  add("year", fields?.year);
  add("manufacturer", fields?.manufacturer);
  add("product", fields?.product);
  add("set", fields?.set);
  asList(fields?.subjects).forEach((subject, index) => add("subjects", subject, subject, index));
  add("card_name", fields?.card_name);
  add("release_variant", fields?.release_variant);
  add("print_finish", fields?.print_finish);
  add("descriptive_rarity", fields?.descriptive_rarity);
  asList(fields?.components).forEach((term, index) => add(
    "components",
    term,
    term,
    index,
    "components"
  ));
  asList(fields?.search_optimization).forEach((term, index) => add(
    "search_optimization",
    term,
    term,
    index,
    "search_optimization"
  ));
  add("team", fields?.team);

  const cardNumber = normalizeCardNumber(fields?.card_number, trace);
  add("card_number", cardNumber, cardNumber ? `#${cardNumber}` : "");
  add("serial", fields?.serial);
  const grade = displayGradingInfo(fields, trace);
  add("grading_info", grade.value, grade.value, 0, grade.sourceField);
  return tokens;
}

function redundancyWords(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(?:autos?|autographs?|autographed)\b/g, "auto")
    .match(/[a-z0-9]+/g) || [];
}

function containsRedundancyPhrase(container, candidate) {
  const outer = redundancyWords(container);
  const inner = redundancyWords(candidate);
  if (inner.length === 0 || inner.length > outer.length) return false;
  return outer.some((_, start) => inner.every((word, offset) => outer[start + offset] === word));
}

function sourceDerivedSetOverlap(product, set) {
  const productWords = clean(product).split(" ");
  const setWords = clean(set).split(" ");
  const normalizedProduct = productWords.map((word) => redundancyWords(word));
  const normalizedSet = setWords.map((word) => redundancyWords(word));
  if (normalizedProduct.some((words) => words.length !== 1)
      || normalizedSet.some((words) => words.length !== 1)) return null;

  const productValues = normalizedProduct.map(([word]) => word);
  const setValues = normalizedSet.map(([word]) => word);
  for (let prefixLength = setValues.length - 1; prefixLength >= 1; prefixLength -= 1) {
    const prefix = setValues.slice(0, prefixLength);
    const contained = productValues.some((_, start) => (
      prefix.every((word, offset) => productValues[start + offset] === word)
    ));
    if (!contained) continue;
    const displayValue = clean(setWords.slice(prefixLength).join(" "));
    if (!displayValue || displayValue.length >= clean(set).length) continue;
    return { displayValue, removedPrefix: clean(setWords.slice(0, prefixLength).join(" ")) };
  }
  return null;
}

// Only source-derived, whole-phrase redundancy is linked here. Domain facts
// such as "Bowman implies Topps" require a versioned profile adapter and are
// intentionally outside this pure selector. The dependency stays conditional:
// a token can be display-omitted only when its owning phrase is also selected.
function linkSourceDerivedRedundancy(tokens, profile) {
  const byField = (field) => tokens.filter((token) => token.field === field);
  const ownerFor = new Map();
  const profileOwnerFor = new Map();
  const markIfContained = (field, containerFields) => {
    for (const token of byField(field)) {
      const owner = containerFields
        .flatMap(byField)
        .find((candidate) => containsRedundancyPhrase(candidate.canonicalValue, token.canonicalValue));
      if (owner) ownerFor.set(token.key, owner.key);
    }
  };

  markIfContained("manufacturer", ["product", "set"]);
  markIfContained("set", ["product"]);
  markIfContained("components", [
    "set", "card_name", "release_variant", "print_finish", "descriptive_rarity"
  ]);
  markIfContained("search_optimization", [
    "manufacturer", "product", "set", "card_name", "release_variant",
    "print_finish", "descriptive_rarity", "components", "team"
  ]);
  const firstSubjectByValue = new Map();
  for (const token of byField("subjects")) {
    const first = firstSubjectByValue.get(token.canonicalValue);
    if (first) ownerFor.set(token.key, first.key);
    else firstSubjectByValue.set(token.canonicalValue, token);
  }
  for (const rule of profile.safeCrossSemanticRedundancy || []) {
    const allowed = new Set(asList(rule.canonicalValues).map((value) => (
      redundancyWords(value).join(" ")
    )));
    for (const token of byField(rule.field)) {
      if (!allowed.has(redundancyWords(token.canonicalValue).join(" "))) continue;
      const ownerPhrases = asList(rule.ownerPhrases)
        .map((value) => redundancyWords(value).join(" "));
      const owner = asList(rule.ownerFields)
        .flatMap(byField)
        .find((candidate) => (
          containsRedundancyPhrase(candidate.canonicalValue, token.canonicalValue)
          && (ownerPhrases.length === 0 || ownerPhrases.some((phrase) => (
            containsRedundancyPhrase(candidate.canonicalValue, phrase)
          )))
        ));
      if (owner) ownerFor.set(token.key, owner.key);
    }
  }
  for (const rule of profile.safeDisplayOwnership || []) {
    const allowedValues = new Set(asList(rule.canonicalValues)
      .map((value) => redundancyWords(value).join(" ")));
    const allowedOwners = new Set(asList(rule.ownerValues)
      .map((value) => redundancyWords(value).join(" ")));
    for (const token of byField(rule.field)) {
      if (ownerFor.has(token.key)
          || !allowedValues.has(redundancyWords(token.canonicalValue).join(" "))) continue;
      const owner = asList(rule.ownerFields)
        .flatMap(byField)
        .find((candidate) => allowedOwners.has(
          redundancyWords(candidate.canonicalValue).join(" ")
        ));
      if (owner) {
        profileOwnerFor.set(token.key, {
          ownerKey: owner.key,
          rule: rule.id
        });
      }
    }
  }

  const productTokens = byField("product");
  return tokens.map((token) => {
    const overlap = token.field === "set" && !ownerFor.has(token.key)
      ? productTokens.map((owner) => ({
        owner,
        overlap: sourceDerivedSetOverlap(owner.displayValue, token.displayValue)
      })).find((candidate) => candidate.overlap)
      : null;
    return {
      ...token,
      redundantOwnerKey: ownerFor.get(token.key)
        || profileOwnerFor.get(token.key)?.ownerKey
        || null,
      redundancyReason: profileOwnerFor.has(token.key)
        ? "profile_display_ownership"
        : ownerFor.has(token.key) ? "source_derived_redundancy" : null,
      redundancyRule: profileOwnerFor.get(token.key)?.rule || null,
      overlapOwnerKey: overlap?.owner.key || null,
      overlapDisplayValue: overlap?.overlap.displayValue || null,
      overlapRemovedPrefix: overlap?.overlap.removedPrefix || null
    };
  });
}

function renderPosition(profile, field) {
  const position = profile.renderOrder.indexOf(field);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
}

/** Render already-selected tokens in profile order without changing them. */
export function renderCanonicalNameTokens(tokens, {
  profile = LYNCA_STANDARD_NAMING_PROFILE_V01
} = {}) {
  validateProfile(profile);
  return [...(tokens || [])]
    .sort((left, right) => (
      renderPosition(profile, left.field) - renderPosition(profile, right.field)
      || left.sourceIndex - right.sourceIndex
      || left.ordinal - right.ordinal
    ))
    .map((token) => clean(token.displayValue))
    .filter(Boolean)
    .join(" ");
}

function shorterSourceDerivedYearAlias(value, profile, rejected) {
  for (const rule of profile.yearAliases || []) {
    const source = clean(value);
    if (!(rule.pattern instanceof RegExp)) continue;
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/g/g, ""));
    if (!pattern.test(source)) continue;
    const alias = clean(source.replace(pattern, rule.replacement));
    if (!alias || alias.length >= source.length) {
      rejected.push({
        field: "year",
        operation: "profile_year_alias",
        rule: rule.id,
        before: source,
        after: alias,
        reason: "year_alias_not_shorter"
      });
      continue;
    }
    if (!source.includes(alias)) {
      rejected.push({
        field: "year",
        operation: "profile_year_alias",
        rule: rule.id,
        before: source,
        after: alias,
        reason: "year_alias_not_source_derived"
      });
      continue;
    }
    return { alias, rule: rule.id };
  }
  return null;
}

function shorterProfileDisplayAlias(value, field, profile, rejected) {
  const source = clean(value);
  for (const rule of profile.displayAliases || []) {
    if (!Array.isArray(rule.fields) || !rule.fields.includes(field)) continue;
    if (!(rule.pattern instanceof RegExp)) continue;
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/g/g, ""));
    if (!pattern.test(source)) continue;
    const alias = clean(source.replace(pattern, rule.replacement));
    if (!alias || alias.length >= source.length) {
      rejected.push({
        field,
        operation: "profile_display_alias",
        rule: rule.id,
        before: source,
        after: alias,
        reason: "display_alias_not_shorter"
      });
      continue;
    }
    return { alias, rule: rule.id };
  }
  return null;
}

function isRedundantConfigurationRemainder(value, profile) {
  const normalized = clean(value).toLowerCase();
  return (profile.redundantConfigurationTerms || [])
    .some((term) => clean(term).toLowerCase() === normalized);
}

const SCORE_TIERS = freeze(["P0", "P1", "P2", "P3", "P4"]);
const SCORE_SIZE = SCORE_TIERS.length + 1;
const retainedCharacterIndex = SCORE_SIZE - 1;

function emptyScore() {
  return Array.from({ length: SCORE_SIZE }, () => 0);
}

function addScore(left, right) {
  return left.map((value, index) => value + right[index]);
}

function scoreFor(tier, displayValue, bonusTier = null) {
  const score = emptyScore();
  const tierIndex = SCORE_TIERS.indexOf(tier);
  if (tierIndex < 0) throw new TypeError(`canonical_naming_priority_invalid:${tier}`);
  score[tierIndex] += 1;
  if (bonusTier) {
    const bonusIndex = SCORE_TIERS.indexOf(bonusTier);
    if (bonusIndex < 0) throw new TypeError(`canonical_naming_priority_invalid:${bonusTier}`);
    score[bonusIndex] += 1;
  }
  score[retainedCharacterIndex] = clean(displayValue).length;
  return score;
}

function isBetterState(candidate, incumbent) {
  if (!incumbent) return true;
  for (let index = 0; index < SCORE_SIZE; index += 1) {
    if (candidate.score[index] !== incumbent.score[index]) {
      return candidate.score[index] > incumbent.score[index];
    }
  }
  if (candidate.length !== incumbent.length) return candidate.length < incumbent.length;
  return candidate.signature < incumbent.signature;
}

function choicesForToken(token, profile, rejected) {
  let fullBonus = null;
  const alternatives = [];

  if (token.field === "year") {
    const candidate = shorterSourceDerivedYearAlias(token.displayValue, profile, rejected);
    if (candidate) {
      fullBonus = profile.variantPriority?.full_season_suffix || "P3";
      alternatives.push({
        kind: "year_alias",
        displayValue: candidate.alias,
        score: scoreFor(token.priority.tier, candidate.alias),
        rule: candidate.rule
      });
    }
  }

  // v0.1 never guesses a family name. A future subject compaction profile must
  // carry an explicit evidence-backed alias rather than enable a generic flag.

  const displayAlias = shorterProfileDisplayAlias(
    token.displayValue,
    token.field,
    profile,
    rejected
  );
  if (displayAlias) {
    alternatives.push({
      kind: "profile_display_alias",
      displayValue: displayAlias.alias,
      // The alias preserves the canonical token, so score the source phrase;
      // the shorter rendering wins only after semantic scores tie.
      score: scoreFor(token.priority.tier, token.displayValue, fullBonus),
      rule: displayAlias.rule
    });
  }

  if (token.overlapOwnerKey && token.overlapDisplayValue) {
    alternatives.push({
      kind: "source_overlap_trim",
      displayValue: token.overlapDisplayValue,
      // The omitted prefix is still represented by the selected Product, so
      // this choice preserves the full Set semantics. Score the canonical
      // source phrase; the shorter rendered length then wins deterministically
      // even when the title is already below budget.
      score: scoreFor(token.priority.tier, token.displayValue, fullBonus),
      redundantOwnerKey: token.overlapOwnerKey,
      removedPrefix: token.overlapRemovedPrefix
    });
    const overlapAlias = shorterProfileDisplayAlias(
      token.overlapDisplayValue,
      token.field,
      profile,
      rejected
    );
    if (overlapAlias) {
      alternatives.push({
        kind: "source_overlap_profile_alias",
        displayValue: overlapAlias.alias,
        score: scoreFor(token.priority.tier, token.displayValue, fullBonus),
        redundantOwnerKey: token.overlapOwnerKey,
        removedPrefix: token.overlapRemovedPrefix,
        overlapDisplayValue: token.overlapDisplayValue,
        rule: overlapAlias.rule
      });
    }
    if (isRedundantConfigurationRemainder(token.overlapDisplayValue, profile)) {
      alternatives.push({
        kind: "configuration_covered",
        displayValue: "",
        score: scoreFor(token.priority.tier, token.displayValue, fullBonus),
        redundantOwnerKey: token.overlapOwnerKey,
        removedPrefix: token.overlapRemovedPrefix,
        configurationValue: token.overlapDisplayValue
      });
    }
  }

  const choices = [{
    kind: "full",
    displayValue: token.displayValue,
    score: scoreFor(token.priority.tier, token.displayValue, fullBonus)
  }, ...alternatives];
  if (token.redundantOwnerKey) {
    choices.push({
      kind: "covered",
      displayValue: "",
      score: scoreFor(token.priority.tier, token.displayValue, fullBonus),
      redundantOwnerKey: token.redundantOwnerKey,
      reason: token.redundancyReason || "source_derived_redundancy",
      rule: token.redundancyRule || null
    });
  }
  if (token.priority.droppable) {
    choices.push({ kind: "omit", displayValue: "", score: emptyScore() });
  }
  return choices;
}

// Exact multiple-choice knapsack. The budget is tiny (80 by default), and the
// state is bounded by title length and selected-token count, so this remains
// deterministic and cheap while avoiding greedy local losses.
function optimizeTokenChoices(tokens, profile, limit, rejected) {
  const mandatoryFields = new Set(profile.mandatoryIdentityFields || []);
  const requiredSubjectCount = mandatoryFields.has("subjects")
    ? new Set(tokens
      .filter((token) => token.field === "subjects")
      .map((token) => token.canonicalValue)).size
    : 0;
  const ownerKeys = [...new Set(tokens.flatMap((token) => [
    token.redundantOwnerKey,
    token.overlapOwnerKey
  ]).filter(Boolean))];
  const ownerBit = new Map(ownerKeys.map((key, index) => [key, 1n << BigInt(index)]));
  const groups = tokens.map((token) => ({
    token,
    choices: choicesForToken(token, profile, rejected)
  }));
  let states = new Map([["0:0", {
    length: 0,
    selectedCount: 0,
    score: emptyScore(),
    choices: [],
    signature: "",
    providedOwners: 0n,
    requiredOwners: 0n,
    selectedSubjectCount: 0
  }]]);

  for (const { token, choices } of groups) {
    const next = new Map();
    for (const state of states.values()) {
      for (const choice of choices) {
        const selected = Boolean(choice.displayValue);
        const nextLength = state.length + (selected
          ? clean(choice.displayValue).length + (state.selectedCount > 0 ? 1 : 0)
          : 0);
        if (nextLength > limit) continue;
        const candidate = {
          length: nextLength,
          selectedCount: state.selectedCount + (selected ? 1 : 0),
          score: addScore(state.score, choice.score),
          choices: [...state.choices, choice],
          signature: `${state.signature}|${token.key}:${choice.kind}`,
          providedOwners: state.providedOwners
            | (choice.kind !== "omit" ? (ownerBit.get(token.key) || 0n) : 0n),
          requiredOwners: state.requiredOwners
            | (choice.redundantOwnerKey ? (ownerBit.get(choice.redundantOwnerKey) || 0n) : 0n),
          selectedSubjectCount: state.selectedSubjectCount
            + (token.field === "subjects" && selected ? 1 : 0)
        };
        const key = [
          candidate.length,
          candidate.selectedCount,
          candidate.providedOwners.toString(16),
          candidate.requiredOwners.toString(16),
          candidate.selectedSubjectCount
        ].join(":");
        if (isBetterState(candidate, next.get(key))) next.set(key, candidate);
      }
    }
    states = next;
    if (states.size === 0) return null;
  }

  let best = null;
  for (const state of states.values()) {
    if ((state.requiredOwners & state.providedOwners) !== state.requiredOwners) continue;
    if (state.selectedSubjectCount !== requiredSubjectCount) continue;
    if (isBetterState(state, best)) best = state;
  }
  return best;
}

function selectedRedundancyRoot(ownerKey, sourceTokens, chosen) {
  const indexByKey = new Map(sourceTokens.map((token, index) => [token.key, index]));
  const seen = new Set();
  let current = ownerKey;
  while (current && !seen.has(current)) {
    seen.add(current);
    const index = indexByKey.get(current);
    if (index === undefined) return null;
    const choice = chosen[index];
    if (choice?.displayValue) return current;
    if (!choice?.redundantOwnerKey) return null;
    current = choice.redundantOwnerKey;
  }
  return null;
}

/**
 * Select tokens under the profile budget.
 *
 * The returned canonical values never contain display syntax. Selection never
 * truncates P0 anchors; an impossible budget is reported as `overBudget`.
 */
export function selectCanonicalNameTokens(fields, {
  profile = LYNCA_STANDARD_NAMING_PROFILE_V01,
  limit = profile.characterBudget
} = {}) {
  validateProfile(profile);
  validateLimit(limit);

  const trace = {
    selected: [],
    omitted: [],
    abbreviated: [],
    transformed: [],
    rejected: []
  };
  const sourceSubjects = asList(fields?.subjects);
  const mandatorySubjectMissing = (profile.mandatoryIdentityFields || []).includes("subjects")
    && sourceSubjects.length === 0;
  if (mandatorySubjectMissing) {
    trace.rejected.push({
      field: "subjects",
      operation: "identity_admission",
      reason: "mandatory_subject_identity_missing"
    });
  }
  const sourceTokens = linkSourceDerivedRedundancy(buildTokens(fields, profile, trace), profile);
  const optimized = mandatorySubjectMissing
    ? null
    : optimizeTokenChoices(sourceTokens, profile, limit, trace.rejected);
  const p0SourceTokens = sourceTokens.filter((token) => !token.priority.droppable);
  const p0Title = renderCanonicalNameTokens(p0SourceTokens, { profile });
  const includeSubjectsInDiagnostic = p0Title.length <= limit;
  const sourceTokenByKey = new Map(sourceTokens.map((token) => [token.key, token]));
  const chosen = optimized?.choices || sourceTokens.map((token) => {
    const duplicateSubjectOwner = token.field === "subjects"
      ? sourceTokenByKey.get(token.redundantOwnerKey) : null;
    if (duplicateSubjectOwner?.field === "subjects") {
      return {
        kind: "covered",
        displayValue: "",
        redundantOwnerKey: duplicateSubjectOwner.key
      };
    }
    const requiredSubject = token.field === "subjects" && includeSubjectsInDiagnostic;
    const selected = !token.priority.droppable || requiredSubject;
    return {
      kind: selected ? "full" : "omit",
      displayValue: selected ? token.displayValue : ""
    };
  });
  const active = [];
  let unresolvedRedundancy = false;

  sourceTokens.forEach((token, index) => {
    const choice = chosen[index];
    if (choice?.kind === "covered" || choice?.kind === "configuration_covered") {
      const visibleOwner = selectedRedundancyRoot(
        choice.redundantOwnerKey,
        sourceTokens,
        chosen
      );
      if (!visibleOwner) {
        unresolvedRedundancy = true;
        trace.rejected.push({
          key: token.key,
          field: token.field,
          operation: "source_derived_redundancy",
          reason: "redundancy_owner_not_selected"
        });
      }
      trace.omitted.push({
        ...traceToken(token, profile),
        reason: choice.kind === "configuration_covered"
          ? "profile_distribution_configuration_omitted"
          : choice.reason || "source_derived_redundancy",
        redundant_with: visibleOwner || choice.redundantOwnerKey,
        ...(choice.rule ? { rule: choice.rule } : {}),
        ...(choice.kind === "configuration_covered"
          ? { configuration_value: choice.configurationValue }
          : {})
      });
      return;
    }
    if (!choice?.displayValue) {
      trace.omitted.push({
        ...traceToken(token, profile),
        reason: mandatorySubjectMissing
          ? "mandatory_subject_identity_missing"
          : optimized ? "budget_lexicographic_selection" : "p0_budget_infeasible"
      });
      return;
    }

    const selected = { ...token, displayValue: choice.displayValue };
    active.push(selected);
    if (choice.kind === "year_alias") {
      trace.transformed.push({
        key: token.key,
        field: token.field,
        source_field: token.sourceField,
        operation: "profile_year_alias",
        rule: choice.rule,
        before: token.displayValue,
        after: choice.displayValue,
        reason: "budget_lexicographic_selection"
      });
    } else if (choice.kind === "profile_display_alias") {
      trace.transformed.push({
        key: token.key,
        field: token.field,
        source_field: token.sourceField,
        source_index: token.sourceIndex,
        operation: "profile_display_alias",
        rule: choice.rule,
        before: token.displayValue,
        after: choice.displayValue,
        reason: "profile_owned_semantic_alias"
      });
    } else if (choice.kind === "source_overlap_trim"
        || choice.kind === "source_overlap_profile_alias") {
      trace.transformed.push({
        key: token.key,
        field: token.field,
        source_field: token.sourceField,
        source_index: token.sourceIndex,
        operation: "source_derived_overlap_trim",
        before: token.displayValue,
        after: choice.kind === "source_overlap_profile_alias"
          ? choice.overlapDisplayValue
          : choice.displayValue,
        removed_prefix: choice.removedPrefix,
        redundant_with: choice.redundantOwnerKey,
        reason: "source_derived_smart_composition"
      });
      if (choice.kind === "source_overlap_profile_alias") {
        trace.transformed.push({
          key: token.key,
          field: token.field,
          source_field: token.sourceField,
          source_index: token.sourceIndex,
          operation: "profile_display_alias",
          rule: choice.rule,
          before: choice.overlapDisplayValue,
          after: choice.displayValue,
          reason: "profile_owned_semantic_alias"
        });
      }
    }
  });

  const title = renderCanonicalNameTokens(active, { profile });
  const overBudget = title.length > limit;
  const mandatorySubjectInfeasible = !optimized
    && !mandatorySubjectMissing
    && sourceTokens.some((token) => token.field === "subjects")
    && p0Title.length <= limit;
  if (overBudget) {
    trace.rejected.push({
      operation: "character_budget",
      reason: mandatorySubjectInfeasible
        ? "mandatory_subject_identity_exceeds_budget"
        : "p0_identity_exceeds_budget",
      limit,
      title_length: title.length
    });
  }
  trace.selected = [...active]
    .sort((left, right) => (
      renderPosition(profile, left.field) - renderPosition(profile, right.field)
      || left.sourceIndex - right.sourceIndex
      || left.ordinal - right.ordinal
    ))
    .map((token) => ({
      ...traceToken(token, profile),
      reason: "lexicographic_optimum"
    }));

  const featureValues = asList(fields?.search_optimization);
  const grade = displayGradingInfo(fields, { transformed: [], rejected: [] });
  const p0Rejected = trace.rejected.some((row) => (
    row.field === "card_number" && row.operation === "canonicalize_card_number"
  ));

  return {
    profile: { id: profile.id, version: profile.version },
    limit,
    canonical: {
      year: clean(fields?.year),
      manufacturer: clean(fields?.manufacturer),
      product: clean(fields?.product),
      set: clean(fields?.set),
      subjects: asList(fields?.subjects),
      card_name: clean(fields?.card_name),
      release_variant: clean(fields?.release_variant),
      print_finish: clean(fields?.print_finish),
      descriptive_rarity: clean(fields?.descriptive_rarity),
      components: asList(fields?.components),
      search_optimization: featureValues,
      team: clean(fields?.team),
      card_number: normalizeCardNumber(fields?.card_number, {
        transformed: [], rejected: []
      }),
      serial: clean(fields?.serial),
      grading_info: fields?.grading_info ?? null,
      grade: grade.value
    },
    tokens: active.map((token) => ({ ...token, priority: { ...token.priority } })),
    overBudget,
    publishable: Boolean(optimized)
      && !overBudget && !p0Rejected && !unresolvedRedundancy,
    failureReason: mandatorySubjectMissing
      ? "mandatory_subject_identity_missing"
      : !optimized
      ? (mandatorySubjectInfeasible
        ? "mandatory_subject_identity_exceeds_budget"
        : "p0_identity_exceeds_budget")
      : p0Rejected
        ? "p0_identity_invalid"
        : unresolvedRedundancy
          ? "redundancy_owner_not_selected"
          : null,
    trace
  };
}

export function composeCanonicalName(fields, options = {}) {
  const selection = selectCanonicalNameTokens(fields, options);
  const profile = options.profile || LYNCA_STANDARD_NAMING_PROFILE_V01;
  const diagnosticTitle = renderCanonicalNameTokens(selection.tokens, { profile });
  const title = selection.publishable ? diagnosticTitle : "";
  return {
    ...selection,
    title,
    length: title.length,
    diagnosticTitle: selection.publishable ? "" : diagnosticTitle,
    diagnosticLength: selection.publishable ? 0 : diagnosticTitle.length
  };
}
