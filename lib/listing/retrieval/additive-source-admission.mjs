// Admit a newly ingested catalog source without letting it move the existing
// recall distribution.
//
// Adding rows to the catalog is not a neutral act. rankRetrievalCandidates
// derives `candidate_margin` as top.match_score - second.match_score, so a new
// row that merely lands in second place shrinks the margin and can flip a card
// from "selected" to "candidate_margin_below_selection_threshold". A catalog
// expansion can therefore make previously-correct cards worse without ever
// being selected for any of them, which makes the resulting eval delta
// impossible to attribute.
//
// So a cohort under evaluation is ranked separately from the incumbents:
//   * selection, margin and conflicts come from the incumbent ranking alone,
//     byte-identical to what they were before the ingestion;
//   * cohort rows are appended after the incumbents, never selected, and
//     marked so downstream layers can tell them apart.
//
// The cohort can still do the one thing it was ingested for -- fill a field no
// incumbent supplied, via the catalog_fills_unresolved_field path in
// retrieval-application-layer.mjs -- because that path reads the candidate
// list, not the selection.
//
// This is meant to be temporary scaffolding for one cohort at a time: prove the
// cohort is a positive asset while it cannot displace anything, then graduate
// it into normal ranking and re-measure.

const ADDITIVE_ADMISSION = "additive_only";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function envFlag(env = process.env, name = "", fallback = false) {
  const raw = cleanText(env?.[name]).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

// Which ingest cohort a candidate belongs to, if any.
export function candidateCohort(candidate = {}) {
  return cleanText(
    candidate.ingest_cohort
    || candidate.reference_metadata?.ingest_cohort
    || candidate.source_metadata?.ingest_cohort
  );
}

export function additiveCohorts(env = process.env) {
  return new Set(
    cleanText(env?.RETRIEVAL_ADDITIVE_ONLY_COHORTS)
      .split(",")
      .map((value) => cleanText(value))
      .filter(Boolean)
  );
}

export function splitByCohort(candidates = [], cohorts = new Set()) {
  const incumbents = [];
  const additive = [];
  for (const candidate of candidates) {
    const cohort = candidateCohort(candidate);
    if (cohort && cohorts.has(cohort)) additive.push(candidate);
    else incumbents.push(candidate);
  }
  return { incumbents, additive };
}

// Rank with the cohort held out of selection entirely.
//
// `rank` is injected rather than imported so this stays a pure reordering
// concern and the caller keeps control of ranking options.
export function rankWithAdditiveAdmission(candidates = [], resolved = {}, {
  rank,
  cohorts = new Set(),
  rankOptions = {}
} = {}) {
  if (typeof rank !== "function") throw new TypeError("rank function is required");
  if (!cohorts.size) return rank(candidates, resolved, rankOptions);

  const { incumbents, additive } = splitByCohort(candidates, cohorts);
  // No cohort rows retrieved: nothing to reconcile, and the result must be
  // identical to the unmodified path.
  if (!additive.length) return rank(candidates, resolved, rankOptions);

  const incumbentRanked = rank(incumbents, resolved, rankOptions);
  // Rank the cohort among itself so its own rows are still ordered usefully for
  // field fill, then strip anything that implies selection.
  const additiveRanked = rank(additive, resolved, rankOptions);
  const additiveRows = additiveRanked.candidates.map((candidate) => ({
    ...candidate,
    selected: false,
    admission: ADDITIVE_ADMISSION,
    rejection_reason: "additive_only_cohort_not_eligible_for_selection"
  }));

  return {
    ...incumbentRanked,
    candidates: [...incumbentRanked.candidates, ...additiveRows],
    additive_admission: {
      cohorts: [...cohorts],
      incumbent_count: incumbentRanked.candidates.length,
      additive_count: additiveRows.length
    }
  };
}

export const additiveAdmissionMarker = ADDITIVE_ADMISSION;
