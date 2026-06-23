const trustedNameSourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE",
  "PUBLIC_STRUCTURED_CARD_DATABASE"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function canonicalName(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateName(candidate = {}) {
  return normalizeText(
    candidate.name
    || candidate.card_name
    || candidate.value
    || candidate.reference?.card_name
    || candidate.fields?.card_name
    || candidate.fields?.name
    || candidate.title
  );
}

function isTrustedCandidate(candidate = {}) {
  if (candidate.trusted === true) return true;
  return trustedNameSourceTypes.has(String(candidate.source_type || ""));
}

function tokens(value) {
  return new Set(canonicalName(value).split(" ").filter(Boolean));
}

function tokenJaccard(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function damerauLevenshtein(left, right) {
  const source = canonicalName(left);
  const target = canonicalName(right);
  const sourceLength = source.length;
  const targetLength = target.length;
  if (!sourceLength) return targetLength;
  if (!targetLength) return sourceLength;

  const distances = Array.from({ length: sourceLength + 1 }, () => Array(targetLength + 1).fill(0));
  for (let i = 0; i <= sourceLength; i += 1) distances[i][0] = i;
  for (let j = 0; j <= targetLength; j += 1) distances[0][j] = j;

  for (let i = 1; i <= sourceLength; i += 1) {
    for (let j = 1; j <= targetLength; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost
      );

      if (
        i > 1
        && j > 1
        && source[i - 1] === target[j - 2]
        && source[i - 2] === target[j - 1]
      ) {
        distances[i][j] = Math.min(distances[i][j], distances[i - 2][j - 2] + 1);
      }
    }
  }

  return distances[sourceLength][targetLength];
}

export function trustedNameSimilarity(left, right) {
  const leftName = canonicalName(left);
  const rightName = canonicalName(right);
  if (!leftName || !rightName) return 0;
  if (leftName === rightName) return 1;
  const maxLength = Math.max(leftName.length, rightName.length);
  const editSimilarity = maxLength ? 1 - (damerauLevenshtein(leftName, rightName) / maxLength) : 0;
  const tokenSimilarity = tokenJaccard(leftName, rightName);
  return Number(Math.max(editSimilarity, (editSimilarity * 0.82) + (tokenSimilarity * 0.18)).toFixed(6));
}

export function resolveTrustedNameCandidate({
  observedName,
  candidates = [],
  correctionThreshold = 0.8,
  reviewThreshold = 0.72,
  minimumMargin = 0.05
} = {}) {
  const observed = normalizeText(observedName);
  const comparableCandidates = candidates
    .filter(isTrustedCandidate)
    .map((candidate) => ({
      ...candidate,
      name: candidateName(candidate)
    }))
    .filter((candidate) => candidate.name);

  if (!observed) {
    return {
      status: "UNRESOLVED",
      observed_name: observed,
      resolved_name: "",
      confidence: 0,
      reason: "missing_observed_name",
      candidates: []
    };
  }

  const scored = comparableCandidates
    .map((candidate) => ({
      ...candidate,
      similarity: trustedNameSimilarity(observed, candidate.name)
    }))
    .sort((left, right) => right.similarity - left.similarity || left.name.localeCompare(right.name));
  const top = scored[0] || null;
  const secondDifferentName = top
    ? scored.find((candidate) => canonicalName(candidate.name) !== canonicalName(top.name))
    : null;
  const margin = top ? Number((top.similarity - (secondDifferentName?.similarity || 0)).toFixed(6)) : 0;

  if (!top) {
    return {
      status: "UNRESOLVED",
      observed_name: observed,
      resolved_name: observed,
      confidence: 0,
      reason: "no_trusted_candidates",
      candidates: []
    };
  }

  if (canonicalName(observed) === canonicalName(top.name)) {
    return {
      status: "EXACT",
      observed_name: observed,
      resolved_name: top.name,
      confidence: 1,
      reason: "trusted_candidate_exact_match",
      candidate_margin: margin,
      candidates: scored.slice(0, 3)
    };
  }

  if (top.similarity >= correctionThreshold && margin >= minimumMargin) {
    return {
      status: "TRUSTED_CORRECTION",
      observed_name: observed,
      resolved_name: top.name,
      confidence: top.similarity,
      reason: "trusted_candidate_high_similarity_unique_match",
      candidate_margin: margin,
      candidates: scored.slice(0, 3)
    };
  }

  if (top.similarity >= reviewThreshold) {
    return {
      status: "REVIEW_SUGGESTED",
      observed_name: observed,
      resolved_name: top.name,
      confidence: top.similarity,
      reason: margin < minimumMargin ? "trusted_candidate_low_margin" : "trusted_candidate_below_auto_correction_threshold",
      candidate_margin: margin,
      candidates: scored.slice(0, 3)
    };
  }

  return {
    status: "UNRESOLVED",
    observed_name: observed,
    resolved_name: observed,
    confidence: top.similarity,
    reason: "no_similar_trusted_candidate",
    candidate_margin: margin,
    candidates: scored.slice(0, 3)
  };
}
