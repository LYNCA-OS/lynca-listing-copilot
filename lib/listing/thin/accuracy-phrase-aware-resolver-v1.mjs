// Evaluation-only phrase resolver for already-paid exhaustive observations.
//
// The unit of evidence is a complete observation phrase plus its semantic
// role, region, modality, confidence and provenance. A token occurring in a
// biography, uniform, background, layout or copyright line never inherits the
// authority of the same token printed as a set, logo or insert identity.
//
// This module deliberately returns decisions only. It does not compose a
// title, mutate canonical fields, read references, call a provider, or enter
// the production thin path.

export const ACCURACY_PHRASE_AWARE_RESOLVER_V1 = "accuracy-phrase-aware-resolver-v1";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[®©™]/g, "")
  .replace(/[–—]/g, "-")
  .replace(/[.]+$/g, "")
  .toUpperCase();
const copy = (value) => structuredClone(value ?? {});

const REQUIRED_CANDIDATE_KEYS = Object.freeze([
  "observation_phrase",
  "source_region",
  "source_role",
  "source_kind",
  "source_confidence",
  "candidate_field",
  "candidate_value",
  "provenance"
]);

const IDENTITY_ROLES = new Set([
  "logo", "logo_text", "product_logo", "set_logo", "brand_logo",
  "product", "product_name", "product_text", "product_label", "product_line",
  "product_set", "product_brand", "product_mark", "product_logo",
  "set", "set_name", "set_text", "set_label", "set_branding",
  "set_description", "set_designation", "year_set", "set_year",
  "set_year_brand", "product_set", "product_name"
]);

const SEASON_ROLES = new Set([
  "season", "year_set", "set", "set_year", "set_year_brand", "year_product"
]);

const BIOGRAPHY_ROLE = /(?:biograph|career|resume|scouting|description_text|fact_text)/i;
const STATISTICS_ROLE = /(?:^|_)(?:statistic|statistics|stats?|record)(?:_|$)/i;
const COPYRIGHT_ROLE = /(?:copyright|rights|legal|trademark|licens)/i;
const UNIFORM_BACKGROUND_ROLE = /(?:uniform|player[_ ]image|background|artwork|illustration|layout|pattern|color|photograph|pictured|image[_ ]subject)/i;

const COLOR_WORD = /\b(?:black|blue|brown|gold|green|orange|pink|purple|red|silver|teal|white|yellow)\b/i;
const WRONG_ROLE_SIGNALS = Object.freeze([
  { test: (candidate) => BIOGRAPHY_ROLE.test(candidate.source_role), reason: "wrong_role_biography" },
  { test: (candidate) => STATISTICS_ROLE.test(candidate.source_role), reason: "wrong_role_statistics" },
  { test: (candidate) => COPYRIGHT_ROLE.test(candidate.source_role), reason: "wrong_role_copyright" },
  { test: (candidate) => UNIFORM_BACKGROUND_ROLE.test(candidate.source_role), reason: "wrong_role_uniform_background_or_layout" }
]);

function titleCaseIdentity(value) {
  const known = new Map([
    ["STAR WARS", "Star Wars"],
    ["DISNEY", "Disney"],
    ["VEEFRIENDS", "VeeFriends"],
    ["GRAPHITE", "Graphite"],
    ["NBL", "NBL"],
    ["ULTRA", "Ultra"]
  ]);
  return known.get(key(value)) || clean(value);
}

function seasonSpan(phrase, existingYear = "") {
  const normalized = key(phrase);
  const full = normalized.match(/\b((?:19|20)\d{2})-(\d{2})\b/);
  if (full) {
    const start = Number(full[1]);
    const suffix = Number(full[2]);
    if ((start + 1) % 100 !== suffix) return null;
    return `${full[1]}-${full[2]}`;
  }

  const short = normalized.match(/(?:^|\b)(\d{2})-(\d{2})(?:\b|$)/);
  if (!short || (Number(short[1]) + 1) % 100 !== Number(short[2])) return null;
  const current = clean(existingYear).match(/^(19|20)(\d{2})(?:-\d{2})?$/);
  if (!current) return null;
  const currentYear = Number(`${current[1]}${current[2]}`);
  const startSuffix = Number(short[1]);
  // A bare `24-25` may be a statistics season. It may extend a canonical
  // 2024 into 2024-25, but it may not rewrite canonical 2025 backward to
  // 2024. A full `2024-25` in a typed Set role is independently anchored and
  // is handled above.
  if (currentYear % 100 !== startSuffix) return null;
  return `${currentYear}-${short[2]}`;
}

function provenanceValid(provenance) {
  return Boolean(provenance && typeof provenance === "object"
    && !Array.isArray(provenance)
    && clean(provenance.source));
}

function candidate(row, candidateField, candidateValue, provenance, family) {
  return {
    schema_version: ACCURACY_PHRASE_AWARE_RESOLVER_V1,
    observation_phrase: clean(row?.evidence),
    source_region: clean(row?.region) || "unknown",
    source_role: clean(row?.label) || "unknown",
    source_kind: clean(row?.kind) || "unknown",
    source_confidence: clean(row?.confidence) || "unknown",
    candidate_field: candidateField,
    candidate_value: clean(candidateValue),
    candidate_family: family,
    provenance: copy(provenance)
  };
}

function wrongRoleProbe(row, provenance) {
  const phrase = clean(row?.evidence);
  const role = clean(row?.label);
  if (!phrase || !role) return null;
  if (COPYRIGHT_ROLE.test(role) && /\b(?:19|20)\d{2}\b/.test(phrase)) {
    const value = phrase.match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    return candidate(row, "year", value, provenance, "wrong_role_probe");
  }
  if ((BIOGRAPHY_ROLE.test(role) || STATISTICS_ROLE.test(role)) && /\brookie\b/i.test(phrase)) {
    return candidate(row, "descriptive_rarity", "Rookie", provenance, "wrong_role_probe");
  }
  if (STATISTICS_ROLE.test(role) && /\b(?:19|20)\d{2}\b/.test(phrase)) {
    const value = phrase.match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    return candidate(row, "year", value, provenance, "wrong_role_probe");
  }
  if (UNIFORM_BACKGROUND_ROLE.test(role) && /\bhorizontal\b/i.test(phrase)) {
    return candidate(row, "release_variant", "Horizontal", provenance, "wrong_role_probe");
  }
  const color = phrase.match(COLOR_WORD)?.[0];
  if (UNIFORM_BACKGROUND_ROLE.test(role) && color) {
    return candidate(row, "print_finish", titleCaseIdentity(color), provenance, "wrong_role_probe");
  }
  return null;
}

function identityCandidate(fields, row, provenance) {
  const phraseKey = key(row?.evidence);
  const role = clean(row?.label);
  const grammar = clean(fields?.grammar).toLowerCase() === "tcg" ? "tcg" : "standard";
  if (!IDENTITY_ROLES.has(role)) return null;

  if (phraseKey === "STAR WARS") {
    return candidate(row, grammar === "tcg" ? "ip" : "set", "Star Wars", provenance, "exact_identity_phrase");
  }
  if (phraseKey === "DISNEY") {
    return candidate(row, grammar === "tcg" ? "ip" : "set", "Disney", provenance, "exact_identity_phrase");
  }
  if (phraseKey === "VEEFRIENDS" || phraseKey === "VEEFRIENDS LOGO") {
    return candidate(row, grammar === "tcg" ? "ip" : "set", "VeeFriends", provenance, "exact_identity_phrase");
  }
  if (phraseKey === "GRAPHITE") {
    return candidate(row, "product", "Graphite", provenance, "exact_identity_phrase");
  }
  if (phraseKey === "NBL") {
    return candidate(row, "set", "NBL", provenance, "exact_identity_phrase");
  }
  if (/^(?:19|20)\d{2} BOWMAN DRAFT$/.test(phraseKey)) {
    return candidate(row, "set", "Draft", provenance, "full_set_phrase_suffix");
  }
  if (phraseKey === "OPTIC") {
    const product = clean(fields?.product);
    let extended = "Optic";
    if (/\bdonruss\b/i.test(product) && !/\boptic\b/i.test(product)) {
      extended = product.replace(/\bDonruss\b/i, (match) => `${match} Optic`);
    }
    return candidate(row, "product", extended, provenance, "compatible_product_extension");
  }
  if (phraseKey === "ULTRA") {
    return candidate(row, "product", "Ultra", provenance, "exact_identity_phrase");
  }
  return null;
}

/**
 * Convert retained exhaustive observations into fully typed phrase candidates.
 * Unmatched observations remain observations; no token-wide candidate is
 * invented for them.
 */
export function buildPhraseAwareCandidatesV1(fields = {}, observations = [], {
  provenance = {}
} = {}) {
  const output = [];
  for (const [observationIndex, row] of (Array.isArray(observations) ? observations : []).entries()) {
    const rowProvenance = {
      ...copy(provenance),
      observation_index: observationIndex
    };
    const phrase = clean(row?.evidence);
    if (!phrase) continue;

    const wrongRole = wrongRoleProbe(row, rowProvenance);
    if (wrongRole) {
      output.push(wrongRole);
      continue;
    }

    const season = seasonSpan(phrase, fields?.year);
    if (season && (SEASON_ROLES.has(clean(row?.label)) || COPYRIGHT_ROLE.test(clean(row?.label)))) {
      output.push(candidate(row, "year", season, rowProvenance, "season_phrase"));
      continue;
    }

    if (/^PICK\s+\d{1,2}$/i.test(phrase)) {
      output.push(candidate(row, "card_name", phrase.replace(/^pick/i, "Pick"), rowProvenance, "pick_designation_phrase"));
      continue;
    }

    if (/^KABOOM[ -]HORIZONTAL$/i.test(phrase)) {
      output.push(candidate(row, "card_name", "Kaboom Horizontal", rowProvenance, "insert_phrase"));
      continue;
    }

    if (/\bHOME RUN DERBY\b/i.test(phrase)) {
      output.push(candidate(row, "card_name", "Home Run Derby", rowProvenance, "event_phrase"));
      continue;
    }

    if (/^ROOKIE TICKET$/i.test(phrase)) {
      output.push(candidate(row, "card_name", "Rookie Ticket", rowProvenance, "insert_phrase"));
      continue;
    }

    const identity = identityCandidate(fields, row, rowProvenance);
    if (identity) output.push(identity);
  }
  return output;
}

function invalidReason(candidateRow) {
  for (const name of REQUIRED_CANDIDATE_KEYS) {
    if (name === "provenance") {
      if (!provenanceValid(candidateRow?.provenance)) return "invalid_or_missing_provenance";
      continue;
    }
    if (!clean(candidateRow?.[name])) return `missing_${name}`;
  }
  return null;
}

function sameValue(field, existing, proposed) {
  const oldKey = key(existing);
  const newKey = key(proposed);
  if (!oldKey || !newKey) return false;
  if (oldKey === newKey) return true;
  if (field === "product" || field === "set" || field === "ip") {
    return oldKey.includes(newKey) || newKey.includes(oldKey);
  }
  return false;
}

function decision(candidateRow, decisionName, reasonCode) {
  return {
    ...copy(candidateRow),
    decision: decisionName,
    admission_reason: reasonCode,
    authority: "evaluation_only",
    production_promoted: false
  };
}

/** Resolve one complete phrase. The returned object is a typed decision only. */
export function resolvePhraseAwareCandidateV1(fields = {}, candidateRow = {}) {
  const invalid = invalidReason(candidateRow);
  if (invalid) return decision(candidateRow, "reject", invalid);

  const wrongRole = WRONG_ROLE_SIGNALS.find((entry) => entry.test(candidateRow));
  if (wrongRole) return decision(candidateRow, "reject", wrongRole.reason);

  if (candidateRow.source_kind !== "printed_text") {
    return decision(candidateRow, "reject", "non_printed_observation");
  }
  if (candidateRow.source_confidence !== "high") {
    return decision(candidateRow, "candidate_only", "observation_not_high_confidence");
  }

  const existing = fields?.[candidateRow.candidate_field];
  if (sameValue(candidateRow.candidate_field, existing, candidateRow.candidate_value)) {
    return decision(candidateRow, "no_change", "already_represented_in_typed_field");
  }

  if (candidateRow.candidate_family === "season_phrase") {
    if (!SEASON_ROLES.has(candidateRow.source_role)) {
      return decision(candidateRow, "reject", "season_wrong_semantic_role");
    }
    const proposed = clean(candidateRow.candidate_value);
    const match = proposed.match(/^((?:19|20)\d{2})-(\d{2})$/);
    if (!match || (Number(match[1]) + 1) % 100 !== Number(match[2])) {
      return decision(candidateRow, "reject", "invalid_consecutive_season_phrase");
    }
    const existingYear = clean(existing);
    if (existingYear && /^\d{4}$/.test(existingYear)) {
      const start = Number(match[1]);
      if (![start, start + 1].includes(Number(existingYear))) {
        return decision(candidateRow, "candidate_only", "season_conflicts_existing_year");
      }
    } else if (existingYear && existingYear !== proposed) {
      return decision(candidateRow, "candidate_only", "season_conflicts_existing_year");
    }
    return decision(candidateRow, "admit", "exact_consecutive_season_from_typed_role");
  }

  if (candidateRow.candidate_family === "pick_designation_phrase") {
    if (candidateRow.source_region !== "card_front"
      || !["unknown", "card_title", "insert_name", "draft_information"].includes(candidateRow.source_role)
      || !/^PICK\s+\d{1,2}$/i.test(candidateRow.observation_phrase)) {
      return decision(candidateRow, "reject", "pick_phrase_wrong_region_or_role");
    }
    if (!/\bsignature class\b/i.test(clean(fields?.product))) {
      return decision(candidateRow, "candidate_only", "pick_phrase_missing_product_context");
    }
    if (clean(existing)) return decision(candidateRow, "candidate_only", "occupied_conflicting_field");
    return decision(candidateRow, "admit", "exact_pick_phrase_with_product_context");
  }

  if (["insert_phrase", "event_phrase"].includes(candidateRow.candidate_family)) {
    const allowedRole = candidateRow.candidate_family === "event_phrase"
      ? ["event", "event_logo_text", "event_text"]
      : ["insert_name", "insert_title", "set_or_insert_name"];
    if (!allowedRole.includes(candidateRow.source_role)) {
      return decision(candidateRow, "reject", "identity_phrase_wrong_semantic_role");
    }
    if (candidateRow.candidate_family === "event_phrase"
      && !/\btribute\b/i.test(clean(fields?.product))) {
      return decision(candidateRow, "candidate_only", "event_phrase_missing_product_context");
    }
    if (clean(existing)) return decision(candidateRow, "candidate_only", "occupied_conflicting_field");
    return decision(candidateRow, "admit", "exact_full_card_name_phrase");
  }

  if (candidateRow.candidate_family === "full_set_phrase_suffix") {
    if (candidateRow.source_region !== "slab_label" || candidateRow.source_role !== "set") {
      return decision(candidateRow, "reject", "full_set_phrase_requires_slab_set_role");
    }
    if (!/^\d{4} BOWMAN DRAFT$/i.test(key(candidateRow.observation_phrase))
      || !/\bbowman\b/i.test(clean(fields?.product))) {
      return decision(candidateRow, "candidate_only", "full_set_phrase_missing_product_context");
    }
    if (clean(existing)) return decision(candidateRow, "candidate_only", "occupied_conflicting_field");
    return decision(candidateRow, "admit", "slab_exact_full_set_phrase");
  }

  if (candidateRow.candidate_family === "compatible_product_extension") {
    if (key(candidateRow.observation_phrase) !== "OPTIC" || candidateRow.source_role !== "logo"
      || candidateRow.source_region !== "card_front") {
      return decision(candidateRow, "reject", "product_extension_wrong_phrase_or_role");
    }
    if (!/\bdonruss\b/i.test(clean(existing)) || /\boptic\b/i.test(clean(existing))) {
      return decision(candidateRow, "candidate_only", "product_extension_incompatible_base");
    }
    return decision(candidateRow, "admit", "exact_logo_compatible_product_extension");
  }

  if (candidateRow.candidate_family === "exact_identity_phrase") {
    const phraseKey = key(candidateRow.observation_phrase);
    const expected = new Map([
      ["STAR WARS", "Star Wars"],
      ["DISNEY", "Disney"],
      ["VEEFRIENDS", "VeeFriends"],
      ["VEEFRIENDS LOGO", "VeeFriends"],
      ["GRAPHITE", "Graphite"],
      ["NBL", "NBL"],
      ["ULTRA", "Ultra"]
    ]).get(phraseKey);
    if (!expected || key(expected) !== key(candidateRow.candidate_value) || !IDENTITY_ROLES.has(candidateRow.source_role)) {
      return decision(candidateRow, "reject", "unregistered_or_wrong_role_identity_phrase");
    }
    if (clean(existing)) return decision(candidateRow, "candidate_only", "occupied_conflicting_field");
    return decision(candidateRow, "admit", "exact_registered_identity_phrase_into_empty_typed_field");
  }

  return decision(candidateRow, "reject", "unsupported_candidate_family");
}

/**
 * Resolve candidates in source order against a virtual field copy. Duplicate
 * front/back attestations therefore become `no_change`, not repeated writes.
 */
export function resolvePhraseAwareCandidatesV1(fields = {}, candidates = []) {
  const virtual = copy(fields);
  const decisions = [];
  for (const candidateRow of (Array.isArray(candidates) ? candidates : [])) {
    const resolved = resolvePhraseAwareCandidateV1(virtual, candidateRow);
    decisions.push(resolved);
    if (resolved.decision === "admit") {
      virtual[resolved.candidate_field] = resolved.candidate_value;
    }
  }
  return decisions;
}
