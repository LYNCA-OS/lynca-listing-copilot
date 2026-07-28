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

export const constraintEnumerationVersion = "constraint-enumerator-v2";
export const constraintCandidateSchemaVersion = "constraint-candidate-v1";
export const outcomes = Object.freeze({ VALUE: "VALUE", EMPTY: "EMPTY", UNKNOWN: "UNKNOWN" });

const TEAM_BEARING_SPORTS = new Set([
  "football", "basketball", "baseball", "hockey", "soccer", "wwe", "ufc", "racing", "golf"
]);
const TEAMLESS_SPORTS = new Set(["tcg", "entertainment", "gaming", "non-sport", "nonsport"]);

function seasonStartYear(value) {
  const match = cleanText(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function provenance(model = {}, ruleId = "") {
  return Object.freeze({
    source: "CATALOG_CONSTRAINT_SNAPSHOT",
    trust: "CONSENSUS_FACT",
    version: cleanText(model.snapshot_version || model.schema_version || model.version || model.generated_at) || "unversioned",
    rule_id: ruleId,
    source_card_count: Number(model.source_card_count || 0) || null
  });
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
  const teams = model.player_teams?.[player];
  if (!Array.isArray(teams) || !teams.length) {
    if (sport && !TEAM_BEARING_SPORTS.has(sport)) {
      return result(outcomes.EMPTY, { reason: "sport_has_no_teams", model });
    }
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
  const entries = model.set_product_years?.[set];
  if (!Array.isArray(entries) || !entries.length) {
    return result(outcomes.UNKNOWN, { reason: "set_not_in_model", model });
  }
  const products = [...new Set(entries.map((entry) => cleanText(entry).split("|").at(-1)).filter(Boolean))];
  if (products.length === 1) {
    return result(outcomes.VALUE, { value: products[0], candidates: products, reason: "set_identifies_one_product", model });
  }
  const year = seasonStartYear(claim.year ?? claim.season_year);
  if (year) {
    const forYear = [...new Set(entries
      .filter((entry) => cleanText(entry).startsWith(`${year}|`))
      .map((entry) => cleanText(entry).split("|").at(-1)).filter(Boolean))];
    if (forYear.length === 1) {
      return result(outcomes.VALUE, { value: forYear[0], candidates: forYear, reason: "year_narrows_to_one_product", model });
    }
    if (forYear.length > 1) {
      return result(outcomes.UNKNOWN, { candidates: forYear, reason: "year_narrows_but_not_to_one", model });
    }
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
