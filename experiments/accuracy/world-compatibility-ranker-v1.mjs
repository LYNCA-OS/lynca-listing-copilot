// Evaluation-only, support-first ranking over candidates already emitted by Luna.
//
// The ranker is deliberately unable to create or rewrite a candidate value.
// Negative catalog evidence is not authoritative in the bundled v1 snapshot,
// so it may explain an abstention but may not reject a candidate.

export const worldCompatibilityRankerVersion = "world-compatibility-ranker-v1";
export const worldEdgeAuthorityContract = "world-edge-authority-v1";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const worldNorm = (value) => clean(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[®™©]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export const visibleCandidate = (candidate = {}) => candidate.visible_text === true
  || ["exact_text", "stamped_text", "logo_or_symbol"].includes(candidate.basis)
  || candidate.provenance?.visible_text === true;

export function edgeAuthorityVerified(model = {}, relation = "") {
  const contract = model.edge_contracts?.[relation];
  return contract?.schema_version === worldEdgeAuthorityContract
    && contract.semantic_values_validated === true
    && contract.coverage_exhaustive === true
    && contract.edge_provenance_complete === true
    && contract.valid_intervals_complete === true;
}

const yearFrom = (value) => clean(value).match(/(?:19|20)\d{2}/)?.[0] || null;
const yearsFrom = (value) => [...clean(value).matchAll(/(?:19|20)\d{2}/g)].map((match) => match[0]);
const phraseContains = (text, phrase) => {
  const haystack = ` ${worldNorm(text)} `;
  const needle = worldNorm(phrase);
  return needle.length >= 2 && haystack.includes(` ${needle} `);
};
const identityEquivalent = (left, right) => {
  const a = worldNorm(left);
  const b = worldNorm(right);
  return a === b || (a.length >= 4 && phraseContains(b, a)) || (b.length >= 4 && phraseContains(a, b));
};

export function buildWorldCompatibilityIndexes(model = {}) {
  const playerKeys = new Map(Object.keys(model.player_years || {}).map((key) => [worldNorm(key), key]));
  const teamPlayerKeys = new Map(Object.keys(model.player_teams || {}).map((key) => [worldNorm(key), key]));
  const products = Object.entries(model.product_years || {}).map(([key, years]) => ({
    key,
    normalized: worldNorm(key),
    years: new Set((years || []).map(String))
  })).filter((row) => row.normalized.length >= 5)
    .sort((left, right) => right.normalized.length - left.normalized.length);
  return Object.freeze({ playerKeys, teamPlayerKeys, products });
}

function findPlayerKey(value, index) {
  const normalized = worldNorm(value);
  const exact = index.get(normalized);
  if (exact) return exact;
  let best = null;
  for (const [candidate, key] of index) {
    if (normalized === candidate || normalized.startsWith(`${candidate} `) || phraseContains(normalized, candidate)) {
      if (!best || candidate.length > best.normalized.length) best = { normalized: candidate, key };
    }
  }
  return best?.key || null;
}

function visibleSubjectKeys(facts, indexes, field = "playerKeys") {
  const keys = [];
  for (const fact of facts.filter((row) => row.kind === "subject")) {
    const key = findPlayerKey(fact.value, indexes[field]);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function visibleYears(facts) {
  return new Set(facts
    .filter((row) => row.kind === "year" || row.kind === "identity")
    .flatMap((row) => yearsFrom(row.value)));
}

function stableRank(candidates, scoreFor, relation, model) {
  const decisions = candidates.map((candidate, originalIndex) => {
    const support = scoreFor(candidate);
    return Object.freeze({
      candidate,
      original_index: originalIndex,
      rank_score: support.score,
      support_edges: Object.freeze(support.edges || []),
      contradicted_by_untrusted_snapshot: support.untrustedContradiction === true,
      hard_reject_allowed: edgeAuthorityVerified(model, relation) && !visibleCandidate(candidate),
      rejected: false
    });
  });
  const orderedDecisions = [...decisions].sort((left, right) => (
    right.rank_score - left.rank_score || left.original_index - right.original_index
  ));
  return Object.freeze({
    schema_version: worldCompatibilityRankerVersion,
    relation,
    candidates: Object.freeze(orderedDecisions.map((row) => row.candidate)),
    decisions: Object.freeze(orderedDecisions),
    rejected_candidate_ids: Object.freeze([]),
    candidate_count_before: candidates.length,
    candidate_count_after: candidates.length,
    values_mutated: false,
    hard_rejection_enabled: edgeAuthorityVerified(model, relation)
  });
}

export function rankYearCandidates(candidates = [], facts = [], model = {}, indexes = buildWorldCompatibilityIndexes(model)) {
  const subjects = visibleSubjectKeys(facts, indexes);
  return stableRank(candidates, (candidate) => {
    const year = yearFrom(candidate.value);
    const supportingSubjects = year ? subjects.filter((subject) => (
      (model.player_years?.[subject] || []).map(String).includes(year)
    )) : [];
    return {
      score: supportingSubjects.length ? 1 : 0,
      edges: supportingSubjects.map((subject) => `subject_year:${subject}:${year}`),
      untrustedContradiction: Boolean(year && subjects.length && !supportingSubjects.length)
    };
  }, "subject_year", model);
}

export function rankTeamCandidates(candidates = [], facts = [], model = {}, indexes = buildWorldCompatibilityIndexes(model)) {
  const subjects = visibleSubjectKeys(facts, indexes, "teamPlayerKeys");
  const years = visibleYears(facts);
  const allowed = new Set();
  const edges = new Map();
  for (const subject of subjects) {
    let subjectHadYearCoverage = false;
    for (const year of years) {
      for (const team of model.player_team_years?.[subject]?.[year] || []) {
        subjectHadYearCoverage = true;
        allowed.add(team);
        edges.set(team, `subject_team_year:${subject}:${year}:${team}`);
      }
    }
    if (!subjectHadYearCoverage) {
      for (const team of model.player_teams?.[subject] || []) {
        allowed.add(team);
        edges.set(team, `subject_team:${subject}:${team}`);
      }
    }
  }
  return stableRank(candidates, (candidate) => {
    const matches = [...allowed].filter((team) => identityEquivalent(team, candidate.value));
    return {
      score: matches.length ? 1 : 0,
      edges: matches.map((team) => edges.get(team)),
      untrustedContradiction: Boolean(allowed.size && !matches.length)
    };
  }, "subject_team_year", model);
}

export function rankProductCandidates(candidates = [], facts = [], model = {}, indexes = buildWorldCompatibilityIndexes(model)) {
  const years = visibleYears(facts);
  return stableRank(candidates, (candidate) => {
    const matches = indexes.products.filter((product) => phraseContains(candidate.value, product.normalized));
    const compatible = matches.filter((product) => !years.size || [...years].some((year) => product.years.has(year)));
    const strongest = compatible.reduce((best, product) => (
      !best || product.normalized.length > best.normalized.length ? product : best
    ), null);
    return {
      score: strongest ? strongest.normalized.split(" ").length : 0,
      edges: strongest ? [`product_year:${strongest.key}:${[...years].filter((year) => strongest.years.has(year)).join(",") || "unknown"}`] : [],
      untrustedContradiction: Boolean(matches.length && !compatible.length)
    };
  }, "product_year", model);
}

