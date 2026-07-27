// Pure, policy-free alignment between an observed identity claim and a
// caller-supplied set of authoritative candidates. This module deliberately
// performs no I/O and is not wired into recognition. Candidate generation and
// the decision to suppress, replace, or retain a claim belong to other owners.

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const entityAlignmentRelations = Object.freeze({
  EXACT: "EXACT",
  SPELLING: "SPELLING",
  PREFIX: "PREFIX",
  HYPERNYM: "HYPERNYM",
  NONE: "NONE"
});

const relationPriority = Object.freeze({
  [entityAlignmentRelations.EXACT]: 5,
  [entityAlignmentRelations.SPELLING]: 4,
  [entityAlignmentRelations.PREFIX]: 3,
  [entityAlignmentRelations.HYPERNYM]: 2,
  [entityAlignmentRelations.NONE]: 1
});

const contextOnlyTokens = new Set([
  "panini", "topps", "upper", "deck", "bowman", "leaf",
  "football", "basketball", "baseball", "soccer", "hockey", "tennis",
  "cards", "card", "collection"
]);

export function normalizeEntityText(value = "") {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(\s*\d{2}\s*[-/]\s*\d{2}\s*\)/g, " ")
    .replace(/\b(?:19|20)\d{2}(?:\s*[-/]\s*\d{2,4})?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return normalizeEntityText(value).split(" ").filter(Boolean);
}

function coreTokens(value) {
  const all = tokens(value);
  const core = all.filter((token) => !contextOnlyTokens.has(token));
  return core.length ? core : all;
}

function isStrictSubset(left, right) {
  if (!left.length || left.length >= right.length) return false;
  const rightSet = new Set(right);
  return left.every((token) => rightSet.has(token));
}

export function levenshteinDistance(left = "", right = "") {
  const a = normalizeEntityText(left);
  const b = normalizeEntityText(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export function classifyEntityRelation(claim = "", candidate = "") {
  const normalizedClaim = normalizeEntityText(claim);
  const normalizedCandidate = normalizeEntityText(candidate);
  if (!normalizedClaim || !normalizedCandidate) return entityAlignmentRelations.NONE;
  if (normalizedClaim === normalizedCandidate) return entityAlignmentRelations.EXACT;

  const claimTokens = tokens(normalizedClaim);
  const candidateTokens = tokens(normalizedCandidate);
  if (claimTokens.length === candidateTokens.length) {
    const distance = levenshteinDistance(normalizedClaim, normalizedCandidate);
    const permittedDistance = Math.max(1, Math.floor(Math.max(normalizedClaim.length, normalizedCandidate.length) * 0.08));
    if (distance <= permittedDistance) return entityAlignmentRelations.SPELLING;
  }

  if (normalizedCandidate.startsWith(`${normalizedClaim} `)
    || normalizedClaim.startsWith(`${normalizedCandidate} `)) {
    return entityAlignmentRelations.PREFIX;
  }

  const claimCore = coreTokens(normalizedClaim);
  const candidateCore = coreTokens(normalizedCandidate);
  if (normalizeEntityText(claimCore.join(" ")) === normalizeEntityText(candidateCore.join(" "))
    || isStrictSubset(claimCore, candidateCore)
    || isStrictSubset(candidateCore, claimCore)) {
    return entityAlignmentRelations.HYPERNYM;
  }

  const claimSet = new Set(claimCore);
  const candidateSet = new Set(candidateCore);
  const intersection = [...claimSet].filter((token) => candidateSet.has(token)).length;
  const union = new Set([...claimSet, ...candidateSet]).size;
  if (intersection >= 2 && union > 0 && intersection / union >= 0.6) {
    return entityAlignmentRelations.HYPERNYM;
  }
  return entityAlignmentRelations.NONE;
}

function normalizeCandidate(candidate, index) {
  if (typeof candidate === "string") {
    return { id: `candidate-${index}`, value: cleanText(candidate), kind: null, metadata: null };
  }
  return {
    id: cleanText(candidate?.id) || `candidate-${index}`,
    value: cleanText(candidate?.value ?? candidate?.name),
    kind: cleanText(candidate?.kind) || null,
    metadata: candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : null
  };
}

export function alignEntityClaim(claim = "", candidates = []) {
  const normalizedClaim = normalizeEntityText(claim);
  const available = (Array.isArray(candidates) ? candidates : [])
    .map(normalizeCandidate)
    .filter((candidate) => candidate.value);
  if (!normalizedClaim || !available.length) {
    return {
      claim: cleanText(claim) || null,
      normalized_claim: normalizedClaim || null,
      checked: false,
      status: "UNCHECKED",
      relation: null,
      selected_candidate: null,
      candidates: [],
      ambiguous: false,
      reason: normalizedClaim ? "authoritative_candidate_coverage_absent" : "claim_absent"
    };
  }

  const scored = available.map((candidate) => ({
    ...candidate,
    relation: classifyEntityRelation(claim, candidate.value)
  }));
  const bestPriority = Math.max(...scored.map((candidate) => relationPriority[candidate.relation]));
  const best = scored.filter((candidate) => relationPriority[candidate.relation] === bestPriority);
  const relation = best[0]?.relation || entityAlignmentRelations.NONE;
  const ambiguous = relation !== entityAlignmentRelations.NONE && best.length !== 1;
  return {
    claim: cleanText(claim),
    normalized_claim: normalizedClaim,
    checked: true,
    status: "CHECKED",
    relation,
    selected_candidate: relation !== entityAlignmentRelations.NONE && !ambiguous ? best[0] : null,
    candidates: best,
    ambiguous,
    reason: relation === entityAlignmentRelations.NONE
      ? "no_semantic_alignment_in_authoritative_candidates"
      : ambiguous
        ? "multiple_equally_supported_candidates"
        : "unique_best_alignment"
  };
}

export function uniqueAlignedValue(claim = "", candidates = []) {
  return alignEntityClaim(claim, candidates).selected_candidate?.value || null;
}
