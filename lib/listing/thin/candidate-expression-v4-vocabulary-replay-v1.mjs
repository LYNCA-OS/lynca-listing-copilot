// Evaluation-only replay of a narrow candidate-expression channel.
//
// Candidate facts are not canonical fields. This resolver is deliberately
// stricter than the v4 capture prompt: it admits only an empty slot, a printed
// fact, and a value the local catalog can attest for the target field. It is a
// measurement instrument, not a production import path.

import {
  attestFieldValue,
  attestedParallelWording
} from "../catalog/field-vocabulary-store.mjs";

export const CANDIDATE_EXPRESSION_V4_VOCABULARY_REPLAY_VERSION =
  "candidate-expression-v4-vocabulary-replay-v1";

const PRINTED_BASES = new Set(["exact_text", "stamped_text"]);
const PRINTED_RARITY = new Map([
  ["ssp", "SSP"],
  ["sp", "SP"],
  ["1st bowman", "1ST BOWMAN"],
  ["1st edition", "1ST EDITION"]
]);
const GENERIC_INSERT_WORDING = new Set(["base", "card", "cards", "insert", "null", "parallel"]);

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLocaleLowerCase("en-US");
const sameValue = (left, right) => normalized(left) === normalized(right);

function candidateFacts(facts) {
  return (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact && typeof fact === "object")
    .map((fact, index) => ({
      ...fact,
      value: clean(fact.value),
      source_index: index
    }))
    .filter((fact) => fact.value && PRINTED_BASES.has(fact.basis));
}

function alreadyNamed(value, fields) {
  const wanted = normalized(value);
  if (!wanted) return true;
  return [fields.manufacturer, fields.product, fields.set, fields.card_name,
    fields.parallel_exact, fields.descriptive_rarity, ...(fields.subjects || [])]
    .some((existing) => normalized(existing) === wanted);
}

function insertCandidate(fields, facts, vocabularyOptions) {
  if (clean(fields.card_name)) return { decision: "slot_occupied", field: "card_name" };
  const candidates = facts
    .filter((fact) => fact.kind === "identity")
    .filter((fact) => fact.value.length <= 96)
    .filter((fact) => !GENERIC_INSERT_WORDING.has(normalized(fact.value)))
    .filter((fact) => !alreadyNamed(fact.value, fields));
  for (const fact of candidates) {
    const attestation = attestFieldValue("insert", fact.value, vocabularyOptions);
    if (attestation.attested) {
      return {
        field: "card_name",
        value: fact.value,
        source: fact,
        attestation,
        reason: "printed_insert_vocabulary"
      };
    }
  }
  return { decision: "no_attested_candidate", field: "card_name" };
}

function finishCandidate(fields, facts, vocabularyOptions) {
  if (clean(fields.parallel_exact)) return { decision: "slot_occupied", field: "parallel_exact" };
  const candidates = facts
    .filter((fact) => fact.kind === "finish")
    .filter((fact) => fact.value.length <= 96)
    .filter((fact) => !alreadyNamed(fact.value, fields));
  for (const fact of candidates) {
    if (attestedParallelWording(fact.value, vocabularyOptions)) {
      const attestation = attestFieldValue("print_finish", fact.value, vocabularyOptions);
      return {
        field: "parallel_exact",
        value: fact.value,
        source: fact,
        attestation,
        reason: "printed_parallel_vocabulary"
      };
    }
  }
  return { decision: "no_attested_candidate", field: "parallel_exact" };
}

function rarityCandidate(fields, facts) {
  if (clean(fields.descriptive_rarity)) return { decision: "slot_occupied", field: "descriptive_rarity" };
  for (const fact of facts) {
    if (fact.kind !== "attribute") continue;
    const key = normalized(fact.value);
    const value = PRINTED_RARITY.get(key);
    if (value) {
      return {
        field: "descriptive_rarity",
        value,
        source: fact,
        reason: "printed_rarity_literal"
      };
    }
  }
  return { decision: "no_attested_candidate", field: "descriptive_rarity" };
}

export function replayCandidateExpressionV4VocabularyV1(
  fields = {},
  visibleFacts = [],
  { vocabularyOptions = {} } = {}
) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  const decisions = [];
  const facts = candidateFacts(visibleFacts);

  for (const proposal of [
    insertCandidate(next, facts, vocabularyOptions),
    finishCandidate(next, facts, vocabularyOptions),
    rarityCandidate(next, facts)
  ]) {
    if (!proposal.value || !proposal.field || clean(next[proposal.field])) {
      decisions.push(proposal);
      continue;
    }
    next[proposal.field] = proposal.value;
    const change = {
      field: proposal.field,
      value: proposal.value,
      reason: proposal.reason,
      source: proposal.source,
      ...(proposal.attestation ? { attestation: proposal.attestation } : {})
    };
    changes.push(change);
    decisions.push({ ...proposal, disposition: "admitted" });
  }

  return {
    fields: next,
    original_fields: original,
    changes,
    decisions,
    candidate_fact_count: facts.length,
    resolver: CANDIDATE_EXPRESSION_V4_VOCABULARY_REPLAY_VERSION,
    authority: "evaluation_only",
    production_promoted: false
  };
}
