// Evaluation-only admission for parser-approved printed markers from the same
// Luna response. This module has no provider, persistence, catalog, or world-
// knowledge authority; it only maps a closed marker vocabulary into existing
// CSM fields and then re-renders through the deterministic Composer.

import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";

export const BOUNDED_RESIDUAL_ADMISSION_V2 = "bounded-residual-admission-v2";
export const BOUNDED_RESIDUAL_ADMISSION_V2_ALLOWED_FIELDS = Object.freeze([
  "attributes",
  "components",
  "descriptive_rarity"
]);

const ALLOWED_FIELDS = new Set(BOUNDED_RESIDUAL_ADMISSION_V2_ALLOWED_FIELDS);
const APPROVED_ANCHORS = new Set(["slab_text", "front_text", "front_symbol"]);
const PHYSICAL_COMPONENT = /^(?:auto(?:graph)?|patch|relic|jersey)$/i;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();
const clone = (value) => structuredClone(value ?? {});
const tokenSet = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
// Printed marker ordinals ("1st Bowman" / "1st Edition") are not card
// identity numbers. Numeric drift guards the year, card number, serial, grade,
// and lot quantity while allowing the exact ordinal this mechanism admits.
const numericSet = (value) => new Set((clean(value)
  .replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ")
  .match(/\d+/g) || []).map((part) => String(Number(part))));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const sameSet = (left, right) => left.size === right.size
  && [...left].every((value) => right.has(value));

function markerRoute(text) {
  const normalized = key(text);
  if (["rc", "rookie card", "rated rookie"].includes(normalized)) {
    return { field: "components", value: "RC", family: "rookie" };
  }
  if (normalized === "sp") return { field: "descriptive_rarity", value: "SP", family: "rarity" };
  if (normalized === "ssp") return { field: "descriptive_rarity", value: "SSP", family: "rarity" };
  if (normalized === "1st bowman") {
    return { field: "descriptive_rarity", value: "1st Bowman", family: "rarity" };
  }
  if (normalized === "1st edition") {
    return { field: "descriptive_rarity", value: "1st Edition", family: "rarity" };
  }
  return null;
}

function parserApprovedMarker(candidate) {
  return candidate?.target === "marker"
    && candidate?.replay_eligible === true
    && candidate?.disposition === "resolver_candidate"
    && candidate?.reason === "bounded_literal_marker"
    && candidate?.automatic_csm_admission === false
    && candidate?.automatic_renderer_admission === false
    && APPROVED_ANCHORS.has(candidate?.anchor)
    && Boolean(clean(candidate?.text));
}

function addRc(fields) {
  let changed = false;
  for (const field of ["attributes", "components"]) {
    const values = Array.isArray(fields[field]) ? [...fields[field]] : [];
    if (!values.includes("RC")) {
      fields[field] = ["RC", ...values];
      changed = true;
    }
  }
  return changed;
}

function rarityResolution(existing, proposed) {
  if (!clean(existing)) return { apply: true, reason: "empty_rarity_field" };
  if (key(existing) === key(proposed)) return { apply: false, reason: "already_canonical" };
  if (key(existing) === "1st edition" && key(proposed) === "1st bowman") {
    return { apply: true, reason: "printed_marker_specializes_generic_first_edition" };
  }
  return { apply: false, reason: "descriptive_rarity_conflict" };
}

function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

/**
 * Apply only a closed set of literal printed markers already approved by the
 * residual-v1 parser. Auto/Patch/Relic/Jersey and serial evidence intentionally
 * remain candidate-only. The caller's fields and candidate array are immutable.
 */
export function applyBoundedResidualAdmissionV2(canonicalFields = {}, residualCandidates = [], {
  baselineTitle = ""
} = {}) {
  const beforeFields = clone(canonicalFields);
  const nextFields = clone(canonicalFields);
  const beforeRender = composeFromCanonicalFields(beforeFields);
  const inheritedTitle = clean(baselineTitle) || beforeRender.title;
  const candidates = Array.isArray(residualCandidates) ? residualCandidates : [];
  const decisions = [];
  const approved = [];

  for (const [index, candidate] of candidates.entries()) {
    const text = clean(candidate?.text);
    if (candidate?.target === "serial") {
      decisions.push({ index, text, target: "serial", disposition: "candidate_only", reason: "serial_out_of_scope" });
      continue;
    }
    if (candidate?.target !== "marker") {
      decisions.push({ index, text, target: clean(candidate?.target), disposition: "candidate_only", reason: "non_marker_out_of_scope" });
      continue;
    }
    if (PHYSICAL_COMPONENT.test(text)) {
      decisions.push({ index, text, target: "marker", disposition: "candidate_only", reason: "physical_component_requires_independent_evidence" });
      continue;
    }
    const route = markerRoute(text);
    if (!route) {
      decisions.push({ index, text, target: "marker", disposition: "candidate_only", reason: "unsupported_printed_marker" });
      continue;
    }
    if (!parserApprovedMarker(candidate)) {
      decisions.push({ index, text, target: "marker", field: route.field, value: route.value,
        disposition: "candidate_only", reason: "parser_approval_missing" });
      continue;
    }
    approved.push({ index, text, ...route });
  }

  const rarityValues = [...new Set(approved
    .filter(({ family }) => family === "rarity")
    .map(({ value }) => value))];
  const rarityConflict = rarityValues.length > 1;
  let rcApplied = false;
  let rarityApplied = false;
  let replacedRarity = "";

  for (const candidate of approved) {
    if (candidate.family === "rookie") {
      const changed = addRc(nextFields);
      rcApplied ||= changed;
      decisions.push({ ...candidate, disposition: changed ? "admitted" : "no_change",
        reason: changed ? "printed_rookie_marker_to_rc" : "already_canonical" });
      continue;
    }
    if (rarityConflict) {
      decisions.push({ ...candidate, disposition: "candidate_only", reason: "multiple_rarity_markers_conflict" });
      continue;
    }
    const resolution = rarityResolution(nextFields.descriptive_rarity, candidate.value);
    if (!resolution.apply) {
      decisions.push({ ...candidate, disposition: resolution.reason === "already_canonical" ? "no_change" : "candidate_only",
        reason: resolution.reason });
      continue;
    }
    replacedRarity = clean(nextFields.descriptive_rarity);
    nextFields.descriptive_rarity = candidate.value;
    rarityApplied = true;
    decisions.push({ ...candidate, disposition: "admitted", reason: resolution.reason });
  }

  const attemptedAdmission = rcApplied || rarityApplied;
  const afterRender = attemptedAdmission
    ? composeFromCanonicalFields(nextFields)
    : { ...beforeRender, title: inheritedTitle, length: inheritedTitle.length };
  const mutations = changedFields(beforeFields, nextFields);
  const beforeTokens = tokenSet(inheritedTitle);
  const afterTokens = tokenSet(afterRender.title);
  const allowedDisplacedTokens = rarityApplied ? tokenSet(replacedRarity) : new Set();
  const unexpectedLostTokens = difference(beforeTokens, afterTokens)
    .filter((token) => !allowedDisplacedTokens.has(token));
  const guards = {
    allowed_field_mutations_only: mutations.every((field) => ALLOWED_FIELDS.has(field)),
    numeric_tokens_unchanged: sameSet(numericSet(inheritedTitle), numericSet(afterRender.title)),
    subjects_unchanged: JSON.stringify(beforeFields.subjects || []) === JSON.stringify(nextFields.subjects || []),
    no_unexpected_title_token_loss: unexpectedLostTokens.length === 0,
    within_80_characters: afterRender.length <= 80,
    inherited_title_replayable_when_admitting: !attemptedAdmission || inheritedTitle === beforeRender.title
  };
  const accepted = Object.values(guards).every(Boolean);

  if (!accepted) {
    return {
      schema_version: BOUNDED_RESIDUAL_ADMISSION_V2,
      authority: "evaluation_only",
      production_promoted: false,
      provider_calls: 0,
      fields: beforeFields,
      title: inheritedTitle,
      changed_fields: [],
      changed_title: false,
      decisions: decisions.map((decision) => decision.disposition === "admitted"
        ? { ...decision, disposition: "candidate_only", reason: "safety_guard_rejected" }
        : decision),
      guards,
      guard_details: { unexpected_lost_tokens: unexpectedLostTokens, attempted_changed_fields: mutations },
      attempted: { fields: nextFields, title: afterRender.title },
      applied: false
    };
  }

  return {
    schema_version: BOUNDED_RESIDUAL_ADMISSION_V2,
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    fields: nextFields,
    title: afterRender.title,
    changed_fields: mutations,
    changed_title: afterRender.title !== inheritedTitle,
    decisions,
    guards,
    guard_details: { unexpected_lost_tokens: [], attempted_changed_fields: mutations },
    attempted: null,
    applied: attemptedAdmission
  };
}
