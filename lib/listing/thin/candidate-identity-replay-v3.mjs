// Evaluation-only refinement of the open identity replay.  v2 correctly
// blocked teams, graders, unions, and product fragments, but the 150-card
// audit exposed a second class of false identities: rights bodies, slab-label
// provenance, and visible sponsors.  Keep this as a small, explicit semantic
// world-knowledge veto; it is not a catalog and is not production authority.

import { replayCandidateIdentityV2 } from "./candidate-identity-replay-v2.mjs";

const NON_SET_WORLD_KNOWLEDGE = /\b(?:ptpa|mlb\s+players?|sports\s+collectors?\s+digest|scd|players?|association|federation|union|rights?|adidas|wilson|bibigo|logo\s+on(?:\s+the)?\s+(?:basketball|ball)|nflpa|beckett|prizm)\b/i;

const cleanIdentityValue = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "")
  .trim();

function isNonSetWorldKnowledge(fact = {}) {
  const value = cleanIdentityValue(fact.value);
  if (!value) return true;
  if (fact.region === "slab_label" && /collectors?|digest|scd/i.test(value)) return true;
  return NON_SET_WORLD_KNOWLEDGE.test(value);
}

export function replayCandidateIdentityV3(fields = {}, candidateFacts = []) {
  const admittedFacts = (candidateFacts || [])
    .filter((fact) => !isNonSetWorldKnowledge(fact))
    .map((fact) => ({ ...fact, value: cleanIdentityValue(fact.value) }));
  const replay = replayCandidateIdentityV2(fields, admittedFacts);
  return {
    ...replay,
    resolver: "candidate-identity-replay-v3",
    admitted_fact_count: admittedFacts.length,
    rejected_fact_count: Math.max(0, (candidateFacts || []).length - admittedFacts.length),
    rejected_facts: (candidateFacts || []).filter((fact) => isNonSetWorldKnowledge(fact))
  };
}

export function candidateIdentityDiagnosticsV3(fields = {}, candidateFacts = []) {
  const replay = replayCandidateIdentityV3(fields, candidateFacts);
  return {
    empty_set: !String(fields.set ?? "").trim(),
    proposed_set: replay.fields.set || "",
    admitted_fact_count: replay.admitted_fact_count,
    rejected_fact_count: replay.rejected_fact_count
  };
}
