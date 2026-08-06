// Evaluation-only replay of candidate facts into a copy of canonical fields.
//
// This is deliberately not imported by the thin production path. It answers a
// narrow question: can a visible identity phrase that the canonical response
// omitted be recovered without another paid model call? The original fields
// are never mutated and every proposed fill carries its source fact.

const LEGAL_SUFFIX = /,?\s+(?:L\.?L\.?C\.?|INC\.?|CORP\.?|CO\.?|LTD\.?)$/i;
const GENERIC_IDENTITY = /^(?:topps|upper deck|leaf|panini|the upper deck company|topps chrome|metaverse cards|cards?)$/i;
const LEGAL_OR_BOILERPLATE = /\b(?:company|corporation|incorporated|ltd|llc|printed in|made in|copyright|all rights reserved)\b/i;
const GENERIC_SUFFIX = /\b(?:cards?|trading cards?)\s*$/i;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
const words = (value) => new Set(norm(value).split(/\s+/).filter(Boolean));

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

function candidateSetValue(facts, fields) {
  const ranked = facts
    .filter((fact) => fact && ["identity", "affiliation"].includes(fact.kind))
    .filter((fact) => fact.basis !== "model_knowledge" && fact.image !== "none")
    // Copyright lines and issuer names are frequently visible but are not
    // marketplace set identity. Only a logo/symbol observation is strong
    // enough for this zero-cost replay; exact legal text stays evidence-only.
    .filter((fact) => fact.basis === "logo_or_symbol")
    .map((fact) => ({ ...fact, value: clean(fact.value).replace(LEGAL_SUFFIX, "").trim() }))
    .filter((fact) => fact.value.length >= 4)
    .filter((fact) => !LEGAL_OR_BOILERPLATE.test(fact.value))
    .filter((fact) => !GENERIC_IDENTITY.test(fact.value))
    .filter((fact) => !GENERIC_SUFFIX.test(fact.value))
    .filter((fact) => !alreadyNamed(fact.value, fields))
    .sort((left, right) => {
      const leftExact = left.kind === "identity" ? 1 : 0;
      const rightExact = right.kind === "identity" ? 1 : 0;
      return rightExact - leftExact || right.value.length - left.value.length;
    });
  return ranked[0] || null;
}

export function replayCandidateIdentityV1(fields = {}, candidateFacts = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];

  // A set is the only safe empty identity slot for this replay. Product and
  // manufacturer already have hierarchy rules; filling either from an
  // ambiguous logo would be an assertion, not a recovery.
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
    resolver: "candidate-identity-replay-v1",
    authority: "evaluation_only",
    production_promoted: false
  };
}

export function candidateIdentityDiagnostics(fields = {}, candidateFacts = []) {
  const candidate = candidateSetValue(candidateFacts, fields);
  return {
    empty_set: !clean(fields.set),
    proposed_set: candidate?.value || "",
    candidate_kind: candidate?.kind || "",
    candidate_basis: candidate?.basis || ""
  };
}

function cleanSerial(value) {
  return clean(value).replace(/\s*\/\s*/g, "/");
}

function serialParts(value) {
  const match = cleanSerial(value).match(/^(\d{1,5})\/(\d{1,5})$/);
  return match ? { numerator: Number(match[1]), denominator: Number(match[2]) } : null;
}

// A same-value serial replay may restore leading zeroes, but never changes a
// numerator or denominator. The observation is retained as provenance.
export function replaySerialObservationV1(fields = {}, observations = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  const candidates = observations
    .filter((observation) => ["serial_number", "serial_form", "stamped_number"].includes(observation?.label))
    .map((observation) => ({ ...observation, value: cleanSerial(observation.evidence) }))
    .filter((observation) => {
      const parts = serialParts(observation.value);
      return parts && parts.numerator > 0 && parts.denominator > 0 && parts.numerator <= parts.denominator;
    });
  const candidate = candidates[0];
  if (candidate) {
    const existing = serialParts(next.serial);
    const observed = serialParts(candidate.value);
    // This resolver only repairs formatting of a value already admitted by
    // the canonical response. An observation cannot invent a missing serial;
    // that would turn a diagnostic span into field authority.
    if (existing && existing.numerator === observed.numerator && existing.denominator === observed.denominator) {
      if (cleanSerial(next.serial) !== candidate.value) {
        next.serial = candidate.value;
        changes.push({ field: "serial", value: candidate.value, source: candidate, same_value: Boolean(existing) });
      }
    }
  }
  return { fields: next, original_fields: original, changes, resolver: "serial-observation-replay-v1", authority: "evaluation_only", production_promoted: false };
}

// Narrow evaluation candidate: only restore a leading zero when the canonical
// numerator was a single digit. The broad same-value rule also changed 29/199
// to 029/199 on the fresh confirmation cohort, so it remains stopped.
export function replaySerialObservationSingleDigitV1(fields = {}, observations = []) {
  const broad = replaySerialObservationV1(fields, observations);
  if (!broad.changes.length) {
    return { ...broad, resolver: "serial-observation-single-digit-v1" };
  }
  const existing = String(fields.serial ?? "").trim().match(/^(\d+)\s*\/\s*\d+$/);
  const observed = String(broad.fields.serial ?? "").trim().match(/^(\d+)\s*\/\s*\d+$/);
  if (!existing || !observed || existing[1].length !== 1 || !/^0\d$/.test(observed[1])) {
    return {
      ...broad,
      fields: structuredClone(fields),
      changes: [],
      resolver: "serial-observation-single-digit-v1"
    };
  }
  return { ...broad, resolver: "serial-observation-single-digit-v1" };
}

// COS-9 makes language a TCG-level field, but only an exact printed EN/JP/CN/KR
// marker is strong enough for this replay. Descriptions such as "Japanese text"
// are visual context, not a language code, and must remain evidence-only.
export function replayLanguageObservationV1(fields = {}, observations = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (String(next.grammar || "").toLowerCase() !== "tcg" || clean(next.language)) {
    return { fields: next, original_fields: original, changes, resolver: "language-observation-replay-v1", authority: "evaluation_only", production_promoted: false };
  }
  const candidate = observations
    .filter((observation) => ["language", "language_code", "language_text"].includes(observation?.label))
    .map((observation) => ({ ...observation, value: clean(observation.evidence).toUpperCase() }))
    .find((observation) => /^(EN|JP|CN|KR)$/.test(observation.value));
  if (candidate) {
    next.language = candidate.value;
    changes.push({ field: "language", value: candidate.value, source: candidate });
  }
  return { fields: next, original_fields: original, changes, resolver: "language-observation-replay-v1", authority: "evaluation_only", production_promoted: false };
}

export function replayPrintedSetObservationV1(fields = {}, observations = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (!clean(next.set)) {
    const candidates = observations
      .filter((observation) => observation?.label === "set" && observation?.kind === "printed_text")
      .map((observation) => ({ ...observation, value: clean(observation.evidence).replace(LEGAL_SUFFIX, "").trim() }))
      .filter((observation) => observation.value.length >= 3)
      .filter((observation) => !LEGAL_OR_BOILERPLATE.test(observation.value))
      .filter((observation) => !GENERIC_SUFFIX.test(observation.value))
      .filter((observation) => !alreadyNamed(observation.value, next))
      .sort((left, right) => right.value.length - left.value.length);
    const candidate = candidates[0];
    if (candidate) {
      next.set = candidate.value;
      changes.push({ field: "set", value: candidate.value, source: candidate });
    }
  }
  return { fields: next, original_fields: original, changes, resolver: "printed-set-observation-replay-v1", authority: "evaluation_only", production_promoted: false };
}
