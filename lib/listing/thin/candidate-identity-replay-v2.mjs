// Evaluation-only replay of visible identity candidates into an empty set slot.
//
// v1 treated every logo/affiliation as a possible set.  That made team,
// grader, and union marks compete with the actual set, and let product
// fragments such as "Optic O" become false set values.  v2 keeps the same
// zero-cost, evaluation-only boundary but adds two semantic facts:
//   1. set candidates must be identity observations, not affiliations;
//   2. a candidate sharing a meaningful token with manufacturer/product is a
//      product fragment, not an independent set.

const LEGAL_SUFFIX = /,?\s+(?:L\.?L\.?C\.?|INC\.?|CORP\.?|CO\.?|LTD\.?)$/i;
const GENERIC_IDENTITY = /^(?:topps|upper deck|leaf|panini|the upper deck company|topps chrome|metaverse cards|cards?)$/i;
const LEGAL_OR_BOILERPLATE = /\b(?:company|corporation|incorporated|ltd|llc|printed in|made in|copyright|all rights reserved)\b/i;
const GENERIC_SUFFIX = /\b(?:cards?|trading cards?)\s*$/i;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value) => norm(value).split(/\s+/).filter((token) => token.length >= 3);

function comparable(value) {
  return norm(value).replace(/\b(?:l l c|inc|corp|co|ltd)\b/g, "").replace(/\s+/g, " ").trim();
}

function alreadyNamed(value, fields) {
  const candidate = comparable(value);
  if (!candidate) return true;
  return [fields.manufacturer, fields.product, fields.set, fields.card_name,
    ...(fields.subjects || [])].some((existing) => {
    const current = comparable(existing);
    return current && (current === candidate || current.includes(candidate) || candidate.includes(current));
  });
}

function overlapsManufacturerOrProduct(value, fields) {
  const candidate = new Set(tokens(value));
  const named = new Set(tokens(fields.manufacturer));
  for (const token of tokens(fields.product)) named.add(token);
  return [...candidate].some((token) => named.has(token));
}

function candidateSetValue(facts, fields) {
  const ranked = facts
    .filter((fact) => fact?.kind === "identity")
    .filter((fact) => fact.basis !== "model_knowledge" && fact.image !== "none")
    .filter((fact) => fact.basis === "logo_or_symbol")
    .map((fact) => ({ ...fact, value: clean(fact.value).replace(LEGAL_SUFFIX, "").trim() }))
    .filter((fact) => fact.value.length >= 4)
    .filter((fact) => !LEGAL_OR_BOILERPLATE.test(fact.value))
    .filter((fact) => !GENERIC_IDENTITY.test(fact.value))
    .filter((fact) => !GENERIC_SUFFIX.test(fact.value))
    .filter((fact) => !alreadyNamed(fact.value, fields))
    .filter((fact) => !overlapsManufacturerOrProduct(fact.value, fields))
    .sort((left, right) => right.value.length - left.value.length);
  return ranked[0] || null;
}

export function replayCandidateIdentityV2(fields = {}, candidateFacts = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (!clean(next.set)) {
    const candidate = candidateSetValue(candidateFacts, next);
    if (candidate) {
      next.set = candidate.value;
      changes.push({ field: "set", value: candidate.value, source: candidate });
    }
  }
  return {
    fields: next,
    original_fields: original,
    changes,
    resolver: "candidate-identity-replay-v2",
    authority: "evaluation_only",
    production_promoted: false
  };
}

export function candidateIdentityDiagnosticsV2(fields = {}, candidateFacts = []) {
  const candidate = candidateSetValue(candidateFacts, fields);
  return {
    empty_set: !clean(fields.set),
    proposed_set: candidate?.value || "",
    candidate_kind: candidate?.kind || "",
    candidate_basis: candidate?.basis || ""
  };
}
