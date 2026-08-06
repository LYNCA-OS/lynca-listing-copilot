// Evaluation-only resolver for the field-observation-v2 capture lane.
// It admits one deliberately narrow case: a printed exact fraction whose
// numeric numerator/denominator already match the canonical serial, but whose
// leading-zero formatting was lost. Everything else remains candidate-only.

import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";

export const FIELD_OBSERVATION_RESOLVER_V1 = "field-observation-resolver-v1";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => structuredClone(value ?? {});

function serialParts(value) {
  const match = clean(value).replace(/\s*\/\s*/g, "/").match(/^(\d{1,5})\/(\d{1,5})$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function exactFraction(value) {
  return /^\d{1,5}\/\d{1,5}$/.test(clean(value));
}

function decision(candidate, disposition, reason, extra = {}) {
  return {
    resolver_schema_version: FIELD_OBSERVATION_RESOLVER_V1,
    authority: "evaluation_only",
    production_promoted: false,
    ...clone(candidate),
    disposition,
    reason,
    ...extra
  };
}

export function resolveFieldObservationCandidatesV1(fields = {}, observations = []) {
  const virtual = clone(fields);
  const decisions = [];
  for (const [index, candidate] of (Array.isArray(observations) ? observations : []).entries()) {
    const row = { index, text: clean(candidate?.text), role: clean(candidate?.role), region: clean(candidate?.region), basis: clean(candidate?.basis) };
    if (!row.text || row.basis !== "printed_text") {
      decisions.push(decision(row, "candidate_only", "observation_not_admissible_printed_text"));
      continue;
    }
    if (row.role !== "exact_code" || !exactFraction(row.text)) {
      decisions.push(decision(row, "candidate_only", "typed_target_or_exact_fraction_unproven"));
      continue;
    }
    if (row.region !== "card_front") {
      decisions.push(decision(row, "candidate_only", "exact_fraction_requires_card_front"));
      continue;
    }
    const proposed = serialParts(row.text);
    const existing = serialParts(virtual.serial);
    if (!proposed || !existing) {
      decisions.push(decision(row, "candidate_only", "no_existing_numeric_pair_for_format_only_repair"));
      continue;
    }
    if (proposed[0] !== existing[0] || proposed[1] !== existing[1]) {
      decisions.push(decision(row, "candidate_only", "numeric_pair_conflicts_existing_serial"));
      continue;
    }
    if (clean(virtual.serial) === row.text) {
      decisions.push(decision(row, "no_change", "already_same_serial_format"));
      continue;
    }
    virtual.serial = row.text;
    decisions.push(decision(row, "admitted", "same_numeric_pair_format_only", {
      candidate_field: "serial",
      before_value: clean(fields.serial),
      after_value: row.text
    }));
  }
  return { schema_version: FIELD_OBSERVATION_RESOLVER_V1, authority: "evaluation_only", production_promoted: false, fields: virtual, decisions };
}

export function applyFieldObservationResolverV1(fields = {}, observations = {}, { baselineTitle = "" } = {}) {
  const beforeFields = clone(fields);
  const beforeRender = composeFromCanonicalFields(beforeFields);
  const resolved = resolveFieldObservationCandidatesV1(beforeFields, observations);
  const afterRender = composeFromCanonicalFields(resolved.fields);
  const changedFields = Object.keys({ ...beforeFields, ...resolved.fields })
    .filter((field) => JSON.stringify(beforeFields[field] ?? null) !== JSON.stringify(resolved.fields[field] ?? null));
  const beforeTitle = clean(baselineTitle) || beforeRender.title;
  const guards = {
    only_serial_field_changed: changedFields.every((field) => field === "serial"),
    numeric_pair_unchanged: JSON.stringify(serialParts(beforeFields.serial)) === JSON.stringify(serialParts(resolved.fields.serial)),
    within_80_characters: afterRender.length <= 80,
    baseline_replayable_when_admitting: !changedFields.length || beforeTitle === beforeRender.title
  };
  const accepted = Object.values(guards).every(Boolean);
  if (!accepted) {
    return {
      schema_version: FIELD_OBSERVATION_RESOLVER_V1,
      authority: "evaluation_only",
      production_promoted: false,
      fields: beforeFields,
      title: beforeTitle,
      changed_fields: [],
      applied: false,
      decisions: resolved.decisions.map((row) => row.disposition === "admitted"
        ? { ...row, disposition: "candidate_only", reason: "safety_guard_rejected" }
        : row),
      guards,
      attempted: { fields: resolved.fields, title: afterRender.title }
    };
  }
  return {
    schema_version: FIELD_OBSERVATION_RESOLVER_V1,
    authority: "evaluation_only",
    production_promoted: false,
    fields: resolved.fields,
    title: afterRender.title,
    changed_fields: changedFields,
    applied: changedFields.length > 0,
    decisions: resolved.decisions,
    guards,
    attempted: null
  };
}

