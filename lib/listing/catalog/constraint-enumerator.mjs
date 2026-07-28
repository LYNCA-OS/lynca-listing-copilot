// Forward, typed use of the compact catalog constraint model.
//
// VALUE   coverage determines one answer.
// EMPTY   the field does not apply.
// UNKNOWN coverage cannot decide; candidates remain hints, never refutations.
//
// This module creates recognition-layer candidates only. It never mutates
// resolved fields or titles; Identity Resolver remains the canonical owner.

import { createHash } from "node:crypto";
import { csmEmpty, csmValue } from "../csm/contracts/csm-stage-contracts.mjs";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const norm = (value) => cleanText(value).toLowerCase().replace(/[®™©]/g, "").trim();

export const constraintEnumerationVersion = "constraint-enumerator-v3";
export const constraintCandidateSchemaVersion = "constraint-candidate-v1";
export const outcomes = Object.freeze({ VALUE: "VALUE", EMPTY: "EMPTY", UNKNOWN: "UNKNOWN" });
export const decisiveTeamValueContract = "team-identity-semantics-v1";

const TEAM_BEARING_SPORTS = new Set([
  "football", "american football", "basketball", "baseball", "hockey", "ice hockey",
  "soccer", "cricket", "rugby", "lacrosse", "nfl", "nba", "mlb", "nhl", "mls"
]);
const TEAMLESS_SPORTS = new Set([
  "tcg", "entertainment", "gaming", "non-sport", "nonsport", "tennis", "golf",
  "racing", "wwe", "ufc", "wrestling", "mma", "boxing"
]);
const GENERIC_SET_KEYS = new Set([
  "base", "base set", "card", "cards", "default", "insert", "inserts", "parallel",
  "regular", "rookie", "rookies", "set", "standard", "unknown"
]);
const MANUFACTURER_MARKERS = Object.freeze([
  "upper deck", "press pass", "wild card", "wizards of the coast", "panini", "topps",
  "bowman", "donruss", "leaf", "fleer", "bandai", "konami", "pokemon", "pokémon",
  "fanatics", "tristar", "sage", "score"
]);

function seasonStartYear(value) {
  const match = cleanText(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function provenance(model = {}, ruleId = "") {
  const teamContract = teamValueAuthorityVerified(model)
    ? decisiveTeamValueContract
    : null;
  return Object.freeze({
    source: "CATALOG_CONSTRAINT_SNAPSHOT",
    trust: "CONSENSUS_FACT",
    version: cleanText(model.snapshot_version || model.schema_version || model.version || model.generated_at) || "unversioned",
    rule_id: ruleId,
    source_card_count: Number(model.source_card_count || 0) || null,
    team_value_contract: teamContract
  });
}

function teamValueAuthorityVerified(model = {}) {
  const contract = model.team_value_contract;
  return contract
    && typeof contract === "object"
    && contract.schema_version === decisiveTeamValueContract
    && contract.semantic_values_validated === true
    && contract.subject_coverage_exhaustive === true;
}

function specificSetIdentity(value = "") {
  const set = norm(value);
  return set.length >= 3
    && !GENERIC_SET_KEYS.has(set)
    && !/^(?:19|20)\d{2}(?:[-/]\d{2,4})?$/.test(set);
}

function textContainsBoundedPhrase(text = "", phrase = "") {
  const escaped = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function productExplicitlyMatchesManufacturer(product = "", claim = {}) {
  const manufacturer = norm(claim.manufacturer || claim.brand);
  const normalizedProduct = norm(product);
  if (!manufacturer || !normalizedProduct) return false;
  const marker = MANUFACTURER_MARKERS.find((candidate) => (
    textContainsBoundedPhrase(manufacturer, candidate)
  ));
  const fallback = manufacturer
    .replace(/\b(?:the|company|co|inc|incorporated|llc|ltd|america|international)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const identity = marker || fallback;
  return identity.length >= 3 && textContainsBoundedPhrase(normalizedProduct, identity);
}

function decisiveProductResult(value, candidates, reason, claim, model) {
  if (!productExplicitlyMatchesManufacturer(value, claim)) {
    return result(outcomes.UNKNOWN, {
      candidates,
      reason: "product_manufacturer_not_explicitly_compatible",
      model
    });
  }
  return result(outcomes.VALUE, { value, candidates, reason, model });
}

function result(status, { value = null, candidates = [], reason, model = {} }) {
  return Object.freeze({
    status,
    value,
    candidates: Object.freeze([...new Set(candidates.map(cleanText).filter(Boolean))]),
    reason,
    provenance: provenance(model, reason)
  });
}

export function enumerateTeam(claim = {}, model = null) {
  if (!model) return result(outcomes.UNKNOWN, { reason: "no_model", model: {} });
  const sport = norm(claim.sport || claim.ip_sport);
  if (sport && TEAMLESS_SPORTS.has(sport)) {
    return result(outcomes.EMPTY, { reason: "sport_has_no_teams", model });
  }
  const player = norm(Array.isArray(claim.players) && claim.players.length ? claim.players[0] : claim.player || claim.subject);
  if (!player) return result(outcomes.UNKNOWN, { reason: "no_subject_read", model });
  if (!sport || !TEAM_BEARING_SPORTS.has(sport)) {
    return result(outcomes.UNKNOWN, { reason: "team_applicability_unverified", model });
  }
  const teams = model.player_teams?.[player];
  // The current compact snapshot was inferred from heterogeneous catalog
  // columns and contains labels such as "rookie" and "raw" in player_teams.
  // A single row is therefore not proof of a single team. Only a future
  // compiler snapshot carrying an explicit semantic + exhaustive contract may
  // promote team to VALUE; until then the entire family is support-only.
  if (!teamValueAuthorityVerified(model)) {
    return result(outcomes.UNKNOWN, { reason: "team_value_contract_unverified", model });
  }
  if (!Array.isArray(teams) || !teams.length) {
    return result(outcomes.UNKNOWN, { reason: "subject_not_in_model", model });
  }
  if (teams.length === 1) {
    return result(outcomes.VALUE, { value: teams[0], candidates: teams, reason: "single_team_in_career", model });
  }
  const year = seasonStartYear(claim.year ?? claim.season_year);
  const byYear = year ? model.player_team_years?.[player]?.[String(year)] : null;
  if (Array.isArray(byYear) && byYear.length === 1) {
    return result(outcomes.VALUE, { value: byYear[0], candidates: byYear, reason: "year_narrows_to_one_team", model });
  }
  if (Array.isArray(byYear) && byYear.length > 1) {
    return result(outcomes.UNKNOWN, { candidates: byYear, reason: "year_narrows_but_not_to_one", model });
  }
  return result(outcomes.UNKNOWN, { candidates: teams, reason: "multiple_teams_in_career", model });
}

export function enumerateProduct(claim = {}, model = null) {
  if (!model) return result(outcomes.UNKNOWN, { reason: "no_model", model: {} });
  const set = norm(claim.set || claim.subset || claim.set_or_insert || claim.insert || claim.card_name);
  if (!set) return result(outcomes.UNKNOWN, { reason: "no_set_name_read", model });
  if (!specificSetIdentity(set)) {
    return result(outcomes.UNKNOWN, { reason: "set_identity_not_specific", model });
  }
  const entries = model.set_product_years?.[set];
  if (!Array.isArray(entries) || !entries.length) {
    return result(outcomes.UNKNOWN, { reason: "set_not_in_model", model });
  }
  const year = seasonStartYear(claim.year ?? claim.season_year);
  if (year) {
    const forYear = [...new Set(entries
      .filter((entry) => seasonStartYear(cleanText(entry).split("|")[0]) === year)
      .map((entry) => cleanText(entry).split("|").at(-1)).filter(Boolean))];
    if (forYear.length === 1) {
      return decisiveProductResult(forYear[0], forYear, "year_narrows_to_one_product", claim, model);
    }
    if (forYear.length > 1) {
      return result(outcomes.UNKNOWN, { candidates: forYear, reason: "year_narrows_but_not_to_one", model });
    }
    return result(outcomes.UNKNOWN, { reason: "set_not_covered_for_year", model });
  }
  const products = [...new Set(entries.map((entry) => cleanText(entry).split("|").at(-1)).filter(Boolean))];
  if (products.length === 1) {
    return decisiveProductResult(products[0], products, "set_identifies_one_product", claim, model);
  }
  return result(outcomes.UNKNOWN, { candidates: products, reason: "set_used_by_several_products", model });
}

export function enumerateAll(claim = {}, model = null) {
  return Object.freeze({
    team: enumerateTeam(claim, model),
    product: enumerateProduct(claim, model)
  });
}

function candidateId(field, outcome) {
  const stable = JSON.stringify([field, outcome.status, outcome.value, outcome.candidates, outcome.provenance]);
  return `constraint:${field}:${createHash("sha256").update(stable).digest("hex").slice(0, 16)}`;
}

function registryEvidence(field, outcome) {
  const id = `${candidateId(field, outcome)}:evidence`;
  return {
    id,
    bracket: field === "team" ? "search_optimization" : field,
    modality: "REGISTRY",
    confidence: outcome.status === outcomes.VALUE || outcome.status === outcomes.EMPTY ? 1 : 0,
    source_ref: outcome.provenance,
    normalized_value: outcome.status === outcomes.EMPTY ? null : outcome.value,
    normalization: {
      version: constraintEnumerationVersion,
      outcome: outcome.status === outcomes.UNKNOWN ? "DROPPED" : "KEPT",
      reason_code: outcome.reason
    }
  };
}

// UNKNOWN remains in `trace` only because the CSM candidate contract correctly
// has no UNKNOWN canonical value. This makes absence of coverage observable
// without allowing it to become a false value or a contradiction.
export function buildForwardEnumerationCandidatePacket(claim = {}, model = null) {
  const enumeration = enumerateAll(claim, model);
  const evidence = [];
  const candidates = [];
  for (const [field, outcome] of Object.entries(enumeration)) {
    if (outcome.status === outcomes.UNKNOWN) continue;
    const observation = registryEvidence(field, outcome);
    evidence.push(observation);
    candidates.push({
      id: candidateId(field, outcome),
      bracket: field === "team" ? "search_optimization" : field,
      value: outcome.status === outcomes.EMPTY ? csmEmpty("ABSENT") : csmValue(outcome.value),
      supporting_evidence_ids: [observation.id],
      contradicting_evidence_ids: [],
      source_trust: outcome.provenance.trust,
      confidence: 1,
      derived_field: field,
      provenance: outcome.provenance
    });
  }
  return Object.freeze({
    schema_version: constraintCandidateSchemaVersion,
    enumerator_version: constraintEnumerationVersion,
    evidence: Object.freeze(evidence),
    candidates: Object.freeze(candidates),
    trace: Object.freeze(Object.entries(enumeration).map(([field, outcome]) => Object.freeze({ field, ...outcome })))
  });
}
