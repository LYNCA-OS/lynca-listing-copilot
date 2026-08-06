// Evaluation-only refinement of the open identity replay.  v2 correctly
// blocked teams, graders, unions, and product fragments, but the 150-card
// audit exposed a second class of false identities: rights bodies, slab-label
// provenance, and visible sponsors.  Keep this as a small, explicit semantic
// world-knowledge veto; it is not a catalog and is not production authority.

import { replayCandidateIdentityV2 } from "./candidate-identity-replay-v2.mjs";

const NON_SET_WORLD_KNOWLEDGE = /\b(?:ptpa|mlb\s+players?|\d+\s*players?|sports\s+collectors?\s+digest|scd|players?|association|federation|union|rights?|adidas|wilson|bibigo|logo\s+on(?:\s+the)?\s+(?:basketball|ball)|nflpa|beckett|prizm)\b/i;
// A team crest is useful world evidence, but it is an affiliation rather than
// the product/set identity. These are the first false promotions found when
// the v4 150-card cohort was completed; keep the veto explicit and narrow.
const TEAM_AFFILIATION = /\b(?:fc\s+barcelona|atlanta\s+hawks|boston\s+red\s+sox|minnesota\s+twins|miami\s+marlins)\b/i;

const cleanIdentityValue = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "")
  .trim();

function isNonSetWorldKnowledge(fact = {}) {
  const value = cleanIdentityValue(fact.value);
  if (!value) return true;
  // A lone LEGENDARY back-logo is a rights/brand mark in this cohort, not the
  // product set. Keep the veto exact; "Legendary Collection" remains eligible
  // when the model observes the full phrase.
  if (fact.kind === "affiliation" && /^legendary$/i.test(value)) return true;
  if (fact.region === "slab_label" && /collectors?|digest|scd/i.test(value)) return true;
  if (fact.kind === "affiliation" && TEAM_AFFILIATION.test(value)) return true;
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
